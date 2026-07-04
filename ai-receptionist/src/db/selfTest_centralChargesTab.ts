// Self-test: all-charges endpoint data + password-confirm mechanism for approve.
//   npx tsx src/db/selfTest_centralChargesTab.ts
import { prisma, disconnectDb } from "./client";
import { listAllCharges, createCharge, approveCharge } from "../services/chargeService";
import { hashPassword, verifyPassword } from "../auth/passwords";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");

async function main() {
  console.log("central charges tab\n===================");
  const ids: string[] = []; let uid = "";
  try {
    const a = (await db.tenant.create({ data: { name: "Acme Corp", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(a);
    const b = (await db.tenant.create({ data: { name: "Beta LLC", billingStatus: "trial", notifyEmail: "" } })).id; ids.push(b);
    await createCharge(a, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 100, breakdown: {}, status: "draft" });
    await createCharge(b, { periodStart: D("2026-06-01"), periodEnd: D("2026-06-30"), amount: 50, breakdown: {}, status: "approved" });

    console.log("(1) all-charges across tenants:");
    const all = await listAllCharges();
    const mine = all.charges.filter((c: any) => ids.includes(c.tenantId));
    check(mine.length === 2, "returns charges from multiple tenants");
    check(mine.some((c: any) => c.tenant === "Acme Corp") && mine.some((c: any) => c.tenant === "Beta LLC"), "each row carries its tenant NAME");
    const one = mine[0];
    check(["id", "tenant", "periodStart", "periodEnd", "amount", "currency", "status", "paidTotal", "outstanding", "dueDate", "createdAt", "approvedAt", "paidAt"].every((k) => k in one), "row has the full field set the table needs");
    check(new Date(all.charges[0].createdAt) >= new Date(all.charges[all.charges.length - 1].createdAt), "newest-first ordering");
    const capped = await listAllCharges(1);
    check(capped.charges.length === 1, "limit/cap respected");

    console.log("\n(2) password-confirm mechanism (used by the approve gate):");
    const hash = await hashPassword("s3cret!");
    const u = await db.user.create({ data: { email: "audit_pw@test.local", name: "PW User", role: "OWNER", passwordHash: hash } });
    uid = u.id;
    const fresh = await db.user.findUnique({ where: { id: uid }, select: { passwordHash: true } });
    check(await verifyPassword("s3cret!", fresh.passwordHash) === true, "correct password verifies");
    check(await verifyPassword("wrong", fresh.passwordHash) === false, "wrong password rejected");

    console.log("\n(3) approve still works at the service layer (route adds the gate):");
    const c = await createCharge(a, { periodStart: D("2026-07-01"), periodEnd: D("2026-07-31"), amount: 10, breakdown: {}, status: "draft" });
    const approved = await approveCharge(c.id, { id: uid, name: "PW User" });
    check(approved.status === "approved", "approveCharge finalizes a draft");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    try { if (uid) await db.user.delete({ where: { id: uid } }); } catch {}
    for (const id of ids) {
      try { await db.billingAuditLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { const cs = await db.charge.findMany({ where: { tenantId: id }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n===================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (central charges tab)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
