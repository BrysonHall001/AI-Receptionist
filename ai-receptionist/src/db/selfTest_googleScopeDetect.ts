// PURE test for write-scope detection (Sub-batch E). No DB, no Google.
//   npx tsx src/db/selfTest_googleScopeDetect.ts
// Proves scopeHasWrite() distinguishes readonly-only (re-consent needed) from a
// connection that has events write (F can push), both ways.

import { scopeHasWrite, GOOGLE_SCOPES, GOOGLE_WRITE_SCOPE } from "../services/googleClient";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

const RO = "https://www.googleapis.com/auth/calendar.readonly";
const EV = "https://www.googleapis.com/auth/calendar.events";
const FULL = "https://www.googleapis.com/auth/calendar";

console.log("Write-scope detection — pure test");
console.log("=================================\n");

console.log("(1) readonly-only => write NOT granted (must re-consent):");
check(scopeHasWrite(RO) === false, "readonly alone -> false");
check(scopeHasWrite("") === false, "empty -> false");
check(scopeHasWrite(null) === false, "null -> false");
check(scopeHasWrite(undefined) === false, "undefined -> false");
check(scopeHasWrite("openid email " + RO) === false, "readonly + unrelated scopes -> false");

console.log("\n(2) events (or full) scope => write granted:");
check(scopeHasWrite(EV) === true, "events alone -> true");
check(scopeHasWrite(`${RO} ${EV}`) === true, "readonly + events -> true");
check(scopeHasWrite(`openid ${EV} email`) === true, "events among others -> true");
check(scopeHasWrite(FULL) === true, "full calendar scope -> true");

console.log("\n(3) near-misses don't false-positive:");
check(scopeHasWrite("https://www.googleapis.com/auth/calendar.events.readonly") === false, "events.readonly is NOT write");
check(scopeHasWrite("https://www.googleapis.com/auth/calendar.settings.readonly") === false, "settings.readonly is NOT write");

console.log("\n(4) the requested scope set matches what detection expects:");
check(GOOGLE_SCOPES.includes(GOOGLE_WRITE_SCOPE), "GOOGLE_SCOPES includes the write scope");
check(scopeHasWrite(GOOGLE_SCOPES.join(" ")) === true, "a fresh consent of GOOGLE_SCOPES => write granted");

console.log("\n=================================");
if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
process.exit(failures.length === 0 ? 0 : 1);
