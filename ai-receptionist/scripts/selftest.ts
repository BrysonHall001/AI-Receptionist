/**
 * Self-test runner — the one command that replaces the hand-maintained block.
 *
 *   npm run selftest              the GATE. Runs scripts/selftest.gate.json in its
 *                                 committed order and exits NON-ZERO if anything fails.
 *                                 This is the thing that blocks a batch.
 *   npm run selftest:all          EVERY suite. Reports everything and always exits ZERO,
 *                                 because it is an information tool, not a gate.
 *   npm run selftest:all -- pill  the same, but only suites whose filename contains "pill".
 *                                 Same buckets, same timeout, same report.
 *
 * Both modes write docs/selftest-inventory.md INCREMENTALLY — after every single suite
 * finishes, not once at the end. A crash, a timeout or a Ctrl-C at minute 40 of a 45-minute
 * run therefore still leaves a complete record of everything observed up to that point,
 * plus a banner saying where it stopped.
 *
 * WHAT THIS RUNNER WILL NEVER DO: write to, delete from, or otherwise modify anything under
 * src/db/. It spawns suites and reads their exit codes. If a suite crashes and leaves demo
 * rows behind, that is REPORTED and nothing is cleaned up — a runner with delete permission
 * on real data is a runner nobody should trust.
 */
import { execFile } from "child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(__dirname, "..");
const SUITE_DIR = join(ROOT, "src", "db");
const GATE_PATH = join(__dirname, "selftest.gate.json");
const TRIAGE_PATH = join(__dirname, "selftest.triage.json");
const REPORT_PATH = join(ROOT, "docs", "selftest-inventory.md");

/** Parallel lane for source scanners only. They read files and assert; nothing to race. */
const WORKERS = 8;
/** Per-suite ceiling. The slowest scanner measured ~10s; database suites seed tenants, so
 *  this is roughly 12x headroom while still stopping one hang from eating the whole run. */
const TIMEOUT_MS = 120_000;

export type Bucket = "scanner" | "database" | "server";
export type Status = "green" | "red" | "timeout" | "not-run";
export interface Result { name: string; bucket: Bucket; status: Status; ms: number; firstFail: string; tally: string; note?: string; }

export const listSuites = (): string[] =>
  readdirSync(SUITE_DIR).filter((f: string) => /^selfTest_.*\.ts$/.test(f)).sort();

/**
 * Which lane a suite belongs in, computed by READING THE FILE at run time — never a
 * hand-maintained list, which would rot the first time somebody adds a suite.
 *
 * THE BIAS HERE IS DELIBERATE AND MUST NOT BE "OPTIMISED" AWAY: anything that so much as
 * mentions prisma or db. is treated as database-touching and therefore runs SERIALLY.
 * Misclassifying a pure scanner as a database suite costs a few seconds of wall clock.
 * Misclassifying a database suite as a scanner lets two of them race over the same rows and
 * produces a flaky red that will waste somebody's afternoon. The costs are not symmetric,
 * so doubt resolves toward serial, always.
 */
export function bucketOf(source: string): Bucket {
  if (/\.listen\(/.test(source)) return "server";
  if (/prisma|db\./.test(source)) return "database";
  return "scanner";
}
const bucketOfFile = (name: string): Bucket => bucketOf(readFileSync(join(SUITE_DIR, name), "utf8"));

/** The first "✗ label" a suite printed, and its own tally line, both recovered from stdout. */
export function parseOutput(out: string): { firstFail: string; tally: string } {
  const lines = out.split("\n");
  const fail = lines.find((l) => l.includes("\u2717")) || "";
  const tally = lines.find((l) => /FAILED|ALL PASSED/.test(l)) || "";
  return { firstFail: fail.replace(/^\s*\u2717\s*/, "").trim(), tally: tally.trim() };
}

/** Spawn ONE suite file and classify the outcome. Exposed so the runner's own self-test can
 *  point it at synthetic fixtures in a temp directory - a runner that nothing verifies is a
 *  single point of failure for every future batch. */
export function runSuiteFile(file: string, timeoutMs = TIMEOUT_MS): Promise<Omit<Result, "name" | "bucket">> {
  const t0 = Date.now();
  return new Promise((done) => {
    execFile("tsx", [file], { cwd: ROOT, timeout: timeoutMs, maxBuffer: 16e6 }, (err: any, stdout: string, stderr: string) => {
      const ms = Date.now() - t0;
      const out = String(stdout || "") + String(stderr || "");
      const parsed = parseOutput(out);
      if (err && (err.killed || err.signal)) return done({ status: "timeout", ms, firstFail: "", tally: "", note: `no result after ${Math.round(timeoutMs / 1000)}s` });
      if (err) {
        const noDeps = /Cannot find module|ERR_MODULE_NOT_FOUND|did not initialize yet/.test(out);
        const noDb = /ECONNREFUSED|P1001|Can't reach database server|database server at/.test(out);
        const reachedAnAssertion = !!parsed.firstFail || !!parsed.tally;
        if (!reachedAnAssertion && (noDeps || noDb)) {
          const why = noDeps ? "dependencies not installed in this environment (run npm install)" : "could not reach the database";
          return done({ status: "not-run", ms, firstFail: "", tally: "", note: why });
        }
        const firstLine = (out.split("\n").find((l: string) => /Error|error TS|Cannot find/.test(l)) || "").trim();
        return done({ status: "red", ms, firstFail: parsed.firstFail || firstLine, tally: parsed.tally || "threw before reporting" });
      }
      done({ status: "green", ms, firstFail: "", tally: parsed.tally });
    });
  });
}

async function runOne(name: string): Promise<Result> {
  const bucket = bucketOfFile(name);
  const r = await runSuiteFile(join("src", "db", name));
  return { name, bucket, ...r };
}

// ---------------------------------------------------------------- report

const fmtMs = (ms: number) => (ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms");
const esc = (s: string) => s.replace(/\|/g, "\\|");

/** suite name -> cause, filled in by whoever actually READ the suite. Anything missing is
 *  reported as "cause not yet determined" rather than guessed at, which is the whole point. */
function loadTriage(): Record<string, string> {
  try { const raw = JSON.parse(readFileSync(TRIAGE_PATH, "utf8")); delete raw._comment; return raw; } catch { return {}; }
}

const CAUSES = [
  ["pinned-string", "Pins a string that a later batch deliberately changed"],
  ["genuinely-broken", "Asserts behaviour that appears genuinely broken"],
  ["could-not-run", "Could not run at all"],
  ["needs-triage", "Red, cause not yet determined"],
] as const;

function writeReport(results: Result[], opts: { mode: string; filter: string; complete: boolean; startedAt: Date; total: number; provisional?: string }) {
  const triage = loadTriage();
  const by = (s: Status) => results.filter((r) => r.status === s);
  const lines: string[] = [];
  lines.push("# Self-test inventory");
  lines.push("");
  if (opts.provisional) { lines.push(opts.provisional); lines.push(""); }
  lines.push(`Run started **${opts.startedAt.toISOString().replace("T", " ").slice(0, 16)} UTC** \u2014 mode \`${opts.mode}\`${opts.filter ? ` \u2014 filter \`${opts.filter}\`` : ""}.`);
  lines.push("");
  const couldNotStart = results.filter((r) => r.status === "not-run");
  if (couldNotStart.length) {
    const reasons = Array.from(new Set(couldNotStart.map((r) => r.note || "no reason recorded")));
    lines.push(`> **THIS RUN WAS INCOMPLETE \u2014 ${couldNotStart.length} of ${results.length} suites never started.** Reason${reasons.length > 1 ? "s" : ""} recorded: ${reasons.map((r) => `_${r}_`).join("; ")}. Those suites have no verdict here \u2014 not a pass, not a failure, simply not run \u2014 and every one of them says so on its own row. Running this again on a machine with the dependencies installed and the database up **replaces this file wholesale**; nothing is appended.`);
    lines.push("");
  }
  if (!opts.complete) {
    lines.push(`> **THIS RUN DID NOT FINISH.** ${results.length} of ${opts.total} suites had reported when the run stopped` +
      (results.length ? ` \u2014 the last one recorded was \`${results[results.length - 1].name}\`.` : ".") +
      " Everything below was really observed; the suites missing from the table simply never ran. Re-run to complete it.");
    lines.push("");
  }
  lines.push("One line on the commands: `npm run selftest` runs the gate and blocks on failure; `npm run selftest:all` runs everything and never blocks; `npm run selftest:all -- <text>` runs only the suites whose filename contains that text, which is how you re-check a handful in seconds instead of re-running everything.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| result | count | what it means |");
  lines.push("| --- | --- | --- |");
  lines.push(`| Passed | ${by("green").length} | every assertion in the suite held |`);
  lines.push(`| Failed | ${by("red").length} | the suite ran and at least one assertion did not hold |`);
  lines.push(`| Timed out | ${by("timeout").length} | no result within ${Math.round(TIMEOUT_MS / 1000)}s \u2014 not the same thing as failing |`);
  lines.push(`| Not run | ${by("not-run").length} | never started; the reason is on the row |`);
  lines.push(`| **Total recorded** | **${results.length}** | of ${opts.total} suites |`);
  lines.push("");
  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  lines.push(`Measured time across the recorded suites: **${fmtMs(totalMs)}**. Per-suite durations are in the table below, green ones included, so the cost of the serial database lane can be judged from real numbers rather than a guess.`);
  lines.push("");
  lines.push("## Every suite");
  lines.push("");
  lines.push("| suite | lane | result | took | first failing assertion |");
  lines.push("| --- | --- | --- | --- | --- |");
  const rank: Record<Status, number> = { red: 0, timeout: 1, "not-run": 2, green: 3 };
  const sorted = results.slice().sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
  for (const r of sorted) {
    const label = r.status === "green" ? "passed" : r.status === "red" ? "**FAILED**" : r.status === "timeout" ? "**timed out**" : "not run";
    const detail = r.status === "green" ? "" : esc(r.firstFail || r.note || "");
    lines.push(`| \`${r.name.replace(/\.ts$/, "")}\` | ${r.bucket} | ${label} | ${fmtMs(r.ms)} | ${detail} |`);
  }
  lines.push("");
  lines.push("## Triage \u2014 the ones that did not pass, grouped by likely cause");
  lines.push("");
  lines.push("These groupings are a **judgement about cause, not a diagnosis**, and nothing here has been repaired. A suite that fails because an approved change moved a string it was pinned to needs a completely different decision from one that fails because the product is actually broken, which is exactly why they are separated before anyone touches either.");
  lines.push("");
  const notGreen = results.filter((r) => r.status !== "green");
  for (const [key, heading] of CAUSES) {
    const group = notGreen.filter((r) => {
      const assigned = triage[r.name.replace(/\.ts$/, "")];
      if (assigned) return assigned === key;
      if (r.status === "timeout" || r.status === "not-run") return key === "could-not-run";
      return key === "needs-triage";
    });
    lines.push(`### ${heading} \u2014 ${group.length}`);
    lines.push("");
    if (!group.length) lines.push("_None._");
    else for (const r of group) lines.push(`- \`${r.name.replace(/\.ts$/, "")}\` \u2014 ${esc(r.firstFail || r.note || "no detail captured")}`);
    lines.push("");
  }
  if (!existsSync(join(ROOT, "docs"))) mkdirSync(join(ROOT, "docs"), { recursive: true });
  writeFileSync(REPORT_PATH, lines.join("\n"));
}

// ---------------------------------------------------------------- run

async function main() {
  const args = process.argv.slice(2);
  const gateMode = !args.includes("--all");
  const filter = args.find((a: string) => !a.startsWith("-")) || "";
  const startedAt = new Date();

  let names: string[];
  if (gateMode) {
    let gate: string[];
    try { gate = JSON.parse(readFileSync(GATE_PATH, "utf8")); }
    catch (e: any) { console.error(`Could not read the gate list at ${GATE_PATH}: ${e.message}`); process.exit(1); return; }
    // A typo in the manifest must fail LOUDLY. Silently skipping a missing suite would mean
    // the gate quietly shrinks and nobody notices.
    const missing = gate.filter((n) => !existsSync(join(SUITE_DIR, n.endsWith(".ts") ? n : n + ".ts")));
    if (missing.length) { console.error(`Gate list names ${missing.length} suite(s) that do not exist: ${missing.join(", ")}`); process.exit(1); return; }
    names = gate.map((n) => (n.endsWith(".ts") ? n : n + ".ts"));
  } else {
    names = listSuites();
  }
  if (filter) names = names.filter((n) => n.includes(filter));
  if (!names.length) { console.log(`No suites matched${filter ? ` "${filter}"` : ""}.`); process.exit(0); return; }

  const mode = gateMode ? "gate" : "all";
  console.log(`Self-tests \u2014 ${mode} \u2014 ${names.length} suite(s)${filter ? ` matching "${filter}"` : ""}`);
  console.log("=".repeat(60));

  const results: Result[] = [];
  const flush = (complete: boolean) => writeReport(results, { mode, filter, complete, startedAt, total: names.length });
  const record = (r: Result) => {
    results.push(r);
    const mark = r.status === "green" ? "\u2713" : r.status === "timeout" ? "\u23f1" : "\u2717";
    console.log(`  ${mark} ${r.name.replace(/\.ts$/, "").padEnd(42)} ${r.bucket.padEnd(9)} ${fmtMs(r.ms).padStart(7)}`);
    if (r.status === "red" && r.firstFail) console.log(`      \u2192 ${r.firstFail}`);
    if (r.status === "timeout") console.log(`      \u2192 ${r.note}`);
    flush(false); // incremental: a crash after this point still leaves everything so far
  };
  // A Ctrl-C mid-run keeps what was observed rather than throwing the afternoon away.
  process.on("SIGINT", () => { flush(false); console.log("\nInterrupted \u2014 partial report written to docs/selftest-inventory.md"); process.exit(130); });

  if (gateMode) {
    // The gate runs STRICTLY SERIALLY in its committed order, which reproduces exactly what
    // the hand-maintained block did. Preserving that is worth more than the minutes.
    for (const n of names) record(await runOne(n));
  } else {
    const scanners = names.filter((n) => bucketOfFile(n) === "scanner");
    const serial = names.filter((n) => bucketOfFile(n) !== "scanner");
    const queue = scanners.slice();
    await Promise.all(Array.from({ length: WORKERS }, async () => { while (queue.length) record(await runOne(queue.shift() as string)); }));
    for (const n of serial) record(await runOne(n));
  }

  flush(true);
  const red = results.filter((r) => r.status === "red");
  const timedOut = results.filter((r) => r.status === "timeout");
  console.log("=".repeat(60));
  console.log(`passed ${results.filter((r) => r.status === "green").length}   failed ${red.length}   timed out ${timedOut.length}   \u2014 report: docs/selftest-inventory.md`);
  if (red.length || timedOut.length) {
    console.log("");
    console.log("WHAT FAILED:");
    for (const r of [...red, ...timedOut]) console.log(`  ${r.name.replace(/\.ts$/, "")}\n      ${r.firstFail || r.note || "no detail captured"}`);
  }
  // Gate blocks. The inventory never does — it is an information tool, and a tool that
  // reports bad news must not be something people are tempted to stop running.
  const notRun = results.filter((r) => r.status === "not-run");
  if (notRun.length) console.log(`  (${notRun.length} could not start — see the report for why)`);
  process.exit(gateMode && (red.length || timedOut.length || notRun.length) ? 1 : 0);
}

if (require.main === module) main().catch((e) => { console.error("runner threw:", e); process.exit(1); });
