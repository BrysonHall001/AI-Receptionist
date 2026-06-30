// Batch self-test (static, sandbox-runnable) — Permissions UI honesty + Communication
// view consistency + Template panel containment. Behavioral permission assertions live
// in the seven DB-backed permission self-tests (run in the Codespace); this pins the
// catalog/UI/gate/CSS edits that must stay in lockstep.
//
//   npx tsx src/db/selfTest_permissionsHonesty.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

function main() {
  console.log("Permissions honesty + comm + panel width");
  console.log("========================================");

  const svc = read("../services/permissionService.ts");
  const gate = read("../middleware/permissionGate.ts");
  const portal = read("../../public/js/portal.js");
  const css = read("../../public/styles.css");

  // ---------- (1) catalog relabel + group + locked (presentation only) ----------
  console.log("(1) catalog presentation:");
  check(/key: "settings_general", label: "Business Profile"/.test(svc), "settings_general relabeled 'Business Profile' (key unchanged)");
  check(/key: "settings_scheduling"[\s\S]*?group: "scheduling_resources", groupLabel: "Scheduling & Resources"/.test(svc) && /key: "settings_resources"[\s\S]*?group: "scheduling_resources"/.test(svc), "scheduling + resources grouped (both keys still present)");
  check(/key: "settings_integrations"[\s\S]*?locked: true/.test(svc) && /key: "settings_leadcapture"[\s\S]*?locked: true/.test(svc), "integrations + lead capture flagged locked");
  check(/getPermissionCatalog[\s\S]*?group: a\.group, groupLabel: a\.groupLabel, locked: !!a\.locked, lockedNote: a\.lockedNote/.test(svc), "catalog exposes group/locked metadata to the UI");

  // ---------- (2) enforcement INTACT (no behavior change) ----------
  console.log("\n(2) enforcement unchanged:");
  check(/area: "settings_scheduling", right: "manage"/.test(gate) && /area: "settings_resources", right: "manage"/.test(gate), "both scheduling + resources gate rules still present (merge is UI-only)");
  check(!/locked/.test(gate), "permissionGate has no notion of 'locked' (presentation lives in the catalog/UI)");
  check(/PATCH.*\/booking-config.*settings_scheduling|settings_scheduling[\s\S]*?booking-config/.test(gate.replace(/\n/g, " ")), "booking-config still maps to settings_scheduling");

  // ---------- (3) Communication view consistency ----------
  console.log("\n(3) communication honesty:");
  check(/re: \/\^\\\/communication\\\/sends\$\/, area: "communication", right: "view"/.test(gate), "GET /communication/sends -> communication.view (page viewable)");
  check(/re: \/\^\\\/communication\\\/email\$\/, area: "contacts", right: "edit"/.test(gate), "POST /communication/email still -> contacts.edit (sending stays gated)");

  // ---------- (4) stale comment fixed ----------
  console.log("\n(4) comment honesty:");
  check(!/takes effect when enforcement is rolled out in\s*\n?\s*\/\/ Batch 2/.test(svc) && /Enforcement is active: permissionGate is mounted/.test(svc), "CLIENT_USER comment states enforcement is LIVE (not dormant)");

  // ---------- (5) Team & Permissions table: merged row + locked rows ----------
  console.log("\n(5) permissions table UI:");
  check(/function displayRows\(areas\)/.test(portal) && /a\.group/.test(portal), "table merges grouped areas into one row");
  check(/if \(row\.locked\) return `<td[\s\S]*?\\uD83D\\uDD12/.test(portal), "locked rows render a lock (non-toggleable)");
  check(/data-area="\$\{esc\(keys\.join\(","\)\)\}"/.test(portal), "one toggle can carry several real area keys (merged row writes both)");
  check(/cb\.getAttribute\("data-area"\)\.split\(","\)\.forEach/.test(portal), "collectPermissions expands comma-joined keys on save");
  check(/managed by admins only and can't be granted here/.test(portal), "intro explains locked rows");

  // ---------- (6) Template panel containment (the recurring width bug) ----------
  console.log("\n(6) panel width fix:");
  check(!/\.survey-master \.data-table-scroll, \.survey-master \.table-scroll/.test(css), "dead .data-table-scroll/.table-scroll rule removed");
  check(/\.survey-master \.table-layout \{ min-width: 0; \}/.test(css), "flex .table-layout gets min-width:0 (table can't size the panel)");
  check(/\.survey-master \.table-wrap \{ overflow-x: auto; \}/.test(css), "library table scrolls INSIDE the fixed panel");

  console.log("\n========================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (permissions honesty + comm + panel)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
