import { Router, Request, Response } from "express";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { isStripeConfigured, constructWebhookEvent } from "../services/stripeService";
import { handleStripeEvent } from "../services/stripeWebhookService";

// PUBLIC Stripe webhook. Mounted at /webhooks/stripe in app.ts, OUTSIDE all auth/permission
// middleware and BEFORE the global JSON parser — Stripe signature verification needs the EXACT
// raw bytes, so this route reads express.raw() (a Buffer).
export const stripeWebhookRouter = Router();

let warnedNoSecret = false;

stripeWebhookRouter.post("/", async (req: Request, res: Response) => {
  const secret = env.STRIPE_WEBHOOK_SECRET;

  // Not configured yet: no-op with 200 so deploying before the secret exists is safe.
  if (!secret || !isStripeConfigured()) {
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      logger.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET (or STRIPE_SECRET_KEY) not set — ignoring events (200).");
    }
    res.status(200).json({ ok: true, skipped: "no_secret" });
    return;
  }

  const sigHeader = req.headers["stripe-signature"];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader || "";
  const raw = req.body;
  const rawBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(typeof raw === "string" ? raw : raw != null ? JSON.stringify(raw) : "");

  let event: any;
  try {
    event = constructWebhookEvent(rawBuf, signature, secret);
  } catch (e) {
    // Bad signature (or malformed) — 400, no retry benefit.
    res.status(400).json({ error: "invalid signature" });
    return;
  }

  try {
    const result = await handleStripeEvent(event);
    // 2xx fast on success, including ignored/duplicate — nothing for Stripe to retry.
    res.status(200).json({ ok: true, result });
  } catch (e) {
    // Genuine processing error (e.g. DB blip): 500 so Stripe retries later.
    logger.error(`[stripe-webhook] processing failed: ${(e as Error).message}`);
    res.status(500).json({ error: "processing failed" });
  }
});
