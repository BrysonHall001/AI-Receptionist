// Real-Prisma self-test for Batch C — the deleted-contacts read model now exposes
// deletedBy/deletedByType, which is what the read-only preview's
// "Moved to Recycle Bin on [date] by [user]" line reads.
//
//   npx tsx src/db/selfTest_deletedContactsExposeWho.ts   (needs dev Postgres + Batch A's migration)
//
// PROVES (through the REAL service/read-model + REAL Prisma):
//   * listDeletedContacts returns deletedAt + a ~30-day daysLeft countdown AND
//     deletedBy/deletedByType (captured from the actor in Batch A).
//   * A contact deleted with no actor comes back with deletedBy = NULL (the
//     date-only fallback the preview falls back to).
//   * Restoring removes it from the deleted read model.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_DELWHO__"), deleted at the end.

import { prisma, disconnectDb } from "./client";
import { listDeletedContacts } from "../services/readModels";
import { softDeleteContacts, restoreContacts } from "../services/contactService";

const db = prisma as any;
const T_NAME = "__SELFTEST_DELWHO__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

let n = 0;
const phone = () => `+1788${Date.now() % 100000}${n++}`;

async function main() {
  console.log("Deleted-contacts read model exposes deletedBy — real Prisma");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "delwho@example.invalid" } })).id;
    const byUser = await db.contact.create({ data: { tenantId: tId, name: "Deleted ByUser", phone: phone() } });
    const legacy = await db.contact.create({ data: { tenantId: tId, name: "Deleted Legacy", phone: phone() } });

    await softDeleteContacts(tId, [byUser.id], { id: "u1", name: "Tester", type: "user" });
    await softDeleteContacts(tId, [legacy.id]); // no actor -> legacy / date-only

    console.log("(Read model) deleted contacts carry deletedAt + daysLeft + who:");
    {
      const list = await listDeletedContacts(tId);
      const u = list.find((c: any) => c.id === byUser.id);
      const l = list.find((c: any) => c.id === legacy.id);
      check(!!u && u.deletedAt != null && u.daysLeft >= 29 && u.daysLeft <= 30, `user-deleted: deletedAt set + daysLeft ~30 (got ${u && u.daysLeft})`);
      check(!!u && u.deletedBy === "Tester" && u.deletedByType === "user", `user-deleted: deletedBy "Tester"/user exposed`);
      check(!!l && l.deletedBy === null && l.deletedByType === null, "legacy/no-actor: deletedBy NULL (date-only fallback)");
    }

    console.log("\n(Restore) restoring removes it from the deleted read model:");
    {
      await restoreContacts(tId, [byUser.id]);
      const ids = (await listDeletedContacts(tId)).map((c: any) => c.id);
      check(!ids.includes(byUser.id), "restored contact is GONE from the deleted list");
      check(ids.includes(legacy.id), "the other deleted contact remains");
    }
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { if (tId) await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  const after = await db.tenant.count();
  check(after === before, `real tenants unchanged (${before} -> ${after})`);

  console.log("\n=====================================================================");
  console.log("NOTE: the preview UI (read-only layout, Recycle-Bin-stays-highlighted,");
  console.log("Restore from the preview) is verified by you in the browser.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
