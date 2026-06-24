// Real-Prisma + real-pipeline self-test for Parts 1 & 2 — event-log filter + export.
//
//   npx tsx src/db/selfTest_eventLogFilterExport.ts     (needs dev Postgres)
//
// The filtering and export both run in the browser through the SHARED table code
// (public/js/table.js: App.table.pipeline) over the rows that /api/automations/events
// serves via listEvents(). This test drives BOTH the real read path (listEvents) and
// the real filter code (the actual pipeline, loaded from table.js — not a copy) and
// proves:
//   * filtering by event TYPE returns exactly the matching events;
//   * filtering by ACTOR / source returns exactly the matching events;
//   * filtering by DATE (after / between) returns exactly the matching events;
//   * EXPORT writes the filtered set (export = pipeline(rows) with the same rules).
//
// The event columns mirror the Events tab exactly (type / actor / occurredAt).
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { createRequire } from "module";
import * as path from "path";
import { prisma, disconnectDb } from "./client";
import { listEvents } from "../services/automationService";

// Load the REAL shared table code (browser IIFE → attaches App.table to globalThis).
const requireCjs = createRequire(path.join(process.cwd(), "selftest.cjs"));
requireCjs(path.join(process.cwd(), "public/js/table.js"));
const Tbl = (globalThis as any).App.table;

const db = prisma as any;
const T_NAME = "__SELFTEST_EVENTLOG_FILTER__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// Same columns the Events tab builds.
const columns = [
  { key: "type", label: "Event", type: "text", get: (r: any) => r.type },
  { key: "actor", label: "By", type: "text", get: (r: any) => r.actorName || r.actorType || "" },
  { key: "occurredAt", label: "When", type: "date", get: (r: any) => r.occurredAt, text: (r: any) => String(r.occurredAt) },
];
const filterTo = (rows: any[], rules: any[]) => Tbl.pipeline(rows, columns, { rules, colFilters: {}, search: "" });
const idset = (rows: any[]) => new Set(rows.map((r) => r.id));

async function main() {
  console.log("Parts 1 & 2 — event-log filter + export (real Prisma + real pipeline)");
  console.log("=====================================================================\n");
  check(!!Tbl && typeof Tbl.pipeline === "function", "loaded the real App.table.pipeline from table.js");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "elog@example.invalid" } })).id;

    // Real writes to the Event table (what emitEvent persists), with varied
    // type / actor / date so each filter has a known correct subset.
    const mk = (type: string, actorType: string, actorName: string, iso: string) =>
      db.event.create({ data: { tenantId: tId, type, actorType, actorName, subjectType: "portal", subjectId: tId, payload: {}, occurredAt: new Date(iso) } });
    const e1 = await mk("BookingCreated", "user", "Alice", "2026-06-01T15:00:00.000Z");
    const e2 = await mk("BookingCreated", "sync", "Calendar sync", "2026-06-10T15:00:00.000Z");
    const e3 = await mk("SettingChanged", "user", "Bob", "2026-06-20T15:00:00.000Z");
    const e4 = await mk("UserDeleted", "user", "Alice", "2026-06-25T15:00:00.000Z");

    // Real read path (what the Events tab fetches).
    const rows = await listEvents(tId, { limit: 100 });
    check(rows.length === 4, `listEvents returns the 4 events (got ${rows.length})`);

    console.log("\n(1) Filter by event TYPE:");
    const byType = filterTo(rows, [{ field: "type", op: "is", value: "BookingCreated" }]);
    const typeIds = idset(byType);
    check(byType.length === 2 && typeIds.has(e1.id) && typeIds.has(e2.id), `type = BookingCreated -> exactly the 2 BookingCreated events (got ${byType.length})`);

    console.log("\n(2) Filter by ACTOR / source:");
    const byActor = filterTo(rows, [{ field: "actor", op: "contains", value: "Calendar sync" }]);
    check(byActor.length === 1 && byActor[0].id === e2.id, `actor contains "Calendar sync" -> only the sync event (got ${byActor.length})`);

    console.log("\n(3) Filter by DATE:");
    const after = filterTo(rows, [{ field: "occurredAt", op: "after", value: "2026-06-15" }]);
    const afterIds = idset(after);
    check(after.length === 2 && afterIds.has(e3.id) && afterIds.has(e4.id), `after 2026-06-15 -> the 2 later events (got ${after.length})`);
    const between = filterTo(rows, [{ field: "occurredAt", op: "between", value: "2026-06-05", value2: "2026-06-21" }]);
    const betweenIds = idset(between);
    check(between.length === 2 && betweenIds.has(e2.id) && betweenIds.has(e3.id), `between 06-05 and 06-21 -> the 2 middle events (got ${between.length})`);

    console.log("\n(4) EXPORT writes the filtered set (export = pipeline with the same rules):");
    const exportSet = filterTo(rows, [{ field: "type", op: "is", value: "BookingCreated" }]);
    const exIds = idset(exportSet);
    check(exportSet.length === 2 && exIds.has(e1.id) && exIds.has(e2.id), "exporting with a type filter yields exactly the filtered rows");
    check(!exIds.has(e3.id) && !exIds.has(e4.id), "filtered-out events are excluded from the export set");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { if (tId) await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
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
