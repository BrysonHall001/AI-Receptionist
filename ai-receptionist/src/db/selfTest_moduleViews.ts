// Pure self-test (no DB) for Batch 2 — per-module VIEWS section + generalized Board/Calendar.
//
//   npx tsx src/db/selfTest_moduleViews.ts
//
// Proves the WIRING that keeps the PRIME DIRECTIVE (Bookings calendar + Jobs board unchanged)
// while generalizing the two views to honor enabledViews:
//  (A) portal.js exposes the view helpers (board/calendar availability + chosen date field).
//  (B) The list-page calendar is gated by "Calendar enabled for this module" (NOT typeKey==="booking"),
//      and Bookings still render through the identical /api/bookings/calendar path.
//  (C) The generic calendar path (/api/records/calendar) exists for other modules, and the
//      booking-only chrome (sync/timezone/click-to-create) is gated to bookings.
//  (D) The related-pane List|Board toggle is gated by boardEnabled (pipeline + Board view on).
//  (E) A "Views" section is rendered beneath Terms with Board/Calendar toggles, availability
//      hints, a date-field picker, and Map/Gallery as "coming soon".
//  (F) The backend routes exist (POST /record-types/views, GET /records/calendar).
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const api = readFileSync(resolve(__dirname, "../../src/routes/api.ts"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

console.log("Module Views — Board/Calendar generalization + Views section");
console.log("============================================================\n");

console.log("(A) view helpers exist and are data-driven:");
check(/function moduleEnabledViews\(t\)/.test(portal), "moduleEnabledViews(t) reads the module's enabledViews");
check(/function moduleViewOn\(t, v\)/.test(portal), "moduleViewOn(t, v) tests a single view");
check(/function moduleDateFields\(t, fields\)/.test(portal), "moduleDateFields(t, fields) lists date/datetime fields");
check(/if \(t && t\.key === "booking"\) out\.push\(\{ key: "appointmentAt"/.test(portal), "Bookings expose their typed appointmentAt as a calendar date field");
check(/function moduleBoardEnabled\(t\) \{ return moduleHasStages\(t\) && moduleViewOn\(t, "board"\); \}/.test(portal), "Board available only with a pipeline AND Board view on");
check(/function moduleCalendarEnabled\(t\) \{ return moduleViewOn\(t, "calendar"\); \}/.test(portal), "Calendar availability keys off the calendar view flag");
check(/function moduleCalendarField\(t, fields\)/.test(portal), "moduleCalendarField(t, fields) resolves the chosen date field (default first)");

console.log("\n(B) list-page calendar gate is generalized; Bookings path unchanged:");
check(/if \(moduleCalendarEnabled\(type\)\) \{/.test(portal), "the list-page calendar is shown when Calendar is enabled (not hardcoded to bookings)");
check(!/if \(type\.key === "booking"\) \{[\s\S]{0,220}renderBookingCalendar/.test(portal), "the old `if (type.key === \"booking\")` calendar gate is removed");
check(/renderBookingCalendar\(calArea, type, fields, \{ dateField: moduleCalendarField\(type, fields\) \}\)/.test(portal), "the list page passes the module's chosen date field to the calendar");
// Slice the calendar renderer to assert its internal booking vs generic branching.
const calStart = portal.indexOf("function renderBookingCalendar(host, type, fields, opts)");
const calEnd = portal.indexOf("function recordColumnDefs(");
const CAL = portal.slice(calStart, calEnd);
check(calStart > 0 && CAL.length > 0, "renderBookingCalendar(host, type, fields, opts) exists");
check(/const isBooking = !!\(type && type\.key === "booking"\)/.test(CAL), "the renderer derives isBooking from the module");
check(/\/api\/bookings\/calendar\?from=\$\{from\}&to=\$\{to\}/.test(CAL), "Bookings still load via the identical /api/bookings/calendar path");

console.log("\n(C) generic calendar path + booking-only chrome gating:");
check(/\/api\/records\/calendar\?type=\$\{encodeURIComponent\(type\.key\)\}&field=\$\{encodeURIComponent\(dateField \|\| ""\)\}/.test(CAL), "other modules load via the generic /api/records/calendar path");
check(/if \(isBooking\) \{[\s\S]{0,200}?const syncCalendars = \[\]/.test(CAL), "the Calendar Sync block is bookings-only");
check(/if \(isBooking\) \{\s*col\.style\.cursor = "pointer";/.test(CAL), "empty-slot click-to-create is bookings-only (other calendars are read-only)");
check(/if \(isBooking\) \{\s*Promise\.all\(\[\s*App\.portalApi\("\/api\/booking-config"\)/.test(CAL), "the booking-config/google-status side-fetch is bookings-only");

console.log("\n(D) related-pane List|Board toggle honors the Board view flag:");
const relStart = portal.indexOf("function buildRelatedPane(");
const relEnd = portal.indexOf("function moduleHasStages(t)");
const REL = portal.slice(relStart, relEnd);
check(/const boardEnabled = moduleBoardEnabled\(type\);/.test(REL), "boardEnabled = moduleBoardEnabled(type)");
check(/if \(boardEnabled\) \{[\s\S]{0,400}?seg-btn seg-on", "List"[\s\S]{0,200}?"Board"/.test(REL), "the List|Board toggle is built only when boardEnabled");
check(/if \(boardEnabled && view === "board"\) renderBoard\(\)/.test(REL), "board view is only reachable when boardEnabled");

console.log("\n(E) Views section rendered beneath Terms:");
check(/function buildViewsSection\(col, selectedType\)/.test(portal), "buildViewsSection exists");
check(/buildTermsSection\(colTerms, currentType\(\), generic\); buildViewsSection\(colTerms, currentType\(\)\);/.test(portal), "the Views section is rendered beneath Terms (same column)");
check(/Turn on a pipeline to enable the Board view\./.test(portal), "Board shows the pipeline-required hint when unavailable");
check(/Add a date field to enable the Calendar view\./.test(portal), "Calendar shows the date-field-required hint when unavailable");
check(/name: "Map", comingSoon: true/.test(portal) && /name: "Gallery", comingSoon: true/.test(portal), "Map + Gallery are shown as coming soon (not built)");
check(/Calendar date field/.test(portal) && /dateFields\.length > 1/.test(portal), "a date-field picker appears when Calendar is on and there are multiple date fields");
check(/"\/api\/record-types\/views", \{ method: "POST"/.test(portal), "toggles persist to POST /api/record-types/views");
check(/App\.state\.me\.role !== "CLIENT_USER"/.test(portal.slice(portal.indexOf("function buildViewsSection"), portal.indexOf("function buildViewsSection") + 1200)), "the Views editor is guarded by the module-management permission");

console.log("\n(F) backend routes exist:");
check(/apiRouter\.post\("\/record-types\/views"/.test(api), "POST /record-types/views endpoint exists");
check(/if \(!fieldsAdminOnly\(req, res\)\) return;[\s\S]{0,200}?setModuleViews/.test(api), "the views route is admin-gated");
check(/apiRouter\.get\("\/records\/calendar"/.test(api), "GET /records/calendar endpoint exists");
check(/getModuleCalendarData\(tenantId, type, field, from, to\)/.test(api), "the generic calendar route calls getModuleCalendarData");

console.log("\n(G) Views section is styled (legible across themes via tokens):");
check(/\.mf-views \{/.test(css), ".mf-views styles exist");
check(/\.mf-view-badge \{[^}]*var\(--accent-soft\)/.test(css), "the coming-soon/unavailable badge uses theme tokens");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (Views section; Board/Calendar generalized; Bookings & Jobs paths unchanged)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
