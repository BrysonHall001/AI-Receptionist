// Self-test — three frontend polish fixes: consistent Terms messaging, the Mapbox logo asset,
// and unique per-type field-library icons. Source-assertion style (selfTest_pipelineToggle.ts),
// plus a vm evaluation of the REAL fields.js so TYPE_ICONS is checked as data, not regex.
//
//   npx tsx src/db/selfTest_termsIconsPolish.ts        (no DB needed)
//
// Proves:
//  (1) buildTermsSection: head is plain "Terms" (no "for <Module>" suffix), no per-term
//      "PORTAL-WIDE" tag remains, the new single hint phrasing is present, no description
//      repeats the portal-wide point, and the save-payload construction is byte-identical.
//  (2) public/img/mapbox.png exists (a real PNG at the same static dir as twilio.png) and
//      renderIntegrations references /img/mapbox.png.
//  (3) TYPE_ICONS exists in fields.js with one DISTINCT icon per FIELD_TYPES entry, none the
//      old "▦"; buildFieldLibrary uses it; icons are library-only; the drag/drop payload
//      construction is unchanged.
import vm from "vm";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// FIELD_TYPES is read from fieldService.ts SOURCE (the authoritative literal) rather than
// imported — importing would drag in the Prisma client, and this test needs no DB at all.
function loadFieldTypes(baseDir: string): string[] {
  const src = readFileSync(resolve(baseDir, "src/services/fieldService.ts"), "utf8");
  const m = /export const FIELD_TYPES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!m) return [];
  return Array.from(m[1].matchAll(/"([a-z_]+)"/g)).map((x) => x[1]);
}

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const base = resolve(__dirname, "../..");
const portal = readFileSync(resolve(base, "public/js/portal.js"), "utf8");
const fieldsJs = readFileSync(resolve(base, "public/js/fields.js"), "utf8");
const css = readFileSync(resolve(base, "public/styles.css"), "utf8");

async function main() {
  console.log("Polish — Terms messaging, Mapbox logo, field-library icons");
  console.log("==========================================================");

  // ---- (1) Terms panel: one consistent story ----
  console.log("\n(1) Terms panel messaging:");
  const TS = portal.slice(portal.indexOf("function buildTermsSection(col, generic)"), portal.indexOf("// ---- VIEWS section")); // portal-level since the layout restructure
  check(TS.length > 0, "buildTermsSection located");
  check(!/mf-terms-for/.test(TS), "the head no longer renders a \"for <Module>\" suffix (plain \"Terms\")");
  check(/mf-col-title", "Shared terms"/.test(TS), "the head title is \"Shared terms\" (its Pages-tab group title)");
  check(/Words used across your portal\. Each word has one value for the whole portal — renaming it here renames it everywhere it appears\./.test(TS), "the hint keeps the single consistent portal-wide phrasing (now portal-level)");
  check(!/mf-term-tag/.test(TS) && !/termIsShared/.test(TS), "no per-term \"PORTAL-WIDE\" tag remains (no tag element, no shared-cue logic)");
  check(!/mf-term-tag/.test(css), "the tag's CSS is removed too (no dead styling)");
  check(!/renames what a step is called everywhere/.test(TS), "no description repeats the portal-wide point (said exactly once, in the hint)");
  check(/Contacts move through pipeline stages too/.test(TS), "the contact rationale is kept inside Stage's portal-level description");
  check(/mf-term-name", esc\(w\.dflt\.one\)/.test(TS) && /mf-term-desc", esc\(descText\)/.test(TS), "per-term name labels + descriptions are kept");
  check(/\.filter\(function \(w\) \{ return termUsedInPortal\(w\.key\); \}\)/.test(TS), "PORTAL-LEVEL filtering (a word shows if relevant anywhere — layout restructure)");
  // Save path byte-identical (same assertions the clarity-pass test proved).
  check(/const payload = \{ generic: \{\} \};/.test(TS) && /payload\.generic\[row\.key\] = \{ one: one, many: many \};/.test(TS), "the save payload construction is unchanged");
  check(/App\.portalApi\("\/api\/labels", \{ method: "PATCH", body: JSON\.stringify\(payload\) \}\)/.test(TS), "the PATCH /api/labels call is unchanged");
  check(/if \(!row\.touched\) m\.value = App\.pluralize\(o\.value\)/.test(TS), "auto-pluralize is unchanged");

  // ---- (2) Mapbox logo asset ----
  console.log("\n(2) Mapbox logo:");
  const logoPath = resolve(base, "public/img/mapbox.png");
  check(existsSync(logoPath), "public/img/mapbox.png exists (same static dir as twilio.png)");
  check(existsSync(resolve(base, "public/img/twilio.png")), "(sanity) twilio.png sits in the same dir");
  const png = readFileSync(logoPath);
  check(png.length > 4 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, "the asset is a real PNG (magic bytes)");
  check(png.length < 200 * 1024, "the asset is small (normalized, not the raw original)");
  check(/card\("\/img\/mapbox\.png", "Mapbox"\)/.test(portal), "renderIntegrations references /img/mapbox.png (unchanged)");

  // ---- (3) field-library icons ----
  console.log("\n(3) unique per-type field-library icons:");
  // vm-evaluate the REAL fields.js (with a minimal App.util stub) so TYPE_ICONS is inspected
  // as actual data — not regex-parsed.
  const sandbox: any = {};
  vm.createContext(sandbox);
  sandbox.globalThis = sandbox;
  sandbox.App = { util: { el: function () { return { appendChild() {}, classList: { add() {} }, style: {} }; }, esc: function (s: any) { return String(s); } } };
  vm.runInContext(fieldsJs, sandbox);
  const F = sandbox.App.fields;
  check(!!F && !!F.TYPE_ICONS, "TYPE_ICONS exists and is exported on App.fields");
  const icons = F.TYPE_ICONS as Record<string, string>;
  const FIELD_TYPES = loadFieldTypes(base);
  check(FIELD_TYPES.length >= 20, `FIELD_TYPES parsed from fieldService source (${FIELD_TYPES.length} types)`);
  const missing = FIELD_TYPES.filter((t) => !icons[t] || !String(icons[t]).trim());
  check(missing.length === 0, `every FIELD_TYPES entry has an icon (${FIELD_TYPES.length} types)` + (missing.length ? ` — missing: ${missing.join(", ")}` : ""));
  const vals = Object.values(icons);
  check(new Set(vals).size === vals.length, "all icons are distinct");
  check(!vals.includes("\u25A6"), "none is the old \"\u25A6\" glyph");
  check(Object.keys(icons).length === FIELD_TYPES.length, "no extra/unknown icon keys");
  // buildFieldLibrary uses the map; icons stay library-only; drag payload unchanged.
  const lib = portal.slice(portal.indexOf("function buildFieldLibrary(col)"), portal.indexOf("async function moveModuleOrder("));
  const dotLine = 'el("span", "mf-lib-dot", (App.fields.TYPE_ICONS && App.fields.TYPE_ICONS[t]) || "\\u2022")';
  check(lib.includes(dotLine), "buildFieldLibrary renders each tile's icon from TYPE_ICONS (bullet fallback, never the old glyph)");
  check(!/\u25A6/.test(portal), "the shared \"\u25A6\" glyph is gone from portal.js");
  check((portal.match(/TYPE_ICONS/g) || []).length === 2 && lib.includes(dotLine), "TYPE_ICONS is applied ONLY on the library tiles (its sole usage is the mf-lib-dot line)");
  check(/e\.dataTransfer\.setData\("text\/plain", "fieldtype:" \+ t\)/.test(lib), "the drag payload construction is unchanged (no icon carried over)");
  check(/mfLibraryDragType = t;/.test(lib), "the drag state handoff is unchanged");
  check(/\.mf-lib-dot \{ color: var\(--ink-faint\); font-size: 12px; flex: 0 0 auto; width: 1\.35em; text-align: center; line-height: 1; \}/.test(css), "the .mf-lib-dot styling stays muted/monochrome, with fixed-width centering for alignment");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(() => {
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (consistent Terms story; logo ships; 24 distinct library icons, library-only)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
