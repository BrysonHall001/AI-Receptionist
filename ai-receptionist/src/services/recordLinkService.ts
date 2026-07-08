// RecordLink service (Batch 1b) — the many-to-many join between a polymorphic
// parent and a record, carrying the relationship stage. Parent is read from
// parentType (only "contact" exists today) so account/property parents slot in
// later without rework. Unlinking is a soft-delete. Tenant-scoped throughout.

import { prisma } from "../db/client";
import { resolveRecordTypeId, BOOKING_RECORD_TYPE_KEY } from "./recordTypeService";
import { emitEvent } from "../events/bus";
import { EventActor } from "../events/types";
import { logger } from "../utils/logger";

const db = prisma as any;

// Stage 3b: append ONE stage-move history row. Used by updateLink() (moves) and
// createLink() (initial stage / re-stage on linking). source = 'move' to keep
// these distinct from the 3a 'backfill' rows; existing rows are never altered.
// Best-effort at the call sites: a logging failure is recorded but never blocks
// the stage write.
async function writeStageHistory(tenantId: string, recordLinkId: string, fromStage: string | null, toStage: string | null): Promise<void> {
  await db.stageHistory.create({
    data: { tenantId, recordLinkId, fromStage: fromStage ?? null, toStage: toStage ?? null, enteredAt: new Date(), source: "move" },
  });
}

/** Links on a record (e.g. candidates on a Job), with parent display info. */
export async function listLinksForRecord(tenantId: string, recordId: string) {
  const rec = await db.record.findFirst({ where: { id: recordId, tenantId, deletedAt: null } });
  if (!rec) throw new Error("Record not found");
  const links = await db.recordLink.findMany({ where: { tenantId, recordId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  const contactIds = links.filter((l: any) => l.parentType === "contact").map((l: any) => l.parentId);
  const contacts = contactIds.length ? await db.contact.findMany({ where: { id: { in: contactIds }, tenantId } }) : [];
  const byId: any = {};
  contacts.forEach((c: any) => (byId[c.id] = c));
  return links.map((l: any) => ({
    id: l.id,
    recordId: l.recordId,
    parentType: l.parentType,
    parentId: l.parentId,
    role: l.role ?? null,
    stageKey: l.stageKey ?? null,
    parent: l.parentType === "contact" && byId[l.parentId]
      ? { id: byId[l.parentId].id, name: byId[l.parentId].name, email: byId[l.parentId].email, phone: byId[l.parentId].phone }
      : null,
  }));
}

/** Links from a contact's side (e.g. Jobs this contact is on), with record display info. */
export async function listLinksForContact(tenantId: string, contactId: string, recordType?: string | null) {
  const links = await db.recordLink.findMany({ where: { tenantId, parentType: "contact", parentId: contactId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  const recIds = links.map((l: any) => l.recordId);
  const recs = recIds.length ? await db.record.findMany({ where: { id: { in: recIds }, tenantId, deletedAt: null } }) : [];
  const byId: any = {};
  recs.forEach((r: any) => (byId[r.id] = r));
  let out = links
    .map((l: any) => ({
      id: l.id,
      stageKey: l.stageKey ?? null,
      role: l.role ?? null,
      record: byId[l.recordId] ? { id: byId[l.recordId].id, title: byId[l.recordId].title, recordTypeId: byId[l.recordId].recordTypeId, stageKey: byId[l.recordId].stageKey, subtypeKey: byId[l.recordId].subtypeKey ?? null, customFields: byId[l.recordId].customFields ?? {} } : null,
    }))
    .filter((x: any) => x.record);
  if (recordType) {
    const rtId = await resolveRecordTypeId(tenantId, recordType);
    out = out.filter((x: any) => x.record.recordTypeId === rtId);
  }
  return out;
}

/** Create a link (or update stage/role if one already exists). Parent defaults to a contact. */
export async function createLink(tenantId: string, input: { recordId: string; parentType?: string; parentId: string; role?: string | null; stageKey?: string | null }) {
  const parentType = input.parentType || "contact";
  const rec = await db.record.findFirst({ where: { id: input.recordId, tenantId, deletedAt: null } });
  if (!rec) throw new Error("Record not found");
  if (parentType === "contact") {
    const c = await db.contact.findFirst({ where: { id: input.parentId, tenantId, deletedAt: null } });
    if (!c) throw new Error("Contact not found");
  }
  const existing = await db.recordLink.findFirst({ where: { tenantId, recordId: input.recordId, parentType, parentId: input.parentId, deletedAt: null } });
  if (existing) {
    const prevStage = existing.stageKey ?? null; // capture BEFORE any update
    const data: any = {};
    if (input.stageKey !== undefined) data.stageKey = input.stageKey ?? null;
    if (input.role !== undefined) data.role = input.role ?? null;
    if (Object.keys(data).length) {
      const updated = await db.recordLink.update({ where: { id: existing.id }, data });
      // Stage 3b: re-linking with a different stage IS a stage change — log it.
      const newStage = updated.stageKey ?? null;
      if (input.stageKey !== undefined && newStage !== prevStage) {
        try { await writeStageHistory(tenantId, updated.id, prevStage, newStage); }
        catch (e) { logger.error(`stage history write failed (link ${updated.id}): ${(e as Error).message}`); }
      }
      return updated;
    }
    return existing;
  }
  const created = await db.recordLink.create({ data: { tenantId, recordId: input.recordId, parentType, parentId: input.parentId, role: input.role ?? null, stageKey: input.stageKey ?? null, customFields: {} } });
  // Stage 3b: a brand-new link with an initial stage = the candidate entering
  // their first stage. Log it (fromStage = null) so newly-linked candidates have
  // a start point for time-in-stage — otherwise they'd be an unlogged hole until
  // their first move.
  const initialStage = created.stageKey ?? null;
  if (initialStage !== null) {
    try { await writeStageHistory(tenantId, created.id, null, initialStage); }
    catch (e) { logger.error(`stage history write failed (link ${created.id}): ${(e as Error).message}`); }
  }

  // BookingCreated: fire ONCE when a booking first gets a contact (manual + AI both
  // land here right after createRecord), so an automation's act_on_linked always
  // has someone to reach. Guarded to the FIRST contact link on a booking. Best-
  // effort — a link must never fail because of event emission.
  if (parentType === "contact") {
    try {
      const bookingTypeId = await resolveRecordTypeId(tenantId, BOOKING_RECORD_TYPE_KEY).catch(() => null);
      if (bookingTypeId && rec.recordTypeId === bookingTypeId) {
        const priorContacts = await db.recordLink.count({ where: { tenantId, recordId: input.recordId, parentType: "contact", deletedAt: null, NOT: { id: created.id } } });
        if (priorContacts === 0) {
          await emitEvent({
            tenantId,
            type: "BookingCreated",
            actor: { type: "system" },
            subject: { type: "record", id: rec.id },
            payload: {
              record_id: rec.id,
              record_title: rec.title ?? null,
              appointment_at: rec.appointmentAt ? new Date(rec.appointmentAt).toISOString() : null,
              service: rec.subtypeKey ?? null,
              status: rec.stageKey ?? null,
              resource_id: rec.resourceId ?? null,
              contact_id: input.parentId,
            },
          });
        }
      }
    } catch (e) { logger.error(`BookingCreated emit failed (record ${input.recordId}): ${(e as Error).message}`); }
  }

  return created;
}

export async function updateLink(tenantId: string, id: string, input: { stageKey?: string | null; role?: string | null }, actor: EventActor = { type: "user" }, chainDepth = 0) {
  const link = await db.recordLink.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!link) throw new Error("Link not found");
  const prevStage = link.stageKey ?? null; // capture BEFORE the write
  const data: any = {};
  if (input.stageKey !== undefined) data.stageKey = input.stageKey ?? null;
  if (input.role !== undefined) data.role = input.role ?? null;
  const updated = await db.recordLink.update({ where: { id }, data });

  // ===================== STAGE HISTORY (Stage 3b) =====================
  // Append one 'move' row when the stage ACTUALLY changes. This is a SEPARATE,
  // independently try/caught step from the Stage 1 event emit below, so a failure
  // in one can never swallow the other. Logs regardless of parent type (history
  // is about the link itself, not the automation subject).
  const stageChanged = input.stageKey !== undefined && (updated.stageKey ?? null) !== prevStage;
  if (stageChanged) {
    try { await writeStageHistory(tenantId, updated.id, prevStage, updated.stageKey ?? null); }
    catch (e) { logger.error(`stage history write failed (link ${updated.id}): ${(e as Error).message}`); }
  }
  // =================== END STAGE HISTORY (Stage 3b) ===================

  // ===================== STAGE-CHANGE EVENT (Stage 1) =====================
  // Additive and self-contained: if you ever want to remove the "Stage changed"
  // trigger, delete this whole block and the emitStageChanged() helper below;
  // nothing else here depends on it. We fire ONLY when the stage genuinely
  // changed, and ONLY for contact parents (the candidate) so the existing
  // contact-subject automation engine can load the subject exactly as always.
  // Best-effort: wrapped so a problem here can never break the stage save.
  const newStage = updated.stageKey ?? null;
  if (input.stageKey !== undefined && newStage !== prevStage && link.parentType === "contact") {
    await emitStageChanged(tenantId, updated, prevStage, newStage, actor, chainDepth).catch(() => { /* never block the stage write */ });
  }
  // =================== END STAGE-CHANGE EVENT (Stage 1) ===================

  return updated;
}

// Emit a "StageChanged" domain event whose SUBJECT is the candidate contact.
// Payload carries generic, relabel-safe metadata (no hardcoded "Job" wording)
// for use by conditions/templating and for the event/run logs:
//   old_stage, new_stage, record_id, record_title, record_type, link_id
// Reads the parent record (the "job") only to enrich the payload; all reads are
// tenant-scoped and best-effort.
async function emitStageChanged(tenantId: string, link: any, oldStage: string | null, newStage: string | null, actor: EventActor = { type: "user" }, chainDepth = 0) {
  let recordTitle: string | null = null;
  let recordTypeLabel: string | null = null;
  try {
    const rec = await db.record.findFirst({ where: { id: link.recordId, tenantId } });
    if (rec) {
      recordTitle = rec.title ?? null;
      const rt = await db.recordType.findFirst({ where: { id: rec.recordTypeId, tenantId } });
      recordTypeLabel = rt?.label ?? null;
    }
  } catch { /* enrichment is optional; emit with what we have */ }

  await emitEvent({
    tenantId,
    type: "StageChanged",
    // Actor passed through from the caller. A human move stays "user" (default),
    // so the engine still processes it; an automation-driven move arrives as
    // "automation", which the engine's loop guard ignores. chainDepth bounds
    // any future cascade.
    actor,
    chainDepth,
    subject: { type: "contact", id: link.parentId },
    payload: {
      old_stage: oldStage,
      new_stage: newStage,
      record_id: link.recordId,
      record_title: recordTitle,
      record_type: recordTypeLabel,
      link_id: link.id,
    },
  });
}

/** Unlink = soft-delete the relationship (never a hard delete). */
export async function softDeleteLink(tenantId: string, id: string): Promise<void> {
  const link = await db.recordLink.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!link) throw new Error("Link not found");
  await db.recordLink.update({ where: { id }, data: { deletedAt: new Date() } });
}
