// Pure (DB-free) test: audience-membership condition ops evaluate through the SAME evalRules used by
// every other condition.  npx tsx src/db/selfTest_audienceConditionPure.ts
import { evalRules, ruleComplete, type Column, type Rule } from "../automation/conditions";

let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }

// A synthetic audience column, exactly like buildColumns produces for "__audience".
const audCol: Column = { key: "__audience", type: "audience", get: (row: any) => (Array.isArray(row.__audienceIds) ? row.__audienceIds : []) };
const cols = [audCol];

const inA: Rule[] = [{ field: "__audience", op: "in_audience", value: "A" }];
const notInA: Rule[] = [{ field: "__audience", op: "not_in_audience", value: "A" }];

const member = { id: "1", __audienceIds: ["A", "B"] };
const nonMember = { id: "2", __audienceIds: ["B"] };
const noneAttached = { id: "3" }; // membership not resolved

console.log("audience condition (pure)\n=========================");
check(evalRules(member, inA, cols) === true, "in_audience: a member matches");
check(evalRules(nonMember, inA, cols) === false, "in_audience: a non-member does not match");
check(evalRules(member, notInA, cols) === false, "not_in_audience: a member does not match");
check(evalRules(nonMember, notInA, cols) === true, "not_in_audience: a non-member matches");
check(evalRules(noneAttached, inA, cols) === false, "in_audience: unknown membership -> no match (safe)");
check(evalRules(noneAttached, notInA, cols) === true, "not_in_audience: unknown membership -> match");

check(ruleComplete({ field: "__audience", op: "in_audience", value: "A" }), "a rule with a chosen audience is complete");
check(!ruleComplete({ field: "__audience", op: "in_audience", value: "" }), "a rule with no audience chosen is incomplete");

// AND-composition with a normal field condition still works (mixed conditions).
const nameCol: Column = { key: "name", type: "text", get: (r: any) => r.name, text: (r: any) => r.name };
const mixed: Rule[] = [{ field: "name", op: "contains", value: "VIP", conj: "AND" }, { field: "__audience", op: "in_audience", value: "A", conj: "AND" }];
check(evalRules({ id: "9", name: "VIP Zoe", __audienceIds: ["A"] }, mixed, [nameCol, audCol]) === true, "mixed AND (name + audience) matches when both hold");
check(evalRules({ id: "10", name: "VIP Rob", __audienceIds: ["B"] }, mixed, [nameCol, audCol]) === false, "mixed AND fails when audience part fails");

console.log(`\n${fails === 0 ? "ALL PASSED \u2705" : fails + " FAILED \u274c"} (audience condition pure)`);
process.exit(fails ? 1 : 0);
