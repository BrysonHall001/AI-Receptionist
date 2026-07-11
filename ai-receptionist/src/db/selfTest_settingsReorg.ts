// Batch self-test — Settings reorg (Fields → Settings, Scheduling+Resources merge)
// plus the Notify Email caption fix. Structural/static (fs reads), so it runs in the
// sandbox. Layout/behavior itself is covered by the manual-check notes.
//
//   npx tsx src/db/selfTest_settingsReorg.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

function main() {
  console.log("Settings reorg + caption fix");
  console.log("============================");

  const app = read("../../public/js/app.js");
  const portal = read("../../public/js/portal.js");
  const api = read("../routes/api.ts");
  const navTest = read("./selfTest_navReconciliation.ts");

  // ---------- (1) Notify Email caption fixed ----------
  console.log("(1) Notify Email caption:");
  check(/Where call summaries and business notifications are sent\./.test(portal), "caption reads the corrected short version");
  check(!/reply-to address on emails to your contacts/.test(portal), "inaccurate reply-to wording is gone");

  // ---------- (2) Fields removed from the left nav (no dead route) ----------
  console.log("\n(2) Fields off the left nav:");
  check(!app.includes('"#/fields"'), "no '#/fields' in PORTAL_NAV / titleMap / NAV_VIEW_AREA");
  check(!/"\/fields": "fields"/.test(app), "portalViews no longer maps '/fields' to a standalone view");
  check(/path === "\/fields"\) return App\.go\("#\/settings\/fields"\)/.test(app), "old #/fields deep-links redirect to Settings → Fields");
  check(!/\["#\/fields", "Fields"\]/.test(app), "PORTAL_NAV entry for Fields removed");
  check(!/\["#\/fields", null\]/.test(navTest), "nav reconciliation mirror updated (Fields removed)");

  // ---------- (3) Settings → Fields hosts the full editor inline ----------
  console.log("\n(3) Settings → Fields (inline full editor):");
  check(/async function renderFields\(refresh, mountEl\)/.test(portal), "renderFields accepts an optional mount target");
  check(/function fieldsView\(\)\s*\{\s*return fieldsMount \|\| view\(\); \}/.test(portal), "fieldsView() routes renders to the settings panel when hosted");
  check((portal.match(/fieldsView\(\)\.appendChild\(wrap\)/g) || []).length >= 1, "renderFields mounts through fieldsView() (routes to the settings panel when hosted)");
  check(/fieldsMount = host;\s*\n\s*await renderFields\(true, host\);/.test(portal), "secFields mounts renderFields inline into its panel");
  check(!/href="#\/fields"/.test(portal), "the old 'Open field settings →' link is gone");

  // ---------- (4) Scheduling + Resources merged into one tab ----------
  console.log("\n(4) Scheduling & Resources merged:");
  check(/label: "Scheduling & Resources", admin: true, build: secSchedulingResources/.test(portal), "single 'Scheduling & Resources' settings tab");
  check(!/key: "resources"/.test(portal), "separate Resources tab entry removed");
  check(!/{ key: "scheduling", label: "Scheduling",/.test(portal), "separate Scheduling tab entry removed");
  check(/async function secSchedulingResources\(panel\)/.test(portal), "combined builder exists");
  check(/await secScheduling\(schedWrap\);\s*\n\s*await secResources\(resWrap\);/.test(portal), "combined builder stacks BOTH existing panels (no save logic merged)");
  check(/async function secScheduling\(panel\)/.test(portal) && /async function secResources\(panel\)/.test(portal), "both original builders are reused as-is");

  // ---------- (5) Server endpoints untouched (still reachable) ----------
  console.log("\n(5) APIs untouched & reachable:");
  check(/apiRouter\.(get|post)\("\/fields"/.test(api) && /"\/record-types"/.test(api) && /"\/field-sections"/.test(api), "field endpoints unchanged");
  check(/"\/booking-config"/.test(api), "scheduling save endpoint (/booking-config) unchanged");
  check(/apiRouter\.(get|post)\("\/resources"/.test(api), "resources endpoint unchanged");

  console.log("\n============================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (settings reorg)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
