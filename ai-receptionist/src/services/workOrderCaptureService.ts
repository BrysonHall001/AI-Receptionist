// AI SERVICE-REQUEST INTAKE — the finalization sibling to createBookingFromCall.
// A caller who described a problem (request_title captured) but committed NO
// booking becomes a DATELESS work order: status new_request, no appointment (so
// it lands in the dispatch tray), linked to the caller's contact, written through
// the EXISTING record service paths so RecordCreated fires and any applied
// "request received" library automation triggers exactly as a manual creation
// would. Guarded by the caller (callOrchestrator) exactly like booking capture:
// a failure here is logged loudly and can never break finalization.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { createRecord, addRecordNote } from "./recordService";
import { createLink } from "./recordLinkService";
import { WORK_ORDER_RECORD_TYPE_KEY } from "./recordTypeService";
import { mapServiceToSubtype, resolveResourceByName } from "./bookingCaptureService";

const db = prisma as any;

/** urgency (emergency|soon|whenever|null) → the seeded Priority options.
 *  Never "Low": the AI must not downgrade a caller; unknown urgency = Normal. */
export function priorityForUrgency(urgency?: string | null): string {
  const u = String(urgency || "").trim().toLowerCase();
  if (u === "emergency") return "Urgent";
  if (u === "soon") return "High";
  return "Normal"; // "whenever", null, or anything unexpected
}

/** AI SCHEDULING TARGET — the TIMED sibling: a committed date+time scheduled
 *  straight into Work Orders. Mirrors createBookingFromCall's posture (guarded
 *  by the caller; never breaks finalization) and this file's dateless sibling's
 *  mapping. PRECEDENCE (approved): a committed TIME wins — this record ABSORBS
 *  any captured request (details/equipment ride the description; one artifact
 *  per call, never a scheduled record PLUS a dateless request). */
export async function createScheduledWorkOrderFromCall(params: {
  tenantId: string;
  contactId: string;
  appointmentAt: string;            // wall-clock YYYY-MM-DDTHH:MM (the committed digits)
  resourceId?: string | null;       // the engine's committed pick
  resourceWords?: string | null;    // caller's named staff (extracted.resource) — the fallback net
  serviceWords?: string | null;     // caller's words for what the visit is
  intent?: string | null;
  visitMinutes: number;             // tenant's aiDefaultVisitMinutes -> endAt
  requestTitle?: string | null;     // absorption: batch-19 capture fields, if any
  requestDetails?: string | null;
  serviceAddress?: string | null;
  urgency?: string | null;
  equipmentMention?: string | null;
  callSid: string;
}): Promise<string | null> {
  const rt = await db.recordType.findFirst({ where: { tenantId: params.tenantId, key: WORK_ORDER_RECORD_TYPE_KEY } });
  if (!rt) return null;
  const subtypes: any[] = Array.isArray(rt.subtypes) ? (rt.subtypes as any[]) : [];
  // Subtype from the caller's service words — the booking capture's EXACT fuzzy
  // (mapServiceToSubtype), generalized here simply by feeding it THIS module's
  // subtypes; its own first-subtype fallback applies.
  const subtypeKey = subtypes.length ? (mapServiceToSubtype(subtypes, params.serviceWords ?? null) ?? subtypes[0].key) : null;
  const subtypeLabel = (subtypes.find((st) => st.key === subtypeKey) || {}).label || "Service";
  // Title: the captured problem label first; else the caller's SERVICE words
  // (clean nouns — "furnace tune-up"), never raw intent chatter; else the
  // subtype fallback. First letter capitalized for the list view.
  const wordsForTitle = String(params.serviceWords || "").trim();
  const rawTitle = String(params.requestTitle || "").trim() || (wordsForTitle ? wordsForTitle[0].toUpperCase() + wordsForTitle.slice(1) : "");
  const title = (rawTitle || `${subtypeLabel} visit`).slice(0, 140);
  const details = String(params.requestDetails || "").trim();
  const words = String(params.serviceWords || "").trim();
  const mention = String(params.equipmentMention || "").trim();
  const description = [
    details,
    words && words.toLowerCase() !== details.toLowerCase() ? `Requested: ${words}` : "",
    mention ? `Caller mentioned: "${mention}"` : "",
  ].filter(Boolean).join("\n\n");
  const customFields: Record<string, any> = { priority: priorityForUrgency(params.urgency) };
  if (description) customFields.description = description;
  const spokenAddress = String(params.serviceAddress || "").trim();
  if (spokenAddress) customFields.service_address = { street: spokenAddress, city: "", state: "", postal: "" };

  // endAt = committed start + the tenant's default visit length (wall-clock math
  // on the exact digits — no timezone conversion, the appointment storage rule).
  const [d, hm] = params.appointmentAt.split("T");
  const [hh, mm] = (hm || "00:00").split(":").map((x) => parseInt(x, 10));
  const total = hh * 60 + mm + (params.visitMinutes > 0 ? params.visitMinutes : 60);
  const endSameDay = total < 24 * 60;
  const endAt = endSameDay ? `${d}T${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}` : null; // past midnight: open-ended (honest)

  // Resource: the engine's committed pick wins; else the booking sibling's net,
  // mirrored — resolve the caller's named staff, and failing that assign the
  // business's SOLE resource (never guess among several).
  let resourceId = params.resourceId ?? null;
  if (!resourceId) resourceId = await resolveResourceByName(params.tenantId, (params as any).resourceWords ?? null);
  if (!resourceId) {
    const all = await db.resource.findMany({ where: { tenantId: params.tenantId, deletedAt: null }, select: { id: true } });
    if (all.length === 1) resourceId = all[0].id;
  }

  const created: any = await createRecord(params.tenantId, WORK_ORDER_RECORD_TYPE_KEY, {
    title,
    stageKey: "scheduled",
    subtypeKey,
    appointmentAt: params.appointmentAt,
    ...(endAt ? { endAt } : {}),
    resourceId,
    customFields,
  } as any);
  try {
    await createLink(params.tenantId, { recordId: created.id, parentType: "contact", parentId: params.contactId, role: "customer" });
  } catch (e) {
    logger.error(`[ai-target] contact link failed for ${params.callSid}: ${(e as Error).message}`);
  }
  try {
    await addRecordNote(params.tenantId, created.id, "Created by the AI receptionist from a phone call.", { name: "AI receptionist", type: "system" });
  } catch (e) {
    logger.warn(`[ai-target] provenance note failed for ${params.callSid}: ${(e as Error).message}`);
  }
  logger.info(`[ai-target] scheduled work order ${created.id} ("${title}") at ${params.appointmentAt} for ${params.callSid}`);
  return created.id as string;
}

export async function createWorkOrderFromCall(params: {
  tenantId: string;
  contactId: string;
  requestTitle?: string | null;
  requestDetails?: string | null;
  serviceAddress?: string | null;
  urgency?: string | null;
  equipmentMention?: string | null;
  callSid: string;
}): Promise<string | null> {
  const title = String(params.requestTitle || "").trim().slice(0, 140);
  if (!title) return null; // no request captured — nothing to create (capture-only)

  const rt = await db.recordType.findFirst({ where: { tenantId: params.tenantId, key: WORK_ORDER_RECORD_TYPE_KEY } });
  if (!rt) return null; // module not live — the intake gate should have caught this; fail quiet + safe
  // Work orders require a Type when subtypes exist: default to the FIRST subtype
  // — the booking capture's exact precedent ("sensible default; raw words are
  // kept as the title", bookingCaptureService guessSubtype). Repair leads the
  // seeded list; a portal with custom subtypes gets ITS first choice.
  const subtypes: any[] = Array.isArray(rt.subtypes) ? (rt.subtypes as any[]) : [];
  const subtypeKey = subtypes.length ? subtypes[0].key : null;

  // Description: the caller's words, with any equipment mention appended HONESTLY
  // (awareness-only this batch — the words land in text, no guessed data).
  const details = String(params.requestDetails || "").trim();
  const mention = String(params.equipmentMention || "").trim();
  const description = [details, mention ? `Caller mentioned: "${mention}"` : ""].filter(Boolean).join("\n\n");

  const customFields: Record<string, any> = {
    description,
    priority: priorityForUrgency(params.urgency),
  };
  // The spoken address, one line, kept verbatim in the street part (honest: the
  // AI captured words, not a parsed postal record; the geocoder handles the rest).
  const spokenAddress = String(params.serviceAddress || "").trim();
  if (spokenAddress) customFields.service_address = { street: spokenAddress, city: "", state: "", postal: "" };

  // DATELESS by design: no appointmentAt/resource — dispatch is the team's call.
  // subtypeKey null is valid for work orders (Type is optional on this module).
  const created: any = await createRecord(params.tenantId, WORK_ORDER_RECORD_TYPE_KEY, {
    title,
    stageKey: "new_request",
    subtypeKey,
    customFields,
  } as any);

  // Contact link — the same customer role conversion writes.
  try {
    await createLink(params.tenantId, { recordId: created.id, parentType: "contact", parentId: params.contactId, role: "customer" });
  } catch (e) {
    logger.error(`[ai-intake] contact link failed for ${params.callSid}: ${(e as Error).message}`);
  }

  // PROVENANCE: the record's own activity trail (the record page's Activity card)
  // — the existing pattern, no new machinery. actorType "system".
  try {
    await addRecordNote(params.tenantId, created.id, "Created by the AI receptionist from a phone call.", { name: "AI receptionist", type: "system" });
  } catch (e) {
    logger.warn(`[ai-intake] provenance note failed for ${params.callSid}: ${(e as Error).message}`);
  }

  // EQUIPMENT — the ONE narrow approved exception: a KNOWN caller with EXACTLY
  // one equipment record linked to their contact AND a verbatim mention → link it
  // (batch-18 convention role). Any other case: skip entirely, mention stays in
  // the description text only.
  if (mention) {
    try {
      const eqType = await db.recordType.findFirst({ where: { tenantId: params.tenantId, key: "equipment" }, select: { id: true } });
      if (eqType) {
        const contactLinks = await db.recordLink.findMany({ where: { tenantId: params.tenantId, parentType: "contact", parentId: params.contactId, deletedAt: null } });
        const eqRecords = await db.record.findMany({ where: { id: { in: contactLinks.map((l: any) => l.recordId) }, tenantId: params.tenantId, recordTypeId: eqType.id, deletedAt: null }, select: { id: true } });
        if (eqRecords.length === 1) {
          await createLink(params.tenantId, { recordId: created.id, parentType: "record", parentId: eqRecords[0].id, role: "serviced_equipment" });
          logger.info(`[ai-intake] linked the caller's single equipment record to ${created.id} (${params.callSid})`);
        }
      }
    } catch (e) {
      logger.warn(`[ai-intake] equipment link skipped for ${params.callSid}: ${(e as Error).message}`);
    }
  }

  logger.info(`[ai-intake] service request captured as work order ${created.id} ("${title}") for ${params.callSid}`);
  return created.id as string;
}
