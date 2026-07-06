// REQUIRED legibility proof for the dusk + aero scene overhaul.
// Parses the ACTUAL public/styles.css, pulls each theme's --panel, --ink and
// --ink-faint (muted / .cell-muted) colors, and asserts:
//   (a) body text (--ink) on the panel      >= 4.5:1  (WCAG AA normal text)
//   (b) muted text (--ink-faint) on the panel >= 4.5:1
//   (large headings need only >= 3:1, trivially met here).
// FAILS LOUDLY (exit 1) if any pairing is below threshold, so a scenery change
// that ever compromises on-panel text contrast can't ship. Panels are SOLID/opaque
// for both themes, so the panel color is the real surface behind readable text.
//
//   npx tsx src/db/selfTest_themeSceneLegibility.ts
import { readFileSync } from "fs";
import { resolve } from "path";

function hexToRgb(h: string): [number, number, number] {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lin(c: number): number { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(hex: string): number { const [r, g, b] = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function contrast(a: string, b: string): number { const L1 = lum(a), L2 = lum(b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); }

const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");
function block(theme: string): string {
  const start = css.indexOf(`body[data-theme="${theme}"] {`);
  if (start < 0) throw new Error(`theme block not found: ${theme}`);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}
function readVar(blk: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(blk);
  if (!m) throw new Error(`--${name} not found or not a solid hex (must be opaque for legibility)`);
  return m[1];
}

const AA = 4.5;
let fails = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) fails++; }

console.log("Scene themes legibility (parsed from styles.css)\n================================================");
for (const theme of ["dusk", "aero"]) {
  const blk = block(theme);
  const panel = readVar(blk, "panel");
  const ink = readVar(blk, "ink");
  const faint = readVar(blk, "ink-faint");
  const rInk = contrast(panel, ink);
  const rFaint = contrast(panel, faint);
  check(rInk >= AA, `${theme}: body text ${ink} on panel ${panel} = ${rInk.toFixed(2)}:1 (>= ${AA})`);
  check(rFaint >= AA, `${theme}: muted text ${faint} on panel ${panel} = ${rFaint.toFixed(2)}:1 (>= ${AA})`);
}

if (fails) { console.log(`\n${fails} FAILED \u274c — on-panel text below WCAG AA (legibility regression)`); process.exit(1); }
console.log("\nALL PASSED \u2705 (scene themes legibility)");
process.exit(0);
