import { prisma } from "../db/client";
import { sendRichEmail } from "./notificationService";
import { logger } from "../utils/logger";

const db = prisma as any;

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
  fromEmail: string;
  fromName?: string | null;
  createdById?: string | null;
}): Promise<{ id: string; recipientCount: number; sentCount: number; failCount: number }> {
  const recipients = await resolveEmailableRecipients(input.tenantId, input.contactIds, input.excludeIds || []);
  let sentCount = 0;
  let failCount = 0;
  for (const r of recipients) {
    try {
      await sendRichEmail({ to: r.email, subject: input.subject, html: input.html || "", fromEmail: input.fromEmail, fromName: input.fromName ?? null });
      sentCount++;
    } catch (e) {
      failCount++;
      logger.error(`[communication] email to ${r.email} failed: ${(e as Error).message}`);
    }
  }
  const rec = await db.communicationSend.create({
    data: {
      tenantId: input.tenantId,
      channel: "email",
      subject: (input.subject || "").slice(0, 998),
      body: input.html || "",
      recipientCount: recipients.length,
      sentCount,
      failCount,
      createdById: input.createdById ?? null,
    },
  });
  return { id: rec.id, recipientCount: recipients.length, sentCount, failCount };
}

// The Sent log: a tenant's communication blasts, newest first, capped, joined to the
// creator's display name. Includes subject + body so the detail view is faithful.
export async function listSends(tenantId: string, limit = 500): Promise<Array<{
  id: string; channel: string; subject: string; body: string;
  recipientCount: number; sentCount: number; failCount: number;
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
    createdById: r.createdById ?? null,
    createdByName: r.createdById ? (nameById[r.createdById] ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
