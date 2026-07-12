// Self-test — Contacts default Address field + Mapbox integration status tile.
//
//   npx tsx src/db/selfTest_contactsAddressMapboxTile.ts     (needs dev Postgres)
//
// Proves:
//  (1) After contact fields load, the tenant's Contacts have a default "address" custom field:
//      type "address", system:false (editable/removable), stored as a NORMAL custom field.
//      Seeding is idempotent (running twice creates no duplicate), and once seeded, DELETING the
//      field and reloading does NOT re-create it (the one-shot marker).
//  (2) Existing-portal path: a tenant whose contact SYSTEM fields already exist still gains the
//      address field on the next fields load (lazy backfill, no separate script).
//  (3) /api/settings includes geocoding.enabled reflecting geocodingEnabled(), for both an unset
//      and a set token state (flipped in-process on the env object; no real token needed).
//  (4) Source assertions: renderIntegrations adds a Mapbox tile referencing /img/mapbox.png that
//      reads geocoding.enabled and renders NO editable input/toggle; the three existing tiles are
//      unchanged. PRIME DIRECTIVE: contact system fields + save path untouched.
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { env, geocodingEnabled } from "../config/env";
import { listFields, ensureSystemFields, ensureContactDefaultFields, deleteField, SYSTEM_KEYS } from "../services/fieldService";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];

async function mkTenant(tag: string) {
  const t = await prisma.tenant.create({ data: { name: `${tag}-${stamp}`, notifyEmail: `${tag}-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);
  return t.id;
}
const addrOf = (fields: any[]) => fields.find((f: any) => f.key === "address");

async function main() {
  console.log("Contacts default Address field + Mapbox tile");
  console.log("============================================");

  // --- (1) fresh tenant: field appears on fields load; correct shape; idempotent; delete sticks ---
  console.log("\n(1) fresh tenant — seeded on fields load; idempotent; deletion is respected:");
  const T = await mkTenant("cam");
  const fields1 = await listFields(T, "contact");
  const addr1 = addrOf(fields1);
  check(!!addr1, "Contacts gain a default \"address\" field after fields load");
  check(!!addr1 && addr1.type === "address" && addr1.system === false && addr1.order === 4 && addr1.label === "Address", "it is type \"address\", system:false (normal custom field), label \"Address\", order 4");
  // Idempotent: run the seeder again explicitly + reload — still exactly one.
  await ensureContactDefaultFields(T);
  const fields1b = await listFields(T, "contact");
  check(fields1b.filter((f: any) => f.key === "address").length === 1, "running the seeder twice creates no duplicate");
  // System fields untouched (prime directive).
  const sysKeys = fields1b.filter((f: any) => f.system).map((f: any) => f.key).sort();
  check(JSON.stringify(sysKeys) === JSON.stringify([...SYSTEM_KEYS].sort()), "the contact SYSTEM fields are exactly as before (untouched)");
  // Delete it (allowed — it's not a system field), then reload: NOT re-created.
  await deleteField(T, addr1.id);
  const fields1c = await listFields(T, "contact");
  check(!addrOf(fields1c), "deleting the address field and reloading does NOT re-create it (one-shot seed)");

  // --- (2) existing-portal path: system fields pre-exist; address still backfills lazily ---
  console.log("\n(2) existing portal — lazy backfill:");
  const T2 = await mkTenant("cam2");
  await ensureSystemFields(T2); // simulate a portal that predates this batch (system fields already there)
  const preSys = await db.fieldDef.count({ where: { tenantId: T2, system: true } });
  check(preSys === SYSTEM_KEYS.length, "(setup) the existing portal already has its contact system fields");
  const fields2 = await listFields(T2, "contact");
  check(!!addrOf(fields2), "the existing portal still gains the address field on the next fields load");

  // --- (3) /api/settings carries geocoding.enabled (both token states) ---
  console.log("\n(3) settings expose geocoding.enabled (both states):");
  const { getSettingsHandler } = await import("../routes/api");
  function fakeRes() { const out: any = { status: (c: number) => { out.code = c; return out; }, json: (b: any) => { out.body = b; return out; } }; return out; }
  // tenantId provided BOTH ways (user.tenantId + query.tenantId) so resolveTenantScope works
  // regardless of role tier — the same reqFor shape selfTest_integrationsPermissions uses.
  const fakeReq: any = { user: { id: "u_test", tenantId: T, role: "PORTAL_ADMIN" }, query: { tenantId: T }, body: {} };

  (env as any).MAPBOX_TOKEN = ""; // unset
  check(geocodingEnabled() === false, "(setup) geocodingEnabled() false with no token");
  let res1 = fakeRes(); await getSettingsHandler(fakeReq, res1 as any);
  check(!!res1.body && !!res1.body.geocoding && res1.body.geocoding.enabled === false, "/api/settings reports geocoding.enabled === false when the token is unset");
  check(!JSON.stringify(res1.body).toLowerCase().includes("mapbox_token"), "the settings payload never exposes the token");

  (env as any).MAPBOX_TOKEN = "pk.test_fake_token_for_gate"; // set (never sent anywhere by this test)
  check(geocodingEnabled() === true, "(setup) geocodingEnabled() true once a token is set");
  let res2 = fakeRes(); await getSettingsHandler(fakeReq, res2 as any);
  check(!!res2.body && !!res2.body.geocoding && res2.body.geocoding.enabled === true, "/api/settings reports geocoding.enabled === true when the token is set");
  check(res2.body.name != null && "phoneNumber" in res2.body && "receptionistEnabled" in res2.body, "the existing settings fields are all still present (additive)");
  (env as any).MAPBOX_TOKEN = ""; // leave unset

  // --- (4) source assertions: Mapbox tile ---
  console.log("\n(4) Mapbox tile (source assertions):");
  const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
  const riStart = portal.indexOf("async function renderIntegrations(host)");
  const riEnd = portal.indexOf("async function renderDataAdmin");
  const RI = portal.slice(riStart, riEnd);
  check(/card\("\/img\/mapbox\.png", "Mapbox"\)/.test(RI), "renderIntegrations adds a Mapbox tile via the shared card() helper, logo /img/mapbox.png");
  check(/s\.geocoding && s\.geocoding\.enabled/.test(RI), "the tile's status is driven by geocoding.enabled from /api/settings");
  check(/Powers address geocoding for the Map view\./.test(RI), "the tile carries the one-line description");
  check(/"Maps active" : "Not configured"/.test(RI), "shows \"Maps active\" when enabled, \"Not configured\" when not");
  check(/Map geocoding is off until the server key is set\./.test(RI), "the not-configured state carries the muted explainer note");
  const mapboxBlock = RI.slice(RI.indexOf("(function mapbox()"), RI.indexOf("host.appendChild(wrap)"));
  check(mapboxBlock.length > 0 && !/el\("input"/.test(mapboxBlock) && !/type = "checkbox"/.test(mapboxBlock) && !/portalApi\([^)]*method/.test(mapboxBlock), "the Mapbox tile is read-only: no input, no toggle, no save call");
  check(!/MAPBOX_TOKEN|pk\.|sk\./.test(mapboxBlock), "the tile never references the token or any secret");
  // Existing three tiles unchanged (prime directive).
  check(/\(function twilio\(\)/.test(RI) && /\(function openai\(\)/.test(RI) && /\(function google\(\)/.test(RI), "the Twilio / OpenAI / Google tiles are all still present");
  check(/card\("\/img\/twilio\.png", "Twilio"\)/.test(RI) && /card\("\/img\/openai\.webp", "OpenAI"\)/.test(RI) && /card\("\/img\/google-calendar\.webp", "Google Calendar"\)/.test(RI), "their logos/titles are unchanged");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    // Clean up the per-tenant seed markers too (AppSetting has no tenant FK/cascade).
    try { await db.appSetting.deleteMany({ where: { key: { in: tenantIds.map((id) => "contacts_default_fields_seeded:" + id) } } }); } catch {}
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (address field seeded once + deletable; settings flag both states; read-only Mapbox tile)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
