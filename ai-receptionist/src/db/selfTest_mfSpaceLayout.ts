// Self-test — M&F space-saving layout pass: height-matched columns, Structure & behavior as a
// full-width horizontal panel, two-column field sections. Source-assertion style
// (selfTest_pipelineToggle); no DB needed:
//
//   npx tsx src/db/selfTest_mfSpaceLayout.ts
//
// Proves:
//  (1) Structure & behavior mounts into the full-width panel BENEATH the grid (DOM order in
//      secFields: tabs -> strip -> grid -> structure panel), not inside the Fields column; the
//      pipeline-toggle -> Views-strip re-render wiring is intact.
//  (2) The two-column section rule exists with the >=3-section threshold (Ungrouped counts).
//  (3) The Fields scroller's old fixed viewport cap (CSS calc + the JS sizer) is GONE, replaced
//      by layout-derived height parity: the grid stretches, the wrap fills the column.
//  (4) The dnd handlers (row drag, per-list dragover positioning, drop -> section PATCH +
//      reorder PATCH) are byte-for-byte unchanged.
import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const base = resolve(__dirname, "../..");
const portal = readFileSync(resolve(base, "public/js/portal.js"), "utf8");
const css = readFileSync(resolve(base, "public/styles.css"), "utf8");

console.log("M&F space pass — height parity; structure panel; two-column sections");
console.log("=====================================================================");

// ---- (1) Structure & behavior beneath the grid ----
console.log("\n(1) Structure & behavior placement + wiring:");
const sf = portal.slice(portal.indexOf("async function secFields(panel)"), portal.indexOf("function fillUsers("));
const iTabs = sf.indexOf("panel.appendChild(modulesRow);");
const iStrip = sf.indexOf("panel.appendChild(viewsStrip);");
const iGrid = sf.indexOf("panel.appendChild(grid);");
const iStruct = sf.indexOf("panel.appendChild(structurePanel);");
check(iTabs >= 0 && iStrip > iTabs && iGrid > iStrip && iStruct > iGrid, "DOM order: module tabs -> Views strip -> grid -> Structure panel (full width, beneath both columns)");
check(/const structurePanel = el\("div", "mf-structure-panel"\);/.test(sf) && /structureMount = structurePanel;/.test(sf), "secFields exposes the panel as the structure mount");
const rf = portal.slice(portal.indexOf("async function renderFields("), portal.indexOf("async function secFields(panel)"));
check(/if \(structureMount\) \{ structureMount\.innerHTML = ""; structureMount\.appendChild\(structureSection\(\)\); \}/.test(rf), "renderFields mounts Structure & behavior into the panel (cleared each repaint)");
check(!/scroll\.appendChild\(structureSection\(\)\);\s*\n\s*wrap\.appendChild\(scroll\)/.test(rf), "…and no longer appends it inside the Fields scroller");
check(/else scroll\.appendChild\(structureSection\(\)\);/.test(rf), "…with the in-column fallback kept for any mount-less caller");
check(/if \(canEdit && selectedType\) \{/.test(rf), "the permission gate is unchanged (canEdit + a selected module)");
check(/mfViewsRepaint\(rt \|\| null\)/.test(rf) || /mfViewsRepaint\(/.test(portal.slice(portal.indexOf("function structureSection()"), portal.indexOf("const scroll = el"))), "the pipeline toggle still re-renders the Views strip (mfViewsRepaint wiring intact)");
check(/if \(refresh && mfViewsRepaint\) \{ try \{ mfViewsRepaint\(\); \} catch \(e\) \{\} \}/.test(portal), "field add/edit/delete liveness still repaints the strip");

// ---- (2) two-column sections, >=3 threshold ----
console.log("\n(2) two-column field sections:");
check(/const shownUngrouped = \(ungrouped\.length \|\| !sorted\.length\) \? 1 : 0;\s*\n\s*if \(sorted\.length \+ shownUngrouped >= 3\) scroll\.classList\.add\("mf-sections-2col"\);/.test(rf), "the 2-col class applies at 3+ sections, counting Ungrouped when shown");
check(/\.mf-fields-scroll\.mf-sections-2col \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(300px, 1fr\)\);/.test(css), "2-col layout is a CSS grid (auto-fill/minmax, natural flow)");
check(/@media \(max-width: 900px\) \{ \.mf-fields-scroll\.mf-sections-2col \{ display: block; \} \}/.test(css), "…collapsing to one column on narrow screens");

// ---- (3) height parity replaces the fixed cap ----
console.log("\n(3) height parity (no fixed cap):");
check(!/max-height: calc\(100vh - 300px\)/.test(css), "the old fixed viewport cap on the Fields scroller is gone");
check(!/sizeMfFieldsScroll/.test(portal) && !/mfScrollResizeBound/.test(portal), "the JS viewport-math sizer and its resize listener are fully removed");
check(/\.mf-grid \{[^}]*align-items: stretch/.test(css), "the grid stretches both columns to the same row height");
check(/\.mf-col-fields \{ position: relative; \}/.test(css) && /\.mf-fields-wrap \{ position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; \}/.test(css), "the Fields column fills its row exactly (height derived from the layout — the library's natural height)");
check(/\.mf-fields-scroll \{ flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain/.test(css), "the scroller fills the column and engages only past the shared height");
check(/@media \(max-width: 640px\) \{\s*\n\s*\.mf-col-fields \{ position: static; \}/.test(css), "stacked mobile layout returns to natural flow");

// ---- (4) dnd unchanged ----
console.log("\n(4) drag-and-drop byte-for-byte:");
check(/if \(canEdit\) row\.draggable = true;/.test(portal), "field rows are draggable exactly as before");
check(/const rows = Array\.prototype\.slice\.call\(list\.querySelectorAll\("\.field-row:not\(\.dragging\)"\)\);\s*\n\s*let ref = null;\s*\n\s*for \(let i = 0; i < rows\.length; i\+\+\) \{ const rect = rows\[i\]\.getBoundingClientRect\(\); if \(e\.clientY < rect\.top \+ rect\.height \/ 2\) \{ ref = rows\[i\]; break; \} \}/.test(portal), "dragover positions within the hovered list by Y midpoint (per-list => cross-column safe)");
check(/await App\.portalApi\("\/api\/fields\/" \+ fieldId \+ "\/section", \{ method: "PATCH", body: JSON\.stringify\(\{ sectionId: targetSection \|\| null \}\) \}\);\s*\n\s*await App\.portalApi\("\/api\/fields\/reorder", \{ method: "PATCH", body: JSON\.stringify\(\{ orderedIds, recordType: selectedKey \}\) \}\);/.test(portal), "drop persists section + order through the same two PATCH calls");
check(/list\.addEventListener\("dragover", \(e\) => \{\s*\n\s*if \(!mfLibraryDragType\) return;/.test(portal) && /await createFieldFromLibrary\(type, list\.dataset\.section \|\| null\);/.test(portal), "the library-drag -> create-field path is unchanged");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (structure panel below; 2-col sections at 3+; layout-derived height parity; dnd untouched)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
