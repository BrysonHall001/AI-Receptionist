// Self-test — Contacts get every view. DB checks for Contact.stageKey (validated updates,
// serialization, funnel isolation) + eligibility driven through the real recordTypeService
// (setPipelineEnabled/addSubtype/addStage, the selfTest_pipelineToggle pattern) + source
// assertions on the strip parity and the shared renderers.
//
//   npx tsx src/db/selfTest_contactsAllViews.ts     (needs dev Postgres)
//
// Proves:
//  (1) Contact.stageKey: updateContact sets it, clears it, REJECTS a key that isn't one of the
//      contact type's pipeline stages, and keeps existing update behavior (events still fire —
//      a stage change lands in the changes payload); list + detail serializations include it.
//  (2) Board eligibility: pipeline OFF → moduleHasStages false (Board unavailable); enable the
//      pipeline + add stages → true (available).
//  (3) Calendar/Gallery eligibility for Contacts keys off date/image fields.
//  (4) FUNNEL ISOLATION: setting a contact's stageKey creates/modifies ZERO RecordLink rows and
//      leaves the pipeline (funnel) read model untouched.
//  (5) Source: the strip renders all four tiles for Contacts (Map-only restriction gone);
//      renderContacts registers board/calendar/gallery modes calling the SHARED renderers (no
//      duplicated blocks); board drag persists via PATCH /api/contacts/:id → updateContact.
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { listFields, createField } from "../services/fieldService";
import { setPipelineEnabled, addSubtype, addStage } from "../services/recordTypeService";
import { createContact, updateContact, contactPipelineStages, getContactsCalendarData } from "../services/contactService";
import { listContacts, getContact } from "../services/readModels";
import { listPipelineLinks } from "../services/pipelineService";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];

// The frontend availability rules, mirrored 1:1 so eligibility is tested against the same
// logic the strip uses (moduleHasStages / date / image fields).
function hasStages(t: any): boolean {
  if (!t) return false;
  if (t.pipelineEnabled === false) return false;
  if (Array.isArray(t.stages) && t.stages.length) return true;
  return (Array.isArray(t.subtypes) ? t.subtypes : []).some((st: any) => Array.isArray(st.stages) && st.stages.length);
}

async function contactType(tenantId: string) {
  return db.recordType.findFirst({ where: { tenantId, key: "contact" } });
}

async function main() {
  console.log("Contacts get every view — stageKey, eligibility, funnel isolation, shared UI");
  console.log("=============================================================================");

  const t = await prisma.tenant.create({ data: { name: `cav-${stamp}`, notifyEmail: `cav-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);
  const T = t.id;
  await listFields(T, "contact"); // seed the contact type + default fields

  // ---- (2) board eligibility, driven through the real service ----
  console.log("\n(2) Board eligibility (pipeline off → on + stages):");
  let ct = await contactType(T);
  check(!!ct, "(setup) the contact record type exists in the registry");
  check(hasStages(ct) === false, "with no pipeline, moduleHasStages(contact) is false → Board unavailable");
  await setPipelineEnabled(T, "contact", true);
  ct = await contactType(T);
  check(ct.pipelineEnabled === true && hasStages(ct) === false, "pipeline ON but no stages yet → still unavailable (availability needs stages for lanes)");
  const withSub = await addSubtype(T, "contact", "Leads");
  const subKey = (withSub.subtypes || [])[0].key;
  await addStage(T, "contact", subKey, "New");
  await addStage(T, "contact", subKey, "Nurturing");
  await addStage(T, "contact", subKey, "Won");
  ct = await contactType(T);
  check(hasStages(ct) === true, "pipeline + stages → moduleHasStages(contact) true → Board available");
  const stages = await contactPipelineStages(T);
  check(stages.length === 3 && stages.some((s) => s.label === "Nurturing"), "contactPipelineStages flattens the contact type's own stages (subtype-built pipelines included)");

  // ---- (1) stageKey lifecycle through updateContact ----
  console.log("\n(1) Contact.stageKey via updateContact:");
  const c = await createContact(T, { name: "Ada", phone: "+15550001111", email: `ada-${stamp}@ex.com`, customFields: {} });
  check((c as any).stageKey == null, "a new contact has no stage (no backfill semantics)");
  const sNew = stages[0].key;
  await updateContact(c.id, T, { stageKey: sNew });
  let row = await prisma.contact.findUnique({ where: { id: c.id } });
  check((row as any).stageKey === sNew, "updateContact SETS a valid stage key");
  let rejected = false;
  try { await updateContact(c.id, T, { stageKey: "not_a_real_stage" }); } catch (e) { rejected = /stage/i.test((e as Error).message); }
  row = await prisma.contact.findUnique({ where: { id: c.id } });
  check(rejected && (row as any).stageKey === sNew, "an unknown key is REJECTED and the stored stage is untouched");
  // Existing behavior unchanged + the change lands on the timeline like any edit.
  await updateContact(c.id, T, { name: "Ada L.", stageKey: stages[1].key });
  const act = await prisma.activityLog.findFirst({ where: { tenantId: T, contactId: c.id, type: "field_update" }, orderBy: { createdAt: "desc" } });
  const changes: any[] = ((act as any)?.detail?.changes || []);
  check(changes.some((ch) => ch.field === "stageKey" && ch.label === "Stage") && changes.some((ch) => ch.field === "name"), "a stage change is tracked alongside other edits (activity/events path unchanged)");
  await updateContact(c.id, T, { stageKey: null });
  row = await prisma.contact.findUnique({ where: { id: c.id } });
  check((row as any).stageKey === null, "updateContact CLEARS the stage (nullable)");
  await updateContact(c.id, T, { stageKey: sNew }); // leave it set for the funnel check
  const listed = await listContacts(T);
  const dto: any = listed.find((x: any) => x.id === c.id);
  const detail: any = await getContact(c.id, T);
  check(dto && dto.stageKey === sNew && detail && detail.stageKey === sNew, "list AND detail serializations include stageKey");

  // ---- (4) funnel isolation ----
  console.log("\n(4) RecordLink / funnel isolation:");
  const linksBefore = await db.recordLink.count({ where: { tenantId: T } });
  const funnelBefore = JSON.stringify(await listPipelineLinks(T));
  await updateContact(c.id, T, { stageKey: stages[2].key });
  await updateContact(c.id, T, { stageKey: null });
  const linksAfter = await db.recordLink.count({ where: { tenantId: T } });
  const funnelAfter = JSON.stringify(await listPipelineLinks(T));
  check(linksBefore === linksAfter && linksBefore === 0, "setting/clearing a contact's stageKey creates ZERO RecordLink rows");
  check(funnelBefore === funnelAfter, "the funnel read model output is byte-identical before/after");

  // ---- (3) calendar/gallery eligibility + the contacts calendar data ----
  console.log("\n(3) Calendar/Gallery eligibility + calendar data:");
  let cf = await listFields(T, "contact");
  const dateBefore = cf.filter((f: any) => f.type === "date" || f.type === "datetime").length;
  check(dateBefore === 0, "(setup) contacts start with no date field → Calendar unavailable");
  await createField(T, { label: "Renewal date", type: "date" }, "contact");
  cf = await listFields(T, "contact");
  const dateField = cf.find((f: any) => f.type === "date");
  check(!!dateField, "adding a date field makes Calendar available (moduleDateFields rule)");
  if (!dateField) throw new Error("contact date field missing after createField \u2014 aborting the calendar assertions (failure already recorded above)");
  check(cf.filter((f: any) => f.type === "image").length === 0, "(setup) no image field → Gallery unavailable");
  await createField(T, { label: "Photo", type: "image" }, "contact");
  cf = await listFields(T, "contact");
  check(cf.some((f: any) => f.type === "image"), "adding an image field makes Gallery available");
  // Calendar data: a contact with a date in the window shows; outside the window doesn't.
  await updateContact(c.id, T, { customFields: { [dateField.key]: "2026-08-14" } });
  const cal = await getContactsCalendarData(T, dateField.key, "2026-08-10", "2026-08-17");
  check(cal.bookings.length === 1 && cal.bookings[0].id === c.id && cal.bookings[0].title === "Ada L." && cal.bookings[0].start.startsWith("2026-08-14"), "the contacts calendar lays a contact out by the chosen date field, titled by NAME");
  const calOut = await getContactsCalendarData(T, dateField.key, "2026-09-01", "2026-09-08");
  check(calOut.bookings.length === 0, "…and windows without that date are empty (half-open [from,to))");
  check("hours" in cal && "resources" in cal && "bookings" in cal, "the payload shape mirrors the record calendar's, so the SHARED renderer consumes it unchanged");

  // ---- (5) source assertions ----
  console.log("\n(5) shared UI plumbing (source assertions):");
  const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
  const bv = portal.slice(portal.indexOf("function buildViewsSection"), portal.indexOf("async function renderSettings"));
  check(!/isContact/.test(bv), "the strip's Map-only restriction for Contacts is GONE (all four tiles, standard rules)");
  check(/name: "Board", available: hasPipeline/.test(bv) && /name: "Calendar", available: calAvailable/.test(bv) && /name: "Map", available: mapAvailable/.test(bv) && /name: "Gallery", available: galAvailable/.test(bv), "all four tiles render with their standard availability rules");
  check(/if \(canEdit && selectedType\) scroll\.appendChild\(structureSection\(\)\);/.test(portal), "Structure & behavior (the pipeline toggle) now renders for Contacts too — Board can actually be enabled");
  const rc = portal.slice(portal.indexOf("async function renderContacts()"), portal.indexOf("function openManageColumns("));
  check(/moduleBoardEnabled\(contactType\)/.test(rc) && /mountStageBoard\(boardHost, \{/.test(rc), "renderContacts registers a Board mode on the SHARED stage board");
  check(/App\.portalApi\("\/api\/contacts\/" \+ r\.id, \{ method: "PATCH", body: JSON\.stringify\(\{ stageKey: newKey \}\) \}\)/.test(rc), "board drag persists via PATCH /api/contacts/:id → updateContact (validation/activity/events fire; no new write endpoint)");
  check(/moduleCalendarEnabled\(contactType\)/.test(rc) && /renderBookingCalendar\(calHost, contactType, fields, \{/.test(rc) && /calendarUrl: function \(from, to\) \{ return "\/api\/contacts\/calendar\?field="/.test(rc), "renderContacts registers a Calendar mode on the SHARED calendar renderer, pointed at /api/contacts/calendar");
  check(/eventHrefBase: "#\/contact\/"/.test(rc), "calendar events open the contact");
  check(/moduleGalleryEnabled\(contactType\)/.test(rc) && /renderRecordGallery\(galHost, contactType, fields, contacts, \{/.test(rc), "renderContacts registers a Gallery mode on the SHARED gallery renderer");
  check(!/L\.map\(/.test(rc) && !/img\.loading/.test(rc) && !(rc.match(/kanban-col/g) || []).length, "no duplicated board/calendar/gallery blocks inside renderContacts — all shared");
  check(/function mountStageBoard\(host, cfg\)/.test(portal) && /INDEPENDENT of RecordLink\/funnel stages/.test(portal), "the shared board is standalone and documented as funnel-independent");
  const api = readFileSync(resolve(__dirname, "../../src/routes/api.ts"), "utf8");
  check(api.indexOf('apiRouter.get("/contacts/calendar"') >= 0 && api.indexOf('apiRouter.get("/contacts/calendar"') < api.indexOf('apiRouter.get("/contacts/:id"'), "the /contacts/calendar route is registered BEFORE /contacts/:id");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    try { await db.appSetting.deleteMany({ where: { key: { in: tenantIds.map((id) => "contacts_default_fields_seeded:" + id) } } }); } catch {}
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (validated contact stage; eligibility data-driven; funnel untouched; every view shared)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
