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
  // CONVERTED (permissions-regroup batch): these three were regexes over the SERVICE'S SOURCE
  // TEXT - they matched `key: "x", kind: "data", section: "Data"` and so broke on any edit to
  // the file, including a pure relabelling. What they were protecting is a BEHAVIOURAL fact:
  // these areas expose the rights their kind promises, and a role's effective access agrees.
  // That is now asserted against the published catalog and the real matrix, so it survives a
  // rename and still fails if a right or a grant actually moves.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getPermissionCatalog, permissionMatrixForRole } = require("../services/permissionService");
  const catalog: any[] = getPermissionCatalog();
  const areaOf = (k: string) => catalog.find((a) => a.key === k);
  for (const key of ["communication", "dashboard", "reports"]) {
    const a = areaOf(key);
    check(!!a && a.rights.join(",") === "view,edit,delete",
      `${key} exposes the full view/edit/delete set (${a ? a.rights.join(",") : "MISSING"})`);
  }
  for (const key of ["calls", "learn"]) {
    const a = areaOf(key);
    check(!!a && a.rights.join(",") === "view",
      `${key} stays read-only \u2014 one right, nothing to edit or delete (${a ? a.rights.join(",") : "MISSING"})`);
  }
  {
    // and the rights are real, not just declared: an OWNER can do all three on a data area,
    // and cannot edit or delete a read-only one, whatever section any of them sits in.
    const m = permissionMatrixForRole("OWNER");
    check(m.reports.view === true && m.reports.edit === true && m.reports.delete === true,
      "\u2026and an OWNER really does get all three on a data area");
    check(m.calls.view === true && m.calls.edit === undefined && m.calls.delete === undefined,
      "\u2026while a read-only area has no edit or delete to grant at all");
  }
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
  // CONVERTED (permissions-regroup batch): this matched the literal SECTION_COLS entry
  // `Operations: [["view", "Access"]]`, which no longer exists - columns are derived from
  // each area's own rights rather than from its section's name, precisely so a rename cannot
  // silently drop a column. The INTENT (an area with one right shows one "Access" column,
  // not a lone tick in column one of three) is asserted by rendering it.
  let pagesHtml = "";
  {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getPermissionCatalog: cat2 } = require("../services/permissionService");
    const catalog2: any[] = cat2();
    const body = portal.slice(portal.indexOf("        const RIGHT_LABEL = {"), portal.indexOf('        return (data.sections || []).map(sectionTable).join("");'));
    const esc2 = (x: any) => String(x);
    const full2 = Object.fromEntries(catalog2.map((a) => [a.key, Object.fromEntries(a.rights.map((r: string) => [r, true]))]));
    // eslint-disable-next-line no-new-func
    const st = new Function("data", "esc", "role", "my", "editing", "App", body + "\nreturn sectionTable;")(
      { catalog: catalog2 }, esc2, { permissions: full2, editable: true }, full2, false, { util: {} });
    pagesHtml = st("Pages");
    check(/<th>Access<\/th>/.test(pagesHtml) && !/SECTION_COLS/.test(body),
      "a single-right area renders one 'Access' column, and no column is chosen by section name");
  }
  // CONVERTED with the one above: the same SECTION_COLS literal, now derived from rights.
  check(/<th>View<\/th><th>Edit<\/th><th>Delete<\/th>/.test(pagesHtml) && !/<th>Manage<\/th>/.test(pagesHtml),
    "a three-right area renders View/Edit/Delete and nothing else");
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
