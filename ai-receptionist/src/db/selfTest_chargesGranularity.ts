// Self-test: charges ledger enrichment — createdAt/approvedAt/paidAt + payments[].
//   npx tsx src/db/selfTest_chargesGranularity.ts
import { prisma, disconnectDb } from "./client";
import { listCharges, recordPayment, approveCharge, createCharge } from "../services/chargeService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");

async function main() {
  console.log("charges granularity\n===================");
  let tid = "";
  try {
    tid = (await db.tenant.create({ data: { name: "__CG__", billingStatus: "paid", notifyEmail: "" } })).id;

    // Charge 1: create -> approve -> two partial payments that clear the balance.
    const c1 = await createCharge(tid, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 100, breakdown: {}, dueDate: D("2026-06-05"), status: "draft" });
    await approveCharge(c1.id);
    await recordPayment(c1.id, { amount: 40, paidAt: D("2026-06-10") });
    await recordPayment(c1.id, { amount: 60, paidAt: D("2026-06-20") }); // clears balance here

    // Charge 2: draft, no payments.
    await createCharge(tid, { periodStart: D("2026-06-01"), periodEnd: D("2026-06-30"), amount: 50, breakdown: {}, status: "draft" });

    const ledger = await listCharges(tid);
    const one = ledger.charges.find((c: any) => c.amount === 100);
    const two = ledger.charges.find((c: any) => c.amount === 50);

    console.log("(1) enriched fields present:");
    check(!!one.createdAt, "createdAt present");
    check(!!one.approvedAt, "approvedAt present (approved charge)");
    check(Array.isArray(one.payments) && one.payments.length === 2, "payments[] returned (2)");
    check(one.payments[0].method !== undefined && one.payments[0].paidAt !== undefined, "payments carry paidAt/method/notes fields");

    console.log("\n(2) paidAt = when balance cleared:");
    check(String(one.paidAt).slice(0,10) === "2026-06-20", "paidAt is the clearing payment's date (2nd payment)");
    check(one.isPaid === true && one.outstanding === 0, "fully-paid charge: isPaid + zero outstanding");

    console.log("\n(3) unpaid/draft charge:");
    check(two.paidAt === null, "no paidAt when never fully paid");
    check(two.approvedAt === null && two.isPaid === false, "draft has no approvedAt and isn't paid");

    console.log("\n(4) partial payment does not set paidAt:");
    const c3 = await createCharge(tid, { periodStart: D("2026-04-01"), periodEnd: D("2026-04-30"), amount: 200, breakdown: {}, status: "approved" });
    await recordPayment(c3.id, { amount: 50, paidAt: D("2026-05-02") });
    const l2 = await listCharges(tid);
    const three = l2.charges.find((c: any) => c.amount === 200);
    check(three.paidAt === null && three.outstanding === 150, "partial payment: paidAt null, outstanding 150");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    if (tid) {
      try { const cs = await db.charge.findMany({ where: { tenantId: tid }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: tid } }); } catch {}
      try { await db.tenant.delete({ where: { id: tid } }); } catch {}
    }
  }
  console.log("\n===================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (charges granularity)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
