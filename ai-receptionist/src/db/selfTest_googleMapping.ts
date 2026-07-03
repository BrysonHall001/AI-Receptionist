// Self-test for the resource->calendar MAPPING storage (sub-batch 3's save/clear
// semantics). Real Prisma, throwaway tenant + resources, cleaned up after.
//
//   npx tsx src/db/selfTest_googleMapping.ts
//
// PROVES:
//   (1) map a resource to a calendar, read it back (with cached display name);
//   (2) re-mapping the SAME resource REPLACES (one calendar per resource);
//   (3) the SAME calendar may map to MULTIPLE resources (allowed — e.g. a shared
//       calendar); the resource is the unique key, not the calendar;
//   (4) unmap clears just that resource's mapping;
//   (5) negative: a resource with no mapping simply doesn't appear (no error).
//
// The LIVE calendar-listing call (listCalendars) needs a real Google connection
// and is verified in the browser — not here.
//
// SAFETY: one TEMPORARY tenant (+ two resources), deleted at the end (cascade).

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "selftest-only-key";

import { prisma, disconnectDb } from "./client";
import {
  setResourceCalendarMap,
  clearResourceCalendarMap,
  listResourceCalendarMaps,
} from "../services/googleConnectionService";

const db = prisma as any;
const T_NAME = "__SELFTEST_GMAP__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const findMap = (maps: any[], resourceId: string) => maps.find((m) => m.resourceId === resourceId);

async function main() {
  console.log("Resource->calendar mapping — storage self-test");
  console.log("==============================================\n");

  const before = { tenants: await db.tenant.count(), resources: await db.resource.count() };

  let tId = "", r1 = "", r2 = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    r1 = (await db.resource.create({ data: { tenantId: tId, name: "Stylist A" } })).id;
    r2 = (await db.resource.create({ data: { tenantId: tId, name: "Stylist B" } })).id;

    // (1) map + read back
    console.log("(1) map a resource and read it back:");
    await setResourceCalendarMap(tId, r1, "calA@group.calendar.google.com", "Calendar A");
    let maps = await listResourceCalendarMaps(tId);
    check(!!findMap(maps, r1) && findMap(maps, r1).googleCalendarId === "calA@group.calendar.google.com", "r1 mapped to calA");
    check(findMap(maps, r1).calendarSummary === "Calendar A", "cached calendar name stored");

    // (2) re-map replaces
    console.log("\n(2) re-mapping the same resource replaces:");
    await setResourceCalendarMap(tId, r1, "calB@group.calendar.google.com", "Calendar B");
    maps = await listResourceCalendarMaps(tId);
    const r1maps = maps.filter((m) => m.resourceId === r1);
    check(r1maps.length === 1, "r1 still has exactly one mapping");
    check(r1maps[0].googleCalendarId === "calB@group.calendar.google.com", "r1 now mapped to calB (replaced)");

    // (3) same calendar on multiple resources is allowed
    console.log("\n(3) the same calendar may map to multiple resources:");
    await setResourceCalendarMap(tId, r2, "calB@group.calendar.google.com", "Calendar B");
    maps = await listResourceCalendarMaps(tId);
    check(!!findMap(maps, r1) && !!findMap(maps, r2), "both r1 and r2 mapped");
    check(findMap(maps, r1).googleCalendarId === findMap(maps, r2).googleCalendarId, "both point at the same calendar (calB)");

    // (4) unmap clears only that resource
    console.log("\n(4) unmap clears just that resource:");
    await clearResourceCalendarMap(r1);
    maps = await listResourceCalendarMaps(tId);
    check(!findMap(maps, r1), "r1 mapping removed");
    check(!!findMap(maps, r2), "r2 mapping untouched");

    // (5) negative: a resource with no mapping just isn't present (no error)
    console.log("\n(5) a resource with no mapping returns no mapping (not an error):");
    check(findMap(maps, r1) === undefined, "unmapped resource simply absent from the list");
    check(maps.length === 1, "exactly one mapping remains (r2)");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenant\u2026");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", tId, e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\nVerifying real data untouched:");
  const after = { tenants: await db.tenant.count(), resources: await db.resource.count() };
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);
  check(after.resources === before.resources, `resources unchanged (${before.resources} -> ${after.resources})`);

  console.log("\n==============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
