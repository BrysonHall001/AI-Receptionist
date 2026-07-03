// Real-Prisma self-test for Batch C — import coercion, required enforcement, report.
//
//   npx tsx src/db/selfTest_recordImportCoercion.ts     (needs dev Postgres)
//
// Coercion + required enforcement live in the REAL bulkCreateRecords path. Asserts:
//   (1) a number custom field imports as a TYPED number (not a string);
//   (2) a date custom field imports wall-clock-correct — day-boundary, no TZ shift
//       (Excel serial for 11:30 PM stays the SAME calendar day);
//   (3) NEGATIVE: an uncoercible number ("abc") is skipped with a reported reason,
//       the row still imports (field left empty), nothing crashes;
//   (4) a row missing a REQUIRED custom field is skipped + reported, not imported;
//   (5) the report lists skipped rows (server) + ignored columns (client mirror).
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { bulkCreateRecords } from "../services/recordService";
import { resolveRecordTypeId } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_IMPORT_COERCION__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// mirror of the client ignored-columns note (portal.js)
function ignoredColumns(headers: string[], usedIdx: number[]) {
  const used = new Set(usedIdx.filter((i) => i >= 0));
  return headers.filter((h, i) => !used.has(i) && h !== "");
}

async function main() {
  console.log("Batch C — import coercion / required / reporting (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "coerce@example.invalid" } })).id;
    const rtId = await resolveRecordTypeId(tId, "job");
    await db.fieldDef.create({ data: { tenantId: tId, recordTypeId: rtId, scope: "record", key: "budget", label: "Budget", type: "number", required: false } });
    await db.fieldDef.create({ data: { tenantId: tId, recordTypeId: rtId, scope: "record", key: "due", label: "Due", type: "date", required: false } });
    await db.fieldDef.create({ data: { tenantId: tId, recordTypeId: rtId, scope: "record", key: "priority", label: "Priority", type: "text", required: true } });

    const serial2330 = (Date.UTC(2026, 5, 20, 23, 30) - Date.UTC(1899, 11, 30)) / 86400000; // 2026-06-20 11:30 PM

    const res = await bulkCreateRecords(tId, "job", [
      { title: "J1", customFields: { budget: "42", due: "6/20/2026", priority: "High" } },        // row 1 ok
      { title: "J2", customFields: { due: String(serial2330), priority: "Low" } },                 // row 2 date day-boundary
      { title: "J3", customFields: { budget: "abc", priority: "Med" } },                            // row 3 uncoercible budget
      { title: "J4", customFields: { budget: "5" } },                                               // row 4 missing required Priority
    ]);

    console.log("(1) Number custom field imports as a TYPED number:");
    const j1 = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: rtId, title: "J1" } });
    check(!!j1 && typeof j1.customFields.budget === "number", `budget stored as number (got ${j1 && typeof j1.customFields.budget})`);
    check(!!j1 && j1.customFields.budget === 42, "budget value is 42 (sortable/filterable as a number)");
    check(!!j1 && j1.customFields.priority === "High", "text field preserved");

    console.log("\n(2) Date custom field imports wall-clock-correct (no day/TZ drift):");
    check(!!j1 && j1.customFields.due === "2026-06-20", `plain date "6/20/2026" -> "2026-06-20" (got "${j1 && j1.customFields.due}")`);
    const j2 = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: rtId, title: "J2" } });
    check(!!j2 && j2.customFields.due === "2026-06-20", `Excel serial 11:30 PM stays "2026-06-20" — NOT rolled to the 21st (got "${j2 && j2.customFields.due}")`);

    console.log("\n(3) NEGATIVE — uncoercible number skipped + reported, row still imports:");
    const j3 = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: rtId, title: "J3" } });
    check(!!j3, "row with a bad number value still imported");
    check(!!j3 && j3.customFields.budget === undefined, "the bad budget value was dropped (field left empty)");
    const vw = (res.valueWarnings || []).find((w: any) => w.row === 3 && w.field === "Budget");
    check(!!vw, `a value warning was reported for the bad budget (${JSON.stringify(res.valueWarnings)})`);

    console.log("\n(4) Row missing a REQUIRED custom field is skipped, not imported:");
    const j4 = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: rtId, title: "J4" } });
    check(!j4, "J4 (missing required Priority) was NOT imported");
    const sr = (res.skippedRows || []).find((s: any) => s.row === 4);
    check(!!sr && /Priority/i.test(sr.reason), `skip reported with the required field name (${JSON.stringify(res.skippedRows)})`);

    console.log("\n(5) Report totals + ignored-columns mirror:");
    check(res.imported === 3 && res.skipped === 1, `imported 3 / skipped 1 (got ${res.imported}/${res.skipped})`);
    const ignored = ignoredColumns(["Title", "Budget", "Due", "Priority", "ExtraNote"], [0, 1, 2, 3]);
    check(ignored.length === 1 && ignored[0] === "ExtraNote", `ignored-columns note lists the unmapped column (got [${ignored.join(", ")}])`);
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try {
      if (tId) {
        await db.record.deleteMany({ where: { tenantId: tId } });
        await db.fieldDef.deleteMany({ where: { tenantId: tId } });
        await db.recordType.deleteMany({ where: { tenantId: tId } });
        await db.tenant.deleteMany({ where: { name: T_NAME } });
      }
    } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  const after = await db.tenant.count();
  check(after === before, `real tenants unchanged (${before} -> ${after})`);

  console.log("\n=====================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
