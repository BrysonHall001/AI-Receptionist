// Batch self-test — proves the Reports -> "Analytics" change is a display-only
// RELABEL of the DEFAULT label: the permission KEY, the route, and the view-area
// string are all unchanged, so the area is still "reports" everywhere it matters
// and remains relabelable in Settings -> Labels.
//
//   npx tsx src/db/selfTest_analyticsRelabel.ts
//
// No DB needed: this checks the permission catalog (real export) and the shipped
// public/js/app.js source (the single source of truth for nav defaults + titles).

import * as fs from "fs";
import * as path from "path";
import { getPermissionCatalog, AREAS, NAV_VIEW_AREAS } from "../services/permissionService";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

function main() {
  console.log("Analytics relabel — display-only default-label self-test");
  console.log("=======================================================");

  // ---------- (a) permission catalog: label flipped, KEY untouched ----------
  console.log("(a) permission area: label is \"Analytics\", key is still \"reports\":");
  const catalog = getPermissionCatalog();
  const reports = catalog.find((a: any) => a.key === "reports");
  check(!!reports, "an area with key \"reports\" still exists (key unchanged)");
  check(!!reports && reports.label === "Analytics", `that area's label is "Analytics" (got "${reports ? reports.label : "(missing)"}")`);
  check(!catalog.some((a: any) => a.key === "analytics"), "no NEW \"analytics\" key was introduced (it's a relabel, not a re-key)");
  const rawArea = AREAS.find((a: any) => a.key === "reports");
  check(!!rawArea && rawArea.label === "Analytics" && rawArea.kind === "data", "AREAS source entry: key reports / label Analytics / kind data");
  check(NAV_VIEW_AREAS.includes("reports"), "NAV_VIEW_AREAS still lists the \"reports\" view-area (route/view unchanged)");

  // ---------- (b) app.js: DEFAULT nav label + page title are "Analytics" ----------
  console.log("\n(b) public/js/app.js defaults: #/reports -> \"Analytics\", route/view-area intact:");
  const appJs = fs.readFileSync(path.join(__dirname, "../../public/js/app.js"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "../../public/js/navModel.js"), "utf8");
  // PORTAL_NAV default label for the #/reports route is "Analytics".
  check(/\["#\/reports",\s*"Analytics"\]/.test(appJs), "PORTAL_NAV default label for #/reports is \"Analytics\"");
  check(!/\["#\/reports",\s*"Reports"\]/.test(appJs), "no leftover \"Reports\" default label for #/reports");
  // titleMap (page heading) default for #/reports is "Analytics".
  check(/"#\/reports":\s*"Analytics"/.test(appJs), "titleMap default heading for #/reports is \"Analytics\"");
  // The ROUTE itself and the view-area string must be unchanged.
  check(/"#\/reports":\s*"reports"/.test(appJs), "route #/reports still resolves to the \"reports\" view-area");
  check(/"\/reports":\s*"reports"/.test(appJs), "portalViews still maps /reports -> \"reports\" view");

  // ---------- (c) the Section-1 assertion: default resolves to label while key stays ----------
  console.log("\n(c) #/reports default resolves to \"Analytics\" while the permission key stays \"reports\":");
  const navLabelIsAnalytics = /\["#\/reports",\s*"Analytics"\]/.test(appJs) && /"#\/reports":\s*"Analytics"/.test(appJs);
  const keyStaysReports = !!catalog.find((a: any) => a.key === "reports") && /"#\/reports":\s*"reports"/.test(appJs);
  check(navLabelIsAnalytics && keyStaysReports, "default label \"Analytics\" + permission/view key \"reports\" hold together");

  console.log("\n=======================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (Analytics is a display-only default relabel)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
