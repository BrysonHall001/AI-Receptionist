// Self-test for the new "line_items" repeating-row field type. Talks to the real services.
//
//   npx tsx src/db/selfTest_lineItems.ts        (needs dev Postgres)
//
// SAFETY: one clearly-named TEMPORARY tenant, deleted at the end (cascade). Real counts
// captured before/after and asserted unchanged.
//
// PROVES: (a) "line_items" is a FIELD_TYPE and createField accepts it; (b) a record stores
// an array of {description,quantity,unitPrice} rows and reads them back; (c) THE TOTALS MATH
// — rows [{q:2,p:40},{q:1,p:450}] -> line totals 80 + 450, grand total 530; (d) import
// coercion ignores fully-empty rows and coerces negative qty/price to 0; (e) the total is
// exposed as a NUMBER for reporting and export shows a readable summary.
import { prisma, disconnectDb } from "./client";
import { FIELD_TYPES, createField, updateField, deleteField, listFields } from "../services/fieldService";
import { createRecord, getRecord, coerceCustomValue } from "../services/recordService";
import { liTotal, liSummary } from "../services/reportExecutor";
import { ensureAllSystemRecordTypes, EQUIPMENT_RECORD_TYPE_KEY } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_LINEITEMS__";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

async function main() {
  console.log("Line items field type — safety proof");
  console.log("===================================\n");
  const before = { fields: await db.fieldDef.count(), records: await db.record.count(), tenants: await db.tenant.count() };
  console.log(`Real rows before — fields:${before.fields} records:${before.records} tenants:${before.tenants}\n`);

  let tId = "";
  try {
    console.log("(a) registry + createField:");
    check(FIELD_TYPES.includes("line_items" as any), '"line_items" is a FIELD_TYPE');
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    await ensureAllSystemRecordTypes(tId);
    const EQ = EQUIPMENT_RECORD_TYPE_KEY;
    const field: any = await createField(tId, { label: "Line items", type: "line_items" }, EQ);
    check(field && field.type === "line_items", "createField creates a LINE_ITEMS field");

    console.log("\n(b) store + read the rows:");
    const rows = [{ description: "Labor", quantity: 2, unitPrice: 40 }, { description: "Part", quantity: 1, unitPrice: 450 }];
    const rec: any = await createRecord(tId, EQ, { title: "Invoice-ish", customFields: { [field.key]: rows } });
    const read: any = await getRecord(tId, rec.id);
    const stored = (read.customFields || {})[field.key];
    check(Array.isArray(stored) && stored.length === 2 && stored[0].description === "Labor" && stored[1].unitPrice === 450, "the array of rows stores and reads back intact");

    console.log("\n(c) totals math:");
    const lineTotals = stored.map((r: any) => r.quantity * r.unitPrice);
    check(lineTotals[0] === 80 && lineTotals[1] === 450, "line totals are 80 and 450 (qty × unit price)");
    check(liTotal(stored) === 530, "TOTALS MATH: rows [{q:2,p:40},{q:1,p:450}] sum to 530");

    console.log("\n(d) import coercion — empties ignored, negatives coerced:");
    const messy = JSON.stringify([{ description: "", quantity: 0, unitPrice: 0 }, { description: "Ok", quantity: -3, unitPrice: -10 }, { description: "Good", quantity: 2, unitPrice: 25 }]);
    const coerced: any = coerceCustomValue({ type: "line_items" }, messy);
    check(Array.isArray(coerced.value) && coerced.value.length === 2, "fully-empty rows are dropped on import");
    check(coerced.value[0].quantity === 0 && coerced.value[0].unitPrice === 0, "negative qty/price are coerced to 0 (safe)");
    check(liTotal(coerced.value) === 50, "coerced import total is correct (2 × 25 = 50)");
    const allEmpty: any = coerceCustomValue({ type: "line_items" }, JSON.stringify([{ description: "", quantity: "", unitPrice: "" }]));
    check(allEmpty.empty === true, "an all-empty line_items import is treated as empty");

    console.log("\n(e) total exposed as a number + readable export:");
    check(typeof liTotal(stored) === "number" && liTotal(stored) === 530, "the field total is available as a NUMBER for reporting/aggregation");
    check(liSummary(stored) === "2 items · $530.00", "export/summary shows a readable representation (\"2 items · $530.00\")");
    check(liTotal("not an array" as any) === 0 && liSummary(null) === "", "total/summary never throw on odd values (no data path crashes)");

    console.log("\n(f) editable + deletable:");
    const relabeled: any = await updateField(tId, field.id, { label: "Charges" });
    check(relabeled.label === "Charges", "a line_items field is editable (relabel)");
    await deleteField(tId, field.id);
    check(!(await listFields(tId, EQ)).some((f: any) => f.id === field.id), "a line_items field is deletable");
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

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705  (line_items stores rows; totals math correct; total exposed as a number)" : failures.length + " FAILED \u274c: " + failures.join("; ")}`);
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}
main();
