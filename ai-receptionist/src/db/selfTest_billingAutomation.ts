// Self-test — billing automation (auto-draft, approval emails, approve flow).
//   npx tsx src/db/selfTest_billingAutomation.ts
import { prisma, disconnectDb } from "./client";
import { currentPeriod, withinContract } from "../services/billingPeriodService";
import { updateBillingConfig } from "../services/billingConfigService";
import { updateBillingRates } from "../services/billingRateService";
import { updateBillingNotifyConfig } from "../services/billingNotifyConfigService";
import { autoDraftCharges } from "../services/billingAutoDraftService";
import { sendApprovalReminders } from "../services/billingNotifyService";
import { approveCharge, getCharge, listCharges } from "../services/chargeService";
import { readFileSync } from "fs";
import { resolve } from "path";

const db = prisma as any;
const fails: string[] = [];
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails.push(l); }
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function mkTenant(name: string) { const t = await db.tenant.create({ data: { name, billingStatus: "paid", notifyEmail: "" } }); return t.id as string; }

async function main() {
  console.log("Billing automation\n==================");
  (require("../config/env").env as any).EMAIL_PROVIDER = "mock";
  process.env.EMAIL_PROVIDER = "mock";

  // (1) period math — pure.
  console.log("(1) period math:");
  const jun = new Date(Date.UTC(2026, 5, 15));
  const mo = currentPeriod({ billingPeriod: "monthly" }, jun);
  check(ymd(mo.periodStart) === "2026-06-01" && ymd(mo.periodEnd) === "2026-06-30", "monthly = calendar month (Jun 1 – Jun 30)");
  const an = currentPeriod({ billingPeriod: "annual", contractStart: new Date(Date.UTC(2025, 2, 10)) }, jun);
  check(ymd(an.periodStart) === "2026-03-10" && ymd(an.periodEnd) === "2027-03-09", "annual anchored on contractStart anniversary (Mar 10)");
  const anCal = currentPeriod({ billingPeriod: "annual" }, jun);
  check(ymd(anCal.periodStart) === "2026-01-01" && ymd(anCal.periodEnd) === "2026-12-31", "annual w/o contract = calendar year");
  const cu = currentPeriod({ billingPeriod: "custom", customPeriodDays: 30, contractStart: new Date(Date.UTC(2026, 0, 1)) }, new Date(Date.UTC(2026, 0, 20)));
  check(ymd(cu.periodStart) === "2026-01-01" && ymd(cu.periodEnd) === "2026-01-30", "custom 30d anchored on contractStart (Jan 1 – Jan 30)");
  check(withinContract({ contractStart: new Date(Date.UTC(2026, 0, 1)), contractEnd: new Date(Date.UTC(2026, 11, 31)) }, jun) === true && withinContract({ contractEnd: new Date(Date.UTC(2026, 0, 1)) }, jun) === false, "withinContract respects start/end bounds");

  const tenantIds: string[] = [];
  try {
    await updateBillingRates({ twilioPerCallMinute: 0.02, openAiInputPer1kTokens: 0, openAiOutputPer1kTokens: 0, twilioPerSms: 0, twilioPerNumberMonthly: 0 });
    await updateBillingNotifyConfig({ enabled: true, recipients: ["owner@test.com"], leadDays: 7, cadence: "once" });

    const now = new Date(Date.UTC(2026, 5, 28, 12, 0, 0)); // Jun 28 — within 7d of Jun 30

    // A: billable + within contract + within lead window -> should draft.
    const A = await mkTenant("__AUTO_A__"); tenantIds.push(A);
    await updateBillingConfig(A, { hasFlatFee: true, flatFeeAmount: 100, billingPeriod: "monthly" });
    // B: no billable component -> skip.
    const B = await mkTenant("__AUTO_B__"); tenantIds.push(B);
    await updateBillingConfig(B, { hasFlatFee: false, hasPassthrough: false, billingPeriod: "monthly" });
    // C: contract ended -> skip.
    const C = await mkTenant("__AUTO_C__"); tenantIds.push(C);
    await updateBillingConfig(C, { hasFlatFee: true, flatFeeAmount: 50, billingPeriod: "monthly", contractEnd: "2026-01-01" });
    // D: billable but its period end is far off (not within lead window) -> skip.
    const D = await mkTenant("__AUTO_D__"); tenantIds.push(D);
    await updateBillingConfig(D, { hasFlatFee: true, flatFeeAmount: 50, billingPeriod: "custom", customPeriodDays: 90, contractStart: "2026-06-01" });

    // (2) auto-draft.
    console.log("\n(2) auto-draft job:");
    await autoDraftCharges(now);
    const la = await listCharges(A), lb = await listCharges(B), lc = await listCharges(C), ld = await listCharges(D);
    check(la.charges.length === 1 && la.charges[0].status === "draft" && Math.abs(la.charges[0].amount - 100) < 0.01, "A: draft created for the period (flat $100)");
    check(la.charges[0].notes === "Auto-drafted" && ymd(new Date(la.charges[0].periodStart)) === "2026-06-01", "A: draft is auto-drafted for June, dueDate set");
    check(lb.charges.length === 0, "B: no draft (no flat fee / passthrough)");
    check(lc.charges.length === 0, "C: no draft (outside contract window)");
    check(ld.charges.length === 0, "D: no draft when period end is outside the lead window");

    // Idempotency: repeated runs don't duplicate A's draft.
    await autoDraftCharges(now); await autoDraftCharges(now);
    check((await listCharges(A)).charges.length === 1, "idempotent: repeated runs create no duplicate draft for A");

    // (3) approval emails.
    console.log("\n(3) approval reminders (mock email -> EmailLog):");
    const before = await db.emailLog.count({ where: { type: "billing_approval" } });
    const r1 = await sendApprovalReminders(now);
    const after1 = await db.emailLog.count({ where: { type: "billing_approval" } });
    check(r1.sent >= 1 && after1 - before === r1.sent, "reminder sent for A's due-soon draft + logged in EmailLog");
    const chgA = (await listCharges(A)).charges[0];
    check(chgA.status === "draft", "charge still draft after reminder");
    // once cadence -> second run sends nothing more.
    const r2 = await sendApprovalReminders(now);
    check(r2.sent === 0, "cadence 'once': no repeat send");

    // daily_until_approved: sends again only after 24h.
    await updateBillingNotifyConfig({ cadence: "daily_until_approved" });
    const rSame = await sendApprovalReminders(now);
    check(rSame.sent === 0, "daily cadence: no resend within 24h of last reminder");
    // Backdate the last reminder >24h and resend.
    await db.charge.update({ where: { id: chgA.id }, data: { reminderSentAt: new Date(now.getTime() - 25 * 3600 * 1000) } });
    const rNext = await sendApprovalReminders(now);
    check(rNext.sent === 1, "daily cadence: resends after 24h until approved");

    // disabled -> nothing sends.
    await updateBillingNotifyConfig({ enabled: false });
    const rOff = await sendApprovalReminders(now);
    check(rOff.disabled === true && rOff.sent === 0, "disabled: no reminders sent");
    await updateBillingNotifyConfig({ enabled: true, cadence: "once" });

    // (4) approve flow.
    console.log("\n(4) approve flow:");
    const approved = await approveCharge(chgA.id);
    check(approved.status === "approved" && !!approved.approvedAt && approved.isPaid === false, "approve: draft -> approved + approvedAt, unpaid until paid");
    let threw = false; try { await approveCharge(chgA.id); } catch { threw = true; }
    check(threw, "cannot approve a non-draft charge again");
    // Approved charge is no longer a reminder candidate.
    const rAfterApprove = await sendApprovalReminders(now);
    const chgAfter = await getCharge(chgA.id);
    check(rAfterApprove.sent === 0 && chgAfter!.status === "approved", "approving stops further reminders");
  } catch (e) {
    console.log("   (DB section error: " + (e as Error).message + ")");
    fails.push("DB error: " + (e as Error).message);
  } finally {
    for (const id of tenantIds) {
      try { const cs = await db.charge.findMany({ where: { tenantId: id }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.billingConfig.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }

  // (5) structural wiring.
  console.log("\n(5) structural wiring:");
  const admin = readFileSync(resolve(__dirname, "../routes/admin.ts"), "utf8");
  for (const p of ["/charges/:id/approve", "/billing-notify-config", "/billing/run-sweep"]) {
    check(admin.includes(p) && admin.includes('requireRole("OWNER", "SUPER_ADMIN")'), `endpoint ${p} present + OWNER/SUPER_ADMIN-gated`);
  }
  const idx = readFileSync(resolve(__dirname, "../index.ts"), "utf8");
  check(idx.includes("runBillingAutomationSweep()") && idx.includes("billingSweepTimer"), "billing sweep wired into the scheduler (startup + interval)");
  const mig = readFileSync(resolve(__dirname, "../../prisma/migrations/20260703140000_billing_automation/migration.sql"), "utf8");
  check(mig.includes('"reminderSentAt"') && mig.includes('"reminderCount"') && mig.includes('"BillingNotifyConfig"'), "migration adds reminder columns + BillingNotifyConfig");

  console.log("\n==================");
  if (fails.length === 0) console.log("ALL CHECKS PASSED \u2705  (billing automation)");
  else { console.log(`${fails.length} CHECK(S) FAILED \u274c`); fails.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(fails.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
