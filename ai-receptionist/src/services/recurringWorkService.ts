// Recurring Work batch: the spawn sweep. When a work order that carries a
// repeatRule reaches the `completed` stage, spawn its successor EXACTLY ONCE:
// a fresh, DATELESS work order in `new_request` — it lands in the unscheduled
// tray for the dispatcher to place — carrying description, subtype, service
// address, the contact links, and the rule itself; NEVER photos, notes, the
// technician, or dates. `cancelled` ends the plan (nothing spawns; the rule
// simply dies with the record).
//
// EXACTLY-ONCE: Record.spawnedNextId is the claim. The sweep flips it from NULL
// to "pending" with a conditional updateMany (the reportScheduler atomic-claim
// pattern) BEFORE creating anything; the winner creates the successor and
// stores its real id, a loser (overlapping tick, re-run, crash-retry) sees a
// non-null claim and skips. A crash between claim and create leaves "pending",
// which the sweep repairs on a later pass (create-or-adopt below) — never a
// duplicate, never a lost plan.
//
// Rule-less records are excluded IN THE QUERY (repeatRule not null), so a
// non-recurring work order never even reaches this code — byte-identical.

import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { getAppSetting, setAppSetting } from "./appSettingService";
import { createRecord, addRecordNote } from "./recordService";
import { resolveRecordTypeId, WORK_ORDER_RECORD_TYPE_KEY, SERVICE_PLAN_RECORD_TYPE_KEY } from "./recordTypeService";
import { createLink, listLinksForRecord } from "./recordLinkService";
import { normalizeRepeatRule, nextOccurrence, describeRepeatRule } from "./recurrence";

const db = prisma as any;

const STATS_KEY = "recurringWork:stats";
export interface RecurringStats { spawned: number; skipped: number; lastRunAt: string | null; }
export async function getRecurringStats(): Promise<RecurringStats> {
  const raw = await getAppSetting(STATS_KEY);
  let s: any = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch { s = {}; }
  return { spawned: Number(s.spawned) || 0, skipped: Number(s.skipped) || 0, lastRunAt: s.lastRunAt || null };
}

const SWEEP_BATCH = 25;

/** Spawn the successor for ONE claimed record. Returns the successor id. */
async function spawnSuccessor(rec: any): Promise<string | null> {
  const rule = normalizeRepeatRule(rec.repeatRule);
  if (!rule) return null; // malformed rule fails safe: logged by caller, no spawn
  // The plan's end: anchor on the completed occurrence's own date (its
  // appointment day; a dateless one anchors on its creation day).
  const anchor = rec.appointmentAt ? new Date(rec.appointmentAt).toISOString().slice(0, 10) : new Date(rec.createdAt).toISOString().slice(0, 10);
  const nextDue = nextOccurrence(rule, anchor);
  if (!nextDue) return null; // until-date passed — the plan is over

  const cf = rec.customFields || {};
  const successor: any = await createRecord(rec.tenantId, WORK_ORDER_RECORD_TYPE_KEY, {
    title: rec.title || "Recurring work",
    subtypeKey: rec.subtypeKey || undefined,
    stageKey: "new_request",
    customFields: {
      // Carry-over exactly as approved: description + address (+ the plan
      // itself, so the chain continues). Photos / internal notes / tech / dates
      // deliberately do NOT carry.
      ...(cf.description ? { description: cf.description } : {}),
      ...(cf.service_address ? { service_address: cf.service_address } : {}),
      from_recurrence: rec.id,
      recurrence_due: nextDue, // the engine's answer, for the dispatcher's eyes (note + tray sort stay ordinary)
    },
    repeatRule: rule as any,
  } as any);

  // Contact links carry (role-preserved); the back-link marks lineage.
  const links = await listLinksForRecord(rec.tenantId, rec.id);
  for (const l of links || []) {
    if (l.parentType === "contact") {
      try { await createLink(rec.tenantId, { recordId: successor.id, parentType: "contact", parentId: l.parentId, role: l.role || null }); } catch { /* duplicate link = fine */ }
    }
  }
  await createLink(rec.tenantId, { recordId: successor.id, parentType: "record", parentId: rec.id, role: "recurrence_successor" });
  await addRecordNote(rec.tenantId, successor.id, `Spawned by the repeat plan (${describeRepeatRule(rule)}) — suggested date ${nextDue}.`, { type: "system", name: "Recurrence engine" } as any);
  return successor.id;
}

let sweeping = false;
/** Heartbeat entry point. Overlaps skip; errors contained per record. */
/**
 * SERVICE PLANS spawn on a SCHEDULE, not on completion.
 *
 * A work order's chain is driven by a completed occurrence handing over to the
 * next. A plan is an agreement: it owes a visit every N months from its start
 * date, whether or not anyone finished the last one. So plans get their own
 * candidate query inside THIS sweep — the same function, the same claim, and
 * the same createRecord/createLink spawn path as everything else. There is no
 * second scheduler and no parallel spawn code.
 *
 * EXACTLY ONCE: the occurrence date just spawned is written back to the plan
 * (`__last_spawned_for`). A later sweep computing the same date sees it and
 * stops, so a re-run cannot double-spawn a period.
 */
export function planDueDate(plan: any, today: string): { due: string | null; rule: any } {
  const cf = (plan && plan.customFields) || {};
  const every = Number(cf.visit_every_months);
  if (!isFinite(every) || every <= 0) return { due: null, rule: null };
  const rule = { every, unit: "months" as const };   // the engine’s own vocabulary
  const startRaw = String(cf.start_date || "").slice(0, 10);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? startRaw : new Date(plan.createdAt).toISOString().slice(0, 10);
  const last = String(cf.__last_spawned_for || "").slice(0, 10);
  // The first visit is the start date itself; after that, one interval on from
  // whatever was last spawned.
  let due: string | null = /^\d{4}-\d{2}-\d{2}$/.test(last) ? nextOccurrence(rule, last) : start;
  if (!due) return { due: null, rule };
  // Catch up rather than pile up: if several periods slipped by, the next one
  // owed is the one to create now, not one per missed period in a single pass.
  let guard = 0;
  while (due && due < today && guard < 240) {
    const ahead = nextOccurrence(rule, due);
    if (!ahead || ahead > today) break;
    due = ahead;
    guard += 1;
  }
  return { due, rule };
}

const CADENCE_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, Annually: 12 };

/**
 * Roll a passed renewal date forward by the billing cadence, keeping the plan
 * Active. "One-time" plans never roll — there is nothing to renew.
 */
export async function advanceRenewalIfDue(plan: any, today: string): Promise<string | null> {
  const cf = plan.customFields || {};
  const months = CADENCE_MONTHS[String(cf.billing_cadence || "")];
  if (!months) return null;
  let renewal = String(cf.renewal_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(renewal) || renewal >= today) return null;
  let guard = 0;
  while (renewal < today && guard < 400) {
    const next = nextOccurrence({ every: months, unit: "months" }, renewal);
    if (!next) break;
    renewal = next;
    guard += 1;
  }
  if (renewal === String(cf.renewal_date || "").slice(0, 10)) return null;
  await db.record.update({ where: { id: plan.id }, data: { customFields: { ...cf, renewal_date: renewal } } });
  plan.customFields = { ...cf, renewal_date: renewal };
  logger.info(`[service-plans] plan ${plan.id} renewal rolled forward to ${renewal}`);
  return renewal;
}

/** One plan, one visit. Returns the created work order's id, or null. */
async function spawnPlanVisit(plan: any, due: string): Promise<string | null> {
  const cf = plan.customFields || {};
  const planName = String(cf.plan_name || plan.title || "Service plan");
  // The visit is an ORDINARY work order: dateless, first status, so it lands in
  // the dispatch tray exactly like anything else. It deliberately carries NO
  // price, no cadence and no repeat rule — a covered visit must never become a
  // second source of recurrence.
  const woType = await db.recordType.findFirst({ where: { tenantId: plan.tenantId, key: WORK_ORDER_RECORD_TYPE_KEY }, select: { subtypes: true } });
  const subs = Array.isArray(woType && woType.subtypes) ? (woType!.subtypes as any[]) : [];
  const subtypeKey = (subs.find((x: any) => x && x.key === "maintenance") || subs[0] || {}).key || undefined;
  const visit: any = await createRecord(plan.tenantId, WORK_ORDER_RECORD_TYPE_KEY, {
    title: `${planName} — scheduled visit`,
    subtypeKey,
    stageKey: "new_request",
    customFields: {
      description: String(cf.coverage_summary || "").slice(0, 500) || `Covered visit under ${planName}.`,
      service_address: cf.service_address || undefined,
    },
  }, { source: "manual" });   // the same source the recurrence chain uses
  // The customer rides along, exactly as the work-order chain carries it.
  const contactLinks = await db.recordLink.findMany({ where: { tenantId: plan.tenantId, recordId: plan.id, parentType: "contact" } });
  for (const l of contactLinks) {
    try { await createLink(plan.tenantId, { recordId: visit.id, parentType: "contact", parentId: l.parentId, role: l.role || null }); } catch { /* duplicate link = fine */ }
  }
  // Back-link to the plan that owes this visit.
  await createLink(plan.tenantId, { recordId: visit.id, parentType: "record", parentId: plan.id, role: "plan_visit" });
  // Mark the period done BEFORE returning, so a crash re-runs at worst one spawn.
  await db.record.update({ where: { id: plan.id }, data: { customFields: { ...cf, __last_spawned_for: due } } });
  return visit.id;
}

/** Plans owed a visit today. Only ACTIVE ones — paused, cancelled and expired
 *  plans are excluded by the query itself, not by a later check. */
export async function runServicePlanSpawnSweep(today?: string): Promise<{ examined: number; spawned: number; skipped: number }> {
  const ymd = today || new Date().toISOString().slice(0, 10);
  let spawned = 0; let skipped = 0;
  const plans = await db.record.findMany({
    where: {
      deletedAt: null,
      stageKey: "active",
      recordType: { key: SERVICE_PLAN_RECORD_TYPE_KEY },
      tenant: { status: { not: "SUSPENDED" } },
    },
    take: SWEEP_BATCH,
  });
  for (const plan of plans) {
    try {
      // Renewal first: a passed date rolls forward on the cadence and the plan
      // stays Active. Its own try/catch, because a renewal that fails must
      // never cost the plan its visit.
      try {
        const rolled = await advanceRenewalIfDue(plan, ymd);
        if (rolled) plan.customFields = { ...(plan.customFields || {}), renewal_date: rolled };
      } catch (err) { logger.error(`[service-plans] renewal advance failed for ${plan.id}: ${(err as Error).message}`); }

      const { due } = planDueDate(plan, ymd);
      if (!due || due > ymd) { skipped++; continue; }
      const already = String((plan.customFields || {}).__last_spawned_for || "").slice(0, 10);
      if (already === due) { skipped++; continue; }   // exactly-once for this period
      const id = await spawnPlanVisit(plan, due);
      if (id) spawned++; else skipped++;
    } catch (err) {
      // ISOLATION: one bad plan never costs another plan or another tenant its
      // visit, and the failure is retried on the next sweep rather than lost.
      skipped++;
      logger.error(`[service-plans] spawn failed for plan ${plan.id}: ${(err as Error).message}`);
    }
  }
  if (spawned || skipped) logger.info(`[service-plans] examined ${plans.length}, spawned ${spawned}, skipped ${skipped}`);
  return { examined: plans.length, spawned, skipped };
}

export async function runRecurringSpawnSweep(): Promise<{ examined: number; spawned: number; skipped: number } | null> {
  if (sweeping) return null;
  sweeping = true;
  try {
    let spawned = 0;
    let skipped = 0;
    // Candidates: completed, rule-carrying, unclaimed OR stuck-in-pending
    // (crash repair). Tenant scoping is per-row (tenantId rides each record);
    // nothing here ever joins across tenants.
    const candidates = await db.record.findMany({
      where: {
        deletedAt: null,
        stageKey: "completed",
        repeatRule: { not: null as any },
        OR: [{ spawnedNextId: null }, { spawnedNextId: "pending" }],
        // SUSPENSION: no new work is spawned for a suspended tenant.
        tenant: { status: { not: "SUSPENDED" } },
      },
      take: SWEEP_BATCH,
      orderBy: { updatedAt: "asc" },
    });
    let woTypeIdByTenant: Record<string, string> = {};
    for (const rec of candidates) {
      try {
        // Only work orders participate today (the query can't express the type
        // key, so filter here — cheap, cached per tenant).
        if (!woTypeIdByTenant[rec.tenantId]) woTypeIdByTenant[rec.tenantId] = await resolveRecordTypeId(rec.tenantId, WORK_ORDER_RECORD_TYPE_KEY);
        if (rec.recordTypeId !== woTypeIdByTenant[rec.tenantId]) { continue; }

        if (rec.spawnedNextId === "pending") {
          // Crash repair: a previous pass claimed but may or may not have
          // created. Adopt an existing successor (back-link present) instead of
          // creating a second one.
          const back = await db.recordLink.findFirst({ where: { tenantId: rec.tenantId, parentType: "record", parentId: rec.id, role: "recurrence_successor" } });
          if (back) { await db.record.update({ where: { id: rec.id }, data: { spawnedNextId: back.recordId } }); skipped++; continue; }
        } else {
          // THE exactly-once claim.
          const claimed = await db.record.updateMany({ where: { id: rec.id, spawnedNextId: null }, data: { spawnedNextId: "pending" } });
          if (!claimed.count) { skipped++; continue; } // lost the race
        }

        const nextId = await spawnSuccessor(rec);
        if (nextId) {
          await db.record.update({ where: { id: rec.id }, data: { spawnedNextId: nextId } });
          spawned++;
        } else {
          // Plan over / malformed rule: mark done so it never re-candidates;
          // the record itself is untouched (fail-safe posture).
          await db.record.update({ where: { id: rec.id }, data: { spawnedNextId: "done" } });
          skipped++;
          if (!normalizeRepeatRule(rec.repeatRule)) logger.warn(`[recurring] malformed repeat rule on record ${rec.id} — no spawn (fail-safe)`);
        }
      } catch (e) {
        logger.error(`[recurring] spawn failed for record ${rec.id} (will retry next pass): ${(e as Error).message}`);
        // Leave the claim as-is; the pending-repair path retries safely.
      }
    }
    const stats = await getRecurringStats();
    await setAppSetting(STATS_KEY, JSON.stringify({ spawned: stats.spawned + spawned, skipped: stats.skipped + skipped, lastRunAt: new Date().toISOString() }));
    if (spawned) logger.info(`[recurring] spawned ${spawned} successor(s)`);
    return { examined: candidates.length, spawned, skipped };
  } finally {
    sweeping = false;
  }
}
