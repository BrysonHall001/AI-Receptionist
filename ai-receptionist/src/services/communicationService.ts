import { prisma } from "../db/client";
import { sendRichEmail } from "./notificationService";
import { logger } from "../utils/logger";
import { contactMergeResolver } from "./mergeTags";

const db = prisma as any;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validate + de-duplicate typed email addresses against a set of already-included
// emails (the contact recipients) and against each other. Case-insensitive.
export function dedupeTypedEmails(typed: string[], alreadyIncluded: string[] = []): string[] {
  const taken = new Set((alreadyIncluded || []).map((e) => String(e || "").trim().toLowerCase()));
  const out: string[] = [];
  for (const raw of typed || []) {
    const addr = String(raw || "").trim();
    const lo = addr.toLowerCase();
    if (!EMAIL_RE.test(addr)) continue;       // skip invalid
    if (taken.has(lo)) continue;              // skip dupes (vs contacts + earlier typed)
    taken.add(lo);
    out.push(addr);
  }
  return out;
}

// Resolve the authoritative recipient set for an email blast: the given contact ids,
// scoped to the tenant, dropping any that are soft-deleted or have no email, minus an
// optional exclude set. This is the server-side truth behind the picker's "matching −
// excluded, emailable only" math (the picker computes the same set client-side for the
// live count; the server re-resolves so a stale/forged id list can't email the wrong
// people).
export async function resolveEmailableRecipients(
  tenantId: string,
  contactIds: string[],
  excludeIds: string[] = [],
): Promise<Array<{ id: string; email: string; name: string | null }>> {
  const ids = Array.from(new Set((contactIds || []).filter(Boolean)));
  if (!ids.length) return [];
  const exclude = new Set(excludeIds || []);
  const rows = await db.contact.findMany({
    where: { tenantId, id: { in: ids }, deletedAt: null },
    select: { id: true, email: true, name: true },
  });
  return rows.filter((c: any) => !exclude.has(c.id) && c.email && String(c.email).trim());
}

// Send a manual email blast to the resolved recipients, reusing the SAME outbound path
// the per-contact / bulk Contacts email uses (sendRichEmail), and write ONE
// CommunicationSend record. Returns the counts to report back to the user.
export async function sendEmailBlast(input: {
  tenantId: string;
  subject: string;
  html: string;
  contactIds: string[];
  excludeIds?: string[];
  extraEmails?: string[];
  fromEmail: string;
  fromName?: string | null;
  createdById?: string | null;
}): Promise<{ id: string; recipientCount: number; sentCount: number; failCount: number }> {
  const recipients = await resolveEmailableRecipients(input.tenantId, input.contactIds, input.excludeIds || []);
  // Typed addresses are recipients IN ADDITION to the resolved contacts, validated and
  // de-duplicated against the contact emails (and each other) so nobody gets two copies.
  const typed = dedupeTypedEmails(input.extraEmails || [], recipients.map((r) => r.email));
  // Per-recipient merge tags: load contact field defs once, then fetch the FULL contact
  // records so custom-field tags resolve. Typed addresses have no record -> fallbacks.
  const resolver = await contactMergeResolver(input.tenantId);
  const fullContacts = recipients.length
    ? await db.contact.findMany({ where: { tenantId: input.tenantId, id: { in: recipients.map((r) => r.id) } } })
    : [];
  const byId = new Map(fullContacts.map((c: any) => [c.id, c]));
  // Per-recipient log captured with the actual outcome, persisted on the row so the
  // Sent-log detail view can show WHO each blast went to (and who failed).
  const recipientLog: Array<{ contactId: string | null; email: string; name: string | null; status: "sent" | "failed" }> = [];
  let sentCount = 0;
  let failCount = 0;
  for (const r of recipients) {
    try {
      const contact = byId.get(r.id) || null;
      await sendRichEmail({ to: r.email, subject: resolver.apply(input.subject, contact), html: resolver.apply(input.html || "", contact), fromEmail: input.fromEmail, fromName: input.fromName ?? null });
      sentCount++;
      recipientLog.push({ contactId: r.id, email: r.email, name: r.name ?? null, status: "sent" });
    } catch (e) {
      failCount++;
      recipientLog.push({ contactId: r.id, email: r.email, name: r.name ?? null, status: "failed" });
      logger.error(`[communication] email to ${r.email} failed: ${(e as Error).message}`);
    }
  }
  for (const addr of typed) {
    try {
      await sendRichEmail({ to: addr, subject: resolver.apply(input.subject, null), html: resolver.apply(input.html || "", null), fromEmail: input.fromEmail, fromName: input.fromName ?? null });
      sentCount++;
      recipientLog.push({ contactId: null, email: addr, name: null, status: "sent" });
    } catch (e) {
      failCount++;
      recipientLog.push({ contactId: null, email: addr, name: null, status: "failed" });
      logger.error(`[communication] email to ${addr} failed: ${(e as Error).message}`);
    }
  }
  const recipientCount = recipients.length + typed.length;
  const rec = await db.communicationSend.create({
    data: {
      tenantId: input.tenantId,
      channel: "email",
      subject: (input.subject || "").slice(0, 998),
      body: input.html || "",
      recipientCount,
      sentCount,
      failCount,
      recipients: recipientLog,
      createdById: input.createdById ?? null,
    },
  });
  return { id: rec.id, recipientCount, sentCount, failCount };
}

// The Sent log: a tenant's communication blasts, newest first, capped, joined to the
// creator's display name. Includes subject + body so the detail view is faithful.
export async function listSends(tenantId: string, limit = 500): Promise<Array<{
  id: string; channel: string; subject: string; body: string;
  recipientCount: number; sentCount: number; failCount: number;
  recipients: Array<{ contactId: string | null; email: string; name: string | null; status: string }>;
  createdById: string | null; createdByName: string | null; createdAt: string;
}>> {
  const rows = await db.communicationSend.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const ids = Array.from(new Set(rows.map((r: any) => r.createdById).filter(Boolean))) as string[];
  const nameById: Record<string, string | null> = {};
  if (ids.length) {
    const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
    users.forEach((u: any) => { nameById[u.id] = u.name || u.email || null; });
  }
  return rows.map((r: any) => ({
    id: r.id,
    channel: r.channel,
    subject: r.subject || "",
    body: r.body || "",
    recipientCount: r.recipientCount,
    sentCount: r.sentCount,
    failCount: r.failCount,
    // Stored as JSON; default [] for rows written before this field existed. Coerce
    // to an array defensively so the client always receives a list.
    recipients: Array.isArray(r.recipients) ? r.recipients : [],
    createdById: r.createdById ?? null,
    createdByName: r.createdById ? (nameById[r.createdById] ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
