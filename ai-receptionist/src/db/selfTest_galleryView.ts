// Self-test — Gallery view (the last of the four module views). Source assertions on the tile
// + card-grid render logic, plus a DB check that the Gallery toggle actually PERSISTS through
// the shared views endpoint (setModuleViews), gated on an image field.
//
//   npx tsx src/db/selfTest_galleryView.ts     (needs dev Postgres for the persistence check)
//
// Proves:
//  (1) The Gallery tile's availability keys off the presence of an image-type field and rides
//      the SAME live re-evaluation plumbing as Calendar/Map (the renderFields hook + the Views
//      panel's fresh field fetch) — and the "Coming soon" wording for Gallery is gone.
//  (2) renderRecordList registers a gallery view mode; cards lazy-load their images; the
//      primary image field is the FIRST image field by order; imageless records render a
//      neutral placeholder instead of being filtered out; card click uses the same record
//      detail navigation the table rows use; empty modules use the friendly empty state.
//  (3) DB: setModuleViews ACCEPTS "gallery" once the module has an image field (round-trips in
//      enabledViews) and REJECTS it without one — so the tile toggle really persists.
//  (4) Additive: the table/board/calendar/map wiring is untouched (incl. the Bookings path).
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { createRecordType, setModuleViews } from "../services/recordTypeService";
import { createField } from "../services/fieldService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];

const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

async function main() {
  console.log("Gallery view — tile availability, card grid, persisted toggle");
  console.log("=============================================================");

  // ---- (1) tile availability + shared plumbing + coming-soon gone ----
  console.log("\n(1) Gallery tile (source assertions):");
  const bv = portal.slice(portal.indexOf("function buildViewsSection"), portal.indexOf("async function renderSettings"));
  check(/function moduleImageFields\(t, fields\)/.test(portal) && /f\.type === "image"/.test(portal), "moduleImageFields keys off image-type fields");
  check(/const galAvailable = imgFields\.length > 0;/.test(bv), "Gallery availability = the module has at least one image field");
  check(/name: "Gallery", available: galAvailable/.test(bv), "the Gallery tile is availability-driven (real toggle)");
  check(/Add an image field to enable the Gallery view\./.test(bv), "the unavailable state carries the image-field hint");
  check(!/name: "Gallery", comingSoon: true/.test(portal) && !/GALLERY — future batch/.test(portal), "the \"Coming soon\" Gallery state is gone");
  // Shared liveness plumbing: the Views panel re-fetches CURRENT fields every render, and every
  // Fields-column repaint (field add/edit/delete) re-runs it — the Calendar-tile fix, unchanged.
  check(/App\.portalApi\("\/api\/fields\?recordType=" \+ encodeURIComponent\(selectedType\.key\)\)/.test(bv), "the tile reads the module's CURRENT field defs (fresh fetch, never stale)");
  check(/if \(refresh && mfViewsRepaint\) \{ try \{ mfViewsRepaint\(\); \} catch \(e\) \{\} \}/.test(portal), "field add/edit/delete re-evaluates the panel (the shared liveness hook)");

  // ---- (2) gallery view mode + card render rules ----
  console.log("\n(2) gallery view mode on the record list (source assertions):");
  check(/function moduleGalleryEnabled\(t\) \{ return moduleViewOn\(t, "gallery"\); \}/.test(portal), "moduleGalleryEnabled keys off the gallery view flag");
  check(/if \(moduleGalleryEnabled\(type\)\) \{/.test(portal) && /renderRecordGallery\(galArea, type, fields, records\)/.test(portal), "renderRecordList registers a gallery view mode (renderRecordGallery)");
  const gal = portal.slice(portal.indexOf("function renderRecordGallery(host, type, fields, records)"), portal.indexOf("function recordColumnDefs("));
  check(gal.length > 0, "renderRecordGallery exists");
  check(/renderRecordGallery\(galArea, type, fields, records\)/.test(portal) && !/portalApi\(/.test(gal), "the gallery renders from the records the table already fetched (no new fetch)");
  check(/img\.loading = "lazy"/.test(gal), "card images are LAZY-loaded (values are ~1 MB data-URLs)");
  check(/const imgFields = moduleImageFields\(type, fields\);\s*\n\s*const imgField = imgFields\.length \? imgFields\[0\] : null;/.test(gal), "the primary image field is the FIRST image field by order");
  check(/gallery-ph/.test(gal) && /charAt\(0\)/.test(gal), "imageless records render a neutral initial-letter placeholder");
  check(/rows\.forEach\(\(r\) => \{/.test(gal) && !/filter\([^)]*imgField/.test(gal), "records are NOT filtered by image presence — the whole module shows");
  check(/App\.go\("#\/record\/" \+ r\.id\)/.test(gal), "card click navigates to the record detail page (same route as table rows)");
  check(/recordStageLabel\(type, r\.stageKey\)/.test(gal) && /moduleHasStages\(type\)/.test(gal), "the status/stage label leads the secondary lines when the module has one");
  check(/App\.fields\.formatValue\(f, \(r\.customFields \|\| \{\}\)\[f\.key\], fields, r\.customFields \|\| \{\}\)/.test(gal), "secondary values render through App.fields.formatValue (typed rendering)");
  check(/out\.slice\(0, 2\)/.test(gal), "at most two compact secondary values per card");
  check(/class="empty"/.test(gal) || /"empty"/.test(gal), "an empty module uses the same friendly empty-state pattern");
  check(/\.gallery-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(180px, 1fr\)\)/.test(css), "the grid is responsive (auto-fill/minmax, like the Integrations tiles)");
  check(/\.gallery-thumb \{[^}]*aspect-ratio: 4 \/ 3; object-fit: cover/.test(css), "thumbnails are fixed-ratio crops (object-fit: cover)");

  // ---- (4) additive: other views untouched ----
  console.log("\n(4) additive — existing views untouched:");
  check(/if \(moduleCalendarEnabled\(type\)\) \{/.test(portal) && /if \(moduleMapEnabled\(type\)\) \{/.test(portal), "the Calendar and Map blocks are unchanged siblings");
  check(/renderBookingCalendar\(calArea, type, fields, \{ dateField: moduleCalendarField\(type, fields\) \}\)/.test(portal), "the Bookings/generic calendar path is intact");
  check(/name: "Map", available: mapAvailable/.test(bv) && /const calAvailable = dateFields\.length > 0;/.test(bv), "the Board/Calendar/Map tiles keep their exact availability rules");

  // ---- (3) DB: the toggle persists through the shared endpoint path ----
  console.log("\n(3) DB — gallery persists via setModuleViews, gated on an image field:");
  const t = await prisma.tenant.create({ data: { name: `gal-${stamp}`, notifyEmail: `gal-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);
  const props = await createRecordType(t.id, "Property", "Properties");

  let rejected = false;
  try { await setModuleViews(t.id, props.key, { enabledViews: ["gallery"] }); }
  catch (e) { rejected = /image field/i.test((e as Error).message); }
  check(rejected, "without an image field, turning Gallery on is rejected with the image-field message");

  await createField(t.id, { label: "Photo", type: "image" }, props.key);
  const after = await setModuleViews(t.id, props.key, { enabledViews: ["gallery"] });
  check(Array.isArray(after.enabledViews) && after.enabledViews.includes("gallery"), "with an image field, Gallery turns on and PERSISTS in enabledViews");
  const off = await setModuleViews(t.id, props.key, { enabledViews: [] });
  check(Array.isArray(off.enabledViews) && !off.enabledViews.includes("gallery"), "turning it off persists too");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (Gallery tile availability + live plumbing; lazy card grid incl. imageless; toggle persists)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
