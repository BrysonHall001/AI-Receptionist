// devtools-data — error capture (client + server), retention, and the client
// endpoint's rate limiting. Discipline matches the audit foundation: NOTHING here
// may ever block or throw into a caller — capture is fire-and-forget, the limiter
// is in-memory, and the prune runs in bounded batches on the hourly sweep.
import { logger } from "../utils/logger";

let _prisma: any = null;
function db(): any { if (!_prisma) _prisma = require("../db/client").prisma; return _prisma; }

// ---------------- named constants ----------------
export const ERROR_RETENTION_DAYS = 14;      // hard-prune horizon
export const ERROR_PRUNE_BATCH = 500;        // bounded delete batches
export const ERROR_PRUNE_MAX_BATCHES = 14;   // per sweep pass
export const ERROR_STACK_MAX = 4096;         // ~4KB stack truncation
export const ERROR_MESSAGE_MAX = 1000;
export const ERROR_META_MAX = 2048;          // serialized meta cap (no bodies/secrets belong here anyway)
export const CLIENT_ERROR_LIMIT_PER_MIN = 10; // per-IP hard rate limit on the report endpoint
export const CLIENT_ERROR_WINDOW_MS = 60_000;

export interface ErrorEventInput {
  source: "client" | "server";
  tenantId?: string | null;
  userId?: string | null;
  userLabel?: string | null;
  message: string;
  stack?: string | null;
  route?: string | null;
  userAgent?: string | null;
  meta?: unknown;
}

// meta survives only if it serializes small; oversized/broken meta becomes a stub
// (a nicety — never a reason to drop the error itself).
function sanitizeMeta(m: unknown): any {
  if (m === undefined || m === null) return null;
  try {
    const s = JSON.stringify(m);
    if (typeof s !== "string") return null;
    if (s.length > ERROR_META_MAX) return { note: "meta omitted (exceeded " + ERROR_META_MAX + " bytes)" };
    return JSON.parse(s);
  } catch { return null; }
}

const trunc = (s: unknown, n: number): string | null => {
  if (s === undefined || s === null) return null;
  const t = String(s);
  return t.length > n ? t.slice(0, n) + "\u2026[truncated]" : t;
};

// A writer seam (the auditService pattern) so tests can capture without a DB.
type Writer = (data: any) => Promise<unknown>;
let writer: Writer | null = null;
export function _setErrorWriterForTests(w: Writer | null): void { writer = w; }

/** Fire-and-forget capture. NEVER throws, NEVER blocks the caller. */
export function captureError(evt: ErrorEventInput): void {
  try {
    const data = {
      source: evt.source === "client" ? "client" : "server",
      tenantId: evt.tenantId ?? null,
      userId: evt.userId ?? null,
      userLabel: trunc(evt.userLabel, 200),
      message: trunc(evt.message, ERROR_MESSAGE_MAX) || "(no message)",
      stack: trunc(evt.stack, ERROR_STACK_MAX),
      route: trunc(evt.route, 300),
      userAgent: trunc(evt.userAgent, 300),
      meta: sanitizeMeta(evt.meta),
    };
    void Promise.resolve()
      .then(() => (writer ? writer(data) : db().errorEvent.create({ data })))
      .catch((e: unknown) => logger.warn(`[errors] capture dropped (never blocks): ${(e as Error).message}`));
  } catch (e) {
    try { logger.warn(`[errors] capture dropped (sync): ${(e as Error).message}`); } catch { /* silent by contract */ }
  }
}

// ---------------- client-endpoint rate limiter (in-memory, per IP) ----------------
const buckets = new Map<string, { count: number; resetAt: number }>();
export function clientErrorAllowed(ip: string, now: number = Date.now()): boolean {
  const b = buckets.get(ip);
  if (!b || now >= b.resetAt) { buckets.set(ip, { count: 1, resetAt: now + CLIENT_ERROR_WINDOW_MS }); return true; }
  if (b.count >= CLIENT_ERROR_LIMIT_PER_MIN) return false;
  b.count++;
  return true;
}
// keep the map bounded (stale buckets evaporate)
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k); }, 5 * 60_000).unref();

// ---------------- retention (hourly sweep; bounded batches) ----------------
export async function runErrorPruneSweep(now: Date = new Date()): Promise<{ deleted: number }> {
  const res = { deleted: 0 };
  try {
    const cutoff = new Date(now.getTime() - ERROR_RETENTION_DAYS * 24 * 60 * 60_000);
    for (let i = 0; i < ERROR_PRUNE_MAX_BATCHES; i++) {
      const batch = await db().errorEvent.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: ERROR_PRUNE_BATCH });
      if (!batch.length) break;
      await db().errorEvent.deleteMany({ where: { id: { in: batch.map((b: any) => b.id) } } });
      res.deleted += batch.length;
      if (batch.length < ERROR_PRUNE_BATCH) break;
    }
  } catch (e) {
    logger.warn(`[errors] prune sweep skipped: ${(e as Error).message}`);
  }
  return res;
}
