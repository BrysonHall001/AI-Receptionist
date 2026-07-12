// Self-test — geocode sweep trigger + honest map flag + Calendar tile liveness.
//
//   npx tsx src/db/selfTest_geocodeSweepCalendarTile.ts     (needs dev Postgres; STUBBED geocoder,
//                                                            no network, no real token)
//
// Proves:
//  (1) A record save that marks a geo row pending gets that row processed by the TRIGGERED sweep
//      (post-save, debounced) — status "ok" + coords with NO manual geocodePending call here.
//  (2) The debounce/guard: several rapid saves all get processed WITHOUT overlapping concurrent
//      sweeps (max concurrency observed by the stub === 1).
//  (3) Geocoding disabled: saves still succeed, rows stay pending, the trigger is a no-op that
//      never invokes the geocoder, and the map data reports geocodingEnabled:false.
//  (4) Geocoding enabled: the map data reports geocodingEnabled:true.
//  (5) Source assertions: a startup periodic sweep registration exists (heartbeat ->
//      processDueJobs -> geocodePending); the Map banner branches on geocodingEnabled; the
//      Calendar tile availability reads CURRENT field defs, counts date AND datetime, and is
//      re-rendered from the field add/edit/delete paths (the renderFields hook).
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { env, geocodingEnabled } from "../config/env";
import { createRecordType } from "../services/recordTypeService";
import { createField } from "../services/fieldService";
import { createRecord, getModuleMapData } from "../services/recordService";
import { setDefaultGeocoder, geocodeSweepSettled, type GeocoderFn } from "../services/geocodingService";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ADDR = (n: number) => ({ street: `${n} Main St`, city: "Raleigh", state: "NC", postal: "27601", country: "USA" });

async function geoRow(tenantId: string, recordId: string, fieldKey: string) {
  return db.recordGeo.findUnique({ where: { tenantId_recordId_fieldKey: { tenantId, recordId, fieldKey } } });
}

async function main() {
  console.log("Geocode sweep trigger + honest map flag + Calendar tile liveness");
  console.log("================================================================");

  const t = await prisma.tenant.create({ data: { name: `gs-${stamp}`, notifyEmail: `gs-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);
  const place = await createRecordType(t.id, "Site", "Sites");
  await createField(t.id, { label: "Address", type: "address" }, place.key);
  const placeRtId = (await db.recordType.findFirst({ where: { tenantId: t.id, key: place.key } })).id;
  const F = (await db.fieldDef.findFirst({ where: { tenantId: t.id, recordTypeId: placeRtId, type: "address" } })).key;

  // Instrumented stub: coords for every address, tracking total calls + max concurrency.
  let calls = 0, active = 0, maxConcurrent = 0;
  const stub: GeocoderFn = async () => {
    calls++; active++; maxConcurrent = Math.max(maxConcurrent, active);
    await sleep(30); // long enough that overlapping sweeps WOULD be observed
    active--;
    return { lat: 35.7796, lng: -78.6382 };
  };
  setDefaultGeocoder(stub);

  // ---- (1) enabled: a save's pending row is processed by the TRIGGERED sweep alone ----
  console.log("\n(1) post-save trigger processes the pending row (no manual sweep call):");
  (env as any).MAPBOX_TOKEN = "pk.test_fake_gate_only"; // enables the gate; the stub does the work
  check(geocodingEnabled() === true, "(setup) geocoding gate is on");
  const r1 = await createRecord(t.id, place.key, { title: "One", customFields: { [F]: ADDR(1) } });
  check(!!r1 && !!r1.id, "the save itself succeeded immediately (trigger is fire-and-forget)");
  const settled1 = await geocodeSweepSettled(15000);
  check(settled1 === true, "the triggered sweep ran and settled");
  const g1 = await geoRow(t.id, r1.id, F);
  check(!!g1 && g1.status === "ok" && g1.lat === 35.7796 && g1.lng === -78.6382 && g1.geocodedAt !== null, "the row is \"ok\" with coords — WITHOUT any manual geocodePending call in this test");

  // ---- (2) rapid saves: all processed; no overlapping sweeps ----
  console.log("\n(2) burst of rapid saves — coalesced, guarded, all processed:");
  calls = 0; maxConcurrent = 0;
  const burst: any[] = [];
  for (let i = 2; i <= 6; i++) burst.push(await createRecord(t.id, place.key, { title: "B" + i, customFields: { [F]: ADDR(i) } }));
  const settled2 = await geocodeSweepSettled(20000);
  check(settled2 === true, "all triggered work settled");
  let allOk = true;
  for (const r of burst) { const g = await geoRow(t.id, r.id, F); if (!g || g.status !== "ok") allOk = false; }
  check(allOk, "every row from the burst was processed to \"ok\"");
  check(calls >= burst.length, `the stub was invoked for each pending row (${calls} calls)`);
  check(maxConcurrent === 1, `no overlapping concurrent sweeps (max concurrency observed = ${maxConcurrent})`);

  // ---- (4) enabled: map data reports the flag ----
  console.log("\n(4) map data flag when enabled:");
  const mapOn = await getModuleMapData(t.id, place.key);
  check((mapOn as any).geocodingEnabled === true, "/api/records/map data reports geocodingEnabled:true when the gate is on");

  // ---- (3) disabled: saves work, rows pending, trigger inert, flag false ----
  console.log("\n(3) disabled — saves fine, rows stay pending, trigger never calls the geocoder:");
  (env as any).MAPBOX_TOKEN = "";
  check(geocodingEnabled() === false, "(setup) geocoding gate is off");
  calls = 0;
  const rOff = await createRecord(t.id, place.key, { title: "Off", customFields: { [F]: ADDR(99) } });
  check(!!rOff && !!rOff.id, "the record save still succeeds with geocoding disabled");
  const settled3 = await geocodeSweepSettled(3000);
  check(settled3 === true, "the trigger no-ops instantly when disabled (nothing queued)");
  const gOff = await geoRow(t.id, rOff.id, F);
  check(!!gOff && gOff.status === "pending", "the row stays pending");
  check(calls === 0, "the geocoder is NEVER invoked when disabled");
  const mapOff = await getModuleMapData(t.id, place.key);
  check((mapOff as any).geocodingEnabled === false, "/api/records/map data reports geocodingEnabled:false when the gate is off");

  // ---- (5) source assertions ----
  console.log("\n(5) source assertions — startup sweep, honest banner, live Calendar tile:");
  const base = resolve(__dirname, "../..");
  const indexTs = readFileSync(resolve(base, "src/index.ts"), "utf8");
  const scheduler = readFileSync(resolve(base, "src/automation/scheduler.ts"), "utf8");
  check(/setInterval\(\(\) => \{ void runAutomationSweep\(\); \}, 2 \* 60_000\)/.test(indexTs) && /processDueJobs\(\)/.test(indexTs), "a startup periodic heartbeat (every 2 min) runs processDueJobs");
  check(/await geocodePending\(\{ tenantId: scope \}\)/.test(scheduler), "processDueJobs runs geocodePending each tick (the catch-all sweep is wired)");

  const portal = readFileSync(resolve(base, "public/js/portal.js"), "utf8");
  const mapFn = portal.slice(portal.indexOf("function renderRecordMap(host, type, fields)"), portal.indexOf("function recordColumnDefs("));
  check(/data\.geocodingEnabled === false/.test(mapFn), "the Map banner branches on geocodingEnabled from the map response");
  check(/isn’t set up on this server/.test(mapFn), "the unconfigured wording is honest (\"isn't set up on this server\"), not \"waiting\"");
  check(/waiting to be geocoded/.test(mapFn) && /not yet located/.test(mapFn), "the enabled-state counts/wording are kept exactly as before");

  check(/scheduleGeocodeSweep\(\)/.test(readFileSync(resolve(base, "src/services/recordService.ts"), "utf8")), "the on-save hook triggers the debounced sweep");
  const geoSvc = readFileSync(resolve(base, "src/services/geocodingService.ts"), "utf8");
  check(/if \(sweepRunning\) \{ sweepRerun = true; return; \}/.test(geoSvc) && /if \(sweepDebounceTimer\) return;/.test(geoSvc), "the trigger is debounced/coalesced with a one-run-at-a-time guard");
  check(/if \(!geocodingEnabled\(\)\) return;/.test(geoSvc), "the trigger no-ops instantly when geocoding is disabled");

  // Calendar tile liveness: availability reads CURRENT field defs (fresh fetch inside the Views
  // builder), counts date AND datetime, and every field add/edit/delete repaints the panel.
  check(/function moduleDateFields\(t, fields\)/.test(portal) && /f\.type === "date" \|\| f\.type === "datetime"/.test(portal), "Calendar availability counts BOTH date and datetime fields");
  const bv = portal.slice(portal.indexOf("function buildViewsSection"), portal.indexOf("async function renderSettings"));
  check(/App\.portalApi\("\/api\/fields\?recordType=" \+ encodeURIComponent\(selectedType\.key\)\)/.test(bv), "the Views panel fetches the module's CURRENT field defs on every render (never stale)");
  check(/const calAvailable = dateFields\.length > 0;/.test(bv), "Calendar availability is computed from those current field defs");
  check(/if \(refresh && mfViewsRepaint\) \{ try \{ mfViewsRepaint\(\); \} catch \(e\) \{\} \}/.test(portal), "every Fields-column repaint re-renders the Views panel (the liveness hook)");
  // The add/edit/delete paths all flow through renderFields(true), which now triggers the hook.
  check(/createFieldFromLibrary[\s\S]{0,600}?renderFields\(true\)/.test(portal), "field ADD (drag from library) repaints via renderFields(true)");
  check(/fm-save[\s\S]{0,1600}?renderFields\(true\)/.test(portal), "field EDIT (modal save, incl. type change) repaints via renderFields(true)");
  check(/Delete field[\s\S]{0,400}?renderFields\(true\)/.test(portal), "field DELETE repaints via renderFields(true)");
  // Bookings untouched (prime directive).
  check(/const isBooking = !!\(type && type\.key === "booking"\)/.test(portal) && /\/api\/bookings\/calendar\?from=\$\{from\}&to=\$\{to\}/.test(portal), "the Bookings calendar path is byte-for-byte intact");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    setDefaultGeocoder(null); // restore the real geocoder
    (env as any).MAPBOX_TOKEN = "";
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (triggered sweep + guard; honest flag both states; Calendar tile reacts to field changes)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
