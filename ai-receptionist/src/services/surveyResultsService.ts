import { prisma } from "../db/client";

const db = prisma as any;

function fmtValue(v: any): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (v === true) return "Yes";
  if (v === false) return "No";
  return String(v);
}

async function loadSurveyWithResponses(tenantId: string, surveyId: string) {
  const survey = await db.survey.findFirst({ where: { id: surveyId, tenantId }, include: { questions: { orderBy: { order: "asc" } } } });
  if (!survey) return null;
  const responses = await db.surveyResponse.findMany({
    where: { surveyId, tenantId },
    orderBy: { submittedAt: "desc" },
    include: { answers: true },
  });
  const contactIds = Array.from(new Set(responses.map((r: any) => r.contactId).filter(Boolean))) as string[];
  const nameById: Record<string, { name: string; email: string | null }> = {};
  if (contactIds.length) {
    const contacts = await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true, email: true } });
    contacts.forEach((c: any) => { nameById[c.id] = { name: c.name || c.email || "Contact", email: c.email ?? null }; });
  }
  return { survey, responses, nameById };
}

// Per-question + summary aggregation. Reads RESPONSE data (independent of field mapping).
export async function aggregateResults(tenantId: string, surveyId: string) {
  const loaded = await loadSurveyWithResponses(tenantId, surveyId);
  if (!loaded) return null;
  const { survey, responses, nameById } = loaded;

  const total = responses.length;
  const tied = responses.filter((r: any) => r.contactId).length;
  const anonymous = total - tied;
  const times = responses.map((r: any) => new Date(r.submittedAt).getTime());
  const firstAt = times.length ? new Date(Math.min(...times)).toISOString() : null;
  const lastAt = times.length ? new Date(Math.max(...times)).toISOString() : null;

  // If blasted: sum the survey CommunicationSend rows for a response rate.
  const sends = await db.communicationSend.findMany({ where: { tenantId, channel: "survey", surveyId } });
  const sent = sends.reduce((acc: number, s: any) => acc + (s.sentCount || 0), 0);
  const responseRate = sent > 0 ? Math.round((total / sent) * 100) : null;

  // value(s) per question id
  const valuesByQ: Record<string, any[]> = {};
  for (const r of responses) {
    for (const a of r.answers || []) {
      (valuesByQ[a.questionId] = valuesByQ[a.questionId] || []).push(a.value);
    }
  }

  const questions = (survey.questions || []).map((q: any) => {
    const vals = valuesByQ[q.id] || [];
    const answered = vals.length;
    const base: any = { id: q.id, label: q.label, type: q.type, answered };

    if (q.type === "single_select" || q.type === "yes_no") {
      const opts: string[] = q.type === "yes_no" ? ["Yes", "No"] : ((q.config && q.config.options) || []);
      const counts: Record<string, number> = {};
      vals.forEach((v) => { const key = v === true ? "Yes" : v === false ? "No" : String(v); counts[key] = (counts[key] || 0) + 1; });
      base.options = opts.map((o) => ({ value: o, count: counts[o] || 0, pct: answered ? Math.round(((counts[o] || 0) / answered) * 100) : 0 }));
      // include any unexpected values too
      Object.keys(counts).filter((k) => !opts.includes(k)).forEach((k) => base.options.push({ value: k, count: counts[k], pct: answered ? Math.round((counts[k] / answered) * 100) : 0 }));
    } else if (q.type === "multi_select") {
      const opts: string[] = (q.config && q.config.options) || [];
      const counts: Record<string, number> = {};
      vals.forEach((arr) => (Array.isArray(arr) ? arr : []).forEach((o: string) => { counts[o] = (counts[o] || 0) + 1; }));
      base.options = opts.map((o) => ({ value: o, count: counts[o] || 0, pct: answered ? Math.round(((counts[o] || 0) / answered) * 100) : 0 }));
    } else if (q.type === "rating") {
      const nums = vals.map((v) => Number(v)).filter((n) => isFinite(n));
      const sum = nums.reduce((a, b) => a + b, 0);
      base.average = nums.length ? Math.round((sum / nums.length) * 100) / 100 : 0;
      const dist: Record<string, number> = {};
      nums.forEach((n) => { dist[n] = (dist[n] || 0) + 1; });
      base.distribution = Object.keys(dist).map((k) => ({ value: Number(k), count: dist[k] })).sort((a, b) => a.value - b.value);
    } else if (q.type === "nps") {
      const nums = vals.map((v) => Number(v)).filter((n) => isFinite(n));
      const promoters = nums.filter((n) => n >= 9).length;
      const passives = nums.filter((n) => n >= 7 && n <= 8).length;
      const detractors = nums.filter((n) => n <= 6).length;
      const n = nums.length;
      base.promoters = promoters; base.passives = passives; base.detractors = detractors;
      base.average = n ? Math.round((nums.reduce((a, b) => a + b, 0) / n) * 100) / 100 : 0;
      base.score = n ? Math.round((promoters / n) * 100) - Math.round((detractors / n) * 100) : 0;
      const dist: Record<string, number> = {};
      nums.forEach((x) => { dist[x] = (dist[x] || 0) + 1; });
      base.distribution = []; for (let i = 0; i <= 10; i++) base.distribution.push({ value: i, count: dist[i] || 0 });
    } else if (q.type === "short_text" || q.type === "long_text") {
      base.texts = [];
    } else if (q.type === "date") {
      base.dates = [];
    }
    return base;
  });

  // text/date lists need the respondent name — walk responses in order
  for (const r of responses) {
    const who = r.contactId ? (nameById[r.contactId]?.name || "Contact") : "Anonymous";
    for (const a of r.answers || []) {
      const q = questions.find((x: any) => x.id === a.questionId);
      if (!q) continue;
      if (q.type === "short_text" || q.type === "long_text") q.texts.push({ contactName: who, value: fmtValue(a.value) });
      else if (q.type === "date") q.dates.push({ contactName: who, value: fmtValue(a.value) });
    }
  }

  return {
    surveyId: survey.id, name: survey.name, status: survey.status,
    total, tied, anonymous, firstAt, lastAt, sent, responseRate, questions,
  };
}

// Flatten responses for export: one row per response, one column per question (plus
// respondent contact name/email, submittedAt, anonymous). Feeds the SAME client export
// modal (CSV/xlsx + ExportRecord history) used everywhere else.
export async function getResponseExport(tenantId: string, surveyId: string) {
  const loaded = await loadSurveyWithResponses(tenantId, surveyId);
  if (!loaded) return null;
  const { survey, responses, nameById } = loaded;

  const columns = [
    { key: "submittedAt", label: "Submitted at" },
    { key: "contact", label: "Contact" },
    { key: "email", label: "Email" },
    { key: "anonymous", label: "Anonymous" },
    ...survey.questions.map((q: any) => ({ key: "q_" + q.id, label: q.label })),
  ];

  const rows = responses.map((r: any) => {
    const tiedInfo = r.contactId ? nameById[r.contactId] : null;
    const byQ: Record<string, any> = {};
    (r.answers || []).forEach((a: any) => { byQ[a.questionId] = a.value; });
    const row: Record<string, string> = {
      submittedAt: new Date(r.submittedAt).toISOString(),
      contact: tiedInfo ? tiedInfo.name : "Anonymous",
      email: tiedInfo ? (tiedInfo.email || "") : "",
      anonymous: r.contactId ? "No" : "Yes",
    };
    survey.questions.forEach((q: any) => { row["q_" + q.id] = fmtValue(byQ[q.id]); });
    return row;
  });

  return { name: survey.name, columns, rows };
}
