// Self-test — Map view (Map B). DB checks for the /api/records/map data + source-assertion
// checks for the vendored Leaflet, the Views-tile availability rule, and the list view mode.
//
//   npx tsx src/db/selfTest_mapView.ts     (needs dev Postgres)
//
// Proves:
//  (1) getModuleMapData returns located records (status "ok") with lat/lng, and pending/failed
//      records with null coords + their geoStatus; a module with no address field returns
//      { addressFieldKey: null, records: [] }; tenant scoping is enforced.
//  (2) the primary address field is the FIRST address field by order when there are several.
//  (3) Leaflet is vendored under public/js/vendor/leaflet/ and referenced (not via CDN);
//      the Map Views-tile availability keys off an address field; renderRecordList registers a
//      map view mode; the /records/map route is registered before /records/:id.
//  (4) PRIME DIRECTIVE (additive): the Bookings calendar + generalized Calendar list wiring and
//      the table view are untouched by this batch.
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { createRecordType } from "../services/recordTypeService";
import { createField } from "../services/fieldService";
import { createRecord } from "../services/recordService";
import { getModuleMapData } from "../services/recordService";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];

const ADDR = { street: "1600 Amphitheatre Pkwy", city: "Mountain View", state: "CA", postal: "94043", country: "USA" };

async function rtId(tenantId: string, key: string) { return (await db.recordType.findFirst({ where: { tenantId, key } })).id; }
async function setGeo(tenantId: string, recordId: string, fieldKey: string, patch: any) {
  await db.recordGeo.update({ where: { tenantId_recordId_fieldKey: { tenantId, recordId, fieldKey } }, data: patch });
}

async function main() {
  console.log("Map view — /api/records/map data + Leaflet/Views wiring");
  console.log("======================================================");

  const t = await prisma.tenant.create({ data: { name: `map-${stamp}`, notifyEmail: `map-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);

  // Module WITH two address fields (to test primary-by-order) + a title.
  const place = await createRecordType(t.id, "Place", "Places");
  await createField(t.id, { label: "Site address", type: "address" }, place.key);   // order 0 -> primary
  await createField(t.id, { label: "Billing address", type: "address" }, place.key); // order 1
  const placeRtId = await rtId(t.id, place.key);
  const addrDefs: any[] = await db.fieldDef.findMany({ where: { tenantId: t.id, recordTypeId: placeRtId, type: "address" }, orderBy: { order: "asc" } });
  const F1 = addrDefs[0].key, F2 = addrDefs[1].key;

  // (2) primary address field = first by order.
  console.log("\n(2) primary address field:");
  const mapMeta = await getModuleMapData(t.id, place.key);
  check(mapMeta.addressFieldKey === F1, "the module's primary address field is the FIRST address field by order");

  // Seed three records: one "ok" (with coords), one pending, one failed.
  const okRec = await createRecord(t.id, place.key, { title: "Googleplex", customFields: { [F1]: ADDR } });
  await setGeo(t.id, okRec.id, F1, { status: "ok", lat: 37.4221, lng: -122.0841, addressHash: "seed" });
  const pendRec = await createRecord(t.id, place.key, { title: "Pending Place", customFields: { [F1]: { street: "1 Infinite Loop", city: "Cupertino", state: "CA" } } });
  // (on-save hook already created a pending row for pendRec)
  const failRec = await createRecord(t.id, place.key, { title: "Failed Place", customFields: { [F1]: { street: "Nowhere" } } });
  await setGeo(t.id, failRec.id, F1, { status: "failed", lastError: "No result" });

  console.log("\n(1) endpoint data (located + not-located + tenant scoping):");
  const data = await getModuleMapData(t.id, place.key);
  const byId: Record<string, any> = {}; data.records.forEach((r: any) => (byId[r.id] = r));
  check(data.addressFieldKey === F1, "addressFieldKey is the primary field");
  check(!!byId[okRec.id] && byId[okRec.id].lat === 37.4221 && byId[okRec.id].lng === -122.0841 && byId[okRec.id].geoStatus === "ok", "an \"ok\" record carries its lat/lng + geoStatus \"ok\"");
  check(!!byId[okRec.id] && /Amphitheatre/.test(byId[okRec.id].addressText), "the record carries a human-readable addressText");
  check(!!byId[pendRec.id] && byId[pendRec.id].lat === null && byId[pendRec.id].lng === null && byId[pendRec.id].geoStatus === "pending", "a pending record has null coords + geoStatus \"pending\"");
  check(!!byId[failRec.id] && byId[failRec.id].lat === null && byId[failRec.id].geoStatus === "failed", "a failed record has null coords + geoStatus \"failed\"");

  // Tenant scoping: a second tenant's records never appear in the first tenant's map data.
  const t2 = await prisma.tenant.create({ data: { name: `map2-${stamp}`, notifyEmail: `map2-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t2.id);
  const place2 = await createRecordType(t2.id, "Place", "Places");
  await createField(t2.id, { label: "Site address", type: "address" }, place2.key);
  const other = await createRecord(t2.id, place2.key, { title: "Other Tenant Place", customFields: { [F1]: ADDR } });
  const data1again = await getModuleMapData(t.id, place.key);
  check(!data1again.records.some((r: any) => r.id === other.id), "another tenant's records never appear (tenant-scoped)");

  // Module with NO address field.
  console.log("\n(1b) module with no address field:");
  const note = await createRecordType(t.id, "Note", "Notes");
  await createField(t.id, { label: "Body", type: "textarea" }, note.key);
  await createRecord(t.id, note.key, { title: "n", customFields: { body: "hi" } });
  const noneData = await getModuleMapData(t.id, note.key);
  check(noneData.addressFieldKey === null && noneData.records.length === 0, "no address field -> { addressFieldKey: null, records: [] }");

  // (3) source-assertion checks.
  console.log("\n(3) Leaflet vendored + Views/list wiring (source assertions):");
  const base = resolve(__dirname, "../..");
  check(existsSync(resolve(base, "public/js/vendor/leaflet/leaflet.js")), "Leaflet JS is vendored under public/js/vendor/leaflet/");
  check(existsSync(resolve(base, "public/js/vendor/leaflet/leaflet.css")), "Leaflet CSS is vendored under public/js/vendor/leaflet/");
  check(existsSync(resolve(base, "public/js/vendor/leaflet/images/marker-icon.png")), "Leaflet marker icon images are vendored");
  const indexHtml = readFileSync(resolve(base, "public/index.html"), "utf8");
  check(/\/js\/vendor\/leaflet\/leaflet\.js/.test(indexHtml) && /\/js\/vendor\/leaflet\/leaflet\.css/.test(indexHtml), "index.html references the vendored Leaflet JS + CSS");
  check(!/unpkg\.com\/leaflet|cdnjs\.[^"']*leaflet|cdn\.jsdelivr[^"']*leaflet|leafletjs\.com/i.test(indexHtml), "Leaflet is NOT loaded from a CDN");

  const portal = readFileSync(resolve(base, "public/js/portal.js"), "utf8");
  check(/function moduleAddressFields\(t, fields\)/.test(portal) && /f\.type === "address"/.test(portal), "moduleAddressFields keys off address-type fields");
  const bv = portal.slice(portal.indexOf("function buildViewsSection"), portal.indexOf("async function renderSettings"));
  check(/const mapAvailable = addrFields\.length > 0;/.test(bv), "the Map Views-tile availability keys off the presence of an address field");
  check(/name: "Map", available: mapAvailable/.test(bv), "the Map tile uses that availability (no longer \"Coming soon\")");
  check(/name: "Gallery", comingSoon: true/.test(bv), "Gallery is still \"Coming soon\" (untouched)");
  check(/function moduleMapEnabled\(t\) \{ return moduleViewOn\(t, "map"\); \}/.test(portal), "moduleMapEnabled keys off the map view flag");
  check(/if \(moduleMapEnabled\(type\)\) \{/.test(portal) && /renderRecordMap\(mapArea, type, fields\)/.test(portal), "renderRecordList registers a map view mode (renderRecordMap)");
  check(/function renderRecordMap\(host, type, fields\)/.test(portal), "renderRecordMap exists");
  check(/openstreetmap\.org/i.test(portal) && /OpenStreetMap<\/a> contributors/.test(portal), "the map uses OSM tiles with the required OSM attribution");
  check(/L\.marker\(\[r\.lat, r\.lng\]/.test(portal) && /"#\/record\/" \+ r\.id/.test(portal), "pins are placed and their popup links to the record detail route");
  check(/of \$\{all\.length\} located/.test(portal) && /not yet located/.test(portal), "a status line reports located vs not-yet-located counts");

  const api = readFileSync(resolve(base, "src/routes/api.ts"), "utf8");
  check(api.indexOf('apiRouter.get("/records/map"') >= 0 && api.indexOf('apiRouter.get("/records/map"') < api.indexOf('apiRouter.get("/records/:id"'), "the /records/map route is registered BEFORE /records/:id");

  // (4) additive: existing calendar/table wiring untouched.
  console.log("\n(4) additive — existing views untouched:");
  check(/if \(moduleCalendarEnabled\(type\)\) \{/.test(portal) && /renderBookingCalendar\(calArea, type, fields, \{ dateField: moduleCalendarField\(type, fields\) \}\)/.test(portal), "the Calendar block (incl. Bookings) is unchanged");
  check(/const isBooking = !!\(type && type\.key === "booking"\)/.test(portal), "the Bookings calendar path is intact");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (map data: ok/pending/failed + scoping + primary field; Leaflet vendored; additive)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
