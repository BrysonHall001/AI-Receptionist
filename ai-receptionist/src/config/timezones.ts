/**
 * The fixed set of business timezones a portal admin may choose from. The
 * dropdown shows the friendly label; the portal record stores the IANA `id`
 * (e.g. "America/New_York"). The server validates any saved value against this
 * list — free-text zones are rejected.
 *
 * Stored as a NAMED IANA zone, never a numeric offset, so daylight saving is
 * handled correctly when conversion is added later (Arizona and Hawaii are
 * included precisely because they do NOT observe DST).
 *
 * FOUNDATION ONLY: nothing converts time off this yet. It is stored for the
 * future Google Calendar integration; the app stays on the zoneless wall-clock
 * model until then.
 *
 * Keep this list in sync with the matching fallback list in public/js/portal.js.
 */
export const TIMEZONE_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "America/New_York", label: "Eastern (New York)" }, // default
  { id: "America/Chicago", label: "Central (Chicago)" },
  { id: "America/Denver", label: "Mountain (Denver)" },
  { id: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { id: "America/Phoenix", label: "Arizona (no daylight saving)" },
  { id: "Pacific/Honolulu", label: "Hawaii (no daylight saving)" },
];

/** The default timezone — US Eastern. Matches the Tenant.timezone column default. */
export const DEFAULT_TIMEZONE = "America/New_York";

/** True only for one of the allowed IANA zone ids above. */
export function isValidTimezone(id: unknown): id is string {
  return typeof id === "string" && TIMEZONE_OPTIONS.some((t) => t.id === id);
}
