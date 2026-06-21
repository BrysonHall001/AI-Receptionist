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
import { requireAuth, requireRole, resolveTenantScope } from "../middleware/auth";
import { isProduction, env } from "../config/env";
import { logger } from "../utils/logger";
import { google } from "googleapis";
import {
  googleConfigured,
  buildConsentUrl,
  exchangeCodeForTokens,
  fetchAccountEmail,
  chooseRefreshTokenForStore,
  listCalendars,
  freeBusyForCalendar,
  normalizeFreeBusyWindow,
  GoogleNotReachableError,
  GOOGLE_SCOPES,
} from "../services/googleClient";
import {
  upsertGoogleConnection,
  disconnectGoogle,
  getConnectionStatus,
  setResourceCalendarMap,
  clearResourceCalendarMap,
  listResourceCalendarMaps,
} from "../services/googleConnectionService";
import { prisma } from "../db/client";
import { runGoogleCalendarSync, previewSync } from "../services/googleSyncService";
import { syncRemoveAllGoogleBookingsForResource, syncRemoveAllGoogleBookingsForTenant } from "../services/recordService";

const db = prisma as any;

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

// GET /api/google/status — leak-proof: {connected, accountEmail, configured, mappings}.
googleRouter.get("/status", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  if (!editable(req)) { res.status(403).json({ error: "Not authorized" }); return; }
  const status = await getConnectionStatus(tenantId);
  res.json({
    connected: status.connected,
    accountEmail: status.accountEmail,
    configured: googleConfigured(),
    mappings: status.mappings, // [{resourceId, googleCalendarId, calendarSummary}] — no tokens
  });
});

// GET /api/google/calendars — the connected account's calendars (id + name only).
// 200 with an array (possibly empty = "connected, zero calendars"); a 502 with
// {needsReconnect:true} when the connection is missing/revoked or Google is
// unreachable — so the UI can tell "no calendars" apart from "couldn't reach Google".
googleRouter.get("/calendars", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  if (!editable(req)) { res.status(403).json({ error: "Not authorized" }); return; }
  try {
    const calendars = await listCalendars(tenantId);
    res.json({ calendars });
  } catch (e) {
    if (e instanceof GoogleNotReachableError) {
      res.status(502).json({ error: e.message, needsReconnect: true });
      return;
    }
    logger.error(`[google] list calendars failed: ${(e as Error).message}`); // never logs tokens
    res.status(502).json({ error: "Couldn't reach Google. Please try reconnecting.", needsReconnect: true });
  }
});

// Resource ownership guard — the resource must belong to this tenant (and not be
// soft-deleted), so a mapping can't be set/cleared cross-tenant.
async function ownedResource(tenantId: string, resourceId: unknown): Promise<boolean> {
  if (!resourceId || typeof resourceId !== "string") return false;
  const r = await db.resource.findFirst({ where: { id: resourceId, tenantId, deletedAt: null } });
  return !!r;
}

// PUT /api/google/calendars/map — map a resource to a calendar (upsert; one
// calendar per resource, re-mapping replaces). Returns the mapping (no tokens).
googleRouter.put("/calendars/map", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  if (!editable(req)) { res.status(403).json({ error: "Not authorized" }); return; }
  const { resourceId, googleCalendarId, calendarSummary } = (req.body ?? {}) as {
    resourceId?: string; googleCalendarId?: string; calendarSummary?: string | null;
  };
  if (!googleCalendarId || typeof googleCalendarId !== "string") { res.status(400).json({ error: "A calendar is required" }); return; }
  if (!(await ownedResource(tenantId, resourceId))) { res.status(404).json({ error: "Resource not found" }); return; }
  await setResourceCalendarMap(tenantId, resourceId as string, googleCalendarId, calendarSummary ?? null);
  res.json({ ok: true, mapping: { resourceId, googleCalendarId, calendarSummary: calendarSummary ?? null } });
});

// DELETE /api/google/calendars/map — clear a resource's mapping.
googleRouter.delete("/calendars/map", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  if (!editable(req)) { res.status(403).json({ error: "Not authorized" }); return; }
  const { resourceId } = (req.body ?? {}) as { resourceId?: string };
  if (!(await ownedResource(tenantId, resourceId))) { res.status(404).json({ error: "Resource not found" }); return; }
  await clearResourceCalendarMap(resourceId as string);
  // Mapping-cleanup: the resource's Google-owned bookings are no longer authoritative.
  await syncRemoveAllGoogleBookingsForResource(tenantId, resourceId as string);
  res.json({ ok: true });
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

// POST /api/google/sync/run — ADMIN-ONLY manual sync trigger (Sub-batch D). Runs
// the read-in sync for THIS tenant immediately (ignores the ~5-min cadence) so the
// owner can test without waiting for a scheduler tick. Honors the per-tenant
// syncEnabled flag (does nothing if sync is off for the tenant). Returns counts.
googleRouter.post("/sync/run", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).json({ error: "No portal selected (include ?tenantId=...)." }); return; }
  try {
    const summary = await runGoogleCalendarSync(tenantId, undefined, { ignoreCadence: true });
    res.json({ ok: true, summary });
  } catch (e) {
    logger.error(`[google] manual sync failed: ${(e as Error).message}`);
    res.status(500).json({ error: "Sync run failed." });
  }
});

// GET /api/google/debug/sync-preview — ADMIN-ONLY read-only diagnostic. Runs the
// EXACT setup the read-in sync uses (timezone, forward window, mapping lookup,
// events.list) but writes nothing. Answers "why zero events?": shows the window,
// every mapping's calendarId, and the raw events Google returned per calendar.
googleRouter.get("/debug/sync-preview", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).json({ error: "No portal selected (include ?tenantId=...)." }); return; }
  try {
    const preview = await previewSync(tenantId);
    res.json({ ok: true, preview });
  } catch (e) {
    logger.error(`[google] sync-preview failed: ${(e as Error).message}`);
    res.status(500).json({ error: (e as Error).message });
  }
});
googleRouter.post("/disconnect", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  if (!editable(req)) { res.status(403).json({ error: "Not authorized" }); return; }
  await disconnectGoogle(tenantId);
  // Disconnect-cleanup: none of this tenant's Google-owned bookings are authoritative now.
  await syncRemoveAllGoogleBookingsForTenant(tenantId);
  res.json({ ok: true });
});

// GET /api/google/debug/freebusy?resourceId=&from=&to= — ADMIN-ONLY proof endpoint.
// Reads RAW busy intervals for a resource's mapped calendar over a window, exactly
// as Google returns them. NO timezone conversion, NO reshaping, NO availability
// wiring — this only proves the pipe carries data. Distinct, explicit `result`
// values so no failure ever looks like a silent "free":
//   no_calendar_mapped | needs_reconnect | bad_request | ok (busy may be []).
// Gated tighter than the settings card: OWNER/SUPER_ADMIN only (a debug tool).
googleRouter.get("/debug/freebusy", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.status(400).json({ result: "bad_request", message: "No portal selected (include ?tenantId=...)." }); return; }

  const { resourceId, from, to } = req.query as { resourceId?: string; from?: string; to?: string };
  if (!resourceId || typeof resourceId !== "string") {
    res.status(400).json({ result: "bad_request", message: "resourceId is required." }); return;
  }
  let window;
  try { window = normalizeFreeBusyWindow(from, to); }
  catch (e) { res.status(400).json({ result: "bad_request", message: (e as Error).message }); return; }

  // Mapping lookup (sub-batch 3). No mapping = explicit, not an empty success.
  const map = (await listResourceCalendarMaps(tenantId)).find((m) => m.resourceId === resourceId);
  if (!map) {
    res.status(200).json({ result: "no_calendar_mapped", resourceId, message: "No calendar mapped for this resource." });
    return;
  }

  try {
    const fb = await freeBusyForCalendar(tenantId, map.googleCalendarId, window.fromISO, window.toISO);
    res.json({
      result: "ok",
      resourceId,
      calendarId: map.googleCalendarId,
      calendarSummary: map.calendarSummary,
      window,
      busy: fb.busy,                 // RAW from Google (real tz-aware instants), [] = genuinely free
      googleErrors: fb.googleErrors, // e.g. a calendar the account can no longer see
    });
  } catch (e) {
    if (e instanceof GoogleNotReachableError) {
      res.status(502).json({ result: "needs_reconnect", message: "Google connection needs reconnecting." });
      return;
    }
    logger.error(`[google] debug freebusy failed: ${(e as Error).message}`); // never logs tokens
    res.status(502).json({ result: "error", message: "Couldn't reach Google. Please try reconnecting." });
  }
});
