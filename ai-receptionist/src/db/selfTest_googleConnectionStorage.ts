// Self-test for the Google connection + calendar-mapping STORAGE layer
// (sub-batch 1). Uses the REAL Prisma client against a throwaway tenant/resource
// and cleans up after itself. No OAuth, no Google account, no network.
//
//   npx tsx src/db/selfTest_googleConnectionStorage.ts
//
// PROVES:
//   (1) create a connection, read it back (decrypted) — tokens round-trip;
//   (2) tokens are stored ENCRYPTED — the raw DB column is NOT the plaintext token,
//       and it carries our "v1:" AES-GCM envelope;
//   (3) the status DTO contains NO tokens (asserted explicitly, by key and by value);
//   (4) disconnect wipes both tokens and flips status to "revoked";
//   (5) map a calendar to a resource, read it back, then unmap it;
//   (6) "does nothing unexpected": getPortal + buildHoursContext + findOpenSlots are
//       BYTE-FOR-BYTE identical before and after adding these rows.
//
// SAFETY: one TEMPORARY tenant (+ one resource), deleted at the end (cascade).

// Self-contained: ensure an encryption key exists for this run. tokenCrypto reads
// process.env at call time, so setting it here (before any service call) is enough.
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "selftest-only-key-not-for-production-use";

import { prisma, disconnectDb } from "./client";
import { getPortal } from "../services/portalService";
import { buildHoursContext, findOpenSlots } from "../services/availabilityService";
import {
  upsertGoogleConnection,
  getDecryptedConnection,
  getConnectionStatus,
  disconnectGoogle,
  setResourceCalendarMap,
  clearResourceCalendarMap,
  listResourceCalendarMaps,
} from "../services/googleConnectionService";

const db = prisma as any;
const T_NAME = "__SELFTEST_GCONN__";
const PROBE_DATE = "2026-06-22"; // a Monday -> default Mon–Fri 9–5 yields slots
const FAKE_ACCESS = "FAKE_ACCESS_TOKEN_abc123";
const FAKE_REFRESH = "FAKE_REFRESH_TOKEN_xyz789";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Google connection storage — foundation self-test");
  console.log("================================================\n");

  const before = { tenants: await db.tenant.count(), resources: await db.resource.count() };
  console.log(`Real rows before — tenants:${before.tenants} resources:${before.resources}\n`);

  let tId = "", rId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    const r = await db.resource.create({ data: { tenantId: tId, name: "Test Resource" } });
    rId = r.id;

    // (6-before) snapshot existing reads BEFORE adding any Google rows.
    const portalBefore = JSON.stringify(await getPortal(tId));
    const hoursBefore = await buildHoursContext(tId);
    const slotsBefore = JSON.stringify((await findOpenSlots(tId, PROBE_DATE)).slots);

    // (1) create + read back (decrypted)
    console.log("(1) create a connection and read it back (decrypted):");
    await upsertGoogleConnection(tId, {
      accountEmail: "owner@example.com",
      accessToken: FAKE_ACCESS,
      refreshToken: FAKE_REFRESH,
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      connectedById: null,
    });
    const dec = await getDecryptedConnection(tId);
    check(!!dec && dec.accessToken === FAKE_ACCESS, "access token decrypts back to the original");
    check(!!dec && dec.refreshToken === FAKE_REFRESH, "refresh token decrypts back to the original");
    check(!!dec && dec.accountEmail === "owner@example.com", "account email read back");

    // (2) stored ENCRYPTED (raw DB value is not plaintext)
    console.log("\n(2) tokens are stored encrypted at rest:");
    const raw = await db.googleConnection.findUnique({ where: { tenantId: tId } });
    check(!!raw && raw.accessTokenEnc !== FAKE_ACCESS, "raw access column is NOT the plaintext token");
    check(!!raw && raw.refreshTokenEnc !== FAKE_REFRESH, "raw refresh column is NOT the plaintext token");
    check(!!raw && typeof raw.accessTokenEnc === "string" && raw.accessTokenEnc.startsWith("v1:"), "ciphertext carries the v1 AES-GCM envelope");
    check(!!raw && !String(raw.accessTokenEnc).includes(FAKE_ACCESS) && !String(raw.refreshTokenEnc).includes(FAKE_REFRESH), "plaintext token never appears inside the stored value");

    // (3) status DTO contains NO tokens
    console.log("\n(3) the status DTO never exposes tokens:");
    const status: any = await getConnectionStatus(tId);
    check(status.connected === true, "status reports connected");
    check(status.accountEmail === "owner@example.com", "status exposes the account email");
    const statusKeys = Object.keys(status);
    const tokenish = statusKeys.filter((k) => /token/i.test(k));
    check(tokenish.length === 0, `status has no token-ish keys (found: ${tokenish.join(",") || "none"})`);
    const statusJson = JSON.stringify(status);
    check(!statusJson.includes(FAKE_ACCESS) && !statusJson.includes(FAKE_REFRESH), "no plaintext token value anywhere in the status DTO");

    // (4) disconnect wipes tokens + flips status
    console.log("\n(4) disconnect clears tokens and flips status:");
    await disconnectGoogle(tId);
    const rawAfter = await db.googleConnection.findUnique({ where: { tenantId: tId } });
    check(!!rawAfter && rawAfter.accessTokenEnc === null && rawAfter.refreshTokenEnc === null, "both token columns are null after disconnect");
    check(!!rawAfter && rawAfter.status === "revoked", "status flipped to revoked");
    const statusDisc = await getConnectionStatus(tId);
    check(statusDisc.connected === false, "status reports not-connected after disconnect");
    const decDisc = await getDecryptedConnection(tId);
    check(!!decDisc && decDisc.accessToken === null && decDisc.refreshToken === null, "no usable tokens remain after disconnect");

    // (5) map / unmap a calendar to a resource
    console.log("\n(5) map a calendar to a resource, then unmap:");
    await setResourceCalendarMap(tId, rId, "primary@group.calendar.google.com", "Front Desk");
    const maps1 = await listResourceCalendarMaps(tId);
    check(maps1.length === 1 && maps1[0].resourceId === rId && maps1[0].googleCalendarId === "primary@group.calendar.google.com", "mapping stored and read back");
    check(maps1[0].calendarSummary === "Front Desk", "cached calendar display name stored");
    await clearResourceCalendarMap(rId);
    const maps2 = await listResourceCalendarMaps(tId);
    check(maps2.length === 0, "mapping removed after unmap");

    // (6-after) existing reads must be byte-for-byte unchanged.
    console.log("\n(6) existing reads unchanged by the new tables:");
    const portalAfter = JSON.stringify(await getPortal(tId));
    const hoursAfter = await buildHoursContext(tId);
    const slotsAfter = JSON.stringify((await findOpenSlots(tId, PROBE_DATE)).slots);
    check(portalAfter === portalBefore, "getPortal output identical before/after");
    check(hoursAfter === hoursBefore, "buildHoursContext output identical before/after");
    check(slotsAfter === slotsBefore, "findOpenSlots slot digits identical before/after");
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

  console.log("\n================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
