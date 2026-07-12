// Self-test for the two new field types: "time" and "datetime".
//
//   npx tsx src/db/selfTest_timeDatetimeFields.ts     (needs dev Postgres)
//
// Proves:
//  (1) FIELD_TYPES includes "time" and "datetime", and createField ACCEPTS them.  <-- new types
//  (2) values store + read back on a record (round-trip through customFields).
//  (3) the import coercion (coerceCustomValue) normalizes friendly input to storage form:
//      time "2:30 PM" -> "14:30"; datetime "6/5/2026 2:30 PM" -> "2026-06-05T14:30".
//  (4) the client exposes friendly labels ("Time", "Date & time") in TYPE_LABELS.
import { prisma, disconnectDb } from "./client";
import { FIELD_TYPES, createField, listFields } from "../services/fieldService";
import { createRecord, getRecord, coerceCustomValue } from "../services/recordService";
import { readFileSync } from "fs";
import { resolve } from "path";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
async function mkTenant() {
  const t = await prisma.tenant.create({ data: { name: `tdt-${stamp}-${Math.random().toString(36).slice(2, 6)}`, notifyEmail: `tdt-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}

async function main() {
  console.log("New field types — Time + Date & time");
  console.log("====================================");

  // (1) registered + accepted by createField.
  check((FIELD_TYPES as readonly string[]).includes("time"), "FIELD_TYPES includes 'time'");
  check((FIELD_TYPES as readonly string[]).includes("datetime"), "FIELD_TYPES includes 'datetime'");

  const T = await mkTenant();
  const timeField = await createField(T, { label: "Appt time", type: "time" }, "task");
  const dtField = await createField(T, { label: "Follow up at", type: "datetime" }, "task");
  check(!!timeField && (timeField as any).type === "time", "createField accepts a 'time' field");
  check(!!dtField && (dtField as any).type === "datetime", "createField accepts a 'datetime' field");
  const fieldTypes = new Set((await listFields(T, "task")).map((f: any) => f.type));
  check(fieldTypes.has("time") && fieldTypes.has("datetime"), "both new fields are listed on the record type");

  // (2) round-trip a record's values.
  const tKey = (timeField as any).key, dKey = (dtField as any).key;
  const rec: any = await createRecord(T, "task", { title: "Roundtrip", customFields: { [tKey]: "14:30", [dKey]: "2026-06-05T14:30" } });
  const read: any = await getRecord(T, rec.id);
  check(read?.customFields?.[tKey] === "14:30", "a 'time' value stores + reads back unchanged");
  check(read?.customFields?.[dKey] === "2026-06-05T14:30", "a 'datetime' value stores + reads back unchanged");

  // (3) import coercion normalizes friendly input.
  const tc = coerceCustomValue({ type: "time" }, "2:30 PM");
  check(tc.value === "14:30", `import coerces time "2:30 PM" -> "14:30" (got ${JSON.stringify(tc)})`);
  const tc2 = coerceCustomValue({ type: "time" }, "9:05");
  check(tc2.value === "09:05", `import coerces time "9:05" -> "09:05" (got ${JSON.stringify(tc2)})`);
  const dc = coerceCustomValue({ type: "datetime" }, "6/5/2026 2:30 PM");
  check(dc.value === "2026-06-05T14:30", `import coerces datetime "6/5/2026 2:30 PM" -> "2026-06-05T14:30" (got ${JSON.stringify(dc)})`);
  const bad = coerceCustomValue({ type: "time" }, "not a time");
  check(!!bad.error, "import reports an error for an unrecognizable time (never crashes)");

  // (4) client friendly labels.
  const fields = readFileSync(resolve(__dirname, "../../public/js/fields.js"), "utf8");
  check(/time:\s*"Time"/.test(fields), 'client TYPE_LABELS has time: "Time"');
  check(/datetime:\s*"Date & time"/.test(fields), 'client TYPE_LABELS has datetime: "Date & time"');
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (time + datetime: registered, accepted, stored, coerced, labeled)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
