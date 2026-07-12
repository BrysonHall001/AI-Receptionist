// Pure self-test (no DB) for this batch's UI + the Calls-nav diagnosis.
//
//   npx tsx src/db/selfTest_moduleUiAndCalls.ts
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const app = readFileSync(resolve(__dirname, "../../public/js/app.js"), "utf8");
const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const api = readFileSync(resolve(__dirname, "../../src/routes/api.ts"), "utf8");
const svc = readFileSync(resolve(__dirname, "../../src/services/recordTypeService.ts"), "utf8");

console.log("Module UI + Calls-nav diagnosis");
console.log("==============================\n");

console.log("(4) Calls nav — receptionist gate removed (the real cause):");
check(!/items = items\.filter\(function \(it\) \{ return it\[0\] !== "#\/calls"; \}\);/.test(app), "app.js no longer deletes the Calls item when the receptionist is off");
check(!/if \(App\.state\.receptionistEnabled === false\) \{\s*NAV = NAV\.filter/.test(portal), "Pages editor no longer drops Calls when the receptionist is off");
check(/const portalViews = \{[^}]*"\/calls": "calls"/.test(app), "the #/calls route still renders the Calls page");
check(/buildPortalNav[\s\S]*?"#\/calls"/.test(readFileSync(resolve(__dirname, "../../public/js/navModel.js"), "utf8")), "Calls is still in the canonical pages list, after Home Dashboard");

console.log("\n(1) '+ Add field' removed; drag-drop + Add section kept:");
// The Fields column header must NOT create an "+ Add field" button any more.
check(!/"btn btn-primary btn-sm", "\+ Add field"/.test(portal), "the '+ Add field' button is gone from the Fields column");
check(/createFieldFromLibrary/.test(portal) && /mfLibraryDragType = t;/.test(portal), "drag-from-library field creation still wired");
check(/"btn btn-ghost btn-sm", "\+ Add section"/.test(portal), "'+ Add section' is kept");

console.log("\n(2) Fields header layout — Add section on the header row, intro tight beneath:");
check(/el\("div", "mf-fields-head-left"\)/.test(portal), "header has a left group (title + module)");
check(/col3Head\.appendChild\(addSec\)/.test(portal), "'+ Add section' sits on the header row");
check(/el\("p", "muted mf-fields-intro"\)/.test(portal) && /wrap\.appendChild\(intro\);/.test(portal), "the explanatory paragraph mounts right under the header");
check(!/const bar = el\("div", "page-actions"\);/.test(portal.slice(portal.indexOf("mf-fields-head"), portal.indexOf("mf-fields-head") + 1600)), "the separate button row that caused the gap is gone");

console.log("\n(3) '+ Add module' button + create form:");
check(/el\("button", "mf-mod-add", "\+ Add module"\)/.test(portal), "'+ Add module' button rendered in the modules row");
check(/App\.state\.me\.role !== "CLIENT_USER"/.test(portal.slice(portal.indexOf("mf-mod-add") - 400, portal.indexOf("mf-mod-add") + 200)), "the button is gated to portal-admin and above");
check(/function addModuleModal\(\)/.test(portal), "an Add-module create form exists");
check(/if \(!touched\) manyEl\.value = App\.pluralize\(oneEl\.value\)/.test(portal), "plural auto-fills from the singular via pluralize (editable)");
check(/"\/api\/record-types", \{ method: "POST", body: JSON\.stringify\(\{ label: one, labelPlural: many \}\) \}/.test(portal), "create posts to POST /api/record-types");

console.log("\n(3b) backend endpoint + service:");
check(/apiRouter\.post\("\/record-types"/.test(api), "POST /api/record-types endpoint exists");
check(/apiRouter\.post\("\/record-types"[\s\S]{0,400}?fieldsAdminOnly\(req, res\)/.test(api), "endpoint is role-gated (CLIENT_USER rejected)");
check(/export async function createRecordType\(tenantId: string, label: string/.test(svc), "createRecordType service exists");
check(/system: false/.test(svc) && /_max: \{ order: true \}/.test(svc) && /key: "name", label: "Name", type: "text"/.test(svc), "service: system:false, order-after-last, seeds a Name field");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (Calls gate removed; +Add field gone; header tidy; +Add module wired)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
