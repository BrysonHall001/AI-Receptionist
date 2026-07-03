import { Router, Request, Response } from "express";
import crypto from "crypto";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { applyResendEvent } from "../services/emailLogService";

// PUBLIC Resend delivery webhook. Mounted at /webhooks/resend in app.ts, OUTSIDE all
// auth/permission middleware and BEFORE the global JSON body parser — Svix signature
// verification requires the EXACT raw bytes, so this route reads express.raw() (a Buffer).
export const resendWebhookRouter = Router();

// Log the "no secret configured" path only once so a busy endpoint doesn't spam the log.
let warnedNoSecret = false;

function headerStr(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] || "";
  return v || "";
}

/**
 * Verify a Svix/Resend webhook signature over the RAW body.
 *
 * Svix scheme: signedContent = `${svix-id}.${svix-timestamp}.${rawBody}`; the signature is
 * base64(HMAC-SHA256(secretBytes, signedContent)), where secretBytes = base64-decode of the
 * secret with its `whsec_` prefix stripped. The `svix-signature` header is a space-separated
 * list of `v1,<sig>` tokens (key rotation) — a match on ANY valid token passes. We also
 * enforce a 5-minute timestamp tolerance to bound replay. Constant-time compare throughout.
 */
export function verifyResendSignature(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  const svixId = headerStr(headers["svix-id"]);
  const svixTimestamp = headerStr(headers["svix-timestamp"]);
  const svixSignature = headerStr(headers["svix-signature"]);
  if (!svixId || !svixTimestamp || !svixSignature || !secret) return false;

  // Timestamp tolerance (5 minutes) to bound replay of captured requests.
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > 60 * 5) return false;

  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (!secretBytes.length) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expected);

  // Header may carry multiple space-separated "v1,<sig>" tokens (key rotation).
  for (const token of svixSignature.split(" ")) {
    const comma = token.indexOf(",");
    if (comma === -1) continue;
    const version = token.slice(0, comma);
    const sig = token.slice(comma + 1);
    if (version !== "v1" || !sig) continue;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

resendWebhookRouter.post("/", async (req: Request, res: Response) => {
  const secret = env.RESEND_WEBHOOK_SECRET;

  // Not configured yet: no-op with 200 so deploying before the secret exists is safe.
  if (!secret) {
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      logger.warn("[resend-webhook] RESEND_WEBHOOK_SECRET not set — ignoring delivery events (200).");
    }
    res.status(200).json({ ok: true, skipped: "no_secret" });
    return;
  }

  // req.body is a Buffer here (express.raw mounted for this route). Fall back defensively.
  const raw = req.body;
  const payload = Buffer.isBuffer(raw)
    ? raw.toString("utf8")
    : typeof raw === "string"
      ? raw
      : raw != null
        ? JSON.stringify(raw)
        : "";

  if (!verifyResendSignature(payload, req.headers, secret)) {
    res.status(400).json({ error: "invalid signature" });
    return;
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    res.status(400).json({ error: "invalid JSON body" });
    return;
  }

  try {
    const result = await applyResendEvent(event);
    // 2xx on success, including unmatched ids / ignored events — nothing to retry there.
    res.status(200).json({ ok: true, result });
  } catch (e) {
    // A genuine processing error (e.g. DB blip): 500 so Resend retries later.
    logger.error(`[resend-webhook] processing failed: ${(e as Error).message}`);
    res.status(500).json({ error: "processing failed" });
  }
});
