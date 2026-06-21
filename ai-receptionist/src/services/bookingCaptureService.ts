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

/** Heuristic: does this call look like the caller intended to book? Used only to
 *  decide whether a missing/garbage appointment time should be logged LOUDLY (an
 *  "announced but not recorded" loss) versus quietly (a normal non-booking call). */
function looksLikeBookingIntent(intent?: string | null, resource?: string | null, service?: string | null): boolean {
  if ((resource && resource.trim()) || (service && service.trim())) return true;
  return /book|appoint|schedul|reschedul|reserv/i.test(String(intent || ""));
}

/** Create the booking, RESCUING a named-but-unbookable resource: if createRecord
 *  rejects the chosen resource because it's closed or already booked, auto-assign
 *  a resource that IS free at this time (the same availability union the AI uses)
 *  and retry — so a resource the AI named/picked that can't actually take the slot
 *  is rescued, never silently lost. Returns the booking, or null when nobody can
 *  take it (logged loudly). Non-closed/overlap errors are rethrown (logged loudly
 *  by the caller's handler). */
async function createBookingWithRescue(
  tenantId: string,
  p: { title: string; subtypeKey: string | null; appointmentDatetime: string; resourceId: string | null; haveResources: boolean; callSid?: string },
): Promise<{ id: string } | null> {
  const attempt = (rid: string | null) =>
    createRecord(tenantId, BOOKING_RECORD_TYPE_KEY, {
      title: p.title, subtypeKey: p.subtypeKey, stageKey: REQUESTED_STAGE_KEY, appointmentAt: p.appointmentDatetime, resourceId: rid,
    }, { source: "ai" });

  try {
    return await attempt(p.resourceId);
  } catch (e: any) {
    const code = e && e.code;
    if ((code === "closed" || code === "overlap") && p.haveResources) {
      const free = await pickFreeResource(tenantId, p.appointmentDatetime, p.subtypeKey);
      if (free && free !== p.resourceId) {
        logger.warn(`[booking-capture] chosen resource ${p.resourceId ?? "(unassigned)"} can't take ${p.appointmentDatetime} (${code}); RESCUING onto free resource ${free} (${p.callSid ?? "?"})`);
        try {
          return await attempt(free);
        } catch (e2: any) {
          logger.warn(`[booking-capture] rescue retry ALSO failed for ${p.appointmentDatetime} (${e2?.code ?? e2?.message}) — booking NOT placed; caller still captured (${p.callSid ?? "?"})`);
          return null;
        }
      }
      logger.warn(`[booking-capture] chosen resource can't take ${p.appointmentDatetime} (${code}) and NO other resource is free — booking NOT placed; caller still captured (${p.callSid ?? "?"})`);
      return null;
    }
    throw e; // unexpected — surface loudly via the caller's handler
  }
}

export async function createBookingFromCall(params: {
  tenantId: string;
  contactId: string;
  appointmentDatetime?: string | null;
  service?: string | null;
  resource?: string | null;
  intent?: string | null;
  callSid?: string;
}): Promise<string | null> {
  const { tenantId, contactId, appointmentDatetime, service, resource, intent } = params;

  // GUARD: only proceed on a real, concrete, parseable wall-clock date+time. When
  // a booking was clearly INTENDED but no concrete time was recorded, log LOUDLY —
  // this is the "announced but not recorded" loss, the worst failure for bookings.
  if (!isConcreteAppointment(appointmentDatetime)) {
    if (looksLikeBookingIntent(intent, resource, service)) {
      logger.warn(`[booking-capture] booking INTENDED but appointment_datetime was missing/not-concrete (value=${JSON.stringify(appointmentDatetime ?? null)}, intent=${intent ?? "-"}, resource=${resource ?? "-"}, service=${service ?? "-"}) — NO booking created; caller still captured (${params.callSid ?? "?"})`);
    }
    return null;
  }

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

  // Resolve the caller's spoken/announced staff name to a real resource (or null).
  let resourceId = await resolveResourceByName(tenantId, resource);
  const resources = await listResources(tenantId);
  const haveResources = resources.length > 0;

  // SAFETY NET (decision #4): a booking must never land Unassigned-and-unsynced
  // when staff exist. If no resource was resolved (no name / no confident match)
  // but the business HAS bookable resources, auto-assign one that is FREE at this
  // time, reusing the availability union the AI uses. If NONE is free, do NOT
  // force-assign a busy resource (that would double-book) — fail safe: no booking,
  // logged LOUDLY. With zero resources configured, Unassigned is the only lane.
  if (!resourceId && haveResources) {
    const free = await pickFreeResource(tenantId, appointmentDatetime as string, subtypeKey);
    if (!free) {
      logger.warn(`[booking-capture] no resource was named and NONE is free at ${appointmentDatetime} — booking NOT placed; caller still captured (${params.callSid ?? "?"})`);
      return null;
    }
    resourceId = free;
  }

  // Create — RESCUING a named-but-unbookable resource onto a free one (so the AI
  // naming someone who can't actually take the slot never silently loses it). All
  // no-booking outcomes inside here are logged loudly.
  const booking = await createBookingWithRescue(tenantId, {
    title, subtypeKey, appointmentDatetime: appointmentDatetime as string, resourceId, haveResources, callSid: params.callSid,
  });
  if (!booking) return null; // rescue/none-free already logged loudly

  // Link the caller's contact using the SAME mechanism as the UI.
  try {
    await createLink(tenantId, { recordId: booking.id, parentType: "contact", parentId: contactId, stageKey: null });
  } catch (err) {
    logger.error(`[booking-capture] link contact->booking failed (${params.callSid ?? "?"}): ${(err as Error).message}`);
  }

  logger.info(`[booking-capture] created booking ${booking.id} @ ${appointmentDatetime} (${params.callSid ?? "?"})`);
  return booking.id;
}
