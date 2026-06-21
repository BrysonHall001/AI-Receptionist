// Feedback / ticketing — shared logic for BOTH instances:
//   scope "portal"  -> tenant-facing tickets (FeedbackTicket.tenantId set)
//   scope "master"  -> admin-facing tickets (FeedbackTicket.tenantId null)
//
// Every visibility/permission rule is enforced HERE (server-side), regardless of
// what the UI shows. The route layer only passes the scope + the acting user.
import { prisma } from "../db/client";
import { sendPlainEmail } from "./notificationService";
import { logger } from "../utils/logger";
import type { AuthUser } from "../middleware/auth";

// Where new-ticket / "tell the owner" notifications go for now (hardcoded as asked).
const NOTIFY_EMAIL = "brysonhall001@gmail.com";
// Resolved tickets auto-delete this many days after being resolved.
const RESOLVED_TTL_DAYS = 30;

export type Scope = "portal" | "master";
export interface Ctx {
  scope: Scope;
  tenantId?: string | null; // the resolved portal (portal scope only)
  actor: AuthUser;
}

// ---- role helpers ----------------------------------------------------------
// Per-portal "moderator" tier (see ALL tickets in a portal, reply to any,
// resolve, restore). Deliberately OWNER/SUPER_ADMIN only — auditors get no
// special reach on the tenant side.
function isPortalMod(role: string): boolean {
  return role === "OWNER" || role === "SUPER_ADMIN";
}
// Master-hub participants: auditors, super-admins, owner (all see each other's).
function isMasterRole(role: string): boolean {
  return role === "OWNER" || role === "SUPER_ADMIN" || role === "AUDITOR";
}

function httpError(message: string, status: number): Error {
  const e = new Error(message) as Error & { status?: number };
  e.status = status;
  return e;
}

// Normalize one attachment link. Returns {skip} for blank rows, {ok:false} for
// junk, or {ok:true, value} with the normalized URL. A bare domain ("google.com")
// gets "https://" prepended; an already-http(s) URL is kept; any other scheme or a
// hostname without a dot ("asdf") or whitespace is rejected. MUST stay identical to
// the frontend normalizeAttachmentUrl in feedback.js (no bundler to share one copy).
function normalizeAttachmentUrl(raw: unknown): { skip: boolean; ok: boolean; value?: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { skip: true, ok: true };
  if (/\s/.test(s)) return { skip: false, ok: false };
  let candidate: string;
  if (/^https?:\/\//i.test(s)) candidate = s;
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return { skip: false, ok: false }; // some other scheme
  else candidate = "https://" + s;
  let u: URL;
  try { u = new URL(candidate); } catch { return { skip: false, ok: false }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { skip: false, ok: false };
  if (!u.hostname || u.hostname.indexOf(".") === -1) return { skip: false, ok: false };
  return { skip: false, ok: true, value: candidate };
}

// Validate + normalize a list of attachment link URLs. We only STORE and DISPLAY
// these (never fetch them server-side), so no SSRF/private-IP checks are needed.
// Blank entries are dropped; the STORED value is the normalized one (with https://).
function sanitizeAttachments(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw httpError("Attachments must be a list of links.", 400);
  const out: string[] = [];
  for (const item of raw) {
    const r = normalizeAttachmentUrl(item);
    if (r.skip) continue;
    if (!r.ok) throw httpError(`Not a valid link: ${String(item ?? "").trim()}`, 400);
    out.push(r.value!);
  }
  return out;
}

// ---- DTOs ------------------------------------------------------------------
function ticketDTO(t: any) {
  return {
    id: t.id,
    tenantId: t.tenantId ?? null,
    problem: t.problem,
    description: t.description,
    attachments: Array.isArray(t.attachments) ? t.attachments : [],
    status: t.status,
    resolvedAt: t.resolvedAt,
    createdAt: t.createdAt,
    submitter: t.createdBy
      ? { id: t.createdBy.id, name: t.createdBy.name, email: t.createdBy.email }
      : null,
  };
}
function messageDTO(m: any) {
  return {
    id: m.id,
    body: m.body,
    createdAt: m.createdAt,
    author: m.author ? { id: m.author.id, name: m.author.name, email: m.author.email } : null,
  };
}

// ---- visibility ------------------------------------------------------------
function canView(t: any, ctx: Ctx): boolean {
  if (ctx.scope === "master") {
    // Master tickets only; only master roles. A portal ticket is never visible here.
    return t.tenantId === null && isMasterRole(ctx.actor.role);
  }
  // portal scope
  if (t.tenantId === null) return false;                 // master ticket never leaks into a portal
  if (ctx.tenantId && t.tenantId !== ctx.tenantId) return false; // different portal
  if (isPortalMod(ctx.actor.role)) return true;          // owner/super-admin: all in this portal
  return t.createdById === ctx.actor.id;                 // portal user: only their own
}

function canReply(t: any, ctx: Ctx): boolean {
  if (!canView(t, ctx)) return false;
  if (ctx.scope === "master") return isMasterRole(ctx.actor.role);
  if (isPortalMod(ctx.actor.role)) return true;          // owner/super-admin reply to any
  return t.createdById === ctx.actor.id;                 // submitter replies to own
}

function canModerate(ctx: Ctx): boolean {
  // resolve + restore. Master: OWNER only. Portal: OWNER/SUPER_ADMIN.
  if (ctx.scope === "master") return ctx.actor.role === "OWNER";
  return isPortalMod(ctx.actor.role);
}

// Hard-delete a RESOLVED ticket. OWNER/SUPER_ADMIN ONLY (never auditor), in BOTH
// scopes — a deliberately stricter, separate gate from resolve/restore.
function canDelete(ctx: Ctx): boolean {
  return ctx.actor.role === "OWNER" || ctx.actor.role === "SUPER_ADMIN";
}

// ---- queries ---------------------------------------------------------------
export async function listFeedback(ctx: Ctx): Promise<{ active: any[]; resolved: any[] }> {
  let where: any;
  if (ctx.scope === "master") {
    if (!isMasterRole(ctx.actor.role)) return { active: [], resolved: [] };
    where = { tenantId: null };
  } else {
    if (!ctx.tenantId) return { active: [], resolved: [] };
    where = { tenantId: ctx.tenantId };
    if (!isPortalMod(ctx.actor.role)) where.createdById = ctx.actor.id; // portal user -> only own
  }
  const rows = await (prisma as any).feedbackTicket.findMany({
    where,
    include: { createdBy: true },
    orderBy: { createdAt: "desc" },
  });
  return {
    active: rows.filter((r: any) => r.status === "OPEN").map(ticketDTO),
    resolved: rows.filter((r: any) => r.status === "RESOLVED").map(ticketDTO),
  };
}

// Expand tickets (with createdBy/resolvedBy/tenant/messages included) into flat
// export rows: ONE ROW PER REPLY, ticket fields repeated; a ticket with ZERO
// replies yields EXACTLY ONE row (reply fields null). Shared by the per-portal,
// master-hub, and all-portals export paths so the shape never diverges.
function expandTicketsToExportRows(tickets: any[]): any[] {
  const person = (u: any) => (u ? (u.name || u.email || null) : null);
  const out: any[] = [];
  for (const t of tickets) {
    const base = {
      ticketId: t.id,
      problem: t.problem,
      description: t.description,
      status: t.status,
      postedBy: person(t.createdBy),
      postedAt: t.createdAt,
      resolvedAt: t.resolvedAt,
      resolvedBy: person(t.resolvedBy),
      portal: t.tenant ? t.tenant.name : "Master hub",
    };
    const msgs = t.messages || [];
    if (!msgs.length) {
      out.push({ ...base, replyAuthor: null, replyAt: null, replyText: null });
    } else {
      for (const m of msgs) {
        out.push({ ...base, replyAuthor: person(m.author), replyAt: m.createdAt, replyText: m.body });
      }
    }
  }
  return out;
}

const FEEDBACK_EXPORT_INCLUDE = {
  createdBy: true,
  resolvedBy: true,
  tenant: true,
  messages: { include: { author: true }, orderBy: { createdAt: "asc" } },
} as const;

// Newest-N tickets cap for the all-portals export (safety valve for big datasets).
export const ALL_PORTALS_EXPORT_TICKET_CAP = 5000;

// Flat rows for the ticket export: ONE ROW PER REPLY, with the ticket's own fields
// repeated on each of its reply rows. A ticket with ZERO replies still yields
// EXACTLY ONE row (reply fields null) so unanswered/open tickets are never dropped.
// Scope rules match listFeedback: portal moderators get all tickets in the portal,
// other portal users get only their own; master scope gets master-hub tickets.
export async function listFeedbackExportRows(ctx: Ctx): Promise<any[]> {
  let where: any;
  if (ctx.scope === "master") {
    if (!isMasterRole(ctx.actor.role)) return [];
    where = { tenantId: null };
  } else {
    if (!ctx.tenantId) return [];
    where = { tenantId: ctx.tenantId };
    if (!isPortalMod(ctx.actor.role)) where.createdById = ctx.actor.id;
  }
  const tickets = await (prisma as any).feedbackTicket.findMany({
    where,
    include: FEEDBACK_EXPORT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return expandTicketsToExportRows(tickets);
}

// Flat export rows across ALL portals + the master hub, each row carrying its
// Portal name ("Master hub" for tenantId null). Master roles only. Capped at the
// newest ALL_PORTALS_EXPORT_TICKET_CAP tickets. Reuses the same reply-expansion.
export async function listAllFeedbackExportRows(actor: AuthUser): Promise<any[]> {
  if (!isMasterRole(actor.role)) return [];
  const tickets = await (prisma as any).feedbackTicket.findMany({
    include: FEEDBACK_EXPORT_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: ALL_PORTALS_EXPORT_TICKET_CAP,
  });
  return expandTicketsToExportRows(tickets);
}

export async function getFeedbackTicket(id: string, ctx: Ctx): Promise<any | null> {
  const t = await (prisma as any).feedbackTicket.findUnique({
    where: { id },
    include: { createdBy: true, messages: { include: { author: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!t || !canView(t, ctx)) return null; // hide existence on no-access
  return { ...ticketDTO(t), messages: t.messages.map(messageDTO) };
}

export async function createFeedbackTicket(
  ctx: Ctx,
  input: { problem: string; description: string; attachments?: unknown },
): Promise<any> {
  const problem = (input.problem || "").trim();
  const description = (input.description || "").trim();
  if (!problem || !description) {
    throw httpError("Both a problem and a description are required.", 400);
  }
  const attachments = sanitizeAttachments(input.attachments);
  const tenantId = ctx.scope === "master" ? null : ctx.tenantId || null;
  if (ctx.scope === "master" && !isMasterRole(ctx.actor.role)) {
    throw httpError("Not authorized to submit master feedback.", 403);
  }
  if (ctx.scope === "portal" && !tenantId) throw httpError("No portal selected.", 400);

  const t = await (prisma as any).feedbackTicket.create({
    data: { tenantId, createdById: ctx.actor.id, problem, description, attachments },
    include: { createdBy: true },
  });
  const portalName = tenantId ? await tenantName(tenantId) : "Master hub";
  await notifyNewTicket({ portalName, submitter: ctx.actor, problem, description });
  return ticketDTO(t);
}

// Append attachment link(s) to an EXISTING ticket. Same access rule as replying
// (canReply): a portal moderator may add to any ticket in the portal, a submitter
// to their own; master roles to master tickets. Validates each link (http/https).
export async function addFeedbackAttachments(id: string, ctx: Ctx, input: { urls: unknown }): Promise<any> {
  const t = await (prisma as any).feedbackTicket.findUnique({ where: { id }, include: { createdBy: true } });
  if (!t || !canView(t, ctx)) throw httpError("Ticket not found.", 404);
  if (!canReply(t, ctx)) throw httpError("Not authorized to add attachments to this ticket.", 403);
  const additions = sanitizeAttachments(input.urls);
  if (!additions.length) throw httpError("Add at least one valid link.", 400);
  const existing = Array.isArray(t.attachments) ? t.attachments : [];
  const up = await (prisma as any).feedbackTicket.update({
    where: { id },
    data: { attachments: [...existing, ...additions] },
    include: { createdBy: true },
  });
  return ticketDTO(up);
}

export async function addFeedbackMessage(
  id: string,
  ctx: Ctx,
  input: { body: string },
): Promise<any> {
  const body = (input.body || "").trim();
  if (!body) throw httpError("Reply cannot be empty.", 400);

  const t = await (prisma as any).feedbackTicket.findUnique({ where: { id }, include: { createdBy: true } });
  if (!t || !canView(t, ctx)) throw httpError("Ticket not found.", 404);
  if (!canReply(t, ctx)) throw httpError("Not authorized to reply to this ticket.", 403);

  const m = await (prisma as any).feedbackMessage.create({
    data: { ticketId: id, authorId: ctx.actor.id, body },
    include: { author: true },
  });
  await (prisma as any).feedbackTicket.update({ where: { id }, data: { updatedAt: new Date() } });
  await notifyReply({ ticket: t, actor: ctx.actor, body });
  return messageDTO(m);
}

export async function resolveFeedbackTicket(id: string, ctx: Ctx): Promise<any> {
  const t = await (prisma as any).feedbackTicket.findUnique({ where: { id }, include: { createdBy: true } });
  if (!t || !canView(t, ctx)) throw httpError("Ticket not found.", 404);
  if (!canModerate(ctx)) throw httpError("Not authorized to resolve this ticket.", 403);
  const up = await (prisma as any).feedbackTicket.update({
    where: { id },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: ctx.actor.id },
    include: { createdBy: true },
  });
  return ticketDTO(up);
}

export async function restoreFeedbackTicket(id: string, ctx: Ctx): Promise<any> {
  const t = await (prisma as any).feedbackTicket.findUnique({ where: { id }, include: { createdBy: true } });
  if (!t || !canView(t, ctx)) throw httpError("Ticket not found.", 404);
  if (!canModerate(ctx)) throw httpError("Not authorized to restore this ticket.", 403);
  const up = await (prisma as any).feedbackTicket.update({
    where: { id },
    data: { status: "OPEN", resolvedAt: null, resolvedById: null },
    include: { createdBy: true },
  });
  return ticketDTO(up);
}

// Hard-delete a single resolved ticket (its messages cascade). Mirrors the resolve
// flow's checks: must be visible (404), the actor must be allowed to delete (403),
// and only RESOLVED tickets are deletable (400). Same hard-delete mechanism the
// 30-day sweep already uses.
export async function deleteFeedbackTicket(id: string, ctx: Ctx): Promise<{ ok: true; id: string }> {
  const t = await (prisma as any).feedbackTicket.findUnique({ where: { id }, include: { createdBy: true } });
  if (!t || !canView(t, ctx)) throw httpError("Ticket not found.", 404);
  if (!canDelete(ctx)) throw httpError("Not authorized to delete this ticket.", 403);
  if (t.status !== "RESOLVED") throw httpError("Only resolved tickets can be deleted.", 400);
  await (prisma as any).feedbackTicket.delete({ where: { id } });
  return { ok: true, id };
}

// ---- 30-day auto-delete sweep (called by the scheduler in index.ts) --------
export async function sweepResolvedFeedback(): Promise<number> {
  const cutoff = new Date(Date.now() - RESOLVED_TTL_DAYS * 24 * 60 * 60 * 1000);
  const res = await (prisma as any).feedbackTicket.deleteMany({
    where: { status: "RESOLVED", resolvedAt: { lt: cutoff } },
  });
  if (res.count) {
    logger.info(`[feedback sweep] deleted ${res.count} resolved ticket(s) older than ${RESOLVED_TTL_DAYS} days`);
  }
  return res.count;
}

// ---- emails ----------------------------------------------------------------
async function tenantName(tenantId: string): Promise<string> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return t?.name || "Unknown portal";
}
function who(a: { name?: string | null; email: string }): string {
  return a.name ? `${a.name} (${a.email})` : a.email;
}

async function notifyNewTicket(p: {
  portalName: string;
  submitter: AuthUser;
  problem: string;
  description: string;
}): Promise<void> {
  const subject = `New feedback — ${p.portalName}: ${p.problem}`;
  const body =
    `A new feedback ticket was submitted.\n\n` +
    `Area: ${p.portalName}\n` +
    `Submitted by: ${who(p.submitter)}\n\n` +
    `Problem:\n${p.problem}\n\n` +
    `Description:\n${p.description}\n`;
  try {
    await sendPlainEmail(NOTIFY_EMAIL, subject, body);
  } catch (e) {
    logger.error(`feedback new-ticket email failed: ${(e as Error).message}`);
  }
}

async function notifyReply(p: { ticket: any; actor: AuthUser; body: string }): Promise<void> {
  const { ticket, actor, body } = p;
  const isMaster = ticket.tenantId === null;
  const portalName = isMaster ? "Master hub" : await tenantName(ticket.tenantId);
  const subject = `New reply on feedback — ${portalName}: ${ticket.problem}`;
  const text =
    `A new reply was posted on a feedback ticket.\n\n` +
    `Area: ${portalName}\n` +
    `Ticket: ${ticket.problem}\n` +
    `Reply by: ${who(actor)}\n\n` +
    `${body}\n`;

  const recipients = new Set<string>();
  if (isMaster) {
    // Master: always notify the owner inbox, plus the submitter if someone else replied.
    recipients.add(NOTIFY_EMAIL);
    if (ticket.createdBy && ticket.createdBy.id !== actor.id && ticket.createdBy.email) {
      recipients.add(ticket.createdBy.email);
    }
  } else {
    // Portal: notify the OTHER party.
    const submitterReplied = ticket.createdById === actor.id;
    if (submitterReplied) {
      recipients.add(NOTIFY_EMAIL); // client replied -> tell the owner inbox
    } else if (ticket.createdBy && ticket.createdBy.email) {
      recipients.add(ticket.createdBy.email); // admin replied -> tell the client
    }
  }
  // Never email the person who just wrote the reply.
  if (actor.email) recipients.delete(actor.email);

  for (const to of recipients) {
    try {
      await sendPlainEmail(to, subject, text);
    } catch (e) {
      logger.error(`feedback reply email to ${to} failed: ${(e as Error).message}`);
    }
  }
}
