// Developer Tools batch 2 — THE AUDIT CAPTURE SERVICE.
//
// One entry point: audit(evt). The cardinal rule (same philosophy as markGeoSafe's
// geocoding hooks): capture may NEVER fail, slow, or block the action it records —
//   • audit() validates the shape SYNCHRONOUSLY and cheaply, then writes
//     FIRE-AND-FORGET: the promise is never returned to (or awaited on) the caller's
//     critical path;
//   • every failure (validation, DB down, table missing) is swallowed and logged;
//     audit() itself NEVER throws;
//   • diffs are computed from values the choke point ALREADY holds (computeDiff below)
//     — auditing performs no extra reads;
//   • no message bodies, no passwords, no raw keystrokes are ever stored (the catalog
//     + call sites only pass labels, counts, and field-level from/to values).
//
// Testability: _setWriterForTests swaps the writer so the self-test can prove the
// never-block guarantee with a throwing/hanging writer.
import { logger } from "../utils/logger";

// Lazy client: resolved on FIRST write/sweep, never at import — a Prisma init failure
// lands in the swallowed promise chain instead of crashing boot (and tests can swap
// the writer before any DB touch).
let _prisma: any = null;
function db(): any { if (!_prisma) _prisma = require("../db/client").prisma; return _prisma; }
import { AUDIT_ACTION_VALUES, AUDIT_ACTOR_TYPES, AUDIT_RETENTION } from "./auditCatalog";

export interface AuditEventInput {
  tenantId?: string | null;
  actorType: "user" | "system" | "ai" | "automation";
  actorId?: string | null;
  actorLabel: string;
  actorRole?: string | null; // denormalized acting role (audit-fixes batch); null = non-human or unknown
  action: string;
  subjectType: string;
  subjectId?: string | null;
  subjectLabel?: string | null;
  recordTypeKey?: string | null;
  diff?: Record<string, { from: unknown; to: unknown }> | null;
  meta?: Record<string, unknown> | null;
}

type Writer = (data: Record<string, unknown>) => Promise<unknown>;
let writer: Writer = (data) => db().auditEvent.create({ data });
export function _setWriterForTests(w: Writer | null): void { writer = w || ((data) => db().auditEvent.create({ data })); }

function validate(evt: AuditEventInput): string | null {
  if (!evt || typeof evt !== "object") return "no event";
  if (!AUDIT_ACTOR_TYPES.includes(evt.actorType as any)) return `bad actorType ${String(evt.actorType)}`;
  if (typeof evt.actorLabel !== "string" || !evt.actorLabel.trim()) return "actorLabel required (denormalized — the log must survive user deletion)";
  if (typeof evt.action !== "string" || !AUDIT_ACTION_VALUES.includes(evt.action)) return `unknown action "${String(evt.action)}" — add it to auditCatalog first`;
  if (typeof evt.subjectType !== "string" || !evt.subjectType.trim()) return "subjectType required";
  if (evt.diff != null && (typeof evt.diff !== "object" || Array.isArray(evt.diff))) return "diff must be {field:{from,to}}";
  return null;
}

/**
 * Capture an audit event. Synchronous validation; asynchronous fire-and-forget write.
 * NEVER throws; NEVER awaited by callers on their critical path.
 */
export function audit(evt: AuditEventInput): void {
  try {
    const bad = validate(evt);
    if (bad) { logger.error(`[audit] dropped invalid event: ${bad}`); return; }
    const data = {
      tenantId: evt.tenantId ?? null,
      actorType: evt.actorType,
      actorId: evt.actorId ?? null,
      actorLabel: evt.actorLabel,
      actorRole: evt.actorRole ?? null,
      action: evt.action,
      subjectType: evt.subjectType,
      subjectId: evt.subjectId ?? null,
      subjectLabel: evt.subjectLabel ?? null,
      recordTypeKey: evt.recordTypeKey ?? null,
      diff: (evt.diff ?? null) as any,
      meta: (evt.meta ?? null) as any,
      status: "active",
    };
    // Fire-and-forget: kick the write onto its own microtask/promise chain and swallow
    // EVERY failure. Even a writer that throws synchronously cannot reach the caller.
    void Promise.resolve()
      .then(() => writer(data))
      .catch((e) => { logger.error(`[audit] write failed (action ${data.action}): ${(e as Error).message}`); });
  } catch (e) {
    // absolute backstop — audit() never throws, period
    try { logger.error(`[audit] capture error: ${(e as Error).message}`); } catch { /* nothing */ }
  }
}

/**
 * Field-level diff from values the caller ALREADY holds — {field: {from, to}} for
 * changed keys only. No reads, no snapshots. Keys present in `after` are compared
 * against `before` (missing before-value => from: undefined, still recorded).
 * Returns null when nothing changed (callers then log the action without a diff,
 * or skip diffing entirely when they genuinely lack the before-value).
 */
export function computeDiff(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, keys?: string[]): Record<string, { from: unknown; to: unknown }> | null {
  if (!after) return null;
  const b = before || {};
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const ks = keys || Object.keys(after);
  for (const k of ks) {
    if (!(k in after)) continue;
    const from = (b as any)[k];
    const to = (after as any)[k];
    if (JSON.stringify(from) !== JSON.stringify(to)) out[k] = { from, to };
  }
  return Object.keys(out).length ? out : null;
}

// ---------------- retention sweep (the geocode-sweep pattern) ----------------
// active older than ACTIVE_DAYS -> pending_deletion; pending_deletion older than a
// FURTHER PENDING_DAYS -> hard delete. Bounded batches per tick; never throws.
export async function runAuditRetentionSweep(now: Date = new Date()): Promise<{ demoted: number; deleted: number }> {
  const res = { demoted: 0, deleted: 0 };
  try { require("./healthService").markAuditSweep(); } catch { /* health is a bystander */ }
  try {
    const activeCutoff = new Date(now.getTime() - AUDIT_RETENTION.ACTIVE_DAYS * 24 * 60 * 60 * 1000);
    const deleteCutoff = new Date(now.getTime() - (AUDIT_RETENTION.ACTIVE_DAYS + AUDIT_RETENTION.PENDING_DAYS) * 24 * 60 * 60 * 1000);
    const stale = await db().auditEvent.findMany({
      where: { status: "active", createdAt: { lt: activeCutoff } },
      select: { id: true }, take: AUDIT_RETENTION.SWEEP_BATCH_SIZE,
    });
    if (stale.length) {
      const r = await db().auditEvent.updateMany({ where: { id: { in: stale.map((s: any) => s.id) } }, data: { status: "pending_deletion" } });
      res.demoted = r.count || 0;
    }
    const doomed = await db().auditEvent.findMany({
      where: { status: "pending_deletion", createdAt: { lt: deleteCutoff } },
      select: { id: true }, take: AUDIT_RETENTION.SWEEP_BATCH_SIZE,
    });
    if (doomed.length) {
      const r = await db().auditEvent.deleteMany({ where: { id: { in: doomed.map((d: any) => d.id) } } });
      res.deleted = r.count || 0;
    }
  } catch (e) {
    logger.error(`[audit] retention sweep failed (will retry next tick): ${(e as Error).message}`);
  }
  return res;
}
