// Self-test — geocoding foundation (DB + a STUBBED geocoder; no real network or token):
//
//   npx tsx src/db/selfTest_geocodeFoundation.ts     (needs dev Postgres)
//
// Proves the PRIME DIRECTIVE (record create/update is identical + always succeeds whether
// geocoding is enabled, disabled, or erroring) and the cache mechanics:
//  (1) address save -> RecordGeo "pending" with the right hash; same address again doesn't reset
//      it; changing the address -> pending + new hash; clearing -> "empty".
//  (2) two address fields tracked independently.
//  (3) geocodePending(stub ok) -> "ok" + lat/lng; (stub null) -> "failed" + lastError;
//      (stub throws) -> "failed"; in every case the record save itself already succeeded.
//  (4) geocodingEnabled() false -> saves still work, rows stay pending, sweep is a no-op that
//      never invokes the geocoder.
//  (5) create/update return the normal serialized shape and never throw when the geo hook runs.
//  (6) a module with no address field creates ZERO RecordGeo rows.
import { prisma, disconnectDb } from "./client";
import { env, geocodingEnabled } from "../config/env";
import { createRecordType } from "../services/recordTypeService";
import { createField } from "../services/fieldService";
import { createRecord, updateRecord } from "../services/recordService";
import {
  normalizeAddress, hashAddress, geocodePending, geocodeAddress,
  type GeocoderFn,
} from "../services/geocodingService";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];

const A1 = { street: "1600 Amphitheatre Pkwy", city: "Mountain View", state: "CA", postal: "94043", country: "USA" };
const A1b = { street: "1 Infinite Loop", city: "Cupertino", state: "CA", postal: "95014", country: "USA" };
const A2 = { street: "350 5th Ave", city: "New York", state: "NY", postal: "10118", country: "USA" };

function geoRows(tenantId: string, recordId: string) {
  return db.recordGeo.findMany({ where: { tenantId, recordId }, orderBy: { fieldKey: "asc" } });
}
function geoRow(tenantId: string, recordId: string, fieldKey: string) {
  return db.recordGeo.findUnique({ where: { tenantId_recordId_fieldKey: { tenantId, recordId, fieldKey } } });
}

async function main() {
  console.log("Geocoding foundation — RecordGeo cache, change detection, stubbed sweep");
  console.log("======================================================================");

  const t = await prisma.tenant.create({ data: { name: `geo-${stamp}`, notifyEmail: `geo-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);

  // --- (0) pure helpers ---
  console.log("\n(0) normalize + hash helpers:");
  check(normalizeAddress(A1) === "1600 amphitheatre pkwy, mountain view, ca, 94043, usa", "normalizeAddress joins components like fmtAddress (canonical, lower-cased)");
  check(normalizeAddress({}) === "" && normalizeAddress(null) === "" && normalizeAddress("") === "", "empty/blank addresses normalize to \"\"");
  check(hashAddress(normalizeAddress(A1)) === hashAddress(normalizeAddress(A1)) && hashAddress(normalizeAddress(A1)) !== hashAddress(normalizeAddress(A2)), "hashAddress is stable and differs for different addresses");
  const injectedOnly = await geocodeAddress("somewhere", async () => ({ lat: 1, lng: 2 }));
  check(!!injectedOnly && injectedOnly.lat === 1 && injectedOnly.lng === 2, "geocodeAddress uses the injected geocoder (no network)");

  // --- module with two address fields ---
  const place = await createRecordType(t.id, "Place", "Places");
  await createField(t.id, { label: "Address 1", type: "address" }, place.key);
  await createField(t.id, { label: "Address 2", type: "address" }, place.key);
  // resolve the generated field keys (slugified from labels)
  const placeFields: any[] = await db.fieldDef.findMany({ where: { tenantId: t.id, recordTypeId: (await db.recordType.findFirst({ where: { tenantId: t.id, key: place.key } })).id, type: "address" }, orderBy: { order: "asc" } });
  const F1 = placeFields[0].key, F2 = placeFields[1].key;

  // --- (5)+(1) create with an address returns the normal shape; row is pending with right hash ---
  console.log("\n(1) address save -> pending; unchanged -> untouched; changed -> pending; cleared -> empty:");
  const rec = await createRecord(t.id, place.key, { title: "HQ", customFields: { [F1]: A1 } });
  check(!!rec && typeof rec.id === "string" && "customFields" in rec && "createdAt" in rec, "createRecord returns the normal serialized shape (unchanged)");
  let r1 = await geoRow(t.id, rec.id, F1);
  check(!!r1 && r1.status === "pending" && r1.lat === null && r1.lng === null, "address field -> RecordGeo row status \"pending\", null coords");
  check(!!r1 && r1.addressHash === hashAddress(normalizeAddress(A1)), "the row's hash matches the normalized address");

  // same address again -> NOT reset (row not rewritten: same hash, same updatedAt)
  const before = r1.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  await updateRecord(t.id, rec.id, { customFields: { [F1]: A1 } });
  r1 = await geoRow(t.id, rec.id, F1);
  check(!!r1 && r1.status === "pending" && +new Date(r1.updatedAt) === +new Date(before), "saving the SAME address again leaves the row untouched (cache hit)");

  // change the address -> pending with a NEW hash
  await updateRecord(t.id, rec.id, { customFields: { [F1]: A1b } });
  r1 = await geoRow(t.id, rec.id, F1);
  check(!!r1 && r1.status === "pending" && r1.addressHash === hashAddress(normalizeAddress(A1b)), "changing the address flips it back to pending with a new hash");

  // clear the address -> empty
  await updateRecord(t.id, rec.id, { customFields: { [F1]: null } });
  r1 = await geoRow(t.id, rec.id, F1);
  check(!!r1 && r1.status === "empty" && r1.lat === null, "clearing the address -> status \"empty\"");

  // --- (2) two address fields independent ---
  console.log("\n(2) two address fields tracked independently:");
  const rec2 = await createRecord(t.id, place.key, { title: "Two", customFields: { [F1]: A1, [F2]: A2 } });
  let rows2 = await geoRows(t.id, rec2.id);
  check(rows2.length === 2 && rows2.every((r: any) => r.status === "pending"), "both address fields get their own pending row");
  await updateRecord(t.id, rec2.id, { customFields: { [F1]: A1b } }); // change only F1
  const g1 = await geoRow(t.id, rec2.id, F1), g2 = await geoRow(t.id, rec2.id, F2);
  check(!!g1 && g1.addressHash === hashAddress(normalizeAddress(A1b)), "changing one field updates only its row");
  check(!!g2 && g2.addressHash === hashAddress(normalizeAddress(A2)), "the other field's row is unchanged");

  // --- (4) disabled: saves work, rows pending, sweep no-op, geocoder NEVER called ---
  console.log("\n(4) geocoding disabled (no token) -> saves work, sweep is an inert no-op:");
  (env as any).MAPBOX_TOKEN = ""; // ensure disabled
  check(geocodingEnabled() === false, "geocodingEnabled() is false with no token");
  let calledWhenDisabled = false;
  const spyStub: GeocoderFn = async () => { calledWhenDisabled = true; return { lat: 0, lng: 0 }; };
  const recD = await createRecord(t.id, place.key, { title: "Disabled", customFields: { [F1]: A1 } });
  const rowD = await geoRow(t.id, recD.id, F1);
  check(!!rowD && rowD.status === "pending", "with geocoding off, the address row is still marked pending on save");
  const sweepOff = await geocodePending({ tenantId: t.id }, spyStub);
  check(sweepOff.skipped === true && sweepOff.processed === 0, "geocodePending returns immediately (skipped) when disabled");
  check(calledWhenDisabled === false, "the geocoder is NEVER invoked when disabled");
  const rowDafter = await geoRow(t.id, recD.id, F1);
  check(!!rowDafter && rowDafter.status === "pending", "rows stay pending when disabled");

  // --- (3) enabled sweep: ok / failed / throws, with a stub ---
  console.log("\n(3) enabled sweep (stubbed geocoder): ok / failed / throws:");
  (env as any).MAPBOX_TOKEN = "pk.test_fake_token_not_used_by_stub"; // flip enabled (stub still used)
  check(geocodingEnabled() === true, "geocodingEnabled() is true once a token is set");

  // ok: stub returns coords (Mapbox order is [lng,lat] but geocodeAddress returns {lat,lng})
  const okStub: GeocoderFn = async () => ({ lat: 37.4221, lng: -122.0841 });
  const recOk = await createRecord(t.id, place.key, { title: "OK", customFields: { [F1]: A1 } });
  check(!!recOk && !!recOk.id, "the record save succeeded before any geocoding ran");
  const sOk = await geocodePending({ tenantId: t.id, delayMs: 0 }, okStub);
  check(sOk.skipped === false && sOk.processed >= 1, "the sweep processed pending rows when enabled");
  const rowOk = await geoRow(t.id, recOk.id, F1);
  check(!!rowOk && rowOk.status === "ok" && rowOk.lat === 37.4221 && rowOk.lng === -122.0841 && rowOk.geocodedAt !== null, "a resolved row -> status \"ok\" with lat/lng (not swapped) + geocodedAt");

  // failed: stub returns null
  const nullStub: GeocoderFn = async () => null;
  const recFail = await createRecord(t.id, place.key, { title: "Fail", customFields: { [F1]: A2 } });
  await geocodePending({ tenantId: t.id, delayMs: 0 }, nullStub);
  const rowFail = await geoRow(t.id, recFail.id, F1);
  check(!!rowFail && rowFail.status === "failed" && !!rowFail.lastError, "a null geocoder result -> status \"failed\" with lastError");

  // throws: stub throws — sweep swallows, marks failed, record already saved
  const throwStub: GeocoderFn = async () => { throw new Error("boom"); };
  const recThrow = await createRecord(t.id, place.key, { title: "Throw", customFields: { [F1]: A1b } });
  check(!!recThrow && !!recThrow.id, "the record save succeeded even though the (later) geocoder will throw");
  let sweepThrew = false;
  try { await geocodePending({ tenantId: t.id, delayMs: 0 }, throwStub); } catch { sweepThrew = true; }
  check(sweepThrew === false, "geocodePending swallows a throwing geocoder (never throws out)");
  const rowThrow = await geoRow(t.id, recThrow.id, F1);
  check(!!rowThrow && rowThrow.status === "failed" && !!rowThrow.lastError, "a throwing geocoder -> row marked \"failed\" with lastError");

  // --- (5b) update returns normal shape + never throws with an odd address value ---
  console.log("\n(5) create/update never throw through the geo hook:");
  let threw = false; let upd: any = null;
  try { upd = await updateRecord(t.id, recOk.id, { title: "Renamed", customFields: { [F1]: 12345 as any } }); }
  catch { threw = true; }
  check(threw === false && !!upd && upd.title === "Renamed", "updateRecord returns normally even with an odd address value (hook swallowed)");

  // --- (6) module with NO address field -> zero rows ---
  console.log("\n(6) a module with no address field creates ZERO RecordGeo rows:");
  const note = await createRecordType(t.id, "Note", "Notes");
  await createField(t.id, { label: "Body", type: "textarea" }, note.key);
  const recNote = await createRecord(t.id, note.key, { title: "n", customFields: { body: "hi" } });
  const noteRows = await geoRows(t.id, recNote.id);
  check(noteRows.length === 0, "no address field -> no RecordGeo rows (no-op)");

  (env as any).MAPBOX_TOKEN = ""; // leave disabled
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (cache pending/ok/failed/empty; two fields independent; disabled no-op; saves always succeed)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
