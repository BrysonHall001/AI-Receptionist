import { Router, Request, Response } from "express";
import { prisma } from "../db/client";
import { verifyPassword } from "../auth/passwords";
import { checkPassword } from "../auth/passwords";
import { createSession, destroySession, setSessionCookie, clearSessionCookie, SESSION_COOKIE } from "../auth/session";
import { createResetToken, consumeResetToken, publicUser, accountInactive } from "../services/userService";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import {
  configuredSsoProviders, isSsoConfigured, ssoAuthorizeUrl, newPkcePair, exchangeSsoCode,
  SSO_STATE_COOKIE, SSO_STATE_TTL_MS, signSsoState, sameSsoSig, packSsoState, openSsoState, verifySsoStart,
  type SsoProvider,
} from "../services/ssoProviders";
import { resolveSsoSignIn, createSsoLink, removeSsoLink, listSsoLinks } from "../services/ssoSignInService";
import { mfaIsOn, satisfySecondFactor, deviceIsTrusted, rememberDevice, TRUSTED_DEVICE_COOKIE, TRUSTED_DEVICE_DAYS } from "../services/mfaService";
import { sendPlainEmail } from "../services/notificationService";
import { env, smsEnabled } from "../config/env";
import { storageMode } from "../services/fileStorage";
import { audit } from "../services/auditService";
import { AUDIT_ACTIONS } from "../services/auditCatalog";
import { logger } from "../utils/logger";
import { rateLimit } from "../middleware/rateLimit";
import { can, NAV_VIEW_AREAS } from "../services/permissionService";
import { getLockedPages } from "../services/portalService";

export const authRouter = Router();

// Throttle credential-guessing. Keyed by IP+email for login so one attacker
// can't grind a single account, with a looser IP-only cap on reset endpoints.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `${req.ip}:${String((req.body && req.body.email) || "").toLowerCase()}`,
  message: "Too many login attempts. Please wait a few minutes and try again.",
});
// Broader cap per IP so rotating the email can't bypass the per-account limit.
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  keyFn: (req) => req.ip || "unknown",
  message: "Too many login attempts from this connection. Please wait and try again.",
});
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });

authRouter.post("/login", loginIpLimiter, loginLimiter, async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    audit({ tenantId: (user as any)?.tenantId ?? null, actorType: "user", actorId: user?.id ?? null, actorLabel: email.trim().toLowerCase(), action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED, subjectType: "auth", meta: { ip: req.ip || null } }); // fire-and-forget; never blocks the 401
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (accountInactive(user)) {
    res.status(403).json({ error: "This account has expired." });
    return;
  }
  // SECOND FACTOR. With MFA off this is a no-op and sign-in is exactly as it was. With MFA
  // on, NO SESSION IS CREATED HERE - the browser gets a short-lived pending ticket instead,
  // and only the code-entry route below can turn it into a session.
  if (mfaIsOn(user as any) && !(await deviceIsTrusted(user.id, req.cookies?.[TRUSTED_DEVICE_COOKIE]))) {
    setPendingMfa(res, user.id);
    res.json({ mfaRequired: true });
    return;
  }
  await finishSignIn(req, res, user, "password");
  res.json({ user: publicUser(user) });
});

// ---------------------------- the second factor ----------------------------
const MFA_PENDING_COOKIE = "air_mfa";
const MFA_PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * THE INTERMEDIATE STATE. Not a session: it proves only that step one passed. It reuses the
 * SSO state cookie's proven shape - HMAC-signed, httpOnly, single-use, short-lived - and is
 * bound to this browser because it IS a cookie. getUserForToken never sees it, so nothing in
 * the app treats it as authentication.
 */
function setPendingMfa(res: Response, userId: string): void {
  const payload = `${userId}.${Date.now()}`;
  res.cookie(MFA_PENDING_COOKIE, packSsoState(payload), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: MFA_PENDING_TTL_MS, path: "/",
  });
}
function readPendingMfa(req: Request): string | null {
  const payload = openSsoState(String(req.cookies?.[MFA_PENDING_COOKIE] || ""));
  if (!payload) return null;
  const i = payload.lastIndexOf(".");
  const userId = payload.slice(0, i), ts = Number(payload.slice(i + 1));
  if (!userId || !Number.isFinite(ts) || Date.now() - ts > MFA_PENDING_TTL_MS) return null;
  return userId;
}

/** Mint the session and audit it. One place, so every path records the same thing. */
async function finishSignIn(req: Request, res: Response, user: any, how: "password" | "sso" | "mfa" | "recovery"): Promise<void> {
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  audit({ tenantId: user.tenantId ?? null, actorType: "user", actorId: user.id, actorLabel: user.name || user.email, actorRole: user.customRoleId ? "CUSTOM:" + user.customRoleId : user.role || null, action: how === "sso" ? AUDIT_ACTIONS.AUTH_SSO_LOGIN : AUDIT_ACTIONS.AUTH_LOGIN, subjectType: "auth", meta: { ip: req.ip || null, how } });
}

/**
 * CODE ENTRY. Both existing rate limiters apply - a six-digit code is the one place brute
 * force is realistic, so this is the route that most needs them.
 */
authRouter.post("/login/mfa", loginIpLimiter, loginLimiter, async (req: Request, res: Response) => {
  const userId = readPendingMfa(req);
  res.clearCookie(MFA_PENDING_COOKIE, { path: "/" }); // SINGLE USE
  if (!userId) { res.status(400).json({ error: "That sign-in attempt has expired. Please start again." }); return; }
  const { code, remember } = (req.body ?? {}) as { code?: string; remember?: boolean };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) { res.status(401).json({ error: "Invalid code" }); return; }
  if (accountInactive(user)) { res.status(403).json({ error: "This account has expired." }); return; }

  const how = await satisfySecondFactor(user.id, String(code || ""));
  if (!how) {
    audit({ tenantId: (user as any).tenantId ?? null, actorType: "user", actorId: user.id, actorLabel: user.email, action: AUDIT_ACTIONS.MFA_CHALLENGE_FAILED, subjectType: "auth", meta: { ip: req.ip || null } });
    setPendingMfa(res, user.id); // let them try again within the same 5 minutes
    res.status(401).json({ error: "That code wasn't right. Try again." });
    return;
  }
  if (how === "recovery") {
    audit({ tenantId: (user as any).tenantId ?? null, actorType: "user", actorId: user.id, actorLabel: user.email, action: AUDIT_ACTIONS.MFA_RECOVERY_USED, subjectType: "auth", meta: { ip: req.ip || null } });
  }
  if (remember === true) {
    const dt = await rememberDevice(user.id, String(req.headers["user-agent"] || "").slice(0, 120));
    res.cookie(TRUSTED_DEVICE_COOKIE, dt, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: TRUSTED_DEVICE_DAYS * 86400000, path: "/" });
  }
  await finishSignIn(req, res, user, how === "recovery" ? "recovery" : "mfa");
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", async (req: Request, res: Response) => {
  const u: any = (req as any).user;
  if (u) audit({ tenantId: u.tenantId ?? null, actorType: "user", actorId: u.id, actorLabel: u.name || u.email, actorRole: u.customRoleId ? "CUSTOM:" + u.customRoleId : u.role || null, action: AUDIT_ACTIONS.AUTH_LOGOUT, subjectType: "auth", meta: { ip: req.ip || null } });
  await destroySession(req.cookies?.[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // Batch D2 (UI stage): return the EFFECTIVE identity (req.user). For everyone who
  // isn't acting-as-type, req.user IS the real user, so this is unchanged for them.
  // During act-as-type it carries the effective role + pinned tenant, so the whole
  // UI renders as that role. The persistent banner + Exit (driven by the server's
  // /api/impersonation, which checks the REAL identity) stay on top regardless.
  //
  // Batch 3 (nav reconciliation): also send the per-area VIEW map the sidebar derives
  // from, computed by the SAME resolver the server enforces with. For system roles
  // every nav area is true (so menus are unchanged); custom roles get a correct menu
  // automatically. Cosmetic nav-hide is applied separately on the client.
  const permView: Record<string, boolean> = {};
  for (const area of NAV_VIEW_AREAS) permView[area] = await can(req.user as any, area, "view");
  // EDIT rights the client actually needs for UI affordances (Scheduling Calendar
  // batch: drag handles hide for view-only users). Additive; the server-side
  // permissionGate remains the enforcer — this is honesty, not enforcement.
  const permEdit: Record<string, boolean> = { records: await can(req.user as any, "records", "edit") };
  // Billing isn't a nav area, but the client needs its view flag to show/hide the Settings
  // Billing tab (server still enforces the endpoint independently).
  permView["billing"] = await can(req.user as any, "billing", "view");
  const lockedPages = (req.user as any)?.tenantId ? await getLockedPages((req.user as any).tenantId) : [];
  // PER-TEMPLATE LEARNING CENTER — THE FLAG CONTRACT, computed here and ONLY
  // here (the client never re-derives it): the variant applies exactly when the
  // tenant was created from the Field Services template AND its card checkbox
  // was checked. Everything else — FS+unchecked, General, every pre-existing
  // tenant — gets the stock LC, byte-identical.
  let lcVariant: string | null = null;
  if ((req.user as any)?.tenantId) {
    const trow = await prisma.tenant.findUnique({ where: { id: (req.user as any).tenantId }, select: { templateKey: true, customLearningCenter: true } as any }) as any;
    // The ONE variant seam (batch-24). RM-3 joins it honestly: a template that
    // HAS a shipped variant + the owner's opt-in = that variant; anything else
    // (no variant, box unchecked, any pre-existing tenant) = stock, untouched.
    const LC_VARIANT_TEMPLATES: Record<string, string> = { field_services: "field_services", recruitment_marketing: "recruitment_marketing", food_service: "food_service" };
    if (trow && trow.customLearningCenter === true && LC_VARIANT_TEMPLATES[String(trow.templateKey || "")]) {
      lcVariant = LC_VARIANT_TEMPLATES[String(trow.templateKey)];
    }
  }
  res.json({ user: { ...req.user, permView, permEdit, lockedPages }, features: {
    lcVariant,
    smsEnabled: smsEnabled(),
    // File Storage batch: when true the SPA's image/file editors upload to
    // POST /api/files and store references (with the raised caps); when false
    // they keep the pre-batch embedded-base64 behavior byte-for-byte.
    fileStorage: storageMode() !== "off",
  } });
});

authRouter.post("/forgot", resetLimiter, async (req: Request, res: Response) => {
  const { email } = (req.body ?? {}) as { email?: string };
  if (email) {
    const result = await createResetToken(email);
    if (result) {
      const link = `${env.APP_BASE_URL}/#/reset?token=${result.token}`;
      try {
        await sendPlainEmail(email, "Reset your password", `Use this link to reset your password:\n\n${link}\n\nThis link expires in 1 hour.`, { type: "password_reset" });
      } catch (err) {
        logger.error(`reset email failed: ${(err as Error).message}`);
      }
      logger.info(`Password reset link for ${email}: ${link}`);
    }
  }
  // Always succeed, to avoid leaking which emails exist.
  res.json({ ok: true });
});

authRouter.post("/reset", resetLimiter, async (req: Request, res: Response) => {
  const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
  if (!token) {
    res.status(400).json({ error: "A valid reset token is required" });
    return;
  }
  const pw = checkPassword(String(password ?? ""));
  if (!pw.ok) {
    res.status(400).json({ error: pw.message });
    return;
  }
  const ok = await consumeResetToken(token, password!);
  if (!ok) {
    res.status(400).json({ error: "This reset link is invalid or has expired" });
    return;
  }
  res.json({ ok: true });
});

// ============================== SSO SIGN-IN ==============================
// SSO adds a way to PROVE an existing identity. It never creates an account, never grants
// anything a password would not, and never skips a check the password path applies.
//
// Everything below is inert when no credentials are configured: the start route 404s, the
// callback 404s, and /sso/providers returns an empty list so the sign-in screen renders
// exactly as it does today.

/** Which providers may render a button. Empty list = today's sign-in screen, unchanged. */
authRouter.get("/sso/providers", (_req: Request, res: Response) => {
  res.json({ providers: configuredSsoProviders() });
});

/** Begin. Mints the state + PKCE pair, parks them in a short-lived signed cookie, redirects. */
authRouter.get("/sso/:provider/start", (req: Request, res: Response) => {
  const provider = String(req.params.provider) as SsoProvider;
  if (provider !== "google" && provider !== "microsoft") { res.status(404).json({ error: "Unknown sign-in provider" }); return; }
  if (!isSsoConfigured(provider)) { res.status(404).json({ error: "That sign-in method isn't available." }); return; }
  const nonce = randomBytes(24).toString("base64url");
  const { verifier, challenge } = newPkcePair();
  const payload = `${provider}.${nonce}.${Date.now()}.${verifier}`;
  res.cookie(SSO_STATE_COOKIE, packSsoState(payload), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: SSO_STATE_TTL_MS, path: "/",
  });
  res.redirect(ssoAuthorizeUrl(provider, nonce, challenge));
});

/**
 * CSRF AND REPLAY. The state cookie is HMAC-signed, single-use and short-lived:
 *  - tampered signature  -> refused (constant-time compare)
 *  - wrong provider      -> refused
 *  - nonce mismatch      -> refused (the `state` the provider echoes must equal the cookie's)
 *  - older than 10 min   -> refused
 *  - replay              -> refused, because the cookie is cleared on first use, so a second
 *                           callback (or one in another browser) has nothing to compare to
 * Every refusal happens BEFORE any database lookup.
 */
const ssoFail = (req: Request, label: string, code: string) =>
  audit({ tenantId: null, actorType: "user", actorId: null, actorLabel: label, action: AUDIT_ACTIONS.AUTH_SSO_FAILED, subjectType: "auth", meta: { ip: req.ip || null, code } });

/** The callback. Both existing rate limiters apply, exactly as on the password path. */
authRouter.get("/sso/:provider/callback", loginIpLimiter, loginLimiter, async (req: Request, res: Response) => {
  const provider = String(req.params.provider) as SsoProvider;
  if (provider !== "google" && provider !== "microsoft") { res.status(404).json({ error: "Unknown sign-in provider" }); return; }
  if (!isSsoConfigured(provider)) { res.status(404).json({ error: "That sign-in method isn't available." }); return; }

  const st = verifySsoStart(String(req.cookies?.[SSO_STATE_COOKIE] || ""), provider, String(req.query.state || ""));
  res.clearCookie(SSO_STATE_COOKIE, { path: "/" }); // SINGLE USE: cleared before anything else
  if (!st.ok) { ssoFail(req, "sso:" + provider, st.why); res.status(400).json({ error: "That sign-in attempt has expired. Please try again." }); return; }

  const code = String(req.query.code || "");
  if (!code) { ssoFail(req, "sso:" + provider, "no_code"); res.status(400).json({ error: "Sign-in was cancelled." }); return; }

  const identity = await exchangeSsoCode(provider, code, st.verifier);
  if (!identity) { ssoFail(req, "sso:" + provider, "exchange_failed"); res.status(400).json({ error: "We couldn't complete that sign-in. Please try again." }); return; }

  const outcome = await resolveSsoSignIn(identity);
  if (outcome.kind === "refused") {
    ssoFail(req, identity.email || ("sso:" + provider), outcome.code);
    res.status(401).json({ error: outcome.reason });
    return;
  }
  if (outcome.kind === "needs_link") {
    // NO SESSION IS ISSUED HERE. The browser is handed a one-time linking ticket and asked
    // for the account's own password; the link is stored only when that password verifies.
    const payload = `${provider}.${outcome.subject}.${outcome.email}.${Date.now()}`;
    res.cookie(SSO_STATE_COOKIE, packSsoState(payload), {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: SSO_STATE_TTL_MS, path: "/",
    });
    res.redirect(`/#/sso-link?provider=${encodeURIComponent(provider)}&email=${encodeURIComponent(outcome.email)}`);
    return;
  }
  // SSO IS CHALLENGED FOR MFA TOO. Our second factor is OUR control: if someone's Google
  // account is compromised, our MFA is exactly what should stand in the way, and it is worth
  // nothing if the identity provider can wave it through. The 30-day remembered-device
  // window keeps this to roughly once a month.
  const u: any = outcome.user;
  if (mfaIsOn(u) && !(await deviceIsTrusted(u.id, req.cookies?.[TRUSTED_DEVICE_COOKIE]))) {
    setPendingMfa(res, u.id);
    res.redirect("/#/mfa");
    return;
  }
  await finishSignIn(req, res, u, "sso");
  res.redirect("/#/dashboard");
});

/**
 * THE ONE-TIME LINK CONFIRMATION.
 *
 * This is the password path with one extra step at the end, deliberately: the SAME two rate
 * limiters, the SAME verifyPassword, the SAME generic "Invalid email or password", and the
 * SAME AUTH_LOGIN_FAILED audit row on a wrong password - so a wrong password here is
 * indistinguishable from a wrong password at sign-in, to an attacker and in the audit log.
 * accountInactive() runs where it runs on the password path: after the password verifies,
 * before any session exists.
 */
authRouter.post("/sso/link", loginIpLimiter, loginLimiter, async (req: Request, res: Response) => {
  const { password } = (req.body ?? {}) as { password?: string };
  const raw = String(req.cookies?.[SSO_STATE_COOKIE] || "");
  res.clearCookie(SSO_STATE_COOKIE, { path: "/" }); // single use
  const ticket = openSsoState(raw);
  if (!ticket) {
    res.status(400).json({ error: "That linking attempt has expired. Please try again." });
    return;
  }
  const [provider, subject, email, tsRaw] = ticket.split(".");
  if (!Number.isFinite(Number(tsRaw)) || Date.now() - Number(tsRaw) > SSO_STATE_TTL_MS) {
    res.status(400).json({ error: "That linking attempt has expired. Please try again." });
    return;
  }
  if (!password) { res.status(400).json({ error: "Email and password are required" }); return; }

  const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    audit({ tenantId: (user as any)?.tenantId ?? null, actorType: "user", actorId: user?.id ?? null, actorLabel: String(email).trim().toLowerCase(), action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED, subjectType: "auth", meta: { ip: req.ip || null } });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (accountInactive(user)) { res.status(403).json({ error: "This account has expired." }); return; }

  // The link is created ONLY now - after the account's own password has been proven.
  try { await createSsoLink(user.id, provider as SsoProvider, subject, String(email)); }
  catch { res.status(409).json({ error: "That account is already linked. Sign in with your password and check Settings." }); return; }
  audit({ tenantId: (user as any).tenantId ?? null, actorType: "user", actorId: user.id, actorLabel: user.name || user.email, action: AUDIT_ACTIONS.AUTH_SSO_LINKED, subjectType: "auth", meta: { ip: req.ip || null, provider } });

  if (mfaIsOn(user as any) && !(await deviceIsTrusted(user.id, req.cookies?.[TRUSTED_DEVICE_COOKIE]))) {
    setPendingMfa(res, user.id);
    res.json({ mfaRequired: true });
    return;
  }
  await finishSignIn(req, res, user, "sso");
  res.json({ user: publicUser(user) });
});

/** The links on the signed-in account, for Settings -> Your account. */
authRouter.get("/sso/links", async (req: Request, res: Response) => {
  const u: any = (req as any).user;
  if (!u) { res.status(401).json({ error: "Not signed in" }); return; }
  res.json({ links: await listSsoLinks(u.id) });
});

/** Remove a link. Locks nobody out - every account keeps its password. */
authRouter.post("/sso/unlink", async (req: Request, res: Response) => {
  const u: any = (req as any).user;
  if (!u) { res.status(401).json({ error: "Not signed in" }); return; }
  const provider = String((req.body ?? {}).provider || "") as SsoProvider;
  if (provider !== "google" && provider !== "microsoft") { res.status(400).json({ error: "Unknown sign-in provider" }); return; }
  const removed = await removeSsoLink(u.id, provider);
  if (removed) audit({ tenantId: u.tenantId ?? null, actorType: "user", actorId: u.id, actorLabel: u.name || u.email, action: AUDIT_ACTIONS.AUTH_SSO_UNLINKED, subjectType: "auth", meta: { ip: req.ip || null, provider } });
  res.json({ ok: true, removed });
});
