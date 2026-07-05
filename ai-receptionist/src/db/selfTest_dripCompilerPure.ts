// Pure (DB-free) self-test for the drip compiler — validation + compile shape + action ordering.
// Runs anywhere (no Prisma engine needed).  npx tsx src/db/selfTest_dripCompilerPure.ts
import { compileDrip } from "../services/dripCompiler";

let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const N = (id: string, type: string, config: any = {}) => ({ id, type, x: 0, y: 0, config });
function linear(nodes: any[]) { const edges = []; for (let i = 0; i < nodes.length - 1; i++) edges.push({ source: nodes[i].id, target: nodes[i + 1].id }); return { nodes, edges }; }

console.log("drip compiler (pure)\n====================");
const vip = { field: "name", op: "contains", value: "VIP", conj: "AND" };

// valid chain
const good = compileDrip(linear([
  N("t", "enroll_condition", { rules: [vip] }),
  N("w", "wait", { amount: 2, unit: "days" }),
  N("e", "send_email", { mode: "scratch", subject: "Hi", html: "<p>hello</p>" }),
  N("s", "send_survey", { mode: "existing", surveyId: "sv1", subject: "S", html: "<p>{{survey_link}}</p>" }),
  N("u", "unenroll", {}),
]));
check(good.ok, "complete linear drip validates");
check(good.automation!.triggerType === "Manual", "triggerType = Manual");
check(JSON.stringify(good.automation!.conditions) === JSON.stringify([vip]), "conditions from trigger rules");
check(good.automation!.actions.map((a) => a.type).join(",") === "wait,send_email,send_survey,unenroll", "ordered actions follow the chain");
check(good.automation!.actions[0].config.amount === 2, "wait carries duration");
check(good.automation!.actions[1].config.subject === "Hi", "email carries subject");
check(good.automation!.actions[2].config.surveyId === "sv1", "survey carries surveyId");

// identical to hand-authored
const hand = { triggerType: "Manual", conditions: [vip], actions: [
  { type: "wait", config: { amount: 2, unit: "days" } },
  { type: "send_email", config: { subject: "Hi", html: "<p>hello</p>" } },
  { type: "send_survey", config: { surveyId: "sv1", subject: "S", html: "<p>{{survey_link}}</p>" } },
  { type: "unenroll", config: {} },
] };
const stripped = { triggerType: good.automation!.triggerType, conditions: good.automation!.conditions, actions: good.automation!.actions.map((a) => ({ type: a.type, config: a.config })) };
check(JSON.stringify(stripped) === JSON.stringify(hand), "compiled shape == hand-authored automation");

// audience trigger -> empty conditions
const aud = compileDrip(linear([N("t", "enroll_audience", { audienceIds: ["a1"] }), N("e", "send_email", { mode: "scratch", subject: "x", html: "<p>y</p>" })]));
check(aud.ok && JSON.stringify(aud.automation!.conditions) === "[]", "enroll_audience -> conditions []");

// invalid cases
check(!compileDrip(linear([N("w", "wait", { amount: 1, unit: "days" })])).ok, "no trigger -> invalid");
check(!compileDrip(linear([N("t1", "enroll_audience", { audienceIds: ["a"] }), N("t2", "enroll_condition", { rules: [vip] })])).ok, "two triggers -> invalid");
check(compileDrip({ nodes: [N("t", "enroll_audience", { audienceIds: ["a"] }), N("w", "wait", { amount: 1, unit: "days" })], edges: [] }).errors.some((e) => /isn.t connected/.test(e.message)), "orphan -> 'isn't connected'");
check(compileDrip({ nodes: [N("t", "enroll_audience", { audienceIds: ["a"] }), N("a", "wait", { amount: 1, unit: "days" }), N("b", "wait", { amount: 1, unit: "days" })], edges: [{ source: "t", target: "a" }, { source: "t", target: "b" }] }).errors.some((e) => /branch/.test(e.message)), "2 outgoing -> branching error");
check(!compileDrip({ nodes: [N("t", "enroll_audience", { audienceIds: ["a"] }), N("a", "wait", { amount: 1, unit: "days" })], edges: [{ source: "t", target: "a" }, { source: "a", target: "t" }] }).ok, "cycle -> invalid");
check(compileDrip(linear([N("t", "enroll_audience", { audienceIds: [] })])).errors.some((e) => /audience/.test(e.message)), "no audience -> error");
check(compileDrip(linear([N("t", "enroll_audience", { audienceIds: ["a"] }), N("w", "wait", { amount: 0, unit: "days" })])).errors.some((e) => /duration/.test(e.message)), "0 wait -> duration error");
check(compileDrip(linear([N("t", "enroll_audience", { audienceIds: ["a"] }), N("e", "send_email", { mode: "scratch", subject: "", html: "" })])).errors.some((e) => /subject and message/.test(e.message)), "empty email -> content error");
check(compileDrip(linear([N("t", "enroll_audience", { audienceIds: ["a"] }), N("sv", "send_survey", { mode: "existing", surveyId: "", subject: "s" })])).errors.some((e) => /survey/.test(e.message)), "no survey -> error");
check(compileDrip(linear([N("t", "enroll_audience", { audienceIds: ["a"] }), N("en", "enroll", { audienceIds: ["a"] })])).errors.some((e) => /starting step/.test(e.message)), "mid-flow enroll -> not supported");
check(compileDrip({ nodes: [], edges: [] }).errors.some((e) => /empty/.test(e.message)), "empty graph -> friendly error");

console.log("\n====================");
console.log(fails === 0 ? "ALL PASSED \u2705  (drip compiler pure)" : `${fails} FAILED \u274c`);
process.exit(fails === 0 ? 0 : 1);
