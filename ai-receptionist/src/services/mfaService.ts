// TWO-FACTOR SERVICE — enrolment, recovery codes, remembered devices.
//
// MFA IS OPT-IN AND ONLY EVER ADDS A GATE. Nothing here removes a check, and nobody's
// sign-in changes until they choose to enrol. Every column is nullable and every table
// starts empty, so "MFA off" is the default state of every account that exists today.
import { prisma } from "../db/client";
import { hashPassword, verifyPassword } from "../auth/passwords";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  generateTotpSecret, verifyTotp, otpauthUri, readableSecret,
  generateRecoveryCode, normaliseRecoveryCode, RECOVERY_CODE_COUNT,
} from "./totp";

const db = prisma as any;

export const TRUSTED_DEVICE_DAYS = 30;
export const TRUSTED_DEVICE_COOKIE = "air_td";

/** Is the second factor live for this account? Pending enrolment does NOT count. */
export function mfaIsOn(user: { mfaSecret?: string | null } | null | undefined): boolean {
  return !!(user && user.mfaSecret);
}

/**
 * BEGIN ENROLMENT. The secret is written to mfaPendingSecret, NOT to mfaSecret, so it is
 * inert: an enrolment that is started and abandoned leaves the account exactly as it was.
 * It becomes live only in confirmEnrolment(), and only after a code has been verified.
 */
export async function beginEnrolment(userId: string, email: string) {
  const secret = generateTotpSecret();
  await db.user.update({ where: { id: userId }, data: { mfaPendingSecret: secret } });
  return { secret, uri: otpauthUri(secret, email), typable: readableSecret(secret) };
}

/**
 * CONFIRM ENROLMENT. Promotes the pending secret only if the code checks out, and issues the
 * recovery codes in the same step - enrolment is not complete until they exist, because a
 * lost phone with no recovery path is a permanently locked account.
 *
 * Returns the plain codes ONCE. They are stored hashed and are never retrievable again.
 */
export async function confirmEnrolment(userId: string, code: string): Promise<{ ok: boolean; codes?: string[] }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.mfaPendingSecret) return { ok: false };
  const step = verifyTotp(user.mfaPendingSecret, code, null);
  if (step === null) return { ok: false };
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  const hashes = await Promise.all(codes.map((c) => hashPassword(normaliseRecoveryCode(c))));
  await db.$transaction([
    db.userRecoveryCode.deleteMany({ where: { userId } }),
    db.userRecoveryCode.createMany({ data: hashes.map((codeHash: string) => ({ userId, codeHash })) }),
    db.user.update({ where: { id: userId }, data: { mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastStep: step } }),
  ]);
  return { ok: true, codes };
}

/** How many recovery codes remain. Falls out of deleting them as they are spent. */
export async function recoveryCodesRemaining(userId: string): Promise<number> {
  return db.userRecoveryCode.count({ where: { userId } });
}

/** Issue a fresh set, replacing any that remain. Shown once, stored hashed. */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  const hashes = await Promise.all(codes.map((c) => hashPassword(normaliseRecoveryCode(c))));
  await db.$transaction([
    db.userRecoveryCode.deleteMany({ where: { userId } }),
    db.userRecoveryCode.createMany({ data: hashes.map((codeHash: string) => ({ userId, codeHash })) }),
  ]);
  return codes;
}

/**
 * Spend a recovery code. SINGLE USE: the row is deleted on a match, so the same code can
 * never work twice and the remaining count drops by one.
 */
export async function consumeRecoveryCode(userId: string, submitted: string): Promise<boolean> {
  const norm = normaliseRecoveryCode(submitted);
  if (norm.length < 8) return false;
  const rows = await db.userRecoveryCode.findMany({ where: { userId } });
  for (const row of rows) {
    if (await verifyPassword(norm, row.codeHash)) {
      const del = await db.userRecoveryCode.deleteMany({ where: { id: row.id } });
      return (del?.count || 0) > 0; // lost race = not consumed by us
    }
  }
  return false;
}

/** Verify a live TOTP code and advance the replay high-water mark. */
export async function verifyLiveTotp(userId: string, code: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.mfaSecret) return false;
  const step = verifyTotp(user.mfaSecret, code, user.mfaLastStep ?? null);
  if (step === null) return false;
  await db.user.update({ where: { id: userId }, data: { mfaLastStep: step } });
  return true;
}

/** Either factor: an authenticator code, or one recovery code (which is then spent). */
export async function satisfySecondFactor(userId: string, code: string): Promise<"totp" | "recovery" | null> {
  if (await verifyLiveTotp(userId, code)) return "totp";
  if (await consumeRecoveryCode(userId, code)) return "recovery";
  return null;
}

/**
 * TURN IT OFF. Clears the secret, the pending secret, the replay marker, every recovery code
 * AND every remembered device - because a device remembered under the old secret must not
 * survive it. The caller is responsible for having proved a second factor and the password
 * first; this function does not decide, it executes.
 */
export async function disableMfa(userId: string): Promise<void> {
  await db.$transaction([
    db.userRecoveryCode.deleteMany({ where: { userId } }),
    db.userTrustedDevice.deleteMany({ where: { userId } }),
    db.user.update({ where: { id: userId }, data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
  ]);
}

// ------------------------------------------------------------------ remembered devices
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Remember this browser for 30 days. Returns the cookie value; only its hash is stored. */
export async function rememberDevice(userId: string, label?: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.userTrustedDevice.create({
    data: { userId, tokenHash: sha256(token), label: label || null, expiresAt: new Date(Date.now() + TRUSTED_DEVICE_DAYS * 86400000) },
  });
  return token;
}

/** Is this browser already trusted for this account? Expired rows never count. */
export async function deviceIsTrusted(userId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const row = await db.userTrustedDevice.findUnique({ where: { tokenHash: sha256(String(token)) } });
  if (!row || row.userId !== userId) return false;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db.userTrustedDevice.deleteMany({ where: { id: row.id } });
    return false;
  }
  const a = Buffer.from(row.userId), b = Buffer.from(userId);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * FORGET EVERY REMEMBERED DEVICE. Called on password change, on turning MFA off, and on
 * sign-out-everywhere. This is what makes a remembered device revocable rather than a second
 * password nobody can take back.
 */
export async function forgetAllDevices(userId: string): Promise<number> {
  const r = await db.userTrustedDevice.deleteMany({ where: { userId } });
  return r?.count || 0;
}

/** What Settings -> Your account shows. */
export async function mfaStatus(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  return {
    enabled: mfaIsOn(user),
    enrolling: !!(user && user.mfaPendingSecret && !user.mfaSecret),
    since: user?.mfaEnabledAt || null,
    recoveryRemaining: mfaIsOn(user) ? await recoveryCodesRemaining(userId) : 0,
    trustedDevices: mfaIsOn(user) ? await db.userTrustedDevice.count({ where: { userId, expiresAt: { gt: new Date() } } }) : 0,
  };
}
