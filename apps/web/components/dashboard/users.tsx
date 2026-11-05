"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Mic, Pencil, Trash2, UserPlus } from "lucide-react";
import { MicRecorder, authHeaders } from "@/lib/recorder";
import { cn } from "@/lib/utils";
import { EnrollVoice } from "./voice-id";

type Role = "guest" | "member" | "admin" | "owner";
interface UserRow {
  id: string;
  name: string;
  role: Role;
  voice: boolean;
  createdAt: string;
}

const ROLE_INFO: Record<Role, string> = {
  guest: "Chat only",
  member: "Chat and tasks (tools, can ask for handoffs)",
  admin: "Approves Claude / Claude Code handoffs, manages users",
  owner: "You: everything, can't be removed",
};

/** Users and roles: add, rename, change role, enroll each person's voice, remove. */
export function UsersPanel({ authPin, onChange }: { authPin: string; onChange?: () => void }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [keyboardRole, setKeyboardRole] = useState<Role>("owner");
  const [denied, setDenied] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users", { headers: authHeaders() });
      const body = (await res.json()) as { users?: UserRow[]; keyboardRole?: Role; error?: string };
      if (!res.ok) {
        setDenied(body.error ?? "You can't manage users");
        return;
      }
      setDenied(null);
      setUsers(body.users ?? []);
      setKeyboardRole(body.keyboardRole ?? "owner");
    } catch {
      setDenied("Could not reach the Friday server");
    }
  }, []);
  useEffect(() => {
    void load();
    window.addEventListener("friday:identity", load);
    return () => window.removeEventListener("friday:identity", load);
  }, [load]);

  async function call(method: string, url: string, body?: unknown, ok?: string) {
    setMsg(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json", ...authHeaders(authPin) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
      const r = (await res.json().catch(() => ({}))) as { users?: UserRow[]; keyboardRole?: Role; error?: string };
      if (!res.ok) throw new Error(r.error || `Failed (${res.status})`);
      if (r.users) setUsers(r.users);
      if (r.keyboardRole) setKeyboardRole(r.keyboardRole);
      if (ok) setMsg({ tone: "ok", text: ok });
      onChange?.();
      return true;
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Could not save" });
      return false;
    }
  }

  if (denied) return <p className="text-sm text-muted">{denied}. Say something to Friday so it recognises you, or unlock with the PIN on the chat page.</p>;
  if (!users) return <p className="text-sm text-muted">Loading…</p>;

  const canMic = MicRecorder.supported();
  const select = "rounded border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-accent/60";
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {users.map((u) => (
          <li key={u.id} className="space-y-2 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {renaming?.id === u.id ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void call("PATCH", `/api/users/${u.id}`, { name: renaming.name }).then((ok) => ok && setRenaming(null));
                  }}
                >
                  <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: u.id, name: e.target.value })} aria-label="Name" className="w-32 rounded border border-line bg-bg px-2 py-0.5 text-sm outline-none focus:border-accent/60" />
                  <button className="text-muted hover:text-fg" aria-label="Save name">
                    <Check size={14} />
                  </button>
                </form>
              ) : (
                <span className="text-sm font-medium">{u.name}</span>
              )}
              {renaming?.id !== u.id && (
                <button onClick={() => setRenaming({ id: u.id, name: u.name })} aria-label={`Rename ${u.name}`} className="text-muted hover:text-fg">
                  <Pencil size={12} />
                </button>
              )}
              <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", u.voice ? "border-ok/40 text-ok" : "border-line text-muted")}>{u.voice ? "Voice saved" : "No voice yet"}</span>
              <div className="ml-auto flex items-center gap-2">
                {u.role === "owner" ? (
                  <span className="font-hud text-[11px] tracking-[0.15em] text-accent">OWNER</span>
                ) : (
                  <select value={u.role} onChange={(e) => void call("PATCH", `/api/users/${u.id}`, { role: e.target.value }, `${u.name} is now ${e.target.value}.`)} aria-label={`Role for ${u.name}`} className={select}>
                    <option value="guest">guest</option>
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                )}
                <button
                  disabled={!canMic || enrolling !== null}
                  onClick={() => setEnrolling(u.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-accent/40 px-2 py-0.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
                >
                  <Mic size={12} /> {u.voice ? "Re-enroll" : "Enroll voice"}
                </button>
                {u.role !== "owner" && (
                  <button
                    onClick={() => confirm(`Remove ${u.name} and their voiceprint?`) && void call("DELETE", `/api/users/${u.id}`, undefined, `${u.name} removed.`)}
                    aria-label={`Remove ${u.name}`}
                    className="text-muted hover:text-bad"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="text-xs text-muted">{ROLE_INFO[u.role]}</div>
            {enrolling === u.id && (
              <div className="rounded-md border border-line p-2">
                <div className="mb-1 text-xs text-muted">{u.role === "owner" ? "Read these yourself." : `Hand the mic to ${u.name}.`}</div>
                <EnrollVoice
                  userId={u.id}
                  headers={() => authHeaders(authPin)}
                  onCancel={() => setEnrolling(null)}
                  onDone={(c) => {
                    setEnrolling(null);
                    setMsg({ tone: "ok", text: `${u.name}'s voice saved (consistency ${Math.round(c * 100)}%).` });
                    void load();
                    onChange?.();
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void call("POST", "/api/users", { name, role }, `${name.trim()} added. Next, enroll their voice.`).then((ok) => ok && setName(""));
        }}
      >
        <UserPlus size={15} className="text-muted" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="New user's name" className="w-36 rounded border border-line bg-bg px-2 py-1 text-sm outline-none focus:border-accent/60" />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="New user's role" className={select}>
          <option value="guest">guest</option>
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button disabled={!name.trim()} className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-fg disabled:opacity-50">
          Add user
        </button>
      </form>

      <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
        Typed messages (when no voice is recognised) count as
        <select value={keyboardRole} onChange={(e) => void call("PUT", "/api/users-keyboard", { role: e.target.value }, "Saved.")} aria-label="Role for typed messages" className={select}>
          <option value="owner">the owner</option>
          <option value="admin">admin</option>
          <option value="member">member</option>
          <option value="guest">guest</option>
        </select>
        <span>Only applies while voice ID is on.</span>
      </label>

      {msg && <p className={cn("text-sm", msg.tone === "ok" ? "text-ok" : "text-bad")}>{msg.text}</p>}
    </div>
  );
}
