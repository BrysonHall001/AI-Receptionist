import { prisma } from "../db/client";
import crypto from "crypto";
import { listFields } from "./fieldService";
import { isQuestionType, isMappingCompatible } from "./surveyTypes";

const db = prisma as any;

export interface QuestionInput {
  type: string;
  label: string;
  helpText?: string | null;
  required?: boolean;
  config?: any;
  mapFieldKey?: string | null;
}

function questionDto(q: any) {
  return {
    id: q.id,
    order: q.order,
    type: q.type,
    label: q.label,
    helpText: q.helpText ?? "",
    required: !!q.required,
    config: q.config ?? {},
    mapFieldKey: q.mapFieldKey ?? null,
  };
}

async function resolveCreatorNames(ids: Array<string | null | undefined>): Promise<Record<string, string | null>> {
  const uniq = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (!uniq.length) return {};
  const users = await db.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } });
  const map: Record<string, string | null> = {};
  users.forEach((u: any) => { map[u.id] = u.name || u.email || null; });
  return map;
}

// The Surveys list: each survey with its question count + creator name.
export async function listSurveys(tenantId: string) {
  const rows = await db.survey.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { questions: true, responses: true } } },
  });
  const names = await resolveCreatorNames(rows.map((r: any) => r.createdById));
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    status: r.status,
    publicId: r.publicId,
    mapTargetType: r.mapTargetType,
    questionCount: r._count?.questions ?? 0,
    responseCount: r._count?.responses ?? 0,
    createdById: r.createdById ?? null,
    createdByName: r.createdById ? (names[r.createdById] ?? null) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

// One survey with its questions in order (for the builder's click-to-edit).
export async function getSurvey(tenantId: string, id: string) {
  const s = await db.survey.findFirst({ where: { id, tenantId }, include: { questions: { orderBy: { order: "asc" } } } });
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? "",
    status: s.status,
    publicId: s.publicId,
    mapTargetType: s.mapTargetType,
    questions: (s.questions || []).map(questionDto),
  };
}

// Validate questions: known type, has a label, and any mapFieldKey is a real field of
// the target type whose field-type is compatible with the question type. Returns a
// normalized question list or throws a user-facing Error.
async function validateQuestions(tenantId: string, mapTargetType: string, questions: QuestionInput[]): Promise<QuestionInput[]> {
  const fields = await listFields(tenantId, mapTargetType || "contact");
  const fieldByKey: Record<string, any> = {};
  (fields || []).forEach((f: any) => { fieldByKey[f.key] = f; });

  return (questions || []).map((q, i) => {
    const where = `Question ${i + 1}`;
    if (!isQuestionType(q.type)) throw new Error(`${where}: unknown question type "${q.type}".`);
    const label = String(q.label || "").trim();
    if (!label) throw new Error(`${where}: a question label is required.`);
    let mapFieldKey: string | null = q.mapFieldKey ? String(q.mapFieldKey) : null;
    if (mapFieldKey) {
      const f = fieldByKey[mapFieldKey];
      if (!f) throw new Error(`${where}: mapped field "${mapFieldKey}" doesn't exist for ${mapTargetType || "contact"}.`);
      if (!isMappingCompatible(q.type, f.type)) throw new Error(`${where}: field "${f.label}" (${f.type}) isn't compatible with a ${q.type} question.`);
    }
    return {
      type: q.type,
      label,
      helpText: q.helpText ? String(q.helpText) : null,
      required: !!q.required,
      config: q.config && typeof q.config === "object" ? q.config : {},
      mapFieldKey,
    };
  });
}

// Create or update a survey + replace its questions (stored in given order). Editing
// updates the SAME survey row (bound to id) — never duplicates. Tenant-scoped.
export async function upsertSurvey(input: {
  tenantId: string;
  id?: string | null;
  name: string;
  description?: string | null;
  status?: string;
  mapTargetType?: string;
  questions?: QuestionInput[];
  createdById?: string | null;
}): Promise<{ id: string }> {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("A survey name is required.");
  const mapTargetType = input.mapTargetType || "contact";
  const status = ["draft", "active", "closed"].includes(input.status || "") ? (input.status as string) : "draft";
  const questions = await validateQuestions(input.tenantId, mapTargetType, input.questions || []);

  const data = { name, description: input.description ? String(input.description) : null, status, mapTargetType };

  let surveyId = input.id || null;
  if (surveyId) {
    const existing = await db.survey.findFirst({ where: { id: surveyId, tenantId: input.tenantId } });
    if (!existing) surveyId = null;
  }

  if (surveyId) {
    await db.survey.update({ where: { id: surveyId }, data });
    await db.surveyQuestion.deleteMany({ where: { surveyId } });
  } else {
    const created = await db.survey.create({ data: { ...data, tenantId: input.tenantId, createdById: input.createdById ?? null, publicId: crypto.randomBytes(9).toString("hex") } });
    surveyId = created.id;
  }

  if (questions.length) {
    await db.surveyQuestion.createMany({
      data: questions.map((q, idx) => ({
        surveyId,
        order: idx,
        type: q.type,
        label: q.label,
        helpText: q.helpText ?? null,
        required: !!q.required,
        config: (q.config ?? {}) as any,
        mapFieldKey: q.mapFieldKey ?? null,
      })),
    });
  }
  return { id: surveyId as string };
}

export async function deleteSurvey(tenantId: string, id: string): Promise<boolean> {
  const s = await db.survey.findFirst({ where: { id, tenantId } });
  if (!s) return false;
  await db.survey.delete({ where: { id } }); // cascades to questions (+ any responses)
  return true;
}

// Lightweight status toggle (activate / close / reopen) that does NOT touch questions
// or responses. Closing only stops new submissions; existing responses are retained.
export async function setSurveyStatus(tenantId: string, id: string, status: string): Promise<{ id: string; status: string } | null> {
  if (!["draft", "active", "closed"].includes(status)) throw new Error("Invalid status.");
  const s = await db.survey.findFirst({ where: { id, tenantId } });
  if (!s) return null;
  const upd = await db.survey.update({ where: { id }, data: { status } });
  return { id: upd.id, status: upd.status };
}