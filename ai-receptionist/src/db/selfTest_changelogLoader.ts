// Real-Prisma self-test for the Change Log loader (Batch 1).
//
//   npx tsx src/db/selfTest_changelogLoader.ts      (needs dev Postgres + this batch's migration applied)
//
// PROVES (through the REAL service + REAL Prisma — the same path the seed uses):
//   * upsertChangeLogEntry creates a row the first time (returns "created") and
//     listChangeLog returns it.
//   * Re-running with the SAME commitSha does NOT duplicate (idempotency — the
//     "correctly does nothing new" case): still exactly ONE row, returns "updated",
//     and an edited description is applied (update, not insert).
//   * A row with NO commitSha is created (can't be de-duplicated) — documented
//     behavior, not a bug.
//
// SAFETY: uses unique throwaway commitShas and deletes everything it created.

import { prisma, disconnectDb } from "./client";
import { upsertChangeLogEntry, listChangeLog } from "../services/changelogService";

const db = prisma as any;
const SHA = "__selftest_cl_" + Date.now();
const NOSHA_DESC = "__selftest_nosha_" + Date.now();

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Change Log loader — real Prisma idempotency");
  console.log("=====================================================================\n");
  const before = await db.changeLogEntry.count();
  let noShaId = "";

  try {
    console.log("(Create) first upsert inserts the row:");
    {
      const r1 = await upsertChangeLogEntry({ date: "2026-06-23", type: "Feature", description: "First write.", commitSha: SHA });
      check(r1 === "created", `first upsert returns "created" (got "${r1}")`);
      const n = await db.changeLogEntry.count({ where: { commitSha: SHA } });
      check(n === 1, `exactly 1 row for the sha (got ${n})`);
      const list = await listChangeLog();
      check(list.some((e: any) => e.commitSha === SHA), "listChangeLog returns the new row");
    }

    console.log("\n(Idempotency) re-running the SAME commitSha does NOT duplicate:");
    {
      const r2 = await upsertChangeLogEntry({ date: "2026-06-23", type: "Feature", description: "Edited write.", commitSha: SHA });
      check(r2 === "updated", `second upsert returns "updated" (got "${r2}")`);
      const n = await db.changeLogEntry.count({ where: { commitSha: SHA } });
      check(n === 1, `STILL exactly 1 row for the sha — no duplicate (got ${n})`);
      const row = await db.changeLogEntry.findUnique({ where: { commitSha: SHA } });
      check(!!row && row.description === "Edited write.", "description was updated in place");
    }

    console.log("\n(No-sha) a row without a commitSha is created (cannot de-dupe):");
    {
      const r3 = await upsertChangeLogEntry({ date: "2026-06-23", type: "Infra", description: NOSHA_DESC });
      check(r3 === "created-no-sha", `no-sha upsert returns "created-no-sha" (got "${r3}")`);
      const row = await db.changeLogEntry.findFirst({ where: { description: NOSHA_DESC } });
      check(!!row, "no-sha row exists");
      noShaId = row ? row.id : "";
    }
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try {
      await db.changeLogEntry.deleteMany({ where: { commitSha: SHA } });
      if (noShaId) await db.changeLogEntry.delete({ where: { id: noShaId } });
    } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  const after = await db.changeLogEntry.count();
  check(after === before, `row count back to baseline (${before} -> ${after})`);

  console.log("\n=====================================================================");
  console.log("NOTE: the page itself (hub nav link, empty state, role-gating) is verified");
  console.log("by you in the browser.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
