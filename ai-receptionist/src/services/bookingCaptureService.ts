// Turn a captured spoken appointment into a real Booking record — capture-only.
// Reuses the EXISTING building blocks: createRecord (which runs the date through
// the SAME zoneless wall-clock parser the manual picker uses), the Booking
// record type, and createLink (the same contact<->record link the UI uses).
// Creates NOTHING unless there is a real, concrete, parseable date+time, so a
// vague call never produces a junk booking.

import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { createRecord } from "./recordService";
import { createLink } from "./recordLinkService";
import { resolveRecordTypeId, BOOKING_RECORD_TYPE_KEY } from "./recordTypeService";

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
function mapServiceToSubtype(subtypes: any[], service?: string | null): string | null {
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

/**
 * Create a Booking from a finalized call, if (and only if) a concrete date+time
 * was captured. Best-effort and self-contained: the caller wraps it so a failure
 * can never break call finalization. Returns the new booking id, or null when no
 * booking was created (no real time, or an error that was logged).
 */
export async function createBookingFromCall(params: {
  tenantId: string;
  contactId: string;
  appointmentDatetime?: string | null;
  service?: string | null;
  callSid?: string;
}): Promise<string | null> {
  const { tenantId, contactId, appointmentDatetime, service } = params;

  // GUARD: only proceed on a real, concrete, parseable wall-clock date+time.
  if (!isConcreteAppointment(appointmentDatetime)) return null;

  // Look up this portal's Booking type + its services (for the Type mapping).
  const recordTypeId = await resolveRecordTypeId(tenantId, BOOKING_RECORD_TYPE_KEY);
  const rt = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  const subtypes: any[] = (rt && rt.subtypes) || [];
  const subtypeKey = mapServiceToSubtype(subtypes, service);

  // Title: the caller's own words for the service, else a neutral fallback.
  const title = (service || "").trim() || "Phone booking";

  // Reuse createRecord — appointmentDatetime goes through the SAME wall-clock
  // parser as the manual picker, so the stored digits match what the caller said.
  const booking = await createRecord(tenantId, BOOKING_RECORD_TYPE_KEY, {
    title,
    subtypeKey,
    stageKey: REQUESTED_STAGE_KEY,
    appointmentAt: appointmentDatetime,
  });

  // Link the caller's contact using the SAME mechanism as the UI.
  try {
    await createLink(tenantId, { recordId: booking.id, parentType: "contact", parentId: contactId, stageKey: null });
  } catch (err) {
    logger.error(`[booking-capture] link contact->booking failed (${params.callSid ?? "?"}): ${(err as Error).message}`);
  }

  logger.info(`[booking-capture] created booking ${booking.id} @ ${appointmentDatetime} (${params.callSid ?? "?"})`);
  return booking.id;
}
