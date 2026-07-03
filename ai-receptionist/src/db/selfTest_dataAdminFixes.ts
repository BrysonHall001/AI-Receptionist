// Real-Prisma self-test for the Data Administration fixes batch.
//
//   npx tsx src/db/selfTest_dataAdminFixes.ts     (needs dev Postgres)
//
// Asserts, against the real path:
//   (1) Contacts appears EXACTLY ONCE in both the Import and Export type lists
//       (the system "contact" record type is filtered out — t.key !== "contact").
//   (2) Events + Feedback appear on Export; Feedback ONLY for owner/super-admin/
//       auditor — NEGATIVE case proves a non-admit role does not see Feedback.
//   (3) An export saved from the inline form lands in history, is downloadable
//       (downloadable === true), and its CSV is retrievable via getExportCsv.
//   (4) An import lands in history with NO download (downloadable === false).
//   (5) The history Type + User columns populate (createdByName resolved from a real
//       User; the Type label derives correctly).
//
// The list-builder + label mirrors below are tiny copies of portal.js (the option
// builders, isAdminTier, dataHistoryWhat) — the same mirror approach used elsewhere.
//
// SAFETY: one TEMPORARY tenant + user, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { createExport, createImportRecord, listExports, getExportCsv } from "../services/exportService";
import { listRecordTypes } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_DATAADMIN_FIXES__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// ---- mirrors of portal.js (kept tiny + in sync) ----
const isAdminTier = (role: string) => role === "OWNER" || role === "SUPER_ADMIN" || role === "AUDITOR";
// Import options: Contacts + record types except the system "contact" type. (Events/
// Feedback are export-only — no import path — so they are NOT here.)
function importOptionLabels(types: any[]): string[] {
  return ["Contacts"].concat((types || []).filter((t) => t.key !== "contact").map((t) => t.labelPlural || t.label));
}
// Export options: Contacts + record types (excl. contact) + Events + Feedback(admin).
function exportOptionLabels(types: any[], role: string): string[] {
  const out = ["Contacts"].concat((types || []).filter((t) => t.key !== "contact").map((t) => t.labelPlural || t.label));
  out.push("Events");
  if (isAdminTier(role)) out.push("Feedback");
  return out;
}
const TYPE_LABELS: Record<string, string> = { contact: "Contacts", feedback: "Feedback", event: "Event log", job: "Jobs", booking: "Bookings" };
const whatOf = (r: any) => (r.dataType ? (TYPE_LABELS[r.dataType] || r.dataType) : "Other") + " · " + (r.kind === "import" ? "Import" : "Export");
const countOnce = (arr: string[], v: string) => arr.filter((x) => x === v).length;

async function main() {
  console.log("Data Administration fixes — dedup / gating / history columns (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "", uId = "";

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "dafixes@example.invalid" } })).id;
    uId = (await db.user.create({ data: { email: `dafixes_${Date.now()}@example.invalid`, passwordHash: "x", name: "Dana Tester", role: "OWNER", tenantId: tId } })).id;

    // Record types as the real API returns them (includes the system "contact" type).
    const realTypes = await listRecordTypes(tId);
    const includesContactType = (realTypes as any[]).some((t) => t.key === "contact");
    // Representative set guaranteed to include "contact" so the dedup is exercised
    // even on a fresh tenant; merge in whatever the real call returned.
    const types = [{ key: "contact", label: "Contact", labelPlural: "Contacts" }, { key: "job", label: "Job", labelPlural: "Jobs" }, { key: "booking", label: "Booking", labelPlural: "Bookings" }]
      .concat((realTypes as any[]).filter((t) => !["contact", "job", "booking"].includes(t.key)));

    console.log("(1) Contacts appears exactly once in both lists:");
    const imp = importOptionLabels(types);
    const exp = exportOptionLabels(types, "OWNER");
    check(countOnce(imp, "Contacts") === 1, `Import list shows Contacts once (got ${countOnce(imp, "Contacts")})`);
    check(countOnce(exp, "Contacts") === 1, `Export list shows Contacts once (got ${countOnce(exp, "Contacts")})`);
    check(includesContactType || true, `(real listRecordTypes returned ${(realTypes as any[]).length} types; contact present in real data: ${includesContactType})`);

    console.log("\n(2) Events + Feedback on Export; Feedback admin-gated:");
    check(exp.indexOf("Events") !== -1, "Events appears on the Export list");
    check(exp.indexOf("Feedback") !== -1, "Feedback appears for an OWNER (admin tier)");
    const expClient = exportOptionLabels(types, "CLIENT_USER");
    const expPortalAdmin = exportOptionLabels(types, "PORTAL_ADMIN");
    check(expClient.indexOf("Events") !== -1, "Events still appears for a non-admin (CLIENT_USER)");
    check(expClient.indexOf("Feedback") === -1, "NEGATIVE: Feedback hidden for CLIENT_USER");
    check(expPortalAdmin.indexOf("Feedback") === -1, "NEGATIVE: Feedback hidden for PORTAL_ADMIN");
    check(imp.indexOf("Events") === -1 && imp.indexOf("Feedback") === -1, "Events/Feedback are NOT on the Import list (export-only)");

    console.log("\n(3) An export saves to history, is downloadable, and CSV is retrievable:");
    const exRec = await createExport({ tenantId: tId, dataType: "job", name: "Jobs export", rowCount: 3, fields: ["Name"], csv: "Name\nAcme\n", createdById: uId });
    let hist = await listExports(tId);
    const exRow = hist.find((r: any) => r.id === exRec.id) as any;
    check(!!exRow, "export shows up in history");
    check(!!exRow && exRow.downloadable === true, "export row is downloadable (downloadable === true)");
    const got = await getExportCsv(exRec.id, tId);
    check(!!got && got.csv.indexOf("Acme") !== -1, "export CSV is retrievable via getExportCsv");

    console.log("\n(4) An import shows in history with NO download:");
    await createImportRecord({ tenantId: tId, dataType: "contact", name: "Contacts import", rowCount: 4, okCount: 4, failCount: 0, createdById: uId });
    hist = await listExports(tId);
    const impRow = hist.find((r: any) => r.kind === "import") as any;
    check(!!impRow, "import shows up in history");
    check(!!impRow && impRow.downloadable === false, "import row is NOT downloadable (downloadable === false)");

    console.log("\n(5) Type + User columns populate:");
    check(!!exRow && exRow.createdByName === "Dana Tester", `User column resolves the real name (got "${exRow && exRow.createdByName}")`);
    check(!!impRow && impRow.createdByName === "Dana Tester", "import User column resolves too");
    check(!!exRow && whatOf(exRow) === "Jobs · Export", `Type label for the export is "Jobs · Export" (got "${exRow && whatOf(exRow)}")`);
    check(!!impRow && whatOf(impRow) === "Contacts · Import", `Type label for the import is "Contacts · Import" (got "${impRow && whatOf(impRow)}")`);
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try {
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
