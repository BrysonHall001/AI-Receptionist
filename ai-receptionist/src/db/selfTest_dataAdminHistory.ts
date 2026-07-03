// Real-Prisma self-test for Batch B — centralized Import/Export History.
//
//   npx tsx src/db/selfTest_dataAdminHistory.ts     (needs dev Postgres)
//
// The Data Administration "Import / Export History" sub-tab reads the combined
// history through the SAME real path the per-page modals use: listExports() over the
// shared ExportRecord table (no backend change in this batch). This test proves:
//   (1) the centralized view returns ALL import + export entries across every type;
//   (2) scoping to one type (the sort tabs do this client-side) returns only that
//       type — both via the endpoint filter AND the tab's client-side filter;
//   (3) the "All" view's type + kind label is derived correctly.
//
// The label + client-filter mirrors below are tiny copies of portal.js
// (dataHistoryWhat / the tab filter), the same mirror approach the reports test uses.
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { createExport, createImportRecord, listExports } from "../services/exportService";

const db = prisma as any;
const T_NAME = "__SELFTEST_DATAADMIN_HISTORY__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// ---- mirrors of portal.js (kept tiny + in sync) ----
const TYPE_LABELS: Record<string, string> = { contact: "Contacts", feedback: "Feedback", event: "Event log", job: "Jobs", booking: "Bookings" };
const whatOf = (r: any) => (r.dataType ? (TYPE_LABELS[r.dataType] || r.dataType) : "Other") + " · " + (r.kind === "import" ? "Import" : "Export");
const filterByType = (rows: any[], dt: string) => (dt === "all" ? rows : rows.filter((r) => (r.dataType || "other") === dt));

async function main() {
  console.log("Batch B — centralized import/export history (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "dataadmin@example.invalid" } })).id;

    // A spread of real history across types + kinds.
    await createExport({ tenantId: tId, dataType: "contact", name: "Contacts export", rowCount: 5, fields: [], csv: "x", createdById: "u1" });
    await createExport({ tenantId: tId, dataType: "job", name: "Jobs export", rowCount: 3, fields: [], csv: "x", createdById: "u1" });
    await createExport({ tenantId: tId, dataType: "feedback", name: "Feedback export", rowCount: 2, fields: [], csv: "x", createdById: "u1" });
    await createImportRecord({ tenantId: tId, dataType: "contact", name: "Contacts import", rowCount: 4, okCount: 4, failCount: 0, createdById: "u1" });
    await createImportRecord({ tenantId: tId, dataType: "job", name: "job import", rowCount: 6, okCount: 5, failCount: 1, createdById: "u1" });

    console.log("(1) Centralized view returns ALL import + export entries across types:");
    const all = await listExports(tId);
    check(all.length === 5, `combined history returns all 5 entries (got ${all.length})`);
    const kinds = new Set(all.map((r: any) => r.kind));
    check(kinds.has("export") && kinds.has("import"), "includes BOTH exports and imports");
    const dts = new Set(all.map((r: any) => r.dataType));
    check(dts.has("contact") && dts.has("job") && dts.has("feedback"), "spans multiple types (contact, job, feedback)");

    console.log("\n(2) Scoping to a single type returns only that type:");
    const jobsClient = filterByType(all, "job");
    check(jobsClient.length === 2 && jobsClient.every((r: any) => r.dataType === "job"), `the Jobs tab (client filter) shows only the 2 job rows (got ${jobsClient.length})`);
    check(!jobsClient.some((r: any) => r.dataType === "contact" || r.dataType === "feedback"), "NEGATIVE: the Jobs tab excludes contact + feedback rows");
    const jobsEndpoint = await listExports(tId, { dataType: "job" });
    check(jobsEndpoint.length === 2 && jobsEndpoint.every((r: any) => r.dataType === "job"), "the endpoint dataType filter also returns only jobs");

    console.log("\n(3) The All view's type + kind label is derived correctly:");
    const jobExport = all.find((r: any) => r.dataType === "job" && r.kind === "export");
    const contactImport = all.find((r: any) => r.dataType === "contact" && r.kind === "import");
    const feedbackExport = all.find((r: any) => r.dataType === "feedback" && r.kind === "export");
    check(!!jobExport && whatOf(jobExport) === "Jobs · Export", `job export labelled "Jobs · Export" (got "${jobExport && whatOf(jobExport)}")`);
    check(!!contactImport && whatOf(contactImport) === "Contacts · Import", `contact import labelled "Contacts · Import" (got "${contactImport && whatOf(contactImport)}")`);
    check(!!feedbackExport && whatOf(feedbackExport) === "Feedback · Export", `feedback export labelled "Feedback · Export"`);
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
