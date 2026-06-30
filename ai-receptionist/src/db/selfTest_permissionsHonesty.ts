// Batch self-test (static, sandbox-runnable) — reclassify communication/dashboard/reports,
// gate templates/surveys to the communication area, redesign the Team & Permissions table
// (per-section columns + single Settings toggle), and the Email-Templates panel-width fix.
// Behavioral permission assertions live in the seven DB-backed permission self-tests
// (run in the Codespace); this pins the catalog/gate/UI/CSS edits that must stay in lockstep.
//
//   npx tsx src/db/selfTest_permissionsHonesty.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

function main() {
  console.log("Reclassify + gate communication + table redesign + panel width");
  console.log("==============================================================");

  const svc = read("../services/permissionService.ts");
  const gate = read("../middleware/permissionGate.ts");
  const portal = read("../../public/js/portal.js");
  const css = read("../../public/styles.css");

  // ---------- (1) reclassification ----------
  console.log("(1) catalog reclassification:");
  for (const key of ["communication", "dashboard", "reports"]) {
    const re = new RegExp(`key: "${key}",[^}]*kind: "data",[^}]*section: "Data"`);
    check(re.test(svc), `${key} is now data-kind in the Data section`);
  }
  check(/key: "calls",[^}]*kind: "readonly",[^}]*section: "Operations"/.test(svc), "calls stays read-only in Operations");
  check(/key: "learn",[^}]*kind: "readonly",[^}]*section: "Operations"/.test(svc), "learn stays read-only in Operations");
  check(/key: "dashboard", label: "Home Dashboard"/.test(svc), "dashboard relabeled 'Home Dashboard'");

  // ---------- (2) communication gating (the real enforcement fix) ----------
  console.log("\n(2) communication gating:");
  check(/re: \/\^\\\/templates\$\/, area: "communication", right: "edit"/.test(gate), "POST /templates -> communication.edit (was ungated)");
  check(/re: \/\^\\\/templates\\\/\[\^\/\]\+\$\/, area: "communication", right: "delete"/.test(gate), "DELETE /templates -> communication.delete");
  check(/re: \/\^\\\/templates\(\\\/\|\$\)\/, area: "communication", right: "view"/.test(gate), "GET /templates -> communication.view");
  check(/re: \/\^\\\/surveys\$\/, area: "communication", right: "edit"/.test(gate), "POST /surveys -> communication.edit (re-pointed from contacts)");
  check(/re: \/\^\\\/surveys\\\/\[\^\/\]\+\$\/, area: "communication", right: "delete"/.test(gate), "DELETE /surveys -> communication.delete");
  check(/re: \/\^\\\/surveys\(\\\/\|\$\)\/, area: "communication", right: "view"/.test(gate), "GET /surveys -> communication.view (viewable without contact-edit)");
  check(/re: \/\^\\\/communication\\\/email\$\/, area: "communication", right: "edit"/.test(gate), "POST /communication/email -> communication.edit");
  check(!/surveys\$\/, area: "contacts"/.test(gate), "surveys no longer gated to contacts.edit");

  // ---------- (3) dashboards stay intentionally OPEN ----------
  console.log("\n(3) dashboards left open by decision:");
  check(!/m: "(POST|PATCH|DELETE)", re: [^\n]*dashboards/.test(gate), "no PERM_RULES gate dashboard mutations (left open)");
  check(/intentionally LEFT OPEN/.test(gate), "comment documents the deliberate open-dashboards decision");

  // ---------- (4) table redesign: per-section columns + single Settings toggle ----------
  console.log("\n(4) permissions table redesign:");
  check(/Operations: \[\["view", "Access"\]\]/.test(portal), "Operations section renders a single 'Access' column");
  check(/Data: \[\["view", "View"\], \["edit", "Edit"\], \["delete", "Delete"\]\]/.test(portal), "Data section renders View/Edit/Delete only");
  check(/Manage Settings \(all\)/.test(portal), "Settings collapses to one 'Manage Settings (all)' toggle");
  check(/grantableKeys = areas\.filter\(\(a\) => !a\.locked\)\.map/.test(portal), "settings toggle writes every grantable settings_* key");
  check(/are always admin-managed/.test(portal), "locked Integrations/Lead-capture noted under the toggle");
  check(!/colLabel = \{ view: "View", edit: "Edit", delete: "Delete", manage: "Manage Settings" \}/.test(portal), "old shared 4-column grid removed (no dead cells)");
  check(/cb\.getAttribute\("data-area"\)\.split\(","\)\.forEach/.test(portal), "collectPermissions expands multi-key toggles (settings + groups)");

  // ---------- (5) panel width fix (named root cause: the 820px floor) ----------
  console.log("\n(5) panel width fix:");
  check(/ROOT CAUSE of the recurring Email-Templates width/.test(css), "root cause documented inline");
  check(/\.survey-master \.table-wrap table \{ width: auto; min-width: 100%; \}/.test(css), "library table fills the panel (820px floor overridden)");
  check(/\.survey-master \.table-wrap \{ overflow-x: auto; max-width: 100%; \}/.test(css), "table scrolls INSIDE the fixed panel, capped at 100%");
  check(!/\.survey-master \.data-table-scroll, \.survey-master \.table-scroll/.test(css), "dead scroll rule stays removed");

  console.log("\n==============================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (reclassify + gate + table + panel)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
