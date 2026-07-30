// TWO-FACTOR PRIMITIVES — TOTP and recovery codes.
//
// HAND-ROLLED ON PURPOSE. TOTP is an HMAC over a counter; it is about thirty lines with
// node's own crypto, and the self-test verifies it against the reference vectors published
// in RFC 6238 Appendix B. Passing those vectors is stronger evidence of correctness than
// trusting an unread package, and it keeps a login-critical path free of a supply chain.
//
// PARAMETERS: SHA-1, 6 digits, 30-second period. Those are the universal defaults every
// authenticator app assumes; changing any of them silently breaks scanning.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_S = 30;
/**
 * DRIFT WINDOW: +/- 1 step, so a code is accepted for at most 90 seconds.
 *
 * Tighter and a phone whose clock is a minute slow locks its owner out of their own account,
 * which is the most common real-world MFA failure. Looser multiplies the guessing surface of
 * a secret only worth 10^6. One step each way is the usual compromise, and replay inside the
 * window is closed separately by remembering the last accepted step.
 */
export const TOTP_DRIFT_STEPS = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, no padding — the encoding every authenticator expects. */
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = String(s || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A fresh secret. 20 bytes = 160 bits, the RFC 4226 recommendation. */
export function generateTotpSecret(): string { return base32Encode(randomBytes(20)); }

/** The counter step for a moment in time. */
export function totpStep(atMs: number = Date.now()): number { return Math.floor(atMs / 1000 / TOTP_PERIOD_S); }

/** The 6-digit code for a given secret and step. */
export function totpCodeForStep(secretB32: string, step: number): string {
  const key = base32Decode(secretB32);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Verify a submitted code.
 *
 * Returns the STEP it matched, so the caller can store it and refuse anything at or below
 * that step next time — which is what stops the same code being replayed inside its own
 * 90-second window. Returns null on no match.
 *
 * `lastUsedStep` is the caller's stored high-water mark; pass null if there is none.
 */
export function verifyTotp(secretB32: string, code: string, lastUsedStep: number | null, atMs: number = Date.now()): number | null {
  const submitted = String(code || "").replace(/\D/g, "");
  if (submitted.length !== TOTP_DIGITS) return null;
  const now = totpStep(atMs);
  for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d++) {
    const step = now + d;
    if (lastUsedStep !== null && step <= lastUsedStep) continue; // already spent
    const expected = totpCodeForStep(secretB32, step);
    const a = Buffer.from(expected), b = Buffer.from(submitted);
    if (a.length === b.length && timingSafeEqual(a, b)) return step;
  }
  return null;
}

/** The otpauth:// URI an authenticator scans or accepts pasted. */
export function otpauthUri(secretB32: string, accountEmail: string, issuer = "Clarity"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const q = new URLSearchParams({
    secret: secretB32, issuer, algorithm: "SHA1",
    digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_S),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** The typable form: grouped in fours so a human can transcribe it without losing their place. */
export function readableSecret(secretB32: string): string {
  return (secretB32.match(/.{1,4}/g) || []).join(" ");
}

export const RECOVERY_CODE_COUNT = 10;
/**
 * A recovery code. Crockford-ish alphabet with the characters people confuse removed
 * (no O/0, no I/1/L), because these get written on paper and typed back months later.
 */
export function generateRecoveryCode(): string {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += A[randomInt(A.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
/** Compare loosely on shape — case and the dash are not part of the secret. */
export function normaliseRecoveryCode(input: string): string {
  return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
