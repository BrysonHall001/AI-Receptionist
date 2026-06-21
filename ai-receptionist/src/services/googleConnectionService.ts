// Storage layer for the per-business Google Calendar connection and the
// resource->calendar mappings (the hybrid model: ONE connection per tenant,
// many calendar->resource maps). SUB-BATCH 1: storage only. No OAuth, no Google
// API calls, no wiring into availability.
//
// SECURITY:
//   - Tokens are ENCRYPTED at rest (AES-256-GCM via tokenCrypto). The DB columns
//     never hold plaintext. encrypt-on-write / decrypt-on-read.
//   - Tokens are NEVER logged and NEVER returned by any GET-facing shape. The
//     only outward-facing reader here is getConnectionStatus(), which returns
//     booleans/email/mappings ONLY. getDecryptedConnection() is server-internal
//     (used by later sub-batches for refresh / free-busy) and must never be wired
//     to a route response.

import { prisma } from "../db/client";
import { encryptToken, decryptToken } from "./tokenCrypto";
import { scopeHasWrite } from "./googleClient";

const db = prisma as any;

export type GoogleConnectionStatusValue = "connected" | "revoked" | "error";

// ---- Outward-facing, leak-proof status DTO (NEVER contains tokens) ----------
export interface ResourceCalendarMapping {
  resourceId: string;
  googleCalendarId: string;
  calendarSummary: string | null;
}
export interface GoogleConnectionStatus {
  connected: boolean;                 // true only when status==connected AND a refresh token is stored
  accountEmail: string | null;
  status: GoogleConnectionStatusValue | null; // null when no connection row exists
  scope: string | null;
  writeGranted: boolean;              // events write scope present (F can push); false => needs re-consent
  syncEnabled: boolean;               // per-tenant read-in switch
  pushEnabled: boolean;               // per-tenant write-out switch
  lastSyncedAt: Date | null;          // last successful sync pass
  syncStatus: string | null;          // "ok" | "degraded" | null (before first sync)
  lastSyncError: string | null;       // reason when degraded
  mappings: ResourceCalendarMapping[];
}

// ---- Server-internal shape (DECRYPTED tokens; never expose via a route) ------
export interface DecryptedGoogleConnection {
  tenantId: string;
  accountEmail: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  scope: string | null;
  status: GoogleConnectionStatusValue;
}

// ---- Writes -----------------------------------------------------------------

export interface UpsertGoogleConnectionInput {
  accountEmail?: string | null;
  accessToken?: string | null;       // plaintext in -> stored encrypted
  refreshToken?: string | null;      // plaintext in -> stored encrypted; omit/undefined keeps existing
  accessTokenExpiresAt?: Date | null;
  scope?: string | null;
  connectedById?: string | null;
}

/**
 * Create or update the tenant's single Google connection. Tokens are encrypted
 * before they touch the DB. A refreshToken of `undefined` (not provided) PRESERVES
 * the existing one — Google only returns a refresh token on first consent, so a
 * reconnect that omits it must not wipe it. Passing `null` explicitly clears it.
 * Setting tokens marks the connection "connected".
 */
export async function upsertGoogleConnection(
  tenantId: string,
  input: UpsertGoogleConnectionInput,
): Promise<void> {
  const data: any = {
    status: "connected",
  };
  if (input.accountEmail !== undefined) data.accountEmail = input.accountEmail;
  if (input.scope !== undefined) data.scope = input.scope;
  if (input.accessTokenExpiresAt !== undefined) data.accessTokenExpiresAt = input.accessTokenExpiresAt;
  if (input.connectedById !== undefined) data.connectedById = input.connectedById;
  if (input.accessToken !== undefined) {
    data.accessTokenEnc = input.accessToken == null ? null : encryptToken(input.accessToken);
  }
  if (input.refreshToken !== undefined) {
    data.refreshTokenEnc = input.refreshToken == null ? null : encryptToken(input.refreshToken);
  }

  const existing = await db.googleConnection.findUnique({ where: { tenantId } });
  if (existing) {
    await db.googleConnection.update({ where: { tenantId }, data });
  } else {
    await db.googleConnection.create({ data: { tenantId, ...data } });
  }
}

/**
 * Persist a refreshed access token (called by the library's token-refresh hook in
 * a later sub-batch). Refresh token is untouched. Tokens encrypted on write.
 */
export async function updateAccessToken(
  tenantId: string,
  accessToken: string,
  accessTokenExpiresAt: Date | null,
): Promise<void> {
  await db.googleConnection.update({
    where: { tenantId },
    data: { accessTokenEnc: encryptToken(accessToken), accessTokenExpiresAt, status: "connected" },
  });
}

/** Mark the connection as errored (e.g. refresh failed / token revoked upstream). */
export async function markConnectionError(tenantId: string): Promise<void> {
  await db.googleConnection.updateMany({ where: { tenantId }, data: { status: "error" } });
}

/**
 * Disconnect: wipe both token columns and flip status to "revoked". The row is
 * kept (audit of who/when), but it holds NO tokens afterward. Mappings are left
 * intact (harmless string ids) so re-connecting can reuse them.
 */
export async function disconnectGoogle(tenantId: string): Promise<void> {
  await db.googleConnection.updateMany({
    where: { tenantId },
    data: { accessTokenEnc: null, refreshTokenEnc: null, accessTokenExpiresAt: null, status: "revoked" },
  });
}

// ---- Reads ------------------------------------------------------------------

/**
 * Server-INTERNAL: the connection with tokens DECRYPTED, for later sub-batches
 * (refresh, free-busy). Returns null if there's no usable connection. NEVER
 * return this from a route — use getConnectionStatus() for anything client-facing.
 */
export async function getDecryptedConnection(tenantId: string): Promise<DecryptedGoogleConnection | null> {
  const row = await db.googleConnection.findUnique({ where: { tenantId } });
  if (!row) return null;
  return {
    tenantId: row.tenantId,
    accountEmail: row.accountEmail ?? null,
    accessToken: row.accessTokenEnc ? decryptToken(row.accessTokenEnc) : null,
    refreshToken: row.refreshTokenEnc ? decryptToken(row.refreshTokenEnc) : null,
    accessTokenExpiresAt: row.accessTokenExpiresAt ?? null,
    scope: row.scope ?? null,
    status: (row.status as GoogleConnectionStatusValue) ?? "error",
  };
}

/**
 * Outward-facing status — booleans/email/mappings ONLY, never tokens. Safe to
 * return from a route. "connected" requires a stored refresh token AND status
 * connected, so a revoked/empty row reads as not-connected.
 */
export async function getConnectionStatus(tenantId: string): Promise<GoogleConnectionStatus> {
  const row = await db.googleConnection.findUnique({ where: { tenantId } });
  const mappings = await listResourceCalendarMaps(tenantId);
  if (!row) {
    return { connected: false, accountEmail: null, status: null, scope: null, writeGranted: false, syncEnabled: false, pushEnabled: false, lastSyncedAt: null, syncStatus: null, lastSyncError: null, mappings };
  }
  const connected = row.status === "connected" && !!row.refreshTokenEnc;
  return {
    connected,
    accountEmail: row.accountEmail ?? null,
    status: (row.status as GoogleConnectionStatusValue) ?? "error",
    scope: row.scope ?? null,
    writeGranted: scopeHasWrite(row.scope),
    syncEnabled: !!row.syncEnabled,
    pushEnabled: !!row.pushEnabled,
    lastSyncedAt: row.lastSyncedAt ?? null,
    syncStatus: row.syncStatus ?? null,
    lastSyncError: row.lastSyncError ?? null,
    mappings,
  };
}

const SYNC_STALE_MS = 15 * 60 * 1000; // degraded longer than this => treat data as stale

/** Is this tenant's sync degraded AND stale (no recent successful pass)? Used by
 *  the AI availability path to degrade safely instead of promising a stale slot.
 *  A brief transient blip (recent lastSyncedAt) does NOT count — only persistent
 *  degradation where we can't see fresh Google data. */
export async function isSyncDegradedStale(tenantId: string, now: Date = new Date()): Promise<boolean> {
  const row = await db.googleConnection.findUnique({
    where: { tenantId },
    select: { status: true, syncEnabled: true, syncStatus: true, lastSyncedAt: true },
  });
  if (!row || row.status !== "connected" || !row.syncEnabled) return false;
  if (row.syncStatus !== "degraded") return false;
  if (!row.lastSyncedAt) return true; // degraded and never synced -> definitely uncertain
  return now.getTime() - new Date(row.lastSyncedAt).getTime() > SYNC_STALE_MS;
}

/** Set per-tenant sync switches (the visible on/off control). Records that the
 *  owner has taken explicit control, so auto-enable won't override their choice. */
export async function setSyncSettings(tenantId: string, input: { syncEnabled?: boolean; pushEnabled?: boolean }): Promise<void> {
  const data: any = { syncConfiguredByUser: true };
  if (typeof input.syncEnabled === "boolean") data.syncEnabled = input.syncEnabled;
  if (typeof input.pushEnabled === "boolean") data.pushEnabled = input.pushEnabled;
  await db.googleConnection.updateMany({ where: { tenantId }, data });
}

/** Auto-enable sync when a business connects + maps a calendar. Read-in turns on;
 *  push turns on ONLY if the events write scope is granted (else it stays gated
 *  until they reconnect). Does nothing once the owner has explicitly toggled sync
 *  (so a deliberate "off" is never re-flipped on), and nothing if not connected. */
export async function autoEnableOnConnect(tenantId: string): Promise<void> {
  const row = await db.googleConnection.findUnique({
    where: { tenantId },
    select: { status: true, refreshTokenEnc: true, scope: true, syncConfiguredByUser: true },
  });
  if (!row || row.status !== "connected" || !row.refreshTokenEnc) return; // not connected
  if (row.syncConfiguredByUser) return; // owner has taken manual control — respect it
  const mapCount = await db.resourceCalendarMap.count({ where: { tenantId } });
  if (!mapCount) return; // nothing mapped yet -> nothing to sync
  await db.googleConnection.updateMany({
    where: { tenantId },
    data: { syncEnabled: true, pushEnabled: scopeHasWrite(row.scope) },
  });
}

/** F-gate: does this tenant's connection have the events write scope? F must call
 *  this before any push so a write never fires that would 403. (No write here.) */
export async function connectionHasWriteScope(tenantId: string): Promise<boolean> {
  const row = await db.googleConnection.findUnique({ where: { tenantId }, select: { scope: true } });
  return scopeHasWrite(row?.scope);
}

// ---- Resource <-> calendar mappings -----------------------------------------

export async function listResourceCalendarMaps(tenantId: string): Promise<ResourceCalendarMapping[]> {
  const rows = await db.resourceCalendarMap.findMany({ where: { tenantId } });
  return rows.map((r: any) => ({
    resourceId: r.resourceId,
    googleCalendarId: r.googleCalendarId,
    calendarSummary: r.calendarSummary ?? null,
  }));
}

/** Map (or re-map) a resource to a Google calendar. Upsert keyed on resourceId. */
export async function setResourceCalendarMap(
  tenantId: string,
  resourceId: string,
  googleCalendarId: string,
  calendarSummary?: string | null,
): Promise<void> {
  const existing = await db.resourceCalendarMap.findUnique({ where: { resourceId } });
  const data = { tenantId, resourceId, googleCalendarId, calendarSummary: calendarSummary ?? null };
  if (existing) {
    await db.resourceCalendarMap.update({ where: { resourceId }, data });
  } else {
    await db.resourceCalendarMap.create({ data });
  }
}

/** Remove a resource's calendar mapping (no-op if none). */
export async function clearResourceCalendarMap(resourceId: string): Promise<void> {
  await db.resourceCalendarMap.deleteMany({ where: { resourceId } });
}

// ---- Sync health + enablement (Sub-batch D) ----

export interface SyncEnabledConnection {
  tenantId: string;
  lastSyncedAt: Date | null;
  syncEnabled: boolean;
  pushEnabled: boolean;
}

/** Connections eligible for the sweep: connected AND (read-in OR push) enabled. */
export async function listActiveConnections(scope?: string | null): Promise<SyncEnabledConnection[]> {
  const where: any = { status: "connected", OR: [{ syncEnabled: true }, { pushEnabled: true }] };
  if (scope) where.tenantId = scope;
  const rows = await (prisma as any).googleConnection.findMany({ where, select: { tenantId: true, lastSyncedAt: true, syncEnabled: true, pushEnabled: true } });
  return rows.map((r: any) => ({ tenantId: r.tenantId, lastSyncedAt: r.lastSyncedAt ?? null, syncEnabled: !!r.syncEnabled, pushEnabled: !!r.pushEnabled }));
}

/** Record a SUCCESSFUL sync pass: status ok, clear error, stamp lastSyncedAt. */
export async function markSyncOk(tenantId: string): Promise<void> {
  await (prisma as any).googleConnection.updateMany({
    where: { tenantId },
    data: { syncStatus: "ok", lastSyncError: null, lastSyncedAt: new Date() },
  });
}

/** Record a DEGRADED sync pass: status degraded + reason. Does NOT touch
 *  lastSyncedAt (so "last successful sync" stays truthful) and never deletes data. */
export async function markSyncDegraded(tenantId: string, reason: string): Promise<void> {
  await (prisma as any).googleConnection.updateMany({
    where: { tenantId },
    data: { syncStatus: "degraded", lastSyncError: (reason || "Google unreachable").slice(0, 300) },
  });
}
