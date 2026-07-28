// GLOBAL SEARCH — the query side.
//
// THE CORRECTNESS RULE: search never returns anything the user could not
// already open. Filtering happens at QUERY time, from an allow-list resolved
// once per request — hidden modules, page locks, area rights and CLIENT_USER
// limits all collapse into "which entity types and which record types may this
// person see", which goes into the WHERE clause. Post-query filtering would be
// simpler but leaks through short pages and wastes work.
//
// NO TOTAL COUNT IS EVER RETURNED. A count would tell you how much you can't
// see, which is its own kind of leak.
//
// Learning Center guides are NOT here: they live in the client bundle
// (learn.js), where activeGuides() already resolves the tenant's variant and
// feature-tagging. The panel searches them in the browser and merges the
// results, so a guide the tenant doesn't have can never surface.
import { prisma } from "../db/client";
import { can } from "./permissionService";

const db = prisma as any;

export interface SearchUser {
  id: string;
  role: string;
  tenantId?: string | null;
  customRoleId?: string | null;
}

export interface SearchHit {
  type: "record" | "contact" | "call";
  id: string;
  title: string;
  context: string;      // the secondary caption the row shows
  href: string;         // where clicking it goes
  at: string | null;    // right-aligned meta
  groupKey: string;     // "contact" | "call" | "record:<recordTypeKey>"
  groupLabel: string;   // "Contacts" | "Calls" | the module's own plural label
}

export interface SearchResult {
  query: string;
  groups: Array<{ key: string; label: string; hits: SearchHit[] }>;
  truncated: boolean;   // "there may be more" — never a count
}

export const SEARCH_LIMITS = {
  MIN_QUERY: 2,        // shorter than this returns nothing, not everything
  PER_GROUP: 5,
  TOTAL: 25,
};

/** What this user is allowed to see, resolved once. */
export interface SearchScope {
  entityTypes: string[];          // subset of record|contact|call
  recordTypeIds: string[];        // empty => no record results at all
  labels: Record<string, { key: string; label: string }>;  // recordTypeId -> module
}

export async function resolveSearchScope(tenantId: string, user: SearchUser): Promise<SearchScope> {
  const scope: SearchScope = { entityTypes: [], recordTypeIds: [], labels: {} };
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { labels: true, lockedPages: true } });
  const navHidden: string[] = (((tenant?.labels || {}).nav || {}).hidden || []) as string[];
  const locked: string[] = Array.isArray(tenant?.lockedPages) ? (tenant!.lockedPages as string[]) : [];

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { listRecordTypes, recordTypeHref } = require("./recordTypeService");

  // AREA RIGHTS (this also enforces the tenant's own page locks — can() checks
  // lockedAreasForTenant first, so a locked area is denied for everyone).
  const [mayContacts, mayRecords, mayCalls] = await Promise.all([
    can(user as any, "contacts", "view"),
    can(user as any, "records", "view"),
    can(user as any, "calls", "view"),
  ]);
  if (mayContacts && !locked.includes("#/contacts")) scope.entityTypes.push("contact");
  if (mayCalls && !locked.includes("#/calls")) scope.entityTypes.push("call");

  if (mayRecords) {
    const types = await listRecordTypes(tenantId);
    for (const t of types as any[]) {
      const href = recordTypeHref(t.key);
      // HIDDEN modules are absent portal-wide (batch 38) and LOCKED pages are
      // unreachable — neither may contribute a single result.
      if (navHidden.includes(href) || locked.includes(href)) continue;
      scope.recordTypeIds.push(t.id);
      scope.labels[t.id] = { key: t.key, label: t.labelPlural || t.label || t.key };
    }
    if (scope.recordTypeIds.length) scope.entityTypes.push("record");
  }
  return scope;
}

const TYPE_PRIORITY: Record<string, number> = { record: 0, contact: 1, call: 2 };

/**
 * Search one tenant, as one user.
 * Every input is parameterised; `plainto_tsquery` turns arbitrary text into a
 * safe query, so no input can error or escape. Results are capped per group and
 * in total, so nothing can scan unbounded.
 */
export async function search(input: {
  tenantId: string;
  user: SearchUser;
  q: string;
  perGroup?: number;
  total?: number;
}): Promise<SearchResult> {
  const q = String(input.q || "").trim();
  const perGroup = Math.min(20, Math.max(1, input.perGroup || SEARCH_LIMITS.PER_GROUP));
  const total = Math.min(50, Math.max(1, input.total || SEARCH_LIMITS.TOTAL));
  const empty: SearchResult = { query: q, groups: [], truncated: false };
  if (q.length < SEARCH_LIMITS.MIN_QUERY) return empty;

  const scope = await resolveSearchScope(input.tenantId, input.user);
  if (!scope.entityTypes.length) return empty;

  // Fetch a little more than we'll show, so per-group caps can be applied after
  // ranking without a second round trip.
  const fetchLimit = Math.min(200, total * 4);
  const like = `${q.replace(/[%_\\]/g, "\\$&")}%`;
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT "entityType", "entityId", "recordTypeId", "title", "body", "href", "entityAt",
            ts_rank("tsv", plainto_tsquery('english', $2)) AS rank,
            (lower("title") = lower($3)) AS exact,
            (lower("title") LIKE lower($4)) AS prefix
       FROM "SearchIndex"
      WHERE "tenantId" = $1
        AND "entityType" = ANY($5::text[])
        AND ("recordTypeId" IS NULL OR "recordTypeId" = ANY($6::text[]))
        AND ("tsv" @@ plainto_tsquery('english', $2) OR lower("title") LIKE lower($4))
      ORDER BY exact DESC, prefix DESC, rank DESC, "entityAt" DESC
      LIMIT ${fetchLimit}`,
    input.tenantId, q, q, like, scope.entityTypes, scope.recordTypeIds.length ? scope.recordTypeIds : ["__none__"],
  );

  // Group, cap, and shape for the UI.
  const grouped = new Map<string, { key: string; label: string; hits: SearchHit[] }>();
  let taken = 0;
  let truncated = false;
  for (const r of rows) {
    if (taken >= total) { truncated = true; break; }
    const isRecord = r.entityType === "record";
    const mod = isRecord ? scope.labels[r.recordTypeId] : null;
    const groupKey = isRecord ? `record:${mod ? mod.key : "other"}` : r.entityType;
    const groupLabel = isRecord ? (mod ? mod.label : "Records") : r.entityType === "contact" ? "Contacts" : "Calls";
    let g = grouped.get(groupKey);
    if (!g) { g = { key: groupKey, label: groupLabel, hits: [] }; grouped.set(groupKey, g); }
    if (g.hits.length >= perGroup) { truncated = true; continue; }
    g.hits.push({
      type: r.entityType,
      id: r.entityId,
      title: r.title,
      context: contextLine(r, groupLabel),
      href: r.href,
      at: r.entityAt ? new Date(r.entityAt).toISOString() : null,
      groupKey,
      groupLabel,
    });
    taken += 1;
  }
  if (rows.length >= fetchLimit) truncated = true;

  const groups = Array.from(grouped.values()).sort((a, b) => {
    const pa = TYPE_PRIORITY[a.key.split(":")[0] === "record" ? "record" : a.key] ?? 9;
    const pb = TYPE_PRIORITY[b.key.split(":")[0] === "record" ? "record" : b.key] ?? 9;
    return pa - pb || a.label.localeCompare(b.label);
  });
  return { query: q, groups, truncated };
}

/** The secondary line under a result: enough to tell two similar hits apart. */
function contextLine(row: any, groupLabel: string): string {
  const body = String(row.body || "").replace(/\s+/g, " ").trim();
  if (row.entityType === "call") return body.slice(0, 120);
  if (row.entityType === "contact") return body.slice(0, 120);
  return [groupLabel, body.slice(0, 90)].filter(Boolean).join(" \u00b7 ");
}
