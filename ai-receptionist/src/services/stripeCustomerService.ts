// Link a tenant/portal to a Stripe customer. Idempotent: if the tenant already has a
// stripeCustomerId, it's returned as-is; otherwise a Stripe customer is created (name = portal
// name, email = BillingConfig.billingEmail if set) and stored on the tenant.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { getStripe, isStripeConfigured, StripeNotConfiguredError } from "./stripeService";

const db = prisma as any;

export interface EnsureCustomerResult { customerId: string; created: boolean; }

export async function ensureStripeCustomer(tenantId: string): Promise<EnsureCustomerResult> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, stripeCustomerId: true } });
  if (!tenant) throw new Error("tenant not found");
  if (tenant.stripeCustomerId) return { customerId: tenant.stripeCustomerId, created: false };

  if (!isStripeConfigured()) throw new StripeNotConfiguredError();

  const cfg = await db.billingConfig.findUnique({ where: { tenantId }, select: { billingEmail: true } });
  const email = cfg?.billingEmail || undefined;

  try {
    const stripe = getStripe();
    const customer = await stripe.customers.create({
      name: tenant.name || tenant.id,
      email,
      metadata: { tenantId },
    });
    // Guard against a race: only set if still empty; re-read to return the winner.
    await db.tenant.updateMany({ where: { id: tenantId, stripeCustomerId: null }, data: { stripeCustomerId: customer.id } });
    const fresh = await db.tenant.findUnique({ where: { id: tenantId }, select: { stripeCustomerId: true } });
    return { customerId: fresh?.stripeCustomerId || customer.id, created: true };
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) throw e;
    logger.warn(`[stripe] ensureStripeCustomer failed for ${tenantId}: ${(e as Error).message}`);
    throw new Error(`Stripe customer creation failed: ${(e as Error).message}`);
  }
}
