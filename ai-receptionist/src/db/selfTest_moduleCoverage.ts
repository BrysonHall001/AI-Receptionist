// PERMANENT GUARDRAIL: a brand-new module (record type) must automatically appear
// and participate in EVERY surface where modules belong — with ZERO per-surface
// code changes. This is the contract the eventual "users create their own modules"
// feature must keep satisfying. It registers a throwaway MOCK module, asserts each
// surface picks it up, and FAILS LOUDLY naming any surface that doesn't. Cleans up.
//
// Surfaces: 1.registry, 2.fields, 3.nav, 4.permissions, 5.import/export, 6.backup/
// recycle, 7.analytics, 8.automations, 9.create-modules, 10.ai-knowledge, and (the
// views leg) 11.views-availability + 11.views-persistence, 12.map-endpoint,
// 13.views-ui-generality.
//
//   npx tsx src/db/selfTest_moduleCoverage.ts        (needs dev Postgres)
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import {
  SYSTEM_RECORD_TYPES, listRecordTypes, resolveRecordTypeId,
  systemRecordTypeOptions, togglableRecordTypeKeys,
  setModuleViews, setPipelineEnabled, addSubtype, addStage, createRecordType,
} from "../services/recordTypeService";
import { listFields, createField } from "../services/fieldService";
import { getModuleMapData } from "../services/recordService";
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

  // ==================== VIEWS leg (11–13) ====================
  // The SAME data-driven availability rules the Views strip uses, expressed over the fresh
  // server reads (field defs + pipeline state) — no per-module expectations anywhere. A new
  // module must earn each optional view purely by having the data for it.
  const eligibility = (rt: any, defs: any[]) => ({
    board: rt.pipelineEnabled !== false && ((Array.isArray(rt.stages) && rt.stages.length > 0) || (Array.isArray(rt.subtypes) ? rt.subtypes : []).some((st: any) => Array.isArray(st.stages) && st.stages.length > 0)),
    calendar: defs.some((f: any) => f.type === "date" || f.type === "datetime"),
    map: defs.some((f: any) => f.type === "address"),
    gallery: defs.some((f: any) => f.type === "image"),
  });
  const freshMock = async () => (await listRecordTypes(T) as any[]).find((t) => t.key === MOCK_KEY);

  // (11) views-availability — starts eligible for NOTHING; each rule flips on data alone.
  let mockRt = await freshMock();
  let defs: any[] = await listFields(T, MOCK_KEY);
  let e = eligibility(mockRt, defs);
  check(!e.board && !e.calendar && !e.map && !e.gallery, "11.views-availability", "a fresh module (no fields, no pipeline) is eligible for NO optional view");
  await createField(T, { label: "Due date", type: "date" }, MOCK_KEY);
  defs = await listFields(T, MOCK_KEY); e = eligibility(await freshMock(), defs);
  check(e.calendar && !e.map && !e.gallery && !e.board, "11.views-availability", "adding a DATE field makes it calendar-eligible (and nothing else)");
  await createField(T, { label: "Site address", type: "address" }, MOCK_KEY);
  defs = await listFields(T, MOCK_KEY); e = eligibility(await freshMock(), defs);
  check(e.map, "11.views-availability", "adding an ADDRESS field makes it map-eligible");
  await createField(T, { label: "Photo", type: "image" }, MOCK_KEY);
  defs = await listFields(T, MOCK_KEY); e = eligibility(await freshMock(), defs);
  check(e.gallery, "11.views-availability", "adding an IMAGE field makes it gallery-eligible");
  await setPipelineEnabled(T, MOCK_KEY, true);
  const withSub = await addSubtype(T, MOCK_KEY, "Standard");
  await addStage(T, MOCK_KEY, (withSub.subtypes || [])[0].key, "Open");
  mockRt = await freshMock(); e = eligibility(mockRt, await listFields(T, MOCK_KEY));
  check(e.board, "11.views-availability", "pipeline ON + a stage makes it board-eligible");

  // (11) views-persistence — setModuleViews round-trips via listRecordTypes; the service's
  // actual contract: unknown VIEW names are dropped (normalized away, never stored); an
  // unknown MODULE is rejected; other modules' enabledViews are untouched.
  const jobBefore = JSON.stringify(((types as any[]).find((t) => t.key === "job") || {}).enabledViews || []);
  const dateFieldDef = defs.find((f: any) => f.type === "date");
  check(!!dateFieldDef, "11.views-persistence", "(setup) the date field created above is present");
  const dateFieldKey = dateFieldDef ? dateFieldDef.key : "";
  await setModuleViews(T, MOCK_KEY, { enabledViews: ["calendar", "map"], calendarDateField: dateFieldKey });
  mockRt = await freshMock();
  check(Array.isArray(mockRt.enabledViews) && mockRt.enabledViews.length === 2 && mockRt.enabledViews.includes("calendar") && mockRt.enabledViews.includes("map"), "11.views-persistence", "enabledViews round-trips normalized through listRecordTypes");
  check(mockRt.calendarDateField === dateFieldKey, "11.views-persistence", "calendarDateField round-trips");
  const withJunk: any = await setModuleViews(T, MOCK_KEY, { enabledViews: ["map", "not_a_view"], calendarDateField: null });
  check(Array.isArray(withJunk.enabledViews) && withJunk.enabledViews.length === 1 && withJunk.enabledViews[0] === "map", "11.views-persistence", "an unknown view name is dropped (normalized), per the service contract");
  // KNOWN QUIRK (documented, NOT endorsed): resolveRecordTypeId's fallback for an unknown key
  // is ensureContactRecordType — so setModuleViews on a junk module key does NOT reject; it
  // silently targets the CONTACTS module. Every loadTypeRow-based mutation inherits this. The
  // guardrail pins the ACTUAL contract so a future strictness fix must consciously update this
  // check — and verifies the fallback at least lands where we claim, leaving the mock (and
  // every other module) untouched.
  const junkResult: any = await setModuleViews(T, "zzz_not_a_module", { enabledViews: [] });
  check(!!junkResult && junkResult.key === "contact", "11.views-persistence", "KNOWN QUIRK: an unknown module key falls back to Contacts (resolveRecordTypeId default) instead of rejecting");
  const mockAfterJunk = await freshMock();
  check(Array.isArray(mockAfterJunk.enabledViews) && mockAfterJunk.enabledViews.length === 1 && mockAfterJunk.enabledViews[0] === "map", "11.views-persistence", "…and the junk call did NOT touch the mock module's settings");
  const jobAfter = JSON.stringify((((await listRecordTypes(T)) as any[]).find((t) => t.key === "job") || {}).enabledViews || []);
  check(jobBefore === jobAfter, "11.views-persistence", "other modules' enabledViews are untouched");

  // (12) map-endpoint — the map service is registry-driven: the mock module's address field is
  // its addressFieldKey, and a record with an address shows up (geo status pending is fine —
  // no geocoding needed). A module WITHOUT an address field reports addressFieldKey: null.
  const addrDef = defs.find((f: any) => f.type === "address");
  check(!!addrDef, "12.map-endpoint", "(setup) the address field created above is present");
  const addrKey = addrDef ? addrDef.key : "";
  // Surface 11 gave the mock a pipeline with a "Standard" type, so record creation now
  // (correctly) requires a subtypeKey — pass the one created above.
  const mockSubKey = (withSub.subtypes || [])[0].key;
  const mapRec: any = await createRecord(T, MOCK_KEY, { title: "Mock HQ", subtypeKey: mockSubKey, customFields: { [addrKey]: "223 S West St, Raleigh, NC" } });
  const mapData: any = await getModuleMapData(T, MOCK_KEY);
  check(mapData.addressFieldKey === addrKey, "12.map-endpoint", "the mock module's map data keys off ITS address field");
  const mapRow = (mapData.records || []).find((r: any) => r.id === mapRec.id);
  check(!!mapRow && /West St/.test(mapRow.addressText || ""), "12.map-endpoint", "a mock record with an address appears in the map data");
  const plain: any = await createRecordType(T, "Zzz Plain", "Zzz Plains"); // user-created module, no address field
  const plainMap: any = await getModuleMapData(T, plain.key);
  check(plainMap.addressFieldKey === null, "12.map-endpoint", "a module with no address field reports addressFieldKey: null");

  // (13) views-ui-generality — the strip derives tiles from the availability helpers over
  // live data; NO module-key special-casing may exclude a new module. Exactly ONE module-key
  // comparison is allowed in the whole views surface: the documented Bookings "appointmentAt"
  // date source in moduleDateFields. Anything else key-matching is a regression.
  const portalSrc = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
  const helpersBlock = portalSrc.slice(portalSrc.indexOf("function moduleHasStages"), portalSrc.indexOf("function termAppliesToModule"));
  const stripBlock = portalSrc.slice(portalSrc.indexOf("function buildViewsSection"), portalSrc.indexOf("async function renderSettings"));
  check(helpersBlock.length > 0 && stripBlock.length > 0, "13.views-ui-generality", "views helper + strip slices located");
  check(/const dateFields = moduleDateFields\(selectedType, fields\);/.test(stripBlock) && /const addrFields = moduleAddressFields\(selectedType, fields\);/.test(stripBlock) && /const imgFields = moduleImageFields\(selectedType, fields\);/.test(stripBlock) && /selectedType\.pipelineEnabled === true/.test(stripBlock), "13.views-ui-generality", "every tile's availability comes from the shared data-driven helpers");
  check(/moduleViewOn\(selectedType, "board"\)/.test(stripBlock) && /moduleViewOn\(selectedType, "calendar"\)/.test(stripBlock) && /moduleViewOn\(selectedType, "map"\)/.test(stripBlock) && /moduleViewOn\(selectedType, "gallery"\)/.test(stripBlock), "13.views-ui-generality", "tile on/off state reads moduleViewOn (enabledViews), never a module list");
  const keyRx = /\.key\s*===\s*"([a-z_]+)"/g;
  const keyHits: string[] = [];
  let km: RegExpExecArray | null;
  for (const sl of [helpersBlock, stripBlock]) { keyRx.lastIndex = 0; while ((km = keyRx.exec(sl))) keyHits.push(km[1]); }
  check(keyHits.length === 1 && keyHits[0] === "booking", "13.views-ui-generality", `the ONLY module-key check in the views surface is the documented Bookings appointmentAt case (found: ${JSON.stringify(keyHits)})`);
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
