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
import { resolveRecordTypeId, WORK_ORDER_RECORD_TYPE_KEY } from "./recordTypeService";
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
