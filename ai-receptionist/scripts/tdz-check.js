/**
 * USE-BEFORE-DECLARE INSIDE A CALLBACK.
 *
 * `tsc` flags a const used before its declaration at the top level of a scope, but NOT when
 * the use sits inside a callback - it cannot prove the callback runs immediately. .map(),
 * .filter() and .forEach() DO run immediately, so that pattern typechecks and then throws
 * "Cannot access X before initialization" at runtime.
 *
 * That shipped once and 500'd a whole page. This finds it statically.
 *   node scripts/tdz-check.js src/routes/api.ts [more files...]
 */
const fs = require("fs");
const hits = [];
for (const file of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const src = fs.readFileSync(file, "utf8");
  // each route handler / function body, roughly: from a line ending in "=> {" to "\n});"
  for (const m of src.matchAll(/=>\s*\{[\s\S]*?\n\}\);/g)) {
    const body = m[0];
    // comments stripped: a name mentioned in prose above its declaration is not a use
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const declared = [...code.matchAll(/\n\s*const (\w+)\s*=/g)].map((d) => [d[1], d.index]);
    for (const [name, at] of declared) {
      // ANY textual use before the declaration in the same body. Deliberately blunt: a
      // narrower rule missed the real bug, because `.map((s) => ... moduleAreas)` puts the
      // use past a closing paren the pattern was stopping at.
      const before = code.slice(0, at);
      if (new RegExp("\\b" + name + "\\b").test(before)) {
        const line = src.slice(0, m.index + before.lastIndexOf(name)).split("\n").length;
        hits.push(`${file}  ${name}`);
      }
    }
  }
}
// A RATCHET. The rule is deliberately blunt - a narrower one missed the real bug - so it
// also flags long-standing patterns where the callback is DEFERRED and the order is fine.
// Those are recorded once; this then fails only when a NEW one appears, which is exactly what
// happened when `moduleAreas` was declared under the .map() that reads it.
const BASELINE = require("path").join(__dirname, "tdz-check.baseline.json");
if (process.argv.includes("--record")) {
  fs.writeFileSync(BASELINE, JSON.stringify({ note: "Pre-existing use-before-declare hits in DEFERRED callbacks, where the order is fine. This ratchet fails on ADDITIONS.", hits: hits.sort() }, null, 2) + "\n");
  console.log(`  recorded ${hits.length} known hits as the baseline`);
  process.exit(0);
}
let known = [];
try { known = JSON.parse(fs.readFileSync(BASELINE, "utf8")).hits || []; } catch { console.log("  (no baseline - run with --record once)"); }
const added = hits.filter((h) => !known.includes(h));
if (!added.length) { console.log(`  NO NEW use-before-declare (${known.length} known, unchanged)`); process.exit(0); }
console.log("  NEWLY INTRODUCED:");
for (const h of added) console.log("    " + h);
process.exit(1);
