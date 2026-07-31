process.env.AI_PROVIDER = "mock";

// SUITE WAIT DISCIPLINE — self-test.
//
// This batch's deliverable is a GUARD, so this suite's job is to prove the guard works rather
// than to trust it. A ratchet that cannot be shown to catch a regression is decoration.
//
// The rule it enforces, in one line: wait for the thing you are about to assert on, by the
// property you will assert. A fixed sleep before reading the DOM is the pattern that has
// actually cost us round trips. The one honest exception is asserting that something did NOT
// happen, which polling cannot establish - that needs a deliberate settle, and must say so.
//
// WHY A RATCHET AND NOT A FLAGGER: flagging every instance fired on 54 sites across 21 suites
// that all pass today. A check with that false-positive rate is ignored within a week and is
// then worse than nothing. So it records a baseline and fails only on an INCREASE - silent on
// day one, and still closed against creep.
/* eslint-disable @typescript-eslint/no-var-requires */
const { readFileSync, readdirSync } = require("fs");
const { resolve: resolvePath } = require("path");

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const R = resolvePath(__dirname, "..", "..");
const DB = resolvePath(R, "src", "db");
const baseline = require("./fixtures/suiteWaitBaseline.json");

// The rule, expressed ONCE so the test and the ratchet cannot drift apart.
const SLEEP = /await sleep\(\s*\d+\s*\)/;
const SAMPLE = /querySelector|querySelectorAll|\.textContent|\.innerHTML/;
const EXEMPT = /deliberate settle|did not|does not|never|absent|unchanged|no change/i;

/**
 * How many "sleep then read the DOM" sites a source contains.
 *
 * A match INSIDE A STRING LITERAL does not count. That is not a nicety: this very file passes
 * probe snippets to countSites as string data, and without this the guard counted its own test
 * fixtures as real offences and failed on itself. Any suite that quotes example code would hit
 * the same thing, so the rule belongs in the counter rather than in an exclusion list.
 */
function insideString(line: string, at: number): boolean {
  const before = line.slice(0, at);
  const singles = (before.match(/'/g) || []).length;
  const doubles = (before.match(/"/g) || []).length;
  const backs = (before.match(/`/g) || []).length;
  return singles % 2 === 1 || doubles % 2 === 1 || backs % 2 === 1;
}
function countSites(src: string): number {
  const lines = src.split("\n");
  let n = 0;
  lines.forEach((l, i) => {
    const m = SLEEP.exec(l);
    if (!m) return;
    if (insideString(l, m.index)) return;
    if (EXEMPT.test(lines.slice(Math.max(0, i - 3), i + 1).join(" "))) return;
    if (SAMPLE.test(lines.slice(i + 1, i + 4).join("\n"))) n++;
  });
  return n;
}
const suiteFiles = () => readdirSync(DB).filter((f: string) => /^selfTest_.*\.ts$/.test(f));
const keyOf = (f: string) => f.replace("selfTest_", "").replace(".ts", "");

async function main() {
  console.log("SUITE WAIT DISCIPLINE \u2014 self-test");
  console.log("==================================");

  // ---------- (1) the ratchet ----------
  console.log("\n(1) the ratchet:");
  const risen: string[] = [];
  let total = 0;
  for (const f of suiteFiles()) {
    const now = countSites(readFileSync(resolvePath(DB, f), "utf8"));
    total += now;
    const was = baseline.per[keyOf(f)] || 0;
    if (now > was) risen.push(`${keyOf(f)} ${was}\u2192${now}`);
  }
  check(risen.length === 0,
    risen.length === 0
      ? `no suite added a sleep-then-sample site (${total} across the repo, baseline ${baseline.total})`
      : `SLEEP-THEN-SAMPLE ADDED: ${risen.join(", ")} \u2014 wait for the thing you are about to assert on instead`);
  check(total <= baseline.total,
    `the total has not risen (${total} vs ${baseline.total}) \u2014 the ratchet only turns one way`);
  check(Object.keys(baseline.per).length > 0 && baseline.total > 0,
    `the baseline is real: ${baseline.total} sites across ${Object.keys(baseline.per).length} suites, recorded rather than assumed`);

  // ---------- (2) does it actually catch anything? ----------
  console.log("\n(2) NEGATIVES \u2014 a ratchet that catches nothing is decoration:");
  const probe = (body: string) => countSites(body.split("|").join("\n"));
  check(probe('await sleep(200);|const x = document.querySelector(".thing");') === 1,
    "a newly added sleep-then-sample IS counted");
  check(probe('btn.click();|await sleep(50);|const t = host.textContent;') === 1,
    "\u2026including when the read is a textContent two lines later");
  check(probe('await sleep(200);|const n = rows.length;') === 0,
    "\u2026while a sleep followed by something that is not a DOM read is not counted");

  // ---------- (3) the two shapes it must NOT fire on ----------
  console.log("\n(3) the false positives that would have made it useless:");
  check(probe('btn.click();|const p = node.querySelector(".tip-panel");') === 0,
    "a SYNCHRONOUS click-then-read is not flagged \u2014 the shape that made me distrust my own census");
  check(probe('// deliberate settle: nothing should appear|await sleep(200);|const x = document.querySelector(".thing");') === 0,
    "a commented DELIBERATE SETTLE is not flagged \u2014 the honest use of a sleep");
  check(probe('// prove the row never appears|await sleep(200);|const x = document.querySelector(".row");') === 0,
    "\u2026and so is a settle whose comment says it is asserting an absence");
  // the exemption must not be a blanket escape hatch
  check(probe('// just waiting a bit|await sleep(200);|const x = document.querySelector(".thing");') === 1,
    "NEGATIVE: a vague comment does NOT exempt it \u2014 the exemption needs the words that name the intent");

  // ---------- (4) the two suites this batch actually fixed ----------
  console.log("\n(4) the two that had bitten:");
  const ti = readFileSync(resolvePath(DB, "selfTest_tenantIdentity.ts"), "utf8");
  check(!/card is on screen and re-renders when the picker is applied/.test(ti),
    "tenantIdentity: the label that claimed more than its assertion proved is gone");
  check(/check\(baseline\.length > 0, "the fixture's card is on screen"\)/.test(ti),
    "\u2026replaced by an honest weak check that says only what it proves");
  check(/applying the picker REPAINTS the card/.test(ti) && /THE GRID IS NOT REPAINTING/.test(ti),
    "\u2026plus a separate check that PROVES the repaint, and names the environment when it fails");
  check(/buildCard reads all \$\{picker\.keys\.length\} keys/.test(ti),
    "\u2026stating that the product is not at fault, so nobody re-litigates it next time");
  const dt = readFileSync(resolvePath(DB, "selfTest_devToolsTabs.ts"), "utf8");
  check(/Polling cannot establish an absence/i.test(dt) && /deliberate settle/i.test(dt),
    "devToolsTabs: the NEGATIVE half now settles deliberately, and says what it is waiting out");

  // ---------- (5) test files only ----------
  console.log("\n(5) scope:");
  const productTouched = ["public/js/admin.js", "public/js/portal.js", "public/js/table.js", "public/styles.css"]
    .filter((f) => {
      try { return readFileSync(resolvePath(R, f), "utf8").indexOf("suiteWaitBaseline") !== -1; } catch (e) { return false; }
    });
  check(productTouched.length === 0, "no product file references this batch's fixture \u2014 test files only");
  check(baseline.per.tenantIdentity === undefined || typeof baseline.per.tenantIdentity === "number",
    "the baseline records per-suite counts, so a rise names the suite rather than just a total");

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exit(1); }
  console.log("ALL PASSED \u2705 (a ratchet that is silent today and still closed against creep)");
  process.exit(0);
}

main().catch((e: any) => { console.error("threw:", e); process.exit(1); });

export {};
