// MULTI-VISIT WORK ORDERS — the ONE home for every visit write (multivisit-
// cardfix batch). Rules of the house:
//   * work_order records only; every mutation validates tenant + record type.
//   * EVERY write runs in a transaction that also recomputes THE MIRROR — the
//     Record's typed appointmentAt/endAt/resourceId columns reflect the ACTIVE
//     visit (earliest upcoming scheduled; else the most recent past scheduled;
//     else nulls) — so unupgraded consumers (reminders, merge tags, recurring
//     anchors, lists, the AI's prompt context) keep reading truth, and a
//     one-visit job stays byte-identical to the pre-batch world.
//   * The ONLY other writer of these typed columns is recordService itself
//     (the legacy guarded path, which now SYNCS the active visit in its own
//     transaction) — asserted at grep level by the self-test.
//   * No scheduling guards are added here: work-order scheduling has never run
//     the booking closed/overlap guards (recordService gates them on
//     rt.key === "booking"), and the compatibility law forbids changing that.
import { prisma } from "../db/client";
import { emitEvent } from "../events/bus";
import { EventActor } from "../events/types";
import { WORK_ORDER_RECORD_TYPE_KEY } from "./recordTypeService";

const db = prisma as any;

export interface VisitDTO {
  id: string;
  recordId: string;
  ordinal: number;
  startAt: string | null;
  endAt: string | null;
  resourceId: string | null;
  state: string;
  createdAt: string;
}

function toDTO(v: any): VisitDTO {
  return {
    id: v.id, recordId: v.recordId, ordinal: v.ordinal,
    startAt: v.startAt ? new Date(v.startAt).toISOString() : null,
    endAt: v.endAt ? new Date(v.endAt).toISOString() : null,
    resourceId: v.resourceId ?? null, state: v.state,
    createdAt: new Date(v.createdAt).toISOString(),
  };
}

/** THE MIRROR RULE (R1-approved): among scheduled visits, the earliest whose
 *  start is now-or-later; else the latest already-started; else null columns
 *  (exactly today's dateless shape). Exported for the suite's oracle. */
export function activeVisitOf(visits: any[], now: Date = new Date()): any | null {
  const sched = (visits || []).filter((v) => v.state === "scheduled" && v.startAt != null);
  if (!sched.length) return null;
  const upcoming = sched.filter((v) => new Date(v.startAt).getTime() >= now.getTime()).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  if (upcoming.length) return upcoming[0];
  return sched.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())[0];
}

/** SERIALIZE visit writes per job: two landing at once would each compute the
 *  mirror from their own snapshot and the later-committing one could store a
 *  staler value. Taken FIRST in every mutating transaction (before the visit
 *  write, so lock order is uniform) and as FOR NO KEY UPDATE — compatible with
 *  the FK's KEY SHARE lock, so writers queue instead of deadlocking. Different
 *  jobs never contend. */
export async function lockRecordTx(tx: any, recordId: string): Promise<void> {
  await tx.$executeRaw`SELECT "id" FROM "Record" WHERE "id" = ${recordId} FOR NO KEY UPDATE`;
}

async function assertWorkOrder(tenantId: string, recordId: string): Promise<any> {
  if (!recordId || typeof recordId !== "string") throw new Error("Record not found."); // undefined must NEVER wildcard-match
  const rec = await db.record.findFirst({ where: { id: recordId, tenantId }, include: { recordType: { select: { key: true } } } });
  if (!rec) throw new Error("Record not found.");
  if (rec.recordType.key !== WORK_ORDER_RECORD_TYPE_KEY) throw new Error("Visits belong to work orders only.");
  return rec;
}

/** Recompute + write the mirror INSIDE the caller's transaction. */
export async function recomputeMirrorTx(tx: any, tenantId: string, recordId: string): Promise<void> {
  const visits = await tx.workOrderVisit.findMany({ where: { tenantId, recordId } });
  const active = activeVisitOf(visits);
  await tx.record.update({
    where: { id: recordId },
    data: {
      appointmentAt: active ? active.startAt : null,
      endAt: active ? active.endAt : null,
      resourceId: active ? active.resourceId : null,
    },
  });
}

/** recordService's seam: keep the ACTIVE visit in step after the LEGACY guarded
 *  path wrote the typed columns itself (same tx). One visit -> that visit; no
 *  visits (pre-service rows mid-migration) -> create visit 1; 2+ visits -> the
 *  active one absorbs the edit (C2: the top editors bind to the active visit).
 *  The columns were already written by recordService, so the mirror equals
 *  them by construction. */
export async function syncActiveVisitTx(tx: any, tenantId: string, record: any): Promise<void> {
  const visits = await tx.workOrderVisit.findMany({ where: { tenantId, recordId: record.id } });
  const state = record.appointmentAt == null ? "pending" : "scheduled";
  const target = visits.length ? (activeVisitOf(visits) || visits.sort((a: any, b: any) => a.ordinal - b.ordinal)[0]) : null;
  if (!target) {
    await tx.workOrderVisit.create({ data: { tenantId, recordId: record.id, ordinal: (visits.length || 0) + 1, startAt: record.appointmentAt, endAt: record.endAt, resourceId: record.resourceId, state } });
    return;
  }
  await tx.workOrderVisit.update({ where: { id: target.id }, data: { startAt: record.appointmentAt, endAt: record.endAt, resourceId: record.resourceId, state: target.state === "done" || target.state === "cancelled" ? target.state : state } });
}

export async function listVisits(tenantId: string, recordId: string): Promise<VisitDTO[]> {
  await assertWorkOrder(tenantId, recordId);
  const rows = await db.workOrderVisit.findMany({ where: { tenantId, recordId }, orderBy: { ordinal: "asc" } });
  return rows.map(toDTO);
}

async function emitVisit(tenantId: string, type: string, visit: any, actor: EventActor): Promise<void> {
  try {
    await emitEvent({ tenantId, type, actor, subject: { type: "record", id: visit.recordId }, payload: { record_id: visit.recordId, visit_id: visit.id, visit_ordinal: visit.ordinal, visit_state: visit.state } });
  } catch { /* never block a visit write on event emission */ }
}

export async function createVisit(tenantId: string, recordId: string, input: { startAt?: any; endAt?: any; resourceId?: string | null } = {}, actor: EventActor = { type: "user" }): Promise<VisitDTO> {
  await assertWorkOrder(tenantId, recordId);
  const startAt = input.startAt ? new Date(input.startAt) : null;
  if (input.startAt && isNaN(startAt as any)) throw new Error("Invalid visit start.");
  const endAt = input.endAt ? new Date(input.endAt) : null;
  const created = await db.$transaction(async (tx: any) => {
    await lockRecordTx(tx, recordId);
    const max = await tx.workOrderVisit.aggregate({ where: { tenantId, recordId }, _max: { ordinal: true } });
    const v = await tx.workOrderVisit.create({ data: { tenantId, recordId, ordinal: (max._max.ordinal || 0) + 1, startAt, endAt, resourceId: input.resourceId ?? null, state: startAt ? "scheduled" : "pending" } });
    await recomputeMirrorTx(tx, tenantId, recordId);
    return v;
  });
  await emitVisit(tenantId, "WorkOrderVisitCreated", created, actor);
  return toDTO(created);
}

async function loadVisit(tenantId: string, visitId: string): Promise<any> {
  if (!visitId || typeof visitId !== "string") throw new Error("Visit not found.");
  const v = await db.workOrderVisit.findFirst({ where: { id: visitId, tenantId } });
  if (!v) throw new Error("Visit not found.");
  return v;
}

export async function scheduleVisit(tenantId: string, visitId: string, input: { startAt: any; endAt?: any; resourceId?: string | null }, actor: EventActor = { type: "user" }): Promise<VisitDTO> {
  const v = await loadVisit(tenantId, visitId);
  if (v.state === "cancelled" || v.state === "done") throw new Error("This visit is closed \u2014 add a new visit instead.");
  const startAt = new Date(input.startAt);
  if (isNaN(startAt as any)) throw new Error("Invalid visit start.");
  const updated = await db.$transaction(async (tx: any) => {
    await lockRecordTx(tx, v.recordId);
    const u = await tx.workOrderVisit.update({ where: { id: v.id }, data: { startAt, endAt: input.endAt ? new Date(input.endAt) : null, ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}), state: "scheduled" } });
    await recomputeMirrorTx(tx, tenantId, v.recordId);
    return u;
  });
  await emitVisit(tenantId, "WorkOrderVisitScheduled", updated, actor);
  return toDTO(updated);
}

export async function reassignVisit(tenantId: string, visitId: string, resourceId: string | null, actor: EventActor = { type: "user" }): Promise<VisitDTO> {
  const v = await loadVisit(tenantId, visitId);
  const updated = await db.$transaction(async (tx: any) => {
    await lockRecordTx(tx, v.recordId);
    const u = await tx.workOrderVisit.update({ where: { id: v.id }, data: { resourceId } });
    await recomputeMirrorTx(tx, tenantId, v.recordId);
    return u;
  });
  await emitVisit(tenantId, "WorkOrderVisitReassigned", updated, actor);
  return toDTO(updated);
}

export async function completeVisit(tenantId: string, visitId: string, actor: EventActor = { type: "user" }): Promise<VisitDTO> {
  const v = await loadVisit(tenantId, visitId);
  const updated = await db.$transaction(async (tx: any) => {
    await lockRecordTx(tx, v.recordId);
    const u = await tx.workOrderVisit.update({ where: { id: v.id }, data: { state: "done" } });
    await recomputeMirrorTx(tx, tenantId, v.recordId);
    return u;
  });
  await emitVisit(tenantId, "WorkOrderVisitCompleted", updated, actor);
  return toDTO(updated);
}

export async function cancelVisit(tenantId: string, visitId: string, actor: EventActor = { type: "user" }): Promise<VisitDTO> {
  const v = await loadVisit(tenantId, visitId);
  const updated = await db.$transaction(async (tx: any) => {
    await lockRecordTx(tx, v.recordId);
    const u = await tx.workOrderVisit.update({ where: { id: v.id }, data: { state: "cancelled" } });
    await recomputeMirrorTx(tx, tenantId, v.recordId);
    return u;
  });
  await emitVisit(tenantId, "WorkOrderVisitCancelled", updated, actor);
  return toDTO(updated);
}

/** C6: cancelling the JOB cancels its pending visits (same tx as the caller's
 *  stage write is not required — the job-cancel path calls this right after;
 *  each pending visit flips inside one transaction here). */
export async function cancelPendingVisits(tenantId: string, recordId: string, actor: EventActor = { type: "user" }): Promise<number> {
  const rec = await assertWorkOrder(tenantId, recordId);
  const n = await db.$transaction(async (tx: any) => {
    await lockRecordTx(tx, rec.id);
    const res = await tx.workOrderVisit.updateMany({ where: { tenantId, recordId: rec.id, state: "pending" }, data: { state: "cancelled" } });
    await recomputeMirrorTx(tx, tenantId, rec.id);
    return res.count;
  });
  if (n > 0) await emitVisit(tenantId, "WorkOrderVisitCancelled", { recordId: rec.id, id: "(pending-batch)", ordinal: 0, state: "cancelled" }, actor);
  return n;
}
