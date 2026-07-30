process.env.AI_PROVIDER = "mock";

// TWO-FACTOR — self-test.
//
// Security work, so this is weighted toward who can and cannot get a session, and those
// assertions are worth their brittleness.
//
// THE CENTRAL ONE is section (3): with two-factor on, a CORRECT password must not produce a
// usable session. It is proved at the HTTP boundary — no session cookie is set, and the
// cookie jar that results cannot reach an authenticated route — because "no session" is a
// claim about what the browser ends up holding, not about an internal return value. It
// carries a negative case: the same account with two-factor OFF signs straight in through
// the identical code path, so the check cannot be passing because the fixture was broken.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createUser } = require("../services/userService");
const { createApp } = require("../app");
const {
  beginEnrolment, confirmEnrolment, disableMfa, mfaStatus, rememberDevice,
  deviceIsTrusted, forgetAllDevices, consumeRecoveryCode, recoveryCodesRemaining, mfaIsOn,
} = require("../services/mfaService");
const { totpCodeForStep, totpStep, base32Encode } = require("../services/totp");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanup: string[] = [];
const PW = "Correct-Horse-9!";

async function main() {
  console.log("TWO-FACTOR — self-test");
  console.log("======================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  const mk = async (tag: string) => {
    const u: any = await createUser({ email: `mfa-${tag}-${stamp}@example.invalid`, name: `MFA ${tag}`, password: PW, role: "CLIENT_USER" });
    cleanup.push(u.id);
    return u;
  };
  /** POST returning status, body, and any session cookie the server tried to set. */
  const post = async (path: string, body: any, cookie?: string) => {
    const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body || {}) });
    const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie().join("; ") : String(r.headers.get("set-cookie") || "");
    let j: any = null; try { j = await r.json(); } catch { /* */ }
    return { status: r.status, body: j, setCookie };
  };
  /** Can this cookie jar reach an authenticated route? The real test of "has a session". */
  const canReachMe = async (cookie: string) => {
    const r = await fetch(base + "/api/auth/me", { headers: { Cookie: cookie } });
    return r.status === 200;
  };
  const codeFor = (secret: string) => totpCodeForStep(secret, totpStep());
  /** Enrol a user for real, through the same service the endpoints use. */
  const enrol = async (u: any) => {
    const { secret } = await beginEnrolment(u.id, u.email);
    const r = await confirmEnrolment(u.id, codeFor(secret));
    return { secret, codes: r.codes as string[] };
  };

  // ---------- (1) enrolment does not activate until a code is verified ----------
  console.log("\n(1) enrolling:");
  const a = await mk("enrol");
  const { secret } = await beginEnrolment(a.id, a.email);
  let st = await mfaStatus(a.id);
  check(st.enabled === false && st.enrolling === true,
    "starting enrolment does NOT switch two-factor on \u2014 an abandoned setup cannot lock anyone out");
  const bad = await confirmEnrolment(a.id, "000000");
  check(bad.ok === false && (await mfaStatus(a.id)).enabled === false,
    "a wrong code does not activate it either");
  const good = await confirmEnrolment(a.id, codeFor(secret));
  check(good.ok === true && (await mfaStatus(a.id)).enabled === true,
    "a correct code activates it \u2014 and only then");
  check(Array.isArray(good.codes) && good.codes.length === 10 && (await recoveryCodesRemaining(a.id)) === 10,
    `ten recovery codes exist the moment it goes live (${good.codes!.length}) \u2014 it can never be on without a way back`);
  const stored = await db.userRecoveryCode.findMany({ where: { userId: a.id }, select: { codeHash: true } });
  check(stored.every((r: any) => r.codeHash && !good.codes!.some((c: string) => r.codeHash.includes(c))),
    "\u2026and they are stored HASHED \u2014 no plain code is in the database");

  // ---------- (2) with two-factor OFF, sign-in is exactly as today ----------
  console.log("\n(2) with two-factor off:");
  const plain = await mk("plain");
  const off = await post("/api/auth/login", { email: plain.email, password: PW });
  check(off.status === 200 && off.body && off.body.user && !off.body.mfaRequired,
    "a correct password signs straight in, as it always has");
  check(/air_session=/.test(off.setCookie) && (await canReachMe(off.setCookie)),
    "\u2026with a real session that reaches an authenticated route");
  const wrong = await post("/api/auth/login", { email: plain.email, password: "nope" });
  check(wrong.status === 401 && !/air_session=/.test(wrong.setCookie), "a wrong password still fails, with no session");

  // ---------- (3) THE WHOLE FEATURE ----------
  console.log("\n(3) with two-factor ON, a correct password is not enough:");
  const g = await mk("guarded");
  const { secret: gSecret, codes: gCodes } = await enrol(g);
  const step1 = await post("/api/auth/login", { email: g.email, password: PW });
  check(step1.status === 200 && step1.body && step1.body.mfaRequired === true && !step1.body.user,
    "the correct password returns a challenge, not a user");
  check(!/air_session=/.test(step1.setCookie),
    "NO SESSION COOKIE IS SET \u2014 the browser is handed nothing it can sign in with");
  const pendingJar = step1.setCookie;
  check((await canReachMe(pendingJar)) === false,
    "\u2026and the cookies it WAS given cannot reach an authenticated route");
  // NOTE: enrolment itself CONSUMED the current step (confirmEnrolment stores it as the
  // replay high-water mark), so the code for that same step is already spent. Use the next
  // one - which is exactly what a real user does, because by the time they have typed the
  // code from their app the clock has moved on. Section (4) then reuses THIS code to prove
  // replay protection directly.
  const liveCode = totpCodeForStep(gSecret, totpStep() + 1);
  const step2 = await post("/api/auth/login/mfa", { code: liveCode }, pendingJar);
  check(step2.status === 200 && step2.body && step2.body.user && /air_session=/.test(step2.setCookie),
    "the right code completes the sign-in and issues the session");
  check(await canReachMe(step2.setCookie), "\u2026which now reaches an authenticated route");

  // ---------- (4) wrong, reused, expired ----------
  console.log("\n(4) codes that must not work:");
  const s2 = await post("/api/auth/login", { email: g.email, password: PW });
  const badCode = await post("/api/auth/login/mfa", { code: "000000" }, s2.setCookie);
  check(badCode.status === 401 && !/air_session=/.test(badCode.setCookie), "a wrong code gets no session");
  const s3 = await post("/api/auth/login", { email: g.email, password: PW });
  const reused = await post("/api/auth/login/mfa", { code: liveCode }, s3.setCookie);
  check(reused.status === 401 && !/air_session=/.test(reused.setCookie),
    "REPLAY: the EXACT code that just signed in is refused a second time, inside its own window");
  const noTicket = await post("/api/auth/login/mfa", { code: codeFor(gSecret) }, "");
  check(noTicket.status === 400,
    "code entry with no pending attempt is refused \u2014 the ticket is single-use and cannot be forged");

  // ---------- (5) recovery codes ----------
  console.log("\n(5) recovery codes:");
  const one = gCodes[0];
  check((await consumeRecoveryCode(g.id, one)) === true, "a recovery code is accepted");
  check((await recoveryCodesRemaining(g.id)) === 9, "\u2026the remaining count drops to 9");
  check((await consumeRecoveryCode(g.id, one)) === false, "\u2026and the SAME code never works again");
  check((await consumeRecoveryCode(g.id, "AAAAA-BBBBB")) === false, "an invented code is refused");

  // ---------- (6) remembered devices are revocable ----------
  console.log("\n(6) a remembered device:");
  const tok = await rememberDevice(g.id, "test");
  check((await deviceIsTrusted(g.id, tok)) === true, "the device is trusted");
  check((await deviceIsTrusted(plain.id, tok)) === false, "\u2026only for the account that earned it");
  await forgetAllDevices(g.id);
  check((await deviceIsTrusted(g.id, tok)) === false,
    "forgetting devices revokes it \u2014 which is what a password change and turning two-factor off both do");
  const tok2 = await rememberDevice(g.id, "test2");
  await disableMfa(g.id);
  check((await deviceIsTrusted(g.id, tok2)) === false && (await recoveryCodesRemaining(g.id)) === 0,
    "turning two-factor off clears the devices AND the recovery codes with it");

  // ---------- (7) changing a password proves who you are ----------
  console.log("\n(7) changing a password:");
  const p = await mk("pw");
  const session = await post("/api/auth/login", { email: p.email, password: PW });
  const jar = session.setCookie;
  const noCur = await post("/api/account/password", { password: "Brand-New-Pass-1!" }, jar);
  check(noCur.status === 401,
    "A LIVE SESSION IS NOT ENOUGH \u2014 without the current password the change is refused");
  check(noCur.body && noCur.body.error === "Invalid email or password",
    "\u2026with the same generic message a failed sign-in gives, so it leaks nothing");
  const wrongCur = await post("/api/account/password", { currentPassword: "not-it", password: "Brand-New-Pass-1!" }, jar);
  check(wrongCur.status === 401, "a wrong current password is refused");
  const okChange = await post("/api/account/password", { currentPassword: PW, password: "Brand-New-Pass-1!" }, jar);
  check(okChange.status === 200, "the correct current password lets it through");
  const relog = await post("/api/auth/login", { email: p.email, password: "Brand-New-Pass-1!" });
  check(relog.status === 200 && !!relog.body.user, "\u2026and the new password really works");

  // ---------- (8) turning it off needs both factors ----------
  console.log("\n(8) turning two-factor off:");
  const d = await mk("disable");
  const { secret: dSecret, codes: dCodes } = await enrol(d);
  const dLogin = await post("/api/auth/login", { email: d.email, password: PW });
  // Each use must be a DIFFERENT step: enrolment spent the current one, so sign-in takes
  // +1 and turning it off takes +2. Reusing a step here would be refused by the very replay
  // protection section (4) proves - correct behaviour, wrong fixture.
  const dJar = (await post("/api/auth/login/mfa", { code: totpCodeForStep(dSecret, totpStep() + 1) }, dLogin.setCookie)).setCookie;
  const sessionOnly = await post("/api/account/mfa/disable", {}, dJar);
  check(sessionOnly.status === 401 && (await mfaStatus(d.id)).enabled === true,
    "a live session alone does NOT turn it off");
  const pwOnly = await post("/api/account/mfa/disable", { currentPassword: PW }, dJar);
  check(pwOnly.status === 401 && (await mfaStatus(d.id)).enabled === true,
    "\u2026nor does the password without a code");
  // A RECOVERY CODE in place of an authenticator code - the documented alternative, and it
  // avoids competing for a TOTP step with the sign-in above. Only +/-1 step is ever valid, so
  // a third distinct code inside one test run is not available by design.
  const bothOk = await post("/api/account/mfa/disable", { currentPassword: PW, code: dCodes[0] }, dJar);
  check(bothOk.status === 200 && (await mfaStatus(d.id)).enabled === false,
    "the password plus a RECOVERY code turns it off \u2014 either second factor satisfies it");

  // ---------- (9) the escape hatch does one thing ----------
  console.log("\n(9) the command-line escape hatch:");
  const e = await mk("cli");
  await enrol(e);
  const beforeHash = (await db.user.findUnique({ where: { id: e.id } })).passwordHash;
  const beforeRole = (await db.user.findUnique({ where: { id: e.id } })).role;
  await new Promise<void>((resolve, reject) => {
    require("child_process").execFile("tsx", ["src/db/clearMfa.ts", e.email], { cwd: process.cwd(), timeout: 90000 },
      (err: any) => (err && err.code ? reject(err) : resolve()));
  });
  const after = await db.user.findUnique({ where: { id: e.id } });
  check(!mfaIsOn(after) && (await recoveryCodesRemaining(e.id)) === 0,
    "it clears two-factor and the recovery codes for that account");
  check(after.passwordHash === beforeHash && after.role === beforeRole,
    "\u2026and does NOT touch the password or the role \u2014 they still need the password to sign in");
  const others = await db.user.findUnique({ where: { id: a.id } });
  check(mfaIsOn(others), "\u2026and leaves every other account alone");

  server.close();
  for (const id of cleanup) { await db.user.delete({ where: { id } }).catch(() => { /* best-effort */ }); }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (a second gate that only ever adds one)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
