// Batch self-test — proves the ScheduledReport foundation works end to end on the
// REAL engine: create a report -> it appears in listReports (the GET /api/reports
// payload) with the exact DTO the list table needs -> a report RUN (an ExportRecord,
// kind:"report") shows up as the latest run with Rows + a downloadable record id.
//
//   npx tsx src/db/selfTest_scheduledReports.ts
//
// SAFETY: one clearly-named TEMPORARY tenant ("__SELFTEST_REPORTS__"), deleted at the
// end (cascades the report; the run's tenantId cascades too). Real row counts are
// captured before/after and asserted unchanged.

import { prisma, disconnectDb } from "./client";
import { createScheduledReport, listReports } from "../services/reportService";

const db = prisma as any;
const T_NAME = "__SELFTEST_REPORTS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("ScheduledReport — create / list DTO / latest-run self-test");
  console.log("=========================================================");
  const before = {
    tenants: await db.tenant.count(),
    reports: await db.scheduledReport.count(),
    exports: await db.exportRecord.count(),
  };
  console.log(`Real rows before — tenants:${before.tenants} scheduledReports:${before.reports} exportRecords:${before.exports}\n`);

  let tId: string | null = null;
  try {
    // ---------- temp tenant + creating user ----------
    const tenant = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const user = await db.user.create({ data: { tenantId, name: "Self Test", email: `selftest-${Date.now()}@example.invalid`, passwordHash: "x", role: "PORTAL_ADMIN" } });

    // ---------- (a) create + list DTO shape ----------
    console.log("(a) create a report; it appears in listReports with the list-table DTO:");
    const created = await createScheduledReport({ tenantId, name: "Weekly contacts", format: "csv", createdById: user.id, definition: { sources: ["contact"] } });
    check(!!created.id, "createScheduledReport returned an id");

    let list = await listReports(tenantId);
    const dto = list.find((r: any) => r.id === created.id);
    check(!!dto, "the report appears in listReports (the GET /api/reports payload)");
    check(!!dto && dto.name === "Weekly contacts", "DTO has Name");
    check(!!dto && typeof dto.createdAt === "string" && dto.createdAt.includes("T"), "DTO has Date Created (ISO timestamp)");
    check(!!dto && dto.createdByName === "Self Test", "DTO has Created by (resolved user name)");
    check(!!dto && dto.active === true, "DTO has active = true (status pill -> Active)");
    check(!!dto && dto.latestRun === null && dto.rowCount === null, "no run yet -> latestRun null, Rows shows nothing");

    // ---------- (b) inactive reports are still listed ----------
    console.log("\n(b) inactive reports are listed too (the list shows active AND inactive):");
    const off = await createScheduledReport({ tenantId, name: "Archived report", createdById: user.id, active: false });
    list = await listReports(tenantId);
    const offDto = list.find((r: any) => r.id === off.id);
    check(!!offDto && offDto.active === false, "an inactive report is present with active = false");

    // ---------- (c) a report RUN (ExportRecord kind:"report") becomes the latest run ----------
    console.log("\n(c) a report run (ExportRecord kind:\"report\") drives Rows + Download:");
    const run = await db.exportRecord.create({
      data: { tenantId, kind: "report", reportId: created.id, dataType: "contact", name: "Weekly contacts", rowCount: 42, fields: [], csv: "name\nAda Lovelace\n", createdById: user.id },
    });
    list = await listReports(tenantId);
    const withRun = list.find((r: any) => r.id === created.id);
    check(!!withRun && !!withRun.latestRun, "the report now has a latestRun");
    check(!!withRun && withRun.latestRun && withRun.latestRun.exportRecordId === run.id, "  …latestRun points at the ExportRecord run (for the Download button)");
    check(!!withRun && withRun.latestRun && withRun.latestRun.rowCount === 42, "  …latestRun.rowCount === 42 (Rows column)");
    check(!!withRun && withRun.latestRun && withRun.latestRun.downloadable === true, "  …latestRun is downloadable (reuses the export-download route)");
    check(!!withRun && withRun.rowCount === 42, "  …top-level rowCount mirrors the latest run (42)");

    // ---------- (d) newest run wins ----------
    await db.exportRecord.create({
      data: { tenantId, kind: "report", reportId: created.id, dataType: "contact", name: "Weekly contacts", rowCount: 99, fields: [], csv: "name\nGrace Hopper\n", createdById: user.id },
    });
    list = await listReports(tenantId);
    const newest = list.find((r: any) => r.id === created.id);
    check(!!newest && newest.latestRun && newest.latestRun.rowCount === 99, "the most recent run (99 rows) is the one shown");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try {
        // Delete report runs first (their tenantId cascades anyway, but be explicit),
        // then the tenant (cascades ScheduledReport + User).
        await db.exportRecord.deleteMany({ where: { tenantId: tId } });
        await db.tenant.delete({ where: { id: tId } });
      } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  // ---------- (e) real data untouched ----------
  console.log("\n(d) real data untouched:");
  const after = {
    tenants: await db.tenant.count(),
    reports: await db.scheduledReport.count(),
    exports: await db.exportRecord.count(),
  };
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);
  check(after.reports === before.reports, `scheduledReports unchanged (${before.reports} -> ${after.reports})`);
  check(after.exports === before.exports, `exportRecords unchanged (${before.exports} -> ${after.exports})`);

  console.log("\n=========================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (ScheduledReport create/list/run all work)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
