// Batch self-test — Integrations tile grid. Static/structural (fs reads), runs in the
// sandbox. Layout comfort itself is covered by the manual-check notes; here we pin the
// hard sizing rules and prove no connect/save/toggle wiring changed.
//
//   npx tsx src/db/selfTest_integrationsTiles.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

function main() {
  console.log("Integrations tile grid");
  console.log("======================");
  const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
  const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8"); // design Phase 3: tile styling lives in classes now
  const segStart = portal.indexOf("function renderIntegrations");
  const seg = portal.slice(segStart, portal.indexOf("\n  async function ", segStart + 1)); // forward to the next top-level function

  // ---- (1) enforced tile sizing ----
  console.log("(1) tile grid sizing:");
  check(/grid\.className = "intg-grid"/.test(seg) && /\.intg-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(320px, 1fr\)\)/.test(css), "responsive grid: auto-fill + minmax(320px, 1fr) (never below 320px) — via .intg-grid (design Phase 3)");
  check(/\.intg-grid \{[^}]*gap: var\(--sp-4\)/.test(css) && /--sp-4: 16px;/.test(css), "16px gutters between tiles (tokenized — design Phase 3)");
  check(/align-items:stretch/.test(portal), "equal-height rows (align-items:stretch)");
  check(/grid\.appendChild\(c\)/.test(portal), "tiles are placed into the grid (not stacked full-width)");
  check(/classList\.add\("intg-card"\)/.test(seg) && /\.intg-card \{ padding: 18px; margin: 0;/.test(css), "comfortable tile padding (18px) with no stacking margin — via .intg-card (design Phase 3)");
  check(!/grid-template-columns:\s*repeat\(\s*[2-9]\s*,/.test(portal), "no hardcoded fixed column count (wraps naturally)");

  // ---- (2) Twilio number input not narrowed ----
  console.log("\n(2) controls not cramped:");
  const twilioInput = /inp\.style\.cssText = "width:100%;"; \/\/ full tile inner width/.test(portal);
  check(/inp\.classList\.add\("intg-input"\)/.test(seg) && /\.intg-input \{ width: 100%; \}/.test(css), "Twilio number input spans full tile inner width — via .intg-input (design Phase 3)");
  check(!/inp\.style\.cssText = "width:100%;max-width:320px;"/.test(portal), "old max-width cap on the Twilio input removed");

  // ---- (3) heading/intro preserved ----
  console.log("\n(3) heading + intro preserved:");
  check(/class="settings-h">Integrations</.test(portal), "Integrations heading kept");
  check(/Connect and manage the services that power your receptionist\./.test(portal), "intro copy kept");

  // ---- (4) behavior unchanged (presentation only) ----
  console.log("\n(4) wiring unchanged:");
  check(/\/api\/integrations\/twilio", \{ method: "PATCH", body: JSON\.stringify\(\{ phoneNumber: inp\.value \}\)/.test(portal), "Twilio Save still PATCHes the same endpoint with the number");
  check(/\/api\/integrations\/openai", \{ method: "PATCH", body: JSON\.stringify\(\{ enabled: on \}\)/.test(portal), "OpenAI toggle still PATCHes the same endpoint");
  check(/mountGoogleCard\(body\)/.test(portal), "Google Calendar connect/status logic reused unchanged");

  console.log("\n======================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (integrations tiles)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
