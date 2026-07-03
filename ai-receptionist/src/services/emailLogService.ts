// EmailLog read + delivery-event ingestion.
//
//  - applyResendEvent(): fold ONE Resend/Svix delivery event into the matching EmailLog
//    row (matched by providerMessageId === event.data.email_id). Delivery status layers
//    on top of the send `status`; it is guarded against out-of-order and duplicate events
//    (webhooks are at-least-once) and never regresses a terminal bounced/complained state.
//  - listAllEmailLogs(): cross-tenant feed for the master-hub Email dashboard, joined to
//    tenant name + sender name.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";

const db = prisma as any;

// Resend event.type -> our deliveryStatus value.
const EVENT_MAP: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "delivery_delayed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.failed": "failed",
};

// States we must never regress FROM when a softer, non-terminal event arrives later
// (e.g. a delayed/duplicate "delivered" or "opened" after a hard "bounced").
const TERMINAL = new Set(["bounced", "complained"]);

export interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    // Bounce/failure detail can appear under a few shapes depending on event; we read
    // defensively and keep the first useful string.
    bounce?: { message?: string; subType?: string; type?: string } | null;
    failed?: { reason?: string } | null;
    reason?: string | null;
    [k: string]: unknown;
  };
}

export type ApplyResult = "updated" | "ignored" | "no_match";

// Pull a short human reason for bounces/failures, if the event carries one.
function detailFromEvent(event: ResendEvent): string | null {
  const d = event.data || {};
  const b = d.bounce || null;
  const parts = [
    b?.type,
    b?.subType,
    b?.message,
    (d.failed && d.failed.reason) || null,
    typeof d.reason === "string" ? d.reason : null,
  ].filter((x): x is string => !!x && typeof x === "string");
  if (!parts.length) return null;
  // De-dupe while preserving order, then cap length so a runaway message can't bloat the row.
  const seen = new Set<string>();
  const uniq = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  return uniq.join(" — ").slice(0, 500);
}

/**
 * Fold one delivery event into its EmailLog row. Returns:
 *   "updated"  — a row matched and was updated
 *   "ignored"  — recognized but not applied (unknown type, older/out-of-order, or a
 *                non-terminal event arriving after a terminal state)
 *   "no_match" — no EmailLog row for this email_id (e.g. a pre-3A send) — ignore gracefully
 */
export async function applyResendEvent(event: ResendEvent): Promise<ApplyResult> {
  const emailId = event?.data?.email_id;
  const mapped = event?.type ? EVENT_MAP[event.type] : undefined;
  if (!emailId || !mapped) return "ignored";

  const row = await db.emailLog.findFirst({ where: { providerMessageId: emailId } });
  if (!row) return "no_match";

  const eventAt = event.created_at ? new Date(event.created_at) : new Date();
  if (isNaN(eventAt.getTime())) return "ignored";

  // Out-of-order / duplicate guard: never apply an event OLDER than the last one applied.
  if (row.lastEventAt && eventAt.getTime() < new Date(row.lastEventAt).getTime()) {
    return "ignored";
  }

  const currentlyTerminal = !!row.deliveryStatus && TERMINAL.has(row.deliveryStatus);
  const data: Record<string, unknown> = { lastEventAt: eventAt };

  if (mapped === "opened") {
    // First open sets openedAt (even if a terminal status already won the deliveryStatus slot).
    if (!row.openedAt) data.openedAt = eventAt;
    if (!currentlyTerminal) data.deliveryStatus = "opened";
  } else if (TERMINAL.has(mapped) || mapped === "failed") {
    // Terminal / failure events always win.
    data.deliveryStatus = mapped;
    const detail = detailFromEvent(event);
    if (detail) data.deliveryDetail = detail;
  } else {
    // delivered, delivery_delayed, clicked — apply unless a terminal state already stands.
    if (!currentlyTerminal) data.deliveryStatus = mapped;
  }

  // If nothing but lastEventAt would change AND it wouldn't move forward, treat as ignored.
  const onlyTimestamp = Object.keys(data).length === 1; // just lastEventAt
  if (onlyTimestamp && currentlyTerminal) {
    // A non-terminal event after a terminal state: record that we saw it (bump lastEventAt)
    // but keep the terminal deliveryStatus. Still counts as a (minimal) update.
  }

  await db.emailLog.update({ where: { id: row.id }, data });
  return "updated";
}

// Cross-tenant feed for the master-hub Email dashboard. Most-recent first, capped.
// Joined to tenant name + sender name via id->name lookups (mirrors listSends()).
async function mapEmailRows(rows: any[]) {
  const tenantIds = Array.from(new Set(rows.map((r: any) => r.tenantId).filter(Boolean))) as string[];
  const userIds = Array.from(new Set(rows.map((r: any) => r.sentById).filter(Boolean))) as string[];

  const [tenants, users] = await Promise.all([
    tenantIds.length ? prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
  ]);
  const tenantName: Record<string, string> = {};
  tenants.forEach((t: any) => (tenantName[t.id] = t.name));
  const userName: Record<string, string> = {};
  users.forEach((u: any) => (userName[u.id] = u.name || u.email));

  return rows.map((r: any) => ({
    id: r.id,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    tenantId: r.tenantId ?? null,
    tenantName: r.tenantId ? (tenantName[r.tenantId] ?? null) : null,
    sentById: r.sentById ?? null,
    sentByName: r.sentById ? (userName[r.sentById] ?? null) : null,
    toEmail: r.toEmail,
    toName: r.toName ?? null,
    contactId: r.contactId ?? null,
    type: r.type,
    subject: r.subject ?? "",
    status: r.status, // "sent"|"failed"|"mock"
    deliveryStatus: r.deliveryStatus ?? null,
    deliveryDetail: r.deliveryDetail ?? null,
    providerMessageId: r.providerMessageId ?? null,
    errorMessage: r.errorMessage ?? null,
    communicationSendId: r.communicationSendId ?? null,
    lastEventAt: r.lastEventAt ? (r.lastEventAt instanceof Date ? r.lastEventAt.toISOString() : r.lastEventAt) : null,
    openedAt: r.openedAt ? (r.openedAt instanceof Date ? r.openedAt.toISOString() : r.openedAt) : null,
  }));
}

// Flat per-recipient feed (kept for completeness / ad-hoc use).
export async function listAllEmailLogs(limit = 1000) {
  const rows = await db.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return mapEmailRows(rows);
}

// A stable key for one "send" as shown on the master-hub Email page (Level 1):
//   - "send:<communicationSendId>" groups every recipient of a blast into one row
//   - "single:<emailLogId>"        is a one-off send (no communicationSendId) as a group of one
function groupKeyFor(r: { communicationSendId?: string | null; id: string }): string {
  return r.communicationSendId ? `send:${r.communicationSendId}` : `single:${r.id}`;
}

/**
 * LEVEL 1 — one row per SEND across all tenants. EmailLog rows are grouped by
 * communicationSendId; rows without one (call_summary, password_reset, single-contact,
 * some invites/feedback) each become their own single-recipient send. Most-recent first.
 * `limit` caps the underlying EmailLog scan; grouping happens in-process.
 */
export async function listGroupedEmailSends(limit = 5000) {
  const rows = await db.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  const mapped = await mapEmailRows(rows);

  const groups = new Map<string, any>();
  for (const r of mapped) {
    const key = groupKeyFor(r);
    let g = groups.get(key);
    if (!g) {
      // rows arrive newest-first, so the first row seen for a key is its latest event.
      g = {
        groupKey: key,
        communicationSendId: r.communicationSendId ?? null,
        date: r.createdAt,
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        sentById: r.sentById,
        sentByName: r.sentByName,
        subject: r.subject,
        recipientCount: 0,
      };
      groups.set(key, g);
    }
    g.recipientCount++;
    if (new Date(r.createdAt).getTime() > new Date(g.date).getTime()) g.date = r.createdAt;
  }
  return Array.from(groups.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * LEVEL 2 — the recipient list for one send group. `groupKey` is either
 * "send:<communicationSendId>" (all recipients of a blast) or "single:<emailLogId>"
 * (a one-off send — returns exactly that one row, so single-recipient sends still show
 * a one-row recipient list rather than skipping to detail).
 */
export async function listEmailSendRecipients(groupKey: string) {
  let rows: any[] = [];
  if (typeof groupKey === "string" && groupKey.startsWith("send:")) {
    const cid = groupKey.slice("send:".length);
    if (cid) rows = await db.emailLog.findMany({ where: { communicationSendId: cid }, orderBy: { createdAt: "asc" } });
  } else if (typeof groupKey === "string" && groupKey.startsWith("single:")) {
    const id = groupKey.slice("single:".length);
    if (id) rows = await db.emailLog.findMany({ where: { id }, orderBy: { createdAt: "asc" } });
  }
  return mapEmailRows(rows);
}
