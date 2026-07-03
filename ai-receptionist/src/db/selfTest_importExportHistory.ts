// Real-Prisma self-test for Batch A — import/export history foundation.
//
//   npx tsx src/db/selfTest_importExportHistory.ts     (needs dev Postgres + this batch's migration)
//
// Drives the real services the routes call (createExport / createImportRecord /
// listExports over the shared ExportRecord history, plus the real importContacts and
// bulkCreateRecords). Proves:
//   (1) a record (booking) EXPORT now creates a history entry, retrievable by type;
//   (2) a contact import and a record import each create an IMPORT-history entry with
//       the right kind, dataType, actor, and success/skip counts;
//   (3) per-page history is type-scoped — the contacts query returns ONLY contact
//       exports and excludes feedback/booking and imports (cross-type leakage gone).
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { importContacts } from "../services/contactService";
import { bulkCreateRecords } from "../services/recordService";
import { createExport, createImportRecord, listExports } from "../services/exportService";

const db = prisma as any;
const T_NAME = "__SELFTEST_IMPEXP_HISTORY__";
const ACTOR = "selftest_actor_1";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Batch A — import/export history (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "imphist@example.invalid" } })).id;
    await ensureBookingRecordType(tId);

    console.log("(1) A record (booking) EXPORT now saves to history, typed:");
    await createExport({ tenantId: tId, dataType: "booking", name: "Bookings export", rowCount: 2, fields: ["Title"], csv: "Title\nA\nB", createdById: ACTOR });
    const bookingExports = await listExports(tId, { kind: "export", dataType: "booking" });
    check(bookingExports.length === 1, `booking export appears in export history (got ${bookingExports.length})`);
    check(!!bookingExports[0] && bookingExports[0].kind === "export" && bookingExports[0].dataType === "booking", "stored with kind=export, dataType=booking");

    console.log("\n(2a) A CONTACT import creates an import-history entry with counts + actor:");
    const cRows = [
      { name: "Imp One", email: "impone@example.invalid", phone: "+15550000001" },
      { name: "Imp Two", email: "imptwo@example.invalid", phone: "+15550000002" },
    ];
    const cResult = await importContacts(tId, cRows as any, { type: "user", id: ACTOR, name: "Tester" });
    await createImportRecord({ tenantId: tId, dataType: "contact", name: "Contacts import", rowCount: cResult.imported + cResult.skipped, okCount: cResult.imported, failCount: cResult.skipped, createdById: ACTOR });
    const cImports = await listExports(tId, { kind: "import", dataType: "contact" });
    check(cImports.length === 1 && cImports[0].kind === "import", "contact import recorded as kind=import");
    check(!!cImports[0] && cImports[0].okCount === cResult.imported && cImports[0].failCount === cResult.skipped, `counts match the real import result (ok ${cImports[0] && cImports[0].okCount}=${cResult.imported}, fail ${cImports[0] && cImports[0].failCount}=${cResult.skipped})`);
    const cRaw = await db.exportRecord.findFirst({ where: { tenantId: tId, kind: "import", dataType: "contact" } });
    check(!!cRaw && cRaw.createdById === ACTOR, "import history records the actor (createdById)");

    console.log("\n(2b) A RECORD (booking) import creates an import-history entry:");
    const rResult = await bulkCreateRecords(tId, "booking", [{ title: "Imp Booking 1" }, { title: "Imp Booking 2" }, { title: "Imp Booking 3" }]);
    await createImportRecord({ tenantId: tId, dataType: "booking", name: "booking import", rowCount: rResult.imported + rResult.skipped, okCount: rResult.imported, failCount: rResult.skipped, createdById: ACTOR });
    const rImports = await listExports(tId, { kind: "import", dataType: "booking" });
    check(rImports.length === 1 && rImports[0].okCount === rResult.imported, `record import recorded with ok count ${rImports[0] && rImports[0].okCount}`);

    console.log("\n(3) Per-page history is TYPE-SCOPED (cross-type leakage gone):");
    // Add a contact export and a feedback export alongside the booking export above.
    await createExport({ tenantId: tId, dataType: "contact", name: "Contacts export", rowCount: 2, fields: ["Name"], csv: "Name\nA\nB", createdById: ACTOR });
    await createExport({ tenantId: tId, dataType: "feedback", name: "Feedback export", rowCount: 1, fields: ["Ticket"], csv: "Ticket\nX", createdById: ACTOR });

    const contactExports = await listExports(tId, { kind: "export", dataType: "contact" });
    check(contactExports.length === 1 && contactExports[0].name === "Contacts export", "contacts export history returns exactly the contact export");
    check(!contactExports.some((r: any) => r.dataType === "feedback" || r.dataType === "booking"), "NEGATIVE: contacts export history excludes feedback + booking exports (no leakage)");
    check(!contactExports.some((r: any) => r.kind === "import"), "NEGATIVE: contacts export history excludes imports");

    const jobExportsOnly = await listExports(tId, { kind: "export", dataType: "booking" });
    check(jobExportsOnly.length === 1 && jobExportsOnly[0].name === "Bookings export", "booking export history returns only the booking export");

    const everything = await listExports(tId); // no filter = the later centralized view
    check(everything.length === 5, `unfiltered history returns all 5 entries (3 exports + 2 imports; got ${everything.length})`);
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
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
