// Self-test for the Settings tiles + Modules & Fields column reorder (this batch).
// Static/structural (fs reads) — pure frontend, runs in the sandbox with no DB.
//
//   npx tsx src/db/selfTest_settingsTiles.ts
//
// PROVES:
//  (1) The left Settings sub-nav column is gone; sections render as TILES across the
//      top (alphabetical by label), each a link to its #/settings/<key>, with an
//      active state, and the content panel is full-width. Visibility is unchanged
//      (SECTIONS is still filtered by `admin`, so admin-only tiles stay hidden).
//  (2) Modules & Fields columns read left -> right: Modules | Field library | Fields |
//      Terms, with Terms pulled out into its OWN rightmost column (no longer under
//      Modules), and the Fields column heading relabelled from "Sections & fields"
//      to "Fields". Existing field/rename/reorder/terms wiring is untouched.
//  (3) CSS: four-column grid + a `.settings-tile` style exist.
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

console.log("Settings tiles + Modules & Fields reorder");
console.log("=========================================\n");

// (1) Tiles replace the sub-nav.
console.log("(1) Settings tiles (no left column):");
check(/settings-tiles-shell/.test(portal) && /el\("div", "settings-tiles"\)/.test(portal), "settings renders a tiles shell");
check(/\.slice\(\)\.sort\(\(a, b\) => a\.label\.localeCompare\(b\.label\)\)/.test(portal), "tiles are ordered alphabetically by label");
check(/"settings-tile" \+ \(s\.key === active \? " active" : ""\)/.test(portal), "each tile shows an active state");
check(/tile\.href = "#\/settings\/" \+ s\.key;/.test(portal), "clicking a tile opens that section (#/settings/<key>)");
check(!/el\("aside", "settings-subnav"\)/.test(portal) && !/settings-subnav-item/.test(portal), "the left sub-nav column (settings-subnav) is removed");
check(/settings-panel settings-panel--full/.test(portal), "content panel is full-width (reclaims the sub-nav width)");
check(/\.filter\(\(s\) => canEditPortal \|\| !s\.admin\)/.test(portal), "admin-only sections stay hidden for non-admins (visibility unchanged)");

// (2) Modules & Fields column order + Terms own column + Fields heading.
console.log("\n(2) Modules & Fields — Modules | Field library | Fields | Terms:");
check(/grid\.appendChild\(colMods\); grid\.appendChild\(colLib\); grid\.appendChild\(host\); grid\.appendChild\(colTerms\);/.test(portal), "columns appended in order: Modules, Field library, Fields, Terms");
check(/mf-col mf-col-modules/.test(portal) && /mf-col mf-col-library/.test(portal) && /mf-col mf-col-fields/.test(portal) && /mf-col mf-col-terms/.test(portal), "all four column classes present (incl. mf-col-terms)");
check(/buildTermsSection\(colTerms\)/.test(portal), "Terms is built into its OWN column");
check(!/beneath the modules/.test(portal), "Terms is no longer a sub-section under Modules");
check(/el\("div", "mf-col-title", "Fields"\)/.test(portal), 'the Fields column heading is now "Fields"');
check(!/"mf-col-title", "Sections & fields"/.test(portal), '"Sections & fields" heading is gone');
// Behaviour untouched (still reuses the same saves the last batch wired).
check(/await App\.persistTypeLabel\(t\.key, one, many\)/.test(portal) && /await App\.persistNav\(\{ order: order, hidden: cfg\.hidden, labels: cfg\.labels \}\)/.test(portal), "module rename/reorder wiring unchanged");
check(/payload\.generic\[row\.key\] = \{ one: one, many: many \}/.test(portal), "Terms save (generic words) unchanged");
check(/fieldsMount = host;\s*\n\s*await renderFields\(true, host\);/.test(portal), "Fields column still mounts renderFields (host)");

// (3) CSS.
console.log("\n(3) CSS:");
check(/\.mf-grid \{ display: grid; grid-template-columns: minmax\(150px, 210px\) minmax\(140px, 185px\) minmax\(0, 1fr\) minmax\(160px, 220px\)/.test(css), "four-column grid template");
check(/\.mf-col-library, \.mf-col-modules, \.mf-col-terms \{/.test(css), "Terms column gets the card styling");
check(/\.settings-tile \{/.test(css) && /\.settings-tiles \{ display: flex; flex-wrap: wrap/.test(css), "tile styles exist and wrap");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (tiles alphabetical; MF = Modules | Field library | Fields | Terms)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
