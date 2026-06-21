// Turn a captured spoken appointment into a real Booking record — capture-only.
// Reuses the EXISTING building blocks: createRecord (which runs the date through
// the SAME zoneless wall-clock parser the manual picker uses), the Booking
// record type, and createLink (the same contact<->record link the UI uses).
// Creates NOTHING unless there is a real, concrete, parseable date+time, so a
// vague call never produces a junk booking.

import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { createRecord, parseAppointmentAt } from "./recordService";
import { createLink } from "./recordLinkService";
import { resolveRecordTypeId, BOOKING_RECORD_TYPE_KEY } from "./recordTypeService";
import { listResources } from "./resourceService";
import { checkAvailability } from "./availabilityService";

const db = prisma as any;

// The booking is "Requested" the moment the AI captures it — the first stage of
// the Requested -> Confirmed -> Completed -> No-show pipeline. Matches what a new
// manual booking gets.
const REQUESTED_STAGE_KEY = "requested";

// A confirmed appointment must be a zoneless wall-clock string in the EXACT
// picker format "YYYY-MM-DDTHH:MM" (optional seconds). Anything else (a vague
// phrase, empty, malformed) is treated as "no time captured" — no booking.
const WALLCLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

/** True only for a strict, real, parseable wall-clock date+time. */
export function isConcreteAppointment(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  const m = WALLCLOCK_RE.exec(s);
  if (!m) return false;
  // Reject impossible values (e.g. month 13, day 40) by round-tripping the parts.
  const [_, y, mo, d, h, mi] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, 0));
  return (
    !isNaN(dt.getTime()) &&
    dt.getUTCFullYear() === +y &&
    dt.getUTCMonth() === +mo - 1 &&
    dt.getUTCDate() === +d &&
    dt.getUTCHours() === +h &&
    dt.getUTCMinutes() === +mi
  );
}

/** Map the caller's spoken service to a seeded Booking subtype key. Case- and
 *  whitespace-insensitive contains-match in either direction; falls back to the
 *  first service so the (required-when-present) Type is always valid. Returns
 *  null only when the portal has no services configured at all. */
export function mapServiceToSubtype(subtypes: any[], service?: string | null): string | null {
  if (!Array.isArray(subtypes) || subtypes.length === 0) return null; // Type optional
  const want = String(service || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (want) {
    const hit = subtypes.find((s: any) => {
      const label = String(s.label || "").toLowerCase().trim();
      const key = String(s.key || "").toLowerCase().trim();
      return (
        label === want || key === want ||
        (label && (want.includes(label) || label.includes(want)))
      );
    });
    if (hit) return hit.key;
  }
  return subtypes[0].key; // sensible default; raw words are kept as the title
}

/** Map the caller's spoken staff name to a real configured resource id. Same
 *  case-/whitespace-insensitive contains-match style as mapServiceToSubtype, but
 *  FAIL-SAFE: returns a resource id ONLY on a confident match. No name given, no
 *  resources configured, or no match → null (the booking is left Unassigned). We
 *  never invent or guess an assignment, so a misheard name can't book the wrong
 *  person or break the booking. */
export async function resolveResourceByName(tenantId: string, name?: string | null): Promise<string | null> {
  const want = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!want) return null; // caller named no one
  const resources = await listResources(tenantId);
  if (!resources.length) return null; // nothing to assign to
  const hit = resources.find((r) => {
    const rn = String(r.name || "").toLowerCase().trim();
    return rn !== "" && (rn === want || want.includes(rn) || rn.includes(want));
  });
  return hit ? hit.id : null; // no confident match → Unassigned
}

/** Pick a resource that is FREE at the given wall-clock time, reusing the SAME
 *  availability union the AI uses (so the read matches the write). Returns the
 *  first free resource's id, or null when none is free (caller fails safe — it
 *  must NOT force-assign a busy resource, which would double-book). serviceKey is
 *  the booking's subtype so the duration used here matches the booking's own. */
async function pickFreeResource(tenantId: string, appointmentDatetime: string, serviceKey: string | null): Promise<string | null> {
  const dateStr = String(appointmentDatetime).slice(0, 10);
  const timeStr = String(appointmentDatetime).slice(11, 16);
  const avail = await checkAvailability(tenantId, dateStr, timeStr, serviceKey, null);
  const free = avail.availableResources || [];
  return free.length ? free[0].id : null;
}


export async function createBookingFromCall(params: {
  tenantId: string;
  contactId: string;
  appointmentDatetime?: string | null;
  service?: string | null;
  resource?: string | null;
  callSid?: string;
}): Promise<string | null> {
  const { tenantId, contactId, appointmentDatetime, service, resource } = params;

  // GUARD: only proceed on a real, concrete, parseable wall-clock date+time.
  if (!isConcreteAppointment(appointmentDatetime)) return null;

  // Look up this portal's Booking type + its services (for the Type mapping).
  const recordTypeId = await resolveRecordTypeId(tenantId, BOOKING_RECORD_TYPE_KEY);
  const rt = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  const subtypes: any[] = (rt && rt.subtypes) || [];
  const subtypeKey = mapServiceToSubtype(subtypes, service);

  // IDEMPOTENCY (Bug 1b): never create a SECOND booking for the same contact at the
  // same wall-clock time. finalizeCall is already claimed atomically once, so this
  // is belt-and-suspenders that makes a duplicate structurally impossible no matter
  // how booking creation is reached (retries, future callers). If one already
  // exists for this contact at this exact appointmentAt, return it instead of
  // creating another. Uses the SAME wall-clock parser createRecord stores with.
  const apptInstant = parseAppointmentAt(appointmentDatetime);
  if (apptInstant) {
    const dup = await db.record.findFirst({
      where: {
        tenantId, recordTypeId, deletedAt: null, appointmentAt: apptInstant,
        links: { some: { parentType: "contact", parentId: contactId, deletedAt: null } },
      },
      select: { id: true },
    });
    if (dup) {
      logger.info(`[booking-capture] booking already exists for contact ${contactId} @ ${appointmentDatetime}; skipping duplicate (${params.callSid ?? "?"})`);
      return dup.id;
    }
  }

  // Title: the caller's own words for the service, else a neutral fallback.
  const title = (service || "").trim() || "Phone booking";

  // Resolve the caller's spoken staff name to a real resource (or null/Unassigned).
  // createRecord then applies that resource's OWN hours/duration and the per-
  // resource double-booking lock; AI bookings can never override a conflict, so a
  // clash hard-blocks (no booking) — the caller is still captured as a contact/lead.
  let resourceId = await resolveResourceByName(tenantId, resource);

  // SAFETY NET (decision #4): a booking must never land Unassigned-and-unsynced
  // when staff exist. If no resource was resolved (no name / no confident match)
  // but the business HAS bookable resources, auto-assign one that is FREE at this
  // time, reusing the availability union the AI uses. If NONE is free, do NOT
  // force-assign a busy resource (that would double-book) — fail safe: no booking,
  // the caller is still captured as a contact/lead, exactly like a clash. With
  // zero resources configured, Unassigned is the only lane, so we leave it as-is.
  if (!resourceId) {
    const resources = await listResources(tenantId);
    if (resources.length > 0) {
      const free = await pickFreeResource(tenantId, appointmentDatetime as string, subtypeKey);
      if (!free) {
        logger.info(`[booking-capture] resources exist but none free at ${appointmentDatetime}; booking not placed (${params.callSid ?? "?"})`);
        return null;
      }
      resourceId = free;
    }
  }

  // Reuse createRecord — appointmentDatetime goes through the SAME wall-clock
  // parser as the manual picker, so the stored digits match what the caller said.
  const booking = await createRecord(tenantId, BOOKING_RECORD_TYPE_KEY, {
    title,
    subtypeKey,
    stageKey: REQUESTED_STAGE_KEY,
    appointmentAt: appointmentDatetime,
    resourceId,
  }, { source: "ai" });

  // Link the caller's contact using the SAME mechanism as the UI.
  try {
    await createLink(tenantId, { recordId: booking.id, parentType: "contact", parentId: contactId, stageKey: null });
  } catch (err) {
    logger.error(`[booking-capture] link contact->booking failed (${params.callSid ?? "?"}): ${(err as Error).message}`);
  }

  logger.info(`[booking-capture] created booking ${booking.id} @ ${appointmentDatetime} (${params.callSid ?? "?"})`);
  return booking.id;
}
