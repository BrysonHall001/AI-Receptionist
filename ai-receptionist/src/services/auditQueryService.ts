// Developer Tools batch 3 — the Audit Log QUERY service (read-only by design; no
// mutation surface exists anywhere — retention alone removes rows).
//
// Split from the route so the where-building is a PURE, unit-testable function and the
// end-to-end query can be driven without HTTP. The route inherits the admin router's
// requireRole(OWNER, SUPER_ADMIN, AUDITOR) gate + impersonation lockout.
//
// Pagination: cursor over (createdAt desc, id desc) — stable under insertion (new rows
// land ahead of any held cursor; a page walk never skips or duplicates). The default
// view (status=active, latest first) filters on exactly {status, createdAt}, riding
// DT-2's AuditEvent_status_createdAt_idx.
import { AUDIT_RETENTION } from "./auditCatalog";

export const AUDIT_QUERY_MAX_LIMIT = 500; // the sane page-size cap
export const AUDIT_QUERY_DEFAULT_LIMIT = 200;

// Lazy client (the DT-2 convention): never touched at import.
let _prisma: any = null;
function db(): any { if (!_prisma) _prisma = require("../db/client").prisma; return _prisma; }

export function encodeAuditCursor(createdAt: Date | string, id: string): string {
  return Buffer.from(new Date(createdAt).toISOString() + "|" + id, "utf8").toString("base64");
}

/** PURE: query params -> { where, limit }. Status defaults to "active". */
export function buildAuditWhere(q: Record<string, string | undefined>): { where: any; limit: number } {
  const raw = parseInt(q.limit ?? "", 10);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : AUDIT_QUERY_DEFAULT_LIMIT, 1), AUDIT_QUERY_MAX_LIMIT);
  const where: any = {};
  const status = (q.status || "active").toLowerCase();
  if (status !== "all") where.status = status === "pending_deletion" ? "pending_deletion" : "active";
  if (q.tenantId) where.tenantId = q.tenantId;
  if (q.actorType) where.actorType = q.actorType;
  if (q.actorId) where.actorId = q.actorId;
  if (q.subjectType) where.subjectType = q.subjectType;
  if (q.action) {
    if (q.action.endsWith(".*")) where.action = { startsWith: q.action.slice(0, -1) }; // namespace prefix, e.g. record.*
    else if (q.action.endsWith(".")) where.action = { startsWith: q.action };
    else where.action = q.action; // exact
  }
  if (q.actions) where.AND = (where.AND || []).concat([{ OR: String(q.actions).split(",").filter(Boolean).map((p) => ({ action: { startsWith: p } })) }]);
  if (q.from || q.to) {
    where.createdAt = {};
    if (q.from) where.createdAt.gte = new Date(q.from);
    if (q.to) { const t = new Date(q.to); t.setHours(23, 59, 59, 999); where.createdAt.lte = t; }
  }
  if (q.q && q.q.trim()) {
    const needle = q.q.trim();
    where.AND = (where.AND || []).concat([{ OR: [
      { actorLabel: { contains: needle, mode: "insensitive" } },
      { subjectLabel: { contains: needle, mode: "insensitive" } },
      { action: { contains: needle, mode: "insensitive" } },
    ] }]);
  }
  if (q.cursor) {
    try {
      const [iso, id] = Buffer.from(q.cursor, "base64").toString("utf8").split("|");
      const at = new Date(iso);
      where.AND = (where.AND || []).concat([{ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] }]);
    } catch { /* a bad cursor just means page 1 */ }
  }
  return { where, limit };
}

export async function queryAuditEvents(q: Record<string, string | undefined>): Promise<{ events: any[]; nextCursor: string | null }> {
  const { where, limit } = buildAuditWhere(q);
  const events = await db().auditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeAuditCursor(last.createdAt, last.id) : null;
  return { events: page, nextCursor };
}

// Re-exported so viewer copy interpolates the ONE config (never a hardcoded number).
export { AUDIT_RETENTION };
