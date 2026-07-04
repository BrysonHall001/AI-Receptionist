// Self-test: Stripe plumbing. Mocks the Stripe client — NEVER calls the live API.
//   npx tsx src/db/selfTest_stripePlumbing.ts
import { prisma, disconnectDb } from "./client";
import * as stripeSvc from "../services/stripeService";
import { ensureStripeCustomer } from "../services/stripeCustomerService";
import { getBillingConfig, updateBillingConfig } from "../services/billingConfigService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }

async function main() {
  console.log("stripe plumbing\n===============");
  const ids: string[] = [];
  try {
    const t = (await db.tenant.create({ data: { name: "Acme Corp", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(t);

    // (1) Unconfigured (no key): clear error, no crash.
    console.log("(1) unconfigured behavior:");
    check(stripeSvc.isStripeConfigured() === false, "isStripeConfigured() false when key unset");
    let msg = "";
    try { await ensureStripeCustomer(t); } catch (e) { msg = (e as Error).message; }
    check(/not configured/i.test(msg) && /STRIPE_SECRET_KEY/.test(msg), "ensureStripeCustomer throws clear 'not configured' error");
    const cfg0 = await getBillingConfig(t);
    check(cfg0.stripeConfigured === false && cfg0.stripeCustomerId === null, "getBillingConfig surfaces stripeConfigured=false + null customer");

    // (2) billingEmail on config (validated).
    console.log("\n(2) billing email:");
    await updateBillingConfig(t, { billingEmail: "pay@acme.com" });
    check((await getBillingConfig(t)).billingEmail === "pay@acme.com", "billingEmail saved + surfaced");
    let bad = false; try { await updateBillingConfig(t, { billingEmail: "notanemail" }); } catch { bad = true; }
    check(bad, "invalid billingEmail rejected");

    // (3) MOCK Stripe: create path + idempotency (never duplicates).
    console.log("\n(3) ensure-customer (mocked Stripe):");
    let createCalls = 0;
    const { env } = await import("../config/env");
    (env as any).STRIPE_SECRET_KEY = "sk_test_fake_selftest";
    stripeSvc.__setStripeClientForTest({ customers: { create: async (args: any) => { createCalls++; return { id: "cus_mock_" + createCalls, name: args.name, email: args.email }; } } });
    check(stripeSvc.isStripeConfigured() === true, "isStripeConfigured() true with a test key");

    const r1 = await ensureStripeCustomer(t);
    check(r1.created === true && r1.customerId === "cus_mock_1", "first call creates a customer");
    check(createCalls === 1, "Stripe create called exactly once");
    check((await db.tenant.findUnique({ where: { id: t }, select: { stripeCustomerId: true } })).stripeCustomerId === "cus_mock_1", "customer id stored on tenant");

    const r2 = await ensureStripeCustomer(t);
    check(r2.created === false && r2.customerId === "cus_mock_1", "second call returns existing id (idempotent)");
    check(createCalls === 1, "no duplicate Stripe customer created");

    const cfg1 = await getBillingConfig(t);
    check(cfg1.stripeConfigured === true && cfg1.stripeCustomerId === "cus_mock_1", "config now shows connected customer");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    for (const id of ids) {
      try { await db.billingAuditLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.billingConfig.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n===============");
  console.log(fails === 0 ? "ALL PASSED \u2705  (stripe plumbing)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
