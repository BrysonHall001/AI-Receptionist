// Batch self-test — proves the server-side report executor end to end on the REAL
// engine: column/filter correctness, the LOCKED output shapes (xlsx sheet-per-type;
// multi-type csv -> zip; single-type csv -> plain .csv), field-key fidelity (server
// columns match the client export's headers + order for the same keys), the email
// path (mock log, no real send), history + faithful download, and the role gate.
//
//   npx tsx src/db/selfTest_reportExecutor.ts
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_REPORTS_EXEC__"), deleted at the end
// (cascades contacts, records, reports, and run history). No real email is sent —
// the mock provider is forced on.

import ExcelJS from "exceljs";
import JSZip from "jszip";
import { prisma, disconnectDb } from "./client";
import { buildReport, serializeArtifact, runAndDeliverReport } from "../services/reportExecutor";
import { listReports, upsertScheduledReport } from "../services/reportService";
import { getExportArtifact } from "../services/exportService";
import { listRecordTypes } from "../services/recordTypeService";
import { listFields } from "../services/fieldService";
import { ruleFor, permissionGate } from "../middleware/permissionGate";
import { can } from "../services/permissionService";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const db = prisma as any;
const T_NAME = "__SELFTEST_REPORTS_EXEC__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const keysOf = (b: any) => b.columns.map((c: any) => c.key);
const labelsOf = (b: any) => b.columns.map((c: any) => c.label);

async function main() {
  console.log("Report executor — build / shape / fidelity / email / download / gate");
  console.log("====================================================================");
  (env as any).EMAIL_PROVIDER = "mock"; // force the no-send mock path for the whole run

  const before = { tenants: await db.tenant.count(), exports: await db.exportRecord.count(), reports: await db.scheduledReport.count() };
  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;

    // Ensure built-in types + seed contact system fields.
    const types = await listRecordTypes(tenantId);
    await listFields(tenantId, "contact");
    const jobType = types.find((t: any) => t.key === "job");

    // Seed contacts: two on source "web", one on "phone" (the filter target).
    await db.contact.createMany({ data: [
      { tenantId, name: "Ada Lovelace", phone: "+15550001", email: "ada@example.invalid", intent: "quote", source: "web" },
      { tenantId, name: "Grace Hopper", phone: "+15550002", email: "grace@example.invalid", intent: "support", source: "phone" },
      { tenantId, name: "Linus Torvalds", phone: "+15550003", email: "linus@example.invalid", intent: "quote", source: "web" },
    ] });
    // Seed two job records (no filter -> both included).
    await db.record.createMany({ data: [
      { tenantId, recordTypeId: jobType.id, title: "Fix sink" },
      { tenantId, recordTypeId: jobType.id, title: "Paint wall" },
    ] });

    // ---------- (a) executor correctness: columns + filter + selection ----------
    console.log("(a) two types, a field subset, and a filter rule:");
    const definition = {
      types: {
        contact: { fields: ["name", "source", "createdAt"], rules: [{ field: "source", op: "is", value: "web" }] },
        job: { fields: ["title", "createdAt"], rules: [] },
      },
    };
    const built = await buildReport(tenantId, definition);
    check(built.length === 2, "both types are included (each has >=1 checked field)");
    const cBuilt = built.find((b) => b.typeKey === "contact")!;
    const jBuilt = built.find((b) => b.typeKey === "job")!;
    check(!!cBuilt && JSON.stringify(keysOf(cBuilt)) === JSON.stringify(["name", "source", "createdAt"]), "contact columns are exactly the chosen keys, in client order");
    check(!!cBuilt && JSON.stringify(labelsOf(cBuilt)) === JSON.stringify(["Name", "Source", "Time Created"]), "contact headers match the client labels");
    check(!!cBuilt && cBuilt.rows.length === 2, "the source!=web contact was dropped by the filter (3 -> 2)");
    const names = cBuilt.rows.map((r: any) => r.name).sort();
    check(JSON.stringify(names) === JSON.stringify(["Ada Lovelace", "Linus Torvalds"]), "the surviving rows are exactly the matching ones");
    check(!!jBuilt && jBuilt.rows.length === 2 && JSON.stringify(keysOf(jBuilt)) === JSON.stringify(["title", "createdAt"]), "job columns limited to the chosen keys; no filter -> both rows");

    // ---------- (b) output shapes (LOCKED format) ----------
    console.log("\n(b) locked output shapes:");
    const xlsx = await serializeArtifact("My Report", "xlsx", built);
    check(xlsx.ext === "xlsx" && xlsx.base64 === true, "xlsx -> one workbook (xlsx, base64)");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.content as any);
    check(wb.worksheets.length === 2, "xlsx workbook has one sheet per included type");

    const zip = await serializeArtifact("My Report", "csv", built);
    check(zip.ext === "zip" && zip.base64 === true, "multi-type csv -> a .zip");
    const z = await JSZip.loadAsync(zip.content as Buffer);
    const csvNames = Object.keys(z.files).filter((n) => n.endsWith(".csv"));
    check(csvNames.length === 2, "the zip holds one CSV per type");

    const single = await serializeArtifact("My Report", "csv", [cBuilt]);
    check(single.ext === "csv" && single.base64 === false, "single-type csv -> a plain .csv (no zip)");
    check(typeof single.content === "string" && (single.content as string).split("\n")[0] === "Name,Source,Time Created", "the plain csv starts with the exact header row");

    // ---------- (c) field-key fidelity (order follows the column def, not selection) ----------
    console.log("\n(c) field-key fidelity:");
    const fidelity = await buildReport(tenantId, { types: { contact: { fields: ["source", "name", "callCount"], rules: [] } } });
    const fc = fidelity[0];
    check(JSON.stringify(keysOf(fc)) === JSON.stringify(["name", "source", "callCount"]), "columns come out in client column-def order regardless of selection order");
    check(JSON.stringify(labelsOf(fc)) === JSON.stringify(["Name", "Source", "Calls"]), "headers match the client export for the same keys");

    // ---------- (d) email path (mock log, no real send) ----------
    console.log("\n(d) email path uses sendRichEmail with the right attachment (mock log):");
    const saved = await upsertScheduledReport({ tenantId, name: "Emailed Report", format: "xlsx", definition, recipients: ["dest@example.invalid"] });
    const captured: string[] = [];
    const origInfo = logger.info;
    (logger as any).info = (m: string, meta?: unknown) => { captured.push(String(m)); };
    let run: any;
    try {
      run = await runAndDeliverReport({ tenantId, reportId: saved.id, name: "Emailed Report", format: "xlsx", definition, recipients: ["dest@example.invalid"], createdById: null });
    } finally {
      (logger as any).info = origInfo;
    }
    const mockLine = captured.find((m) => m.includes("[mock email]") && m.includes("dest@example.invalid"));
    check(!!mockLine, "sendRichEmail ran via the mock path to the recipient (no real send)");
    check(!!mockLine && /attachments: [^|]*\.xlsx/.test(mockLine), "the email carried an attachment with the .xlsx extension");

    // ---------- (e) history + faithful download ----------
    console.log("\n(e) the run is logged and downloads faithfully:");
    const rec = await db.exportRecord.findUnique({ where: { id: run.exportRecordId } });
    check(!!rec && rec.kind === "report" && rec.reportId === saved.id, "run logged to ExportRecord (kind:report, linked to the report)");
    check(!!rec && rec.rowCount === 4, "ExportRecord rowCount is the total across types (2 contacts + 2 jobs)");
    const list = await listReports(tenantId);
    const dto = list.find((r: any) => r.id === saved.id);
    check(!!dto && dto.latestRun && dto.latestRun.rowCount === 4, "GET /api/reports shows the run with the right Rows");
    const art = await getExportArtifact(run.exportRecordId, tenantId);
    check(!!art && art.ext === "xlsx" && art.base64 === true, "download is format-aware (xlsx, base64)");
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(Buffer.from(art!.csv, "base64") as any);
    check(wb2.worksheets.length === 2, "the downloaded bytes are a real workbook with one sheet per type");

    // A CSV run downloads as plain text.
    const csvRun = await runAndDeliverReport({ tenantId, reportId: saved.id, name: "Emailed Report", format: "csv", definition, recipients: ["dest@example.invalid"], createdById: null });
    const csvArt = await getExportArtifact(csvRun.exportRecordId, tenantId);
    check(!!csvArt && csvArt.ext === "zip" && csvArt.base64 === true, "a multi-type csv run downloads as a .zip");

    // ---------- (f) role gate ----------
    console.log("\n(f) the run endpoint is gated like exports:");
    const rule = ruleFor("POST", "/reports/run");
    check(!!rule && rule.area === "settings_data" && rule.right === "manage", "POST /reports/run maps to settings_data / manage");
    const admin = { id: "u-admin", role: "PORTAL_ADMIN", tenantId, customRoleId: null } as any;
    const client = { id: "u-client", role: "CLIENT_USER", tenantId, customRoleId: null } as any;
    check(await can(admin, "settings_data", "manage"), "a portal admin CAN run reports");
    check(!(await can(client, "settings_data", "manage")), "a client user (read-only) CANNOT run reports");
    // Exercise the real middleware too.
    const runGate = async (user: any) => {
      let nexted = false;
      const res: any = { _s: 200, status(c: number) { this._s = c; return this; }, json() { return this; } };
      await permissionGate({ method: "POST", path: "/reports/run", user } as any, res, () => { nexted = true; });
      return { nexted, status: res._s };
    };
    const g1 = await runGate(client);
    check(!g1.nexted && g1.status === 403, "the gate 403s a client user at POST /reports/run");
    const g2 = await runGate(admin);
    check(g2.nexted, "the gate lets a portal admin through");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try {
        await db.exportRecord.deleteMany({ where: { tenantId: tId } });
        await db.tenant.delete({ where: { id: tId } });
      } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  // ---------- real data untouched ----------
  console.log("\n(real data untouched):");
  const after = { tenants: await db.tenant.count(), exports: await db.exportRecord.count(), reports: await db.scheduledReport.count() };
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);
  check(after.exports === before.exports, `exportRecords unchanged (${before.exports} -> ${after.exports})`);
  check(after.reports === before.reports, `scheduledReports unchanged (${before.reports} -> ${after.reports})`);

  console.log("\n====================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (report executor end-to-end)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
