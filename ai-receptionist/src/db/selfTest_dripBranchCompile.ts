// Pure (DB-free) branch-compile self-test: linear vs branched compile, if/else pair shape,
// condition negation, and branch validation guards.  npx tsx src/db/selfTest_dripBranchCompile.ts
import { compileDrip } from "../services/dripCompiler";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: any) { if (cond) { pass++; console.log("  ok  -", name); } else { fail++; console.log("  FAIL-", name, extra !== undefined ? JSON.stringify(extra) : ""); } }

// ---- helpers ----
const trigCond = (id = "t") => ({ id, type: "enroll_condition", x: 0, y: 0, config: { rules: [{ field: "stage", op: "is", value: "lead" }] } });
const trigAud = (id = "t") => ({ id, type: "enroll_audience", x: 0, y: 0, config: { audienceIds: ["a1"] } });
const wait = (id: string) => ({ id, type: "wait", x: 0, y: 0, config: { amount: 2, unit: "days" } });
const email = (id: string, subj = "Hi") => ({ id, type: "send_email", x: 0, y: 0, config: { mode: "scratch", subject: subj, html: "<p>x</p>" } });
const branch = (id: string) => ({ id, type: "branch", x: 0, y: 0, config: { rules: [{ field: "vip", op: "is", value: "yes" }] } });

// ---- 1. LINEAR compiles to a single automation ----
let r = compileDrip({ nodes: [trigCond("t"), wait("w"), email("e")], edges: [{ source: "t", target: "w" }, { source: "w", target: "e" }] });
ok("linear ok", r.ok, r.errors);
ok("linear kind=linear", r.kind === "linear");
ok("linear has 1 automation, 2 actions", !!r.automation && r.automation.actions.length === 2, r.automation && r.automation.actions.map(a => a.type));
ok("linear conditions from trigger", r.automation!.conditions.length === 1);
ok("linear no ifDef/elseDef", !r.ifDef && !r.elseDef);

// ---- 2. BRANCHED compiles to if/else pair ----
r = compileDrip({ nodes: [trigCond("t"), wait("w"), branch("b"), email("ei", "Yes"), email("eo", "No")],
  edges: [{ source: "t", target: "w" }, { source: "w", target: "b" }, { source: "b", target: "ei", branch: "if" }, { source: "b", target: "eo", branch: "otherwise" }] });
ok("branched ok", r.ok, r.errors);
ok("branched kind=branched", r.kind === "branched");
ok("branched has ifDef + elseDef", !!r.ifDef && !!r.elseDef);
// trunk (wait) replayed in BOTH paths
ok("ifDef trunk+ifpath actions [wait,email]", r.ifDef!.actions.map(a => a.type).join(",") === "wait,send_email", r.ifDef!.actions.map(a=>a.type));
ok("elseDef trunk+elsepath actions [wait,email]", r.elseDef!.actions.map(a => a.type).join(",") === "wait,send_email", r.elseDef!.actions.map(a=>a.type));
ok("ifDef email subject = Yes", r.ifDef!.actions[1].config.subject === "Yes");
ok("elseDef email subject = No", r.elseDef!.actions[1].config.subject === "No");
// conditions: base + branch cond on if; base + NEGATED branch on else
ok("ifDef conditions = base + branch (2)", r.ifDef!.conditions.length === 2, r.ifDef!.conditions);
ok("ifDef branch cond op=is", r.ifDef!.conditions[1].op === "is");
ok("elseDef conditions = base + negated (2)", r.elseDef!.conditions.length === 2);
ok("elseDef branch cond NEGATED op=is_not", r.elseDef!.conditions[1].op === "is_not", r.elseDef!.conditions[1]);
ok("elseDef same field/value as if", r.elseDef!.conditions[1].field === "vip" && r.elseDef!.conditions[1].value === "yes");

// ---- 3. Branch with an EMPTY otherwise path (allowed = do nothing) ----
r = compileDrip({ nodes: [trigAud("t"), branch("b"), email("ei", "Yes")],
  edges: [{ source: "t", target: "b" }, { source: "b", target: "ei", branch: "if" }] });
ok("branch with empty otherwise ok", r.ok, r.errors);
ok("empty otherwise -> elseDef has trunk only (0 actions)", r.ok && r.elseDef!.actions.length === 0, r.ok ? r.elseDef!.actions : null);

// ---- 4. Validation failures ----
r = compileDrip({ nodes: [trigCond("t"), { id: "b", type: "branch", x: 0, y: 0, config: { rules: [] } }],
  edges: [{ source: "t", target: "b" }] });
ok("incomplete branch condition -> error", !r.ok && r.errors.some(e => /branch condition/i.test(e.message)), r.errors);

// non-negatable op on branch
r = compileDrip({ nodes: [trigCond("t"), { id: "b", type: "branch", x: 0, y: 0, config: { rules: [{ field: "age", op: "gt", value: "5" }] } }, email("ei")],
  edges: [{ source: "t", target: "b" }, { source: "b", target: "ei", branch: "if" }] });
ok("non-negatable branch op -> error", !r.ok && r.errors.some(e => /yes\/no style/i.test(e.message)), r.errors);

// non-branch node with 2 outgoing -> error
r = compileDrip({ nodes: [trigCond("t"), wait("w"), email("e1"), email("e2")],
  edges: [{ source: "t", target: "w" }, { source: "w", target: "e1" }, { source: "w", target: "e2" }] });
ok("non-branch two outgoing -> error", !r.ok && r.errors.some(e => /branches to more than one|Only one outgoing/i.test(e.message)), r.errors);

// branch missing a labeled handle is fine (empty path); but both edges same label -> error
r = compileDrip({ nodes: [trigCond("t"), branch("b"), email("e1"), email("e2")],
  edges: [{ source: "t", target: "b" }, { source: "b", target: "e1", branch: "if" }, { source: "b", target: "e2", branch: "if" }] });
ok("two 'if' edges -> error", !r.ok && r.errors.some(e => /only one .*if/i.test(e.message)), r.errors);

// orphan node -> error
r = compileDrip({ nodes: [trigCond("t"), wait("w"), email("orphan")],
  edges: [{ source: "t", target: "w" }] });
ok("orphan node -> error", !r.ok && r.errors.some(e => /isn't connected/i.test(e.message)), r.errors);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
