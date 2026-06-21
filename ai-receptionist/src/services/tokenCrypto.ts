// Encryption-at-rest for Google OAuth tokens. Standard Node crypto, AES-256-GCM
// (authenticated encryption — tampering is detected on decrypt). Nothing exotic.
//
// The 32-byte key is derived (SHA-256) from GOOGLE_TOKEN_ENCRYPTION_KEY. We read
// process.env at CALL time (not boot) so the key can be provisioned/rotated at
// runtime and so tests can set it without editing .env. The stored format is:
//   v1:<base64 iv>.<base64 authTag>.<base64 ciphertext>
// A version prefix leaves room for future key rotation. A token is NEVER stored
// in plaintext: if no key is configured, encryptToken throws (loud misconfig)
// rather than silently writing a plaintext secret.

import crypto from "crypto";

const VERSION = "v1";
const IV_BYTES = 12; // standard nonce length for GCM

function deriveKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "";
  if (!raw) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY is not set — refusing to store a Google token without encryption.",
    );
  }
  // SHA-256 yields a stable 32-byte key from any passphrase length.
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

/** Encrypt a plaintext token. Returns the versioned, self-describing ciphertext
 *  string to store in the DB. Throws if no encryption key is configured. */
export function encryptToken(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

/** Decrypt a stored ciphertext string back to the plaintext token. Throws if the
 *  key is missing/wrong or the value was tampered with (GCM auth failure). */
export function decryptToken(stored: string): string {
  const key = deriveKey();
  const s = String(stored || "");
  const sep = s.indexOf(":");
  const version = sep === -1 ? "" : s.slice(0, sep);
  if (version !== VERSION) throw new Error("Unrecognized token ciphertext format.");
  const [ivB64, tagB64, ctB64] = s.slice(sep + 1).split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed token ciphertext.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

/** True when a token-encryption key is configured (used to surface a clear,
 *  early error before attempting an OAuth connect in a later sub-batch). */
export function tokenEncryptionConfigured(): boolean {
  return !!(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "");
}
