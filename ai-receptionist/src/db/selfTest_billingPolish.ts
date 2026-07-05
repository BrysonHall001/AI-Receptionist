// Self-test: approving a charge emails the portal's notifyEmail (mock mode), once, with link+note.
//   npx tsx src/db/selfTest_billingPolish.ts
import { prisma, disconnectDb } from "./client";
import { createCharge, approveCharge } from "../services/chargeService";
import { getChargeAudit } from "../services/billingAuditService";
import { updateBillingNotifyConfig } from "../services/billingNotifyConfigService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");

async function main() {
  console.log("billing polish (approve email)\n==============================");
  const ids: string[] = [];
  try {
    await updateBillingNotifyConfig({ enabled: true });
    const t = (await db.tenant.create({ data: { name: "Acme Corp", billingStatus: "paid", notifyEmail: "owner@acme.com" } })).id; ids.push(t);

    console.log("(1) approve -> emails tenant.notifyEmail once + audit:");
    const c = await createCharge(t, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 120, breakdown: {}, notes: "Thanks!", dueDate: D("2026-06-15"), status: "draft" });
    await db.charge.update({ where: { id: c.id }, data: { stripeInvoiceUrl: "https://pay.stripe.test/in_x" } });
    const before = await db.emailLog.count({ where: { type: "billing_approved" } }).catch(() => 0);
    await approveCharge(c.id, { id: null, name: "Op" });
    const after = await db.emailLog.count({ where: { type: "billing_approved" } }).catch(() => 0);
    check(after === before + 1, "one billing_approved email logged");
    const log = await db.emailLog.findFirst({ where: { type: "billing_approved", tenantId: t }, orderBy: { createdAt: "desc" } });
    check(!!log && log.toEmail === "owner@acme.com", "sent to the tenant's notifyEmail");
    check((await getChargeAudit(c.id)).some((a: any) => a.action === "approval_notified"), "approval_notified audited");

    console.log("\n(2) idempotent — re-approving an approved charge does NOT re-email:");
    let threw = false; try { await approveCharge(c.id, { id: null, name: "Op" }); } catch { threw = true; }
    check(threw, "re-approve rejected (only draft can be approved)");
    check((await db.emailLog.count({ where: { type: "billing_approved" } }).catch(() => 0)) === after, "no second email");

    console.log("\n(3) respects the notify on/off toggle:");
    await updateBillingNotifyConfig({ enabled: false });
    const c2 = await createCharge(t, { periodStart: D("2026-06-01"), periodEnd: D("2026-06-30"), amount: 50, breakdown: {}, status: "draft" });
    const pre = await db.emailLog.count({ where: { type: "billing_approved" } }).catch(() => 0);
    await approveCharge(c2.id, { id: null, name: "Op" });
    check((await db.emailLog.count({ where: { type: "billing_approved" } }).catch(() => 0)) === pre, "no email when notifications disabled");
    await updateBillingNotifyConfig({ enabled: true });

    console.log("\n(4) no notifyEmail -> no send, no crash:");
    const t2 = (await db.tenant.create({ data: { name: "Beta", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(t2);
    const c3 = await createCharge(t2, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 10, breakdown: {}, status: "draft" });
    const preB = await db.emailLog.count({ where: { type: "billing_approved" } }).catch(() => 0);
    const appr = await approveCharge(c3.id, { id: null, name: "Op" });
    check(appr.status === "approved", "approve still succeeds with no notifyEmail");
    check((await db.emailLog.count({ where: { type: "billing_approved" } }).catch(() => 0)) === preB, "no email sent when tenant has no notifyEmail");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    try { await updateBillingNotifyConfig({ enabled: true }); } catch {}
    for (const id of ids) {
      try { await db.emailLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.billingAuditLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { const cs = await db.charge.findMany({ where: { tenantId: id }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n==============================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (billing polish)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
