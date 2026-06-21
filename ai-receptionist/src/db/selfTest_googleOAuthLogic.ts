// Self-test for the Google OAuth LOGIC that doesn't need a real browser/Google:
//   - read-only scope constant (no write/events scope)
//   - consent-URL construction (scope, offline access, state, response_type)
//   - refresh-token-preservation logic
//   - the refresh-persistence hook (emit a "tokens" event -> stored access token
//     updates via the ENCRYPTED storage layer; refresh token preserved)
//
//   npx tsx src/db/selfTest_googleOAuthLogic.ts
//
// The real OAuth round-trip (click Connect -> Google consent -> callback) needs a
// browser + Google account and is verified manually (see the batch notes).
//
// SAFETY: one TEMPORARY tenant, deleted at the end (cascade).

// Self-contained config: googleClient + tokenCrypto read process.env at call time,
// so setting these before any call is enough (no .env edit needed for the test).
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "selftest-only-key";
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "test-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URL = process.env.GOOGLE_OAUTH_REDIRECT_URL || "https://clarity.vaala.io/api/google/oauth/callback";

import { prisma, disconnectDb } from "./client";
import {
  GOOGLE_SCOPES,
  buildConsentUrl,
  chooseRefreshTokenForStore,
  googleConfigured,
  resolveRedirectUrl,
  makeAuthedClient,
} from "../services/googleClient";
import { upsertGoogleConnection, getDecryptedConnection } from "../services/googleConnectionService";

const db = prisma as any;
const T_NAME = "__SELFTEST_GOAUTH__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("Google OAuth logic + refresh self-test");
  console.log("======================================\n");

  // ---- Pure logic (no DB) ---------------------------------------------------
  console.log("(1) scope is READ-ONLY only (no write/events scope):");
  check(GOOGLE_SCOPES.length === 1, "exactly one scope requested");
  check(GOOGLE_SCOPES[0] === "https://www.googleapis.com/auth/calendar.readonly", "scope is calendar.readonly");
  const scopeBlob = GOOGLE_SCOPES.join(" ");
  check(!/calendar\.events/.test(scopeBlob) && !/\/auth\/calendar(\s|$)/.test(scopeBlob), "no write/events scope present");

  console.log("\n(2) consent URL is well-formed:");
  check(googleConfigured() === true, "googleConfigured() true when id+secret set");
  const url = buildConsentUrl("NONCE123");
  check(url.includes("accounts.google.com"), "points at Google's consent host");
  check(url.includes("access_type=offline"), "requests offline access (for a refresh token)");
  check(url.includes("response_type=code"), "authorization-code flow");
  check(url.includes("state=NONCE123"), "carries the state nonce");
  check(url.includes("calendar.readonly"), "requests the read-only calendar scope");
  check(!/calendar.events|auth%2Fcalendar(&|$)/.test(url), "no write scope in the consent URL");
  check(resolveRedirectUrl() === "https://clarity.vaala.io/api/google/oauth/callback", "redirect URL resolves to the configured callback");

  console.log("\n(3) refresh-token-preservation helper:");
  check(chooseRefreshTokenForStore(undefined) === undefined, "undefined input -> undefined (keep existing)");
  check(chooseRefreshTokenForStore(null) === undefined, "null input -> undefined (keep existing)");
  check(chooseRefreshTokenForStore("") === undefined, "empty input -> undefined (keep existing)");
  check(chooseRefreshTokenForStore("rt_new") === "rt_new", "non-empty input passes through");

  // ---- DB-backed logic ------------------------------------------------------
  const before = { tenants: await db.tenant.count() };
  let tId = "";
  try {
    const t = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;

    console.log("\n(4) refresh token is PRESERVED across a reconnect that returns none:");
    await upsertGoogleConnection(tId, { accountEmail: "owner@example.com", accessToken: "access_v1", refreshToken: "refresh_ORIGINAL", scope: GOOGLE_SCOPES.join(" ") });
    // Simulate a reconnect: new access token, NO new refresh token (undefined).
    await upsertGoogleConnection(tId, { accessToken: "access_v2", refreshToken: chooseRefreshTokenForStore(undefined) });
    const afterReconnect = await getDecryptedConnection(tId);
    check(!!afterReconnect && afterReconnect.refreshToken === "refresh_ORIGINAL", "refresh token kept (not wiped) when none returned");
    check(!!afterReconnect && afterReconnect.accessToken === "access_v2", "access token updated on reconnect");
    // A reconnect that DOES return a new refresh token replaces it.
    await upsertGoogleConnection(tId, { refreshToken: chooseRefreshTokenForStore("refresh_ROTATED") });
    const afterRotate = await getDecryptedConnection(tId);
    check(!!afterRotate && afterRotate.refreshToken === "refresh_ROTATED", "refresh token replaced when a new one is returned");

    console.log("\n(5) refresh-persistence hook updates the stored (encrypted) access token:");
    const client = await makeAuthedClient(tId);
    check(!!client, "authed client built from stored connection");
    if (client) {
      const expiry = Date.now() + 3600_000;
      client.emit("tokens", { access_token: "access_REFRESHED", expiry_date: expiry });
      // The hook persists asynchronously; wait for it.
      let updated = false;
      for (let i = 0; i < 20; i++) {
        await sleep(50);
        const c = await getDecryptedConnection(tId);
        if (c && c.accessToken === "access_REFRESHED") { updated = true; break; }
      }
      check(updated, "stored access token updated to the refreshed value");
      const finalConn = await getDecryptedConnection(tId);
      check(!!finalConn && finalConn.refreshToken === "refresh_ROTATED", "refresh token untouched by an access-only refresh");
      // And it's still encrypted at rest.
      const raw = await db.googleConnection.findUnique({ where: { tenantId: tId } });
      check(!!raw && raw.accessTokenEnc !== "access_REFRESHED" && String(raw.accessTokenEnc).startsWith("v1:"), "refreshed access token stored encrypted, not plaintext");
    }
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

  console.log("\n======================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
