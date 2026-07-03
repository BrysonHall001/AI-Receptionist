// Batch A step 3 self-test — proves record-subject conditions read the RECORD's
// own fields, with no cross-leak and a safe unknown-field default.
//
//   npx tsx src/db/selfTest_recordConditions.ts
//
// SAFETY: two clearly-named TEMPORARY tenants ("__SELFTEST_COND_A__"/B), deleted
// at the end (everything cascades). Captures real counts before/after.
//
// HOW IT TESTS THE REAL THING: it drives the real engine handleEvent() with
// synthetic RecordUpdated / StageChanged events and inspects the AutomationRun
// rows (matched / skipped) the engine writes — so it exercises the actual
// condition evaluation path, record field loader, and fail-closed logic.
//
// WHAT IT PROVES: record conditions evaluate the record's own Status/custom
// fields; a record automation can't read contact fields (fails closed); a
// contact automation evaluates contact data; unknown fields fail closed; tenant
// isolation. WHAT IT DOES NOT PROVE: the builder field-picker UI (verified by a
// click). NOTE: the contact path's pre-existing "unknown field passes" default
// is intentionally unchanged (changing it would alter Stage 1); leak-prevention
// is enforced on the record side (fail-closed) and by each path using only its
// own column set.

import { prisma, disconnectDb } from "./client";
import { handleEvent } from "../automation/engine";

const db = prisma as any;
const A_NAME = "__SELFTEST_COND_A__";
const B_NAME = "__SELFTEST_COND_B__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const newestRun = (automationId: string) => db.automationRun.findFirst({ where: { automationId }, orderBy: { createdAt: "desc" } });
const runsFor = (automationId: string) => db.automationRun.count({ where: { automationId } });

function recEvent(tenantId: string, recordId: string) {
  return { id: "t-" + Math.random().toString(36).slice(2), tenantId, type: "RecordUpdated", actor: { type: "user" } as any, subject: { type: "record" as const, id: recordId }, payload: { changes: [{ field: "status", label: "Status", old: "open", new: "open" }] }, occurredAt: new Date().toISOString() };
}
function contactEvent(tenantId: string, contactId: string) {
  return { id: "t-" + Math.random().toString(36).slice(2), tenantId, type: "StageChanged", actor: { type: "user" } as any, subject: { type: "contact" as const, id: contactId }, payload: { new_stage: "applied" }, occurredAt: new Date().toISOString() };
}
const note = (tenantId: string, name: string, triggerType: string, conditions: any[]) =>
  db.automation.create({ data: { tenantId, name, enabled: true, triggerType, conditions, actions: [{ type: "create_note", config: { text: "fired" } }] } }).then((a: any) => a.id);

async function main() {
  console.log("Batch A step 3 — record-conditions self-test");
  console.log("============================================");
  const before = {
    history: await db.stageHistory.count(), events: await db.event.count(),
    runs: await db.automationRun.count(), autos: await db.automation.count(), tenants: await db.tenant.count(),
  };
  console.log(`Real rows before — history:${before.history} events:${before.events} runs:${before.runs} automations:${before.autos} tenants:${before.tenants}\n`);

  let aId = "", bId = "";
  try {
    const tA = await db.tenant.create({ data: { billingStatus: "trial", name: A_NAME, notifyEmail: "selftest@example.invalid" } });
    aId = tA.id;
    const rt = await db.recordType.create({ data: { tenantId: aId, key: "job", label: "Job", recordStages: [{ key: "open", label: "Open", order: 0 }, { key: "filled", label: "Filled", order: 1 }], subtypes: [{ key: "k", label: "K", order: 0, stages: [{ key: "x", label: "X", order: 0 }] }] } });
    await db.fieldDef.create({ data: { tenantId: aId, recordTypeId: rt.id, key: "priority", label: "Priority", type: "text", order: 0 } });
    const job = await db.record.create({ data: { tenantId: aId, recordTypeId: rt.id, title: "T", subtypeKey: "k", stageKey: "open", customFields: { priority: "high" } } });

    const autoStatus = await note(aId, "status open", "RecordUpdated:status", [{ field: "status", op: "is", value: "open" }]);
    const autoPriority = await note(aId, "priority high", "RecordUpdated:status", [{ field: "priority", op: "is", value: "high" }]);
    const autoContactField = await note(aId, "leak intent", "RecordUpdated:status", [{ field: "intent", op: "is", value: "buy" }]); // contact field on a record automation
    const autoBogus = await note(aId, "bogus field", "RecordUpdated:status", [{ field: "nonexistent_xyz", op: "is", value: "z" }]);

    // contact-subject automation + contact (for the contact direction)
    const contact = await db.contact.create({ data: { tenantId: aId, name: "Cc", intent: "buy" } });
    const autoContact = await note(aId, "contact intent", "StageChanged", [{ field: "intent", op: "is", value: "buy" }]);

    // tenant B (isolation)
    const tB = await db.tenant.create({ data: { billingStatus: "trial", name: B_NAME, notifyEmail: "selftest@example.invalid" } });
    bId = tB.id;
    const rtB = await db.recordType.create({ data: { tenantId: bId, key: "job", label: "Job", recordStages: [{ key: "open", label: "Open", order: 0 }], subtypes: [] } });
    const jobB = await db.record.create({ data: { tenantId: bId, recordTypeId: rtB.id, title: "TB", stageKey: "open", customFields: {} } });
    const autoT2 = await note(bId, "other portal", "RecordUpdated:status", [{ field: "status", op: "is", value: "open" }]);

    // ---------- (a) Status condition reads the record's Status ----------
    console.log("(a) record condition 'Status = Open' fires when Open, not when Filled:");
    await db.record.update({ where: { id: job.id }, data: { stageKey: "open" } });
    await handleEvent(recEvent(aId, job.id));
    let r = await newestRun(autoStatus);
    check(!!r && r.matched === true && r.status === "success", `fires when Status=Open (matched ${r?.matched}, status ${r?.status})`);
    await db.record.update({ where: { id: job.id }, data: { stageKey: "filled" } });
    await handleEvent(recEvent(aId, job.id));
    r = await newestRun(autoStatus);
    check(!!r && r.matched === false && r.status === "skipped", `does NOT fire when Status=Filled (matched ${r?.matched}, status ${r?.status})`);

    // ---------- (b) custom field condition ----------
    console.log("(b) record condition on a job custom field (priority) matches / doesn't:");
    await db.record.update({ where: { id: job.id }, data: { customFields: { priority: "high" } } });
    await handleEvent(recEvent(aId, job.id));
    r = await newestRun(autoPriority);
    check(!!r && r.matched === true, `fires when priority=high (matched ${r?.matched})`);
    await db.record.update({ where: { id: job.id }, data: { customFields: { priority: "low" } } });
    await handleEvent(recEvent(aId, job.id));
    r = await newestRun(autoPriority);
    check(!!r && r.matched === false, `does NOT fire when priority=low (matched ${r?.matched})`);

    // ---------- (c) NO LEAK ----------
    console.log("(c) no cross-leak between record and contact fields:");
    // record automation referencing a CONTACT field -> can't read it -> fail closed
    r = await newestRun(autoContactField);
    check(!!r && r.matched === false && /field this record doesn't have/i.test(JSON.stringify(r.results)), `record automation referencing a contact field fails closed (matched ${r?.matched})`);
    // contact automation evaluates CONTACT data (fires on intent=buy; not on sell)
    await handleEvent(contactEvent(aId, contact.id));
    r = await newestRun(autoContact);
    check(!!r && r.matched === true, `contact automation reads contact data: fires on intent=buy (matched ${r?.matched})`);
    await db.contact.update({ where: { id: contact.id }, data: { intent: "sell" } });
    await handleEvent(contactEvent(aId, contact.id));
    r = await newestRun(autoContact);
    check(!!r && r.matched === false, `contact automation skips on intent=sell (matched ${r?.matched})`);

    // ---------- (d) unknown field -> safe fail-closed ----------
    console.log("(d) an unknown field fails closed (does not silently fire):");
    r = await newestRun(autoBogus);
    check(!!r && r.matched === false && r.status === "skipped", `bogus-field record automation does not fire (matched ${r?.matched}, status ${r?.status})`);
    check(!!r && /field this record doesn't have/i.test(JSON.stringify(r.results)), "the skipped run states the safe reason");

    // ---------- (e) tenant isolation ----------
    console.log("(e) tenant isolation: tenant A's events never ran tenant B's automation:");
    check((await runsFor(autoT2)) === 0, "the other portal's automation never ran");
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

  console.log("\n============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
