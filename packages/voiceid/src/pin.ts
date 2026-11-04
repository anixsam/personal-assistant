import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPin(pin: string): string {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4 to 8 digits");
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function checkPin(pin: string, stored: string | undefined): boolean {
  if (!stored || typeof pin !== "string") return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const got = scryptSync(pin, Buffer.from(salt, "hex"), 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Simple lockout: after `max` wrong PINs, refuse for `ms`. */
export class PinGuard {
  private fails = 0;
  private lockedUntil = 0;
  constructor(private readonly max = 5, private readonly ms = 5 * 60_000) {}
  locked(now = Date.now()) {
    return now < this.lockedUntil;
  }
  result(ok: boolean, now = Date.now()) {
    if (ok) this.fails = 0;
    else if (++this.fails >= this.max) {
      this.fails = 0;
      this.lockedUntil = now + this.ms;
    }
  }
}
