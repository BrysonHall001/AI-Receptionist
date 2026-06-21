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
    return { connected: false, accountEmail: null, status: null, scope: null, mappings };
  }
  const connected = row.status === "connected" && !!row.refreshTokenEnc;
  return {
    connected,
    accountEmail: row.accountEmail ?? null,
    status: (row.status as GoogleConnectionStatusValue) ?? "error",
    scope: row.scope ?? null,
    mappings,
  };
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
