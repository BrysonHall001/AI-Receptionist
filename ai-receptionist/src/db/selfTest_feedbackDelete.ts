// Self-test (Batch 1) — DELETE resolved feedback tickets, REAL Prisma path.
//
//   npx tsx src/db/selfTest_feedbackDelete.ts
//
// WHAT THIS PROVES (real deleteFeedbackTicket + real Prisma, seeded throwaway data):
//   - OWNER and SUPER_ADMIN can delete a RESOLVED ticket (it's gone afterward).
//   - An OPEN ticket is NOT deletable (400) even for an owner.
//   - PORTAL_ADMIN / CLIENT_USER who can VIEW a ticket still cannot delete it (403).
//   - AUDITOR cannot delete a master ticket (403), but SUPER_ADMIN can (the
//     confirmed asymmetry: super-admins delete master tickets they can't resolve).
//   - Deleting a ticket cascade-deletes its messages.
//   - A missing ticket id → 404.
//   It does NOT prove the UI hides the button — verify that manually.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_FBDEL__"), deleted at the end (its
// user + tickets cascade away).

import { prisma, disconnectDb } from "./client";
import { deleteFeedbackTicket } from "../services/feedbackService";

const db = prisma as any;
const T = "__SELFTEST_FBDEL__";
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function expectStatus(fn: () => Promise<any>, status: number, label: string) {
  try { await fn(); check(false, `${label} (expected ${status}, but it succeeded)`); }
  catch (e: any) { check(e?.status === status, `${label} (got ${e?.status ?? "?"}: ${e?.message ?? e})`); }
}
async function expectOk(fn: () => Promise<any>, label: string) {
  try { const r = await fn(); check(!!r && r.ok === true, label); }
  catch (e: any) { check(false, `${label} (threw ${e?.status ?? "?"}: ${e?.message ?? e})`); }
}

async function main() {
  console.log("Batch 1 — feedback delete authorization (real path)");
  console.log("===================================================");

  let tId = "", uId = "";
  let n = 0;
  try {
    const t = await db.tenant.create({ data: { name: T, businessType: "salon", notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    const u = await db.user.create({ data: { email: `fbdel_${Date.now()}@example.invalid`, passwordHash: "x", role: "CLIENT_USER", tenantId: tId, name: "Submitter" } });
    uId = u.id;

    const mk = (status: string, tenantId: string | null) =>
      db.feedbackTicket.create({ data: { tenantId, createdById: uId, problem: "p" + ++n, description: "d", status, resolvedAt: status === "RESOLVED" ? new Date() : null } });
    const exists = async (id: string) => !!(await db.feedbackTicket.findUnique({ where: { id } }));
    const portal = (role: string, actorId: string) => ({ scope: "portal", tenantId: tId, actor: { id: actorId, role } }) as any;
    const master = (role: string, actorId: string) => ({ scope: "master", actor: { id: actorId, role } }) as any;
    const del = (id: string, ctx: any) => deleteFeedbackTicket(id, ctx);

    console.log("(1) an OPEN ticket is not deletable — even by an owner:");
    const open = await mk("OPEN", tId);
    await expectStatus(() => del(open.id, portal("OWNER", "owner1")), 400, "OPEN ticket rejected with 400");
    check(await exists(open.id), "the OPEN ticket is still there");

    console.log("(2) OWNER deletes a RESOLVED ticket:");
    const r1 = await mk("RESOLVED", tId);
    await expectOk(() => del(r1.id, portal("OWNER", "owner1")), "owner deletes a resolved ticket");
    check(!(await exists(r1.id)), "the ticket is gone");

    console.log("(3) SUPER_ADMIN deletes a RESOLVED ticket:");
    const r2 = await mk("RESOLVED", tId);
    await expectOk(() => del(r2.id, portal("SUPER_ADMIN", "sa1")), "super-admin deletes a resolved ticket");
    check(!(await exists(r2.id)), "the ticket is gone");

    console.log("(4) a PORTAL_ADMIN who can VIEW it still cannot delete it (403):");
    const r3 = await mk("RESOLVED", tId); // createdById = uId, so a PA acting as uId can view it
    await expectStatus(() => del(r3.id, portal("PORTAL_ADMIN", uId)), 403, "portal_admin rejected with 403");
    check(await exists(r3.id), "the ticket is untouched");

    console.log("(5) a CLIENT_USER cannot delete it either (403):");
    await expectStatus(() => del(r3.id, portal("CLIENT_USER", uId)), 403, "client_user rejected with 403");
    check(await exists(r3.id), "the ticket is still untouched");

    console.log("(6) AUDITOR cannot delete a master ticket (403); SUPER_ADMIN can:");
    const m1 = await mk("RESOLVED", null);
    await expectStatus(() => del(m1.id, master("AUDITOR", "aud1")), 403, "auditor rejected on a master ticket (403)");
    check(await exists(m1.id), "the master ticket is still there");
    await expectOk(() => del(m1.id, master("SUPER_ADMIN", "sa1")), "super-admin deletes the master ticket (asymmetry confirmed)");
    check(!(await exists(m1.id)), "the master ticket is gone");

    console.log("(7) deleting a ticket cascade-deletes its messages:");
    const r4 = await mk("RESOLVED", tId);
    const msg = await db.feedbackMessage.create({ data: { ticketId: r4.id, authorId: uId, body: "hi" } });
    await expectOk(() => del(r4.id, portal("OWNER", "owner1")), "owner deletes a resolved ticket that has a message");
    check(!(await db.feedbackMessage.findUnique({ where: { id: msg.id } })), "the message was cascade-deleted");

    console.log("(8) a missing ticket id → 404:");
    await expectStatus(() => del("nonexistent_id_xyz", portal("OWNER", "owner1")), 404, "missing ticket → 404");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    // master tickets (tenantId null) created by the throwaway user cascade when the user is gone;
    // the user is cascaded by the tenant delete. Sweep any stragglers by name just in case.
    try { await db.tenant.deleteMany({ where: { name: T } }); } catch {}
  }

  console.log("\n===================================================");
  console.log("Proves server-side delete authorization + resolved-only + cascade.");
  console.log("UI button visibility is a manual check.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
