// Real-Prisma self-test for Batch A — Status + subtype in the record importer.
//
//   npx tsx src/db/selfTest_recordImportStatusSubtype.ts     (needs dev Postgres)
//
// The importer maps a file's Status/Type columns through to stageKey/subtypeKey and
// posts to /api/records/import -> bulkCreateRecords (which the server already accepts
// and validates). This test covers the Prisma path plus mirrors of the two tiny
// client helpers (resolveChoice / ignoredColumns).
//
// Asserts:
//   (1) A record import with a Status column + a Type column lands the values on the
//       created records (status -> stageKey, subtype -> subtypeKey), via the REAL
//       bulkCreateRecords path. Labels in the file resolve to the canonical keys.
//   (2) NEGATIVE: an invalid subtype is handled by the existing server validation
//       (it falls back to the type's default subtype, not the bogus value).
//   (3) An unmapped file column is reported by the ignored-columns note (mirror),
//       not silently lost.
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { bulkCreateRecords } from "../services/recordService";
import { resolveRecordTypeId } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_REC_IMPORT_STATUS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// ---- mirrors of portal.js openRecordImport (kept tiny + in sync) ----
function resolveChoice(list: any[], val: any) {
  const s = String(val == null ? "" : val).trim();
  if (!s) return "";
  const low = s.toLowerCase();
  const hit = (list || []).find((o) => String(o.key).toLowerCase() === low || String(o.label).toLowerCase() === low);
  return hit ? hit.key : s;
}
function ignoredColumns(headers: string[], usedIdx: number[]) {
  const used = new Set(usedIdx.filter((i) => i >= 0));
  return headers.filter((h, i) => !used.has(i) && h !== "");
}

async function main() {
  console.log("Batch A — record import Status + subtype mapping (real Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "recimport@example.invalid" } })).id;
    // Ensure the default "job" type (subtypes: technical/...; recordStages: open/on_hold/filled/closed).
    const rtId = await resolveRecordTypeId(tId, "job");
    const rt = await db.recordType.findFirst({ where: { tenantId: tId, id: rtId } });
    const stageList = (rt && rt.recordStages) || [];
    const subtypeList = (rt && rt.subtypes) || [];
    check(stageList.length > 0 && subtypeList.length > 0, `job type has stages (${stageList.length}) + subtypes (${subtypeList.length})`);
    const firstSubtype = subtypeList[0].key;

    console.log("\n(1) A Status + Type column lands on the records (labels resolve to keys):");
    // Simulate the client: file cells (as an export would hold them — labels), run
    // through resolveChoice, then the REAL bulkCreateRecords path.
    const rowsToPost = [
      { title: "Job A", stageKey: resolveChoice(stageList, "On hold"), subtypeKey: resolveChoice(subtypeList, "Technical"), customFields: {} },
      { title: "Job B", stageKey: resolveChoice(stageList, "filled"), subtypeKey: resolveChoice(subtypeList, subtypeList[1] ? subtypeList[1].label : firstSubtype), customFields: {} },
    ];
    check(rowsToPost[0].stageKey === "on_hold", `Status label "On hold" resolved to key "on_hold" (got "${rowsToPost[0].stageKey}")`);
    check(rowsToPost[0].subtypeKey === firstSubtype, `Type label "Technical" resolved to key "${firstSubtype}" (got "${rowsToPost[0].subtypeKey}")`);
    const res1 = await bulkCreateRecords(tId, "job", rowsToPost);
    check(res1.imported === 2, `both rows imported (${res1.imported})`);
    const jobA = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: rtId, title: "Job A" } });
    check(!!jobA && jobA.stageKey === "on_hold", `Job A landed stageKey "on_hold" (got "${jobA && jobA.stageKey}")`);
    check(!!jobA && jobA.subtypeKey === firstSubtype, `Job A landed subtypeKey "${firstSubtype}" (got "${jobA && jobA.subtypeKey}")`);

    console.log("\n(2) NEGATIVE — invalid subtype handled by server validation (defaults):");
    const res2 = await bulkCreateRecords(tId, "job", [
      { title: "Job Bogus", stageKey: resolveChoice(stageList, "open"), subtypeKey: resolveChoice(subtypeList, "NotARealSubtype"), customFields: {} },
    ]);
    check(res2.imported === 1, "row with a bogus subtype still imports");
    const jobBogus = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: rtId, title: "Job Bogus" } });
    check(!!jobBogus && jobBogus.subtypeKey === firstSubtype, `bogus subtype fell back to the default "${firstSubtype}" (got "${jobBogus && jobBogus.subtypeKey}"), not the bogus value`);
    check(!!jobBogus && jobBogus.stageKey === "open", "its valid stage still landed");

    console.log("\n(3) Unmapped file columns are reported (ignored-columns note):");
    const headers = ["Title", "Status", "Type", "SomeRandomColumn"];
    // mapped: Title->0, Status->1, Type->2 ; column index 3 is left unmapped.
    const ignored = ignoredColumns(headers, [0, 1, 2]);
    check(ignored.length === 1 && ignored[0] === "SomeRandomColumn", `the unmapped column is reported (got [${ignored.join(", ")}])`);
    const ignoredNone = ignoredColumns(headers, [0, 1, 2, 3]);
    check(ignoredNone.length === 0, "when every column is mapped, nothing is reported");
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
