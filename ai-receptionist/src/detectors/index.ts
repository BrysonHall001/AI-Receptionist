// EMERGENT LAYER 2 — THE DETECTORS.
//
// SQL + counters over tables the app already fills. NO AI, NO LLM, no transcript
// mining. Each detector declares its evidence FLOOR and LOOKBACK and stays
// silent below them: a suggestion that looks like a guess is worse than none.
//
// Every detector is: { id, label, description, lookbackDays, run(tenant) ->
// findings[] }, where a finding already carries its dedupeKey, its card copy,
// and its proposed action. Creating the suggestion is the service's job
// (upsert semantics live there); detecting is this file's.
//
// The sweep iterates tenants with per-tenant AND per-detector failure
// isolation — one tenant's bad data can never abort the run — and reports
// counters to Health.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { upsertSuggestion } from "../services/suggestionService";

const db = prisma as any;

export interface Finding {
  dedupeKey: string;
  type: string;
  title: string;
  transparency: string;
  finding: any;
  proposedAction: { type: string; params?: any };
}
export interface DetectorDef {
  id: string;
  label: string;
  description: string;
  lookbackDays: number;
  floor: string;              // human-readable, shown in preferences
  run: (tenantId: string, now: Date) => Promise<Finding[]>;
}

const DAY = 86400000;

// ---------------------------------------------------------------- detector 1
// REPEATED FREE TEXT -> a field worth having.
//
// SOURCE, and why: records carry no notes column — their free text lives in
// customFields values. ActivityLog.summary is NOT mined: its rows are largely
// SYSTEM-authored (actorType defaults to "user" but automations/AI/system all
// write summaries in app vocabulary), so it would manufacture phrases out of
// our own words. We mine only values a human typed into a custom field, and
// filter app/system vocabulary on top.
const STOPWORDS = new Set(["the", "and", "for", "with", "was", "are", "this", "that", "from", "her", "his", "our", "you", "your", "not", "but", "has", "had", "have", "will", "can", "all", "any", "out", "who", "how", "new", "job", "call", "called", "email", "sent", "created", "updated", "status", "stage", "record", "contact", "booking", "invoice", "estimate", "automation", "system", "imported", "note", "added", "changed", "assigned", "scheduled", "completed", "cancelled"]);
const PHRASE_FLOOR = { records: 5, distinctDays: 3, lookbackDays: 30 };

function phrasesOf(text: string): string[] {
  const words = String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const out: string[] = [];
  for (let i = 0; i < words.length - 1; i++) out.push(`${words[i]} ${words[i + 1]}`);
  return out;
}

const repeatedPhraseField: DetectorDef = {
  id: "repeated_phrase_field",
  label: "Repeated wording",
  description: "Spots the same short phrase written into a module's text fields again and again, and offers to turn it into a proper field.",
  lookbackDays: PHRASE_FLOOR.lookbackDays,
  floor: `at least ${PHRASE_FLOOR.records} records across ${PHRASE_FLOOR.distinctDays} different days in ${PHRASE_FLOOR.lookbackDays} days`,
  run: async (tenantId, now) => {
    const since = new Date(now.getTime() - PHRASE_FLOOR.lookbackDays * DAY);
    const types = await db.recordType.findMany({ where: { tenantId }, select: { id: true, key: true, label: true, labelPlural: true } });
    const findings: Finding[] = [];
    for (const rt of types) {
      const rows = await db.record.findMany({
        where: { tenantId, recordTypeId: rt.id, deletedAt: null, createdAt: { gte: since } },
        select: { id: true, customFields: true, createdAt: true },
        take: 500,
      });
      if (rows.length < PHRASE_FLOOR.records) continue; // floor: thin data stays silent
      const seen = new Map<string, { records: Set<string>; days: Set<string> }>();
      for (const r of rows) {
        const cf = r.customFields && typeof r.customFields === "object" ? r.customFields : {};
        const text = Object.values(cf).filter((v: any) => typeof v === "string" && v.length > 3).join(" . ");
        const day = new Date(r.createdAt).toISOString().slice(0, 10);
        for (const p of new Set(phrasesOf(text))) {
          if (!seen.has(p)) seen.set(p, { records: new Set(), days: new Set() });
          seen.get(p)!.records.add(r.id);
          seen.get(p)!.days.add(day);
        }
      }
      const existingFields = await db.fieldDef.findMany({ where: { tenantId, recordTypeId: rt.id }, select: { label: true, key: true } });
      const qualifying = Array.from(seen.entries())
        .filter(([phrase, hit]) => {
          if (hit.records.size < PHRASE_FLOOR.records || hit.days.size < PHRASE_FLOOR.distinctDays) return false;
          const key = phrase.replace(/\s+/g, "_");
          return !existingFields.some((f: any) => f.key === key || String(f.label).toLowerCase() === phrase);
        })
        .sort((a2, b2) => (b2[1].records.size - a2[1].records.size) || (b2[0].length - a2[0].length));
      // At most ONE per module: overlapping bigrams from the same sentences are
      // one observation, not five.
      for (const [phrase, hit] of qualifying.slice(0, 1)) {
        const label = phrase.replace(/\b\w/g, (c) => c.toUpperCase());
        findings.push({
          dedupeKey: `phrase:${rt.key}:${phrase}`,
          type: "repeated_phrase_field",
          title: `Several ${rt.labelPlural || rt.label} mention “${phrase}” — add a field for it?`,
          transparency: `Based on ${hit.records.size} ${String(rt.labelPlural || rt.label).toLowerCase()} in the last ${PHRASE_FLOOR.lookbackDays} days`,
          finding: { phrase: phrase.slice(0, 40), records: hit.records.size, distinct_days: hit.days.size, window_days: PHRASE_FLOOR.lookbackDays, module: rt.key },
          proposedAction: { type: "create_field", params: { moduleKey: rt.key, label, type: "text", moduleLabel: rt.labelPlural || rt.label } },
        });
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------- detector 2
// A MANUAL STEP repeated after the same trigger -> offer the library recipe as
// a DISABLED draft. Floor raised per the owner's amendment: >=10 occurrences
// AND >=75% of qualifying records over 45 days.
const MSG_FLOOR = { occurrences: 10, ratio: 0.75, lookbackDays: 45 };

const manualMessagePattern: DetectorDef = {
  id: "manual_message_pattern",
  label: "Repeated manual step",
  description: "Notices when you message customers by hand after the same kind of event, and offers the matching recipe as a switched-off draft.",
  lookbackDays: MSG_FLOOR.lookbackDays,
  floor: `at least ${MSG_FLOOR.occurrences} times and ${Math.round(MSG_FLOOR.ratio * 100)}% of qualifying records in ${MSG_FLOOR.lookbackDays} days`,
  run: async (tenantId, now) => {
    const since = new Date(now.getTime() - MSG_FLOOR.lookbackDays * DAY);
    const wo = await db.recordType.findFirst({ where: { tenantId, key: "work_order" }, select: { id: true, labelPlural: true } });
    if (!wo) return [];
    const completed = await db.record.findMany({
      where: { tenantId, recordTypeId: wo.id, deletedAt: null, stageKey: "completed", updatedAt: { gte: since } },
      select: { id: true, updatedAt: true },
      take: 500,
    });
    if (completed.length < MSG_FLOOR.occurrences) return []; // floor
    // A HUMAN send close behind the completion (automation sends are excluded by
    // type — those are already automated, so they prove nothing).
    let followed = 0;
    for (const r of completed) {
      const hit = await db.emailLog.count({
        where: { tenantId, type: { notIn: ["automation"] }, createdAt: { gte: r.updatedAt, lte: new Date(new Date(r.updatedAt).getTime() + DAY) } },
      });
      if (hit > 0) followed += 1;
    }
    const ratio = completed.length ? followed / completed.length : 0;
    if (followed < MSG_FLOOR.occurrences || ratio < MSG_FLOOR.ratio) return [];
    return [{
      dedupeKey: "manual_after_completion:work_order",
      type: "manual_message_pattern",
      title: "You message customers by hand after most completed jobs — want a draft that does it?",
      transparency: `Based on ${followed} of ${completed.length} completed jobs in the last ${MSG_FLOOR.lookbackDays} days`,
      finding: { followed, qualifying: completed.length, ratio: Math.round(ratio * 100) / 100, window_days: MSG_FLOOR.lookbackDays },
      proposedAction: { type: "apply_preset_draft", params: { presetKey: "job_complete_request_review" } },
    }];
  },
};

// ---------------------------------------------------------------- detector 3
// UNUSED CONFIGURATION -> hide (never delete, always reversible).
// MODULES, not fields: FieldDef has no hide/archive column, so a field could
// only be DELETED — which this arc will not propose. Modules hide reversibly
// through the nav, so that is what we offer.
const UNUSED_FLOOR = { lookbackDays: 90, tenantAgeDays: 30, minTenantRecords: 20, maxPerRun: 3 };

const unusedModule: DetectorDef = {
  id: "unused_module",
  label: "Unused module",
  description: "Points out a module nothing has touched in three months, and offers to tuck it out of the way (reversible, never deleted).",
  lookbackDays: UNUSED_FLOOR.lookbackDays,
  floor: `no records at all in ${UNUSED_FLOOR.lookbackDays} days, in a workspace older than ${UNUSED_FLOOR.tenantAgeDays} days with at least ${UNUSED_FLOOR.minTenantRecords} records of its own`,
  run: async (tenantId, now) => {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { createdAt: true, labels: true } });
    if (!tenant) return [];
    if (now.getTime() - new Date(tenant.createdAt).getTime() < UNUSED_FLOOR.tenantAgeDays * DAY) return []; // too new to judge
    // A workspace that hasn't been used at all is not "unused modules" — it's a
    // new workspace. Only speak when the place is demonstrably in use.
    const totalRecords = await db.record.count({ where: { tenantId, deletedAt: null } });
    if (totalRecords < UNUSED_FLOOR.minTenantRecords) return [];
    const hidden: string[] = (((tenant.labels || {}) as any).nav || {}).hidden || [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { recordTypeHref } = require("../services/recordTypeService");
    const types = await db.recordType.findMany({ where: { tenantId }, select: { id: true, key: true, label: true, labelPlural: true } });
    const findings: Finding[] = [];
    for (const rt of types) {
      if (rt.key === "contact") continue; // Contacts is the spine; never proposed
      const href = recordTypeHref(rt.key);
      if (hidden.includes(href)) continue; // already tucked away
      const anyRecords = await db.record.count({ where: { tenantId, recordTypeId: rt.id, deletedAt: null } });
      if (anyRecords > 0) continue; // used at all -> silent
      findings.push({
        dedupeKey: `unused_module:${rt.key}`,
        type: "unused_module",
        title: `Nothing has used ${rt.labelPlural || rt.label} in ${UNUSED_FLOOR.lookbackDays} days — hide it?`,
        transparency: `Based on 0 ${String(rt.labelPlural || rt.label).toLowerCase()} in the last ${UNUSED_FLOOR.lookbackDays} days`,
        finding: { module: rt.key, records: 0, window_days: UNUSED_FLOOR.lookbackDays },
        proposedAction: { type: "hide_module", params: { href, moduleLabel: rt.labelPlural || rt.label } },
      });
    }
    // Cap: a few at a time, never a wall of cards.
    return findings.slice(0, UNUSED_FLOOR.maxPerRun);
  },
};

// ---------------------------------------------------------------- detector 4
// PIPELINE INSIGHT — informational only, no configuration change offered.
const STALL_FLOOR = { moduleRecords: 12, stageRecords: 5, lookbackDays: 60, multiple: 2 };

const stageStall: DetectorDef = {
  id: "stage_stall",
  label: "Pipeline insight",
  description: "Flags a status where work sits far longer than everywhere else, so you can see where things get stuck.",
  lookbackDays: STALL_FLOOR.lookbackDays,
  floor: `at least ${STALL_FLOOR.moduleRecords} records in the module and ${STALL_FLOOR.stageRecords} in the slow status`,
  run: async (tenantId, now) => {
    const since = new Date(now.getTime() - STALL_FLOOR.lookbackDays * DAY);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { recordTypeHref } = require("../services/recordTypeService");
    const types = await db.recordType.findMany({ where: { tenantId }, select: { id: true, key: true, label: true, labelPlural: true, recordStages: true } });
    const findings: Finding[] = [];
    for (const rt of types) {
      const stages: any[] = Array.isArray(rt.recordStages) ? rt.recordStages : [];
      if (stages.length < 2) continue;
      const rows = await db.record.findMany({
        where: { tenantId, recordTypeId: rt.id, deletedAt: null, createdAt: { gte: since }, stageKey: { not: null } },
        select: { stageKey: true, createdAt: true, updatedAt: true },
        take: 800,
      });
      if (rows.length < STALL_FLOOR.moduleRecords) continue; // floor
      const byStage = new Map<string, number[]>();
      for (const r of rows) {
        const ageDays = (now.getTime() - new Date(r.updatedAt).getTime()) / DAY;
        if (!byStage.has(r.stageKey)) byStage.set(r.stageKey, []);
        byStage.get(r.stageKey)!.push(ageDays);
      }
      const overall = rows.map((r: any) => (now.getTime() - new Date(r.updatedAt).getTime()) / DAY).sort((a: number, b: number) => a - b);
      const median = overall[Math.floor(overall.length / 2)] || 0;
      if (median <= 0) continue;
      for (const [stageKey, ages] of byStage) {
        if (ages.length < STALL_FLOOR.stageRecords) continue;
        const stageMedian = ages.sort((a, b) => a - b)[Math.floor(ages.length / 2)];
        if (stageMedian < median * STALL_FLOOR.multiple) continue;
        const stageLabel = (stages.find((s: any) => s.key === stageKey) || {}).label || stageKey;
        findings.push({
          dedupeKey: `stage_stall:${rt.key}:${stageKey}`,
          type: "stage_stall",
          title: `${rt.labelPlural || rt.label} sit in “${stageLabel}” about ${Math.round(stageMedian / Math.max(1, median))}× longer than anywhere else`,
          transparency: `Based on ${ages.length} of ${rows.length} ${String(rt.labelPlural || rt.label).toLowerCase()} in the last ${STALL_FLOOR.lookbackDays} days`,
          finding: { module: rt.key, stage: stageKey, stage_records: ages.length, module_records: rows.length, stage_median_days: Math.round(stageMedian), median_days: Math.round(median) },
          proposedAction: { type: "none", params: { link: recordTypeHref(rt.key) } },
        });
      }
    }
    return findings;
  },
};

export const DETECTORS: DetectorDef[] = [repeatedPhraseField, manualMessagePattern, unusedModule, stageStall];
export function getDetector(id: string): DetectorDef | null { return DETECTORS.find((d) => d.id === id) || null; }

// ------------------------------------------------------------------ the sweep
export interface SweepCounters { tenants: number; findings: number; created: number; revived: number; refreshed: number; suppressed: number; errors: number }
let lastSweep: { at: number; counters: SweepCounters } | null = null;
export function lastDetectorSweep(): { at: number; counters: SweepCounters } | null { return lastSweep; }

/** Nightly. Per-tenant AND per-detector isolation: a thrown detector is logged
 *  and the sweep carries on. Never touches a request path. */
export async function runDetectorSweep(now: Date = new Date(), onlyTenantId?: string | null): Promise<SweepCounters> {
  const c: SweepCounters = { tenants: 0, findings: 0, created: 0, revived: 0, refreshed: 0, suppressed: 0, errors: 0 };
  try {
    const tenants = onlyTenantId
      ? await db.tenant.findMany({ where: { id: onlyTenantId }, select: { id: true, suggestionPrefs: true } })
      : await db.tenant.findMany({ select: { id: true, suggestionPrefs: true }, take: 500 });
    for (const t of tenants) {
      c.tenants += 1;
      const prefs = (t.suggestionPrefs && typeof t.suggestionPrefs === "object" ? t.suggestionPrefs : {}) as any;
      if (prefs.enabled === false) continue; // master switch, per tenant
      for (const d of DETECTORS) {
        if (prefs[d.id] === false) continue; // per-detector switch
        try {
          const findings = await d.run(t.id, now);
          c.findings += findings.length;
          for (const f of findings) {
            const res = await upsertSuggestion({
              tenantId: t.id, type: f.type, dedupeKey: f.dedupeKey, finding: f.finding,
              proposedAction: f.proposedAction, title: f.title, transparency: f.transparency,
            }, now);
            if (res === "created") c.created += 1;
            else if (res === "revived") c.revived += 1;
            else if (res === "refreshed") c.refreshed += 1;
            else c.suppressed += 1;
          }
        } catch (err) {
          c.errors += 1;
          logger.error(`[detectors] ${d.id} failed for tenant ${t.id}: ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    c.errors += 1;
    logger.error(`[detectors] sweep failed: ${(err as Error).message}`);
  }
  lastSweep = { at: Date.now(), counters: c };
  try { require("../services/healthService").markDetectorSweep(c); } catch { /* health is a bystander */ }
  logger.info(`[detectors] swept ${c.tenants} tenant(s): ${c.findings} finding(s), ${c.created} new, ${c.revived} revived, ${c.refreshed} refreshed, ${c.suppressed} suppressed, ${c.errors} error(s)`);
  return c;
}
