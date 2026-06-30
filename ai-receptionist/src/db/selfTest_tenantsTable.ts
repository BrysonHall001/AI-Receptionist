// Static self-test (sandbox-runnable, fs-reads only) for the master-hub batch:
// (1) "Portals" -> "Tenants" user-facing rename, (2) cards -> App.table conversion,
// while internal identifiers (routes, API paths, state keys, fn names) stay intact.
//   npx tsx src/db/selfTest_tenantsTable.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;

function main() {
  console.log("Master hub: Portals -> Tenants + cards -> table");
  console.log("================================================");
  const app = read("../../public/js/app.js");
  const admin = read("../../public/js/admin.js");

  // ---------- (1) rename: new labels present ----------
  console.log("(1) user-facing labels renamed to Tenant(s):");
  check(has(app, '["#/admin/portals", "Tenants"]'), 'app.js ADMIN_NAV label is "Tenants"');
  check(has(app, '"#/admin/portals": "Tenants"'), 'app.js titleMap label is "Tenants"');
  check(has(app, '"\u2190 All tenants"'), 'app.js back-link is "\u2190 All tenants"');
  for (const s of ['"+ Create tenant"', '"\u2190 Tenants"', '"Create tenant first"', '"Create a tenant"',
    '"Create tenant"', 'toast("Tenant created")', 'toast("Tenant updated")', '"Finish \u2014 go to tenant"',
    '"Back to tenants"', "No tenants yet", "Open tenant \u2192", "No users in this tenant yet",
    "the tenant's colors", "Turn tenant features on or off. New tenants start with"]) {
    check(has(admin, s), `admin.js has ${JSON.stringify(s)}`);
  }

  // ---------- (1b) old labels gone ----------
  console.log("\n(1b) old 'Portal' labels removed:");
  for (const s of ['"\u2190 All portals"']) check(!has(app, s), `app.js no longer has ${JSON.stringify(s)}`);
  for (const s of ['"+ Create portal"', '"\u2190 Portals"', '"Create portal first"', '"Create a portal"',
    'toast("Portal created")', 'toast("Portal updated")', '"Finish \u2014 go to portal"', '"Back to portals"',
    "No portals yet", "Open portal \u2192"]) {
    check(!has(admin, s), `admin.js no longer has ${JSON.stringify(s)}`);
  }
  // The Contact identity rule dropdown is removed from the card/table THIS batch, but
  // still lives in the create-portal screen (its removal is a later batch). Assert it's
  // gone from the list view but intentionally still present in the setup flow.
  check(!has(admin, 'portal-rule-sel'), "identity dropdown removed from the list (no portal-rule-sel)");
  check(has(admin, '#sp-rule') && has(admin, "Contact identity rule"), "identity rule still in the create screen (later-batch removal)");

  // ---------- (2) internal identifiers intact ----------
  console.log("\n(2) internal identifiers untouched:");
  check(has(app, '"#/admin/portals"'), "app.js route #/admin/portals intact");
  check(has(admin, "/api/admin/portals"), "admin.js API path /api/admin/portals intact");
  check(has(admin, "currentPortalId"), "admin.js currentPortalId intact");
  check(has(admin, "function renderPortals"), "renderPortals fn name intact");
  check(has(admin, "function enterPortal"), "enterPortal fn name intact");
  check(has(admin, "function renderPortalUsers"), "renderPortalUsers fn name intact");
  check(has(admin, 'current = "portals"'), 'state current = "portals" intact');
  check(has(admin, "portal-recep-sel"), "portal-recep-sel class reused (not renamed)");
  check(has(admin, '"PORTAL_ADMIN">Portal admin'), "Portal Admin ROLE label intentionally NOT renamed");

  // ---------- (3) cards -> App.table ----------
  console.log("\n(3) list converted to App.table:");
  check(has(admin, "App.table.mount("), "renderPortals mounts App.table");
  check(!has(admin, "portal-grid") && !has(admin, "portal-card"), "old card grid markup removed");
  for (const c of ['"Tenant Name"', '"Status"', '"Created"', '"AI Receptionist"', '"Calls"', '"Contacts"', '"Users"', '"Actions"']) {
    check(has(admin, c), `table column ${c} present`);
  }
  check(has(admin, 'data-act="open"') && has(admin, 'data-act="toggle"') && has(admin, 'data-act="users"'), "row actions open/toggle/users present");
  check(has(admin, "t-voice"), "embedded AI Receptionist control present");
  check(has(admin, "JSON.stringify({ voiceMode })"), "voice control still PATCHes voiceMode to /api/admin/portals");
  check(has(admin, 'defaultSort: "created"'), "table defaults to sorting by Created");

  console.log("\n================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (rename + table)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
