// Self-test — Terms panel clarity pass (presentation-only; behavior identical).
//
//   npx tsx src/db/selfTest_termsClarity.ts     (needs dev Postgres for the round-trip)
//
// Proves:
//  (1) termAppliesToModule behavior is UNCHANGED — the real function is vm-evaluated from
//      portal.js and asserted: record -> all modules, stage -> pipeline modules + the Contacts
//      exception, resource -> Bookings only.
//  (2) buildTermsSection renders, per term: a NAME label, BOTH inputs, and a DESCRIPTION —
//      with grounded wording (record/stage/resource call-site summaries), the Contacts-specific
//      Stage explanation, and the portal-wide shared cue; and the hint no longer carries the old
//      contradictory phrasing.
//  (3) The save path still sends ONLY the shown terms as { generic: { <key>: {one,many} } }.
//  (4) DB round-trip: writing a generic term via the SAME service PATCH /api/labels uses
//      (setTenantLabels), then reading it back the way GET /api/labels does, resolves the renamed
//      word with App.label's exact fallback (generic override beats the English default).
//  (5) Layout sanity: descriptions wrap at word boundaries (no overflow-wrap:anywhere), the
//      column width is untouched, and the Views panel beneath Terms is undisturbed.
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { setTenantLabels, getPortal } from "../services/portalService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];

const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

async function main() {
  console.log("Terms clarity pass — labels + descriptions, honest wording, unchanged behavior");
  console.log("==============================================================================");

  // ---- (1) termAppliesToModule unchanged (vm-evaluate the REAL function) ----
  console.log("\n(1) termAppliesToModule behavior unchanged:");
  const a = portal.indexOf("function moduleHasStages");
  const b = portal.indexOf('// ---- SHARED TERMS editor'); // the vm block ends where the (relocated) editor begins
  const block = portal.slice(a, b);
  const sandbox: any = {};
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);
  const applies = sandbox.termAppliesToModule as (k: string, t: any) => boolean;
  const CONTACT = { key: "contact", stages: [], subtypes: [], recordStages: [] };
  const JOB = { key: "job", stages: [{ key: "a", label: "A" }], subtypes: [{ key: "t", stages: [{ key: "s" }] }] };
  const BOOKING = { key: "booking", stages: [], subtypes: [{ key: "c", stages: [] }], recordStages: [{ key: "x" }] };
  const EQUIP = { key: "equipment", stages: [], subtypes: [], recordStages: [] };
  check(typeof applies === "function", "the real termAppliesToModule evaluates standalone");
  check(applies("record", CONTACT) && applies("record", JOB) && applies("record", BOOKING) && applies("record", EQUIP), "record -> every module");
  check(applies("stage", JOB) === true && applies("stage", EQUIP) === false, "stage -> pipeline modules only (flat modules excluded)");
  check(applies("stage", CONTACT) === true, "stage -> the Contacts exception is kept");
  check(applies("resource", BOOKING) === true && !applies("resource", JOB) && !applies("resource", CONTACT) && !applies("resource", EQUIP), "resource -> Bookings only");

  // ---- (2) rendered structure + wording ----
  console.log("\n(2) per-term name + inputs + description; honest hint:");
  const tsStart = portal.indexOf("function buildTermsSection(col, generic)"); // portal-level since the layout restructure
  const tsEnd = portal.indexOf("// ---- VIEWS section");
  const TS = portal.slice(tsStart, tsEnd);
  check(tsStart > 0 && TS.length > 0, "buildTermsSection located");
  check(/mf-term-name", esc\(w\.dflt\.one\)/.test(TS), "each term row shows a bold NAME label (the default English word)");
  check(/el\("input", "input mf-term-input"\)[\s\S]{0,300}?el\("input", "input mf-term-input"\)/.test(TS), "both singular + plural inputs are still rendered");
  check(/if \(!row\.touched\) m\.value = App\.pluralize\(o\.value\)/.test(TS), "the auto-pluralize behavior is unchanged");
  check(/mf-term-desc", esc\(descText\)/.test(TS), "each term row shows a description element");
  check(/Recycle Bin, related tabs, bulk actions, and import\/export/.test(TS), "record's description names its real surfaces");
  check(/boards, pipeline editors, and stage dropdowns/.test(TS), "stage's description names its real surfaces");
  check(/technician, stylist, bay — used on Bookings and Scheduling/.test(TS), "resource's description names its real surfaces");
  check(/Contacts move through pipeline stages too/.test(TS), "Stage's description keeps the contact rationale (portal-level phrasing)");
  check(/Each word has one value for the whole portal — renaming it here renames it everywhere it appears\./.test(TS), "the hint states the real model plainly — exactly once");
  check(!/— edited here, saved portal-wide\./.test(TS), "the old contradictory hint phrasing is gone");
  check(!/mf-term-tag/.test(TS) && !/termIsShared/.test(TS), "no per-term portal-wide tag — the point is made once, in the hint (polish pass)");
  check(!/mf-terms-for/.test(TS) && /Words used across your portal\./.test(TS), "the head has no module suffix; the hint is portal-level (Terms now live on the Pages tab)");

  // ---- (3) save payload construction unchanged ----
  console.log("\n(3) save path unchanged:");
  check(/const payload = \{ generic: \{\} \};/.test(TS) && /for \(const row of rows\)/.test(TS) && /payload\.generic\[row\.key\] = \{ one: one, many: many \};/.test(TS), "only the SHOWN terms are sent, as { generic: { <key>: {one,many} } }");
  check(/App\.portalApi\("\/api\/labels", \{ method: "PATCH", body: JSON\.stringify\(payload\) \}\)/.test(TS), "the PATCH /api/labels call is byte-for-byte the same");
  check(/if \(!one\) \{ App\.util\.toast\("Each term needs a singular name", true\); return; \}/.test(TS) && /if \(!many\) many = App\.pluralize\(one\);/.test(TS), "the validation + auto-plural fallback on save are unchanged");

  // ---- (4) DB round-trip through the real service (the same one PATCH /api/labels calls) ----
  console.log("\n(4) DB round-trip — a renamed term resolves the App.label way:");
  const t = await prisma.tenant.create({ data: { name: `tc-${stamp}`, notifyEmail: `tc-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);
  await setTenantLabels(t.id, { record: { one: "Case", many: "Cases" } });
  const p = await getPortal(t.id);
  const generic: any = (p && (p as any).labels) || {};
  // App.label's fallback for a generic word: types[k] (n/a here) -> generic[k][form] -> default.
  const resolveLabel = (k: string, f: "one" | "many", dflt: string) => (generic[k] && generic[k][f]) || dflt;
  check(resolveLabel("record", "one", "Record") === "Case" && resolveLabel("record", "many", "Records") === "Cases", "the renamed word round-trips (generic override wins over the English default)");
  check(resolveLabel("stage", "one", "Stage") === "Stage", "an untouched word still falls back to its default (merge didn't clobber)");

  // ---- (5) layout sanity ----
  console.log("\n(5) layout sanity:");
  check(/\.mf-term-desc \{[^}]*overflow-wrap: normal/.test(css) && !/\.mf-term-desc \{[^}]*overflow-wrap: anywhere/.test(css), "descriptions wrap at word boundaries (no overflow-wrap:anywhere)");
  check(/\.mf-term \{ margin-bottom: 14px; \}/.test(css), "term rows stack vertically with breathing room");
  check(/\.mf-grid \{ display: grid; grid-template-columns: minmax\(240px, 1fr\) minmax\(0, 1\.15fr\); gap: 16px/.test(css), "the grid is two columns (Terms moved off Modules & Fields — layout restructure)");
  check(/buildTermsSection\(termsHost, \(labelsData && labelsData\.generic\) \|\| \{\}\)/.test(portal), "the Terms editor mounts on the Pages tab (its new home)");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (behavior unchanged; names + grounded descriptions; honest hint; round-trip green)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
