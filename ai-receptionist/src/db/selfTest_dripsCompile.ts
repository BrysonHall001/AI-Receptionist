// Self-test: Drips slice 2 — compiler validation, compile->Automation shape, activate/edit/delete
// orchestration (no duplicate automations), and running the compiled automation through the EXISTING
// engine.  npx tsx src/db/selfTest_dripsCompile.ts   (email mocked)
import { prisma, disconnectDb } from "./client";
import { compileDrip } from "../services/dripCompiler";
import { createDrip, getDrip, updateDrip, deleteDrip, setDripEnabled, validateDrip } from "../services/dripService";
import { getAutomation } from "../services/automationService";
import { applyFlowDefinition } from "../services/flowProvisioningService";
import { runManualAutomation } from "../automation/engine";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }

// Build a linear graph: trigger -> a -> b -> ... with edges.
function linear(nodes: any[]) {
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ source: nodes[i].id, target: nodes[i + 1].id });
  return { nodes, edges };
}
const N = (id: string, type: string, config: any = {}, x = 0, y = 0) => ({ id, type, x, y, config });

async function main() {
  console.log("drips compile\n=============");
  const tenants: string[] = [];
  try {
    // ---------- Pure compiler ----------
    console.log("validation:");
    const vipRule = { field: "name", op: "contains", value: "VIP", conj: "AND" };
    const goodNodes = [
      N("t", "enroll_condition", { rules: [vipRule] }),
      N("w", "wait", { amount: 2, unit: "days" }),
      N("e", "send_email", { mode: "scratch", subject: "Hi", html: "<p>hello</p>" }),
      N("s", "send_survey", { mode: "existing", surveyId: "sv1", subject: "Survey", html: "<p>{{survey_link}}</p>" }),
      N("u", "unenroll", {}),
    ];
    const good = compileDrip(linear(goodNodes));
    check(good.ok, "a complete linear drip validates");
    check(good.automation!.triggerType === "Manual", "triggerType = Manual (drips are enrolled)");
    check(JSON.stringify(good.automation!.conditions) === JSON.stringify([vipRule]), "conditions come from the trigger's rules");
    check(good.automation!.actions.map((a) => a.type).join(",") === "wait,send_email,send_survey,unenroll", "ordered actions match the chain (trigger excluded)");
    check(good.automation!.actions[0].config.amount === 2 && good.automation!.actions[0].config.unit === "days", "wait action carries duration");
    check(good.automation!.actions[1].config.subject === "Hi" && /hello/.test(good.automation!.actions[1].config.html), "email action carries content");

    check(!compileDrip(linear([N("w", "wait", { amount: 1, unit: "days" })])).ok, "no trigger -> invalid");
    check(!compileDrip(linear([N("t1", "enroll_audience", { audienceIds: ["a"] }), N("t2", "enroll_condition", { rules: [vipRule] })])).ok, "two triggers -> invalid");
    const orphan = { nodes: [N("t", "enroll_audience", { audienceIds: ["a"] }), N("w", "wait", { amount: 1, unit: "days" })], edges: [] };
    const orphanRes = compileDrip(orphan);
    check(!orphanRes.ok && orphanRes.errors.some((e) => /isn.t connected/.test(e.message)), "orphan node -> 'isn't connected' error");
    const branch = { nodes: [N("t", "enroll_audience", { audienceIds: ["a"] }), N("a", "wait", { amount: 1, unit: "days" }), N("b", "wait", { amount: 1, unit: "days" })], edges: [{ source: "t", target: "a" }, { source: "t", target: "b" }] };
    check(!compileDrip(branch).ok && compileDrip(branch).errors.some((e) => /branch/.test(e.message)), "2nd outgoing edge -> branching error");
    const cycle = { nodes: [N("t", "enroll_audience", { audienceIds: ["a"] }), N("a", "wait", { amount: 1, unit: "days" })], edges: [{ source: "t", target: "a" }, { source: "a", target: "t" }] };
    check(!compileDrip(cycle).ok, "cycle -> invalid");
    check(!compileDrip(linear([N("t", "enroll_audience", { audienceIds: [] })])).ok, "enroll_audience with no audience -> invalid");
    check(compileDrip(linear([N("t", "enroll_audience", { audienceIds: ["a"] }), N("w", "wait", { amount: 0, unit: "days" })])).errors.some((e) => /duration/.test(e.message)), "wait with 0 duration -> 'set a wait duration'");
    check(compileDrip(linear([N("t", "enroll_audience", { audienceIds: ["a"] }), N("e", "send_email", { mode: "scratch", subject: "", html: "" })])).errors.some((e) => /subject and message/.test(e.message)), "send_email empty -> content error");
    check(compileDrip(linear([N("t", "enroll_audience", { audienceIds: ["a"] }), N("en", "enroll", { audienceIds: ["a"] })])).errors.some((e) => /starting step/.test(e.message)), "'enroll' as a mid-flow step -> not supported error");

    console.log("\ncompiled shape equals a normally-authored automation:");
    const handAuthored = { triggerType: "Manual", conditions: [vipRule], actions: [
      { type: "wait", config: { amount: 2, unit: "days" } },
      { type: "send_email", config: { subject: "Hi", html: "<p>hello</p>" } },
      { type: "send_survey", config: { surveyId: "sv1", subject: "Survey", html: "<p>{{survey_link}}</p>" } },
      { type: "unenroll", config: {} },
    ] };
    const compiledNoIds = { triggerType: good.automation!.triggerType, conditions: good.automation!.conditions, actions: good.automation!.actions.map((a) => ({ type: a.type, config: a.config })) };
    check(JSON.stringify(compiledNoIds) === JSON.stringify(handAuthored), "compiled {triggerType,conditions,actions} == hand-authored shape");

    // ---------- DB orchestration ----------
    console.log("\nactivate / recompile / deactivate / delete:");
    const t = (await db.tenant.create({ data: { name: "Drip C2", billingStatus: "paid", notifyEmail: "ops@test.local" } })).id; tenants.push(t);
    const survey = await db.survey.create({ data: { tenantId: t, name: "S", status: "active", publicId: "p" + Date.now(), mapTargetType: "contact" } });
    const graph = linear([
      N("t", "enroll_condition", { rules: [vipRule] }),
      N("e", "send_email", { mode: "scratch", subject: "Welcome", html: "<p>hi</p>" }),
    ]);
    const drip = await createDrip({ tenantId: t, name: "My Drip", graph, createdById: null });
    const act = await setDripEnabled(drip.id, t, true, null);
    check(!!act && act.ok && act.drip.enabled && !!act.drip.automationId, "activate compiles + links + enables an automation");
    const autoId = act!.drip.automationId!;
    const auto = await getAutomation(autoId, t);
    check(!!auto && auto.enabled && auto.triggerType === "Manual", "linked automation is enabled, triggerType Manual");
    const cond0 = (auto!.conditions as any[])[0] || {};
    check((auto!.conditions as any[]).length === 1 && cond0.field === vipRule.field && cond0.op === vipRule.op && cond0.value === vipRule.value && cond0.conj === vipRule.conj, "linked automation conditions match");
    check((auto!.actions as any[]).length === 1 && (auto!.actions as any[])[0].type === "send_email", "linked automation has the send_email action");
    check(auto!.name === "My Drip", "automation name synced to drip name");

    // edit the active drip -> recompile, SAME automation (no duplicate)
    const graph2 = linear([
      N("t", "enroll_condition", { rules: [vipRule] }),
      N("w", "wait", { amount: 3, unit: "hours" }),
      N("e", "send_email", { mode: "scratch", subject: "Welcome2", html: "<p>hi2</p>" }),
    ]);
    await updateDrip(drip.id, t, { graph: graph2 }, null);
    const autosNow = await db.automation.findMany({ where: { tenantId: t } });
    check(autosNow.length === 1 && autosNow[0].id === autoId, "editing an active drip reuses the SAME automation (no duplicate)");
    const auto2 = await getAutomation(autoId, t);
    check((auto2!.actions as any[]).map((a: any) => a.type).join(",") === "wait,send_email", "recompiled automation reflects the new steps (wait,send_email)");

    // deactivate
    const de = await setDripEnabled(drip.id, t, false, null);
    check(!!de && !de.drip.enabled, "deactivate turns the drip off");
    check(!(await getAutomation(autoId, t))!.enabled, "linked automation is disabled");

    // invalid activate
    const badDrip = await createDrip({ tenantId: t, name: "Bad", graph: linear([N("t", "enroll_audience", { audienceIds: [] })]), createdById: null });
    const badAct = await setDripEnabled(badDrip.id, t, true, null);
    check(!!badAct && !badAct.ok && badAct.errors.length > 0, "activating an invalid drip fails with errors");
    check(!badAct!.drip.enabled, "invalid drip stays off");
    const vBad = await validateDrip(badDrip.id, t);
    check(!!vBad && !vBad.ok, "validateDrip reports invalid without changing state");

    // ---------- run through the existing engine ----------
    console.log("\nruns through the existing engine (mocked email):");
    // Re-activate the simple drip (send_email inline) and run it for a matching contact.
    await updateDrip(drip.id, t, { graph }, null); // back to trigger->send_email
    await setDripEnabled(drip.id, t, true, null);
    const runAutoId = (await getDrip(drip.id, t))!.automationId!;
    const vip = await db.contact.create({ data: { tenantId: t, name: "VIP Zoe", email: "zoe@x.test", phone: "+15550000111", source: "test" } });
    const nonvip = await db.contact.create({ data: { tenantId: t, name: "Reg Rob", email: "rob@x.test", phone: "+15550000112", source: "test" } });
    await runManualAutomation(runAutoId, vip.id, t);
    await runManualAutomation(runAutoId, nonvip.id, t);
    const runsVip = await db.automationRun.findMany({ where: { tenantId: t, contactId: vip.id } });
    const runsNon = await db.automationRun.findMany({ where: { tenantId: t, contactId: nonvip.id } });
    check(runsVip.some((r: any) => r.status === "success"), "matching contact: the compiled drip runs its ordered actions (success)");
    check(runsNon.every((r: any) => r.matched === false || r.status === "skipped"), "non-matching contact: conditions gate it (skipped)");
    const vipRun = runsVip.find((r: any) => r.status === "success");
    const results = (vipRun && Array.isArray(vipRun.results)) ? vipRun.results : [];
    check(results.some((x: any) => x.type === "send_email" && x.status === "success"), "the send_email action actually fired for the matching contact");

    // delete cleans up the automation
    console.log("\ndelete cleans up:");
    await deleteDrip(drip.id, t);
    check((await getAutomation(runAutoId, t)) === null, "deleting a drip deletes its linked automation");

    // ---------- BRANCHING: compile to a pairId-linked pair via applyFlowDefinition ----------
    console.log("\nbranching -> paired automations (via applyFlowDefinition):");
    const matchRule = { field: "name", op: "contains", value: "Match", conj: "AND" };
    const brGraph = {
      nodes: [
        N("t", "enroll_audience", { audienceIds: ["a1"] }, 40, 40),
        N("b", "branch", { rules: [matchRule] }, 40, 160),
        N("ei", "send_email", { mode: "scratch", subject: "You matched", html: "<p>yes</p>" }, 240, 260),
        N("eo", "send_email", { mode: "scratch", subject: "You did not", html: "<p>no</p>" }, 240, 60),
      ],
      edges: [
        { source: "t", target: "b" },
        { source: "b", target: "ei", branch: "if" },
        { source: "b", target: "eo", branch: "otherwise" },
      ],
    };
    const brDrip = await createDrip({ tenantId: t, name: "Branchy", graph: brGraph, createdById: null });
    const brAct = await setDripEnabled(brDrip.id, t, true, null);
    check(!!brAct && brAct.ok && brAct.drip.enabled, "branched drip activates");
    check(!!brAct!.drip.pairId, "activated branched drip stores a pairId");
    const pair = await db.automation.findMany({ where: { tenantId: t, pairId: brAct!.drip.pairId }, orderBy: { name: "asc" } });
    check(pair.length === 2, "exactly two automations landed, sharing the pairId");
    check(pair.every((a: any) => a.dripId === brDrip.id), "both halves carry dripId back to the drip");
    check(pair.every((a: any) => a.enabled), "both halves enabled on activate");
    const ifAuto = pair.find((a: any) => / \(if\)$/.test(a.name));
    const elseAuto = pair.find((a: any) => / \(otherwise\)$/.test(a.name));
    check(!!ifAuto && !!elseAuto, "halves are named 'Branchy (if)' and 'Branchy (otherwise)'");
    check(brAct!.drip.automationId === ifAuto!.id, "drip.automationId points at the 'if' half");
    // conditions: if = [match], else = [negated match]
    check((ifAuto!.conditions as any[]).length === 1 && (ifAuto!.conditions as any[])[0].op === "contains", "'if' half condition is the branch condition");
    check((elseAuto!.conditions as any[]).length === 1 && (elseAuto!.conditions as any[])[0].op === "not_contains", "'otherwise' half condition is the NEGATED branch condition");
    check((ifAuto!.actions as any[])[0].config.subject === "You matched", "'if' half runs the If-path email");
    check((elseAuto!.actions as any[])[0].config.subject === "You did not", "'otherwise' half runs the Otherwise-path email");

    // shape parity with a wizard-authored pair (build the same defs straight through applyFlowDefinition)
    const compiledBr = compileDrip(brGraph);
    const wpid = "pair_selftest_wizard";
    const wIf = await applyFlowDefinition(t, { name: "Wizardy (if)", triggerType: compiledBr.ifDef!.triggerType, conditions: compiledBr.ifDef!.conditions, actions: compiledBr.ifDef!.actions }, null, { pairId: wpid });
    const wElse = await applyFlowDefinition(t, { name: "Wizardy (otherwise)", triggerType: compiledBr.elseDef!.triggerType, conditions: compiledBr.elseDef!.conditions, actions: compiledBr.elseDef!.actions }, null, { pairId: wpid });
    const shape = (a: any) => JSON.stringify({ triggerType: a.triggerType, conditions: a.conditions, actions: (a.actions as any[]).map((x: any) => ({ type: x.type, config: x.config })) });
    const wIfFull = await getAutomation(wIf.automation.id, t), wElseFull = await getAutomation(wElse.automation.id, t);
    check(shape(ifAuto) === shape(wIfFull), "'if' half shape == wizard-authored 'if' pair member");
    check(shape(elseAuto) === shape(wElseFull), "'otherwise' half shape == wizard-authored 'otherwise' pair member");
    const wPair = await db.automation.findMany({ where: { tenantId: t, pairId: wpid } });
    check(wPair.length === 2 && wPair.every((a: any) => a.pairId === wpid), "wizard pair is itself a pairId-linked 2-member group (same mechanism)");

    // engine: matcher -> If fires, Otherwise skipped; non-matcher -> Otherwise fires, If skipped
    console.log("\nbranching runs through the engine (mocked email):");
    const cMatch = await db.contact.create({ data: { tenantId: t, name: "Match Alice", email: "alice@x.test", phone: "+15550000211", source: "test" } });
    const cNon = await db.contact.create({ data: { tenantId: t, name: "Bob Plain", email: "bob@x.test", phone: "+15550000212", source: "test" } });
    for (const c of [cMatch, cNon]) { await runManualAutomation(ifAuto!.id, c.id, t); await runManualAutomation(elseAuto!.id, c.id, t); }
    const succeededFor = async (autoId: string, contactId: string) => {
      const runs = await db.automationRun.findMany({ where: { tenantId: t, contactId, automationId: autoId } });
      return runs.some((r: any) => r.status === "success" && Array.isArray(r.results) && r.results.some((x: any) => x.type === "send_email" && x.status === "success"));
    };
    const gatedFor = async (autoId: string, contactId: string) => {
      const runs = await db.automationRun.findMany({ where: { tenantId: t, contactId, automationId: autoId } });
      return runs.length === 0 || runs.every((r: any) => r.matched === false || r.status === "skipped");
    };
    check(await succeededFor(ifAuto!.id, cMatch.id), "matcher: the 'If' automation fires (send_email success)");
    check(await gatedFor(elseAuto!.id, cMatch.id), "matcher: the 'Otherwise' automation is gated out");
    check(await succeededFor(elseAuto!.id, cNon.id), "non-matcher: the 'Otherwise' automation fires");
    check(await gatedFor(ifAuto!.id, cNon.id), "non-matcher: the 'If' automation is gated out");

    // edit a branched drip -> recompiles the pair (still 2, still paired, still linked), no orphans
    console.log("\nbranched recompile + transitions:");
    const brGraph2 = JSON.parse(JSON.stringify(brGraph)); brGraph2.nodes[2].config.subject = "Matched v2";
    await updateDrip(brDrip.id, t, { graph: brGraph2 }, null);
    const brNow = await getDrip(brDrip.id, t);
    const pair2 = await db.automation.findMany({ where: { tenantId: t, pairId: brNow!.pairId } });
    check(pair2.length === 2 && brNow!.pairId != null, "editing a branched drip keeps exactly one pair (no duplicates)");
    check(pair2.every((a: any) => a.dripId === brDrip.id), "recompiled pair still linked to the drip");
    const ifAuto2 = pair2.find((a: any) => / \(if\)$/.test(a.name));
    check((ifAuto2!.actions as any[])[0].config.subject === "Matched v2", "recompiled 'if' half reflects the edit");
    const allBranchAutos = await db.automation.findMany({ where: { tenantId: t, dripId: brDrip.id } });
    check(allBranchAutos.length === 2, "no orphaned automations after recompile");

    // transition branched -> linear (remove the branch) -> collapses to ONE automation, pairId cleared
    const linGraph = linear([N("t", "enroll_audience", { audienceIds: ["a1"] }), N("e", "send_email", { mode: "scratch", subject: "Now linear", html: "<p>x</p>" })]);
    await updateDrip(brDrip.id, t, { graph: linGraph }, null);
    const brLin = await getDrip(brDrip.id, t);
    const afterLin = await db.automation.findMany({ where: { tenantId: t, dripId: brDrip.id } });
    check(afterLin.length === 1 && brLin!.pairId == null, "branched -> linear collapses to a single automation, pairId cleared");

    // transition linear -> branched again, then delete removes BOTH halves
    await updateDrip(brDrip.id, t, { graph: brGraph }, null);
    const brAgain = await getDrip(brDrip.id, t);
    check((await db.automation.findMany({ where: { tenantId: t, pairId: brAgain!.pairId } })).length === 2, "linear -> branched re-expands to a pair");
    await deleteDrip(brDrip.id, t);
    check((await db.automation.findMany({ where: { tenantId: t, dripId: brDrip.id } })).length === 0, "deleting a branched drip removes BOTH halves");
  } catch (e) {
    console.log("   (error: " + (e as Error).stack + ")"); fails++;
  } finally {
    for (const id of tenants) {
      for (const tbl of ["emailLog", "communicationSend", "automationRun", "scheduledJob", "automation", "survey", "contact", "drip"]) { try { await (db as any)[tbl].deleteMany({ where: tbl === "survey" ? { tenantId: id } : { tenantId: id } }); } catch {} }
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n=============");
  console.log(fails === 0 ? "ALL PASSED \u2705  (drips compile)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
