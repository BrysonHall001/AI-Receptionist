// Pure self-test (no DB) for the five pre-built modules' wiring: the registry has all five
// entries with seeders, the options still carry defaultHidden, and the create-tenant picker
// now defaults EVERY module ON (checked) — unchecking is the opt-out that hides a module.
// (Batch: the picker used to start the pre-built five unchecked; it now starts them checked,
// matching the pages list. Section (4) below was updated for that intentional change.)
//
//   npx tsx src/db/selfTest_prebuiltModulesUi.ts
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const rtSvc = readFileSync(resolve(__dirname, "../../src/services/recordTypeService.ts"), "utf8");
const admin = readFileSync(resolve(__dirname, "../../public/js/admin.js"), "utf8");

console.log("Pre-built modules — wiring");
console.log("==========================\n");

console.log("(1) registry entries + seeders (recordTypeService):");
for (const [key, plural, order] of [["vehicle", "Vehicles", 5], ["property", "Properties", 6], ["product", "Products", 7], ["estimate", "Estimates", 8], ["task", "Tasks", 9]] as const) {
  const re = new RegExp(`key: "${key}", label: "[^"]+", labelPlural: "${plural}", system: false,\\s*\\n\\s*stages: \\[\\], recordStages: \\[\\], subtypes: \\[\\], order: ${order},[\\s\\S]{0,120}defaultHidden: true`);
  check(re.test(rtSvc), `${plural} registered at order ${order} with defaultHidden: true`);
}
check(/export async function ensureVehicleDefaultFields/.test(rtSvc) && /export async function ensurePropertyDefaultFields/.test(rtSvc) && /export async function ensureProductDefaultFields/.test(rtSvc) && /export async function ensureEstimateDefaultFields/.test(rtSvc) && /export async function ensureTaskDefaultFields/.test(rtSvc), "all five named field-seeders exist");

console.log("\n(2) seeded fields include the notable types:");
check(/key: "property_address", label: "Property address", type: "address"/.test(rtSvc), "Properties seeds an address field");
check(/key: "line_items", label: "Line items", type: "line_items", order: 4 \}[\s\S]{0,120}key: "total", label: "Total", type: "currency"/.test(rtSvc), "Estimates seeds a line_items table + a currency total (auto-computed)");
check(/key: "vin", label: "VIN", type: "text"/.test(rtSvc) && /key: "vehicle_type"[\s\S]{0,80}"Car", "Truck", "SUV", "Van", "Motorcycle", "Other"/.test(rtSvc), "Vehicles seeds VIN + a vehicle-type select");
check(/key: "priority"[\s\S]{0,90}"Low", "Medium", "High", "Urgent"/.test(rtSvc) && /key: "assignee", label: "Assignee", type: "text"/.test(rtSvc), "Tasks seeds priority + a text assignee (no invented user-link type)");
check(!/key: "title"/.test(rtSvc.slice(rtSvc.indexOf("DEFAULT_TASK_FIELDS"), rtSvc.indexOf("DEFAULT_TASK_FIELDS") + 400)) && !/key: "name"/.test(rtSvc.slice(rtSvc.indexOf("DEFAULT_PRODUCT_FIELDS"), rtSvc.indexOf("DEFAULT_PRODUCT_FIELDS") + 500)), "Products/Tasks reuse the built-in record Title (no duplicate name/title field)");

console.log("\n(3) picker options carry defaultHidden:");
check(/defaultHidden: !!d\.defaultHidden/.test(rtSvc), "systemRecordTypeOptions() exposes defaultHidden");

console.log("\n(4) create-tenant picker now defaults EVERY module ON (admin.js):");
check(/cb\.checked = true;/.test(admin), "togglable modules start CHECKED (on) by default");
check(!/const startHidden = !!opt\.defaultHidden;/.test(admin), "the picker no longer forces pre-built modules off");
check(!/cb\.checked = !startHidden;/.test(admin), "no module is pre-unchecked from defaultHidden anymore");
check(/if \(cb\.checked\) set\.delete\(opt\.key\); else set\.add\(opt\.key\);/.test(admin), "unchecking a module adds its key to hiddenRecordTypes (hide is now the opt-out)");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (five modules registered, seeded, and default-ON in the picker)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
