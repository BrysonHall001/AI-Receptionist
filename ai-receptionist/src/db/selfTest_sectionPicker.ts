// DB-backed self-test for the portal-creation "which record-type sections show" picker.
//
//   npx tsx src/db/selfTest_sectionPicker.ts        (needs dev Postgres)
//
// Proves:
//  (1) creating a portal with equipment UNchosen hides the equipment nav item (via the
//      existing Tenant.labels.nav.hidden mechanism) WHILE the equipment record type is
//      still seeded/present — i.e. seeded-but-hidden, fully reversible;
//  (2) creating with all chosen (or the field omitted) hides nothing (today's behavior),
//      and non-togglable / unknown keys are ignored (Contacts can never be hidden here);
//  (3) the togglable list is derived DYNAMICALLY from the registry — a mock extra type
//      appears as a togglable option — and Contacts is never togglable.
import { prisma, disconnectDb } from "./client";
import { createPortal } from "../services/portalService";
import {
  listRecordTypes, systemRecordTypeOptions, togglableRecordTypeKeys, recordTypeHref, SYSTEM_RECORD_TYPES,
} from "../services/recordTypeService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
function navOf(p: any) { return (p && p.labels && typeof p.labels === "object" && p.labels.nav) ? p.labels.nav : {}; }

async function main() {
  console.log("Portal creation — record-type section picker (seeded-but-hidden)");
  console.log("===============================================================");

  // (1) equipment UNchosen → its nav item hidden, but the type is still seeded.
  const hidden: any = await createPortal({ name: `sec-hide-${stamp}`, notifyEmail: `a-${stamp}@ex.com`, billingStatus: "free", hiddenRecordTypes: ["equipment"] });
  tenantIds.push(hidden.id);
  const nav = navOf(hidden);
  check(Array.isArray(nav.hidden) && nav.hidden.includes("#/records/equipment"), "equipment nav item is HIDDEN at creation (labels.nav.hidden)");
  check(!(nav.hidden || []).includes("#/contacts"), "Contacts is never hidden");
  check(!(nav.hidden || []).includes("#/jobs") && !(nav.hidden || []).includes("#/bookings"), "unchosen-only: Jobs & Bookings stay visible");
  const typesH = await listRecordTypes(hidden.id); // seeds all system types on read
  check(typesH.some((t: any) => t.key === "equipment"), "equipment record type is STILL SEEDED/present (seeded-but-hidden)"); // <-- proves seeded-but-hidden
  check(["contact", "job", "booking", "equipment"].every((k) => typesH.some((t: any) => t.key === k)), "all four record types exist in the portal (nothing skipped)");

  // (2) all chosen / omitted → nothing hidden (today's behavior unchanged).
  const allVis: any = await createPortal({ name: `sec-all-${stamp}`, notifyEmail: `b-${stamp}@ex.com`, billingStatus: "free" });
  tenantIds.push(allVis.id);
  const nav2 = navOf(allVis);
  check(!nav2.hidden || nav2.hidden.length === 0, "omitting the field hides NOTHING (all sections visible — unchanged default)");
  const typesA = await listRecordTypes(allVis.id);
  check(["contact", "job", "booking", "equipment"].every((k) => typesA.some((t: any) => t.key === k)), "all sections present when all chosen");

  // (2b) guardrails: contact + unknown keys ignored; only real togglable keys hide.
  const guarded: any = await createPortal({ name: `sec-guard-${stamp}`, notifyEmail: `c-${stamp}@ex.com`, billingStatus: "free", hiddenRecordTypes: ["contact", "totally-bogus", "equipment"] });
  tenantIds.push(guarded.id);
  const navG = navOf(guarded);
  check((navG.hidden || []).includes("#/records/equipment") && !(navG.hidden || []).includes("#/contacts") && (navG.hidden || []).length === 1,
    "Contacts + unknown keys are ignored — only equipment is hidden");

  // (3) dynamic registry options; Contacts never togglable.
  const opts = systemRecordTypeOptions();
  const contactOpt = opts.find((o) => o.key === "contact");
  check(!!contactOpt && contactOpt.togglable === false, "Contacts is present and NOT togglable (core)");
  check(opts.filter((o) => o.togglable).map((o) => o.key).join(",") === "job,booking,equipment,invoice,vehicle,property,product,estimate,task,work_order", "togglable options derived from the registry include the pre-built modules"); // Work Orders batch: work_order joined the registry

  // A new registry type must appear as a togglable option WITHOUT touching the picker.
  const MOCK: any = { key: "widget_mock", defaults: { key: "widget_mock", label: "Widget", labelPlural: "Widgets", system: false, stages: [], recordStages: [], order: 99 } };
  SYSTEM_RECORD_TYPES.push(MOCK);
  try {
    const opts2 = systemRecordTypeOptions();
    const mock = opts2.find((o) => o.key === "widget_mock");
    check(!!mock && mock.togglable === true && mock.href === "#/records/widget_mock", "a NEW registry type auto-appears as a togglable option at #/records/<key>"); // <-- proves dynamic list
    check(togglableRecordTypeKeys().includes("widget_mock"), "togglableRecordTypeKeys includes the new type");
    check(opts2.find((o) => o.key === "contact")!.togglable === false, "Contacts stays non-togglable even after a type is added");
  } finally {
    const i = SYSTEM_RECORD_TYPES.indexOf(MOCK); if (i >= 0) SYSTEM_RECORD_TYPES.splice(i, 1);
  }
  check(recordTypeHref("equipment") === "#/records/equipment" && recordTypeHref("job") === "#/jobs" && recordTypeHref("contact") === "#/contacts",
    "href convention: system types keep bespoke hrefs, custom types use #/records/<key>");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (sections hidden-not-skipped; dynamic; Contacts always on)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
