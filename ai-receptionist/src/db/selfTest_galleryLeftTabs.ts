// Documented check (pure — no DB): BOTH template galleries render as left-side category
// tabs, and the shared tab CSS ships.
//
//   npx tsx src/db/selfTest_galleryLeftTabs.ts
//
// Proves the Analytics report-templates gallery (reports.js) and the Automations
// templates gallery (automations.js) were both rebuilt around the .tpl-gallery /
// .tpl-cats (left rail) / .tpl-panel structure with a selectCat() tab switcher, and
// that styles.css carries the matching .tpl-gallery / .tpl-cat rules (incl. the
// narrow-screen collapse).
import * as fs from "fs";
import * as path from "path";

const root = path.resolve(__dirname, "../..");
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assertGallery(file: string, label: string) {
  const src = read(file);
  check(src.includes("tpl-gallery"), `${label}: builds a .tpl-gallery shell`);
  check(src.includes("tpl-cats"), `${label}: has the left-side .tpl-cats rail`);
  check(src.includes("tpl-panel"), `${label}: renders cards into a .tpl-panel`);
  check(src.includes("tpl-cat"), `${label}: renders per-category .tpl-cat tab buttons`);
  check(src.includes("selectCat"), `${label}: switches categories via selectCat()`);
  // The old always-stacked layout (a preset-cat-head printed for every category in a
  // single scroll) should no longer drive these galleries.
  check(!src.includes("renderSection("), `${label}: no longer uses the old stacked renderSection()`);
}

function main() {
  console.log("Template galleries — left-side category tabs (both) + shared CSS");
  console.log("================================================================");

  assertGallery("public/js/reports.js", "Analytics gallery");
  assertGallery("public/js/automations.js", "Automations gallery");

  const css = read("public/styles.css");
  check(css.includes(".tpl-gallery"), "styles.css defines .tpl-gallery");
  check(css.includes(".tpl-cats"), "styles.css defines the .tpl-cats rail");
  check(css.includes(".tpl-cat.active"), "styles.css styles the active tab (.tpl-cat.active)");
  check(css.includes(".tpl-panel"), "styles.css defines the .tpl-panel");
  check(/@media[^{]*max-width:\s*640px/.test(css), "styles.css includes a narrow-screen (max-width:640px) rule");
  check(css.includes("overflow-x: auto") || css.includes("overflow-x:auto"), "styles.css collapses the rail to a horizontal scroll on narrow screens");
}

try { main(); } catch (e) { console.error(e); failures.push("threw: " + (e as Error).message); }
console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (both galleries use left-side category tabs)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
