// SELF-TEST RUNNER HARNESS — the runner's own self-test.
//
// The runner is now load-bearing for every future batch: if it silently skips a suite, or
// reports a hang as a failure, or a typo in the gate list quietly shrinks the gate, then
// every batch after this one ships on a false green. So the runner gets checked the same
// way everything else does.
//
// This suite deliberately needs NO database and NO server. It reads the manifest, exercises
// the runner's exported pieces, and drives it against synthetic fixtures written to the OS
// temp directory — never to src/db, which the runner is forbidden to touch and which this
// suite fingerprints before and after to prove it.
/* eslint-disable @typescript-eslint/no-var-requires */
const { readFileSync, writeFileSync, existsSync, mkdtempSync, readdirSync, statSync, rmSync } = require("fs");
const { join, resolve } = require("path");
const { tmpdir } = require("os");
const runner = require("../../scripts/selftest");

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const ROOT = resolve(__dirname, "..", "..");
const SUITE_DIR = join(ROOT, "src", "db");
const GATE_PATH = join(ROOT, "scripts", "selftest.gate.json");

/** A stable fingerprint of every file under src/db — name, size, mtime. */
function fingerprintSuiteDir(): string {
  return readdirSync(SUITE_DIR).sort().map((f: string) => {
    const st = statSync(join(SUITE_DIR, f));
    return `${f}:${st.size}:${st.mtimeMs}`;
  }).join("|");
}

async function main() {
  console.log("Self-test runner harness \u2014 the runner checks out too");
  console.log("===================================================");

  // ---------- (1) the gate manifest ----------
  console.log("\n(1) the gate manifest:");
  let gate: string[] = [];
  let parsed = false;
  try { gate = JSON.parse(readFileSync(GATE_PATH, "utf8")); parsed = Array.isArray(gate); } catch { parsed = false; }
  check(parsed, "scripts/selftest.gate.json parses as a list");
  check(gate.length === 48, `it names ${gate.length} suites (47 inherited from the hand-maintained block, plus this one)`);
  const missing = gate.filter((n) => !existsSync(join(SUITE_DIR, n.endsWith(".ts") ? n : n + ".ts")));
  check(missing.length === 0,
    missing.length === 0
      ? "every name in it resolves to a real file \u2014 a typo cannot silently shrink the gate"
      : `GATE NAMES SUITES THAT DO NOT EXIST: ${missing.join(", ")}`);
  const dupes = gate.filter((n, i) => gate.indexOf(n) !== i);
  check(dupes.length === 0, dupes.length === 0 ? "no duplicates" : `DUPLICATED IN THE GATE: ${Array.from(new Set(dupes)).join(", ")}`);
  check(gate.includes("selfTest_runnerHarness"), "this suite is itself in the gate \u2014 the runner cannot rot unnoticed");
  check(gate[0] === "selfTest_tenantIdentity" && gate[46] === "selfTest_learningCenter3",
    "the inherited order is preserved end to end (first and last of the original 47 are where they were)");

  // ---------- (2) the bucket classifier ----------
  console.log("\n(2) the bucket classifier, on three named real suites:");
  const bucketFor = (name: string) => runner.bucketOf(readFileSync(join(SUITE_DIR, name + ".ts"), "utf8"));
  check(bucketFor("selfTest_tenantsTableUi") === "scanner",
    "selfTest_tenantsTableUi \u2014 pure source scanner (reads files, asserts on contents) \u2192 parallel lane");
  check(bucketFor("selfTest_priceBook") === "database",
    "selfTest_priceBook \u2014 touches the database without starting a server \u2192 serial lane");
  check(bucketFor("selfTest_tenantIdentity") === "server",
    "selfTest_tenantIdentity \u2014 spawns a server \u2192 serial lane");
  check(runner.bucketOf('const x = 1; // nothing interesting here') === "scanner", "a file with no database or server markers is a scanner");
  check(runner.bucketOf('await db.tenant.findMany();') === "database", "\u2026and the merest mention of db. resolves to SERIAL, which is the deliberate bias");

  // ---------- (3) synthetic fixtures: red, hanging, green ----------
  console.log("\n(3) the runner against synthetic suites (temp directory, never src/db):");
  const tmp = mkdtempSync(join(tmpdir(), "selftest-harness-"));
  const RED = join(tmp, "fixtureRed.ts");
  const HANG = join(tmp, "fixtureHang.ts");
  const GREEN = join(tmp, "fixtureGreen.ts");
  writeFileSync(RED, [
    'const failures: string[] = [];',
    'function check(c: boolean, l: string) { console.log(`  ${c ? "\\u2713" : "\\u2717"} ${l}`); if (!c) failures.push(l); }',
    'check(true, "a passing one first, so the FIRST failure is the one below");',
    'check(false, "the synthetic failing assertion");',
    'console.log(`${failures.length} FAILED \\u274c: ${failures[0]}`);',
    'process.exit(1);',
  ].join("\n"));
  writeFileSync(HANG, 'console.log("  \\u2713 started, then hangs on purpose");\nsetInterval(() => { /* never resolves */ }, 1000);\n');
  writeFileSync(GREEN, 'console.log("  \\u2713 fine");\nconsole.log("ALL PASSED \\u2705");\nprocess.exit(0);\n');

  const before = fingerprintSuiteDir();

  const red = await runner.runSuiteFile(RED, 30000);
  check(red.status === "red", `a failing suite is reported RED (got "${red.status}")`);
  check(red.firstFail === "the synthetic failing assertion",
    `\u2026and the runner surfaces its FIRST failing label verbatim ("${red.firstFail}")`);

  const hang = await runner.runSuiteFile(HANG, 4000);
  check(hang.status === "timeout", `a hanging suite is reported TIMED OUT, not failed (got "${hang.status}")`);
  check(hang.status === "timeout" && red.status === "red", "\u2026so the two are distinguishable, which is the whole point of the separate status");

  const green = await runner.runSuiteFile(GREEN, 30000);
  check(green.status === "green", "a passing suite is reported GREEN");
  check(green.ms > 0 && red.ms > 0 && hang.ms > 0, "every outcome carries a measured duration, green included");
  check(typeof hang.note === "string" && /no result after/.test(hang.note), `\u2026and the timeout carries its reason ("${hang.note}")`);

  // the run must CONTINUE past a hang rather than stopping there
  const after = await runner.runSuiteFile(GREEN, 30000);
  check(after.status === "green", "a suite run AFTER the hang still completes \u2014 one hang does not end the run");

  // ---------- (4) the runner never writes under src/db ----------
  console.log("\n(4) the runner's hands stay off the suites:");
  check(fingerprintSuiteDir() === before,
    "src/db is byte-identical after driving the runner \u2014 nothing written, nothing deleted, no mtime touched");

  // ---------- (5) output parsing ----------
  console.log("\n(5) reading a suite's own output:");
  const p1 = runner.parseOutput("  \u2713 fine\n  \u2717 the bad one\n  \u2717 a later one\n2 FAILED \u274c: the bad one");
  check(p1.firstFail === "the bad one", "the FIRST \u2717 is the one reported, not the last");
  check(/2 FAILED/.test(p1.tally), "the suite's own tally line is captured");
  const p2 = runner.parseOutput("  \u2713 fine\nALL PASSED \u2705 (everything)");
  check(p2.firstFail === "" && /ALL PASSED/.test(p2.tally), "a passing suite yields no failure label and its pass line");

  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort, temp dir */ }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exit(1); }
  console.log("ALL PASSED \u2705 (the runner reports honestly and keeps its hands off the suites)");
  process.exit(0);
}

main().catch((e: any) => { console.error("threw:", e); process.exit(1); });

export {};
