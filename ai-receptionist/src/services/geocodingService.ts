// Geocoding foundation for the upcoming Map view. No UI here — this keeps a per-(record,
// address-field) cache of lat/lng (the RecordGeo table), detects address changes via a hash,
// and fills coordinates in with a background sweep that calls the Mapbox Geocoding API.
//
// Design mirrors applyComputedTotal: a derive-on-write hook (markRecordGeoStale) that runs on
// every save and no-ops when the module has no address field. Everything is OPTIONAL and
// NON-BLOCKING: with no MAPBOX_TOKEN configured (geocodingEnabled() === false) the hook still
// marks rows "pending" but the sweep does nothing, so record saves behave exactly as today.
import crypto from "crypto";
import { prisma } from "../db/client";
import { env, geocodingEnabled } from "../config/env";
import { logger } from "../utils/logger";

const db = prisma as any;

// ---------------------------------------------------------------------------
// Address normalization + hashing (change detection)
// ---------------------------------------------------------------------------

/** Canonical single-line address string. Reuses the SAME component join as fmtAddress
 *  (public/js/fields.js): street, city, state, postal, country → trimmed, non-empty, ", "-joined.
 *  Then lower-cased with collapsed whitespace so trivial case/spacing edits don't force a
 *  needless re-geocode. A plain string value is normalized as-is. Empty → "". */
export function normalizeAddress(value: any): string {
  if (value == null) return "";
  let joined: string;
  if (typeof value === "string") {
    joined = value;
  } else if (typeof value === "object") {
    joined = [value.street, value.city, value.state, value.postal, value.country]
      .map((x) => (x == null ? "" : String(x)).trim())
      .filter(Boolean)
      .join(", ");
  } else {
    joined = String(value);
  }
  return joined.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Stable hash of a normalized address string, for change detection. */
export function hashAddress(str: string): string {
  return crypto.createHash("sha1").update(str || "").digest("hex");
}

// ---------------------------------------------------------------------------
// On-save hook: mark RecordGeo rows stale (runs on every write; no-op when N/A)
// ---------------------------------------------------------------------------

type FieldDefLike = { key: string; type: string };

/** For each address-type field on the record's type, keep its RecordGeo row in sync with the
 *  CURRENT address WITHOUT geocoding here (the sweep does that). Rules:
 *   - empty address  → upsert status "empty", null coords.
 *   - hash changed / no row → upsert status "pending", new hash, null coords (needs geocoding).
 *   - hash unchanged → leave the row untouched (cache hit; never re-geocode).
 *  No address fields → no rows created (no-op, like applyComputedTotal). Never throws into the
 *  save path — callers wrap it, but it's also internally defensive per field.
 *  `record` is the freshly written row: { id, recordTypeId, customFields }. */
export async function markRecordGeoStale(
  tenantId: string,
  record: { id: string; recordTypeId: string; customFields?: any },
  fieldDefs: FieldDefLike[],
): Promise<void> {
  const addressFields = (fieldDefs || []).filter((f) => f && f.type === "address");
  if (!addressFields.length) return; // no-op for modules without an address field

  const cf = (record && record.customFields) || {};
  for (const f of addressFields) {
    try {
      const normalized = normalizeAddress(cf[f.key]);
      const isEmpty = normalized === "";
      const hash = hashAddress(normalized);
      const existing = await db.recordGeo.findUnique({
        where: { tenantId_recordId_fieldKey: { tenantId, recordId: record.id, fieldKey: f.key } },
      });

      if (isEmpty) {
        // Blank address → mark empty (clear any stale coords). Skip a redundant write if
        // it's already empty with the same (empty) hash.
        if (existing && existing.status === "empty" && existing.addressHash === hash) continue;
        await upsertGeo(tenantId, record, f.key, { addressHash: hash, status: "empty", lat: null, lng: null, lastError: null, geocodedAt: null });
        continue;
      }

      // Unchanged address that's already resolved/queued → cache hit, leave it alone.
      if (existing && existing.addressHash === hash && existing.status !== "empty") continue;

      // New or changed address → queue for (re)geocoding.
      await upsertGeo(tenantId, record, f.key, { addressHash: hash, status: "pending", lat: null, lng: null, lastError: null, geocodedAt: null });
    } catch (e) {
      // Per-field defensive: one bad field never blocks the others or the save.
      logger.error(`[geocode] markRecordGeoStale failed for ${record.id}/${f.key}: ${(e as Error).message}`);
    }
  }
}

async function upsertGeo(
  tenantId: string,
  record: { id: string; recordTypeId: string },
  fieldKey: string,
  patch: { addressHash: string; status: string; lat: number | null; lng: number | null; lastError: string | null; geocodedAt: Date | null },
): Promise<void> {
  await db.recordGeo.upsert({
    where: { tenantId_recordId_fieldKey: { tenantId, recordId: record.id, fieldKey } },
    create: { tenantId, recordId: record.id, recordTypeId: record.recordTypeId, fieldKey, ...patch },
    update: { ...patch },
  });
}

// ---------------------------------------------------------------------------
// Mapbox forward geocoding (one address) — HTTP isolated behind an injectable fn
// ---------------------------------------------------------------------------

export type GeoResult = { lat: number; lng: number } | null;
export type GeocoderFn = (addressStr: string) => Promise<GeoResult>;

/** The real Mapbox forward-geocoding call (v5 Geocoding API). limit=1, and permanent=true so
 *  the result may be STORED per Mapbox's terms (we cache it). Mapbox returns center coordinates
 *  as [longitude, latitude] — we read them in that order (do NOT swap). Returns null when the
 *  token is missing/placeholder, on any non-OK response, or when there are no features. */
export const mapboxGeocoder: GeocoderFn = async (addressStr: string): Promise<GeoResult> => {
  const token = env.MAPBOX_TOKEN;
  if (!token || !addressStr) return null;
  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    encodeURIComponent(addressStr) +
    ".json?limit=1&permanent=true&access_token=" +
    encodeURIComponent(token);
  try {
    const resp = await fetch(url);
    if (!resp.ok) { logger.error(`[geocode] Mapbox HTTP ${resp.status} for "${addressStr}"`); return null; }
    const data: any = await resp.json();
    const feat = data && Array.isArray(data.features) ? data.features[0] : null;
    const center = feat && Array.isArray(feat.center) ? feat.center : null;
    if (!center || center.length < 2) return null;
    const lng = Number(center[0]); // Mapbox order: [lng, lat]
    const lat = Number(center[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (e) {
    logger.error(`[geocode] Mapbox request failed for "${addressStr}": ${(e as Error).message}`);
    return null;
  }
};

/** Geocode ONE address string. The HTTP call is injectable so tests pass a stub (no network/
 *  token needed). Returns {lat,lng} or null. */
export async function geocodeAddress(addressStr: string, geocoderFn: GeocoderFn = defaultGeocoder): Promise<GeoResult> {
  if (!addressStr) return null;
  return geocoderFn(addressStr);
}

// The geocoder used when callers don't pass one explicitly (the post-save trigger and the
// periodic sweep). Overridable via setDefaultGeocoder — a small DI seam so self-tests can run
// the REAL trigger/sweep code paths against a stub, with no network and no token.
let defaultGeocoder: GeocoderFn = mapboxGeocoder;
export function setDefaultGeocoder(fn?: GeocoderFn | null): void { defaultGeocoder = fn || mapboxGeocoder; }

// ---------------------------------------------------------------------------
// Post-save trigger: a debounced, coalesced, fire-and-forget sweep
// ---------------------------------------------------------------------------
// Called (best-effort) right after a save marks rows pending, so pins appear promptly instead
// of waiting for the next heartbeat tick. Guarantees:
//  - NEVER blocks or affects the save: no await in the caller, everything caught internally.
//  - Debounced + coalesced: a burst of saves collapses into ONE queued run; at most one sweep
//    runs at a time ("one run queued at a time"); a request landing mid-run flags ONE re-run.
//  - No-ops instantly when geocodingEnabled() is false (same gate as geocodePending).
// The 2-minute heartbeat sweep (processDueJobs -> geocodePending) remains the catch-all.
let sweepDebounceTimer: any = null;
let sweepRunning = false;
let sweepRerun = false;

export function scheduleGeocodeSweep(debounceMs = 400): void {
  if (!geocodingEnabled()) return; // inert without a token — rows just stay pending
  if (sweepRunning) { sweepRerun = true; return; } // a run is active — queue exactly one re-run
  if (sweepDebounceTimer) return;                  // already queued — coalesce the burst
  sweepDebounceTimer = setTimeout(() => {
    sweepDebounceTimer = null;
    void runTriggeredSweep();
  }, Math.max(0, debounceMs));
  if (sweepDebounceTimer && typeof sweepDebounceTimer.unref === "function") sweepDebounceTimer.unref();
}

async function runTriggeredSweep(): Promise<void> {
  if (sweepRunning) { sweepRerun = true; return; }
  sweepRunning = true;
  try {
    // Drain in bounded passes so a large backlog still clears without an unbounded loop.
    for (let pass = 0; pass < 40; pass++) {
      const r = await geocodePending({ limit: 25 }, defaultGeocoder);
      if (r.skipped || r.processed === 0) break;
    }
  } catch (e) {
    logger.error(`[geocode] triggered sweep failed: ${(e as Error).message}`);
  } finally {
    sweepRunning = false;
    if (sweepRerun) { sweepRerun = false; scheduleGeocodeSweep(50); } // rows arrived mid-run — one follow-up
  }
}

/** Test helper: resolves true once no sweep is queued or running (polls; false on timeout).
 *  Lets self-tests await the fire-and-forget trigger without exposing internals. */
export async function geocodeSweepSettled(timeoutMs = 10000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!sweepDebounceTimer && !sweepRunning && !sweepRerun) return true;
    await sleep(25);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Background sweep: resolve pending rows (gently, in bounded batches)
// ---------------------------------------------------------------------------

export interface GeocodeSweepOpts {
  tenantId?: string; // scope to one CRM (default: all)
  limit?: number;    // max rows this pass (default 25)
  delayMs?: number;  // pause between provider calls (default 200ms) — rate-limit courtesy
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The sweep. When geocoding is disabled (no token) it returns immediately and NEVER invokes the
 *  geocoder — rows just stay "pending". Otherwise it takes a bounded batch of pending rows and,
 *  for each, resolves the CURRENT record address (re-normalized from the live record so a row
 *  queued for a since-changed address geocodes the latest text), then writes ok+coords or
 *  failed+lastError. Processes gently with a short delay between calls. Returns a small summary. */
export async function geocodePending(
  opts: GeocodeSweepOpts = {},
  geocoderFn: GeocoderFn = defaultGeocoder,
): Promise<{ processed: number; ok: number; failed: number; skipped: boolean }> {
  if (!geocodingEnabled()) return { processed: 0, ok: 0, failed: 0, skipped: true }; // inert without a token

  const limit = Math.max(1, Math.min(500, opts.limit ?? 25));
  const delayMs = Math.max(0, opts.delayMs ?? 200);
  const where: any = { status: "pending" };
  if (opts.tenantId) where.tenantId = opts.tenantId;

  const rows = await db.recordGeo.findMany({ where, orderBy: { updatedAt: "asc" }, take: limit });
  let ok = 0, failed = 0, processed = 0;

  for (const row of rows) {
    processed++;
    try {
      // Resolve from the record's CURRENT address (its customFields may have moved on since the
      // row was queued). If the record or field vanished/emptied, mark empty and move on.
      const rec = await db.record.findFirst({ where: { id: row.recordId, tenantId: row.tenantId, deletedAt: null } });
      const addressStr = rec ? normalizeAddress((rec.customFields || {})[row.fieldKey]) : "";
      if (!addressStr) {
        await db.recordGeo.update({ where: { id: row.id }, data: { status: "empty", lat: null, lng: null, addressHash: hashAddress(""), lastError: null, geocodedAt: null } });
        continue;
      }
      const res = await geocodeAddress(addressStr, geocoderFn);
      if (res) {
        await db.recordGeo.update({ where: { id: row.id }, data: { status: "ok", lat: res.lat, lng: res.lng, addressHash: hashAddress(addressStr), lastError: null, geocodedAt: new Date() } });
        ok++;
      } else {
        await db.recordGeo.update({ where: { id: row.id }, data: { status: "failed", lastError: "No geocoding result", geocodedAt: new Date() } });
        failed++;
      }
    } catch (e) {
      failed++;
      try { await db.recordGeo.update({ where: { id: row.id }, data: { status: "failed", lastError: String((e as Error).message).slice(0, 500), geocodedAt: new Date() } }); }
      catch (e2) { logger.error(`[geocode] could not mark row ${row.id} failed: ${(e2 as Error).message}`); }
    }
    if (delayMs && processed < rows.length) await sleep(delayMs);
  }

  if (processed) logger.info(`[geocode] sweep (scope=${opts.tenantId || "all"}): processed ${processed}, ok ${ok}, failed ${failed}`);
  return { processed, ok, failed, skipped: false };
}
