// Batch self-test (static, sandbox-runnable) — the four Communication + Settings fixes:
// equal Email-Templates panels, click-to-open templates, polished Merge Tag/Button
// toolbar controls, and Recycle Bin relocated into Settings → Data Administration.
//
//   npx tsx src/db/selfTest_commSettingsFixes.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

function main() {
  console.log("Communication + Settings fixes");
  console.log("==============================");

  const communication = read("../../public/js/communication.js");
  const compose = read("../../public/js/compose.js");
  const css = read("../../public/styles.css");
  const portal = read("../../public/js/portal.js");
  const app = read("../../public/js/app.js");

  // ---------- (1) Email Templates: equal panels ----------
  console.log("(1) equal Email-Templates panels:");
  check(/const leftPane = el\("div", "card survey-master"\)/.test(communication), "library pane uses card+survey-master (same as Surveys)");
  check(/const rightPane = el\("div", "survey-detail"\); rightPane\.appendChild\(card\)/.test(communication), "editor pane is survey-detail");
  check(/const split = el\("div", "survey-split"\)/.test(communication), "wrapped in the shared survey-split container");
  check(!/const libCard = el\("div", "card"\)/.test(communication.slice(communication.indexOf("Template Library (LEFT"), communication.indexOf("survey-split"))), "no extra double-wrap card around the library");

  // ---------- (2) clicking a template row opens it ----------
  console.log("\n(2) click-to-open template:");
  check(/onRowClick: \(r\) => \{ setEdit\(r\); card\.scrollIntoView/.test(communication), "row click loads the template into the editor");
  check(/if \(state\.id\) await App\.portalApi\("\/api\/templates\/"/.test(communication), "Save updates the bound row (no duplicate)");
  check(/class="btn btn-ghost btn-sm tpl-edit"/.test(communication), "the Edit button is still present too");

  // ---------- (3) Merge Tag + Button toolbar controls ----------
  console.log("\n(3) toolbar controls:");
  check(/<span>Merge Tag<\/span>/.test(compose), "Merge Tag renders on one line (single label span)");
  check(/mtBtn\.innerHTML = '<svg[\s\S]*?circle/.test(compose), "Merge Tag has a tag icon");
  check(/ctaBtn\.innerHTML = '<svg[\s\S]*?<span>Button<\/span>/.test(compose), "Button renders as an icon + label (not bare text)");
  check(/button\.ql-cta,\s*\n\.ql-toolbar\.email-toolbar button\.ql-merge \{[\s\S]*?white-space: nowrap/.test(css), "both controls are styled buttons on a single line (nowrap)");
  check(/button\.ql-merge \{[\s\S]*?border: 1px solid var\(--line-strong\)/.test(css) || /button\.ql-cta,[\s\S]*?border: 1px solid var\(--line-strong\)/.test(css), "controls have a proper button border/background");

  // propagation: the shared composer is mounted everywhere (so the fix shows at each)
  check(/MOUNT_SITES = \[/.test(compose), "shared composer enumerates its mount sites (propagation)");

  // ---------- (4) Recycle Bin → Settings → Data Administration ----------
  console.log("\n(4) Recycle Bin relocation:");
  check(!/recycle-link/.test(app), "the Recycle Bin sidebar button is removed");
  check(/if \(path === "\/recycle"\) return App\.go\("#\/settings\/data\/recycle"\)/.test(app), "old #/recycle route redirects to the new tab");
  check(!/"\/recycle": "recycle"/.test(app), "no dead portalViews entry for /recycle");
  check(/\["recycle", "Recycle Bin"\]/.test(portal), "Recycle Bin is a Data Administration tab");
  check(/else if \(key === "recycle"\) renderRecycleBin\(tabBody\)/.test(portal), "the tab renders the EXISTING recycle bin into the tab body");
  check(/async function renderRecycleBin\(mountEl\) \{\s*\n\s*const host = mountEl \|\| view\(\)/.test(portal), "renderRecycleBin mounts into the tab (or full view) unchanged");
  check(/async function renderDataAdmin\(panel, initialTab\)/.test(portal) && /setTab\(active\)/.test(portal), "Data Admin can open straight to a given sub-tab");
  check(/await def\.build\(panel, subTab\)/.test(portal) && /#\/settings\/data\/recycle/.test(portal), "settings routes a sub-tab (so #/settings/data/recycle opens the bin)");
  check(!/if \(v === "recycle"\) return renderRecycleBin\(\)/.test(portal), "no standalone recycle view dispatch remains");

  // endpoints + restore unchanged and reachable from the relocated bin
  check(/\/api\/contacts\/deleted/.test(portal) && /\/api\/contacts\/restore/.test(portal) && /\/api\/records\/restore/.test(portal), "recycle data + restore endpoints unchanged");
  // restore/back navigation now returns to the new location
  check(/App\.go\("#\/settings\/data\/recycle"\)/.test(portal), "after restore, navigation returns to the Data Administration tab");
  // preview deep-links preserved
  check(/"#\/recycle\/contact\/"/.test(portal) && /"#\/recycle\/record\/"/.test(portal), "read-only preview deep-links are preserved");

  console.log("\n==============================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (comm + settings fixes)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
