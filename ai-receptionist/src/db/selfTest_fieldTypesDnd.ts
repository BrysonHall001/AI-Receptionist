// Self-test for the new Currency + File field types AND the drag-from-library create
// path (the server side of Task 2). Talks to the real services the API calls.
//
//   npx tsx src/db/selfTest_fieldTypesDnd.ts
//
// SAFETY: one clearly-named TEMPORARY tenant, deleted at the end (cascade). Captures
// real counts before/after and asserts they're unchanged.
//
// PROVES:
//  (A) "currency" and "file" are first-class FIELD_TYPES.
//  (B) createField accepts both (NEW TYPES WORK — see the two "createField creates a
//      … field" lines).
//  (C) The drop path — createField({ recordType, label, type, sectionId }) — creates a
//      field of the dropped type in the target section with a default label (DROP
//      CREATES A FIELD — see the "drop-path createField places …" line), without
//      touching existing fields' keys, and reorder still works.
//  (D) A currency field stores/reads a numeric value; a file field stores/reads an
//      attachment reference ({ name, data }) parallel to image; import coercion treats
//      currency as numeric.
//  (E) Both are editable (relabel/retype) and deletable.
import { prisma, disconnectDb } from "./client";
import { FIELD_TYPES, createField, updateField, deleteField, reorderFields, listFields } from "../services/fieldService";
import { createSection } from "../services/fieldSectionService";
import { createRecord, getRecord, coerceCustomValue } from "../services/recordService";
import { ensureAllSystemRecordTypes, EQUIPMENT_RECORD_TYPE_KEY } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_FIELDTYPES_DND__";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

async function main() {
  console.log("Currency + File field types & drag-to-create self-test");
  console.log("======================================================\n");
  const before = { fields: await db.fieldDef.count(), records: await db.record.count(), tenants: await db.tenant.count() };
  console.log(`Real rows before — fields:${before.fields} records:${before.records} tenants:${before.tenants}\n`);

  let tId = "";
  try {
    // (A) registry
    console.log("(A) registry:");
    check(FIELD_TYPES.includes("currency" as any), '"currency" is a FIELD_TYPE');
    check(FIELD_TYPES.includes("file" as any), '"file" is a FIELD_TYPE');

    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    await ensureAllSystemRecordTypes(tId);
    const EQ = EQUIPMENT_RECORD_TYPE_KEY;

    // (B) NEW TYPES WORK — createField accepts currency + file.
    console.log("\n(B) new types work (createField):");
    const priceField = await createField(tId, { label: "Price", type: "currency" }, EQ);
    check(priceField && priceField.type === "currency", "createField creates a CURRENCY field");
    const docField = await createField(tId, { label: "Manual", type: "file" }, EQ);
    check(docField && docField.type === "file", "createField creates a FILE field");

    // (C) DROP CREATES A FIELD — createField with a sectionId + default label, exactly
    //     what the library-drop handler posts.
    console.log("\n(C) drag-from-library create path:");
    const section = await createSection(tId, EQ, "Details");
    const beforeKeys = (await listFields(tId, EQ)).map((f: any) => f.key).sort();
    const dropped = await createField(tId, { label: "Currency", type: "currency", sectionId: section.id }, EQ);
    check(!!dropped && dropped.type === "currency" && dropped.sectionId === section.id, "drop-path createField places a new field of the dropped type in the target section");
    check(dropped.label === "Currency", "dropped field gets the type's friendly name as a default label");
    const afterKeys = (await listFields(tId, EQ)).map((f: any) => f.key).sort();
    check(beforeKeys.every((k: string) => afterKeys.includes(k)), "existing fields' keys are unchanged after a drop-create");
    // reorder still works (put the dropped field first).
    const ids = (await listFields(tId, EQ)).map((f: any) => f.id);
    const reordered = [dropped.id, ...ids.filter((i: string) => i !== dropped.id)];
    await reorderFields(tId, reordered, EQ);
    const orderNow = (await listFields(tId, EQ)).slice().sort((a: any, b: any) => a.order - b.order).map((f: any) => f.id);
    check(orderNow[0] === dropped.id, "reorderFields still works after adding fields");

    // (D) store / read values.
    console.log("\n(D) values store + read back:");
    const fileRef = { name: "spec.pdf", data: "data:application/pdf;base64,JVBERi0xLjQK" };
    const rec = await createRecord(tId, EQ, { title: "Drill", customFields: { [priceField.key]: 1234.5, [docField.key]: fileRef } });
    const read = await getRecord(tId, rec.id);
    check(read && (read as any).customFields[priceField.key] === 1234.5, "currency field stores/reads a NUMERIC value");
    const rf = read && (read as any).customFields[docField.key];
    check(!!rf && rf.name === "spec.pdf" && typeof rf.data === "string" && rf.data.indexOf("data:") === 0, "file field stores/reads an ATTACHMENT reference ({name,data}) like image");
    const coerced = coerceCustomValue({ type: "currency" }, "$1,234.50");
    check((coerced as any).value === 1234.5, "import coercion treats currency as numeric ($1,234.50 -> 1234.5)");

    // (E) editable + deletable.
    console.log("\n(E) editable + deletable:");
    const relabeled = await updateField(tId, priceField.id, { label: "List price" });
    check(relabeled.label === "List price", "a currency field is editable (relabel)");
    const retyped = await updateField(tId, docField.id, { type: "text" });
    check(retyped.type === "text", "a field's type is editable");
    await deleteField(tId, dropped.id);
    const afterDel = (await listFields(tId, EQ)).map((f: any) => f.id);
    check(!afterDel.includes(dropped.id), "a field is deletable");
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

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (currency + file types work; drag-from-library creates a field)" : failures.length + " FAILED \u274c"}`);
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}
main();
