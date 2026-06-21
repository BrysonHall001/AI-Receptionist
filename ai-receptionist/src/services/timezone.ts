// Timezone conversion helpers for the Google Calendar boundary — and NOTHING
// else. Pure, Luxon-based, keyed off an IANA zone NAME (e.g. "America/New_York"),
// DST-correct (never a hardcoded numeric offset).
//
// WALL-CLOCK RULE: the rest of the app runs in zoneless wall-clock digits and is
// unaware timezones exist. These helpers are the ONE place conversion happens,
// at the Google boundary. SUB-BATCH A wires them to nothing — they're isolated
// pure functions with an exhaustive self-test.
//
// Two directions:
//   instantToWallClock : real tz-aware instant  -> "YYYY-MM-DDTHH:MM" (zoneless)
//   wallClockToInstant : "YYYY-MM-DDTHH:MM" + zone -> real instant (for Google)
//
// The output of instantToWallClock matches clarityBookingsSource/dateToWall
// byte-for-byte: zero-padded "YYYY-MM-DDTHH:MM", no seconds, no offset.
//
// DOCUMENTED DST EDGE BEHAVIOR (Luxon's, asserted by the self-test):
//   * Spring-forward GAP (e.g. 02:30 on a US spring-forward day doesn't exist):
//     the nonexistent wall time rolls FORWARD by the shift (02:30 -> 03:30 local).
//     A round-trip of a gap time is therefore NOT identity (the input never existed).
//   * Fall-back AMBIGUOUS (e.g. 01:30 on a US fall-back day happens twice):
//     resolves to the EARLIER occurrence (the pre-transition offset). Round-trip
//     of a real time is identity.

import { DateTime, IANAZone } from "luxon";

const WALL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const WALL_FMT = "yyyy-MM-dd'T'HH:mm";

/** True only for a real IANA zone name (e.g. "America/New_York"); false for a
 *  numeric offset, empty string, or garbage like "Mars/Phobos".
 *  NOTE: Luxon's IANAZone.isValidZone accepts bare numeric offsets ("-04:00",
 *  "+0530", "-04") as "valid". The wall-clock rule forbids offsets, so we reject
 *  any string starting with a sign+digit before trusting Luxon (no real IANA name
 *  starts that way; "Etc/GMT+4" and "America/..." are unaffected). */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0) return false;
  if (/^[+-]\d/.test(zone)) return false; // numeric offset, not an IANA zone name
  return IANAZone.isValidZone(zone);
}

function assertZone(zone: unknown): string {
  if (!isValidTimeZone(zone)) {
    throw new Error(`Invalid IANA timezone: ${JSON.stringify(zone)} (expected e.g. "America/New_York")`);
  }
  return zone;
}

/**
 * Real tz-aware instant -> zoneless wall-clock "YYYY-MM-DDTHH:MM" in `zone`.
 * The input must be a parseable instant carrying its own offset/Z (as Google
 * returns, e.g. "2026-07-01T14:00:00-04:00" or "...Z"). DST-correct: the same
 * UTC instant yields different wall digits in summer vs winter.
 */
export function instantToWallClock(instantISO: unknown, zone: unknown): string {
  const z = assertZone(zone);
  if (typeof instantISO !== "string" || !instantISO.trim()) {
    throw new Error(`Invalid instant: ${JSON.stringify(instantISO)}`);
  }
  // setZone:true respects the offset embedded in the string while parsing.
  const dt = DateTime.fromISO(instantISO, { setZone: true });
  if (!dt.isValid) throw new Error(`Unparseable instant "${instantISO}": ${dt.invalidReason}`);
  return dt.setZone(z).toFormat(WALL_FMT);
}

/**
 * Zoneless wall-clock "YYYY-MM-DDTHH:MM" + IANA zone -> a real instant, as an
 * RFC3339 string carrying the correct (DST-aware) offset, e.g.
 * "2026-07-01T00:00:00-04:00". This is the easy-to-miss OUTBOUND direction: the
 * query window / event time Clarity sends to Google must be a real instant, so
 * wall-clock midnight becomes 04:00Z in summer but 05:00Z in winter.
 *
 * Gap/ambiguous wall times follow the documented Luxon behavior above.
 */
export function wallClockToInstant(wallClock: unknown, zone: unknown): string {
  const z = assertZone(zone);
  if (typeof wallClock !== "string" || !WALL_RE.test(wallClock)) {
    throw new Error(`Invalid wall-clock string: ${JSON.stringify(wallClock)} (expected "YYYY-MM-DDTHH:MM")`);
  }
  const dt = DateTime.fromISO(wallClock, { zone: z });
  if (!dt.isValid) throw new Error(`Unconvertible wall-clock "${wallClock}" in ${z}: ${dt.invalidReason}`);
  const iso = dt.toISO({ suppressMilliseconds: true });
  if (!iso) throw new Error(`Could not serialize instant for "${wallClock}" in ${z}`);
  return iso;
}

/** Same as wallClockToInstant but normalized to UTC ("...Z"), for callers/APIs
 *  that prefer a Z-form instant. Same underlying instant, different spelling. */
export function wallClockToUtcInstant(wallClock: unknown, zone: unknown): string {
  const z = assertZone(zone);
  if (typeof wallClock !== "string" || !WALL_RE.test(wallClock)) {
    throw new Error(`Invalid wall-clock string: ${JSON.stringify(wallClock)} (expected "YYYY-MM-DDTHH:MM")`);
  }
  const dt = DateTime.fromISO(wallClock, { zone: z });
  if (!dt.isValid) throw new Error(`Unconvertible wall-clock "${wallClock}" in ${z}: ${dt.invalidReason}`);
  const iso = dt.toUTC().toISO({ suppressMilliseconds: true });
  if (!iso) throw new Error(`Could not serialize UTC instant for "${wallClock}" in ${z}`);
  return iso;
}
