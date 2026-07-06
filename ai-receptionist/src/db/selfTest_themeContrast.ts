// Bonus guard (pure, INFORMATIONAL — never fails the build): reports the WCAG
// contrast of each preset's representative body-text swatch against its background
// swatch, and lists any below AA (~4.5:1) to eyeball. IMPORTANT CAVEAT: themes.ts
// swatches are a 3-chip PREVIEW (swatch[0]=background, and swatch[2] is usually the
// body text — but for some fun themes swatch[2] is a DECORATIVE accent, not the ink,
// e.g. aero/cottage). So a low number here does NOT necessarily mean unreadable text;
// the authoritative legibility audit is --ink / --ink-faint in public/styles.css. This
// exits 0 always, so it only surfaces themes to review — it can't block the pipeline.
//
//   npx tsx src/db/selfTest_themeContrast.ts
import { PRESETS } from "../theme/themes";

function hexToRgb(h: string): [number, number, number] {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lin(c: number): number { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(hex: string): number { const [r, g, b] = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function contrast(a: string, b: string): number { const L1 = lum(a), L2 = lum(b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); }

const AA = 4.5;
const SWATCH_TEXT_IS_DECORATIVE = new Set(["aero", "cottage"]);

console.log("Preset body-text contrast guard (representative swatches — informational)");
console.log("=========================================================================");
const review: string[] = [];
for (const p of PRESETS) {
  const ratio = contrast(p.swatches[0], p.swatches[2]);
  const low = ratio < AA;
  const note = low ? (SWATCH_TEXT_IS_DECORATIVE.has(p.id) ? "  (swatch[2] decorative — real --ink verified in CSS)" : "  <-- REVIEW --ink in styles.css") : "";
  if (low && !SWATCH_TEXT_IS_DECORATIVE.has(p.id)) review.push(p.id);
  console.log(`  ${low ? "\u2022" : "\u2713"} ${p.id.padEnd(11)} ${ratio.toFixed(2)}:1${note}`);
}
if (review.length) console.log(`\nReview these in styles.css: ${review.join(", ")}`);
else console.log("\nNo unexpected low-contrast presets. (Authoritative audit is --ink/--ink-faint in styles.css.)");
console.log("PASSED \u2705 (contrast guard — informational)");
process.exit(0);
