// Self-test — the relocated Bookings timezone control. Exercises the REAL
// exported handlers (patchAccountTimezone + getBookingConfigHandler) against a
// REAL seeded tenant via the REAL Prisma client — the same path production uses.
//
//   npx tsx src/db/selfTest_bookingsTimezone.ts        (needs dev Postgres)
//
// PROVES (one source of truth, no new/duplicate field):
//   * PATCH /api/account/timezone writes tenant.timezone (the value Luxon reads
//     at the Google boundary), and GET /api/booking-config reads back the SAME
//     value — write path and read path agree on the one field.
//   * NEGATIVE: a CLIENT_USER cannot change it (403, value unchanged) and the
//     booking-config read reports timezoneEditable:false for them (so the
//     always-visible Bookings picker renders read-only instead of 403-ing).
//   * An invalid IANA value is rejected (400).
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_TZ__"), deleted at the end.

import { prisma, disconnectDb } from "./client";
import { patchAccountTimezone, getBookingConfigHandler } from "../routes/api";

const db = prisma as any;
const T_NAME = "__SELFTEST_TZ__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

function reqFor(role: string, tId: string, body: Record<string, unknown> = {}) {
  return { user: { id: "u_" + role, role, tenantId: tId }, query: { tenantId: tId }, body } as any;
}
function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = {
    status(c: number) { out.status = c; return this; },
    json(b: any) { out.body = b; return this; },
  };
  return { res, out };
}
async function tzInDb(tId: string) {
  return ((await db.tenant.findUnique({ where: { id: tId } }))! as any).timezone;
}

let tId = "";

async function main() {
  console.log("Bookings timezone — one source of truth (REAL handlers + REAL Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "tz@example.invalid", timezone: "America/New_York" } })).id;

    // ---- Owner writes timezone; booking-config reads back the SAME field ----
    console.log("(Owner) writes timezone -> tenant.timezone, and booking-config reflects it:");
    {
      const { res, out } = makeRes();
      await patchAccountTimezone(reqFor("OWNER", tId, { timezone: "America/Chicago" }), res);
      check(out.status === 200, "PATCH /account/timezone -> 200");
      check((await tzInDb(tId)) === "America/Chicago", "tenant.timezone is now America/Chicago (write landed on the field)");

      const r2 = makeRes();
      await getBookingConfigHandler(reqFor("OWNER", tId), r2.res);
      check(r2.out.status === 200 && r2.out.body && r2.out.body.timezone === "America/Chicago", "GET /booking-config reads back America/Chicago (one source of truth)");
      check(Array.isArray(r2.out.body.timezoneOptions) && r2.out.body.timezoneOptions.length > 0, "booking-config returns timezoneOptions for the picker");
      check(r2.out.body.timezoneEditable === true, "timezoneEditable:true for owner");
    }

    // ---- NEGATIVE: a client user cannot change it ----
    console.log("\n(Client user) cannot change the timezone (blocked server-side):");
    {
      const { res, out } = makeRes();
      await patchAccountTimezone(reqFor("CLIENT_USER", tId, { timezone: "America/Denver" }), res);
      check(out.status === 403, "PATCH /account/timezone -> 403 for client user");
      check((await tzInDb(tId)) === "America/Chicago", "tenant.timezone UNCHANGED (still America/Chicago)");

      const r2 = makeRes();
      await getBookingConfigHandler(reqFor("CLIENT_USER", tId), r2.res);
      check(r2.out.status === 200 && r2.out.body.timezone === "America/Chicago", "client user still SEES the timezone value");
      check(r2.out.body.timezoneEditable === false, "timezoneEditable:false for client user (picker renders read-only)");
    }

    // ---- Invalid IANA value is rejected ----
    console.log("\n(Validation) an invalid timezone is rejected:");
    {
      const { res, out } = makeRes();
      await patchAccountTimezone(reqFor("OWNER", tId, { timezone: "Mars/Phobos" }), res);
      check(out.status === 400, "invalid timezone -> 400");
      check((await tzInDb(tId)) === "America/Chicago", "tenant.timezone UNCHANGED after the bad value");
    }
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
  console.log("NOTE: proves the field + write/read path. The picker now living on the");
  console.log("Bookings page (and gone from the Calls card) is verified by you in the UI.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
