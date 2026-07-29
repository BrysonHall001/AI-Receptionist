// ROUTE AWARENESS (client) — the SAME arithmetic the server module uses, so a
// board and a report can never disagree about how far apart two jobs are.
//
// NO NETWORK: nothing here calls anything. It is pure maths over coordinates
// the calendar feed already carries, and it returns null — never a guess — when
// either end has no coordinates.
(function () {
  const App = (window.App = window.App || {});

  const TRAVEL = {
    WINDING_FACTOR: 1.3,     // roads are not straight lines
    AVERAGE_MPH: 30,         // mixed urban/suburban service driving
    MIN_STOP_MINUTES: 5,     // same address still means wrapping up and setting up
    TOLERANCE_MINUTES: 5,    // slack before a tight gap is called impossible
    EARTH_RADIUS_MILES: 3958.8,
  };

  function hasCoords(p) {
    if (!p) return false;
    const lat = p.lat, lng = p.lng;
    if (typeof lat !== "number" || typeof lng !== "number") return false;
    if (!isFinite(lat) || !isFinite(lng)) return false;
    if (lat === 0 && lng === 0) return false;   // null island: a geocoder failure
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  const toRad = (d) => (d * Math.PI) / 180;

  function straightLineMiles(a, b) {
    if (!hasCoords(a) || !hasCoords(b)) return null;
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const dLat = lat2 - lat1, dLng = toRad(b.lng - a.lng);
    const h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * TRAVEL.EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function travelMinutes(a, b) {
    const miles = straightLineMiles(a, b);
    if (miles === null) return null;
    return Math.max(TRAVEL.MIN_STOP_MINUTES, Math.round(((miles * TRAVEL.WINDING_FACTOR) / TRAVEL.AVERAGE_MPH) * 60));
  }

  function formatTravel(minutes) {
    if (minutes === null || !isFinite(minutes)) return "";
    if (minutes < 60) return Math.round(minutes) + " min";
    const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
    return m ? h + " hr " + m + " min" : h + " hr";
  }

  const wallToMs = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ""));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  };

  function legVerdict(prev, next) {
    const prevEnd = wallToMs(prev && (prev.end || prev.start));
    const nextStart = wallToMs(next && next.start);
    if (prevEnd === null || nextStart === null) return { minutes: null, implausible: false, gapMinutes: null, reason: "no_times" };
    if (nextStart < prevEnd) return { minutes: null, implausible: false, gapMinutes: null, reason: "overlapping" };
    const gapMinutes = Math.round((nextStart - prevEnd) / 60000);
    const minutes = travelMinutes(prev, next);
    if (minutes === null) return { minutes: null, implausible: false, gapMinutes: gapMinutes, reason: "no_coordinates" };
    return { minutes: minutes, implausible: minutes > gapMinutes + TRAVEL.TOLERANCE_MINUTES, gapMinutes: gapMinutes, reason: "ok" };
  }

  function summariseDay(stops) {
    const ordered = (stops || []).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const out = { totalMinutes: 0, longestMinutes: 0, estimatedLegs: 0, unknownLegs: 0, implausibleLegs: 0 };
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

  App.travel = { TRAVEL, hasCoords, straightLineMiles, travelMinutes, formatTravel, legVerdict, summariseDay };
})();
