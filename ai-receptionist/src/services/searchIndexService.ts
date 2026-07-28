// GLOBAL SEARCH — the index side.
//
// One denormalized row per searchable entity, so every source answers through a
// single query path. Batch B adds SOURCES (automations, settings, reports) as
// more rows of the same shape, not as more query paths.
//
// THREE RULES this file exists to keep:
//   1. An index failure must NEVER break or delay the underlying write. Every
//      hook goes through indexSafely(), which swallows and logs.
//   2. A deleted or soft-deleted entity leaves the index immediately.
//   3. The index can drift (a missed hook, a crash mid-write), so a periodic
//      reconciliation sweep repairs it rather than trusting the hooks alone.
//
// The full-text column ("tsv") is GENERATED in Postgres from title+body, so no
// code here maintains it and it can never disagree with what it indexes.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";

const db = prisma as any;

export type SearchEntityType = "record" | "contact" | "call" | "automation" | "template" | "survey" | "dashboard";

/** Field types whose values are meaningless to search: bytes, references and
 *  derived values. Everything else contributes its text. */
const UNSEARCHABLE_FIELD_TYPES = new Set(["image", "file", "line_items", "formula"]);

/** Flatten a customFields bag into searchable text, skipping the types above. */
export function fieldValuesToText(customFields: any, defsByKey: Record<string, any> = {}): string {
  const bag = customFields && typeof customFields === "object" ? customFields : {};
  const parts: string[] = [];
  for (const key of Object.keys(bag)) {
    const def = defsByKey[key];
    if (def && UNSEARCHABLE_FIELD_TYPES.has(String(def.type))) continue;
    const v = bag[key];
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") { parts.push(String(v)); continue; }
    if (Array.isArray(v)) { parts.push(v.filter((x) => typeof x === "string" || typeof x === "number").join(" ")); continue; }
    if (typeof v === "object") {
      // address-shaped and similar small objects: take their string leaves
      parts.push(Object.values(v).filter((x) => typeof x === "string" || typeof x === "number").join(" "));
    }
  }
  return parts.join(" ").trim();
}

// AUTOMATION ACTION CONFIG — a WHITELIST, deliberately.
// `send_webhook` carries `url`, `headerName` and `headerValue`, and a bearer
// token or API key lives in exactly those. A blacklist would rot the moment a
// new action type appeared, so only keys known to hold HUMAN PROSE are read.
const AUTOMATION_TEXT_KEYS = new Set([
  "subject", "html", "body", "text", "title", "value", "values",
  "field", "fromStage", "toStage", "stage", "dest", "note", "message",
]);

/** Human-readable strings from an action list — never credentials. */
export function automationActionsToText(actions: any): string {
  if (!Array.isArray(actions)) return "";
  const parts: string[] = [];
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    if (typeof a.type === "string") parts.push(a.type.replace(/_/g, " "));
    const cfg = a.config && typeof a.config === "object" ? a.config : {};
    for (const k of Object.keys(cfg)) {
      if (!AUTOMATION_TEXT_KEYS.has(k)) continue;   // url / headerName / headerValue never qualify
      const v = cfg[k];
      if (typeof v === "string" || typeof v === "number") parts.push(String(v));
      else if (Array.isArray(v)) parts.push(v.filter((x) => typeof x === "string" || typeof x === "number").join(" "));
    }
  }
  // Strip markup so an HTML email body indexes as its words, not its tags.
  return parts.join(" ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000);
}

/** The turn array a call carries -> one searchable string. */
export function transcriptToText(transcript: any): string {
  if (!Array.isArray(transcript)) return "";
  return transcript
    .map((t: any) => (t && typeof t.text === "string" ? t.text : ""))
    .filter(Boolean)
    .join(" ")
    .slice(0, 20000);   // a very long call still indexes, but bounded
}

/** Never let indexing break the thing being indexed. */
async function indexSafely(what: string, fn: () => Promise<any>): Promise<void> {
  try { await fn(); }
  catch (err) { logger.error(`[search-index] ${what} failed: ${(err as Error).message}`); }
}

async function upsertRow(row: {
  tenantId: string; entityType: SearchEntityType; entityId: string;
  recordTypeId?: string | null; title: string; body: string; href: string; entityAt: Date;
}): Promise<void> {
  const data = {
    tenantId: row.tenantId,
    entityType: row.entityType,
    entityId: row.entityId,
    recordTypeId: row.recordTypeId ?? null,
    title: (row.title || "").slice(0, 500),
    body: (row.body || "").slice(0, 20000),
    href: row.href,
    entityAt: row.entityAt || new Date(),
  };
  await db.searchIndex.upsert({
    where: { entityType_entityId: { entityType: row.entityType, entityId: row.entityId } },
    create: data,
    update: data,
  });
}

/** Drop an entity from the index (delete, soft-delete, or "no longer eligible"). */
export async function removeFromIndex(entityType: SearchEntityType, entityId: string | string[]): Promise<void> {
  const ids = Array.isArray(entityId) ? entityId : [entityId];
  if (!ids.length) return;
  await indexSafely(`remove ${entityType}`, () => db.searchIndex.deleteMany({ where: { entityType, entityId: { in: ids } } }));
}

// ---------------------------------------------------------------------------
// Per-entity indexers. Each reads what it needs itself, so a caller only has to
// hand over an id — a write path can't accidentally index a stale shape.
// ---------------------------------------------------------------------------

export async function indexRecord(recordId: string): Promise<void> {
  await indexSafely(`record ${recordId}`, async () => {
    const r = await db.record.findUnique({ where: { id: recordId } });
    if (!r || r.deletedAt) { await db.searchIndex.deleteMany({ where: { entityType: "record", entityId: recordId } }); return; }
    const defs = await db.fieldDef.findMany({ where: { tenantId: r.tenantId, recordTypeId: r.recordTypeId }, select: { key: true, type: true } });
    const byKey: Record<string, any> = {};
    for (const d of defs) byKey[d.key] = d;
    // The app routes a record's own page at #/record/<id> (app.js:945) — NOT
    // under its module's list href. Getting this wrong would have sent every
    // result to a list page.
    const type = await db.recordType.findUnique({ where: { id: r.recordTypeId }, select: { key: true } });
    await upsertRow({
      tenantId: r.tenantId,
      entityType: "record",
      entityId: r.id,
      recordTypeId: r.recordTypeId,
      title: r.title || "(untitled)",
      body: [r.stageKey || "", r.subtypeKey || "", fieldValuesToText(r.customFields, byKey)].filter(Boolean).join(" "),
      href: `#/record/${r.id}`,
      entityAt: r.updatedAt || r.createdAt || new Date(),
    });
  });
}

export async function indexContact(contactId: string): Promise<void> {
  await indexSafely(`contact ${contactId}`, async () => {
    const c = await db.contact.findUnique({ where: { id: contactId } });
    if (!c || c.deletedAt) { await db.searchIndex.deleteMany({ where: { entityType: "contact", entityId: contactId } }); return; }
    const defs = await db.fieldDef.findMany({ where: { tenantId: c.tenantId, objectType: "contact" }, select: { key: true, type: true } }).catch(() => []);
    const byKey: Record<string, any> = {};
    for (const d of defs as any[]) byKey[d.key] = d;
    await upsertRow({
      tenantId: c.tenantId,
      entityType: "contact",
      entityId: c.id,
      title: c.name || c.email || c.phone || "(no name)",
      body: [c.email || "", c.phone || "", c.callerId || "", c.source || "", fieldValuesToText(c.customFields, byKey)].filter(Boolean).join(" "),
      href: `#/contact/${c.id}`,   // app.js:932
      entityAt: c.updatedAt || c.createdAt || new Date(),
    });
  });
}

export async function indexCall(callId: string): Promise<void> {
  await indexSafely(`call ${callId}`, async () => {
    const s = await db.callSession.findUnique({ where: { id: callId } });
    if (!s) { await db.searchIndex.deleteMany({ where: { entityType: "call", entityId: callId } }); return; }
    const ex = (s.extracted && typeof s.extracted === "object" ? s.extracted : {}) as any;
    const who = ex.name || s.fromNumber || "Unknown caller";
    await upsertRow({
      tenantId: s.tenantId,
      entityType: "call",
      entityId: s.id,
      title: `Call with ${who}`,
      body: [s.fromNumber || "", ex.name || "", ex.intent || "", ex.service || "", ex.email || "", transcriptToText(s.transcript)].filter(Boolean).join(" "),
      href: `#/calls?call=${s.id}`,
      entityAt: s.finalizedAt || s.createdAt || new Date(),
    });
  });
}

export async function indexAutomation(id: string): Promise<void> {
  await indexSafely(`automation ${id}`, async () => {
    const a = await db.automation.findUnique({ where: { id } });
    if (!a) { await db.searchIndex.deleteMany({ where: { entityType: "automation", entityId: id } }); return; }
    await upsertRow({
      tenantId: a.tenantId,
      entityType: "automation",
      entityId: a.id,
      title: a.name || "(untitled automation)",
      body: [String(a.triggerType || "").replace(/_/g, " "), a.enabled ? "enabled" : "draft off", automationActionsToText(a.actions)].filter(Boolean).join(" "),
      href: `#/automations?flow=${a.id}`,   // the batch-38 param: scrolls and flashes the card
      entityAt: a.updatedAt || a.createdAt || new Date(),
    });
  });
}

export async function indexTemplate(id: string): Promise<void> {
  await indexSafely(`template ${id}`, async () => {
    const t = await db.emailTemplate.findUnique({ where: { id } });
    if (!t) { await db.searchIndex.deleteMany({ where: { entityType: "template", entityId: id } }); return; }
    await upsertRow({
      tenantId: t.tenantId,
      entityType: "template",
      entityId: t.id,
      title: t.name || "(untitled template)",
      body: [t.kind || "", t.subject || "", String(t.body || "").replace(/<[^>]*>/g, " ")].filter(Boolean).join(" "),
      href: `#/communication?template=${t.id}`,
      entityAt: t.updatedAt || t.createdAt || new Date(),
    });
  });
}

export async function indexSurvey(id: string): Promise<void> {
  await indexSafely(`survey ${id}`, async () => {
    const sv = await db.survey.findUnique({ where: { id } });
    if (!sv) { await db.searchIndex.deleteMany({ where: { entityType: "survey", entityId: id } }); return; }
    const qs = await db.surveyQuestion.findMany({ where: { surveyId: sv.id }, select: { text: true } }).catch(() => []);
    await upsertRow({
      tenantId: sv.tenantId,
      entityType: "survey",
      entityId: sv.id,
      title: sv.name || "(untitled survey)",
      body: [sv.description || "", sv.status || "", (qs as any[]).map((q: any) => q.text).filter(Boolean).join(" ")].filter(Boolean).join(" "),
      href: `#/communication?survey=${sv.id}`,
      entityAt: sv.updatedAt || sv.createdAt || new Date(),
    });
  });
}

export async function indexDashboard(id: string): Promise<void> {
  await indexSafely(`dashboard ${id}`, async () => {
    const d = await db.dashboard.findUnique({ where: { id } });
    if (!d) { await db.searchIndex.deleteMany({ where: { entityType: "dashboard", entityId: id } }); return; }
    const widgets = Array.isArray(d.widgets) ? d.widgets : [];
    const widgetText = widgets
      .map((wgt: any) => [wgt && wgt.title, wgt && wgt.kind, wgt && wgt.metric].filter((x: any) => typeof x === "string").join(" "))
      .join(" ");
    await upsertRow({
      tenantId: d.tenantId,
      entityType: "dashboard",
      entityId: d.id,
      title: d.name || "(untitled dashboard)",
      body: ["dashboard", widgetText].filter(Boolean).join(" "),
      href: `#/reports?dashboard=${d.id}`,
      entityAt: d.updatedAt || d.createdAt || new Date(),
    });
  });
}

/** Re-index everything a record type owns — used when a field is deleted, since
 *  that changes what every record of that type contributes. */
export async function reindexRecordType(tenantId: string, recordTypeId: string): Promise<void> {
  await indexSafely(`record type ${recordTypeId}`, async () => {
    const rows = await db.record.findMany({ where: { tenantId, recordTypeId, deletedAt: null }, select: { id: true }, take: 5000 });
    for (const r of rows) await indexRecord(r.id);
  });
}

// ---------------------------------------------------------------------------
// Backfill + reconciliation
// ---------------------------------------------------------------------------

export interface BackfillResult { records: number; contacts: number; calls: number; automations: number; templates: number; surveys: number; dashboards: number }

/** Idempotent and batched: safe to run on a live database, safe to re-run. */
export async function backfillSearchIndex(tenantId?: string | null, batchSize = 200): Promise<BackfillResult> {
  const scope = tenantId ? { tenantId } : {};
  const out: BackfillResult = { records: 0, contacts: 0, calls: 0, automations: 0, templates: 0, surveys: 0, dashboards: 0 };
  for (;;) {
    const rows = await db.record.findMany({ where: { ...scope, deletedAt: null }, select: { id: true }, orderBy: { id: "asc" }, take: batchSize, skip: out.records });
    if (!rows.length) break;
    for (const r of rows) { await indexRecord(r.id); out.records += 1; }
    if (rows.length < batchSize) break;
  }
  for (;;) {
    const rows = await db.contact.findMany({ where: { ...scope, deletedAt: null }, select: { id: true }, orderBy: { id: "asc" }, take: batchSize, skip: out.contacts });
    if (!rows.length) break;
    for (const c of rows) { await indexContact(c.id); out.contacts += 1; }
    if (rows.length < batchSize) break;
  }
  for (;;) {
    const rows = await db.callSession.findMany({ where: { ...scope }, select: { id: true }, orderBy: { id: "asc" }, take: batchSize, skip: out.calls });
    if (!rows.length) break;
    for (const s of rows) { await indexCall(s.id); out.calls += 1; }
    if (rows.length < batchSize) break;
  }
  // the four sources added in Global Search B, same batched shape
  for (const [model, key, fn] of [
    ["automation", "automations", indexAutomation],
    ["emailTemplate", "templates", indexTemplate],
    ["survey", "surveys", indexSurvey],
    ["dashboard", "dashboards", indexDashboard],
  ] as any[]) {
    for (;;) {
      const rows = await db[model].findMany({ where: { ...scope }, select: { id: true }, orderBy: { id: "asc" }, take: batchSize, skip: (out as any)[key] }).catch(() => []);
      if (!rows.length) break;
      for (const r of rows) { await fn(r.id); (out as any)[key] += 1; }
      if (rows.length < batchSize) break;
    }
  }
  logger.info(`[search-index] backfill complete: ${out.records} records, ${out.contacts} contacts, ${out.calls} calls, ${out.automations} automations, ${out.templates} templates, ${out.surveys} surveys, ${out.dashboards} dashboards`);
  return out;
}

export interface ReconcileResult { repaired: number; orphansRemoved: number; added: number }

/**
 * THE SAFETY NET. Hooks can be missed — a new write path, a crash between the
 * entity write and the index write. This re-indexes anything whose entity is
 * newer than its index row, indexes anything missing, and drops rows whose
 * entity is gone. Cheap enough to run hourly.
 */
export async function reconcileSearchIndex(limit = 500): Promise<ReconcileResult> {
  const out: ReconcileResult = { repaired: 0, orphansRemoved: 0, added: 0 };
  // 1) stale or missing records/contacts/calls
  const [records, contacts, calls] = await Promise.all([
    db.record.findMany({ where: { deletedAt: null }, select: { id: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit }),
    db.contact.findMany({ where: { deletedAt: null }, select: { id: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit }),
    db.callSession.findMany({ select: { id: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: limit }),
  ]);
  const pairs: Array<[SearchEntityType, string, Date]> = [
    ...records.map((r: any) => ["record" as SearchEntityType, r.id, r.updatedAt]),
    ...contacts.map((c: any) => ["contact" as SearchEntityType, c.id, c.updatedAt]),
    ...calls.map((s: any) => ["call" as SearchEntityType, s.id, s.createdAt]),
  ];
  const indexed = await db.searchIndex.findMany({
    where: { OR: [{ entityType: "record" }, { entityType: "contact" }, { entityType: "call" }], entityId: { in: pairs.map((p) => p[1]) } },
    select: { entityType: true, entityId: true, updatedAt: true, title: true },
  });
  const byKey = new Map<string, any>();
  for (const row of indexed) byKey.set(`${row.entityType}:${row.entityId}`, row);
  for (const [type, id, at] of pairs) {
    const row = byKey.get(`${type}:${id}`);
    if (!row) {
      if (type === "record") await indexRecord(id); else if (type === "contact") await indexContact(id); else await indexCall(id);
      out.added += 1;
    } else if (at && row.updatedAt && new Date(at).getTime() > new Date(row.updatedAt).getTime() + 1000) {
      if (type === "record") await indexRecord(id); else if (type === "contact") await indexContact(id); else await indexCall(id);
      out.repaired += 1;
    }
  }
  // 2) ORPHANS — rows whose entity is gone or soft-deleted. Done as three set
  //    operations rather than a sampled row-by-row walk: sampling missed
  //    orphans once the index grew past the sample size.
  // the B sources: same freshness rule
  for (const [model, type, fn] of [
    ["automation", "automation", indexAutomation],
    ["emailTemplate", "template", indexTemplate],
    ["survey", "survey", indexSurvey],
    ["dashboard", "dashboard", indexDashboard],
  ] as any[]) {
    const live = await db[model].findMany({ select: { id: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit }).catch(() => []);
    if (!live.length) continue;
    const rows = await db.searchIndex.findMany({ where: { entityType: type, entityId: { in: live.map((x: any) => x.id) } }, select: { entityId: true, updatedAt: true } });
    const seen = new Map<string, any>();
    for (const r of rows) seen.set(r.entityId, r);
    for (const e of live) {
      const row = seen.get(e.id);
      if (!row) { await fn(e.id); out.added += 1; }
      else if (e.updatedAt && new Date(e.updatedAt).getTime() > new Date(row.updatedAt).getTime() + 1000) { await fn(e.id); out.repaired += 1; }
    }
  }
  const orphanSql = [
    `DELETE FROM "SearchIndex" si WHERE si."entityType" = 'record'
       AND NOT EXISTS (SELECT 1 FROM "Record" r WHERE r.id = si."entityId" AND r."deletedAt" IS NULL)`,
    `DELETE FROM "SearchIndex" si WHERE si."entityType" = 'contact'
       AND NOT EXISTS (SELECT 1 FROM "Contact" c WHERE c.id = si."entityId" AND c."deletedAt" IS NULL)`,
    `DELETE FROM "SearchIndex" si WHERE si."entityType" = 'call'
       AND NOT EXISTS (SELECT 1 FROM "CallSession" cs WHERE cs.id = si."entityId")`,
    `DELETE FROM "SearchIndex" si WHERE si."entityType" = 'automation'
       AND NOT EXISTS (SELECT 1 FROM "Automation" a WHERE a.id = si."entityId")`,
    `DELETE FROM "SearchIndex" si WHERE si."entityType" = 'template'
       AND NOT EXISTS (SELECT 1 FROM "EmailTemplate" t WHERE t.id = si."entityId")`,
    `DELETE FROM "SearchIndex" si WHERE si."entityType" = 'survey'
       AND NOT EXISTS (SELECT 1 FROM "Survey" sv WHERE sv.id = si."entityId")`,
    `DELETE FROM "SearchIndex" si WHERE si."entityType" = 'dashboard'
       AND NOT EXISTS (SELECT 1 FROM "Dashboard" d WHERE d.id = si."entityId")`,
  ];
  for (const sql of orphanSql) {
    try { out.orphansRemoved += await db.$executeRawUnsafe(sql); }
    catch (err) { logger.error(`[search-index] orphan sweep failed: ${(err as Error).message}`); }
  }
  if (out.repaired || out.added || out.orphansRemoved) {
    logger.info(`[search-index] reconciled: +${out.added} added, ${out.repaired} repaired, ${out.orphansRemoved} orphan(s) removed`);
  }
  return out;
}
