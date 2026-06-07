// Option 3 Pass 2 self-test — proves the four NEW actions truly act on the real
// Record system, are loop-safe, gated to record subjects, and tenant-isolated.
//
//   npx tsx src/db/selfTest_recordActions.ts
//
// SAFETY: two clearly-named TEMPORARY tenants ("__SELFTEST_RECACT__"/B), deleted
// at the end (cascades). Captures real counts before/after. Drives the REAL
// engine (handleEvent) so it exercises the actual record path + loop guard.
//
// WHAT IT PROVES: (a) create makes a real Record (not a Contact); (b) update
// changes the subject Record and does NOT cascade (automation-stamped event is
// ignored); (c) find returns the right Records and stores a working set; (d)
// delete soft-deletes to the recycle bin and the bulk gate BLOCKS over-threshold
// without ack and PROCEEDS with it (records remain recoverable); (e) the four are
// refused on a contact-subject automation, and the contact-acting four are
// unchanged; (f) the record write doesn't cascade (depth ceiling inherited from
// the verified Step-1 chainDepth threading); (g) tenant isolation.
// WHAT IT CANNOT PROVE: the builder UI labels/config pickers — that's your glance.

import { prisma, disconnectDb } from "./client";
import { handleEvent } from "../automation/engine";
import { ACTION_TYPES } from "../automation/actions";

const db = prisma as any;
const A_NAME = "__SELFTEST_RECACT__";
const B_NAME = "__SELFTEST_RECACT_B__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const newestRun = (automationId: string) => db.automationRun.findFirst({ where: { automationId }, orderBy: { createdAt: "desc" } });
const runsFor = (automationId: string) => db.automationRun.count({ where: { automationId } });
function resultText(run: any) { try { return JSON.stringify(run?.results || []); } catch { return ""; } }

function recEvent(tenantId: string, recordId: string) {
  return { id: "t-" + Math.random().toString(36).slice(2), tenantId, type: "RecordUpdated", actor: { type: "user" } as any, subject: { type: "record" as const, id: recordId }, payload: { changes: [{ field: "status", label: "Status", old: "open", new: "open" }] }, occurredAt: new Date().toISOString() };
}
function contactEvent(tenantId: string, contactId: string) {
  return { id: "t-" + Math.random().toString(36).slice(2), tenantId, type: "ContactCreated", actor: { type: "user" } as any, subject: { type: "contact" as const, id: contactId }, payload: {}, occurredAt: new Date().toISOString() };
}

async function main() {
  console.log("Option 3 Pass 2 — record-actions self-test");
  console.log("==========================================");
  console.log("New action keys + labels (for your read-through):");
  for (const k of ["create_record_item", "update_record_item", "find_record_items", "delete_record_items"]) {
    const a: any = ACTION_TYPES.find((x: any) => x.type === k);
    console.log(`  ${k}  ->  “${a ? a.label : "(MISSING!)"}”  — ${a ? a.description : ""}`);
  }
  console.log("");

  const before = {
    records: await db.record.count(), contacts: await db.contact.count(), links: await db.recordLink.count(),
    autos: await db.automation.count(), tenants: await db.tenant.count(), history: await db.stageHistory.count(),
  };
  console.log(`Real rows before — records:${before.records} contacts:${before.contacts} links:${before.links} automations:${before.autos} tenants:${before.tenants} history:${before.history}\n`);

  let aId = "", bId = "";
  try {
    const tA = await db.tenant.create({ data: { name: A_NAME, notifyEmail: "selftest@example.invalid" } });
    aId = tA.id;
    const rt = await db.recordType.create({ data: { tenantId: aId, key: "job", label: "Job", recordStages: [{ key: "open", label: "Open", order: 0 }, { key: "filled", label: "Filled", order: 1 }], subtypes: [{ key: "k", label: "K", order: 0, stages: [{ key: "x", label: "X", order: 0 }] }] } });
    await db.fieldDef.create({ data: { tenantId: aId, recordTypeId: rt.id, key: "priority", label: "Priority", type: "text", order: 0 } });
    const mkRec = (title: string, stageKey = "open", customFields: any = {}) => db.record.create({ data: { tenantId: aId, recordTypeId: rt.id, title, subtypeKey: "k", stageKey, customFields } });
    const subj = await mkRec("Subject", "open", { priority: "low" });
    const mkAuto = (name: string, triggerType: string, actions: any[]) => db.automation.create({ data: { tenantId: aId, name, enabled: false, triggerType, conditions: [], actions } }).then((a: any) => a.id);
    const setEnabled = (id: string, enabled: boolean) => db.automation.update({ where: { id }, data: { enabled } });
    const fireOn = async (id: string, recordId = subj.id) => { await setEnabled(id, true); await handleEvent(recEvent(aId, recordId)); await setEnabled(id, false); };
    const resetSubj = () => db.record.update({ where: { id: subj.id }, data: { stageKey: "open", customFields: { priority: "low" } } });

    // ---------- (a) CREATE makes a real Record ----------
    console.log("(a) create_record_item makes a real Record (not a Contact):");
    const aCreate = await mkAuto("create rec", "RecordUpdated:status", [{ type: "create_record_item", config: { recordType: "job", title: "Created By Test", subtypeKey: "k", stageKey: "open", values: [{ field: "priority", value: "high" }] } }]);
    await fireOn(aCreate);
    const created = await db.record.findFirst({ where: { tenantId: aId, title: "Created By Test" } });
    check(!!created, "a Record titled 'Created By Test' was created");
    check(!!created && created.subtypeKey === "k" && created.stageKey === "open" && (created.customFields || {}).priority === "high", "created Record has the right type/status/custom field");
    check((await db.contact.count({ where: { tenantId: aId } })) === 0, "create made NO Contact");

    // ---------- (b) UPDATE the subject Record + NO cascade ----------
    console.log("(b) update_record_item changes the subject Record, no cascade:");
    const aDownstream = await mkAuto("downstream", "RecordUpdated:status=filled", [{ type: "create_note", config: { text: "downstream ran" } }]);
    const aUpdate = await mkAuto("update rec", "RecordUpdated:status", [{ type: "update_record_item", config: { values: [{ field: "status", value: "filled" }, { field: "priority", value: "urgent" }] } }]);
    await setEnabled(aDownstream, true);
    await fireOn(aUpdate);
    await setEnabled(aDownstream, false);
    const upd = await db.record.findUnique({ where: { id: subj.id } });
    check(!!upd && upd.stageKey === "filled" && (upd.customFields || {}).priority === "urgent", "subject Record's status + custom field were updated");
    check((await runsFor(aDownstream)) === 0, "the automation's update did NOT cascade into the status=filled automation (loop guard holds)");
    await resetSubj();

    // ---------- (c)+(d) FIND + DELETE + bulk gate ----------
    console.log("(c)+(d) find_record_items + delete_record_items (+ bulk gate):");
    const f1 = await mkRec("FINDME");
    const f2 = await mkRec("OTHER");
    const aFindDel = await mkAuto("find+del", "RecordUpdated:status", [
      { type: "find_record_items", config: { recordType: "job", conditions: [{ field: "title", op: "is", value: "FINDME" }] } },
      { type: "delete_record_items", config: {} },
    ]);
    await fireOn(aFindDel);
    const f1after = await db.record.findUnique({ where: { id: f1.id } });
    const f2after = await db.record.findUnique({ where: { id: f2.id } });
    check(!!f1after && f1after.deletedAt != null, "find matched the right Record and delete soft-deleted it");
    check(!!f2after && f2after.deletedAt == null, "the non-matching Record was NOT deleted (condition filtering works)");
    check(!!f1after, "deleted Record still EXISTS (soft delete — recoverable, not hard-deleted)");

    // bulk gate: 11 matching records (> BULK_DELETE_THRESHOLD of 10)
    for (let i = 0; i < 11; i++) await mkRec("BULKDEL");
    const aBulkBlocked = await mkAuto("bulk blocked", "RecordUpdated:status", [
      { type: "find_record_items", config: { recordType: "job", conditions: [{ field: "title", op: "is", value: "BULKDEL" }] } },
      { type: "delete_record_items", config: {} }, // no allowBulk
    ]);
    await fireOn(aBulkBlocked);
    const stillActive = await db.record.count({ where: { tenantId: aId, title: "BULKDEL", deletedAt: null } });
    check(stillActive === 11, "bulk delete BLOCKED without ack — all 11 still active");
    const blockedRun = await newestRun(aBulkBlocked);
    check(/Refusing to delete 11/.test(resultText(blockedRun)), "the blocked run reports FAILED with the count");

    const aBulkOk = await mkAuto("bulk ok", "RecordUpdated:status", [
      { type: "find_record_items", config: { recordType: "job", conditions: [{ field: "title", op: "is", value: "BULKDEL" }] } },
      { type: "delete_record_items", config: { allowBulk: true } },
    ]);
    await fireOn(aBulkOk);
    const nowDeleted = await db.record.count({ where: { tenantId: aId, title: "BULKDEL", deletedAt: { not: null } } });
    check(nowDeleted === 11, "with the allow-bulk ack, all 11 were soft-deleted");

    // ---------- (e) GATING: refused on a contact-subject automation ----------
    console.log("(e) the four are refused on a contact-subject automation:");
    const c0 = await db.contact.create({ data: { tenantId: aId, name: "GateTest", email: "gatetest@example.invalid" } });
    const aContact = await mkAuto("contact misuse", "ContactCreated", [{ type: "create_record_item", config: { recordType: "job", title: "ShouldNotCreate", subtypeKey: "k" } }]);
    await setEnabled(aContact, true);
    await handleEvent(contactEvent(aId, c0.id));
    await setEnabled(aContact, false);
    check(!(await db.record.findFirst({ where: { tenantId: aId, title: "ShouldNotCreate" } })), "create_record_item created NO Record on a contact automation");
    check(/only runs on record-subject/i.test(resultText(await newestRun(aContact))), "it returned a clear FAILED reason");
    // contact-acting four unchanged (Pass 1 labels intact)
    const lab = (k: string) => { const a: any = ACTION_TYPES.find((x: any) => x.type === k); return a ? a.label : ""; };
    check(lab("create_record") === "Create contact" && lab("update_record") === "Update contact" && lab("search_records") === "Find contacts" && lab("delete_record") === "Delete contact(s)", "the contact-acting four are unchanged (Pass-1 labels intact)");

    // ---------- (g) TENANT ISOLATION ----------
    console.log("(g) tenant isolation — never touches another portal's records:");
    const tB = await db.tenant.create({ data: { name: B_NAME, notifyEmail: "selftest@example.invalid" } });
    bId = tB.id;
    const rtB = await db.recordType.create({ data: { tenantId: bId, key: "job", label: "Job", recordStages: [{ key: "open", label: "Open", order: 0 }], subtypes: [{ key: "k", label: "K", order: 0, stages: [] }] } });
    const g = await db.record.create({ data: { tenantId: bId, recordTypeId: rtB.id, title: "OtherPortal", subtypeKey: "k", stageKey: "open", customFields: {} } });
    const aIso = await mkAuto("iso", "RecordUpdated:status", [
      { type: "find_record_items", config: { recordType: "job", conditions: [{ field: "title", op: "is", value: "OtherPortal" }] } },
      { type: "delete_record_items", config: {} },
    ]);
    await fireOn(aIso);
    const gAfter = await db.record.findUnique({ where: { id: g.id } });
    check(!!gAfter && gAfter.deletedAt == null, "tenant A's find/delete did NOT see or touch tenant B's record");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenants…");
    for (const id of [aId, bId]) if (id) { try { await db.tenant.delete({ where: { id } }); } catch (e) { console.error("cleanup failed", id, e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: { in: [A_NAME, B_NAME] } } }); } catch {}
  }

  console.log("\nVerifying real data untouched:");
  const after = {
    records: await db.record.count(), contacts: await db.contact.count(), links: await db.recordLink.count(),
    autos: await db.automation.count(), tenants: await db.tenant.count(), history: await db.stageHistory.count(),
  };
  check(after.records === before.records, `records unchanged (${before.records} -> ${after.records})`);
  check(after.contacts === before.contacts, `contacts unchanged (${before.contacts} -> ${after.contacts})`);
  check(after.links === before.links, `links unchanged (${before.links} -> ${after.links})`);
  check(after.autos === before.autos, `automations unchanged (${before.autos} -> ${after.autos})`);
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);
  check(after.history === before.history, `StageHistory unchanged (${before.history} -> ${after.history})`);

  console.log("\n==========================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
