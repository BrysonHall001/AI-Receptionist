// Batch A step 1 self-test — proves the loop brake on the REAL mechanism.
//
//   npx tsx src/db/selfTest_loopGuard.ts
//
// SAFETY: operates only inside two clearly-named TEMPORARY tenants
// ("__SELFTEST_LOOP_A__" / "__SELFTEST_LOOP_B__") and deletes them at the end.
// Everything it creates (contacts, records, links, events, runs, notes) cascades
// away when the tenant is deleted. It captures your real row counts before/after
// and fails loudly if any changed.
//
// HOW IT TESTS THE REAL THING (not a hollow pass):
//   * Stamping (mechanism 1) is checked by calling the REAL updateLink() and
//     reading the actor stamped on the persisted Event row.
//   * The guard + depth ceiling are checked by calling the REAL engine
//     handleEvent() directly and awaiting it (the live bus dispatches with
//     setImmediate and isn't awaited, which would make assertions flaky — so we
//     drive the engine directly and deterministically).
// No registered bus subscriber runs during this test, so nothing happens behind
// our back — every engine run below is one we invoked and awaited.
//
// WHAT IT PROVES: a normal user move still fires automations; an automation-
// stamped move does NOT; the classic ping-pong terminates at hop 1; the depth
// ceiling refuses (visibly) and a control just under it proceeds; another portal
// is never touched. WHAT IT DOES NOT PROVE: that a real (Step-2) stage-writing
// action is wired into the builder (it doesn't exist yet), nor real outbound
// sends (mocked). Those come later.

import { prisma, disconnectDb } from "./client";
import { handleEvent, MAX_CHAIN_DEPTH } from "../automation/engine";
import { updateLink } from "../services/recordLinkService";

const db = prisma as any;
const A_NAME = "__SELFTEST_LOOP_A__";
const B_NAME = "__SELFTEST_LOOP_B__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

const runsFor = (automationId: string) => db.automationRun.count({ where: { automationId } });
const newestRun = (automationId: string) => db.automationRun.findFirst({ where: { automationId }, orderBy: { createdAt: "desc" } });
const latestStageEvent = (tenantId: string) => db.event.findFirst({ where: { tenantId, type: "StageChanged" }, orderBy: { occurredAt: "desc" } });

function ev(tenantId: string, actorType: string, contactId: string, newStage: string, chainDepth: number) {
  return {
    id: "t-" + Math.random().toString(36).slice(2),
    tenantId,
    type: "StageChanged",
    actor: { type: actorType as any },
    subject: { type: "contact" as const, id: contactId },
    payload: { new_stage: newStage, old_stage: newStage === "y" ? "x" : "y" },
    occurredAt: new Date().toISOString(),
    chainDepth,
  };
}

async function makeTenant(name: string) {
  const t = await db.tenant.create({ data: { name, notifyEmail: "selftest@example.invalid" } });
  const rt = await db.recordType.create({ data: { tenantId: t.id, key: "job", label: "Job" } });
  const rec = await db.record.create({ data: { tenantId: t.id, recordTypeId: rt.id, title: "Loop Test Job" } });
  const contact = await db.contact.create({ data: { tenantId: t.id, name: "Loop Cand" } });
  const link = await db.recordLink.create({ data: { tenantId: t.id, recordId: rec.id, parentType: "contact", parentId: contact.id, stageKey: "x", customFields: {} } });
  const note = async (trigger: string, nm: string): Promise<string> => {
    const a = await db.automation.create({ data: { tenantId: t.id, name: nm, enabled: true, triggerType: trigger, conditions: [], actions: [{ type: "create_note", config: { text: "loop test" } }] } });
    return a.id;
  };
  return { tenantId: t.id, contactId: contact.id, linkId: link.id, note };
}

async function main() {
  console.log("Batch A step 1 — loop-guard self-test");
  console.log(`====================================== (MAX_CHAIN_DEPTH = ${MAX_CHAIN_DEPTH})`);

  const before = {
    history: await db.stageHistory.count(),
    events: await db.event.count(),
    runs: await db.automationRun.count(),
    autos: await db.automation.count(),
    tenants: await db.tenant.count(),
  };
  console.log(`Real rows before — history:${before.history} events:${before.events} runs:${before.runs} automations:${before.autos} tenants:${before.tenants}\n`);

  let aId = "", bId = "";
  try {
    const A = await makeTenant(A_NAME);
    aId = A.tenantId;
    const autoAny = await A.note("StageChanged", "any stage");      // fires on any stage change
    const autoA = await A.note("StageChanged:x", "moved to X");     // ping-pong: would move to Y
    const autoB = await A.note("StageChanged:y", "moved to Y");     // ping-pong: would move to X

    const B = await makeTenant(B_NAME);
    bId = B.tenantId;
    const autoT2 = await B.note("StageChanged", "other portal");

    // ---------- (a) BASELINE STILL WORKS ----------
    console.log("(a) baseline: a normal user move still stamps 'user', writes history, and fires automations:");
    const histBefore = await db.stageHistory.count({ where: { recordLinkId: A.linkId } });
    await updateLink(A.tenantId, A.linkId, { stageKey: "y" }); // default actor = user
    const uEvt = await latestStageEvent(A.tenantId);
    check(!!uEvt && uEvt.actorType === "user", `real updateLink default stamps actor 'user' (got ${uEvt ? uEvt.actorType : "none"})`);
    const histAfter = await db.stageHistory.count({ where: { recordLinkId: A.linkId } });
    check(histAfter === histBefore + 1, `3b still writes one StageHistory row on the move (${histBefore} -> ${histAfter})`);
    const anyBefore = await runsFor(autoAny), bBefore = await runsFor(autoB);
    await handleEvent(ev(A.tenantId, "user", A.contactId, "y", 0));
    const anyAfter = await runsFor(autoAny), bAfter = await runsFor(autoB);
    check(anyAfter === anyBefore + 1 && bAfter === bBefore + 1, `user StageChanged→y fires matching automations (any:${anyBefore}->${anyAfter}, toY:${bBefore}->${bAfter})`);

    // ---------- (b) ACTOR GUARD CATCHES AUTOMATION WRITES ----------
    console.log("(b) automation-stamped move is stamped 'automation' AND does not trigger downstream:");
    await updateLink(A.tenantId, A.linkId, { stageKey: "x" }, { type: "automation", id: "test", name: "test" });
    const aEvt = await latestStageEvent(A.tenantId);
    check(!!aEvt && aEvt.actorType === "automation", `automation-actor updateLink stamps event 'automation' (got ${aEvt ? aEvt.actorType : "none"})`);
    const aRunsBefore = await runsFor(autoA), anyBefore2 = await runsFor(autoAny);
    await handleEvent(ev(A.tenantId, "automation", A.contactId, "x", 1)); // what that emit looks like to the engine
    const aRunsAfter = await runsFor(autoA), anyAfter2 = await runsFor(autoAny);
    check(aRunsAfter === aRunsBefore && anyAfter2 === anyBefore2, `automation-stamped event produced 0 downstream runs (moved-to-X:${aRunsBefore}->${aRunsAfter}, any:${anyBefore2}->${anyAfter2})`);

    // ---------- (c) PING-PONG TERMINATES ----------
    console.log("(c) classic ping-pong (A→Y on moved-to-X, B→X on moved-to-Y) terminates at hop 1:");
    const totalBefore = await db.automationRun.count({ where: { tenantId: A.tenantId } });
    // Simulate autoA's action moving the candidate to Y, the way a Step-2 action will: with actor automation.
    await updateLink(A.tenantId, A.linkId, { stageKey: "y" }, { type: "automation", id: autoA, name: "moved to X" });
    const ppEvt = await latestStageEvent(A.tenantId);
    check(!!ppEvt && ppEvt.actorType === "automation", "the simulated A→Y move is automation-stamped (so B can't be woken)");
    await handleEvent(ev(A.tenantId, "automation", A.contactId, "y", 1)); // engine sees A's move
    const totalAfter = await db.automationRun.count({ where: { tenantId: A.tenantId } });
    check(totalAfter === totalBefore, `cascade terminated — 0 further runs (total A runs ${totalBefore} -> ${totalAfter})`);

    // ---------- (d) DEPTH CEILING ----------
    console.log("(d) depth ceiling: a control just under the limit proceeds; over the limit is refused (visibly):");
    await handleEvent(ev(A.tenantId, "user", A.contactId, "y", MAX_CHAIN_DEPTH)); // == limit -> allowed
    const ctrl = await newestRun(autoAny);
    check(!!ctrl && ctrl.status === "success", `at depth ${MAX_CHAIN_DEPTH} (== limit) the run proceeds (status ${ctrl ? ctrl.status : "none"})`);
    await handleEvent(ev(A.tenantId, "user", A.contactId, "y", MAX_CHAIN_DEPTH + 1)); // over -> refused
    const over = await newestRun(autoAny);
    check(!!over && over.status === "failed", `at depth ${MAX_CHAIN_DEPTH + 1} (over limit) the run is refused/failed (status ${over ? over.status : "none"})`);
    check(!!over && /depth limit reached/i.test(JSON.stringify(over.results)), "the refused run says 'depth limit reached' (not a silent stop)");

    // ---------- (e) TENANT ISOLATION ----------
    console.log("(e) tenant isolation: none of tenant A's activity touched tenant B:");
    check((await runsFor(autoT2)) === 0, "the other portal's automation never ran");
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
    history: await db.stageHistory.count(),
    events: await db.event.count(),
    runs: await db.automationRun.count(),
    autos: await db.automation.count(),
    tenants: await db.tenant.count(),
  };
  check(after.history === before.history, `StageHistory unchanged (${before.history} -> ${after.history})`);
  check(after.events === before.events, `Events unchanged (${before.events} -> ${after.events})`);
  check(after.runs === before.runs, `AutomationRuns unchanged (${before.runs} -> ${after.runs})`);
  check(after.autos === before.autos, `Automations unchanged (${before.autos} -> ${after.autos})`);
  check(after.tenants === before.tenants, `Tenants unchanged (${before.tenants} -> ${after.tenants})`);

  console.log("\n====================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
