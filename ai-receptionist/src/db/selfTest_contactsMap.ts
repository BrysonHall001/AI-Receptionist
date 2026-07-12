// Self-test — contacts on the map. DB checks with a STUBBED geocoder (setDefaultGeocoder — no
// network, no real token) + source assertions on the shared frontend plumbing.
//
//   npx tsx src/db/selfTest_contactsMap.ts     (needs dev Postgres)
//
// Proves:
//  (1) Contact create/update with an address -> ContactGeo "pending" with the correct hash;
//      same address re-saved -> row untouched; changed -> re-pending with a new hash;
//      cleared -> "empty"; a portal whose contact type has NO address field -> zero rows.
//  (2) ONE geocodePending run processes pending rows from BOTH tables (a record row and a
//      contact row both end "ok" with coords in the same sweep).
//  (3) importContacts and mergeContacts run the geo hook (merge: the SURVIVOR's row reflects
//      the merged address).
//  (4) getContactsMapData (the /api/contacts/map service): located + unlocated contacts
//      correct, geocodingEnabled reported for both gate states, tenant scoping enforced,
//      addressFieldKey:null when Contacts has no address field.
//  (5) PRIME DIRECTIVE: contact saves never throw and keep their return shapes when the
//      stubbed geocoder throws or the gate is off.
//  (6) Source assertions: buildViewsSection no longer early-returns for Contacts and offers
//      them ONLY the Map tile; renderContacts mounts the SHARED map component (no duplicated
//      Leaflet block); every listed contactService write path calls the geo hook.
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { env, geocodingEnabled } from "../config/env";
import { listFields, deleteField } from "../services/fieldService";
import { createRecordType } from "../services/recordTypeService";
import { createField } from "../services/fieldService";
import { createRecord } from "../services/recordService";
import { createContact, updateContact, importContacts, mergeContacts, getContactsMapData } from "../services/contactService";
import { setDefaultGeocoder, geocodePending, geocodeSweepSettled, normalizeAddress, hashAddress, type GeocoderFn } from "../services/geocodingService";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];

const A1 = { street: "223 S West St", city: "Raleigh", state: "NC", postal: "27603", country: "USA" };
const A2 = { street: "500 Fayetteville St", city: "Raleigh", state: "NC", postal: "27601", country: "USA" };

async function mkTenant(tag: string) {
  const t = await prisma.tenant.create({ data: { name: `${tag}-${stamp}`, notifyEmail: `${tag}-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);
  return t.id;
}
function cgRow(tenantId: string, contactId: string, fieldKey: string) {
  return db.contactGeo.findUnique({ where: { tenantId_contactId_fieldKey: { tenantId, contactId, fieldKey } } });
}

async function main() {
  console.log("Contacts on the map — ContactGeo lifecycle, shared sweep, map data, shared UI");
  console.log("=============================================================================");

  setDefaultGeocoder(async () => ({ lat: 35.7796, lng: -78.6382 }));
  (env as any).MAPBOX_TOKEN = ""; // start disabled so on-save triggers stay inert while seeding

  const T = await mkTenant("cm");
  await listFields(T, "contact"); // seeds the contact system fields + the default address field
  const F = "address";

  // ---- (1) lifecycle ----
  console.log("\n(1) ContactGeo lifecycle (pending / cache-hit / re-pending / empty):");
  const c1 = await createContact(T, { name: "Ada", phone: "+15550001111", email: "ada@ex.com", customFields: { [F]: A1 } });
  check(!!c1 && !!c1.id && "customFields" in c1, "createContact returns the normal contact row (shape unchanged)");
  let g = await cgRow(T, c1.id, F);
  check(!!g && g.status === "pending" && g.lat === null, "an address on create -> ContactGeo \"pending\" with null coords");
  check(!!g && g.addressHash === hashAddress(normalizeAddress(A1)), "the row's hash matches the normalized address");

  const before = g.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  await updateContact(c1.id, T, { customFields: { [F]: A1 } });
  g = await cgRow(T, c1.id, F);
  check(!!g && +new Date(g.updatedAt) === +new Date(before), "re-saving the SAME address leaves the row untouched (cache hit)");

  await updateContact(c1.id, T, { customFields: { [F]: A2 } });
  g = await cgRow(T, c1.id, F);
  check(!!g && g.status === "pending" && g.addressHash === hashAddress(normalizeAddress(A2)), "a changed address -> re-pending with a new hash");

  await updateContact(c1.id, T, { customFields: { [F]: null } });
  g = await cgRow(T, c1.id, F);
  check(!!g && g.status === "empty", "a cleared address -> \"empty\"");

  // No address field on the contact type -> zero rows.
  const T0 = await mkTenant("cm0");
  const f0 = await listFields(T0, "contact");
  const addr0 = f0.find((f: any) => f.key === F);
  if (addr0) await deleteField(T0, addr0.id); // remove the default address field entirely
  const c0 = await createContact(T0, { name: "NoAddr", phone: "+15550002222", email: "noaddr@ex.com", customFields: {} });
  const rows0 = await db.contactGeo.findMany({ where: { tenantId: T0, contactId: c0.id } });
  check(rows0.length === 0, "a contact type with NO address field creates zero ContactGeo rows (no-op)");

  // ---- (2) one sweep, two tables ----
  console.log("\n(2) one geocodePending run processes BOTH tables:");
  const place = await createRecordType(T, "Site", "Sites");
  await createField(T, { label: "Address", type: "address" }, place.key);
  const placeRtId = (await db.recordType.findFirst({ where: { tenantId: T, key: place.key } })).id;
  const RF = (await db.fieldDef.findFirst({ where: { tenantId: T, recordTypeId: placeRtId, type: "address" } })).key;
  const rec = await createRecord(T, place.key, { title: "HQ", customFields: { [RF]: A1 } });
  await updateContact(c1.id, T, { customFields: { [F]: A1 } }); // contact pending again
  await geocodeSweepSettled(3000); // no-op while disabled; just makes sure nothing is queued

  (env as any).MAPBOX_TOKEN = "pk.test_fake_gate_only"; // enable the gate (stub does the work)
  check(geocodingEnabled() === true, "(setup) gate on");
  const sweep = await geocodePending({ tenantId: T, delayMs: 0 });
  check(sweep.skipped === false && sweep.processed >= 2, `one sweep processed rows from both tables (${sweep.processed} rows)`);
  const rg = await db.recordGeo.findUnique({ where: { tenantId_recordId_fieldKey: { tenantId: T, recordId: rec.id, fieldKey: RF } } });
  const cg = await cgRow(T, c1.id, F);
  check(!!rg && rg.status === "ok" && rg.lat === 35.7796, "the RECORD row ended \"ok\" with coords");
  check(!!cg && cg.status === "ok" && cg.lng === -78.6382, "the CONTACT row ended \"ok\" with coords — same run, same stub");
  (env as any).MAPBOX_TOKEN = "";

  // ---- (3) import + merge mark stale ----
  console.log("\n(3) import + merge run the geo hook:");
  const imp = await importContacts(T, [{ name: "Imp One", phone: "+15550003333", email: "imp1@ex.com" }] as any);
  check(imp.imported === 1, "(setup) import succeeded with its normal return shape");
  const impC = await prisma.contact.findFirst({ where: { tenantId: T, phone: "+15550003333" } as any });
  const impG = impC ? await cgRow(T, impC.id, F) : null;
  check(!!impG, "importContacts runs the geo hook (a ContactGeo row exists for the imported contact)");
  check(!!impG && impG.status === "empty", "…as \"empty\" — imports don't carry address values today, so the hook correctly records a blank address");

  const survivor = await createContact(T, { name: "Survivor", phone: "+15550004444", email: "surv@ex.com", customFields: {} });
  const loser = await createContact(T, { name: "Loser", phone: "+15550005555", email: "loser@ex.com", customFields: { [F]: A2 } });
  // The merge UI passes the chosen field values; choose the LOSER\u2019s address for the survivor.
  const merged = await mergeContacts(T, survivor.id, [loser.id], { [F]: A2 });
  check(!!merged && merged.id === survivor.id, "mergeContacts returns the survivor (shape unchanged)");
  const mCf: any = (merged as any).customFields || {};
  const mg = await cgRow(T, survivor.id, F);
  check(!!mg && mg.addressHash === hashAddress(normalizeAddress(mCf[F])), "the SURVIVOR's geo row reflects the merged address (hash matches its final customFields)");

  // ---- (4) map data ----
  console.log("\n(4) getContactsMapData (the /api/contacts/map service):");
  // c1 is "ok" from the sweep; make one pending contact for the unlocated bucket.
  const cPend = await createContact(T, { name: "Pending Pete", phone: "+15550006666", email: "pete@ex.com", customFields: { [F]: A2 } });
  (env as any).MAPBOX_TOKEN = "pk.test_fake_gate_only";
  const mapOn = await getContactsMapData(T);
  const byId: Record<string, any> = {}; mapOn.records.forEach((r: any) => (byId[r.id] = r));
  check(mapOn.addressFieldKey === F && mapOn.geocodingEnabled === true, "addressFieldKey is the primary contact address field; geocodingEnabled:true when on");
  check(!!byId[c1.id] && byId[c1.id].lat === 35.7796 && byId[c1.id].geoStatus === "ok" && /West St/.test(byId[c1.id].addressText), "a located contact carries lat/lng + \"ok\" + readable addressText");
  check(!!byId[cPend.id] && byId[cPend.id].lat === null && byId[cPend.id].geoStatus === "pending", "an unlocated contact carries null coords + its geoStatus");
  check(!!byId[c1.id] && byId[c1.id].name === "Ada", "contacts carry their NAME (not a record title)");
  (env as any).MAPBOX_TOKEN = "";
  const mapOff = await getContactsMapData(T);
  check(mapOff.geocodingEnabled === false, "geocodingEnabled:false when the gate is off");
  // Tenant scoping: T0's contact never appears in T's data.
  check(!mapOn.records.some((r: any) => r.id === c0.id), "another tenant's contacts never appear (tenant-scoped)");
  const mapNone = await getContactsMapData(T0); // T0 has no address field anymore
  check(mapNone.addressFieldKey === null && mapNone.records.length === 0, "no address field -> { addressFieldKey: null, records: [] }");

  // ---- (5) saves never throw ----
  console.log("\n(5) contact saves never throw through the geo hook:");
  setDefaultGeocoder(async () => { throw new Error("boom"); });
  (env as any).MAPBOX_TOKEN = "pk.test_fake_gate_only";
  let threw = false; let odd: any = null;
  try { odd = await createContact(T, { name: "Odd", phone: "+15550007777", email: "odd@ex.com", customFields: { [F]: 12345 as any } }); } catch { threw = true; }
  check(threw === false && !!odd && !!odd.id, "createContact succeeds with an odd address value even with a THROWING geocoder");
  let threw2 = false;
  try { await updateContact(odd.id, T, { name: "Odd 2" }); } catch { threw2 = true; }
  check(threw2 === false, "updateContact never throws through the hook");
  await geocodeSweepSettled(15000); // let the fire-and-forget trigger drain (stub throws → rows just fail)
  (env as any).MAPBOX_TOKEN = "";

  // ---- (6) source assertions ----
  console.log("\n(6) shared UI plumbing (source assertions):");
  const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
  const bv = portal.slice(portal.indexOf("function buildViewsSection"), portal.indexOf("async function renderSettings"));
  check(!/Contacts have no optional views/.test(bv) && !/selectedType\.key === "contact"\) return/.test(bv), "buildViewsSection no longer early-returns for Contacts");
  check(/const isContact = selectedType\.key === "contact";/.test(bv), "Contacts are branch-detected instead");
  const boardIdx = bv.indexOf("// BOARD — available"), calIdx = bv.indexOf("// CALENDAR — available"), mapIdx = bv.indexOf("// MAP — available"), galIdx = bv.indexOf("// GALLERY — available");
  const guard1 = bv.lastIndexOf("if (!isContact) {", boardIdx);
  const guard1Close = bv.indexOf("\n        }", calIdx); // the record-only branch closes after Calendar, before Map
  const guard2 = bv.lastIndexOf("if (!isContact) {", galIdx);
  check(guard1 >= 0 && guard1 < boardIdx && boardIdx < calIdx && calIdx < guard1Close && guard1Close < mapIdx, "Board + Calendar are wrapped in a record-only branch that CLOSES before the Map tile");
  check(guard2 > mapIdx && guard2 < galIdx, "Gallery is wrapped in its own record-only branch AFTER the Map tile");
  check(bv.lastIndexOf("if (!isContact) {", mapIdx) === guard1 && guard1Close < mapIdx, "the Map tile sits between the two branches — the ONLY tile Contacts see");

  const rc = portal.slice(portal.indexOf("async function renderContacts()"), portal.indexOf("function openManageColumns("));
  check(/moduleMapEnabled\(contactType\)/.test(rc), "the Contacts page offers map mode only when the contact type's Map view is on");
  check(/mountGeoMap\(mapHost, \{/.test(rc) && /url: "\/api\/contacts\/map"/.test(rc), "renderContacts mounts the SHARED map component against /api/contacts/map");
  check(/"#\/contact\/" \+ r\.id/.test(rc), "contact pins link to the contact detail route");
  check(!/L\.map\(/.test(rc) && !/tileLayer/.test(rc), "no duplicated Leaflet block in renderContacts (all Leaflet lives in the shared component)");
  check(/function mountGeoMap\(host, cfg\)/.test(portal) && /mountGeoMap\(host, \{\s*\n\s*url: "\/api\/records\/map\?type="/.test(portal), "renderRecordMap uses the same shared component (records flavor)");

  const csvc = readFileSync(resolve(__dirname, "../../src/services/contactService.ts"), "utf8");
  for (const fn of ["createOrUpdateContact", "updateContact", "createContact", "mergeContacts", "generateDummyContact"]) {
    const seg = csvc.slice(csvc.indexOf(`export async function ${fn}`));
    const segEnd = seg.slice(0, seg.indexOf("\nexport ") > 0 ? seg.indexOf("\nexport ") : undefined);
    check(/markContactGeoSafe\(/.test(segEnd), `${fn} calls the geo hook`);
  }
  check(/markContactGeoSafe\(tenantId, c\)/.test(csvc.slice(csvc.indexOf("export async function importContacts"))), "importContacts calls the geo hook (email-only branch; the phone branch flows through the hooked createOrUpdateContact)");
  check(/markContactGeoSafe\(tenantId, \{ id: c\.id, customFields: cf \}\)/.test(csvc), "bulkUpdateField calls the geo hook (custom-field branch)");
  const api = readFileSync(resolve(__dirname, "../../src/routes/api.ts"), "utf8");
  check(api.indexOf('apiRouter.get("/contacts/map"') >= 0 && api.indexOf('apiRouter.get("/contacts/map"') < api.indexOf('apiRouter.get("/contacts/:id"'), "the /contacts/map route is registered BEFORE /contacts/:id");
  const bf = readFileSync(resolve(__dirname, "backfillGeocode.ts"), "utf8");
  check(/markContactGeoStale\(grp\.tenantId, c, grp\.defs\)/.test(bf), "the backfill script covers contacts too");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    setDefaultGeocoder(null);
    (env as any).MAPBOX_TOKEN = "";
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    try { await db.appSetting.deleteMany({ where: { key: { in: tenantIds.map((id) => "contacts_default_fields_seeded:" + id) } } }); } catch {}
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (contact geo lifecycle; one sweep two tables; import/merge hooked; map data + scoping; saves never throw; shared UI)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
