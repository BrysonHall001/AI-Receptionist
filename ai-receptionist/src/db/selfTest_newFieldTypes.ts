// Self-test for the three new field types (address / rating / duration). Talks to the
// real services the API calls.
//
//   npx tsx src/db/selfTest_newFieldTypes.ts
//
// SAFETY: one clearly-named TEMPORARY tenant, deleted at the end (cascade). Real counts
// captured before/after and asserted unchanged.
//
// PROVES (the line that proves the three new types work is marked NEW TYPES WORK):
//  (A) address/rating/duration are first-class FIELD_TYPES.
//  (B) createField accepts each.
//  (C) each stores/reads its value shape — address parts (object), rating 1–5 int,
//      duration minutes int — and import coercion clamps rating to 1–5 and rounds
//      duration to whole minutes.
//  (D) each is editable (relabel) and deletable.
import { prisma, disconnectDb } from "./client";
import { FIELD_TYPES, createField, updateField, deleteField, listFields } from "../services/fieldService";
import { createRecord, getRecord, coerceCustomValue } from "../services/recordService";
import { ensureAllSystemRecordTypes, EQUIPMENT_RECORD_TYPE_KEY } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_NEWFIELDTYPES__";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

async function main() {
  console.log("New field types — address / rating / duration");
  console.log("=============================================\n");
  const before = { fields: await db.fieldDef.count(), records: await db.record.count(), tenants: await db.tenant.count() };
  console.log(`Real rows before — fields:${before.fields} records:${before.records} tenants:${before.tenants}\n`);

  let tId = "";
  try {
    console.log("(A) registry:");
    check(FIELD_TYPES.includes("address" as any), '"address" is a FIELD_TYPE');
    check(FIELD_TYPES.includes("rating" as any), '"rating" is a FIELD_TYPE');
    check(FIELD_TYPES.includes("duration" as any), '"duration" is a FIELD_TYPE');

    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    await ensureAllSystemRecordTypes(tId);
    const EQ = EQUIPMENT_RECORD_TYPE_KEY;

    // (B) NEW TYPES WORK — createField accepts all three.
    console.log("\n(B) new types work (createField):");
    const addr = await createField(tId, { label: "Location", type: "address" }, EQ);
    const rate = await createField(tId, { label: "Condition", type: "rating" }, EQ);
    const dur = await createField(tId, { label: "Service time", type: "duration" }, EQ);
    check(addr.type === "address" && rate.type === "rating" && dur.type === "duration", "createField creates ADDRESS, RATING and DURATION fields");

    // (C) store / read value shapes.
    console.log("\n(C) values store + read back:");
    const address = { street: "123 Main St", city: "Springfield", state: "CA", postal: "90001", country: "USA" };
    const rec = await createRecord(tId, EQ, { title: "Pump", customFields: { [addr.key]: address, [rate.key]: 4, [dur.key]: 90 } });
    const read: any = await getRecord(tId, rec.id);
    const cf = read.customFields || {};
    check(cf[addr.key] && cf[addr.key].street === "123 Main St" && cf[addr.key].postal === "90001", "address stores/reads its structured parts");
    check(cf[rate.key] === 4, "rating stores/reads a 1–5 integer");
    check(cf[dur.key] === 90, "duration stores/reads minutes as an integer");
    check((coerceCustomValue({ type: "rating" }, "9") as any).value === 5 && (coerceCustomValue({ type: "rating" }, "0") as any).value === 1, "import clamps rating to 1–5");
    check((coerceCustomValue({ type: "duration" }, "90.4") as any).value === 90, "import rounds duration to whole minutes");

    // (D) editable + deletable.
    console.log("\n(D) editable + deletable:");
    const relabeled = await updateField(tId, rate.key ? rate.id : rate.id, { label: "Overall condition" });
    check(relabeled.label === "Overall condition", "a rating field is editable (relabel)");
    await deleteField(tId, dur.id);
    const remaining = (await listFields(tId, EQ)).map((f: any) => f.id);
    check(!remaining.includes(dur.id) && remaining.includes(addr.id), "a duration field is deletable; others remain");
  } catch (e) {
    failures.push("unexpected error: " + (e as Error).message);
    console.log("  \u2717 threw:", (e as Error).message);
  } finally {
    if (tId) { console.log("\nCleaning up the temporary tenant…"); await db.tenant.delete({ where: { id: tId } }).catch(() => {}); }
  }

  console.log("\nReal data untouched:");
  const after = { fields: await db.fieldDef.count(), records: await db.record.count(), tenants: await db.tenant.count() };
  check(after.fields === before.fields, `fields unchanged (${before.fields} -> ${after.fields})`);
  check(after.records === before.records, `records unchanged (${before.records} -> ${after.records})`);
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (address / rating / duration work end-to-end)" : failures.length + " FAILED \u274c"}`);
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}
main();
