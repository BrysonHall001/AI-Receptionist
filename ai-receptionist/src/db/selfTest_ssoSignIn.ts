process.env.AI_PROVIDER = "mock";

// SSO SIGN-IN — self-test.
//
// This is security work, so the suite is weighted toward "who can and cannot get a session"
// and those assertions are worth their brittleness. Everything below drives the REAL
// decision service and the REAL state verifier — not a copy of their rules.
//
// THE ASSERTION THAT MATTERS MOST is the subject-mismatch case (section 5): a provider
// identity presenting an address that is already linked to a DIFFERENT identity must be
// refused outright, with no password prompt. It carries a negative case proving the check is
// real rather than vacuously passing because nothing matched.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createUser } = require("../services/userService");
const { resolveSsoSignIn, createSsoLink, removeSsoLink, listSsoLinks } = require("../services/ssoSignInService");
const {
  configuredSsoProviders, isGoogleSsoConfigured, isMicrosoftSsoConfigured,
  packSsoState, verifySsoStart, SSO_STATE_TTL_MS, __ssoInternals,
} = require("../services/ssoProviders");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanup: string[] = [];

const gid = (s: string) => ({ provider: "google" as const, subject: s, email: null as string | null });
const gmail = (s: string, e: string) => ({ provider: "google" as const, subject: s, email: e });

async function main() {
  console.log("SSO SIGN-IN — self-test");
  console.log("=======================");
  const stamp = Date.now();
  const mk = async (tag: string, extra: any = {}) => {
    const u: any = await createUser({ email: `sso-${tag}-${stamp}@example.invalid`, name: `SSO ${tag}`, password: "Correct-Horse-9!", role: "CLIENT_USER", ...extra });
    cleanup.push(u.id);
    return u;
  };

  // ---------- (1) nothing is ever created ----------
  console.log("\n(1) an address with no account:");
  const before = await db.user.count();
  const unknown = await resolveSsoSignIn(gmail("subj-unknown", `nobody-${stamp}@example.invalid`));
  check(unknown.kind === "refused" && unknown.code === "no_account",
    `refused, and plainly \u2014 "${unknown.kind === "refused" ? unknown.reason : ""}"`);
  check((await db.user.count()) === before, "NO account was created \u2014 people still arrive by invitation only");
  check((await db.userSsoLink.count({ where: { subject: "subj-unknown" } })) === 0, "\u2026and no link was created either");

  // ---------- (2) an address the provider cannot prove ----------
  console.log("\n(2) an unverified provider address:");
  const real = await mk("live");
  const unver = await resolveSsoSignIn({ ...gid("subj-unver"), refusal: "not verified" } as any);
  check(unver.kind === "refused" && unver.code === "unverified_email",
    "an identity with no verified email is refused before any lookup happens");
  check(__ssoInternals.verifiedEmailFrom("google", { email: real.email }).email === null,
    "\u2026Google without email_verified is unverified, not assumed true");
  check(__ssoInternals.verifiedEmailFrom("microsoft", {}).email === null,
    "\u2026and a Microsoft identity with NO email claim is unverified (that absence is the signal)");

  // ---------- (3) matching but unlinked: the password, once ----------
  console.log("\n(3) an address that matches an unlinked account:");
  const needs = await resolveSsoSignIn(gmail("subj-real", real.email));
  check(needs.kind === "needs_link" && needs.email === real.email,
    "the outcome is a one-time password confirmation, NOT a session");
  check(!("userId" in needs), "\u2026no user id is handed back, so no session can be minted from this outcome");
  check((await db.userSsoLink.count({ where: { userId: real.id } })) === 0,
    "\u2026and no link is stored until that password is proven");

  // ---------- (4) a linked user gets THEIR session ----------
  console.log("\n(4) a returning linked user:");
  await createSsoLink(real.id, "google", "subj-real", real.email);
  const other = await mk("other");
  const ok = await resolveSsoSignIn(gmail("subj-real", real.email));
  check(ok.kind === "sign_in" && ok.userId === real.id,
    "signs in, and as the RIGHT user \u2014 not merely some user");
  check(ok.kind === "sign_in" && ok.userId !== other.id, "\u2026demonstrably not the other account");
  const moved = await resolveSsoSignIn(gmail("subj-real", `changed-${stamp}@example.invalid`));
  check(moved.kind === "sign_in" && moved.userId === real.id,
    "a changed provider address still signs in the same person \u2014 the subject is the identity, the email is a label");

  // ---------- (5) THE TAKEOVER CASE ----------
  console.log("\n(5) a different provider identity claiming a linked address:");
  const attacker = await resolveSsoSignIn(gmail("subj-ATTACKER", real.email));
  check(attacker.kind === "refused" && attacker.code === "subject_mismatch",
    "REFUSED OUTRIGHT \u2014 a different identity presenting an already-linked address gets nothing");
  check(attacker.kind === "refused" && !/password/i.test("" + (attacker as any).code),
    "\u2026and is NOT offered the password prompt, so a stolen password cannot re-point a link");
  check((await db.userSsoLink.count({ where: { userId: real.id, provider: "google" } })) === 1
    && (await db.userSsoLink.findFirst({ where: { userId: real.id } })).subject === "subj-real",
    "\u2026the stored link is untouched, still pointing at the original identity");
  // NEGATIVE: prove the refusal is caused by the mismatch, not by something incidental
  await removeSsoLink(real.id, "google");
  const afterUnlink = await resolveSsoSignIn(gmail("subj-ATTACKER", real.email));
  check(afterUnlink.kind === "needs_link",
    "NEGATIVE: with the link removed, the SAME identity now reaches the password step \u2014 so the refusal above was the subject check, not an accident");
  await createSsoLink(real.id, "google", "subj-real", real.email);

  // ---------- (6) every existing gate still applies ----------
  console.log("\n(6) accounts that may not sign in at all:");
  const off = await mk("disabled");
  await db.user.update({ where: { id: off.id }, data: { disabled: true } });
  await createSsoLink(off.id, "google", "subj-disabled", off.email);
  const offOut = await resolveSsoSignIn(gmail("subj-disabled", off.email));
  check(offOut.kind === "refused" && offOut.code === "inactive",
    "a DISABLED account is refused on the SSO path exactly as on the password path");
  const exp = await mk("expired");
  await db.user.update({ where: { id: exp.id }, data: { expiresAt: new Date(Date.now() - 86400000) } });
  await createSsoLink(exp.id, "google", "subj-expired", exp.email);
  const expOut = await resolveSsoSignIn(gmail("subj-expired", exp.email));
  check(expOut.kind === "refused" && expOut.code === "inactive", "\u2026and so is an EXPIRED account");
  // NOTE: createUser DERIVES expiresAt (null unless the role is AUDITOR) and does not accept
  // one - passing it silently did nothing, which made this fixture an ACTIVE account and the
  // assertion below fail for the right reason against the wrong setup. Set it the way the two
  // cases above do.
  const expUnlinked = await mk("expired2");
  await db.user.update({ where: { id: expUnlinked.id }, data: { expiresAt: new Date(Date.now() - 86400000) } });
  const eu = await resolveSsoSignIn(gmail("subj-e2", expUnlinked.email));
  check(eu.kind === "refused" && eu.code === "inactive",
    "\u2026and an inactive account is refused BEFORE the password step, so SSO cannot probe its password");

  // ---------- (7) state: tamper, replay, expiry ----------
  console.log("\n(7) the sign-in attempt itself:");
  const good = packSsoState(`google.NONCE.${Date.now()}.VERIFIER`);
  check(verifySsoStart(good, "google", "NONCE").ok === true, "a fresh, untampered attempt is accepted");
  check((verifySsoStart(good + "x", "google", "NONCE") as any).why === "bad_signature", "a tampered cookie is refused");
  check((verifySsoStart(good, "microsoft", "NONCE") as any).why === "provider_mismatch", "a cookie minted for another provider is refused");
  check((verifySsoStart(good, "google", "WRONG") as any).why === "state_mismatch", "a state that does not match the cookie is refused");
  const oldOne = packSsoState(`google.NONCE.${Date.now() - SSO_STATE_TTL_MS - 1000}.VERIFIER`);
  check((verifySsoStart(oldOne, "google", "NONCE") as any).why === "expired_state", `an attempt older than ${SSO_STATE_TTL_MS / 60000} minutes is refused`);
  check((verifySsoStart("", "google", "NONCE") as any).why === "missing_state",
    "and a replay is refused: the route clears the cookie on first use, so a second callback has none");

  // ---------- (8) off by default ----------
  console.log("\n(8) with nothing configured:");
  const saved = [process.env.SSO_GOOGLE_CLIENT_ID, process.env.SSO_GOOGLE_CLIENT_SECRET, process.env.SSO_MICROSOFT_CLIENT_ID, process.env.SSO_MICROSOFT_CLIENT_SECRET];
  delete process.env.SSO_GOOGLE_CLIENT_ID; delete process.env.SSO_GOOGLE_CLIENT_SECRET;
  delete process.env.SSO_MICROSOFT_CLIENT_ID; delete process.env.SSO_MICROSOFT_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "calendar-id"; process.env.GOOGLE_CLIENT_SECRET = "calendar-secret";
  check(configuredSsoProviders().length === 0 && !isGoogleSsoConfigured() && !isMicrosoftSsoConfigured(),
    "no providers are offered, so the sign-in screen renders exactly as it does today");
  check(!isGoogleSsoConfigured(),
    "\u2026and the Calendar integration's own credentials do NOT switch sign-in on \u2014 separate kill switch");
  saved.forEach((v, i) => { const k = ["SSO_GOOGLE_CLIENT_ID", "SSO_GOOGLE_CLIENT_SECRET", "SSO_MICROSOFT_CLIENT_ID", "SSO_MICROSOFT_CLIENT_SECRET"][i]; if (v) process.env[k] = v; });

  // ---------- (9) unlinking ----------
  console.log("\n(9) removing a link:");
  check((await listSsoLinks(real.id)).length === 1, "the account shows its link");
  check((await removeSsoLink(real.id, "google")) === true && (await listSsoLinks(real.id)).length === 0,
    "unlinking removes it");
  const fresh = await db.user.findUnique({ where: { id: real.id } });
  check(!!fresh && typeof fresh.passwordHash === "string" && fresh.passwordHash.length > 0,
    "\u2026and locks nobody out: the account still has its password, which SSO never touched");

  for (const id of cleanup) { await db.user.delete({ where: { id } }).catch(() => { /* best-effort */ }); }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (a way to prove an existing identity \u2014 and nothing more)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
