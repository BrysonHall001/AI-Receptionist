import { prisma } from "../db/client";
import { sendRichEmail } from "./notificationService";
import { logger } from "../utils/logger";
import { resolveEmailableRecipients } from "./communicationService";
import { createRecipient } from "./surveyResponseService";
import { contactMergeResolver } from "./mergeTags";

const db = prisma as any;

// The merge token the sender drops into the email body; replaced PER recipient at send
// time with that recipient's unique tokenized survey URL.
export const SURVEY_LINK_TOKEN = "{{survey_link}}";

export function bodyHasLinkToken(html: string): boolean {
  return typeof html === "string" && html.includes(SURVEY_LINK_TOKEN);
}

// ----- Suppression seam (placeholder) -----
// The ONE place the future unsubscribe/suppression batch plugs in: filter the resolved
// recipients against a suppression list before fan-out. Today it passes everyone
// through unchanged. Do NOT add UI/model here — this is just the seam.
export const _suppression = { calls: 0 };
export function filterSuppressed<T extends { id: string; email: string }>(recipients: T[]): T[] {
  _suppression.calls++;
  // TODO(suppression batch): drop recipients on the tenant's unsubscribe/suppression list.
  return recipients;
}

function personalize(html: string, url: string): string {
  return String(html || "").split(SURVEY_LINK_TOKEN).join(url);
}
function surveyUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/survey.html?token=${encodeURIComponent(token)}`;
}

export interface BlastResult {
  id: string;
  recipientCount: number;
  sentCount: number;
  failCount: number;
  links?: Array<{ contactId: string; url: string }>; // returned for tests/inspection
}

// Send a survey to many contacts. Each recipient gets their OWN per-recipient tokenized
// link (Batch 2 mechanism) so responses tie back to the right contact and write to their
// fields. Reuses the email-blast outbound path (sendRichEmail) + records ONE
// CommunicationSend (channel "survey").
export async function sendSurveyBlast(input: {
  tenantId: string;
  surveyId: string;
  subject: string;
  html: string;
  contactIds: string[];
  excludeIds?: string[];
  fromEmail: string;
  fromName?: string | null;
  createdById?: string | null;
  origin: string;
}): Promise<BlastResult> {
  const survey = await db.survey.findFirst({ where: { id: input.surveyId, tenantId: input.tenantId } });
  if (!survey) throw new Error("Survey not found.");
  if (survey.status !== "active") throw new Error("Only active surveys can be sent. Activate the survey first.");
  if (!bodyHasLinkToken(input.html)) throw new Error("Your email doesn't include the survey link — add it before sending.");

  let recipients = await resolveEmailableRecipients(input.tenantId, input.contactIds, input.excludeIds || []);
  recipients = filterSuppressed(recipients); // <-- suppression checkpoint (see above)

  // Per-recipient merge tags (resolved AFTER the survey link so {{survey_link}} is
  // already substituted and never collapsed). Typed recipients don't exist here —
  // survey blasts are contact-only — so every recipient has a record to resolve from.
  const resolver = await contactMergeResolver(input.tenantId);
  const fullContacts = recipients.length
    ? await db.contact.findMany({ where: { tenantId: input.tenantId, id: { in: recipients.map((r) => r.id) } } })
    : [];
  const byId = new Map(fullContacts.map((c: any) => [c.id, c]));

  // Create the blast's CommunicationSend row FIRST so every per-recipient EmailLog row
  // can link back to it via communicationSendId. Counts + the recipient list are filled
  // in once the fan-out completes (below).
  const send = await db.communicationSend.create({
    data: {
      tenantId: input.tenantId,
      channel: "survey",
      surveyId: input.surveyId,
      subject: (input.subject || "").slice(0, 998),
      body: input.html || "", // store the template (with the {{survey_link}} token) for the record
      recipientCount: recipients.length,
      sentCount: 0,
      failCount: 0,
      recipients: [],
      createdById: input.createdById ?? null,
    },
  });

  let sentCount = 0;
  let failCount = 0;
  const links: Array<{ contactId: string; url: string }> = [];
  // Per-recipient log captured with the actual outcome, persisted on the row so the
  // Sent-log detail view can show WHO the survey blast went to (survey blasts are
  // contact-only, so contactId is always set and there are no typed addresses).
  const recipientLog: Array<{ contactId: string | null; email: string; name: string | null; status: "sent" | "failed" }> = [];

  for (const r of recipients) {
    // One DISTINCT token per recipient → resolves SERVER-SIDE to THIS contact.
    const rec = await createRecipient(input.tenantId, input.surveyId, r.id);
    const url = rec ? surveyUrl(input.origin, rec.token) : input.origin;
    links.push({ contactId: r.id, url });
    const contact = byId.get(r.id) || null;
    try {
      await sendRichEmail({ to: r.email, subject: resolver.apply(input.subject, contact), html: resolver.apply(personalize(input.html, url), contact), fromEmail: input.fromEmail, fromName: input.fromName ?? null }, {
        type: "survey_blast",
        tenantId: input.tenantId,
        sentById: input.createdById ?? null,
        contactId: r.id,
        toName: r.name ?? null,
        communicationSendId: send.id,
      });
      sentCount++;
      recipientLog.push({ contactId: r.id, email: r.email, name: r.name ?? null, status: "sent" });
    } catch (e) {
      failCount++;
      recipientLog.push({ contactId: r.id, email: r.email, name: r.name ?? null, status: "failed" });
      logger.error(`[survey-blast] email to ${r.email} failed: ${(e as Error).message}`);
    }
  }

  // Backfill the final counts + recipient list now that the fan-out is done.
  await db.communicationSend.update({
    where: { id: send.id },
    data: { sentCount, failCount, recipients: recipientLog },
  });

  return { id: send.id, recipientCount: recipients.length, sentCount, failCount, links };
}

// Send ONE preview copy to the sender, using the survey's anonymous link as the sample
// (no recipient row, no CommunicationSend). Lets them eyeball the email before blasting.
export async function sendSurveyTest(input: {
  tenantId: string;
  surveyId: string;
  subject: string;
  html: string;
  toEmail: string;
  fromEmail: string;
  fromName?: string | null;
  origin: string;
  sampleName?: string | null;
}): Promise<{ sent: boolean }> {
  const survey = await db.survey.findFirst({ where: { id: input.surveyId, tenantId: input.tenantId } });
  if (!survey) throw new Error("Survey not found.");
  const sampleUrl = `${input.origin.replace(/\/+$/, "")}/survey.html?s=${encodeURIComponent(survey.publicId)}`;
  // Preview personalization: resolve merge tags against a SAMPLE (the current user) so
  // the sender sees real values, not raw {{tokens}}. Survey link substituted first.
  const resolver = await contactMergeResolver(input.tenantId);
  const sample = { name: input.sampleName || "", email: input.toEmail };
  const html = resolver.apply(personalize(input.html, sampleUrl), sample);
  const subject = `[Test] ${resolver.apply(input.subject, sample)}`;
  await sendRichEmail({ to: input.toEmail, subject, html, fromEmail: input.fromEmail, fromName: input.fromName ?? null }, {
    // A preview to the sender: no CommunicationSend row, no contact, no known user id.
    type: "survey_blast",
    tenantId: input.tenantId,
    toName: input.sampleName ?? null,
  });
  return { sent: true };
}
