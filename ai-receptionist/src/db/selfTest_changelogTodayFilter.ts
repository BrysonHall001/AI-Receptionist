// Pure (DB-free) self-test for the Change Log "today" date filter fix (Task 2).
//
// The bug: the client-side date filter compared a raw UTC instant against a LOCAL
// day window, so a Change Log row stored at UTC midnight (which is what "today"
// entries are) fell into the PREVIOUS local day for anyone west of UTC — and
// "today" returned 0 rows even though the row was displayed as today.
//
// This loads the REAL public/js/table.js filter (App.table.evalRule) in a sandbox
// and proves a row the user sees as "today" now matches the "today" filter, on the
// same calendar-day basis the table displays. Timezone-robust: both sides are built
// from the same local Y-M-D digits, so it passes in any timezone.
//
//   npx tsx src/db/selfTest_changelogTodayFilter.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";

let fails = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) fails++; }
const pad = (n: number) => String(n).padStart(2, "0");

// Load the browser table.js exactly as the app does; it attaches App to the sandbox global.
const src = readFileSync(resolve(__dirname, "../../public/js/table.js"), "utf8");
const sandbox: any = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const evalRule: (row: any, rule: any, cols: any[]) => boolean = sandbox.App.table.evalRule;

// A Change-Log-style date column: displayed via a whole-day (UTC) formatter.
const cols = [{ key: "date", label: "Date", type: "date", get: (r: any) => r.date, text: (r: any) => r.date }];

const now = new Date();
const todayYMD = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const yest = new Date(now); yest.setDate(now.getDate() - 1);
const yestYMD = `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`;

// How the Change Log actually stores "today": a calendar date at UTC midnight.
const todayRow = { date: `${todayYMD}T00:00:00.000Z` };
const yestRow = { date: `${yestYMD}T00:00:00.000Z` };

console.log("Change Log 'today' filter (pure)\n================================");
check(evalRule(todayRow, { field: "date", op: "today" }, cols) === true,
  "a UTC-midnight row dated today matches 'today' (the bug: this was false)");
check(evalRule(yestRow, { field: "date", op: "today" }, cols) === false,
  "a UTC-midnight row dated yesterday does NOT match 'today'");
check(evalRule({ date: todayYMD }, { field: "date", op: "today" }, cols) === true,
  "a bare YYYY-MM-DD row dated today matches 'today'");

// Ranges compare on the same calendar-day basis.
check(evalRule(todayRow, { field: "date", op: "between", value: todayYMD, value2: todayYMD }, cols) === true,
  "'between today and today' includes today's row");
check(evalRule(yestRow, { field: "date", op: "between", value: todayYMD, value2: todayYMD }, cols) === false,
  "'between today and today' excludes yesterday's row");
check(evalRule(todayRow, { field: "date", op: "previous", value: 1, unit: "days" }, cols) === true,
  "'in the previous 1 day' includes today's row");

// A time-of-day value (local-display columns) still matches today's date — unchanged.
check(evalRule({ date: new Date().toISOString() }, { field: "date", op: "today" }, cols) === true,
  "a real timestamp from today still matches 'today' (local-display columns unaffected)");

console.log(`\n${fails === 0 ? "ALL PASSED \u2705" : fails + " FAILED \u274c"} (changelog today filter)`);
process.exit(fails ? 1 : 0);
