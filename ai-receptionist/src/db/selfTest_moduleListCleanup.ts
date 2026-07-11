// Pure self-test for the Create-tenant "Pages" vs "Modules" cleanup.
//
//   npx tsx src/db/selfTest_moduleListCleanup.ts
//
// Proves:
//  (1) the Pages lock list (LOCKABLE_PAGES in admin.js) contains ONLY fixed app pages
//      and NO record-type hrefs (no #/contacts, #/jobs, #/bookings, #/records/*);
//  (2) the Modules list is the registry options — each record type individually, with
//      Jobs and Bookings as SEPARATE togglable entries and Contacts always-on;
//  (3) the two lists do NOT overlap (no href appears in both) — the whole point;
//  (4) the user-facing rename to "Modules" happened (old "Sections / record types" gone);
//  (5) enforcement is UNCHANGED: the server still treats #/contacts/#/jobs/#/bookings as
//      lockable (a record-type area can still be hard-locked/403'd), so the security
//      control was relocated in the UI, not removed.
import { readFileSync } from "fs";
import { resolve } from "path";
import { systemRecordTypeOptions } from "../services/recordTypeService";
import { LOCKABLE_HREFS, sanitizeLockedPages } from "../services/portalService";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

console.log("Create-tenant cleanup — Pages vs Modules (no overlap, rename, enforcement)");
console.log("========================================================================");

const adminJs = readFileSync(resolve(__dirname, "../../public/js/admin.js"), "utf8");

// Extract the LOCKABLE_PAGES array block.
const start = adminJs.indexOf("const LOCKABLE_PAGES = [");
const end = adminJs.indexOf("];", start);
const pagesBlock = start >= 0 && end > start ? adminJs.slice(start, end) : "";
check(!!pagesBlock, "found the LOCKABLE_PAGES block in admin.js");
const pagesHrefs = Array.from(new Set((pagesBlock.match(/#\/[A-Za-z0-9_\/-]+/g) || [])));

// Record-type hrefs from the registry (what the Modules list covers).
const rtOptions = systemRecordTypeOptions();
const rtHrefs = rtOptions.map((o) => o.href); // #/contacts, #/jobs, #/bookings, #/records/equipment

// (1) Pages list has NO record-type hrefs.
for (const h of ["#/contacts", "#/jobs", "#/bookings"]) {
  check(!pagesHrefs.includes(h), `Pages lock list no longer contains ${h}`);
}
check(!pagesBlock.includes("#/records/"), "Pages lock list contains no custom record-type page (#/records/*)");
// ...and still has the fixed app pages.
for (const h of ["#/dashboard", "#/calls", "#/reports", "#/automations", "#/communication", "#/learn", "#/feedback", "#/billing"]) {
  check(pagesHrefs.includes(h), `Pages lock list still offers the fixed page ${h}`);
}

// (2) Modules list = each record type individually; Jobs & Bookings split; Contacts always-on.
const byKey: Record<string, any> = {};
rtOptions.forEach((o) => (byKey[o.key] = o));
check(!!byKey.contact && byKey.contact.togglable === false, "Modules: Contacts is present and always-on (not togglable)");
check(!!byKey.job && byKey.job.togglable === true, "Modules: Jobs is a separate togglable entry");
check(!!byKey.booking && byKey.booking.togglable === true, "Modules: Bookings is a separate togglable entry");
check(byKey.job.href === "#/jobs" && byKey.booking.href === "#/bookings" && byKey.job.href !== byKey.booking.href,
  "Modules: Jobs and Bookings are split (distinct rows/hrefs), not lumped");
check(!!byKey.equipment && byKey.equipment.togglable === true, "Modules: Equipment is a separate togglable entry");

// (3) NO OVERLAP between the two lists.
const overlap = pagesHrefs.filter((h) => rtHrefs.includes(h));
check(overlap.length === 0, `no href appears in BOTH Pages and Modules (overlap: [${overlap.join(", ")}])`); // <-- proves no overlap

// (4) Rename to "Modules" (old label gone).
check(/"Modules"/.test(adminJs), 'admin.js uses the "Modules" label');
check(!adminJs.includes("Sections / record types"), 'old "Sections / record types" label is gone');

// (5) Enforcement UNCHANGED — record-type areas are still hard-lockable server-side.
for (const h of ["#/contacts", "#/jobs", "#/bookings"]) {
  check(LOCKABLE_HREFS.includes(h), `server still treats ${h} as lockable (enforcement preserved, not removed)`);
}
const sanitized = sanitizeLockedPages(["#/jobs", "#/records/equipment", "#/reports"]);
check(sanitized.includes("#/jobs"), "a record-type lock (#/jobs) still survives sanitization (would 403 via lockGate)");
check(sanitized.includes("#/reports"), "a fixed-page lock (#/reports) still survives sanitization");
check(!sanitized.includes("#/records/equipment"), "custom-type page (#/records/equipment) was never server-lockable — unchanged");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (Pages & Modules are clean, split, non-overlapping; enforcement intact)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
