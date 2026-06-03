import { Resend } from "resend";
import { env, useMockEmail } from "../config/env";
import { logger } from "../utils/logger";
import { TranscriptTurn, summarize } from "../utils/transcript";
import { Extracted } from "../ai/schema";

const resend = new Resend(env.RESEND_API_KEY);

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
export async function sendCallSummaryEmail(input: CallSummaryEmailInput): Promise<void> {
  const name = input.extracted.name || "Unknown caller";
  const phone = input.extracted.phone || input.fromNumber || "Unknown";
  const intent = input.extracted.intent || "Not captured";
  const email = input.extracted.email || "Not provided";
  const when = input.startedAt.toLocaleString("en-US", { timeZoneName: "short" });
  const status = input.completed ? "Completed" : "Incomplete / missed";
  const transcriptText = summarize(input.transcript);

  const subject = `New call: ${name} — ${intent}`.slice(0, 120);

  // No real Resend key -> log the notification instead of sending.
  if (useMockEmail()) {
    logger.info(`[mock email] would notify ${input.to} | subject: "${subject}"`);
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

  const { error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to: [input.to],
    subject,
    text,
    html,
  });

  if (error) {
    throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
  }
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
export async function sendPlainEmail(to: string, subject: string, body: string): Promise<void> {
  if (useMockEmail()) {
    logger.info(`[mock email] to ${to} | subject: "${subject}"\n${body}`);
    return;
  }
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to: [to],
    subject,
    text: body,
    html: `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(body)}</pre>`,
  });
  if (error) throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
}
