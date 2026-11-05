import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * guest: chat only. member: chat plus tasks (tools, proposing handoffs). admin: also approves
 * Claude / Claude Code handoffs and manages users. owner: an admin who can't be removed and is the
 * only one who can make or remove admins.
 */
export type Role = "guest" | "member" | "admin" | "owner";
export const ROLES: readonly Role[] = ["guest", "member", "admin", "owner"];
const RANK: Record<Role, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];

export interface User {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
}

/** Who is making a request, and how Friday knows. */
export interface Identity {
  userId: string;
  name: string;
  role: Role;
  /** open: voice ID is off; voice: recognised voice; pin: PIN unlock; keyboard: typed with no voice session. */
  via: "open" | "voice" | "pin" | "keyboard";
}

export const OWNER_ID = "owner";

interface FileShape {
  users: User[];
  /** Role for typed requests when nobody has been recognised by voice (voice ID on). */
  keyboardRole: Role;
}

export class UserError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 = 400) {
    super(message);
  }
}

/** Friday's users, saved as JSON (data/users.json). The owner always exists. */
export class UserStore {
  private data: FileShape;

  constructor(private readonly file?: string, ownerName = "Owner") {
    this.data = { users: [], keyboardRole: "owner" };
    if (file && existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<FileShape>;
        this.data = { users: (raw.users ?? []).filter((u) => ROLES.includes(u.role)), keyboardRole: ROLES.includes(raw.keyboardRole as Role) ? raw.keyboardRole! : "owner" };
      } catch {
        /* start fresh if unreadable */
      }
    }
    if (!this.data.users.some((u) => u.id === OWNER_ID)) {
      this.data.users.unshift({ id: OWNER_ID, name: ownerName, role: "owner", createdAt: new Date().toISOString() });
      this.save();
    }
  }

  private save() {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  list(): User[] {
    return this.data.users.map((u) => ({ ...u }));
  }

  get(id: string): User | undefined {
    const u = this.data.users.find((x) => x.id === id);
    return u && { ...u };
  }

  owner(): User {
    return this.get(OWNER_ID)!;
  }

  keyboardRole(): Role {
    return this.data.keyboardRole;
  }

  setKeyboardRole(by: Role, role: Role) {
    if (by !== "owner") throw new UserError("Only the owner can change this", 403);
    if (!ROLES.includes(role)) throw new UserError("Unknown role");
    this.data.keyboardRole = role;
    this.save();
  }

  /** `by` is the role of whoever is asking; admins manage members and guests, the owner manages admins too. */
  add(by: Role, input: { name: string; role: Role }): User {
    const name = cleanName(input.name);
    checkGrant(by, input.role);
    if (this.data.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) throw new UserError(`There's already a user called ${name}`);
    const u: User = { id: randomUUID().slice(0, 8), name, role: input.role, createdAt: new Date().toISOString() };
    this.data.users.push(u);
    this.save();
    return { ...u };
  }

  update(by: Role, id: string, patch: { name?: string; role?: Role }): User {
    const u = this.data.users.find((x) => x.id === id);
    if (!u) throw new UserError("User not found", 404);
    if (u.role === "owner" && by !== "owner") throw new UserError("Only the owner can change the owner", 403);
    if (u.role === "admin" && by !== "owner") throw new UserError("Only the owner can change an admin", 403);
    if (patch.role !== undefined && patch.role !== u.role) {
      if (u.role === "owner") throw new UserError("The owner's role can't be changed");
      checkGrant(by, patch.role);
      u.role = patch.role;
    }
    if (patch.name !== undefined) {
      const name = cleanName(patch.name);
      if (this.data.users.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new UserError(`There's already a user called ${name}`);
      u.name = name;
    }
    this.save();
    return { ...u };
  }

  remove(by: Role, id: string) {
    const u = this.data.users.find((x) => x.id === id);
    if (!u) throw new UserError("User not found", 404);
    if (u.role === "owner") throw new UserError("The owner can't be removed");
    if (u.role === "admin" && by !== "owner") throw new UserError("Only the owner can remove an admin", 403);
    if (!atLeast(by, "admin")) throw new UserError("Only an admin can remove users", 403);
    this.data.users = this.data.users.filter((x) => x.id !== id);
    this.save();
  }
}

function cleanName(n: unknown): string {
  const name = typeof n === "string" ? n.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  if (!name) throw new UserError("Name is required");
  return name;
}

function checkGrant(by: Role, role: Role) {
  if (!ROLES.includes(role)) throw new UserError("Unknown role");
  if (role === "owner") throw new UserError("There is only one owner");
  if (!atLeast(by, "admin")) throw new UserError("Only an admin can manage users", 403);
  if (role === "admin" && by !== "owner") throw new UserError("Only the owner can make someone an admin", 403);
}

/**
 * Short-lived sessions: a recognised voice or a correct PIN gets a token tied to that user, which the
 * browser sends with later requests (typed messages, approvals) so they count as that person.
 */
export class Sessions {
  private readonly tokens = new Map<string, { userId: string; exp: number; via: "voice" | "pin" }>();
  constructor(private readonly ttlMs = 15 * 60_000) {}

  issue(userId: string, via: "voice" | "pin" = "voice", now = Date.now()): string {
    const t = randomBytes(18).toString("base64url");
    this.tokens.set(t, { userId, exp: now + this.ttlMs, via });
    if (this.tokens.size > 500) this.tokens.delete(this.tokens.keys().next().value as string);
    return t;
  }

  /** The user a token belongs to, or undefined when it's missing or expired. */
  user(t: string | undefined, now = Date.now()): string | undefined {
    return this.get(t, now)?.userId;
  }

  get(t: string | undefined, now = Date.now()): { userId: string; via: "voice" | "pin" } | undefined {
    const s = t ? this.tokens.get(t) : undefined;
    if (!s) return undefined;
    if (s.exp < now) {
      this.tokens.delete(t!);
      return undefined;
    }
    return { userId: s.userId, via: s.via };
  }

  valid(t: string | undefined, now = Date.now()): boolean {
    return this.user(t, now) !== undefined;
  }

  /** Ends every session of a user (after they're removed or demoted). */
  revoke(userId: string) {
    for (const [t, s] of this.tokens) if (s.userId === userId) this.tokens.delete(t);
  }
}

export const SESSION_HEADER = "x-friday-unlock";
