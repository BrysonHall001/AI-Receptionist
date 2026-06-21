// Google Calendar OAuth routes (READ-ONLY). SUB-BATCH 2: connect / callback /
// disconnect / status. Mounted at /api/google behind login + a non-CLIENT_USER
// gate (the same tier that edits voice/timezone settings).
//
// SECURITY:
//   - Tokens never appear in any response here or in any log line. The only
//     outward shape is {connected, accountEmail} via getConnectionStatus.
//   - CSRF/tenant-binding: a one-time nonce is set in an HttpOnly, SameSite=Lax
//     cookie at connect and verified at callback (the cookie also carries the
//     tenant + initiating user). Stateless — survives restarts and multi-instance.

import crypto from "crypto";
import { Router, Request, Response } from "express";
import { requireAuth, resolveTenantScope } from "../middleware/auth";
import { isProduction, env } from "../config/env";
import { logger } from "../utils/logger";
import { google } from "googleapis";
import {
  googleConfigured,
  buildConsentUrl,
  exchangeCodeForTokens,
  fetchAccountEmail,
  chooseRefreshTokenForStore,
  GOOGLE_SCOPES,
} from "../services/googleClient";
import { upsertGoogleConnection, disconnectGoogle, getConnectionStatus } from "../services/googleConnectionService";

export const googleRouter = Router();
googleRouter.use(requireAuth);

const STATE_COOKIE = "g_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete consent

// Same gate as the voice/timezone settings: anyone but a CLIENT_USER may manage
// the portal's Google connection.
function editable(req: Request): boolean {
  return req.user!.role !== "CLIENT_USER";
}

// Bounce back into the SPA with a one-time ?google=<flag> the front-end reads + clears.
function appReturn(flag: string): string {
  return `/?google=${encodeURIComponent(flag)}#/calls`;
}

function setStateCookie(res: Response, value: string): void {
  res.cookie(STATE_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax", // sent on the top-level GET redirect back from Google
    secure: isProduction() || env.COOKIE_SECURE === "true",
    maxAge: STATE_TTL_MS,
    path: "/api/google",
  });
}
function clearStateCookie(res: Response): void {
  res.clearCookie(STATE_COOKIE, { path: "/api/google" });
}

// GET /api/google/status — leak-proof: {connected, accountEmail, configured}.
googleRouter.get("/status", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  if (!editable(req)) { res.status(403).json({ error: "Not authorized" }); return; }
  const status = await getConnectionStatus(tenantId);
  res.json({ connected: status.connected, accountEmail: status.accountEmail, configured: googleConfigured() });
});

// GET /api/google/connect — top-level browser navigation (NOT fetch). Mints a
// one-time nonce, stashes nonce+tenant+user in an HttpOnly cookie, redirects to
// Google's consent screen.
googleRouter.get("/connect", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).send("No portal selected"); return; }
  if (!editable(req)) { res.status(403).send("Not authorized"); return; }
  if (!googleConfigured()) { res.redirect(appReturn("unconfigured")); return; }
  const nonce = crypto.randomBytes(32).toString("hex");
  setStateCookie(res, `${nonce}.${tenantId}.${req.user!.id}`);
  res.redirect(buildConsentUrl(nonce));
});

// GET /api/google/oauth/callback — Google redirects here (top-level GET; the Lax
// session + state cookies ride along). Verify the nonce, exchange the code, store
// ENCRYPTED via the sub-batch 1 storage service.
googleRouter.get("/oauth/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  const cookie = req.cookies?.[STATE_COOKIE] as string | undefined;
  clearStateCookie(res); // one-time: always clear, success or fail

  if (error) { res.redirect(appReturn("denied")); return; }              // user declined consent
  if (!code || !state || !cookie) { res.redirect(appReturn("state")); return; }

  const [nonce, tenantId, userId] = cookie.split(".");
  // CSRF / tenant-binding: nonce must match, and the SAME logged-in, still-allowed
  // user must complete it. Any mismatch fails closed.
  if (!nonce || nonce !== String(state)) { res.redirect(appReturn("state")); return; }
  if (!req.user || req.user.id !== userId || req.user.role === "CLIENT_USER") { res.redirect(appReturn("auth")); return; }
  if (!tenantId) { res.redirect(appReturn("state")); return; }

  try {
    const tokens = await exchangeCodeForTokens(String(code));
    // Identity read for the status line (primary calendar id == account email),
    // within the read-only scope. Best-effort.
    let accountEmail: string | null = null;
    try {
      const idClient = new google.auth.OAuth2();
      idClient.setCredentials(tokens);
      accountEmail = await fetchAccountEmail(idClient);
    } catch { accountEmail = null; }

    await upsertGoogleConnection(tenantId, {
      accountEmail,
      accessToken: tokens.access_token ?? null,
      // PRESERVATION: undefined when Google returns no refresh token -> keep existing.
      refreshToken: chooseRefreshTokenForStore(tokens.refresh_token),
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? GOOGLE_SCOPES.join(" "),
      connectedById: req.user.id,
    });
    res.redirect(appReturn("connected"));
  } catch (e) {
    // Never log the code or any token.
    logger.error(`[google] oauth callback failed: ${(e as Error).message}`);
    res.redirect(appReturn("error"));
  }
});

// POST /api/google/disconnect — clears tokens + flips status (sub-batch 1 path).
googleRouter.post("/disconnect", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  if (!editable(req)) { res.status(403).json({ error: "Not authorized" }); return; }
  await disconnectGoogle(tenantId);
  res.json({ ok: true });
});
