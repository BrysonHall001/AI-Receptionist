import { prisma } from "../db/client";
import crypto from "crypto";
import { listFields, SYSTEM_KEYS } from "./fieldService";
import { updateContact } from "./contactService";
import { coerceCustomValue } from "./recordService";

const db = prisma as any;

// ----- internal: full survey (incl. mapFieldKey — server-only) -----
async function getFullSurvey(surveyId: string) {
  const s = await db.survey.findUnique({ where: { id: surveyId }, include: { questions: { orderBy: { order: "asc" } } } });
  return s || null;
}

export interface SurveyContext {
  survey: any;
  tenantId: string;
  contact: any | null;
  recipient: any | null;
}

// Resolve a link to its tenant (+ contact, for per-recipient links) SERVER-SIDE. The
// contactId is taken ONLY from the stored recipient row — never from the request.
export async function resolveContext(input: { token?: string | null; publicId?: string | null }): Promise<SurveyContext | null> {
  const token = input.token ? String(input.token) : "";
  const publicId = input.publicId ? String(input.publicId) : "";
  if (token) {
    const r = await db.surveyRecipient.findUnique({ where: { token } });
    if (!r) return null;
    const survey = await getFullSurvey(r.surveyId);
    if (!survey) return null;
    let contact: any = null;
    if (r.contactId) contact = await db.contact.findFirst({ where: { id: r.contactId, tenantId: r.tenantId } });
    return { survey, tenantId: r.tenantId, contact, recipient: r };
  }
  if (publicId) {
    const head = await db.survey.findUnique({ where: { publicId } });
    if (!head) return null;
    const survey = await getFullSurvey(head.id);
    return { survey, tenantId: head.tenantId, contact: null, recipient: null };
  }
  return null;
}

// PUBLIC payload — ONLY the survey's own questions. No mapping, no tenant/contact data.
export function publicPayload(ctx: SurveyContext) {
  const s = ctx.survey;
  return {
    name: s.name,
    description: s.description ?? "",
    status: s.status,
    available: s.status === "active",
    questions: (s.questions || []).map((q: any) => ({
      id: q.id, type: q.type, label: q.label, helpText: q.helpText ?? "", required: !!q.required, config: q.config ?? {},
    })),
  };
}

function isEmpty(v: any): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

// Validate one answer against its question type/config. Returns {empty} when optional
// and blank, {error} when invalid, {} when valid.
function validateAnswer(q: any, v: any): { empty?: boolean; error?: string } {
  if (isEmpty(v)) return q.required ? { error: `"${q.label}" is required.` } : { empty: true };
  const cfg = q.config || {};
  switch (q.type) {
    case "short_text": case "long_text":
      if (typeof v !== "string") return { error: `"${q.label}": expected text.` };
      break;
    case "single_select": {
      const opts = Array.isArray(cfg.options) ? cfg.options : [];
      if (!opts.includes(v)) return { error: `"${q.label}": choose one of the listed options.` };
      break;
    }
    case "multi_select": {
      const opts = Array.isArray(cfg.options) ? cfg.options : [];
      if (!Array.isArray(v) || !v.every((x) => opts.includes(x))) return { error: `"${q.label}": invalid selection.` };
      break;
    }
    case "rating": {
      const n = Number(v); const min = cfg.min ?? 1; const max = cfg.max ?? 5;
      if (!isFinite(n) || n < min || n > max) return { error: `"${q.label}": rating must be between ${min} and ${max}.` };
      break;
    }
    case "nps": {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10) return { error: `"${q.label}": must be a whole number 0–10.` };
      break;
    }
    case "yes_no":
      if (typeof v !== "boolean" && !["yes", "no", "true", "false"].includes(String(v).toLowerCase())) return { error: `"${q.label}": answer Yes or No.` };
      break;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || isNaN(Date.parse(String(v)))) return { error: `"${q.label}": enter a valid date.` };
      break;
    default:
      return { error: `"${q.label}": unsupported question type.` };
  }
  return {};
}

// Normalize a valid answer to its canonical stored form.
function normalizeAnswer(q: any, v: any): any {
  if (q.type === "yes_no") return typeof v === "boolean" ? v : ["yes", "true"].includes(String(v).toLowerCase());
  if (q.type === "rating" || q.type === "nps") return Number(v);
  if (q.type === "date") return String(v).slice(0, 10);
  if (q.type === "multi_select") return Array.isArray(v) ? v : [];
  return v;
}

// Write mapped answers onto the contact via the EXISTING field-write path. Each value
// is coerced to the field's type with the SAME coercer the import/record system uses.
// A value that can't coerce is skipped + reported — never crashes, never loses the row.
async function writeMappedAnswers(tenantId: string, contactId: string, survey: any, answersByQid: Record<string, any>): Promise<Array<{ questionId: string; key: string; reason: string }>> {
  const fields = await listFields(tenantId, survey.mapTargetType || "contact");
  const defByKey: Record<string, any> = {};
  (fields || []).forEach((f: any) => { defByKey[f.key] = f; });

  const sys: Record<string, any> = {};
  const custom: Record<string, any> = {};
  const skipped: Array<{ questionId: string; key: string; reason: string }> = [];

  for (const q of survey.questions || []) {
    if (!q.mapFieldKey) continue;                       // unmapped → write nothing
    if (!(q.id in answersByQid)) continue;              // unanswered → nothing to write
    const def = defByKey[q.mapFieldKey];
    if (!def) { skipped.push({ questionId: q.id, key: q.mapFieldKey, reason: "mapped field no longer exists" }); continue; }
    const c = coerceCustomValue(def, answersByQid[q.id]);
    if (c.empty) continue;
    if (c.error) { skipped.push({ questionId: q.id, key: q.mapFieldKey, reason: c.error }); continue; }
    if (SYSTEM_KEYS.includes(def.key)) sys[def.key] = c.value;
    else custom[def.key] = c.value;
  }

  if (Object.keys(sys).length || Object.keys(custom).length) {
    await updateContact(contactId, tenantId, { ...sys, customFields: custom });
  }
  return skipped;
}

export interface SubmitResult {
  ok: boolean;
  code?: "unavailable" | "inactive" | "invalid";
  message?: string;
  responseId?: string;
  duplicate?: boolean;
  wroteToContact?: boolean;
  skipped?: Array<{ questionId: string; key: string; reason: string }>;
}

// The public submission path. Re-resolves identity server-side, validates, ALWAYS
// stores the response, then writes mapped answers only for a known contact.
export async function submitSurvey(input: { token?: string | null; publicId?: string | null; answers?: Record<string, any> }): Promise<SubmitResult> {
  const ctx = await resolveContext({ token: input.token, publicId: input.publicId });
  if (!ctx) return { ok: false, code: "unavailable", message: "This survey isn't available." };
  const { survey, tenantId, contact, recipient } = ctx;
  if (survey.status !== "active") return { ok: false, code: "inactive", message: "This survey isn't accepting responses right now." };

  const answers = input.answers || {};
  const answersByQid: Record<string, any> = {};
  for (const q of survey.questions || []) {
    const v = answers[q.id];
    const r = validateAnswer(q, v);
    if (r.error) return { ok: false, code: "invalid", message: r.error };
    if (!r.empty) answersByQid[q.id] = normalizeAnswer(q, v);
  }

  // Idempotency for per-recipient links: at most one response per recipient.
  if (recipient) {
    const existing = await db.surveyResponse.findFirst({ where: { recipientId: recipient.id } });
    if (existing) return { ok: true, responseId: existing.id, duplicate: true, wroteToContact: !!contact };
  }

  let response: any;
  try {
    response = await db.surveyResponse.create({
      data: {
        surveyId: survey.id,
        tenantId,
        contactId: contact ? contact.id : null,        // NEVER from the request body
        recipientId: recipient ? recipient.id : null,
        raw: answersByQid,
        answers: { create: (survey.questions || []).filter((q: any) => q.id in answersByQid).map((q: any) => ({ questionId: q.id, value: answersByQid[q.id] })) },
      },
    });
  } catch (e) {
    // Lost a race on the unique recipientId → a response already exists; return it.
    if (recipient) {
      const ex = await db.surveyResponse.findFirst({ where: { recipientId: recipient.id } });
      if (ex) return { ok: true, responseId: ex.id, duplicate: true, wroteToContact: !!contact };
    }
    throw e;
  }

  if (recipient && !recipient.respondedAt) {
    try { await db.surveyRecipient.update({ where: { id: recipient.id }, data: { respondedAt: new Date() } }); } catch { /* cosmetic */ }
  }

  let skipped: Array<{ questionId: string; key: string; reason: string }> = [];
  if (contact) {
    // The response is already saved; a field-write problem must never lose it.
    try { skipped = await writeMappedAnswers(tenantId, contact.id, survey, answersByQid); }
    catch (e) { skipped = [{ questionId: "*", key: "*", reason: "field write failed: " + (e as Error).message }]; }
  }

  return { ok: true, responseId: response.id, wroteToContact: !!contact, skipped };
}

// Mint a per-recipient tokenized link for one contact (used for "copy a personal
// link" now; the blast batch mints these in bulk).
export async function createRecipient(tenantId: string, surveyId: string, contactId: string | null): Promise<{ id: string; token: string } | null> {
  const survey = await db.survey.findFirst({ where: { id: surveyId, tenantId } });
  if (!survey) return null;
  const token = crypto.randomBytes(32).toString("hex");
  const r = await db.surveyRecipient.create({ data: { surveyId, tenantId, contactId: contactId || null, token } });
  return { id: r.id, token: r.token };
}

// Minimal recent-responses view (who/when + answers), newest first.
export async function listResponses(tenantId: string, surveyId: string, limit = 200) {
  const survey = await db.survey.findFirst({ where: { id: surveyId, tenantId } });
  if (!survey) return null;
  const rows = await db.surveyResponse.findMany({
    where: { surveyId, tenantId },
    orderBy: { submittedAt: "desc" },
    take: limit,
    include: { answers: true },
  });
  const contactIds = Array.from(new Set(rows.map((r: any) => r.contactId).filter(Boolean))) as string[];
  const nameById: Record<string, string> = {};
  if (contactIds.length) {
    const contacts = await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true, email: true } });
    contacts.forEach((c: any) => { nameById[c.id] = c.name || c.email || "Contact"; });
  }
  return rows.map((r: any) => ({
    id: r.id,
    submittedAt: r.submittedAt.toISOString(),
    contactId: r.contactId ?? null,
    contactName: r.contactId ? (nameById[r.contactId] || "Contact") : "Anonymous",
    answers: (r.answers || []).map((a: any) => ({ questionId: a.questionId, value: a.value })),
  }));
}
