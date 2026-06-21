// Real-Prisma self-test for Sub-batch C (server-side ownership guards).
//
//   npx tsx src/db/selfTest_externalOwnershipGuard.ts   (needs dev Postgres + B's migration)
//
// PROVES (server-side, via recordService — NOT the UI):
//   - user / automation / system actors CANNOT edit a Google-owned booking;
//   - user actor CANNOT delete a Google-owned booking;
//   - the SYNC actor CAN edit and delete Google-owned bookings;
//   - user actor CAN edit + delete Clarity-native bookings (unchanged);
//   - bulk-update is guarded too (a batch touching a Google-owned row is rejected
//     whole — not partially applied) and allowed for sync / native-only;
//   - native booking create/edit/delete behavior is unchanged.
//
// SAFETY: one TEMPORARY tenant (+ resource), deleted at the end (cascade).

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType, resolveRecordTypeId, BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { createRecord, updateRecord, softDeleteRecords, bulkUpdateRecordField } from "../services/recordService";

const db = prisma as any;
const T_NAME = "__SELFTEST_OWNGUARD__";
const DATE = "2026-09-20";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
async function rejectedReadonly(fn: () => Promise<any>): Promise<boolean> {
  try { await fn(); return false; } catch (e: any) { return e?.code === "external_readonly"; }
}
async function succeeds(fn: () => Promise<any>): Promise<boolean> {
  try { await fn(); return true; } catch { return false; }
}
const Z = (wall: string) => new Date(`${wall}:00Z`);

async function main() {
  console.log("Ownership guards (Google-owned read-only) — real-Prisma self-test");
  console.log("================================================================\n");

  const before = { tenants: await db.tenant.count() };
  let tId = "", rId = "", rtId = "";
  try {
    const t = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    rId = (await db.resource.create({ data: { tenantId: tId, name: "Stylist A" } })).id;
    rtId = await ensureBookingRecordType(tId);

    const mkGoogle = (evt: string, wall: string, title: string) => db.record.create({ data: {
      tenantId: tId, recordTypeId: rtId, title, subtypeKey: "consultation", stageKey: "confirmed",
      appointmentAt: Z(`${DATE}T${wall}`), endAt: Z(`${DATE}T${wall.slice(0,2)}:30`), resourceId: rId,
      externalSource: "google", externalEventId: evt, externalCalendarId: "calA",
    }});
    const g1 = await mkGoogle("evt1", "12:00", "G1");
    const g2 = await mkGoogle("evt2", "14:00", "G2");
    // Native bookings via the real create path.
    const n1 = await createRecord(tId, BOOKING_RECORD_TYPE_KEY, { subtypeKey: "consultation", appointmentAt: `${DATE}T09:00:00Z`, resourceId: rId, allowClosed: true }, { source: "manual" });
    const n2 = await createRecord(tId, BOOKING_RECORD_TYPE_KEY, { subtypeKey: "consultation", appointmentAt: `${DATE}T10:00:00Z`, resourceId: rId, allowClosed: true }, { source: "manual" });

    // (1) Google-owned is read-only for user / automation / system -----------------
    console.log("(1) Google-owned booking can't be EDITED by user/automation/system:");
    check(await rejectedReadonly(() => updateRecord(tId, g1.id, { title: "hack" }, { type: "user" })), "user edit rejected (external_readonly)");
    check(await rejectedReadonly(() => updateRecord(tId, g1.id, { title: "hack" }, { type: "automation" })), "automation edit rejected");
    check(await rejectedReadonly(() => updateRecord(tId, g1.id, { title: "hack" }, { type: "system" })), "system edit rejected");
    const g1now = await db.record.findUnique({ where: { id: g1.id } });
    check(g1now.title === "G1", "title unchanged after the rejected edits");

    // (2) Google-owned can't be DELETED by a user --------------------------------
    console.log("\n(2) Google-owned booking can't be DELETED by a user:");
    check(await rejectedReadonly(() => softDeleteRecords(tId, [g2.id], { type: "user" })), "user delete rejected (external_readonly)");
    const g2still = await db.record.findUnique({ where: { id: g2.id } });
    check(!!g2still && g2still.deletedAt === null, "Google-owned booking still present after rejected delete");

    // (3) The SYNC actor MAY edit and delete Google-owned -------------------------
    console.log("\n(3) the sync actor MAY edit and delete Google-owned bookings:");
    check(await succeeds(() => updateRecord(tId, g1.id, { title: "Synced Title" }, { type: "sync" })), "sync edit allowed");
    const g1synced = await db.record.findUnique({ where: { id: g1.id } });
    check(g1synced.title === "Synced Title" && g1synced.externalSource === "google", "sync edit applied; still Google-owned");
    const delCount = await softDeleteRecords(tId, [g2.id], { type: "sync" });
    check(delCount === 1, "sync delete allowed (count 1)");
    const g2del = await db.record.findUnique({ where: { id: g2.id } });
    check(!!g2del && g2del.deletedAt !== null, "Google-owned booking soft-deleted by sync");

    // (4) Clarity-native is fully editable/deletable by a user (unchanged) --------
    console.log("\n(4) Clarity-native bookings behave exactly as today:");
    check(await succeeds(() => updateRecord(tId, n1.id, { title: "User Edit" }, { type: "user" })), "user edit of native booking allowed");
    const n1ed = await db.record.findUnique({ where: { id: n1.id } });
    check(n1ed.title === "User Edit", "native edit applied");
    check((await softDeleteRecords(tId, [n2.id], { type: "user" })) === 1, "user delete of native booking allowed");

    // (5) bulk-update is guarded too (whole-batch reject, not partial) ------------
    console.log("\n(5) bulk-update path is guarded:");
    check(await rejectedReadonly(() => bulkUpdateRecordField(tId, [g1.id, n1.id], "title", "BULK", { type: "user" })), "user bulk-edit touching a Google-owned row is rejected");
    const n1after = await db.record.findUnique({ where: { id: n1.id } });
    check(n1after.title === "User Edit", "native row in the rejected batch was NOT changed (no partial apply)");
    check((await bulkUpdateRecordField(tId, [g1.id], "stageKey", "completed", { type: "sync" })) === 1, "sync bulk-edit of Google-owned allowed");
    check((await bulkUpdateRecordField(tId, [n1.id], "title", "Bulk Native", { type: "user" })) === 1, "user bulk-edit of native-only allowed");

    // (6) native create still works (guard didn't disturb the create path) -------
    console.log("\n(6) native booking create is unchanged + serialization exposes ownership:");
    const fresh = await createRecord(tId, BOOKING_RECORD_TYPE_KEY, { subtypeKey: "consultation", appointmentAt: `${DATE}T11:00:00Z`, resourceId: rId, allowClosed: true }, { source: "manual" });
    check(!!fresh && fresh.id != null, "a fresh native booking creates normally");
    check(!!fresh && fresh.externalSource === null && "endAt" in fresh, "serialized record exposes externalSource (null for native) so the UI can detect read-only");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenant\u2026");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", tId, e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\nVerifying real data untouched:");
  const after = { tenants: await db.tenant.count() };
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);

  console.log("\n================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
