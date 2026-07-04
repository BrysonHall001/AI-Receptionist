// Stripe client — lazily constructed from STRIPE_SECRET_KEY (test mode). The key is OPTIONAL:
// the app boots without it, and Stripe-dependent code must check isStripeConfigured() first and
// surface a clear error rather than crashing.
import Stripe from "stripe";
import { env } from "../config/env";

export class StripeNotConfiguredError extends Error {
  constructor() { super("Stripe is not configured — add STRIPE_SECRET_KEY"); this.name = "StripeNotConfiguredError"; }
}

let client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY.trim());
}

// Returns the Stripe client, or throws StripeNotConfiguredError if the key is unset.
export function getStripe(): Stripe {
  if (!isStripeConfigured()) throw new StripeNotConfiguredError();
  if (!client) client = new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

// True when the configured key looks like a TEST-mode key (sk_test_...). Informational only.
export function isStripeTestMode(): boolean {
  return isStripeConfigured() && /^sk_test_/.test(env.STRIPE_SECRET_KEY.trim());
}

// "test" | "live" | null — from the key prefix, so the operator always knows if real money is live.
export function stripeMode(): "test" | "live" | null {
  if (!isStripeConfigured()) return null;
  const k = env.STRIPE_SECRET_KEY.trim();
  if (/^sk_live_/.test(k) || /^rk_live_/.test(k)) return "live";
  if (/^sk_test_/.test(k) || /^rk_test_/.test(k)) return "test";
  return null;
}

// Test seam: inject a fake Stripe client so self-tests never hit the live API. No effect in
// normal operation (production always builds the real client from the key).
export function __setStripeClientForTest(c: unknown): void { client = (c as Stripe) ?? null; }

// Verify + parse a Stripe webhook using the SDK (HMAC over the RAW body). Throws on a bad
// signature. Requires the API key (to build the client) and the webhook signing secret.
export function constructWebhookEvent(rawBody: Buffer | string, signature: string, secret: string): Stripe.Event {
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}
