import type { Context, Hono } from "hono";
import { PinGuard, VoiceIdError, checkPin, hashPin, type VoiceprintStore } from "@jarvis/voiceid";
import { OWNER_ID, SESSION_HEADER, Sessions, atLeast, type Identity, type UserStore } from "./users.js";

/** Kept for older imports: unlock tokens are now user sessions. */
export { Sessions as UnlockTokens } from "./users.js";

export type SpeakerCheck =
  | { ok: true; userId?: string; name?: string; score?: number; via: "off" | "voice" | "pin" }
  | { ok: false; status: 403 | 400 | 503; body: Record<string, unknown> };

/** Voice ID gate for spoken requests: off, recognised voice, or a PIN unlock token. */
export async function checkSpeaker(store: VoiceprintStore | undefined, tokens: Sessions, wav: Buffer, unlock?: string, users?: UserStore): Promise<SpeakerCheck> {
  if (!store || !store.available() || !store.settings().enabled) return { ok: true, via: "off" };
  // PIN fallback: a PIN unlock lets voice through for 15 minutes as the owner.
  const held = tokens.get(unlock);
  if (held?.via === "pin") return { ok: true, userId: held.userId, via: "pin" };
  try {
    const r = await store.identify(wav);
    // A voiceprint whose user was removed doesn't count.
    if (r.accepted && (!users || users.get(r.userId!))) return { ok: true, userId: r.userId, name: users?.get(r.userId!)?.name ?? r.name, score: r.score, via: "voice" };
    return { ok: false, status: 403, body: { error: "Access denied", denied: true, score: r.score, pinAvailable: !!store.settings().pinHash } };
  } catch (e) {
    if (e instanceof VoiceIdError && e.code === "too_short") return { ok: false, status: 400, body: { error: e.message } };
    return { ok: false, status: 503, body: { error: e instanceof Error ? e.message : "Voice ID failed" } };
  }
}

type Ctx = { req: { header(n: string): string | undefined } };

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Voice ID endpoints. When a PIN is set, changing voice ID (enroll, remove, settings) needs that PIN
 * or a fresh unlock token, so someone at the keyboard can't quietly enroll their own voice.
 */
export function registerVoiceIdRoutes(
  app: Hono,
  store: VoiceprintStore | undefined,
  tokens: Sessions,
  access: { users?: UserStore; whoIs?: (c: Ctx) => Identity } = {},
  guard = new PinGuard(),
) {
  /** Changing voice ID needs an admin, and (when a PIN is set) a voice/PIN session or the PIN itself. */
  const authorised = (c: Ctx) => {
    if (access.whoIs && !atLeast(access.whoIs(c).role, "admin")) return false;
    const s = store?.settings();
    if (!s?.pinHash) return true;
    return tokens.valid(c.req.header(SESSION_HEADER)) || checkPin(c.req.header("x-friday-pin") ?? "", s.pinHash);
  };
  const deny = (c: Context) =>
    access.whoIs && !atLeast(access.whoIs(c).role, "admin")
      ? c.json({ error: "Only an admin can change voice ID" }, 403)
      : c.json({ error: "Enter your PIN to change voice ID" }, 401);
  const missing = { error: "Voice ID isn't set up. Run pnpm voice:setup --voiceid, then restart Friday." };

  app.get("/api/voiceid", (c) => {
    if (!store) return c.json({ available: false, setup: missing.error });
    const s = store.settings();
    return c.json({
      available: store.available(),
      setup: store.available() ? null : missing.error,
      enabled: s.enabled,
      threshold: s.threshold,
      hasPin: !!s.pinHash,
      prints: store.prints().map((p) => ({ ...p, name: access.users?.get(p.userId)?.name ?? p.name })),
      recent: store.recent(),
    });
  });

  app.post("/api/voiceid/enroll", async (c) => {
    if (!store?.available()) return c.json(missing, 503);
    if (!authorised(c)) return deny(c);
    const userId = c.req.query("user") || OWNER_ID;
    const known = access.users?.get(userId);
    if (access.users && !known) return c.json({ error: "Add this person on the Users panel first" }, 404);
    const name = (known?.name ?? c.req.query("name") ?? "Owner").slice(0, 40);
    try {
      return c.json(await store.enroll(userId, name, Buffer.from(await c.req.arrayBuffer())));
    } catch (e) {
      return c.json({ error: err(e) }, 400);
    }
  });

  app.delete("/api/voiceid/prints/:userId", (c) => {
    if (!store) return c.json(missing, 503);
    if (!authorised(c)) return deny(c);
    store.cancelEnrollment(c.req.param("userId"));
    store.remove(c.req.param("userId"));
    return c.json({ ok: true });
  });

  app.put("/api/voiceid/settings", async (c) => {
    if (!store) return c.json(missing, 503);
    if (!authorised(c)) return deny(c);
    const b = ((await c.req.json().catch(() => null)) ?? {}) as { threshold?: unknown; enabled?: unknown; pin?: unknown };
    try {
      store.updateSettings({
        ...(typeof b.threshold === "number" && { threshold: b.threshold }),
        ...(typeof b.enabled === "boolean" && { enabled: b.enabled }),
        ...(typeof b.pin === "string" && { pinHash: b.pin ? hashPin(b.pin) : undefined }),
      });
    } catch (e) {
      return c.json({ error: err(e) }, 400);
    }
    const s = store.settings();
    return c.json({ enabled: s.enabled, threshold: s.threshold, hasPin: !!s.pinHash });
  });

  /** Checks a recording without transcribing it (used by the dashboard's "Test my voice"). */
  app.post("/api/voiceid/verify", async (c) => {
    if (!store?.available()) return c.json(missing, 503);
    try {
      return c.json(await store.identify(Buffer.from(await c.req.arrayBuffer())));
    } catch (e) {
      return c.json({ error: err(e) }, 400);
    }
  });

  /** PIN fallback: a correct PIN unlocks spoken requests for 15 minutes. */
  app.post("/api/voiceid/pin", async (c) => {
    const hash = store?.settings().pinHash;
    if (!hash) return c.json({ error: "No PIN is set" }, 400);
    if (guard.locked()) return c.json({ error: "Too many wrong PINs. Try again in a few minutes." }, 429);
    const b = ((await c.req.json().catch(() => null)) ?? {}) as { pin?: unknown };
    const ok = typeof b.pin === "string" && checkPin(b.pin, hash);
    guard.result(ok);
    store!.record({ at: new Date().toISOString(), outcome: ok ? "pin" : "denied", score: 0 });
    return ok ? c.json({ unlock: tokens.issue(OWNER_ID, "pin"), minutes: 15 }) : c.json({ error: "Wrong PIN" }, 401);
  });
}
