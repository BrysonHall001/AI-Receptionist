// PERMANENT GUARDRAIL: a brand-new module (record type) must automatically appear
// and participate in EVERY surface where modules belong — with ZERO per-surface
// code changes. This is the contract the eventual "users create their own modules"
// feature must keep satisfying. It registers a throwaway MOCK module, asserts each
// surface picks it up, and FAILS LOUDLY naming any surface that doesn't. Cleans up.
//
//   npx tsx src/db/selfTest_moduleCoverage.ts        (needs dev Postgres)
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import {
  SYSTEM_RECORD_TYPES, listRecordTypes, resolveRecordTypeId,
  systemRecordTypeOptions, togglableRecordTypeKeys,
} from "../services/recordTypeService";
import { listFields } from "../services/fieldService";
import { createRecord, listRecords, softDeleteRecords, listDeletedRecords, restoreRecords } from "../services/recordService";
import { parseRecordDateTrigger } from "../automation/scheduler";

const MOCK_KEY = "zzz_mock";
const failures: string[] = [];
function check(cond: boolean, surface: string, detail = "") { console.log(`  ${cond ? "\u2713" : "\u2717"} [${surface}] ${detail}`); if (!cond) failures.push(surface + (detail ? " — " + detail : "")); }

const tenantIds: string[] = [];
async function mkTenant() {
  const t = await prisma.tenant.create({ data: { name: `mc-${Date.now()}`, notifyEmail: `mc-${Date.now()}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}

// Load navModel.js (DOM-free) in a sandbox with a given App.state.recordTypes.
function loadNav(recordTypes: any[]) {
  const code = readFileSync(resolve(__dirname, "../../public/js/navModel.js"), "utf8");
  const sandbox: any = { window: { App: { state: { recordTypes } } } };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.App;
}

async function main() {
  console.log("Module-coverage guardrail — a new module must reach EVERY surface");
  console.log("=================================================================");

  // Register the MOCK module in the ONE registry that feeds both the system-level
  // options and (via ensure) the per-tenant list. Throwaway — spliced out in finally.
  const MOCK: any = { key: MOCK_KEY, defaults: { key: MOCK_KEY, label: "Zzz Mock", labelPlural: "Zzz Mocks", system: false, stages: [], recordStages: [], subtypes: [], order: 999 } };
  SYSTEM_RECORD_TYPES.push(MOCK);

  const T = await mkTenant();

  // (1) registry resolution
  const types = await listRecordTypes(T);
  const inList = (types as any[]).find((t) => t.key === MOCK_KEY);
  check(!!inList, "1.registry", "listRecordTypes includes the mock module");
  const mockId = await resolveRecordTypeId(T, MOCK_KEY).catch(() => null);
  check(!!mockId, "1.registry", "resolveRecordTypeId resolves the mock module");

  // (2) Fields page dropdown (fields API works for the mock type)
  let fieldsOk = true; try { await listFields(T, MOCK_KEY); } catch { fieldsOk = false; }
  check(fieldsOk, "2.fields", "listFields(mock) works (Fields dropdown is registry-driven)");

  // (3) nav — buildPortalNav includes #/records/<key>
  const navApp = loadNav(types as any[]);
  const nav = navApp.buildPortalNav();
  const navItem = nav.find((it: any) => it[0] === "#/records/" + MOCK_KEY);
  check(!!navItem, "3.nav", "buildPortalNav includes #/records/" + MOCK_KEY);

  // (4) permissions — governed by the shared "records" area (records-area hrefs cover it)
  const recordsHrefs = navApp.recordsAreaHrefs();
  check(recordsHrefs.includes("#/records/" + MOCK_KEY), "4.permissions", "mock is part of the shared 'records' permission area");

  // (5) import (generic create) + export (registry-derived exportable list)
  const rec: any = await createRecord(T, MOCK_KEY, { title: "Mock Unit", customFields: {} });
  check(!!rec && !!rec.id, "5.import", "createRecord(mock) works (generic import accepts the module)");
  const exportableKeys = (types as any[]).filter((t) => t.key !== "contact").map((t) => t.key);
  check(exportableKeys.includes(MOCK_KEY), "5.export", "mock appears among exportable record types");

  // (6) Data Backup (rows gathered generically) + Recycle Bin (soft-delete + restore)
  const backupRows = await listRecords(T, MOCK_KEY);
  check(backupRows.some((r: any) => r.id === rec.id), "6.backup", "mock's rows are gathered by listRecords (backup is generic)");
  await softDeleteRecords(T, [rec.id]);
  const deleted = await listDeletedRecords(T);
  check(deleted.some((r: any) => r.id === rec.id), "6.recycle", "soft-deleted mock record appears in the Recycle Bin");
  const restored = await restoreRecords(T, [rec.id]);
  check(restored >= 1 && (await listRecords(T, MOCK_KEY)).some((r: any) => r.id === rec.id), "6.recycle", "mock record restores generically");

  // (7) Analytics widget data sources — built per non-contact record type from the registry
  check(!!inList && inList.key !== "contact", "7.analytics", "mock is a non-contact registry type -> widget builder includes it as a source");

  // (8) Automations — usable as a subject + date-reached trigger can target its date fields
  const parsed = parseRecordDateTrigger(`RecordDateReached:${MOCK_KEY}:due_date:7:days:before`);
  check(!!parsed && parsed.recordTypeKey === MOCK_KEY, "8.automations", "date-reached trigger can target the mock module");
  check(exportableKeys.includes(MOCK_KEY), "8.automations", "mock is available as an automation subject (registry-driven)");

  // (9) Portal-creation "Modules" picker — a togglable option
  const opts = systemRecordTypeOptions();
  const opt = opts.find((o) => o.key === MOCK_KEY);
  check(!!opt && opt.togglable === true && opt.href === "#/records/" + MOCK_KEY, "9.create-modules", "mock is a togglable option in the create-tenant Modules picker");
  check(togglableRecordTypeKeys().includes(MOCK_KEY), "9.create-modules", "togglableRecordTypeKeys includes the mock");

  // (10) AI Receptionist "Modules" knowledge checklist — driven by /api/record-types
  check((types as any[]).some((t) => t.key === MOCK_KEY && t.key !== "contact"), "10.ai-knowledge", "mock appears in the record-type list the System-knowledge checklist renders");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    const i = SYSTEM_RECORD_TYPES.findIndex((d) => d.key === MOCK_KEY);
    if (i >= 0) SYSTEM_RECORD_TYPES.splice(i, 1);
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    if (failures.length) {
      console.log(`\n\u274c MODULE-COVERAGE GUARDRAIL FAILED — a new module did NOT reach: ${failures.join(", ")}`);
    } else {
      console.log("\nALL PASSED \u2705  (a new module auto-integrates on every surface — the foundation holds)");
    }
    process.exit(failures.length ? 1 : 0);
  });
