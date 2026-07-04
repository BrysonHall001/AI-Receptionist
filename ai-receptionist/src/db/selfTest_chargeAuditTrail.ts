// Self-test: billing audit trail — every mutation writes a correct entry with actor + old→new.
//   npx tsx src/db/selfTest_chargeAuditTrail.ts
import { prisma, disconnectDb } from "./client";
import { createCharge, updateCharge, setChargeStatus, voidCharge, approveCharge, recordPayment } from "../services/chargeService";
import { updateBillingConfig } from "../services/billingConfigService";
import { getChargeAudit, getTermsAudit } from "../services/billingAuditService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");
const ALICE = { id: "u_alice", name: "Alice Admin" };

async function main() {
  console.log("charge audit trail\n==================");
  let tid = "";
  try {
    tid = (await db.tenant.create({ data: { name: "__AUDIT__", billingStatus: "paid", notifyEmail: "" } })).id;

    // create
    const c = await createCharge(tid, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 5, breakdown: {}, status: "draft" }, ALICE);
    let audit = await getChargeAudit(c.id);
    check(audit.length === 1 && audit[0].action === "charge_created" && audit[0].actorName === "Alice Admin", "createCharge -> charge_created by actor");

    // update amount + notes (2 changed fields -> 2 entries)
    await updateCharge(c.id, { amount: 6, notes: "hello" }, ALICE);
    audit = await getChargeAudit(c.id);
    const upd = audit.filter((a: any) => a.action === "charge_updated");
    check(upd.length === 2, "updateCharge -> one entry per changed field (2)");
    const amt = upd.find((a: any) => a.field === "amount");
    check(!!amt && amt.oldValue === "5" && amt.newValue === "6" && /\$5\.00 to \$6\.00/.test(amt.note), "amount change logs old→new readable money");

    // update with NO real change -> no new entry
    const beforeCount = (await getChargeAudit(c.id)).length;
    await updateCharge(c.id, { amount: 6 }, ALICE);
    check((await getChargeAudit(c.id)).length === beforeCount, "no-op update writes no audit entry");

    // approve
    await approveCharge(c.id, ALICE);
    audit = await getChargeAudit(c.id);
    check(audit.some((a: any) => a.action === "charge_approved" && a.oldValue === "draft" && a.newValue === "approved"), "approveCharge -> charge_approved draft→approved");

    // payment (partial) -> payment_recorded
    await recordPayment(c.id, { amount: 2, paidAt: D("2026-06-10"), method: "card" }, ALICE);
    audit = await getChargeAudit(c.id);
    check(audit.some((a: any) => a.action === "payment_recorded" && /\$2\.00/.test(a.note) && /card/.test(a.note)), "recordPayment -> payment_recorded with amount+method");

    // payment that clears balance -> payment_recorded + auto status_changed to paid
    await recordPayment(c.id, { amount: 4, paidAt: D("2026-06-12") }, ALICE);
    audit = await getChargeAudit(c.id);
    check(audit.some((a: any) => a.action === "status_changed" && a.newValue === "paid" && /Automatically marked paid/.test(a.note)), "auto-paid logs status_changed -> paid");

    // void
    await voidCharge(c.id, ALICE);
    audit = await getChargeAudit(c.id);
    check(audit.some((a: any) => a.action === "charge_voided"), "voidCharge -> charge_voided");

    // System actor (auto-draft style create with no actor)
    const c2 = await createCharge(tid, { periodStart: D("2026-06-01"), periodEnd: D("2026-06-30"), amount: 9, breakdown: {}, status: "draft" });
    const a2 = await getChargeAudit(c2.id);
    check(a2[0].actorName === "System", "createCharge without actor -> logged as System");

    // terms update -> one entry per changed term
    await updateBillingConfig(tid, { hasFlatFee: true, flatFeeAmount: 100 }, ALICE);
    let terms = await getTermsAudit(tid);
    check(terms.length >= 2 && terms.every((t: any) => t.action === "terms_updated" && t.chargeId === null), "updateBillingConfig -> terms_updated entries (chargeId null)");
    check(terms.some((t: any) => t.field === "flatFeeAmount" && /\$100\.00/.test(t.note)), "terms flat-fee amount old→new readable");
    // changing markup adds another; unchanged terms don't log
    const tc = terms.length;
    await updateBillingConfig(tid, { flatFeeAmount: 100 }, ALICE); // same value -> no entry
    check((await getTermsAudit(tid)).length === tc, "unchanged term writes no audit entry");

    // ordering: charge audit ascending, terms audit newest-first
    const ca = await getChargeAudit(c.id);
    check(new Date(ca[0].createdAt).getTime() <= new Date(ca[ca.length - 1].createdAt).getTime(), "charge audit is chronological (asc)");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    if (tid) {
      try { await db.billingAuditLog.deleteMany({ where: { tenantId: tid } }); } catch {}
      try { const cs = await db.charge.findMany({ where: { tenantId: tid }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: tid } }); } catch {}
      try { await db.billingConfig.deleteMany({ where: { tenantId: tid } }); } catch {}
      try { await db.tenant.delete({ where: { id: tid } }); } catch {}
    }
  }
  console.log("\n==================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (charge audit trail)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
