process.env.AI_PROVIDER = "mock";

// HOLIDAY MARK — self-test.
//
// This is date arithmetic, which is exactly the kind of thing worth pinning: it is computable,
// it has edge cases, and nobody will look at it again for years. The assertion that matters
// most is what happens PAST THE END OF THE LOOKUP TABLE, because that is the one that has to
// hold long after everyone has forgotten the table exists.
//
// Every check here runs against the shipped file in a DOM, not against a description of it.
//
// NO DATABASE. This feature is presentation only and touches nothing stored, so the suite
// deliberately does not import the Prisma client: it runs anywhere, in under a second, and a
// database being down can never make it red for a reason that has nothing to do with it.
/* eslint-disable @typescript-eslint/no-var-requires */
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { JSDOM } = require("jsdom");

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const R = resolvePath(__dirname, "..", "..");
const SRC = readFileSync(resolvePath(R, "public", "js", "holiday.js"), "utf8");
const ORDINARY = "<svg id='THE-ORDINARY-C'/>";

/** A fresh window with holiday.js loaded, so one test cannot contaminate the next. */
function boot() {
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only" }).window;
  w.App = { brandCSvg: ORDINARY };
  new Function("window", "App", SRC)(w, w.App);
  return w.App;
}
const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const fmt = (o: any) => (o ? `${o.y}-${String(o.m).padStart(2, "0")}-${String(o.d).padStart(2, "0")}` : "none");

/** Western Easter, computed independently so the TABLE can be checked rather than trusted. */
function computus(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return { y, m: Math.floor((h + l - 7 * m + 114) / 31), d: ((h + l - 7 * m + 114) % 31) + 1 };
}

async function main() {
  console.log("HOLIDAY MARK \u2014 self-test");
  console.log("========================");
  const App = boot();
  const H = App.holiday;
  const entry = (id: string) => H.REGISTRY.find((e: any) => e.id === id);

  // ---------- (1) rule dates, including a leap year and a month-edge case ----------
  console.log("\n(1) dates that are rules, not fixed:");
  const cases: Array<[string, Record<number, string>]> = [
    ["thanksgiving", { 2024: "2024-11-28", 2025: "2025-11-27", 2026: "2026-11-26", 2027: "2027-11-25", 2028: "2028-11-23" }],
    ["memorial", { 2024: "2024-05-27", 2025: "2025-05-26", 2026: "2026-05-25", 2027: "2027-05-31", 2028: "2028-05-29" }],
    ["mlk", { 2024: "2024-01-15", 2025: "2025-01-20", 2026: "2026-01-19", 2027: "2027-01-18", 2028: "2028-01-17" }],
    ["labor", { 2024: "2024-09-02", 2025: "2025-09-01", 2026: "2026-09-07", 2027: "2027-09-06", 2028: "2028-09-04" }],
  ];
  for (const [id, want] of cases) {
    const wrong = Object.keys(want).filter((y) => fmt(H.startOf(entry(id), Number(y))) !== want[Number(y)]);
    check(wrong.length === 0, `${entry(id).name} across 2024-2028 (2024 is a leap year)${wrong.length ? " \u2014 wrong for " + wrong.join(", ") : ""}`);
  }
  check(fmt(H.startOf(entry("memorial"), 2027)) === "2027-05-31",
    "THE EDGE CASE: the LAST Monday in May 2027 is the 31st \u2014 a naive nth-weekday helper gets this wrong");
  check(H.nthWeekday(2026, 2, 1, 5) === null,
    "\u2026and asking for a 5th Monday in a February that has none returns nothing rather than spilling into March");

  // ---------- (2) fixed dates ----------
  console.log("\n(2) dates that are fixed:");
  const fixedOk = ["new_year", "valentines", "st_patricks", "independence", "halloween", "christmas", "new_years_eve"]
    .every((id) => {
      const e = entry(id);
      return [2024, 2026, 2031, 2040].every((y) => {
        const s = H.startOf(e, y);
        return s && s.y === y && s.m === e.month && s.d === e.day;
      });
    });
  check(fixedOk, "every fixed day lands on its own month and day in 2024, 2026, 2031 and 2040");
  check(!!App.holidayFor(D(2040, 12, 25)), "\u2026including years far past the table, because a fixed date never expires");

  // ---------- (3) the table ----------
  console.log("\n(3) the lookup table:");
  const easterWrong = [];
  for (let y = 2026; y <= H.TABLE_LAST_YEAR; y++) {
    if (fmt(H.startOf(entry("easter"), y)) !== fmt(computus(y))) easterWrong.push(y);
  }
  check(easterWrong.length === 0,
    `every tabled Easter matches an INDEPENDENTLY COMPUTED date, 2026-${H.TABLE_LAST_YEAR}${easterWrong.length ? " \u2014 wrong for " + easterWrong.join(", ") : ""}`);
  // The lunar and lunisolar dates cannot be recomputed here, so what is asserted is that each
  // is a REAL, in-range calendar date for the year it claims - a typo is what this catches.
  let badRow: string | null = null;
  for (const key of Object.keys(H.TABLE)) {
    for (const y of Object.keys(H.TABLE[key])) {
      const row = H.TABLE[key][y];
      const dt = new Date(Number(y), row[0] - 1, row[1]);
      if (!Array.isArray(row) || row.length !== 2 || dt.getFullYear() !== Number(y) || dt.getMonth() !== row[0] - 1 || dt.getDate() !== row[1]) {
        badRow = `${key} ${y}`;
      }
    }
  }
  check(badRow === null, `every row in the table is a real calendar date${badRow ? " \u2014 bad: " + badRow : ""}`);
  const years = Object.keys(H.TABLE.easter).map(Number).sort();
  check(Math.max(...years) === H.TABLE_LAST_YEAR, `the table's last year is ${H.TABLE_LAST_YEAR}, matching what the code says it is`);

  // ---------- (4) PAST THE END OF THE TABLE ----------
  console.log("\n(4) years after the table runs out:");
  const after = H.TABLE_LAST_YEAR + 1;
  const tabledIds = H.REGISTRY.filter((e: any) => e.kind === "tabled").map((e: any) => e.id);
  check(tabledIds.every((id: string) => H.startOf(entry(id), after) === null),
    `every tabled day returns nothing for ${after} rather than a wrong date (${tabledIds.length} of them)`);
  // A span that STARTS inside the table can legitimately run past the year boundary - Ramadan
  // 2031 begins on 15 December and runs thirty days, so the first half of January 2032 is
  // still Ramadan and should be. What must be true is that nothing STARTS after the table.
  const spill: string[] = [];
  const started: string[] = [];
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 28; d++) {
      const hit = App.holidayFor(D(after, m, d));
      if (!hit || tabledIds.indexOf(hit.id) === -1) continue;
      const startsThisYear = H.startOf(entry(hit.id), after) !== null;
      (startsThisYear ? started : spill).push(`${m}/${d} ${hit.name}`);
    }
  }
  check(started.length === 0,
    `no tabled occasion STARTS in ${after}${started.length ? " \u2014 " + started.slice(0, 3).join(", ") : ""}`);
  check(spill.length > 0 && spill.every((x) => /Ramadan/.test(x)),
    `\u2026and the only ${after} days still special are the tail of a span that began inside the table (${spill.length} days of Ramadan, from 15 Dec ${H.TABLE_LAST_YEAR})`);
  check(App.holidayMark(D(after, 4, 5)) === ORDINARY && App.holidayMark(D(H.TABLE_LAST_YEAR + 20, 4, 5)) === ORDINARY,
    "THE ORDINARY MARK RENDERS, one year and twenty years after the table ends \u2014 nothing breaks, ever");
  check(!!App.holidayFor(D(after, 12, 25)),
    "\u2026while the fixed and rule days carry on working, so only the tabled ones lapse");

  // ---------- (5) an ordinary day ----------
  console.log("\n(5) an ordinary day:");
  check(App.holidayMark(D(2026, 6, 10)) === ORDINARY, "10 June 2026 renders exactly the mark it renders today");
  check(App.holidayFor(D(2026, 6, 10)) === null, "\u2026and reports no occasion at all");

  // ---------- (6) the fallback ----------
  console.log("\n(6) when something is wrong:");
  check(App.holidayMark(new Date("nonsense")) === ORDINARY, "a bad Date falls back to the ordinary mark");
  check(App.holidayMark(null) === ORDINARY && App.holidayMark("a string") === ORDINARY, "\u2026so do null and a string");
  const sabotage = boot();
  sabotage.holiday.REGISTRY.push({ id: "malformed", name: null, kind: "fixed", month: 99, day: 99, glyph: "nope", priority: 9999 });
  check(sabotage.holidayMark(D(2026, 6, 10)) === ORDINARY, "a MALFORMED registry entry cannot produce a mark");
  const missing = boot();
  missing.holiday.REGISTRY.push({ id: "noglyph", name: "No Glyph Day", kind: "fixed", month: 6, day: 10, glyph: "does_not_exist", priority: 9999 });
  check(missing.holidayMark(D(2026, 6, 10)) === ORDINARY, "a registry entry naming a MISSING GLYPH renders the ordinary mark, not an empty box");
  const thrower = boot();
  thrower.holiday.REGISTRY.push({ id: "boom", name: "Boom", kind: "fixed", get month(): number { throw new Error("boom"); }, day: 1, glyph: "christmas", priority: 9999 });
  check(thrower.holidayMark(D(2026, 6, 10)) === ORDINARY, "an entry that THROWS is caught and the ordinary mark renders");
  // NEGATIVE: prove those checks are not passing simply because nothing ever renders artwork
  check(boot().holidayMark(D(2026, 12, 25)) !== ORDINARY,
    "NEGATIVE: on a real covered day the mark IS different \u2014 so the five checks above mean something");

  // ---------- (7) every glyph is real ----------
  console.log("\n(7) the artwork:");
  const glyphKeys = Object.keys(H.GLYPHS);
  const broken = glyphKeys.filter((k) => {
    const svg = new JSDOM(`<body>${H.GLYPHS[k]}</body>`).window.document.querySelector("svg");
    return !svg || svg.getAttribute("viewBox") !== "0 0 24 24" || svg.querySelectorAll("path,circle,ellipse").length === 0;
  });
  check(broken.length === 0, `all ${glyphKeys.length} glyphs parse as real SVG on the house viewBox${broken.length ? " \u2014 broken: " + broken.join(", ") : ""}`);
  const coloured = glyphKeys.filter((k) => /stroke="(?!currentColor)|fill="(?!none)/.test(H.GLYPHS[k]));
  check(coloured.length === 0, "\u2026and none carries a fixed colour, so all eighteen themes are covered");
  const unresolved = H.REGISTRY.filter((e: any) => !H.GLYPHS[e.glyph]).map((e: any) => e.id);
  check(unresolved.length === 0, `every registry entry resolves to a glyph${unresolved.length ? " \u2014 missing: " + unresolved.join(", ") : ""}`);

  // ---------- (8) two occasions on one date ----------
  console.log("\n(8) when two land on the same day:");
  const clashDate = D(2026, 2, 17);   // Lunar New Year AND day one of Ramadan
  const lny = H.startOf(entry("lunar_new_year"), 2026);
  const ram = H.startOf(entry("ramadan"), 2026);
  check(fmt(lny) === fmt(ram), `17 Feb 2026 really is both Lunar New Year and day one of Ramadan (${fmt(lny)})`);
  const won = App.holidayFor(clashDate);
  check(won && won.id === "lunar_new_year", `\u2026and the HIGHER PRIORITY wins: ${won ? won.name : "nothing"}`);
  check(entry("lunar_new_year").priority > entry("ramadan").priority, "\u2026which is stated in the registry, not an accident of ordering");
  check(App.holidayFor(D(2026, 3, 8)).id === "ramadan", "\u2026and Ramadan still shows across the rest of its span");

  // ---------- (9) it cannot cost anything ----------
  console.log("\n(9) no network, no dependency:");
  check(!/fetch\(|XMLHttpRequest|WebSocket|EventSource|import\s+|require\(|https?:\/\//.test(SRC),
    "the file names no fetch, no XHR, no socket, no import, no require and no URL");
  const netWin: any = new JSDOM("<body></body>", { runScripts: "outside-only" }).window;
  const netCalls: string[] = [];
  netWin.App = { brandCSvg: ORDINARY };
  netWin.fetch = (u: any) => { netCalls.push(String(u)); return Promise.resolve({}); };
  netWin.XMLHttpRequest = function () { netCalls.push("xhr"); } as any;
  new Function("window", "App", SRC)(netWin, netWin.App);
  for (let m = 1; m <= 12; m++) netWin.App.holidayMark(D(2026, m, 1));
  check(netCalls.length === 0, `loading the file and asking it twelve times makes NOT ONE request (${netCalls.length})`);

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exit(1); }
  console.log("ALL PASSED \u2705 (eighteen days drawn, and the search bar never notices)");
  process.exit(0);
}

main().catch((e: any) => {
  console.error("threw:", e);
  process.exit(1);
});

export {};
