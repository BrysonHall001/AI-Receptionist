// Option 3 Pass 1 self-test — proves the honest RELABEL was display-only:
// the four action KEYS are unchanged and the four actions STILL act on Contacts.
//
//   npx tsx src/db/selfTest_relabel.ts
//
// SAFETY: one clearly-named TEMPORARY tenant ("__SELFTEST_RELABEL__"), deleted
// at the end (cascades). Captures real counts before/after.
//
// WHAT IT PROVES: (a) the four type keys still exist in the registry, none
// renamed/removed, no NEW key added by this pass; (b) driving create/find/
// update/delete through the real engine still acts on CONTACTS (and creates NO
// Record); (c) no other action key changed; (d) real automations/contacts/
// records/tenants counts are identical before/after.
// WHAT IT CANNOT PROVE: the on-screen label/description TEXT (that's the one
// human glance) — but it prints the four current labels so you can read them
// here without opening the app.

import { prisma, disconnectDb } from "./client";
import { handleEvent } from "../automation/engine";
import { ACTION_TYPES } from "../automation/actions";

const db = prisma as any;
const T_NAME = "__SELFTEST_RELABEL__";

// The complete, expected set of action keys. If this pass renamed/removed a key or
// added one, this set won't match exactly and (a)/(c) will fail.
// NOTE (stale-test fix): this list previously hardcoded 17 keys and was never updated
// as later batches added send_survey, unenroll, notify_business and the four
// *_record_item*/find_record_items actions. It failed against the untouched baseline
// for that reason (registry = 24 keys). Refreshed here to the real registry so the
// guard is meaningful again; the relabel behaviour checks below are unchanged.
const EXPECTED_KEYS = [
  "send_email", "send_survey", "unenroll", "send_sms", "notify_business", "update_field",
  "add_tag", "remove_tag", "create_note", "assign_owner", "wait", "create_record",
  "update_record", "search_records", "delete_record", "compute_field", "send_webhook",
  "act_on_linked", "move_to_stage", "set_record_field", "create_record_item",
  "update_record_item", "find_record_items", "delete_record_items",
].sort();
const FOUR = ["create_record", "update_record", "search_records", "delete_record"];

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const fireCreated = (tenantId: string, contactId: string) =>
  handleEvent({ id: "t-" + Math.random().toString(36).slice(2), tenantId, type: "ContactCreated", actor: { type: "user" } as any, subject: { type: "contact" as const, id: contactId }, payload: {}, occurredAt: new Date().toISOString() });

async function main() {
  console.log("Option 3 Pass 1 — honest-relabel safety self-test");
  console.log("=================================================");
  const before = {
    autos: await db.automation.count(), contacts: await db.contact.count(),
    records: await db.record.count(), tenants: await db.tenant.count(),
  };
  console.log(`Real rows before — automations:${before.autos} contacts:${before.contacts} records:${before.records} tenants:${before.tenants}\n`);

  // ---------- (a) KEYS INTACT ----------
  console.log("(a) action keys intact (none renamed/removed, no new key):");
  const keys = ACTION_TYPES.map((a: any) => a.type).sort();
  check(JSON.stringify(keys) === JSON.stringify(EXPECTED_KEYS), `registry has exactly the expected ${EXPECTED_KEYS.length} keys`);
  check(FOUR.every((k) => keys.includes(k)), "the four relabeled keys all still present");
  console.log("  current labels (for your read-through):");
  for (const k of FOUR) {
    const a: any = ACTION_TYPES.find((x: any) => x.type === k);
    console.log(`    ${k}  ->  “${a ? a.label : "(missing!)"}”  — ${a ? a.description : ""}`);
  }

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    const mkContact = (name: string, extra: any = {}) => db.contact.create({ data: { tenantId: tId, name, email: `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.invalid`, phone: null, ...extra } });
    const mkAuto = (name: string, actions: any[]) => db.automation.create({ data: { tenantId: tId, name, enabled: true, triggerType: "ContactCreated", conditions: [], actions } }).then((a: any) => a.id);
    const setEnabled = (id: string, enabled: boolean) => db.automation.update({ where: { id }, data: { enabled } });

    // ---------- (b) BEHAVIOR INTACT — still acts on CONTACTS ----------
    console.log("\n(b) behavior intact — the four still act on Contacts (not Records):");

    // create_record -> creates a CONTACT
    const c0 = await mkContact("RelabelTrigger");
    const aCreate = await mkAuto("relabel create test", [
      { type: "create_record", config: { values: [{ field: "name", value: "Relabel Created" }, { field: "email", value: "relabelcreated@example.invalid" }, { field: "phone", value: "+15550000001" }] } },
    ]);
    await fireCreated(tId, c0.id);
    const created = await db.contact.findFirst({ where: { tenantId: tId, email: "relabelcreated@example.invalid" } });
    check(!!created, "create_record created a CONTACT");
    check((await db.record.count({ where: { tenantId: tId } })) === 0, "create_record created NO Record");
    await setEnabled(aCreate, false);

    // search_records + update_record -> finds & updates a CONTACT
    const target = await mkContact("RELABELTARGET", { intent: "" });
    const subj1 = await mkContact("RelabelSubjectA");
    const aFindUpd = await mkAuto("relabel find+update test", [
      { type: "search_records", config: { conditions: [{ field: "name", op: "is", value: "RELABELTARGET" }] } },
      { type: "update_record", config: { target: "search", values: [{ field: "intent", value: "TOUCHED" }] } },
    ]);
    await fireCreated(tId, subj1.id);
    const touched = await db.contact.findUnique({ where: { id: target.id } });
    check(!!touched && touched.intent === "TOUCHED", "search_records found a CONTACT and update_record updated it");
    check((await db.record.count({ where: { tenantId: tId } })) === 0, "find/update changed NO Record");
    await setEnabled(aFindUpd, false);

    // search_records + delete_record -> soft-deletes a CONTACT
    const delme = await mkContact("RELABELDELME");
    const subj2 = await mkContact("RelabelSubjectB");
    const aFindDel = await mkAuto("relabel find+delete test", [
      { type: "search_records", config: { conditions: [{ field: "name", op: "is", value: "RELABELDELME" }] } },
      { type: "delete_record", config: { target: "search" } },
    ]);
    await fireCreated(tId, subj2.id);
    const deleted = await db.contact.findUnique({ where: { id: delme.id } });
    check(!!deleted && deleted.deletedAt != null, "delete_record soft-deleted a CONTACT (recycle bin)");
    check((await db.record.count({ where: { tenantId: tId } })) === 0, "delete changed NO Record");

    // ---------- (c) NO STRAY KEY CHANGES ----------
    console.log("\n(c) no stray changes to other action keys:");
    check(JSON.stringify(ACTION_TYPES.map((a: any) => a.type).sort()) === JSON.stringify(EXPECTED_KEYS), "the full key set is still exactly as expected");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  // ---------- (d) REAL DATA UNTOUCHED ----------
  console.log("\n(d) real data untouched:");
  const after = {
    autos: await db.automation.count(), contacts: await db.contact.count(),
    records: await db.record.count(), tenants: await db.tenant.count(),
  };
  check(after.autos === before.autos, `automations unchanged (${before.autos} -> ${after.autos})`);
  check(after.contacts === before.contacts, `contacts unchanged (${before.contacts} -> ${after.contacts})`);
  check(after.records === before.records, `records unchanged (${before.records} -> ${after.records})`);
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);

  console.log("\n=================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (relabel is display-only; keys + behavior unchanged)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
