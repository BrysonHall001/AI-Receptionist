// Real-Prisma self-test for Part 3 — Change Log explicit dating.
//
//   npx tsx src/db/selfTest_changelogExplicitDate.ts     (needs dev Postgres)
//
// Proves a Change Log entry stores the date it is GIVEN, verbatim — never "now",
// never anything derived from a commit. Goes through the real service + Prisma path
// (upsertChangeLogEntry → listChangeLog), the same code the seed loader uses.
//   * an entry created with an explicit past date (Jan 15) reads back as Jan 15,
//     proving the date is independent of when the row is created;
//   * an entry created for the intended work date (Jun 24) reads back as Jun 24.
//
// SAFETY: writes two clearly-tagged rows and deletes them at the end.

import { prisma, disconnectDb } from "./client";
import { upsertChangeLogEntry, listChangeLog } from "../services/changelogService";

const db = prisma as any;
const TAG = "__selftest_cldate_" + Date.now();

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const dayOf = (iso: string) => String(iso || "").slice(0, 10);

async function main() {
  console.log("Part 3 — Change Log explicit dating (real Prisma)");
  console.log("=====================================================================\n");
  const shaPast = TAG + "_past";
  const shaWork = TAG + "_work";

  try {
    // Today is June 24, 2026; deliberately pick a date far from "now" to prove the
    // stored date is the one we set, not the creation time.
    const r1 = await upsertChangeLogEntry({ date: "2026-01-15T00:00:00.000Z", type: "Feature", description: "explicit past date", commitSha: shaPast });
    check(r1 === "created", "entry created via the real upsert path");

    const r2 = await upsertChangeLogEntry({ date: "2026-06-24T00:00:00.000Z", type: "Feature", description: "intended work date", commitSha: shaWork });
    check(r2 === "created", "second entry created");

    const all = await listChangeLog(5000);
    const past = all.find((r: any) => r.commitSha === shaPast);
    const work = all.find((r: any) => r.commitSha === shaWork);

    check(!!past && dayOf(past.date) === "2026-01-15", `explicit past date stored verbatim (got ${past && dayOf(past.date)})`);
    check(!!past && dayOf(past.date) !== dayOf(new Date().toISOString()), "stored date is NOT the creation date (not derived from 'now'/commit)");
    check(!!work && dayOf(work.date) === "2026-06-24", `intended work date stored as June 24 (got ${work && dayOf(work.date)})`);
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { await db.changeLogEntry.deleteMany({ where: { commitSha: { in: [shaPast, shaWork] } } }); }
    catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  console.log("\n=====================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
