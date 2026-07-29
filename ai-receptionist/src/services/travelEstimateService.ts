// TRAVEL ESTIMATION — how long it plausibly takes to drive between two stops.
//
// WHAT THIS IS: straight-line distance between two geocoded points, bent by a
// winding factor and divided by an assumed speed. Pure arithmetic over
// coordinates the system already stores.
//
// WHAT THIS IS NOT: routing. No directions API is called from here or anywhere
// else in this batch — no Mapbox Directions, no Matrix, no per-request cost, no
// new credential. The purpose is catching a schedule that CANNOT happen, not
// telling anyone when they will arrive.
//
// HONEST ERROR BAND: expect +/- 40-60% on any single leg. A straight line badly
// under-reads a river crossing, a one-way system or a motorway detour, and one
// assumed speed cannot be right for both a city centre and a rural round. Every
// surface that shows these numbers says "estimated", and nothing in the product
// blocks a dispatcher on the strength of one.
//
// NO I/O: every function here is pure, so it is unit-testable and cannot slow a
// request path.

/**
 * The four constants, in ONE place. Change them here and every surface follows.
 */
export const TRAVEL = {
  /** Roads are not straight lines. Applied to great-circle distance. */
  WINDING_FACTOR: 1.3,
  /** Mixed urban/suburban service driving, not motorway cruising, in mph. */
  AVERAGE_MPH: 30,
  /** Two jobs at the SAME address still take time to wrap up and set up. */
  MIN_STOP_MINUTES: 5,
  /** Slack before a tight gap is called implausible, so a 1-minute overrun
   *  doesn't shout. */
  TOLERANCE_MINUTES: 5,
  /** Earth's mean radius, in miles. */
  EARTH_RADIUS_MILES: 3958.8,
};

export interface Point { lat: number | null | undefined; lng: number | null | undefined }

/** True only for a usable coordinate pair. Everything else is "unknown". */
export function hasCoords(p: Point | null | undefined): boolean {
  if (!p) return false;
  const { lat, lng } = p;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;                 // null island: a geocoder failure, not a place
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in miles, or null when either end is unknown. */
export function straightLineMiles(a: Point, b: Point): number | null {
  if (!hasCoords(a) || !hasCoords(b)) return null;
  const lat1 = toRad(a.lat as number);
  const lat2 = toRad(b.lat as number);
  const dLat = lat2 - lat1;
  const dLng = toRad((b.lng as number) - (a.lng as number));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * TRAVEL.EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Estimated driving minutes between two stops.
 *
 * Returns NULL — never 0, never a guess — when either endpoint has no
 * coordinates. Callers render nothing at all in that case.
 */
export function travelMinutes(a: Point, b: Point): number | null {
  const miles = straightLineMiles(a, b);
  if (miles === null) return null;
  const roadMiles = miles * TRAVEL.WINDING_FACTOR;
  const minutes = (roadMiles / TRAVEL.AVERAGE_MPH) * 60;
  return Math.max(TRAVEL.MIN_STOP_MINUTES, Math.round(minutes));
}

/** "23 min" / "1 hr 5 min" — the one place travel durations are worded. */
export function formatTravel(minutes: number | null): string {
  if (minutes === null || !isFinite(minutes)) return "";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export interface Stop {
  /** Wall-clock "YYYY-MM-DDTHH:MM" — the same zoneless shape the rest of the app uses. */
  start: string;
  end?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface LegVerdict {
  /** null when either stop is ungeocoded, or when the blocks overlap. */
  minutes: number | null;
  /** True only when we KNOW the sequence cannot happen. */
  implausible: boolean;
  /** Minutes actually available between the two stops, when both are timed. */
  gapMinutes: number | null;
  /** Why there is no estimate, for the reader of a log rather than the UI. */
  reason: "ok" | "no_coordinates" | "overlapping" | "no_times";
}

const wallToMs = (s: string | null | undefined): number | null => {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
};

/**
 * The verdict for one ordered pair of stops.
 *
 * ONE SEVERITY, deliberately: with a +/- 50% error band, grading "tight" versus
 * "impossible" would imply a precision these numbers do not have. Either we can
 * say the sequence cannot happen, or we say nothing.
 */
export function legVerdict(prev: Stop, next: Stop): LegVerdict {
  const startPrevEnd = wallToMs(prev.end || prev.start);
  const startNext = wallToMs(next.start);
  if (startPrevEnd === null || startNext === null) {
    return { minutes: null, implausible: false, gapMinutes: null, reason: "no_times" };
  }
  // OVERLAPPING blocks: travel between two jobs happening at once is not a
  // meaningful number. Overlap behaviour itself is untouched by this batch.
  if (startNext < startPrevEnd) {
    return { minutes: null, implausible: false, gapMinutes: null, reason: "overlapping" };
  }
  const gapMinutes = Math.round((startNext - startPrevEnd) / 60000);
  const minutes = travelMinutes(prev as Point, next as Point);
  if (minutes === null) {
    return { minutes: null, implausible: false, gapMinutes, reason: "no_coordinates" };
  }
  return {
    minutes,
    implausible: minutes > gapMinutes + TRAVEL.TOLERANCE_MINUTES,
    gapMinutes,
    reason: "ok",
  };
}

export interface DaySummary {
  /** Sum of the legs we could estimate. */
  totalMinutes: number;
  /** The longest single hop, for the "worst leg" line. */
  longestMinutes: number;
  /** How many legs had an estimate, and how many did not. */
  estimatedLegs: number;
  unknownLegs: number;
  implausibleLegs: number;
}

/**
 * One technician's day: stops in start order, the legs between them summed.
 * Stops without coordinates simply contribute nothing — the total is honest
 * about being a total of what could be estimated.
 */
export function summariseDay(stops: Stop[]): DaySummary {
  const ordered = (stops || []).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const out: DaySummary = { totalMinutes: 0, longestMinutes: 0, estimatedLegs: 0, unknownLegs: 0, implausibleLegs: 0 };
  for (let i = 1; i < ordered.length; i++) {
    const v = legVerdict(ordered[i - 1], ordered[i]);
    if (v.minutes === null) { out.unknownLegs += 1; continue; }
    out.estimatedLegs += 1;
    out.totalMinutes += v.minutes;
    if (v.minutes > out.longestMinutes) out.longestMinutes = v.minutes;
    if (v.implausible) out.implausibleLegs += 1;
  }
  return out;
}
