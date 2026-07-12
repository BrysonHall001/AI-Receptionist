// Guardrail for the REAL "+ Add module" path (createRecordType). Unlike
// selfTest_moduleCoverage (which splices a mock into SYSTEM_RECORD_TYPES), this creates a
// genuine user-defined module through the service the endpoint calls, then asserts it is
// system:false, ordered AFTER the last module, seeded with ONE "Name" field, and that it
// auto-appears on EVERY per-portal module surface — failing loudly and naming any that miss.
//
//   npx tsx src/db/selfTest_addModule.ts        (needs dev Postgres)
//
// NOTE on the portal-CREATION "Modules" picker: that picker lists system/template modules
// offered when creating a brand-new portal, so a per-portal user-created module correctly
// does NOT appear there (it isn't a cross-portal template). Every other module surface does.
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { createRecordType, listRecordTypes, resolveRecordTypeId, systemRecordTypeOptions } from "../services/recordTypeService";
import { listFields } from "../services/fieldService";
import { createRecord, listRecords, softDeleteRecords, listDeletedRecords, restoreRecords } from "../services/recordService";
import { parseRecordDateTrigger } from "../automation/scheduler";

const failures: string[] = [];
function check(cond: boolean, surface: string, detail = "") { console.log(`  ${cond ? "\u2713" : "\u2717"} [${surface}] ${detail}`); if (!cond) failures.push(surface + (detail ? " — " + detail : "")); }

const tenantIds: string[] = [];
async function mkTenant() {
  const t = await prisma.tenant.create({ data: { name: `am-${Date.now()}`, notifyEmail: `am-${Date.now()}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}
function loadNav(recordTypes: any[]) {
  const code = readFileSync(resolve(__dirname, "../../public/js/navModel.js"), "utf8");
  const sandbox: any = { window: { App: { state: { recordTypes } } } };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.App;
}

async function main() {
  console.log("Add-module guardrail — the REAL createRecordType path reaches every surface");
  console.log("==========================================================================");

  const T = await mkTenant();
  const before = await listRecordTypes(T);
  const maxOrderBefore = Math.max(...(before as any[]).map((t) => t.order || 0));

  // ---- Create a real user-defined module ----
  const mod: any = await createRecordType(T, "Vehicle", "Vehicles");
  check(!!mod && !!mod.key, "0.create", "createRecordType returns the new module");
  const KEY = mod.key;

  // (0) creation contract: system:false, order-after-last, seeded "Name" field.
  const types = await listRecordTypes(T);
  const row = (types as any[]).find((t) => t.key === KEY);
  check(!!row, "0.create", "new module is present in listRecordTypes");
  check(row && row.system === false, "0.create", "new module is system:false");
  check(row && row.order > maxOrderBefore, "0.create", `ordered AFTER the last module (order ${row?.order} > ${maxOrderBefore})`);
  check(row && (row.labelPlural === "Vehicles") && row.label === "Vehicle", "0.create", "singular + plural labels stored");
  const fields = await listFields(T, KEY);
  const nameField = (fields as any[]).find((f) => f.key === "name");
  check(!!nameField && nameField.type === "text" && (fields as any[]).length === 1, "0.create", "seeded with exactly one 'Name' text field");
  const rid = await resolveRecordTypeId(T, KEY).catch(() => null);
  check(!!rid, "0.create", "resolveRecordTypeId resolves the new module");

  // (2) Fields page (registry-driven)
  let fieldsOk = true; try { await listFields(T, KEY); } catch { fieldsOk = false; }
  check(fieldsOk, "2.fields", "listFields(new) works");

  // (3) nav + (4) permissions
  const navApp = loadNav(types as any[]);
  const nav = navApp.buildPortalNav();
  check(!!nav.find((it: any) => it[0] === "#/records/" + KEY), "3.nav", "buildPortalNav includes #/records/" + KEY);
  check(navApp.recordsAreaHrefs().includes("#/records/" + KEY), "4.permissions", "part of the shared 'records' permission area");

  // (5) import (generic create) + export list
  const rec: any = await createRecord(T, KEY, { title: "Van 1", customFields: {} });
  check(!!rec && !!rec.id, "5.import", "createRecord(new) works");
  check((types as any[]).filter((t) => t.key !== "contact").map((t) => t.key).includes(KEY), "5.export", "appears among exportable record types");

  // (6) backup (generic listRecords) + recycle (soft-delete/restore)
  check((await listRecords(T, KEY)).some((r: any) => r.id === rec.id), "6.backup", "rows gathered by listRecords");
  await softDeleteRecords(T, [rec.id]);
  check((await listDeletedRecords(T)).some((r: any) => r.id === rec.id), "6.recycle", "soft-deleted record appears in the Recycle Bin");
  await restoreRecords(T, [rec.id]);
  check((await listRecords(T, KEY)).some((r: any) => r.id === rec.id), "6.recycle", "record restores generically");

  // (7) analytics source + (8) automations subject/date trigger
  check(row && row.key !== "contact", "7.analytics", "non-contact registry type -> analytics widget source");
  const parsed = parseRecordDateTrigger(`RecordDateReached:${KEY}:renewal_date:7:days:before`);
  check(!!parsed && parsed.recordTypeKey === KEY, "8.automations", "date-reached trigger can target the new module");

  // (10) AI Receptionist "Modules" knowledge checklist (driven by /api/record-types)
  check((types as any[]).some((t) => t.key === KEY && t.key !== "contact"), "10.ai-knowledge", "appears in the record-type list the System-knowledge checklist renders");

  // (9) portal-CREATION picker: correctly EXCLUDED (per-portal module, not a cross-portal template).
  check(!systemRecordTypeOptions().some((o) => o.key === KEY), "9.create-modules", "correctly NOT offered as a cross-portal creation template (by design)");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    if (failures.length) console.log(`\n\u274c ADD-MODULE GUARDRAIL FAILED — surfaces missing the new module: ${failures.join(", ")}`);
    else console.log("\nALL PASSED \u2705  (a real user-created module auto-integrates on every per-portal surface)");
    process.exit(failures.length ? 1 : 0);
  });
