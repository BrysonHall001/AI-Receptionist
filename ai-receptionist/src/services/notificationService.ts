import { Resend } from "resend";
import { env, useMockEmail } from "../config/env";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { TranscriptTurn, summarize } from "../utils/transcript";
import { Extracted } from "../ai/schema";

const resend = new Resend(env.RESEND_API_KEY);

// Optional per-send metadata threaded from callers so every EmailLog row is
// attributable (which tenant/user/contact/blast it belongs to). All fields are
// optional so existing callers keep working unchanged (backwards compatible).
export interface EmailMeta {
  tenantId?: string | null;
  type?: string;
  sentById?: string | null;
  contactId?: string | null;
  toName?: string | null;
  communicationSendId?: string | null;
}

// Write ONE EmailLog row for a single send outcome. Wrapped so a logging failure can
// NEVER break (or mask) the actual email send — it only warns. Accessed via `as any`
// so this type-checks even before `prisma generate` has run for the new model.
async function writeEmailLog(row: {
  tenantId: string | null;
  type: string;
  toEmail: string;
  toName: string | null;
  contactId: string | null;
  subject: string;
  sentById: string | null;
  communicationSendId: string | null;
  providerMessageId: string | null;
  status: "sent" | "failed" | "mock";
  errorMessage: string | null;
}): Promise<void> {
  try {
    await (prisma as any).emailLog.create({ data: row });
  } catch (e) {
    // Never let audit logging break email delivery — just record that it failed.
    logger.warn(`[emaillog] failed to record ${row.type} to ${row.toEmail}: ${(e as Error).message}`);
  }
}

export interface CallSummaryEmailInput {
  to: string;
  businessName: string;
  extracted: Extracted;
  fromNumber: string;
  transcript: TranscriptTurn[];
  startedAt: Date;
  completed: boolean;
}

/** Sends the post-call summary email via Resend (LAYER 6). Throws on failure. */
export async function sendCallSummaryEmail(input: CallSummaryEmailInput, meta?: EmailMeta): Promise<void> {
  const name = input.extracted.name || "Unknown caller";
  const phone = input.extracted.phone || input.fromNumber || "Unknown";
  const intent = input.extracted.intent || "Not captured";
  const email = input.extracted.email || "Not provided";
  const when = input.startedAt.toLocaleString("en-US", { timeZoneName: "short" });
  const status = input.completed ? "Completed" : "Incomplete / missed";
  const transcriptText = summarize(input.transcript);

  const subject = `New call: ${name} — ${intent}`.slice(0, 120);

  // Common EmailLog fields for whichever outcome path we take below.
  const logBase = {
    tenantId: meta?.tenantId ?? null,
    type: meta?.type ?? "call_summary",
    toEmail: input.to,
    toName: meta?.toName ?? null,
    contactId: meta?.contactId ?? null,
    subject,
    sentById: meta?.sentById ?? null,
    communicationSendId: meta?.communicationSendId ?? null,
  };

  // No real Resend key -> log the notification instead of sending.
  if (useMockEmail()) {
    logger.info(`[mock email] would notify ${input.to} | subject: "${subject}"`);
    await writeEmailLog({ ...logBase, status: "mock", providerMessageId: null, errorMessage: null });
    return;
  }

  const text = [
    `New phone call for ${input.businessName}`,
    `Status: ${status}`,
    `Time: ${when}`,
    "",
    `Caller name: ${name}`,
    `Phone: ${phone}`,
    `Email: ${email}`,
    `Reason for calling: ${intent}`,
    "",
    "Transcript:",
    transcriptText,
  ].join("\n");

  const html =
    `<h2>New phone call for ${escapeHtml(input.businessName)}</h2>` +
    `<p><strong>Status:</strong> ${escapeHtml(status)}<br/>` +
    `<strong>Time:</strong> ${escapeHtml(when)}</p>` +
    `<ul>` +
    `<li><strong>Caller name:</strong> ${escapeHtml(name)}</li>` +
    `<li><strong>Phone:</strong> ${escapeHtml(phone)}</li>` +
    `<li><strong>Email:</strong> ${escapeHtml(email)}</li>` +
    `<li><strong>Reason for calling:</strong> ${escapeHtml(intent)}</li>` +
    `</ul>` +
    `<h3>Transcript</h3><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(transcriptText)}</pre>`;

  const { data, error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to: [input.to],
    subject,
    text,
    html,
  });

  if (error) {
    // Record the failure BEFORE re-throwing (keeps existing throw-on-error behavior).
    await writeEmailLog({ ...logBase, status: "failed", providerMessageId: null, errorMessage: JSON.stringify(error) });
    throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
  }
  await writeEmailLog({ ...logBase, status: "sent", providerMessageId: data?.id ?? null, errorMessage: null });
  logger.info(`Call summary email sent to ${input.to}`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Generic transactional email (e.g. password reset). Respects mock mode. */
export async function sendPlainEmail(to: string, subject: string, body: string, meta?: EmailMeta): Promise<void> {
  const logBase = {
    tenantId: meta?.tenantId ?? null,
    type: meta?.type ?? "single",
    toEmail: to,
    toName: meta?.toName ?? null,
    contactId: meta?.contactId ?? null,
    subject,
    sentById: meta?.sentById ?? null,
    communicationSendId: meta?.communicationSendId ?? null,
  };

  if (useMockEmail()) {
    logger.info(`[mock email] to ${to} | subject: "${subject}"\n${body}`);
    await writeEmailLog({ ...logBase, status: "mock", providerMessageId: null, errorMessage: null });
    return;
  }
  const { data, error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to: [to],
    subject,
    text: body,
    html: `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(body)}</pre>`,
  });
  if (error) {
    await writeEmailLog({ ...logBase, status: "failed", providerMessageId: null, errorMessage: JSON.stringify(error) });
    throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
  }
  await writeEmailLog({ ...logBase, status: "sent", providerMessageId: data?.id ?? null, errorMessage: null });
}

/**
 * Send an HTML email to a contact. `fromEmail` is kept for mock-mode logging and
 * because callers pass it, but it is intentionally NOT mapped to a Reply-To header:
 * every email sends from (and replies to) the verified domain address (RESEND_FROM).
 * Setting Reply-To to a personal freemail address triggered a spam penalty
 * (FREEMAIL_FORGED_REPLYTO), and the domain has no monitored reply mailbox anyway.
 */
export async function sendRichEmail(input: { to: string; subject: string; html: string; fromEmail: string; fromName?: string | null; attachments?: Array<{ filename: string; content: Buffer | string }> }, meta?: EmailMeta): Promise<void> {
  const logBase = {
    tenantId: meta?.tenantId ?? null,
    type: meta?.type ?? "single",
    toEmail: input.to,
    toName: meta?.toName ?? null,
    contactId: meta?.contactId ?? null,
    subject: input.subject,
    sentById: meta?.sentById ?? null,
    communicationSendId: meta?.communicationSendId ?? null,
  };

  if (useMockEmail()) {
    const att = input.attachments && input.attachments.length ? ` | attachments: ${input.attachments.map((a) => a.filename).join(", ")}` : "";
    logger.info(`[mock email] from ${input.fromEmail} to ${input.to} | subject: "${input.subject}"${att}`);
    await writeEmailLog({ ...logBase, status: "mock", providerMessageId: null, errorMessage: null });
    return;
  }
  const { data, error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    ...(input.attachments && input.attachments.length ? { attachments: input.attachments } : {}),
  });
  if (error) {
    await writeEmailLog({ ...logBase, status: "failed", providerMessageId: null, errorMessage: JSON.stringify(error) });
    throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
  }
  await writeEmailLog({ ...logBase, status: "sent", providerMessageId: data?.id ?? null, errorMessage: null });
}
