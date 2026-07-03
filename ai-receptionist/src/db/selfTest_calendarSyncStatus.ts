// Self-test — the Bookings header "Calendar Sync" tile checkbox. The checkbox is
// display-only and derives from the SAME Google status the /api/google/status
// route returns: checked === (connected && syncEnabled). This drives the real
// source of that flag (getConnectionStatus / setSyncSettings in
// googleConnectionService — the exact functions the route uses) against a REAL
// seeded GoogleConnection via the REAL Prisma client, and asserts BOTH cases:
// checked-when-enabled and unchecked-when-disabled.
//
//   npx tsx src/db/selfTest_calendarSyncStatus.ts        (needs dev Postgres)
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_CALSYNC__") + its GoogleConnection,
// deleted at the end (the connection cascades with the tenant).

import { prisma, disconnectDb } from "./client";
import { getConnectionStatus, setSyncSettings } from "../services/googleConnectionService";

const db = prisma as any;
const T_NAME = "__SELFTEST_CALSYNC__";

// EXACT mirror of the portal.js derivation for the tile checkbox:
//   enabled: !!(gStatus.connected && gStatus.syncEnabled)
const checkboxChecked = (s: { connected: boolean; syncEnabled: boolean }) => !!(s.connected && s.syncEnabled);

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

let tId = "";

async function main() {
  console.log("Calendar Sync tile checkbox reflects Google syncEnabled (REAL Prisma)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();

  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "calsync@example.invalid" } })).id;
    // Connected Google connection: status "connected" + a refresh token present is
    // what getConnectionStatus treats as connected. Start with sync ENABLED.
    await db.googleConnection.create({ data: { tenantId: tId, status: "connected", refreshTokenEnc: "selftest-not-a-real-token", syncEnabled: true } });

    // ---- Case A: sync ENABLED -> checkbox CHECKED ----
    console.log("(Enabled) Google sync on -> tile checkbox is checked:");
    {
      const s = await getConnectionStatus(tId);
      check(s.connected === true, "status.connected === true (connected row)");
      check(s.syncEnabled === true, "status.syncEnabled === true");
      check(checkboxChecked(s) === true, "derived checkbox === CHECKED");
    }

    // ---- Case B: sync DISABLED -> checkbox UNCHECKED ----
    console.log("\n(Disabled) Google sync off -> tile checkbox is unchecked:");
    {
      await setSyncSettings(tId, { syncEnabled: false }); // real service, real write
      const s = await getConnectionStatus(tId);
      check(s.connected === true, "status.connected still true (still connected)");
      check(s.syncEnabled === false, "status.syncEnabled === false (flag flipped in DB)");
      check(checkboxChecked(s) === false, "derived checkbox === UNCHECKED");
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
  console.log("NOTE: the checkbox is pure-frontend + display-only; this proves the FLAG");
  console.log("it binds to (connected && syncEnabled) flips correctly through the real");
  console.log("status path. The visual tile/blurb are verified by you in the browser.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
