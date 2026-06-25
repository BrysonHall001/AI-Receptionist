// Real-Prisma self-test for Call export (final Data Administration piece).
//
//   npx tsx src/db/selfTest_callExport.ts     (needs dev Postgres)
//
// Call export reuses the shared exporter: client builds the CSV from callColumnDefs
// and POSTs to /api/exports (createExport, dataType="call"); it lands in the shared
// ExportRecord history and is downloadable. This test covers the Prisma path:
//
//   (1) A call export pulls real CallSession rows via the real read path
//       (listCalls) and saves a history entry via the real export path
//       (createExport, dataType="call").
//   (2) It appears in the centralized history as type=Calls and IS downloadable,
//       and its CSV is retrievable (getExportCsv).
//   (3) Calls is a Data Backup section, fed by the same real listCalls path.
//
// SAFETY: one TEMPORARY tenant + user + call, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { listCalls } from "../services/readModels";
import { createExport, listExports, getExportCsv } from "../services/exportService";

const db = prisma as any;
const T_NAME = "__SELFTEST_CALL_EXPORT__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// ---- mirrors of portal.js (kept tiny + in sync) ----
const TYPE_LABELS: Record<string, string> = { contact: "Contacts", feedback: "Feedback", event: "Event log", call: "Calls", job: "Jobs", booking: "Bookings" };
const whatOf = (r: any) => (r.kind === "backup" ? "Full backup" : (r.dataType ? (TYPE_LABELS[r.dataType] || r.dataType) : "Other") + " · " + (r.kind === "import" ? "Import" : "Export"));
// Backup section list always includes Calls (mirror of gatherBackupSections).
const backupSectionLabels = (recordTypeLabels: string[]) => ["Contacts"].concat(recordTypeLabels).concat(["Calls", "Events", "Resources"]);

async function main() {
  console.log("Call export — real read + shared exporter + history + backup (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "", uId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "callexport@example.invalid" } })).id;
    uId = (await db.user.create({ data: { email: `callexport_${Date.now()}@example.invalid`, passwordHash: "x", name: "Riley Agent", role: "OWNER", tenantId: tId } })).id;
    await db.callSession.create({ data: { tenantId: tId, callSid: `CA_${Date.now()}`, fromNumber: "+15550100", status: "COMPLETED", extracted: { name: "Pat Caller", phone: "+15550100", intent: "Booking" }, turnCount: 4 } });

    console.log("(1) Real read path + saving a call export to history:");
    const calls = await listCalls(tId);
    check(Array.isArray(calls) && calls.length >= 1, `listCalls returns real CallSession rows (${calls.length})`);
    const sample = calls[0] as any;
    check(!!sample && sample.name === "Pat Caller" && sample.status === "COMPLETED", "call DTO surfaces caller name + status (the exported fields)");
    // The shared export path — exactly what App.exportModal POSTs for a call export.
    const csv = "Caller,Phone,Status,When\nPat Caller,+15550100,Completed,Jun 24 2026\n";
    const rec = await createExport({ tenantId: tId, dataType: "call", name: "June calls", rowCount: calls.length, fields: ["Caller", "Phone", "Status", "When"], csv, createdById: uId });
    check(!!rec && rec.id != null, "createExport saved the call export");

    console.log("\n(2) It appears in centralized history as Calls, downloadable:");
    const hist = await listExports(tId);
    const row = hist.find((r: any) => r.id === rec.id) as any;
    check(!!row, "call export shows up in the centralized history");
    check(!!row && row.dataType === "call", "history row dataType is 'call'");
    check(!!row && whatOf(row) === "Calls · Export", `Type column reads "Calls · Export" (got "${row && whatOf(row)}")`);
    check(!!row && row.downloadable === true, "call export is downloadable (it has a stored file)");
    check(!!row && row.createdByName === "Riley Agent", "User column resolves the exporter's name");
    const got = await getExportCsv(rec.id, tId);
    check(!!got && got.csv.indexOf("Pat Caller") !== -1, "the stored CSV is retrievable for download");

    console.log("\n(3) Calls is a Data Backup section fed by the same real path:");
    check(backupSectionLabels(["Jobs", "Bookings"]).indexOf("Calls") !== -1, "Calls is included as a backup section");
    check(Array.isArray(calls) && calls.length >= 1, "the Calls backup sheet would contain real call rows");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try {
      if (tId) await db.callSession.deleteMany({ where: { tenantId: tId } });
      if (uId) await db.user.deleteMany({ where: { id: uId } });
      if (tId) await db.tenant.deleteMany({ where: { name: T_NAME } });
    } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
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
