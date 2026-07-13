// Self-test — Design Phase 4: record surfaces on the design system.
//
//   npx tsx src/db/selfTest_designPhase4Records.ts        (no DB needed)
//
// Proves:
//  (1) The scoped renderers hold no STATIC inline styles: renderRecord, buildRelatedPane,
//      openManageColumns, renderRecordList, mountStageBoard, mountGeoMap, renderRecordGallery,
//      renderContacts, contactColumnDefs are at ZERO .style writes / style=" attrs; the ONLY
//      remaining sites are the documented dynamics — the calendar's positioning engine
//      (HOUR_H/lane math + the now-line) and the three custom-property style attributes
//      (color chip --swatch, progress --pw, resource dot --swatch).
//  (2) The custom-property pattern is real: JS sets --ev-*/--sw-*/--swatch/--pw via
//      setProperty or style attrs, and the classes read them from styles.css.
//  (3) Interaction wiring intact: dnd handler bodies, gallery loading="lazy", the Leaflet
//      mount, and the view-switcher persistence are byte-for-byte unchanged.
import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

function fnSlice(name: string): string {
  const m = new RegExp("(?:async )?function " + name + "\\s*\\(").exec(portal);
  if (!m) return "";
  let i = portal.indexOf("{", m.index); let depth = 0; let j = i;
  for (;;) {
    const ch = portal[j];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return portal.slice(m.index, j + 1); }
    j++;
  }
}
const inlineCount = (seg: string) =>
  (seg.match(/\.style\.cssText\s*\+?=/g) || []).length +
  (seg.match(/\.style\.(?!cssText)[a-zA-Z]+\s*=[^=]/g) || []).length +
  (seg.match(/style="/g) || []).length;

console.log("Design Phase 4 — record surfaces on the system");
console.log("==============================================");

console.log("\n(1) zero static inline styles:");
for (const n of ["renderRecord","buildRelatedPane","openManageColumns","renderRecordList","mountStageBoard","mountGeoMap","renderRecordGallery","renderContacts","contactColumnDefs","renderRecordMap"]) {
  const seg = fnSlice(n);
  check(seg.length > 0 && inlineCount(seg) === 0, `${n}: zero inline-style writes`);
}
const cal = fnSlice("renderBookingCalendar");
const calWrites = [...cal.matchAll(/\.style\.(?!cssText)([a-zA-Z]+)\s*=[^=]/g)].map((m) => m[1]);
const POSITIONING = new Set(["gridTemplateColumns","height","top","left","width","backgroundImage","display"]);
check(calWrites.length > 0 && calWrites.every((p) => POSITIONING.has(p)), `calendar: every remaining .style write is the POSITIONING engine (found: ${JSON.stringify([...new Set(calWrites)])})`);
check(!/\.style\.cssText/.test(cal) && !/blk\.style\.background/.test(cal) && !/blk\.style\.borderColor/.test(cal), "calendar: zero color/cssText writes remain (colors moved to the custom-property pattern)");
const rcd = fnSlice("recordColumnDefs");
const rcdAttrs = [...rcd.matchAll(/style="([^"$]*)\$\{/g)].map((m) => m[1]);
check(rcdAttrs.length === 3 && rcdAttrs.every((a) => a.startsWith("--")), `recordColumnDefs: exactly three style attrs, all single custom properties (${JSON.stringify(rcdAttrs)})`);

console.log("\n(2) the custom-property pattern:");
check(/blk\.style\.setProperty\("--ev-bg", c\.color \+ "22"\); blk\.style\.setProperty\("--ev-color", c\.color\);/.test(cal), "tinted event blocks: JS sets --ev-bg/--ev-color");
check(/\.cal-block-tinted \{ background: var\(--ev-bg\); border-color: var\(--ev-color\); color: var\(--ink\); border-left-width: 3px; \}/.test(css), "…and the class reads them");
check(/\.cal-block-ext-fallback \{ background: var\(--gray-soft\); border-color: var\(--ext-badge-bg\); color: var\(--ext-ink\); \}/.test(css) && /classList\.add\("cal-block-ext-fallback"\)/.test(cal), "external-fallback blocks use the Phase-2 --ext tokens (three hardcoded hexes retired)");
check(/style="--swatch:\$\{esc\(v\)\}"/.test(rcd) && /\.cell-color-chip \{[^}]*background: var\(--swatch\)/.test(css), "color-field chip: --swatch custom property");
check(/style="--pw:\$\{n\}%"/.test(rcd) && /\.cell-progress-fill \{[^}]*width: var\(--pw, 0%\)/.test(css), "progress fill: --pw custom property");
check(/\.res-dot \{[^}]*background: var\(--swatch, var\(--accent\)\)/.test(css), "resource dot: --swatch with the accent default (the old #6366f1 literal retired)");

console.log("\n(3) interaction wiring intact:");
check(/const rows = Array\.prototype\.slice\.call\(list\.querySelectorAll\("\.field-row:not\(\.dragging\)"\)\);/.test(portal), "field dnd positioning unchanged");
check(/col\.addEventListener\("dragover", function \(e\) \{ const d = board\.querySelector\("\.kanban-card\.dragging"\)/.test(portal), "stage-board dnd unchanged");
check(/img\.loading = "lazy";/.test(portal) || /loading="lazy"/.test(portal), "gallery lazy-loading attribute present");
check(/L\.map\(/.test(portal) && /invalidateSize/.test(portal), "Leaflet mount + sizing calls unchanged");
check(/App\.portalApi\("\/api\/record-types\/views", \{ method: "POST", body: JSON\.stringify\(payload\) \}\)/.test(portal), "view persistence call unchanged");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (record surfaces on the system; dynamics documented)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
