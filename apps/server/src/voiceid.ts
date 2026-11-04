import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { PinGuard, VoiceIdError, checkPin, hashPin, type VoiceprintStore } from "@jarvis/voiceid";

/** Short-lived unlock tokens handed out after a correct PIN (when the voice isn't recognised). */
export class UnlockTokens {
  private readonly tokens = new Map<string, number>();
  constructor(private readonly ttlMs = 15 * 60_000) {}
  issue(now = Date.now()): string {
    const t = randomBytes(18).toString("base64url");
    this.tokens.set(t, now + this.ttlMs);
    return t;
  }
  valid(t: string | undefined, now = Date.now()): boolean {
    const exp = t ? this.tokens.get(t) : undefined;
    if (!exp) return false;
    if (exp < now) {
      this.tokens.delete(t!);
      return false;
    }
    return true;
  }
}

export type SpeakerCheck =
  | { ok: true; name?: string; score?: number; via: "off" | "voice" | "pin" }
  | { ok: false; status: 403 | 400 | 503; body: Record<string, unknown> };

/** Voice ID gate for spoken requests: off, recognised voice, or a PIN unlock token. */
export async function checkSpeaker(store: VoiceprintStore | undefined, tokens: UnlockTokens, wav: Buffer, unlock?: string): Promise<SpeakerCheck> {
  if (!store || !store.available() || !store.settings().enabled) return { ok: true, via: "off" };
  if (tokens.valid(unlock)) return { ok: true, via: "pin" };
  try {
    const r = await store.identify(wav);
    if (r.accepted) return { ok: true, name: r.name, score: r.score, via: "voice" };
    return { ok: false, status: 403, body: { error: "Access denied", denied: true, score: r.score, pinAvailable: !!store.settings().pinHash } };
  } catch (e) {
    if (e instanceof VoiceIdError && e.code === "too_short") return { ok: false, status: 400, body: { error: e.message } };
    return { ok: false, status: 503, body: { error: e instanceof Error ? e.message : "Voice ID failed" } };
  }
}

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Voice ID endpoints. When a PIN is set, changing voice ID (enroll, remove, settings) needs that PIN
 * or a fresh unlock token, so someone at the keyboard can't quietly enroll their own voice.
 */
export function registerVoiceIdRoutes(app: Hono, store: VoiceprintStore | undefined, tokens: UnlockTokens, guard = new PinGuard()) {
  const authorised = (c: { req: { header(n: string): string | undefined } }) => {
    const s = store?.settings();
    if (!s?.pinHash) return true;
    return tokens.valid(c.req.header("x-friday-unlock")) || checkPin(c.req.header("x-friday-pin") ?? "", s.pinHash);
  };
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
      prints: store.prints(),
      recent: store.recent(),
    });
  });

  app.post("/api/voiceid/enroll", async (c) => {
    if (!store?.available()) return c.json(missing, 503);
    if (!authorised(c)) return c.json({ error: "Enter your PIN to change voice ID" }, 401);
    const userId = c.req.query("user") || "owner";
    const name = (c.req.query("name") || "Owner").slice(0, 40);
    try {
      return c.json(await store.enroll(userId, name, Buffer.from(await c.req.arrayBuffer())));
    } catch (e) {
      return c.json({ error: err(e) }, 400);
    }
  });

  app.delete("/api/voiceid/prints/:userId", (c) => {
    if (!store) return c.json(missing, 503);
    if (!authorised(c)) return c.json({ error: "Enter your PIN to change voice ID" }, 401);
    store.cancelEnrollment(c.req.param("userId"));
    store.remove(c.req.param("userId"));
    return c.json({ ok: true });
  });

  app.put("/api/voiceid/settings", async (c) => {
    if (!store) return c.json(missing, 503);
    if (!authorised(c)) return c.json({ error: "Enter your PIN to change voice ID" }, 401);
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
    return ok ? c.json({ unlock: tokens.issue(), minutes: 15 }) : c.json({ error: "Wrong PIN" }, 401);
  });
}
