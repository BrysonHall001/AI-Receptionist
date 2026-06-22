// Real-Prisma self-test for Batch A — deletedBy / deletedByType capture.
//
//   npx tsx src/db/selfTest_deletedByCapture.ts   (needs dev Postgres + this batch's migration)
//
// PROVES (through the REAL service functions + REAL Prisma — the same path
// production uses, no raw driver):
//   * softDeleteContacts + softDeleteRecords persist deletedBy/deletedByType from
//     the actor:  human user -> their name + "user";  automation (AI receptionist)
//     -> "AI receptionist" + "ai";  calendar sync -> "Calendar sync" + "sync".
//   * deletedAt is still set (delete behavior otherwise unchanged).
//   * LEGACY / null-actor fallback: a delete with no usable actor leaves deletedBy
//     NULL without error (this is what pre-migration items look like -> date-only).
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_DELETEDBY__"), deleted at the end
// (records/contacts/record-types cascade with the tenant).

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { softDeleteContacts, mergeContacts } from "../services/contactService";
import { softDeleteRecords } from "../services/recordService";

const db = prisma as any;
const T_NAME = "__SELFTEST_DELETEDBY__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

let n = 0;
const phone = () => `+1777${Date.now() % 100000}${n++}`;
const mkContact = (tId: string, name: string) => db.contact.create({ data: { tenantId: tId, name, phone: phone() } });
const mkRecord = (tId: string, rtId: string, title: string) => db.record.create({ data: { tenantId: tId, recordTypeId: rtId, title } });
const contact = (id: string) => db.contact.findUnique({ where: { id } });
const record = (id: string) => db.record.findUnique({ where: { id } });

async function main() {
  console.log("deletedBy / deletedByType capture — real services + real Prisma");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "deletedby@example.invalid" } })).id;
    const rtId = await ensureBookingRecordType(tId);

    // ---- Human user -> their name + "user" ----
    console.log("(User) delete captures the user's name:");
    {
      const c = await mkContact(tId, "Contact A");
      const r = await mkRecord(tId, rtId, "Record A");
      await softDeleteContacts(tId, [c.id], { id: "u1", name: "Alice Admin", type: "user" });
      await softDeleteRecords(tId, [r.id], { id: "u1", name: "Alice Admin", type: "user" });
      const cc = await contact(c.id), rr = await record(r.id);
      check(cc.deletedAt != null && cc.deletedBy === "Alice Admin" && cc.deletedByType === "user", `contact -> deletedBy "Alice Admin"/user (deletedAt set)`);
      check(rr.deletedAt != null && rr.deletedBy === "Alice Admin" && rr.deletedByType === "user", `record  -> deletedBy "Alice Admin"/user (deletedAt set)`);
    }

    // ---- AI receptionist (automation actor) -> "AI receptionist" + "ai" ----
    console.log("\n(AI receptionist / automation) delete is labelled:");
    {
      const c = await mkContact(tId, "Contact B");
      const r = await mkRecord(tId, rtId, "Record B");
      await softDeleteContacts(tId, [c.id], { id: "auto1", name: "Welcome flow", type: "automation" });
      await softDeleteRecords(tId, [r.id], { id: "auto1", name: "Welcome flow", type: "automation" });
      const cc = await contact(c.id), rr = await record(r.id);
      check(cc.deletedBy === "AI receptionist" && cc.deletedByType === "ai", `contact -> "AI receptionist"/ai`);
      check(rr.deletedBy === "AI receptionist" && rr.deletedByType === "ai", `record  -> "AI receptionist"/ai`);
    }

    // ---- Calendar sync -> "Calendar sync" + "sync" (records only) ----
    console.log("\n(Calendar sync) record delete is labelled:");
    {
      const r = await mkRecord(tId, rtId, "Record C");
      await softDeleteRecords(tId, [r.id], { type: "sync" });
      const rr = await record(r.id);
      check(rr.deletedBy === "Calendar sync" && rr.deletedByType === "sync", `record  -> "Calendar sync"/sync`);
    }

    // ---- Merge: losers go to the bin attributed to the merging user ----
    console.log("\n(Merge) merged-away contacts are attributed to the user:");
    {
      const survivor = await mkContact(tId, "Survivor");
      const loser = await mkContact(tId, "Loser");
      await mergeContacts(tId, survivor.id, [loser.id], {}, { id: "u2", name: "Bob Boss", type: "user" });
      const ll = await contact(loser.id);
      check(ll.deletedAt != null && ll.deletedBy === "Bob Boss" && ll.deletedByType === "user", `merged loser -> "Bob Boss"/user`);
    }

    // ---- LEGACY / null-actor fallback: deletedBy stays NULL, no error ----
    console.log("\n(Legacy / no actor) deletedBy stays NULL (date-only fallback), no error:");
    {
      const c = await mkContact(tId, "Contact D");
      const r = await mkRecord(tId, rtId, "Record D");
      await softDeleteContacts(tId, [c.id]);                 // no actor at all
      await softDeleteRecords(tId, [r.id], {} as any);        // typeless actor
      const cc = await contact(c.id), rr = await record(r.id);
      check(cc.deletedAt != null && cc.deletedBy === null && cc.deletedByType === null, "contact -> deletedAt set, deletedBy NULL, deletedByType NULL");
      check(rr.deletedAt != null && rr.deletedBy === null && rr.deletedByType === null, "record  -> deletedAt set, deletedBy NULL, deletedByType NULL");
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
  console.log("NOTE: backend-only + dormant — nothing in the UI changes this batch.");
  console.log("Items deleted BEFORE the migration keep deletedBy = NULL (expected).");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
