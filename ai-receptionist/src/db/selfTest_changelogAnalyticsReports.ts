// Batch self-test — proves the two new 2026-06-26 Change Log entries exist with the
// correct date + type, and that the Change Log is returned in correct (non-increasing)
// date order — the invariant that the date-collapse correction restores.
//
//   npx tsx src/db/selfTest_changelogAnalyticsReports.ts
//
// Real-path: upserts the two going-forward entries through the real changelog service
// (idempotent by commitSha — same shas the migrations use, so this is a no-op when
// migrate deploy already inserted them) and reads them back via listChangeLog. These
// are real product rows, NOT temp data, so they are intentionally left in place.

import { upsertChangeLogEntry, listChangeLog } from "../services/changelogService";
import { disconnectDb } from "./client";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

const NEW_ENTRIES = [
  { commitSha: "batch-analytics-rename-20260626", date: "2026-06-26", type: "UI",
    description: "The Reports page now defaults to the name \"Analytics\" (still renamable in Settings → Labels), clearing the way for a separate scheduled-Reports feature." },
  { commitSha: "batch-reports-foundation-20260626", date: "2026-06-26", type: "Feature",
    description: "Added a Reports area under Settings → Data Administration with a list of scheduled reports (active/inactive, filterable). Report runs download like exports; the report builder lands next." },
];

async function main() {
  console.log("Change Log — 2026-06-26 entries + date-order self-test");
  console.log("=====================================================");

  // ---------- (a) the two new entries exist with the right date + type ----------
  console.log("(a) the two 2026-06-26 entries are present, correctly dated and typed:");
  for (const e of NEW_ENTRIES) {
    await upsertChangeLogEntry(e); // idempotent by commitSha
  }
  const all = await listChangeLog();
  for (const e of NEW_ENTRIES) {
    const found = all.find((r: any) => r.commitSha === e.commitSha);
    check(!!found, `entry ${e.commitSha} exists`);
    check(!!found && String(found.date).startsWith("2026-06-26"), `  …dated 2026-06-26 (got ${found ? String(found.date).slice(0, 10) : "—"})`);
    check(!!found && found.type === e.type, `  …type is "${e.type}"`);
  }

  // ---------- (b) no 2026-06-26 entry is missing/duplicated ----------
  const jun26 = all.filter((r: any) => String(r.date).startsWith("2026-06-26"));
  check(jun26.length >= 2, `at least the two 2026-06-26 entries are present (found ${jun26.length})`);
  const shas = jun26.map((r: any) => r.commitSha);
  check(new Set(shas).size === shas.length, "no duplicate 2026-06-26 entries");

  // ---------- (c) Change Log is returned in non-increasing date order ----------
  // This is the invariant the date-collapse correction restores: a run of entries
  // all stamped on one wrong day would still pass ordering, but a MIS-dated newest
  // entry (e.g. a future/typo date sorting above 06-26) would break it.
  console.log("\n(b) entries are returned newest-first (dates non-increasing):");
  let monotonic = true;
  for (let i = 1; i < all.length; i++) {
    if (String(all[i - 1].date) < String(all[i].date)) { monotonic = false; break; }
  }
  check(monotonic, "listChangeLog dates are non-increasing (correctly ordered)");
  check(all.length > 0 && String(all[0].date) >= "2026-06-26", "the newest entry is dated 2026-06-26 or later");

  console.log("\n=====================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (06-26 entries present + dates ordered)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
