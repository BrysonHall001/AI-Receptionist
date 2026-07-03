// Self-test for the debug free/busy LOGIC that doesn't need a live Google call:
//   - window/param normalization (date -> UTC instant, passthrough, validation)
//   - the mapping-lookup precondition the route branches on (no mapping vs mapped)
//
//   npx tsx src/db/selfTest_googleFreeBusyLogic.ts
//
// The LIVE free/busy call needs a real Google connection + a real event on the
// calendar and is verified by hand (see the manual test script).
//
// SAFETY: one TEMPORARY tenant (+ resource), deleted at the end (cascade).

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "selftest-only-key";

import { prisma, disconnectDb } from "./client";
import { normalizeFreeBusyWindow } from "../services/googleClient";
import { setResourceCalendarMap, listResourceCalendarMaps } from "../services/googleConnectionService";

const db = prisma as any;
const T_NAME = "__SELFTEST_GFB__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
function throws(fn: () => any): boolean { try { fn(); return false; } catch { return true; } }

async function main() {
  console.log("Debug free/busy logic self-test");
  console.log("===============================\n");

  // ---- Pure window normalization (no DB / no Google) ------------------------
  console.log("(1) window normalization:");
  const w1 = normalizeFreeBusyWindow("2026-07-01", "2026-07-02");
  check(w1.fromISO === "2026-07-01T00:00:00Z", "bare date -> UTC midnight (from)");
  check(w1.toISO === "2026-07-02T00:00:00Z", "bare date -> UTC midnight (to)");
  const w2 = normalizeFreeBusyWindow("2026-07-01T09:00:00Z", "2026-07-01T17:00:00Z");
  check(w2.fromISO === "2026-07-01T09:00:00Z" && w2.toISO === "2026-07-01T17:00:00Z", "full RFC3339 instants pass through untouched");

  console.log("\n(2) window validation rejects bad input:");
  check(throws(() => normalizeFreeBusyWindow("", "2026-07-02")), "missing 'from' rejected");
  check(throws(() => normalizeFreeBusyWindow("2026-07-01", "")), "missing 'to' rejected");
  check(throws(() => normalizeFreeBusyWindow("2026-07-02", "2026-07-01")), "'to' before 'from' rejected");
  check(throws(() => normalizeFreeBusyWindow("2026-07-01", "2026-07-01")), "zero-length window rejected");
  check(throws(() => normalizeFreeBusyWindow("not-a-date", "2026-07-02")), "garbage date rejected");

  // ---- DB: the mapping-lookup precondition the route branches on ------------
  const before = { tenants: await db.tenant.count() };
  let tId = "", rId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    rId = (await db.resource.create({ data: { tenantId: tId, name: "Stylist A" } })).id;

    console.log("\n(3) mapping lookup drives the route's branch:");
    let map = (await listResourceCalendarMaps(tId)).find((m) => m.resourceId === rId);
    check(map === undefined, "unmapped resource -> no mapping found (route would return no_calendar_mapped)");

    await setResourceCalendarMap(tId, rId, "calA@group.calendar.google.com", "Calendar A");
    map = (await listResourceCalendarMaps(tId)).find((m) => m.resourceId === rId);
    check(!!map && map.googleCalendarId === "calA@group.calendar.google.com", "mapped resource -> lookup yields the calendar id (route would call free/busy)");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenant\u2026");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", tId, e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\nVerifying real data untouched:");
  const after = { tenants: await db.tenant.count() };
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);

  console.log("\n===============================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
