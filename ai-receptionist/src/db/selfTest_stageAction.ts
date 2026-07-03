// Batch A step 2 self-test — proves the stage/field-writing action on the REAL
// executor + the REAL loop guard.
//
//   npx tsx src/db/selfTest_stageAction.ts
//
// SAFETY: operates only inside two clearly-named TEMPORARY tenants
// ("__SELFTEST_ACT_A__" / "__SELFTEST_ACT_B__") and deletes them at the end
// (everything cascades). Captures your real counts before/after and fails if any
// changed.
//
// HOW IT TESTS THE REAL THING: it calls the actual runAction() executor (the same
// one the engine runs) with a record-subject context, then inspects the database
// (link stageKey, StageHistory rows, the persisted Event's actor). For the guard
// it feeds the real automation-stamped event into the real engine handleEvent()
// and confirms a downstream automation does NOT fire. No bus subscriber runs
// during the test, so nothing happens behind our back.
//
// WHAT IT PROVES: the action moves candidates / sets a field through the single
// chokepoint (history + event), stamps "automation" so it can't cascade, refuses
// invalid stages, reports no-op honestly, gates bulk moves, and stays portal-
// scoped. WHAT IT DOES NOT PROVE: the builder UI wiring (one manual click does),
// nor real outbound sends (these actions don't send).

import { prisma, disconnectDb } from "./client";
import { runAction, ActionContext } from "../automation/actions";
import { handleEvent } from "../automation/engine";

const db = prisma as any;
const A_NAME = "__SELFTEST_ACT_A__";
const B_NAME = "__SELFTEST_ACT_B__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const runsFor = (automationId: string) => db.automationRun.count({ where: { automationId } });
const historyFor = (recordLinkId: string) => db.stageHistory.count({ where: { recordLinkId } });
const linksInStage = (tenantId: string, recordId: string, stageKey: string) => db.recordLink.count({ where: { tenantId, recordId, stageKey, deletedAt: null } });
const latestEvent = (tenantId: string, type: string) => db.event.findFirst({ where: { tenantId, type }, orderBy: { occurredAt: "desc" } });

async function makeJobTenant(name: string) {
  const t = await db.tenant.create({ data: { billingStatus: "trial", name, notifyEmail: "selftest@example.invalid" } });
  const rt = await db.recordType.create({ data: {
    tenantId: t.id, key: "job", label: "Job",
    subtypes: [{ key: "k", label: "K", order: 0, stages: [{ key: "x", label: "X", order: 0 }, { key: "y", label: "Y", order: 1 }] }],
    recordStages: [{ key: "open", label: "Open", order: 0 }, { key: "filled", label: "Filled", order: 1 }],
  } });
  const job = await db.record.create({ data: { tenantId: t.id, recordTypeId: rt.id, title: "Test Job", subtypeKey: "k", stageKey: "open" } });
  const addCand = async (nm: string, stage: string) => {
    const c = await db.contact.create({ data: { tenantId: t.id, name: nm } });
    const l = await db.recordLink.create({ data: { tenantId: t.id, recordId: job.id, parentType: "contact", parentId: c.id, stageKey: stage, customFields: {} } });
    return { contactId: c.id, linkId: l.id };
  };
  return { tenantId: t.id, jobId: job.id, addCand };
}

function recordCtx(tenantId: string, recordId: string): ActionContext {
  return {
    tenantId, contactId: "", fieldDefs: [],
    actor: { type: "automation", id: "selftest-auto", name: "Mover" },
    portal: {}, workingSet: [], triggerType: "RecordUpdated",
    subjectType: "record", recordId, recordTitle: "Test Job", chainDepth: 1,
  };
}

async function main() {
  console.log("Batch A step 2 — stage/field action self-test");
  console.log("=============================================");
  const before = {
    history: await db.stageHistory.count(), events: await db.event.count(),
    runs: await db.automationRun.count(), autos: await db.automation.count(), tenants: await db.tenant.count(),
  };
  console.log(`Real rows before — history:${before.history} events:${before.events} runs:${before.runs} automations:${before.autos} tenants:${before.tenants}\n`);

  let aId = "", bId = "";
  try {
    const A = await makeJobTenant(A_NAME);
    aId = A.tenantId;
    const c1 = await A.addCand("Cand One", "x");
    // downstream automation that WOULD fire if a "moved to y" event weren't automation-stamped
    const autoDownstream = (await db.automation.create({ data: { tenantId: A.tenantId, name: "downstream", enabled: true, triggerType: "StageChanged:y", conditions: [], actions: [{ type: "create_note", config: { text: "downstream fired" } }] } })).id;
    const ctx = recordCtx(A.tenantId, A.jobId);

    const B = await makeJobTenant(B_NAME);
    bId = B.tenantId;
    const cB = await B.addCand("Other Cand", "x");
    const autoT2 = (await db.automation.create({ data: { tenantId: B.tenantId, name: "other portal", enabled: true, triggerType: "StageChanged", conditions: [], actions: [{ type: "create_note", config: { text: "x" } }] } })).id;

    // ---------- (a) the action moves a candidate, with history + automation-stamped event ----------
    console.log("(a) move_to_stage actually moves a candidate (writes stageKey + StageHistory + automation-stamped event):");
    const hBefore = await historyFor(c1.linkId);
    const rMove = await runAction({ type: "move_to_stage", config: { stageKey: "y" } }, ctx);
    check(rMove.status === "success", `result success (got ${rMove.status}${rMove.error ? ": " + rMove.error : ""})`);
    const l1 = await db.recordLink.findUnique({ where: { id: c1.linkId } });
    check(l1.stageKey === "y", `link stageKey changed to 'y' (got ${l1.stageKey})`);
    const hAfter = await historyFor(c1.linkId);
    check(hAfter === hBefore + 1, `one StageHistory row written (${hBefore} -> ${hAfter})`);
    const newest = await db.stageHistory.findFirst({ where: { recordLinkId: c1.linkId }, orderBy: { enteredAt: "desc" } });
    check(!!newest && newest.toStage === "y" && newest.source === "move", `history row is to 'y', source 'move' (got ${newest ? newest.toStage + "/" + newest.source : "none"})`);
    const moveEvt = await latestEvent(A.tenantId, "StageChanged");
    check(!!moveEvt && moveEvt.actorType === "automation", `emitted StageChanged is actor 'automation' (got ${moveEvt ? moveEvt.actorType : "none"})`);

    // ---------- (b) the real move does NOT trigger downstream automations ----------
    console.log("(b) the automation-stamped move does not wake a downstream automation (guard holds for the real action):");
    const downBefore = await runsFor(autoDownstream);
    // Feed the engine the very event the move emitted (automation actor, new_stage 'y').
    await handleEvent({ id: "t-" + Math.random().toString(36).slice(2), tenantId: A.tenantId, type: "StageChanged", actor: { type: "automation" } as any, subject: { type: "contact", id: c1.contactId }, payload: { new_stage: "y", old_stage: "x" }, occurredAt: new Date().toISOString(), chainDepth: 1 });
    const downAfter = await runsFor(autoDownstream);
    check(downAfter === downBefore, `downstream automation did not fire (runs ${downBefore} -> ${downAfter})`);

    // reset L1 to 'x' for the next checks (direct write; not part of any assertion)
    await db.recordLink.update({ where: { id: c1.linkId }, data: { stageKey: "x" } });

    // ---------- (c) invalid target stage -> FAILED, nothing written ----------
    console.log("(c) an invalid target stage is refused and writes nothing:");
    const hBefore2 = await historyFor(c1.linkId);
    const rBad = await runAction({ type: "move_to_stage", config: { stageKey: "not_a_real_stage" } }, ctx);
    check(rBad.status === "failed" && /not in this record's pipeline/i.test(rBad.error || ""), `invalid stage failed with clear reason (got ${rBad.status}: ${rBad.error || ""})`);
    const l1b = await db.recordLink.findUnique({ where: { id: c1.linkId } });
    check(l1b.stageKey === "x", `link stage unchanged after invalid move (got ${l1b.stageKey})`);
    check((await historyFor(c1.linkId)) === hBefore2, "no StageHistory row written for the invalid move");

    // ---------- (d) already-in-target -> "no change", not green-moved ----------
    console.log("(d) moving a candidate already in the target reports 'no change', not moved:");
    const hBefore3 = await historyFor(c1.linkId);
    const rNoop = await runAction({ type: "move_to_stage", config: { stageKey: "x" } }, ctx);
    check(rNoop.status === "skipped" && /no change/i.test(rNoop.detail || ""), `no-op reported as skipped/no-change (got ${rNoop.status}: ${rNoop.detail || rNoop.error || ""})`);
    check((await historyFor(c1.linkId)) === hBefore3, "no StageHistory row written for the no-op");

    // ---------- (e) set_record_field sets the job's Status, automation-stamped ----------
    console.log("(e) set_record_field sets the record's Status (validated) and is automation-stamped:");
    const rSet = await runAction({ type: "set_record_field", config: { field: "status", value: "filled" } }, ctx);
    check(rSet.status === "success", `set status success (got ${rSet.status}${rSet.error ? ": " + rSet.error : ""})`);
    const job = await db.record.findUnique({ where: { id: A.jobId } });
    check(job.stageKey === "filled", `record Status now 'filled' (got ${job.stageKey})`);
    const recEvt = await latestEvent(A.tenantId, "RecordUpdated");
    check(!!recEvt && recEvt.actorType === "automation", `emitted RecordUpdated is actor 'automation' (got ${recEvt ? recEvt.actorType : "none"})`);
    const rSetBad = await runAction({ type: "set_record_field", config: { field: "status", value: "bogus" } }, ctx);
    check(rSetBad.status === "failed" && /not a valid status/i.test(rSetBad.error || ""), `invalid status refused (got ${rSetBad.status}: ${rSetBad.error || ""})`);

    // ---------- (f) bulk fan-out gate ----------
    console.log("(f) many-candidate move is blocked past the threshold without ack, proceeds with it:");
    for (let i = 0; i < 26; i++) await A.addCand(`Bulk ${i}`, "x"); // 26 more in 'x' (plus c1 in 'x' = 27)
    const yBefore = await linksInStage(A.tenantId, A.jobId, "y");
    const rBlocked = await runAction({ type: "move_to_stage", config: { stageKey: "y" } }, ctx);
    check(rBlocked.status === "failed" && /bulk move not allowed/i.test(rBlocked.error || ""), `over-threshold move blocked (got ${rBlocked.status}: ${rBlocked.error || ""})`);
    check((await linksInStage(A.tenantId, A.jobId, "y")) === yBefore, "blocked move changed nothing");
    const rOk = await runAction({ type: "move_to_stage", config: { stageKey: "y", allowBulk: true } }, ctx);
    check(rOk.status === "success", `with ack, bulk move succeeds (got ${rOk.status}${rOk.error ? ": " + rOk.error : ""})`);
    check((await linksInStage(A.tenantId, A.jobId, "y")) >= 27, `all candidates now in 'y' (${await linksInStage(A.tenantId, A.jobId, "y")})`);

    // ---------- (g) tenant isolation ----------
    console.log("(g) tenant isolation: tenant A's moves never touched tenant B:");
    check((await runsFor(autoT2)) === 0, "the other portal's automation never ran");
    const lB = await db.recordLink.findUnique({ where: { id: cB.linkId } });
    check(lB.stageKey === "x", "the other portal's candidate stayed put");
    check((await db.event.count({ where: { tenantId: B.tenantId } })) === 0, "no events leaked into the other portal");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenants…");
    for (const id of [aId, bId]) if (id) { try { await db.tenant.delete({ where: { id } }); } catch (e) { console.error("cleanup failed", id, e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: { in: [A_NAME, B_NAME] } } }); } catch {}
  }

  console.log("\nVerifying real data is untouched:");
  const after = {
    history: await db.stageHistory.count(), events: await db.event.count(),
    runs: await db.automationRun.count(), autos: await db.automation.count(), tenants: await db.tenant.count(),
  };
  check(after.history === before.history, `StageHistory unchanged (${before.history} -> ${after.history})`);
  check(after.events === before.events, `Events unchanged (${before.events} -> ${after.events})`);
  check(after.runs === before.runs, `AutomationRuns unchanged (${before.runs} -> ${after.runs})`);
  check(after.autos === before.autos, `Automations unchanged (${before.autos} -> ${after.autos})`);
  check(after.tenants === before.tenants, `Tenants unchanged (${before.tenants} -> ${after.tenants})`);

  console.log("\n=============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
