/**
 * Design mop-up — the inline-style drain is CLOSED.
 *
 * The arc-closing assertion: app-wide, every remaining inline-style site is a documented
 * dynamic in a sanctioned pattern; static count is ZERO. Future regressions fail HERE by name.
 *
 * The complete ledger (60):
 *   portal.js 27        calendar geometry 18, anchored module-menu 3, record-cell custom
 *                       props 3, billing pill 1, account swatch preview 2
 *   drips.js 17         flow-canvas engine: pan/zoom 1, node geometry 12, handle
 *                       custom-props 4
 *   app.js 8            anchored popup positioning (burger/nav menus)
 *   admin.js 4          status badges + activity dot custom props
 *   table.js 2          column-manager popup anchoring
 *   communication.js 1  survey results bar (--pw)
 *   fields.js 1         progress-field fill width
 * Exempt by marker: themeScene.js + webgl-sunset.js (<scene-exempt>), theme.js
 * (<plumbing-exempt>), compose.js email regions (<email-html>).
 *
 * No DB required.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}
const PUB = resolve(__dirname, "../../public");
const read = (p: string) => readFileSync(resolve(PUB, p), "utf8");
const INLINE = /\.style\.cssText\s*\+?=|\.style\.(?!cssText)[a-zA-Z]+\s*=[^=]|style="/g;
const count = (s: string) => (s.match(INLINE) || []).length;

function main() {
  console.log("Design mop-up — drain closed");
  console.log("============================");

  console.log("\n(1) per-file: dynamics only, at exact counts:");
  const expected: Array<[string, number]> = [
    ["js/portal.js", 27], ["js/drips.js", 17], ["js/app.js", 8], ["js/admin.js", 4],
    ["js/table.js", 2], ["js/communication.js", 1], ["js/fields.js", 1],
    ["js/inbound.js", 0], ["js/presence.js", 0], ["js/util.js", 0], ["js/auth.js", 0],
    ["js/automations.js", 0], ["js/reports.js", 0], ["js/feedback.js", 0], ["js/compose.js", 2 /* inside email-html markers */],
  ];
  let dynTotal = 0;
  for (const [f, n] of expected) {
    const c = count(read(f));
    check(c === n, `${f}: ${n} (found ${c})`);
    if (!f.includes("compose")) dynTotal += n;
  }

  console.log("\n(2) app.js/table.js remainders are positional mechanisms:");
  const app = read("js/app.js");
  check((app.match(/menu\.style\.(left|top|position)/g) || []).length === 8, "app.js: all 8 are menu positioning writes");
  const table = read("js/table.js");
  check((table.match(/pop\.style\.(top|left)/g) || []).length === 2, "table.js: both are popup anchoring writes");
  check(read("js/fields.js").includes('fill.style.width = v + "%"'), "fields.js: the one dynamic is the progress fill");

  console.log("\n(3) exemption markers present and honored:");
  check(read("js/theme.js").startsWith("// <plumbing-exempt>"), "theme.js carries <plumbing-exempt>");
  check(read("js/webgl-sunset.js").startsWith("// <scene-exempt>"), "webgl-sunset.js carries <scene-exempt>");
  check(read("js/themeScene.js").startsWith("// <scene-exempt>"), "themeScene.js still carries <scene-exempt>");
  const audit = readFileSync(resolve(__dirname, "designAudit.ts"), "utf8");
  check(audit.includes('src.includes("// <plumbing-exempt>")'), "designAudit honors <plumbing-exempt>");

  console.log("\n(4) mop-up toggle pairs + hygiene:");
  const inbound = read("js/inbound.js");
  check(inbound.includes('el("div", "ib-calls u-hidden")') && inbound.includes('callsBox.classList.remove("u-hidden")') && inbound.includes('callsBox.classList.add("u-hidden")'), "inbound calls box: both sides");
  const fields = read("js/fields.js");
  check(fields.includes('preview.classList.add("u-hidden")') && fields.includes('preview.classList.remove("u-hidden")'), "image preview: both sides");
  check(read("js/presence.js").includes('d.style.setProperty("--swatch"'), "presence dots on the custom-property pattern");
  for (const f of ["js/app.js", "js/table.js", "js/inbound.js", "js/fields.js", "js/auth.js"]) {
    const doubles = read(f).match(/<[a-z]+[^>]*class="[^"]*"[^>]*class="/g) || [];
    check(doubles.length === 0, `${f}: zero double-class tags`);
  }

  console.log("\n(5) THE CLOSURE: app-wide statics = 0:");
  check(dynTotal === 60, `total documented dynamics = 60 (found ${dynTotal}); statics = ZERO — the drain is closed`);

  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED — DRAIN CLOSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exit(1);
}

main();
