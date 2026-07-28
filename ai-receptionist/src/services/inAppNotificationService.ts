// EMERGENT LAYER 1 — IN-APP NOTIFICATIONS (the delivery surface).
// (Named inAppNotificationService to keep it distinct from the long-standing
// notificationService, which sends EMAIL.)
//
// THE FOUR COMMITMENTS, enforced here:
//   * PER-USER read state — one row per recipient; readAt lives on that row, so
//     a user marking something read can never touch a colleague's copy.
//   * NEVER-BLOCK EMISSION — producers call notifyNever(), which defers with
//     setImmediate and swallows every error: the exact discipline the event bus
//     uses to dispatch subscribers after emitEvent has already returned
//     (events/bus.ts dispatch()). A notification failure can never break or
//     delay the operation that triggered it.
//   * TOAST SCARCITY — urgency is a property of the CATEGORY table below, not
//     of a call site, so nothing can decide to be louder than it should be.
//   * NO SENSITIVE PAYLOADS — titles/bodies are short and generic; the LINK
//     carries the user to the real record, where real permissions apply.
//
// PERMISSION MODEL: rows carry requiredArea/requiredRight (the permission
// vocabulary) and the feed filters at READ time — so a role change
// retroactively does the right thing, and an item whose target the user cannot
// open is filtered from their feed entirely (never shown-then-denied).
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { can, Right } from "./permissionService";

const db = prisma as any;

export type Urgency = "toast" | "badge";

export interface CategoryDef {
  key: string;
  label: string;
  description: string;
  urgency: Urgency;              // toast+badge, or badge-only
  defaultOn: boolean;
  requiredArea: string | null;   // null = everyone in the tenant may see it
  requiredRight: Right;
}

/** The initial category set (R1-approved). */
export const NOTIFICATION_CATEGORIES: CategoryDef[] = [
  { key: "lead_captured", label: "New lead captured", description: "Someone filled in a lead-capture form, or the receptionist captured a caller.", urgency: "toast", defaultOn: true, requiredArea: "contacts", requiredRight: "view" },
  { key: "booking_created", label: "Booking made", description: "A new booking was added — by you, your team, or the receptionist.", urgency: "badge", defaultOn: true, requiredArea: "records", requiredRight: "view" },
  { key: "booking_cancelled", label: "Booking cancelled", description: "A booking moved to cancelled or no-show.", urgency: "toast", defaultOn: true, requiredArea: "records", requiredRight: "view" },
  { key: "automation_failed", label: "Automation problem", description: "An automation ran but one of its actions failed.", urgency: "toast", defaultOn: true, requiredArea: "automations", requiredRight: "edit" },
  { key: "import_complete", label: "Import finished", description: "A contact import finished processing.", urgency: "badge", defaultOn: true, requiredArea: "contacts", requiredRight: "edit" },
  { key: "feedback_reply", label: "Reply on your feedback", description: "Someone replied to feedback you submitted.", urgency: "badge", defaultOn: true, requiredArea: null, requiredRight: "view" },
  { key: "call_missed_or_failed", label: "Missed or failed call", description: "A call came in that nobody answered, or a call failed.", urgency: "toast", defaultOn: true, requiredArea: "calls", requiredRight: "view" },
];

const CATEGORY_BY_KEY = new Map<string, CategoryDef>(NOTIFICATION_CATEGORIES.map((c) => [c.key, c]));
export function getCategory(key: string): CategoryDef | null { return CATEGORY_BY_KEY.get(String(key)) || null; }

/** Retention: read items live 90 days, unread 180 — an unread item is still an
 *  unanswered question, so it earns the longer life. */
export const NOTIFICATION_RETENTION = { READ_DAYS: 90, UNREAD_DAYS: 180, SWEEP_BATCH_SIZE: 500 };

// ---------------------------------------------------------------- preferences
export interface CategoryPref { on: boolean; toast: boolean }

/** Category defaults overlaid with the user's stored choices. Unknown/stale
 *  keys are ignored, and a badge-only category can never be toasted whatever is
 *  stored (toast scarcity is enforced here, not at the call site). */
export function effectivePrefs(stored: any): Record<string, CategoryPref> {
  const raw = stored && typeof stored === "object" ? stored : {};
  const out: Record<string, CategoryPref> = {};
  for (const c of NOTIFICATION_CATEGORIES) {
    const s = raw[c.key] && typeof raw[c.key] === "object" ? raw[c.key] : {};
    out[c.key] = {
      on: typeof s.on === "boolean" ? s.on : c.defaultOn,
      toast: c.urgency === "toast" ? (typeof s.toast === "boolean" ? s.toast : true) : false,
    };
  }
  return out;
}

export async function getUserNotificationPrefs(userId: string): Promise<Record<string, CategoryPref>> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { notifPrefs: true } });
  return effectivePrefs(u ? u.notifPrefs : null);
}

/** The ONE writer (the contactColumns precedent: sanitize, then store). */
export async function setUserNotificationPrefs(userId: string, input: any): Promise<Record<string, CategoryPref>> {
  const raw = input && typeof input === "object" ? input : {};
  const clean: Record<string, CategoryPref> = {};
  for (const c of NOTIFICATION_CATEGORIES) {
    const s = raw[c.key] && typeof raw[c.key] === "object" ? raw[c.key] : null;
    if (!s) continue;
    clean[c.key] = {
      on: typeof s.on === "boolean" ? s.on : c.defaultOn,
      toast: c.urgency === "toast" ? (typeof s.toast === "boolean" ? s.toast : true) : false,
    };
  }
  await db.user.update({ where: { id: userId }, data: { notifPrefs: clean } });
  return getUserNotificationPrefs(userId);
}

// ------------------------------------------------------------------- emission
export interface NotifyInput {
  tenantId: string;
  category: string;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Optional: only these users. Default = every enabled user in the tenant
   *  (the read-time permission filter then decides who actually sees it). */
  userIds?: string[] | null;
}

/** Create one row per recipient. Producers should prefer notifyNever(). */
export async function notify(input: NotifyInput): Promise<number> {
  const cat = getCategory(input.category);
  if (!cat) throw new Error(`Unknown notification category "${input.category}"`);
  const title = String(input.title || "").trim().slice(0, 160);
  if (!title) throw new Error("Notification title is required.");
  const body = input.body == null ? null : String(input.body).trim().slice(0, 240);
  const users = await db.user.findMany({
    where: { tenantId: input.tenantId, disabled: false, ...(input.userIds && input.userIds.length ? { id: { in: input.userIds } } : {}) },
    select: { id: true, notifPrefs: true },
  });
  const rows: any[] = [];
  for (const u of users) {
    // "Notify me at all" is a per-user gate applied at WRITE time: an off
    // category simply produces no row.
    if (effectivePrefs(u.notifPrefs)[cat.key].on === false) continue;
    rows.push({
      tenantId: input.tenantId, userId: u.id, category: cat.key, title, body,
      link: input.link ? String(input.link).slice(0, 300) : null,
      requiredArea: cat.requiredArea, requiredRight: cat.requiredRight,
    });
  }
  if (!rows.length) {
    // NEVER SILENT: a tenant with no users (or with the category switched off
    // for everyone) produced nothing. That's a legitimate outcome, but it used
    // to be invisible — which is exactly how an empty bell hides a real bug.
    logger.warn(`[notifications] "${cat.key}" for tenant ${input.tenantId} resolved to ZERO recipients (${users.length} user(s) considered) — nothing written`);
    try { require("./healthService").markNotificationNoRecipients(input.tenantId, cat.key); } catch { /* health is a bystander */ }
    return 0;
  }
  const res = await db.notification.createMany({ data: rows });
  return res.count || rows.length;
}

/** THE producer entry point: never throws, never delays. */
export function notifyNever(input: NotifyInput): void {
  setImmediate(() => {
    Promise.resolve()
      .then(() => notify(input))
      .catch((err) => logger.error(`notification emit failed (${input.category}): ${(err as Error).message}`));
  });
}

// -------------------------------------------------------------------- reading
export interface FeedOptions { limit?: number; before?: Date | null; categories?: string[] | null; unreadOnly?: boolean; q?: string | null }
export interface PermUserLike { id: string; role: string; tenantId?: string | null; customRoleId?: string | null }

/** READ-TIME permission filter, evaluated once per distinct (area,right) pair. */
async function filterVisible(user: PermUserLike, rows: any[]): Promise<any[]> {
  const pairs = new Map<string, boolean>();
  const out: any[] = [];
  for (const r of rows) {
    if (!r.requiredArea) { out.push(r); continue; }
    const key = `${r.requiredArea}:${r.requiredRight || "view"}`;
    if (!pairs.has(key)) pairs.set(key, await can(user as any, r.requiredArea, (r.requiredRight || "view") as Right));
    if (pairs.get(key)) out.push(r);
  }
  return out;
}

/**
 * A hub admin visiting a tenant portal has no notification identity there —
 * their user row belongs to no tenant, so a per-user feed is empty by
 * construction and the ordinary "Nothing new" state is a misleading answer to
 * "who am I here?". Instead they get the TENANT's recent activity: the same
 * rows, permission-filtered, deduplicated across recipients (one line per
 * event, not one per user), READ-ONLY. Read state is never written for anyone
 * else — the batch-30 rule stands.
 */
export async function listTenantActivity(user: PermUserLike, tenantId: string, opts: FeedOptions = {}): Promise<{ items: any[]; hasMore: boolean; visitor: true }> {
  const limit = Math.max(1, Math.min(100, opts.limit || 20));
  const where: any = { tenantId };
  if (opts.categories && opts.categories.length) where.category = { in: opts.categories };
  if (opts.before) where.createdAt = { lt: opts.before };
  const q = opts.q ? String(opts.q).trim() : "";
  if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }];
  const raw = await db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit * 4 + 1 });
  const visible = await filterVisible(user, raw);
  // One row per EVENT: the same notification exists once per recipient.
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const n of visible) {
    const key = `${n.category}|${n.title}|${n.link || ""}|${new Date(n.createdAt).toISOString().slice(0, 16)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...n, readAt: null });   // "unread" is meaningless for a visitor
  }
  return { items: deduped.slice(0, limit), hasMore: deduped.length > limit, visitor: true };
}

export async function listNotifications(user: PermUserLike, opts: FeedOptions = {}): Promise<{ items: any[]; hasMore: boolean }> {
  const limit = Math.max(1, Math.min(100, opts.limit || 20));
  const where: any = { userId: user.id };
  if (opts.unreadOnly) where.readAt = null;
  if (opts.categories && opts.categories.length) where.category = { in: opts.categories };
  if (opts.before) where.createdAt = { lt: opts.before };
  const q = opts.q ? String(opts.q).trim() : "";
  if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }];
  // Over-fetch: the permission filter may drop rows and the caller still
  // deserves a full page.
  const raw = await db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit * 2 + 1 });
  const visible = await filterVisible(user, raw);
  return { items: visible.slice(0, limit), hasMore: visible.length > limit };
}

/** The cheap one: WHERE userId = ? AND readAt IS NULL — served by the
 *  [userId, readAt, createdAt] index. Permission-filtered, so the badge can
 *  never count something the user isn't allowed to know exists. */
export async function unreadCount(user: PermUserLike): Promise<number> {
  const rows = await db.notification.findMany({
    where: { userId: user.id, readAt: null },
    select: { requiredArea: true, requiredRight: true },
    take: 200,
  });
  return (await filterVisible(user, rows)).length;
}

export async function markRead(user: PermUserLike, id: string): Promise<{ ok: true }> {
  // Scoped to THIS user's row: a colleague's copy is a different row entirely.
  await db.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
  return { ok: true };
}

export async function markAllRead(user: PermUserLike): Promise<{ count: number }> {
  const res = await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  return { count: res.count || 0 };
}

// ------------------------------------------------------------------ retention
/** The audit-sweep pattern: bounded batches, never throws. */
export async function runNotificationPruneSweep(now: Date = new Date()): Promise<{ deleted: number }> {
  const res = { deleted: 0 };
  try {
    const readCutoff = new Date(now.getTime() - NOTIFICATION_RETENTION.READ_DAYS * 86400000);
    const unreadCutoff = new Date(now.getTime() - NOTIFICATION_RETENTION.UNREAD_DAYS * 86400000);
    const doomed = await db.notification.findMany({
      where: { OR: [{ NOT: { readAt: null }, createdAt: { lt: readCutoff } }, { readAt: null, createdAt: { lt: unreadCutoff } }] },
      select: { id: true }, take: NOTIFICATION_RETENTION.SWEEP_BATCH_SIZE,
    });
    if (doomed.length) {
      const r = await db.notification.deleteMany({ where: { id: { in: doomed.map((d: any) => d.id) } } });
      res.deleted = r.count || 0;
    }
  } catch (err) {
    logger.error(`notification prune sweep failed: ${(err as Error).message}`);
  }
  return res;
}
