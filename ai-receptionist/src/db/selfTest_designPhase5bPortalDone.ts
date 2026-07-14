/**
 * Design Phase 5b — portal.js migration COMPLETE.
 *
 * Proves:
 *  (1) portal.js contains ZERO static inline styles. Exactly 27 dynamic sites remain, all in
 *      sanctioned patterns, itemized: calendar positioning engine 18, openModuleMenu anchored
 *      popup 3, recordColumnDefs custom-prop cells 3, billingStatePill --pill-bg 1, and the
 *      secAccount color-swatch preview pair 2. (Ledger note: Phase 5a reported "25 + 171
 *      deferred" — the two secAccount lines were double-bucketed there; true split was
 *      169 statics + 27 documented dynamics.)
 *  (2) Chrome theme hooks intact (--sidebar-bg / --topbar-bg reads).
 *  (3) No double-class attributes in built HTML strings.
 *  (4) Every visibility toggle migrated this batch has BOTH sides of the u-hidden protocol
 *      (hide + show/toggle call sites), or is deliberately one-way (asserted as such).
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

function main() {
  console.log("Design Phase 5b — portal.js done");
  console.log("================================");

  const s = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
  const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");
  const themeJs = readFileSync(resolve(__dirname, "../../public/js/theme.js"), "utf8");
  const INLINE = /\.style\.cssText\s*\+?=|\.style\.(?!cssText)[a-zA-Z]+\s*=[^=]|style="/g;
  const CAL = new Set(["gridTemplateColumns", "height", "top", "left", "width", "backgroundImage", "display"]);

  console.log("\n(1) zero statics; 27 itemized dynamics:");
  let cal = 0, menu = 0, cols = 0, pill = 0, paint = 0, other = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(s))) {
    const ls = s.lastIndexOf("\n", m.index) + 1;
    const ln = s.slice(ls, s.indexOf("\n", m.index));
    const pm = /\.style\.([a-zA-Z]+)\s*=/.exec(ln);
    if (ln.includes("menu.style.")) menu++;
    else if (ln.includes("--pill-bg")) pill++;
    else if (ln.includes("--swatch") || ln.includes('f.type === "color"') || ln.includes('f.type === "progress"')) cols++;
    else if (ln.includes("preview.style.background = hex")) paint++;
    else if (pm && CAL.has(pm[1])) cal++;
    else other++;
  }
  check(other === 0, `no unsanctioned inline sites (found ${other})`);
  check(cal === 18, `calendar engine exactly 18 (found ${cal})`);
  check(menu === 3 && cols === 3 && pill === 1 && paint === 2, `menu 3 / coldefs 3 / pill 1 / secAccount 2 (found ${menu}/${cols}/${pill}/${paint})`);
  check(cal + menu + cols + pill + paint === 27, "total dynamics = 27");

  console.log("\n(2) chrome theme hooks:");
  check(css.includes("--sidebar-bg") && css.includes("--topbar-bg") && themeJs.includes("--sidebar-bg"), "chrome theme hooks intact: styles.css consumes --sidebar-bg/--topbar-bg and theme.js drives them (portal.js correctly does not hardcode them)");

  console.log("\n(3) no double-class attributes:");
  const doubles = s.match(/<[a-z]+[^>]*class="[^"]*"[^>]*class="/g) || [];
  check(doubles.length === 0, `zero double-class tags in HTML strings (found ${doubles.length})`);

  console.log("\n(4) toggle pairs (u-hidden protocol):");
  const pairs: Array<[string, string, string]> = [
    ["newBtn", 'el("button", "btn btn-ghost btn-sm u-hidden", "New report")', 'newBtn.classList.toggle("u-hidden", !editing)'],
    ["cadPanel", "cadPanel", 'cadPanel.classList.toggle("u-hidden", mode !== "schedule")'],
    ["edWrap", "edWrap", 'edWrap.classList.toggle("u-hidden", useCb.checked)'],
    ["applied", 'applied.classList.add("u-hidden")', 'applied.classList.remove("u-hidden")'],
  ];
  for (const [name, hideSig, showSig] of pairs) {
    check(s.includes(hideSig) && s.includes(showSig), `${name}: both sides of the toggle present`);
  }
  check(s.includes('voiceNote.classList.add("u-hidden")') && !s.includes('voiceNote.classList.remove'), "voiceNote: deliberate one-way hide (SMOOTH mode)");
  check(s.includes('fi.classList.add("u-hidden")'), "hidden file input stays hidden by design");
  check(css.includes(".pt-ai-tab.active"), "AI-instructions tab active state is a class variant");
  check(css.includes(".pt-role-item.active"), "permissions role item active state is a class variant");

  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exit(1);
}

main();
