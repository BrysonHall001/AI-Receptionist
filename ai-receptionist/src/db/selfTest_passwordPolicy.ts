// Pure (DB-free) self-test for the shared USER password policy (Task 1).
// Proves the ONE policy function enforced at invite-accept / reset / self-change
// rejects obvious weak passwords and accepts a compliant one.
//
//   npx tsx src/db/selfTest_passwordPolicy.ts
import { checkPassword, PASSWORD_MIN_LENGTH } from "../auth/passwords";

let fails = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) fails++; }
const rejected = (pw: string, opts?: { email?: string }) => checkPassword(pw, opts).ok === false;
const accepted = (pw: string, opts?: { email?: string }) => checkPassword(pw, opts).ok === true;

console.log("Password policy (pure)\n======================");

// The two the task calls out explicitly:
check(rejected("12345678"), "'12345678' is REJECTED (too short + one category)");
check(rejected("password"), "'password' is REJECTED (too short + blocklisted)");

// A compliant password is ACCEPTED.
check(accepted("Sunset-River-42"), "'Sunset-River-42' is ACCEPTED (10+ chars, mixed categories)");

// Additional policy corners.
check(PASSWORD_MIN_LENGTH === 10, "minimum length is 10");
check(rejected("short1A"), "under 10 chars is rejected");
check(rejected("aaaaaaaaaa"), "all-same-char (one category) is rejected");
check(rejected("1234567890"), "all-digit 10 chars (one category) is rejected");
check(rejected("Password123"), "contains blocklisted 'password' -> rejected");
check(rejected("changeme999"), "placeholder-ish 'changeme…' -> rejected");
check(rejected("jsmith-secure", { email: "jsmith@acme.co" }), "contains the email local-part -> rejected");
check(accepted("Tr0ubadour&3"), "another strong password is accepted");
check(accepted("correct horse 9!"), "passphrase with spaces + digit + symbol is accepted");

console.log(`\n${fails === 0 ? "ALL PASSED \u2705" : fails + " FAILED \u274c"} (password policy)`);
process.exit(fails ? 1 : 0);
