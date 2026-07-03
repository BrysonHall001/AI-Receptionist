// Self-test — billing ledger foundation (config, compute helper, charges, payments).
//   npx tsx src/db/selfTest_billingLedgerFoundation.ts
import { prisma, disconnectDb } from "./client";
import { getBillingConfig, updateBillingConfig } from "../services/billingConfigService";
import { computeSuggestedCharge } from "../services/chargeComputeService";
import { createCharge, listCharges, getCharge, updateCharge, setChargeStatus, voidCharge, recordPayment } from "../services/chargeService";
import { updateBillingRates } from "../services/billingRateService";
import { readFileSync } from "fs";
import { resolve } from "path";

const db = prisma as any;
const fails: string[] = [];
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails.push(l); }
const approx = (a: number, b: number, e = 0.005) => Math.abs(a - b) <= e;

async function main() {
  console.log("Billing ledger foundation\n=========================");
  (require("../config/env").env as any).EMAIL_PROVIDER = "mock";

  let tId: string | null = null;
  const chargeIds: string[] = [];
  try {
    // Known rates: only call minutes cost anything, so a period's usage cost is predictable.
    await updateBillingRates({ twilioPerCallMinute: 0.02, openAiInputPer1kTokens: 0, openAiOutputPer1kTokens: 0, twilioPerSms: 0, twilioPerNumberMonthly: 0 });

    const t = await db.tenant.create({ data: { name: "__LEDGER_TEST__", billingStatus: "paid", notifyEmail: "" } });
    tId = t.id;
    const T: string = t.id;

    // (1) BillingConfig: seed-on-read defaults, then edit.
    console.log("(1) billing config:");
    const seeded = await getBillingConfig(T);
    check(seeded.hasFlatFee === false && seeded.hasPassthrough === false && seeded.flatFeeAmount === 0 && seeded.billingPeriod === "monthly" && seeded.currency === "USD", "config seeds all-off / zero / monthly / USD");
    const upd = await updateBillingConfig(T, { hasFlatFee: true, flatFeeAmount: 100, hasPassthrough: true, passthroughMarkupPct: 20, billingPeriod: "custom", customPeriodDays: 30, currency: "usd" });
    check(upd.hasFlatFee && upd.flatFeeAmount === 100 && upd.hasPassthrough && upd.passthroughMarkupPct === 20 && upd.billingPeriod === "custom" && upd.customPeriodDays === 30 && upd.currency === "USD", "config edit persists (flat+passthrough, custom period, currency normalized)");
    let threw = false; try { await updateBillingConfig(T, { flatFeeAmount: -5 }); } catch { threw = true; }
    check(threw, "negative flatFeeAmount rejected");

    // Seed a period's usage: 3000 call-seconds (=50 min) -> callCost 50*0.02 = $1.00 usage cost.
    const day = new Date(Date.UTC(2026, 5, 15));
    await db.usageDaily.upsert({
      where: { tenantId_date: { tenantId: T, date: day } },
      update: { calls: 10, callSeconds: 3000, promptTokens: 0, completionTokens: 0, totalTokens: 0, emails: 4, sms: 0 },
      create: { tenantId: T, date: day, calls: 10, callSeconds: 3000, promptTokens: 0, completionTokens: 0, totalTokens: 0, emails: 4, sms: 0 },
    });

    // (2) Compute helper: amount = flat + passthroughBase*(1+markup/100) = 100 + 1.00*1.2 = 101.20.
    console.log("\n(2) suggested-charge computation:");
    const pStart = new Date(Date.UTC(2026, 5, 1)), pEnd = new Date(Date.UTC(2026, 5, 30, 23, 59, 59));
    const sug = await computeSuggestedCharge(T, pStart, pEnd);
    check(approx(sug.breakdown.passthroughBaseCost, 1.0), "passthrough base = period usage cost ($1.00)");
    check(sug.breakdown.markupPct === 20 && approx(sug.breakdown.passthroughAmount, 1.2), "passthrough amount = base*(1+20%) = $1.20");
    check(approx(sug.breakdown.flatFee, 100), "flat fee = $100");
    check(approx(sug.amount, 101.2), "suggested amount = flat + passthrough = $101.20");
    check(sug.breakdown.usageSnapshot.minutes === 50 && sug.breakdown.usageSnapshot.calls === 10 && sug.breakdown.usageSnapshot.emails === 4, "usage snapshot: 50 min / 10 calls / 4 emails");

    // Passthrough OFF -> only the flat fee.
    await updateBillingConfig(T, { hasPassthrough: false });
    const sug2 = await computeSuggestedCharge(T, pStart, pEnd);
    check(approx(sug2.amount, 100) && sug2.breakdown.passthroughAmount === 0, "passthrough off -> amount is flat fee only ($100)");
    await updateBillingConfig(T, { hasPassthrough: true });

    // (3) Charge CRUD + ledger totals.
    console.log("\n(3) charges + ledger totals:");
    const c1 = await createCharge(T, { periodStart: pStart, periodEnd: pEnd, amount: sug.amount, breakdown: sug.breakdown, currency: sug.currency, dueDate: pEnd, notes: "June" });
    chargeIds.push(c1.id);
    check(c1.status === "draft" && approx(c1.amount, 101.2) && c1.isPaid === false && approx(c1.outstanding, 101.2), "charge created as draft, outstanding = amount");
    const edited = await updateCharge(c1.id, { amount: 90, notes: "adjusted" });
    check(approx(edited.amount, 90) && edited.notes === "adjusted", "charge edited (amount adjustable before payment)");
    const approved = await setChargeStatus(c1.id, "approved");
    check(approved.status === "approved" && !!approved.approvedAt, "status -> approved stamps approvedAt");

    // (4) Payments -> paid/unpaid derivation.
    console.log("\n(4) payments + paid/unpaid derivation:");
    const afterPartial = await recordPayment(c1.id, { amount: 40, method: "check" });
    check(afterPartial!.paidTotal === 40 && approx(afterPartial!.outstanding, 50) && afterPartial!.isPaid === false && afterPartial!.status === "approved", "partial payment: outstanding 50, not yet paid");
    const afterFull = await recordPayment(c1.id, { amount: 50 });
    check(afterFull!.paidTotal === 90 && afterFull!.outstanding === 0 && afterFull!.isPaid === true && afterFull!.status === "paid", "covering payment: outstanding 0, auto-flips to paid");

    // A second charge, then void it -> excluded from billed + outstanding.
    const c2 = await createCharge(T, { periodStart: pStart, periodEnd: pEnd, amount: 25 });
    chargeIds.push(c2.id);
    const voided = await voidCharge(c2.id);
    check(voided.status === "void" && voided.outstanding === 0 && voided.isPaid === false, "void charge: not paid, not outstanding");

    const ledger = await listCharges(T);
    check(approx(ledger.totals.billed, 90) && approx(ledger.totals.paid, 90) && approx(ledger.totals.outstanding, 0), "ledger totals exclude void (billed 90 / paid 90 / outstanding 0)");
    const one = await getCharge(c1.id);
    check(!!one && one!.payments.length === 2, "getCharge returns the charge with its 2 payments");
  } catch (e) {
    console.log("   (DB section error: " + (e as Error).message + ")");
    fails.push("DB error: " + (e as Error).message);
  } finally {
    for (const id of chargeIds) { try { await db.payment.deleteMany({ where: { chargeId: id } }); await db.charge.delete({ where: { id } }); } catch {} }
    if (tId) { try { await db.usageDaily.deleteMany({ where: { tenantId: tId } }); } catch {}; try { await db.billingConfig.deleteMany({ where: { tenantId: tId } }); } catch {}; try { await db.tenant.delete({ where: { id: tId } }); } catch {} }
  }

  // (5) structural wiring.
  console.log("\n(5) structural wiring:");
  const schema = readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
  check(/model BillingConfig[\s\S]*tenantId\s+String\s+@unique/.test(schema), "BillingConfig has unique tenantId");
  check(/model Charge[\s\S]*@@index\(\[tenantId, periodStart\]\)/.test(schema), "Charge indexed on [tenantId, periodStart]");
  check(/model Payment[\s\S]*chargeId\s+String/.test(schema), "Payment links to a charge");
  const mig = readFileSync(resolve(__dirname, "../../prisma/migrations/20260703120000_billing_ledger/migration.sql"), "utf8");
  check(mig.includes('INSERT INTO "BillingConfig"') && mig.includes("NOT EXISTS"), "migration backfills a BillingConfig per existing tenant");
  const admin = readFileSync(resolve(__dirname, "../routes/admin.ts"), "utf8");
  for (const [p, label] of [["/billing-config/:tenantId", "billing-config"], ["/charges/tenant/:tenantId", "charges list/create"], ["/charges/suggest/:tenantId", "suggest amount"], ["/charges/:id/payments", "record payment"], ["/charges/:id/status", "set status"]]) {
    check(admin.includes(p) && new RegExp(p.replace(/[/:]/g, "\\$&") + '"[^\\n]*requireRole\\("OWNER", "SUPER_ADMIN"\\)').test(admin) || (admin.includes(p) && admin.includes('requireRole("OWNER", "SUPER_ADMIN")')), `endpoint ${label} is OWNER/SUPER_ADMIN-gated`);
  }

  console.log("\n=========================");
  if (fails.length === 0) console.log("ALL CHECKS PASSED \u2705  (billing ledger foundation)");
  else { console.log(`${fails.length} CHECK(S) FAILED \u274c`); fails.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(fails.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
