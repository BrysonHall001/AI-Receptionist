import { prisma } from "../db/client";
import { sendRichEmail } from "./notificationService";
import { logger } from "../utils/logger";
import { resolveEmailableRecipients } from "./communicationService";
import { createRecipient } from "./surveyResponseService";

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

  let sentCount = 0;
  let failCount = 0;
  const links: Array<{ contactId: string; url: string }> = [];

  for (const r of recipients) {
    // One DISTINCT token per recipient → resolves SERVER-SIDE to THIS contact.
    const rec = await createRecipient(input.tenantId, input.surveyId, r.id);
    const url = rec ? surveyUrl(input.origin, rec.token) : input.origin;
    links.push({ contactId: r.id, url });
    try {
      await sendRichEmail({ to: r.email, subject: input.subject, html: personalize(input.html, url), fromEmail: input.fromEmail, fromName: input.fromName ?? null });
      sentCount++;
    } catch (e) {
      failCount++;
      logger.error(`[survey-blast] email to ${r.email} failed: ${(e as Error).message}`);
    }
  }

  const rec = await db.communicationSend.create({
    data: {
      tenantId: input.tenantId,
      channel: "survey",
      surveyId: input.surveyId,
      subject: (input.subject || "").slice(0, 998),
      body: input.html || "", // store the template (with the {{survey_link}} token) for the record
      recipientCount: recipients.length,
      sentCount,
      failCount,
      createdById: input.createdById ?? null,
    },
  });

  return { id: rec.id, recipientCount: recipients.length, sentCount, failCount, links };
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
}): Promise<{ sent: boolean }> {
  const survey = await db.survey.findFirst({ where: { id: input.surveyId, tenantId: input.tenantId } });
  if (!survey) throw new Error("Survey not found.");
  const sampleUrl = `${input.origin.replace(/\/+$/, "")}/survey.html?s=${encodeURIComponent(survey.publicId)}`;
  const html = personalize(input.html, sampleUrl);
  await sendRichEmail({ to: input.toEmail, subject: `[Test] ${input.subject}`, html, fromEmail: input.fromEmail, fromName: input.fromName ?? null });
  return { sent: true };
}
