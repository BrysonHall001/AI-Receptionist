// File Storage batch: the migration sweep — moves pre-batch embedded base64
// file values (Record.customFields + Contact.customFields, the approved scope)
// into object storage, swapping each value for a "clarityfile:<id>" reference.
//
// Mechanics per the approved Table (f):
//   WHEN      only while storageMode() !== "off"; called from the existing
//             2-minute scheduler heartbeat — never boot-blocking.
//   BATCHED   up to SWEEP_BATCH rows per tick per table, cursored by id.
//   RESUMABLE cursor + counters live in AppSetting; restart-safe, re-entrant.
//   VERIFIED  per file: decode -> put -> read back -> sha256 compare -> ONLY
//             then is the reference swapped in. The swap is one row UPDATE, so
//             swap + removal of the embedded blob are atomic by construction.
//   POSTURE   a file that fails stays exactly as-is (its uploaded object and
//             StoredFile row are best-effort cleaned), is counted, and is
//             retried when the cursor wraps. The app never breaks a file it
//             couldn't move.
//   IDEMPOTENT values already in reference form don't match the data-URL test,
//             so a re-run is a structural no-op.

import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { getAppSetting, setAppSetting } from "./appSettingService";
import { storage, storageMode, sha256Hex, storageKeyFor, makeFileRef, isDataUrl } from "./fileStorage";

const db = prisma as any;

export const SWEEP_BATCH = 25;
const CURSOR_KEY = (table: string) => `fileSweep:cursor:${table}`;
const STATS_KEY = "fileSweep:stats";

export interface FileSweepStats { migrated: number; failed: number; lastRunAt: string | null; passes: number; }

export async function getFileSweepStats(): Promise<FileSweepStats> {
  const raw = await getAppSetting(STATS_KEY);
  let s: any = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch { s = {}; }
  return { migrated: Number(s.migrated) || 0, failed: Number(s.failed) || 0, lastRunAt: s.lastRunAt || null, passes: Number(s.passes) || 0 };
}

/** Parse a data URL into bytes + mime. Returns null for anything malformed —
 *  malformed values are left untouched (failure posture), never guessed at. */
export function parseDataUrl(v: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(v);
  if (!m) return null;
  const mime = (m[1] || "application/octet-stream").trim();
  try {
    const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
    if (!bytes.length) return null;
    return { mime, bytes };
  } catch {
    return null;
  }
}

/** Migrate ONE embedded value. Returns the replacement value, or null on any
 *  failure (caller leaves the original untouched). */
async function migrateValue(tenantId: string, raw: any, nameHint: string): Promise<any | null> {
  const asString = typeof raw === "string" ? raw : null;
  const asObj = raw && typeof raw === "object" && isDataUrl(raw.data) ? raw : null;
  const dataUrl: string | null = asString && isDataUrl(asString) ? asString : asObj ? String(asObj.data) : null;
  if (!dataUrl) return null;
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;

  const name = (asObj && asObj.name ? String(asObj.name) : nameHint).slice(0, 300);
  const hash = sha256Hex(parsed.bytes);
  const row = await db.storedFile.create({
    data: { tenantId, key: "pending", name, mime: parsed.mime, size: parsed.bytes.length, sha256: hash, origin: "sweep" },
  });
  const key = storageKeyFor(tenantId, row.id);
  try {
    await storage().put(key, parsed.bytes, parsed.mime);
    // Checksum verification: read our own write back before touching the DB value.
    const back = await storage().get(key);
    if (!back || sha256Hex(back) !== hash) throw new Error("checksum mismatch after write");
    await db.storedFile.update({ where: { id: row.id }, data: { key } });
  } catch (e) {
    // Failure posture: clean up our half-made artifacts, leave the original alone.
    try { await storage().delete(key); } catch { /* best effort */ }
    try { await db.storedFile.delete({ where: { id: row.id } }); } catch { /* best effort */ }
    logger.warn(`[fileSweep] file failed to migrate (left embedded): ${(e as Error).message}`);
    return null;
  }
  return asObj ? { ...asObj, name, data: undefined, ref: makeFileRef(row.id) } : makeFileRef(row.id);
}

/** One batched pass over one table. Returns rows examined. */
async function sweepTable(table: "record" | "contact"): Promise<{ examined: number; migrated: number; failed: number }> {
  const cursor = String((await getAppSetting(CURSOR_KEY(table))) || "");
  const rows = await db[table].findMany({
    where: { ...(cursor ? { id: { gt: cursor } } : {}), deletedAt: null },
    orderBy: { id: "asc" },
    take: SWEEP_BATCH,
    select: { id: true, tenantId: true, customFields: true },
  });
  if (!rows.length) {
    // End of the table: wrap the cursor so failed stragglers get retried on the
    // next full pass (idempotent — clean rows no-op instantly).
    await setAppSetting(CURSOR_KEY(table), "");
    return { examined: 0, migrated: 0, failed: 0 };
  }
  let migrated = 0;
  let failed = 0;
  for (const r of rows) {
    const cf = r.customFields && typeof r.customFields === "object" ? { ...(r.customFields as any) } : null;
    if (cf) {
      let changed = false;
      for (const k of Object.keys(cf)) {
        const v = cf[k];
        const isEmbedded = isDataUrl(v) || (v && typeof v === "object" && isDataUrl((v as any).data));
        if (!isEmbedded) continue;
        const replacement = await migrateValue(r.tenantId, v, k);
        if (replacement == null) { failed++; continue; }
        if (replacement && typeof replacement === "object" && "data" in replacement) delete (replacement as any).data;
        cf[k] = replacement;
        changed = true;
        migrated++;
      }
      if (changed) {
        // The atomic swap: one row UPDATE replaces every verified value at once;
        // the embedded originals cease to exist in the same statement their
        // references appear. Unverified values were left in place above.
        await db[table].update({ where: { id: r.id }, data: { customFields: cf } });
      }
    }
    await setAppSetting(CURSOR_KEY(table), r.id);
  }
  return { examined: rows.length, migrated, failed };
}

let sweeping = false;
/** The heartbeat entry point. Safe to call every tick; overlaps are skipped. */
export async function runFileMigrationSweep(): Promise<{ examined: number; migrated: number; failed: number } | null> {
  if (storageMode() === "off") return null; // the do-nothing path
  if (sweeping) return null;
  sweeping = true;
  try {
    const a = await sweepTable("record");
    const b = await sweepTable("contact");
    const out = { examined: a.examined + b.examined, migrated: a.migrated + b.migrated, failed: a.failed + b.failed };
    const stats = await getFileSweepStats();
    await setAppSetting(STATS_KEY, JSON.stringify({
      migrated: stats.migrated + out.migrated,
      failed: stats.failed + out.failed, // running count of failed ATTEMPTS (stragglers retry each pass)
      lastRunAt: new Date().toISOString(),
      passes: stats.passes + 1,
    }));
    if (out.migrated || out.failed) logger.info(`[fileSweep] examined ${out.examined}, migrated ${out.migrated}, failed ${out.failed}`);
    return out;
  } finally {
    sweeping = false;
  }
}
