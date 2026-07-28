// TABLE LAYOUT PERSISTENCE — the per-user store.
//
// ONE mechanism for every table in the product: the hub's tenant list (table
// and panels views) and every tenant portal's module list read and write the
// same blob, keyed by a stable table key. Nothing here knows about renderers,
// so the hub's column manager and the portal's own manager can both use it
// without either being rewritten.
//
// SHAPE:  User.tableLayouts = { "<tableKey>": { order[], hidden[], sortKey, sortDir, at } }
//
// This generalises the older per-user Contacts blob (User.contactColumns,
// userService.ts). That column is NOT dropped: an existing Contacts layout is
// CARRIED OVER the first time its table key is read, so nobody loses an
// arrangement they already made.
//
// The sanitize-and-store discipline is the batch-30 notification-preferences
// pattern: one writer, unknown keys dropped on the way in AND on the way out,
// so a layout can never be persisted (or served) in a broken state.
import { prisma } from "../db/client";

const db = prisma as any;

/** Column keys and table keys are both constrained — a layout is user data. */
const COL_KEY_RE = /^[a-zA-Z0-9_.:-]{1,64}$/;
const TABLE_KEY_RE = /^[a-zA-Z0-9_.:-]{1,120}$/;

export const LAYOUT_CAPS = {
  /** columns per entry (matches the existing contactColumns cap) */
  COLUMNS: 100,
  /** tables per user; the least recently written is pruned beyond this */
  TABLES: 200,
};

export interface TableLayout {
  order: string[];
  hidden: string[];
  sortKey: string | null;
  sortDir: "asc" | "desc" | null;
  /** last write, ms — used only for LRU pruning */
  at?: number;
}

export const EMPTY_LAYOUT: TableLayout = { order: [], hidden: [], sortKey: null, sortDir: null };

export function isValidTableKey(key: unknown): boolean {
  return typeof key === "string" && TABLE_KEY_RE.test(key);
}

/** Drop everything unrecognised. Never throws — a corrupt blob becomes empty. */
export function sanitizeLayout(input: any): TableLayout {
  const o = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const keys = (arr: any) =>
    (Array.isArray(arr) ? arr : [])
      .filter((k) => typeof k === "string" && COL_KEY_RE.test(k))
      .slice(0, LAYOUT_CAPS.COLUMNS);
  const dir = o.sortDir === "asc" || o.sortDir === "desc" ? o.sortDir : null;
  const sortKey = typeof o.sortKey === "string" && COL_KEY_RE.test(o.sortKey) ? o.sortKey : null;
  return {
    order: keys(o.order),
    hidden: keys(o.hidden),
    sortKey,
    sortDir: sortKey ? dir : null,   // a direction without a key is meaningless
    ...(typeof o.at === "number" ? { at: o.at } : {}),
  };
}

function sanitizeAll(input: any): Record<string, TableLayout> {
  const o = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out: Record<string, TableLayout> = {};
  for (const k of Object.keys(o)) {
    if (!isValidTableKey(k)) continue;
    const l = sanitizeLayout(o[k]);
    if (!l.order.length && !l.hidden.length && !l.sortKey) continue;   // nothing worth storing
    out[k] = l;
  }
  return out;
}

/** Keep the blob bounded: the least recently written entries go first. */
function prune(all: Record<string, TableLayout>): Record<string, TableLayout> {
  const keys = Object.keys(all);
  if (keys.length <= LAYOUT_CAPS.TABLES) return all;
  const ordered = keys.sort((a, b) => (all[b].at || 0) - (all[a].at || 0)).slice(0, LAYOUT_CAPS.TABLES);
  const out: Record<string, TableLayout> = {};
  for (const k of ordered) out[k] = all[k];
  return out;
}

/** The Contacts carry-over: the older blob, expressed in the new shape. */
function contactsCarryOver(user: any, tenantId?: string | null): { key: string; layout: TableLayout } | null {
  const legacy = user && (user as any).contactColumns;
  const l = sanitizeLayout(legacy);
  if (!l.order.length && !l.hidden.length) return null;
  const tid = tenantId || user?.tenantId;
  if (!tid) return null;
  return { key: `portal:${tid}:contacts`, layout: l };
}

/**
 * Every layout this user has, sanitized. Includes the one-time Contacts
 * carry-over when the user has an old Contacts arrangement and no new-style
 * entry for it yet — read-through, so nothing is lost and nothing is migrated
 * until they touch it.
 */
export async function getTableLayouts(userId: string): Promise<Record<string, TableLayout>> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { tableLayouts: true, contactColumns: true, tenantId: true } });
  const all = sanitizeAll(user ? user.tableLayouts : null);
  const carry = contactsCarryOver(user);
  if (carry && !all[carry.key]) all[carry.key] = carry.layout;
  return all;
}

export async function getTableLayout(userId: string, tableKey: string): Promise<TableLayout> {
  if (!isValidTableKey(tableKey)) return { ...EMPTY_LAYOUT };
  const all = await getTableLayouts(userId);
  return all[tableKey] || { ...EMPTY_LAYOUT };
}

/** THE single writer. Returns the stored layout. */
export async function setTableLayout(userId: string, tableKey: string, layout: unknown): Promise<TableLayout> {
  if (!isValidTableKey(tableKey)) throw new Error("Invalid table key.");
  const clean = sanitizeLayout(layout);
  clean.at = Date.now();
  const user = await db.user.findUnique({ where: { id: userId }, select: { tableLayouts: true } });
  const all = sanitizeAll(user ? user.tableLayouts : null);
  all[tableKey] = clean;
  await db.user.update({ where: { id: userId }, data: { tableLayouts: prune(all) as any } });
  return clean;
}

/** RESET: forget this table's layout entirely (defaults return immediately). */
export async function clearTableLayout(userId: string, tableKey: string): Promise<{ ok: true }> {
  if (!isValidTableKey(tableKey)) throw new Error("Invalid table key.");
  const user = await db.user.findUnique({ where: { id: userId }, select: { tableLayouts: true, contactColumns: true, tenantId: true } });
  const all = sanitizeAll(user ? user.tableLayouts : null);
  delete all[tableKey];
  const data: any = { tableLayouts: all };
  // If the reset targets Contacts, clear the LEGACY blob too — otherwise the
  // carry-over would resurrect the layout the user just reset.
  const carry = contactsCarryOver(user);
  if (carry && carry.key === tableKey) data.contactColumns = { order: [], hidden: [] };
  await db.user.update({ where: { id: userId }, data });
  return { ok: true };
}
