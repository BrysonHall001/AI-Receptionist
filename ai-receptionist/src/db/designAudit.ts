// Design audit (design-system Phase 1) — measures every violation of the canon so the ratchet
// (selfTest_designRatchet.ts) can hold the line while migration proceeds batch by batch.
//
//   npx tsx src/db/designAudit.ts                  human summary to stdout
//   npx tsx src/db/designAudit.ts --write-baseline also writes src/db/designBaseline.json
//
// Scans public/styles.css, every non-vendor public/js/*.js, and public/*.html.
//
// Counters (ratcheted):
//   rawHex           hex color literals outside the legitimate homes. In styles.css the :root
//                    token block and every THEMES preset rule (selector containing
//                    body[data-theme=) are exempt — those two are where raw values BELONG. In
//                    JS/HTML, a hex counts when it appears in a style context (see heuristic).
//   offScaleFontSize font-size declarations whose px value isn't on the canon type scale
//                    (12, 13, 14, 16, 18, 22, 28). Same exempt blocks in styles.css.
//   inlineStyle      style.cssText assignments, .style.<prop> = assignments, and style="
//                    attributes inside JS-built HTML strings (and static HTML files).
// Layout-hardening counters (ratcheted; CSS-only, styles.css; deterministic best-effort
// static heuristics — determinism matters more than perfection, like the rawHex line rule):
//   flexControlNoShrink  base control rules (.input / .search-input / .pop-input) missing the
//                        defensive min-width: 0 (anti-pattern a: flex children that refuse to shrink).
//   actionsRowNoWrap     flex rules whose selector names an actions/foot/toolbar row but whose
//                        body lacks flex-wrap (anti-pattern b: button rows that overflow).
//   fixedWidthNoEscape   rules with a fixed width >= 100px and NO max-width and NO flex basis —
//                        a fixed child with no escape hatch inside flexible parents (anti-pattern c).
//   nowrapNoEllipsis     white-space: nowrap with neither overflow nor text-overflow — long text
//                        with no truncation strategy (anti-pattern d).
//   frTrackNoFloor       grid-template-columns using bare fr tracks without a minmax() floor
//                        (anti-pattern e; the benign single full-width "1fr" track is excluded).
// THEMES preset rules and #theme-scene/.sc- scenic rules are exempt, same as the color counters.
// Informational (NOT ratcheted yet):
//   distinctSpacingValues  distinct px values across padding/margin/gap in styles.css.
//
// Exemptions: public/js/vendor/** entirely; public/js/theme.js for rawHex (its whole job is
// color plumbing — isHex validation, luminance math, setProperty on tokens; setProperty is the
// sanctioned mechanism and never counts as inlineStyle for any file).
//
// JS/HTML rawHex heuristic, for determinism: a hex literal counts when its LINE also contains
// the substring "style" (cssText, .style.x, style=" — the contexts we care about). This can
// miss a hex split across lines from its style sink and could over-count a hex in a non-style
// string mentioning "style"; both are rare, and a stable, simple rule matters more for a
// ratchet than perfection. The CSS scan has no such heuristic — it is exact.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { resolve, join, basename } from "path";

export const TYPE_SCALE_PX = [12, 13, 14, 16, 18, 22, 28];

export interface FileCounts { rawHex: number; offScaleFontSize: number; inlineStyle: number; }
export interface LayoutCounts {
  flexControlNoShrink: number;
  actionsRowNoWrap: number;
  fixedWidthNoEscape: number;
  nowrapNoEllipsis: number;
  frTrackNoFloor: number;
  inkSurfaceMismatch: number;
}
export const LAYOUT_COUNTERS: (keyof LayoutCounts)[] = ["flexControlNoShrink", "actionsRowNoWrap", "fixedWidthNoEscape", "nowrapNoEllipsis", "frTrackNoFloor", "inkSurfaceMismatch"];
// CONTRAST RULE SYSTEM enforcement (best-effort static heuristic, documented):
// the known ON-BG-scoped selectors must never take a panel-class ink. A rule whose
// selector names one of BG_SCOPED and whose body sets color to --ink/--ink-soft/
// --ink-faint (rather than --ink-on-bg / --ink-on-bg-soft) is a counted violation.
const BG_SCOPED = ["content-page-title", "settings-h", "theme-group-label", "settings-intro", "thc-name", "thc-group-row", "learn-title", "learn-cat", "learn-link"];
export interface AuditResult {
  files: Record<string, FileCounts>;
  totals: FileCounts;
  layout: LayoutCounts;
  info: { distinctSpacingValues: number };
}

// ---- Layout anti-pattern scan (styles.css). Exported standalone so tests can run it on
// synthetic CSS (e.g. the negative check: inject an offender, confirm the count rises). ----
export function auditLayoutPatterns(css: string): LayoutCounts {
  const out: LayoutCounts = { flexControlNoShrink: 0, actionsRowNoWrap: 0, fixedWidthNoEscape: 0, nowrapNoEllipsis: 0, frTrackNoFloor: 0, inkSurfaceMismatch: 0 };
  // Strip comments first so a comment above a rule never merges into its "selector".
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const seenControls = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim(); const body = m[2];
    if (sel.includes("data-theme") || sel.includes("#theme-scene") || sel.includes(".sc-") || /^(from|to|\d)/.test(sel)) continue;
    // (a) the base control rules must carry min-width: 0
    for (const ctrl of [".input", ".search-input", ".pop-input"]) {
      if (sel === ctrl && !seenControls.has(ctrl)) {
        seenControls.add(ctrl);
        if (!body.includes("min-width: 0")) out.flexControlNoShrink++;
      }
    }
    const isFlex = /display:\s*(inline-)?flex/.test(body);
    // (b) named action/footer/toolbar rows that are flex but never wrap. A descendant
    // BUTTON/element inside such a row (e.g. ".x-toolbar button.y") is not itself a row —
    // only selectors whose LAST compound names the actions/foot/toolbar class count.
    const last = sel.split(",")[0].trim().split(/\s+/).pop() || "";
    if (isFlex && /(actions|foot\b|-foot|toolbar)/.test(last) && !body.includes("flex-wrap")) out.actionsRowNoWrap++;
    // (c) fixed width >= 100px with no escape hatch (no max-width, no flex basis)
    if (/(?:^|;)\s*width:\s*\d{3,}px/.test(body) && !body.includes("max-width") && !/flex\s*:/.test(body)) out.fixedWidthNoEscape++;
    // (d) nowrap text with no truncation strategy
    if (body.includes("white-space: nowrap") && !body.includes("overflow") && !body.includes("text-overflow")) out.nowrapNoEllipsis++;
    // (f) contrast system: panel-class inks on ON-BG-scoped selectors. Exclusion: a rule
    // that paints its OWN panel-family background (hover/active pills like .learn-link:hover
    // { background: var(--gray-soft); color: var(--ink); }) is legitimately ON-PANEL/ON-SOFT
    // for that state — documented heuristic refinement.
    if (BG_SCOPED.some((frag) => sel.includes(frag)) && /color:\s*var\(--ink(-soft|-faint)?\)/.test(body) && !/background:\s*var\(--(gray-soft|panel|panel-2|accent-soft|row-hover)\)/.test(body)) out.inkSurfaceMismatch++;
    // (e) bare fr grid tracks without a minmax() floor (single full-width "1fr" excluded)
    for (const g of body.matchAll(/grid-template-columns:\s*([^;]+)/g)) {
      const v = g[1].trim();
      if (v === "1fr") continue;
      if (/\bfr\b|\dfr/.test(v) && !v.includes("minmax(")) out.frTrackNoFloor++;
    }
  }
  return out;
}

const pub = resolve(__dirname, "../../public");

// ---- CSS exempt ranges: the :root block + every rule whose selector mentions data-theme ----
function cssExemptRanges(css: string): [number, number][] {
  const ranges: [number, number][] = [];
  const rootStart = css.indexOf(":root {");
  if (rootStart >= 0) ranges.push([rootStart, css.indexOf("}", rootStart) + 1]);
  const re = /(^|\n)[^{}\n]*data-theme[^{}\n]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const open = css.indexOf("{", m.index);
    const close = css.indexOf("}", open); // theme preset rules are flat (no nesting)
    if (open >= 0 && close > open) ranges.push([m.index, close + 1]);
  }
  return ranges;
}
const inRanges = (i: number, ranges: [number, number][]) => ranges.some(([a, b]) => i >= a && i < b);

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const FS_CSS_RE = /font-size:\s*(\d+(?:\.\d+)?)px/g;
const FS_JS_RE = /(?:font-size:\s*|fontSize\s*=\s*["'])(\d+(?:\.\d+)?)px/g;

function countCss(css: string): FileCounts & { spacing: Set<string> } {
  const ranges = cssExemptRanges(css);
  let rawHex = 0;
  let m: RegExpExecArray | null;
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(css))) if (!inRanges(m.index, ranges)) rawHex++;
  let offScaleFontSize = 0;
  FS_CSS_RE.lastIndex = 0;
  while ((m = FS_CSS_RE.exec(css))) {
    if (inRanges(m.index, ranges)) continue;
    if (!TYPE_SCALE_PX.includes(parseFloat(m[1]))) offScaleFontSize++;
  }
  const spacing = new Set<string>();
  const SP_RE = /(?:^|;|\{)\s*(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?:\s*([^;}]+)/g;
  SP_RE.lastIndex = 0;
  while ((m = SP_RE.exec(css))) {
    const px = m[1].match(/(\d+(?:\.\d+)?)px/g) || [];
    px.forEach((v) => spacing.add(v));
  }
  return { rawHex, offScaleFontSize, inlineStyle: 0, spacing };
}

// Email-HTML exemption (Phase 6): email clients don't support stylesheets, so any code
// that BUILDS outbound email markup must keep its inline styles. Such regions are wrapped
// in marker comments and skipped for every counter:
//   // <email-html>
//   ...builders of sent/previewed email markup...
//   // </email-html>
// The markers are deliberate documentation — an unmarked inline style is still a violation.
function stripEmailHtmlRegions(src: string): string {
  return src.replace(/\/\/ <email-html>[\s\S]*?\/\/ <\/email-html>/g, "/* email-html exempt */");
}

function countJsOrHtml(src: string, isThemeJs: boolean): FileCounts {
  src = stripEmailHtmlRegions(src);
  // Scene exemption (Phase 7): themeScene.js is scenic rendering — its inline styles are
  // the feature. Exempt ONLY when the file carries the explicit <scene-exempt> marker,
  // so the exemption is visible in the file itself rather than silently configured here.
  if (src.includes("// <scene-exempt>")) return { rawHex: 0, offScaleFontSize: 0, inlineStyle: 0 };
  // Plumbing exemption (mop-up): theme.js's style writes ARE the theming mechanism.
  if (src.includes("// <plumbing-exempt>")) return { rawHex: 0, offScaleFontSize: 0, inlineStyle: 0 };
  let rawHex = 0;
  if (!isThemeJs) {
    for (const line of src.split("\n")) {
      if (!/style/.test(line)) continue;
      const hits = line.match(HEX_RE) || [];
      rawHex += hits.length;
    }
  }
  let offScaleFontSize = 0;
  let m: RegExpExecArray | null;
  FS_JS_RE.lastIndex = 0;
  while ((m = FS_JS_RE.exec(src))) if (!TYPE_SCALE_PX.includes(parseFloat(m[1]))) offScaleFontSize++;
  const inlineStyle =
    (src.match(/\.style\.cssText\s*\+?=/g) || []).length +
    (src.match(/\.style\.(?!cssText)[a-zA-Z]+\s*=[^=]/g) || []).length +
    (src.match(/style="/g) || []).length;
  return { rawHex, offScaleFontSize, inlineStyle };
}

export function runAudit(): AuditResult {
  const files: Record<string, FileCounts> = {};
  const totals: FileCounts = { rawHex: 0, offScaleFontSize: 0, inlineStyle: 0 };
  const add = (name: string, c: FileCounts) => {
    files[name] = { rawHex: c.rawHex, offScaleFontSize: c.offScaleFontSize, inlineStyle: c.inlineStyle };
    totals.rawHex += c.rawHex; totals.offScaleFontSize += c.offScaleFontSize; totals.inlineStyle += c.inlineStyle;
  };

  const css = readFileSync(join(pub, "styles.css"), "utf8");
  const cssCounts = countCss(css);
  add("styles.css", cssCounts);

  const jsDir = join(pub, "js");
  for (const name of readdirSync(jsDir).sort()) {
    if (!name.endsWith(".js")) continue; // vendor/ is a directory — skipped by this check
    add("js/" + name, countJsOrHtml(readFileSync(join(jsDir, name), "utf8"), name === "theme.js"));
  }
  for (const name of readdirSync(pub).sort()) {
    if (!name.endsWith(".html")) continue;
    add(name, countJsOrHtml(readFileSync(join(pub, name), "utf8"), false));
  }

  return { files, totals, layout: auditLayoutPatterns(css), info: { distinctSpacingValues: cssCounts.spacing.size } };
}

export const BASELINE_PATH = resolve(__dirname, "designBaseline.json");

export function readBaseline(): AuditResult | null {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function sortedBaseline(r: AuditResult): string {
  const files: Record<string, FileCounts> = {};
  Object.keys(r.files).sort().forEach((k) => (files[k] = r.files[k]));
  return JSON.stringify({ files, totals: r.totals, layout: r.layout, info: r.info }, null, 2) + "\n";
}

if (require.main === module) {
  const r = runAudit();
  console.log("Design audit — canon violations per file (vendor exempt)");
  console.log("========================================================");
  const names = Object.keys(r.files).sort();
  for (const n of names) {
    const c = r.files[n];
    if (c.rawHex + c.offScaleFontSize + c.inlineStyle === 0) continue;
    console.log(`  ${n.padEnd(24)} rawHex=${String(c.rawHex).padStart(4)}  offScaleFontSize=${String(c.offScaleFontSize).padStart(3)}  inlineStyle=${String(c.inlineStyle).padStart(4)}`);
  }
  console.log("  " + "-".repeat(70));
  console.log(`  ${"TOTAL".padEnd(24)} rawHex=${String(r.totals.rawHex).padStart(4)}  offScaleFontSize=${String(r.totals.offScaleFontSize).padStart(3)}  inlineStyle=${String(r.totals.inlineStyle).padStart(4)}`);
  console.log(`  layout anti-patterns (ratcheted): ` + LAYOUT_COUNTERS.map((k) => `${k}=${r.layout[k]}`).join("  "));
  console.log(`  (informational, not ratcheted) distinctSpacingValues in styles.css: ${r.info.distinctSpacingValues}`);
  if (process.argv.includes("--write-baseline")) {
    writeFileSync(BASELINE_PATH, sortedBaseline(r));
    console.log(`\nBaseline written: ${BASELINE_PATH}`);
  }
}
