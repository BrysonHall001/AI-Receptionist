import bcrypt from "bcryptjs";
import { isPlaceholderSecret } from "../config/env";

const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
// Shared USER-account password policy (Task: stronger passwords everywhere).
// This is the SINGLE source of truth enforced at every path that sets a user
// password (invite acceptance, password reset, self password change). It is
// deliberately separate from the super-admin SEED check (env.isWeakPassword,
// 12+ chars) which is unchanged. MFA is out of scope.
// ---------------------------------------------------------------------------
export const PASSWORD_MIN_LENGTH = 10;

// Plain-English requirement shown to the user (and returned on the common
// length/mix failure). Keep the UI copy in invite.html / auth.js in sync.
export const PASSWORD_POLICY_TEXT =
  "Password must be at least 10 characters and mix at least two of: lowercase, uppercase, numbers, or symbols.";

// Obvious weak/common values to reject outright (substring match, case-insensitive).
const WEAK_BLOCKLIST = [
  "12345678", "password", "qwerty", "changeme", "letmein", "iloveyou",
  "welcome", "admin123", "111111", "000000", "qwertyui",
];

/**
 * Validate a proposed USER password against the shared policy.
 * Returns { ok: true } or { ok: false, message } with a plain-English reason.
 * `opts.email` (when known) also blocks passwords built from the email local-part.
 */
export function checkPassword(
  password: string,
  opts?: { email?: string | null },
): { ok: true } | { ok: false; message: string } {
  const pw = String(password ?? "");
  if (pw.length < PASSWORD_MIN_LENGTH) return { ok: false, message: PASSWORD_POLICY_TEXT };

  // At least TWO of four character categories (rejects all-digit "12345678" and
  // all-same-char strings, which only ever hit one category).
  let categories = 0;
  if (/[a-z]/.test(pw)) categories++;
  if (/[A-Z]/.test(pw)) categories++;
  if (/[0-9]/.test(pw)) categories++;
  if (/[^A-Za-z0-9]/.test(pw)) categories++;
  if (categories < 2) return { ok: false, message: PASSWORD_POLICY_TEXT };

  const lower = pw.toLowerCase();
  // Reuse the existing placeholder-secret detector (xxxx, your_, changeme, …).
  if (isPlaceholderSecret(pw)) return { ok: false, message: "That password is too predictable — please choose another." };
  for (const term of WEAK_BLOCKLIST) {
    if (lower.includes(term)) return { ok: false, message: "That password is too common — please choose a less predictable one." };
  }
  const local = String(opts?.email ?? "").split("@")[0].trim().toLowerCase();
  if (local.length >= 3 && lower.includes(local)) {
    return { ok: false, message: "Password must not contain your email address." };
  }
  return { ok: true };
}

/** Thrown by the setPassword backstop when a password fails the shared policy. */
export class PasswordPolicyError extends Error {
  status = 400;
  constructor(message: string) { super(message); this.name = "PasswordPolicyError"; }
}

/** Backstop used at write chokepoints: throws PasswordPolicyError on a bad password. */
export function assertPasswordAllowed(password: string, opts?: { email?: string | null }): void {
  const result = checkPassword(password, opts);
  if (!result.ok) throw new PasswordPolicyError(result.message);
}
