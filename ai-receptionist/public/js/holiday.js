/**
 * THE HOLIDAY MARK.
 *
 * On a notable day the Clarity "C" in the search box becomes a small piece of artwork, and
 * hovering it says what the day is. It reverts by itself the next day. Nobody switches
 * anything on.
 *
 * TWO RULES THIS FILE EXISTS TO KEEP:
 *
 *  1. IT COSTS NOTHING, EVER. No network call, no third-party service, no remote image, no
 *     font, no dependency. Every glyph below is hand-authored inline SVG in this repo and
 *     every date is either computed here or read from the hand-checked table below.
 *
 *  2. IT CANNOT BREAK THE SEARCH BOX. Everything public here is wrapped so that ANY failure -
 *     a bad date, a missing glyph, a malformed registry entry, an outright throw - returns the
 *     ordinary mark. The search box's own code calls one function and can ignore the rest.
 *
 * The engine is permanent; the artwork accumulates. Adding a day later is one registry entry
 * plus one glyph.
 */
(function (global) {
  "use strict";
  var App = (global.App = global.App || {});

  // =========================================================================
  // DATES
  //
  // THE LOCAL CLOCK DECIDES, always. The mark is decoration for the person looking at it, so
  // someone in Sydney should see Christmas on their Christmas. Reading UTC here is exactly the
  // bug that shows a glyph a day early or a day late for most of the world, so every read
  // below is getFullYear/getMonth/getDate and never the UTC variants.
  // =========================================================================

  /** A plain {y, m, d} with m 1-12, from a local Date. */
  function partsOf(date) {
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
  }

  /** Days between two {y,m,d}, using UTC internally ONLY so DST cannot shift the count. */
  function daysBetween(a, b) {
    var A = Date.UTC(a.y, a.m - 1, a.d);
    var B = Date.UTC(b.y, b.m - 1, b.d);
    return Math.round((B - A) / 86400000);
  }

  /**
   * The nth weekday of a month. weekday 0-6 (Sunday first), n 1-5, or -1 for "the last".
   * "Last Monday in May" is the case that makes a naive nth-weekday helper wrong, so it is
   * handled explicitly rather than by guessing that the 5th always exists.
   */
  function nthWeekday(year, month1, weekday, n) {
    if (n === -1) {
      var last = new Date(year, month1, 0);            // day 0 of next month = last of this
      var back = (last.getDay() - weekday + 7) % 7;
      return { y: year, m: month1, d: last.getDate() - back };
    }
    var first = new Date(year, month1 - 1, 1);
    var forward = (weekday - first.getDay() + 7) % 7;
    var day = 1 + forward + (n - 1) * 7;
    var inMonth = new Date(year, month1 - 1, day);
    if (inMonth.getMonth() !== month1 - 1) return null; // that nth weekday does not exist
    return { y: year, m: month1, d: day };
  }

  // =========================================================================
  // THE TABLE
  //
  // WHY A TABLE AND NOT LUNAR MATHS. Ramadan, Eid, Lunar New Year, Diwali, Rosh Hashanah and
  // Hanukkah come from lunar and lunisolar calendars. Implementing those properly is a large
  // amount of code nobody here could check, and getting it subtly wrong would show the wrong
  // date for years without anyone noticing. Six hand-entered years can be read and checked in
  // a minute, cost nothing, and fail SAFELY: past the end of the table the day simply stops
  // being special rather than being wrong.
  //
  // WHERE THESE CAME FROM: widely published civil calendar dates. Ramadan and Eid in
  // particular depend on local moon sighting and are observed a day either side in some
  // places - the civil date is what is encoded, which is a choice rather than the one answer.
  //
  // TABLE RUNS OUT AFTER 2031. After that these days are ordinary days. Nothing breaks.
  // Extending it is adding a line per year.
  // =========================================================================
  var TABLE_LAST_YEAR = 2031;
  var TABLE = {
    // Western (Gregorian) Easter Sunday.
    easter: { 2026: [4, 5], 2027: [3, 28], 2028: [4, 16], 2029: [4, 1], 2030: [4, 21], 2031: [4, 13] },
    // Lunar New Year (first day).
    lunar_new_year: { 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3], 2031: [1, 23] },
    // First day of Ramadan.
    ramadan: { 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [1, 15], 2030: [1, 5], 2031: [12, 15] },
    // Eid al-Fitr (1 Shawwal).
    eid_al_fitr: { 2026: [3, 19], 2027: [3, 9], 2028: [2, 25], 2029: [2, 14], 2030: [2, 4], 2031: [1, 24] },
    // Rosh Hashanah (first day).
    rosh_hashanah: { 2026: [9, 12], 2027: [10, 2], 2028: [9, 21], 2029: [9, 10], 2030: [9, 28], 2031: [9, 18] },
    // Diwali (the main day).
    diwali: { 2026: [11, 8], 2027: [10, 29], 2028: [10, 17], 2029: [11, 5], 2030: [10, 26], 2031: [11, 14] },
    // Hanukkah (first night).
    hanukkah: { 2026: [12, 4], 2027: [12, 24], 2028: [12, 12], 2029: [12, 1], 2030: [12, 20], 2031: [12, 9] },
  };

  /** A tabled date for a year, or null when the table has run out. Never throws. */
  function tabled(key, year) {
    var rows = TABLE[key];
    if (!rows) return null;
    var hit = rows[year];
    if (!hit || hit.length !== 2) return null;
    return { y: year, m: hit[0], d: hit[1] };
  }

  // =========================================================================
  // GLYPHS
  //
  // Every glyph: viewBox 0 0 24 24, stroke-width 2, round caps and joins, currentColor only.
  // A square viewBox letterboxes cleanly into the mark's real 14x16 footprint rather than
  // distorting, because the default preserveAspectRatio fits rather than stretches.
  //
  // THE MARK IS FOURTEEN PIXELS WIDE. Detail is the enemy: one clear idea per glyph.
  // =========================================================================
  var K = ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  function S(paths) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + paths + "</svg>";
  }

  var GLYPHS = {
    // NEW YEAR - a firework burst: rays from a centre. REJECTED: a champagne flute, whose
    // stem disappears entirely at fourteen pixels and whose bowl reads as a plain goblet.
    new_year: S('<path d="M12 3.6v3.2M12 17.2v3.2M3.6 12h3.2M17.2 12h3.2M6.1 6.1l2.3 2.3M15.6 15.6l2.3 2.3M17.9 6.1l-2.3 2.3M8.4 15.6l-2.3 2.3"' + K + '/><circle cx="12" cy="12" r="2.3"' + K + "/>"),

    // MARTIN LUTHER KING JR. DAY - an olive branch, for peace. REJECTED: a portrait, which is
    // impossible at this size and would amount to caricature; and a dove, whose wing and tail
    // collapse into an indistinct blob once the strokes merge.
    mlk: S('<path d="M5 19.5C9.5 15.5 14 11 19 6"' + K + '/><path d="M12.6 12.2c-.2-2.1 1.2-3.8 3.3-4 .2 2.1-1.2 3.8-3.3 4Z"' + K + '/><path d="M9 15.8c-.2-2.1 1.2-3.8 3.3-4 .2 2.1-1.2 3.8-3.3 4Z"' + K + "/>"),

    // LUNAR NEW YEAR - a hanging lantern. REJECTED: that year's zodiac animal, which changes
    // every year and is unreadable at this size whichever animal it is.
    lunar_new_year: S('<path d="M12 3.4v2.1M12 18.5v2.1"' + K + '/><ellipse cx="12" cy="12" rx="5" ry="6.5"' + K + '/><path d="M7.4 8.7h9.2M7.4 15.3h9.2"' + K + "/>"),

    // RAMADAN - a plain crescent, because the month is defined by the moon. The star is
    // deliberately held back for Eid, so the two read as related but never as each other.
    ramadan: S('<path d="M17.6 15.8A7.6 7.6 0 1 1 12 4.2a6.1 6.1 0 0 0 5.6 11.6Z"' + K + "/>"),

    // VALENTINE'S DAY - a heart. There is no second idea worth having here.
    valentines: S('<path d="M12 20.2s-7.2-4.6-7.2-9.7a4.1 4.1 0 0 1 7.2-2.7 4.1 4.1 0 0 1 7.2 2.7c0 5.1-7.2 9.7-7.2 9.7Z"' + K + "/>"),

    // ST PATRICK'S DAY - a shamrock: three leaves and a stem. The stem is what stops three
    // circles reading as the suggestion glyph. REJECTED: a pot of gold, which is two ideas,
    // and whose pot is just a bucket at this size.
    st_patricks: S('<circle cx="12" cy="7.6" r="3.1"' + K + '/><circle cx="8.2" cy="12.6" r="3.1"' + K + '/><circle cx="15.8" cy="12.6" r="3.1"' + K + '/><path d="M12 15.2v5.2"' + K + "/>"),

    // EID AL-FITR - a crescent WITH a star, the celebratory form, set against Ramadan's plain
    // crescent so the pair reads as a season and its feast rather than as one repeated glyph.
    eid_al_fitr: S('<path d="M15.6 15.4A6.4 6.4 0 1 1 10.8 4.9a5.1 5.1 0 0 0 4.8 10.5Z"' + K + '/><path d="M18.6 5.6l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3Z"' + K + "/>"),

    // EASTER - a decorated egg. REJECTED: a cross, which at this size reads as Good Friday
    // rather than Easter Sunday, and turns a bright day into a solemn one.
    easter: S('<ellipse cx="12" cy="13.4" rx="5.8" ry="7.6"' + K + '/><path d="M6.5 11.4h11M7.4 15.8h9.2"' + K + "/>"),

    // MEMORIAL DAY - a remembrance wreath with two ribbon tails. RESTRAINT IS THE POINT:
    // fireworks and waving flags were rejected outright, because celebratory imagery on a day
    // of mourning is exactly the thing that would be worse than no drawing at all.
    memorial: S('<circle cx="12" cy="10.4" r="6.2"' + K + '/><path d="M9.4 16.2 7.9 20.6M14.6 16.2l1.5 4.4"' + K + "/>"),

    // INDEPENDENCE DAY - one bold five-point star. REJECTED: a flag, whose stripes turn to
    // grey mush at fourteen pixels; and bunting, which is the same problem repeated.
    independence: S('<path d="M12 3.2l2.6 5.9 6.4.7-4.8 4.3 1.3 6.3L12 17.3l-5.5 3.1 1.3-6.3L3 9.8l6.4-.7Z"' + K + "/>"),

    // LABOR DAY - a hard hat, whose dome-plus-brim silhouette survives any size. REJECTED:
    // crossed tools, which are two ideas and tangle into a cross at small sizes.
    labor: S('<path d="M3.6 16.6h16.8"' + K + '/><path d="M5.8 16.6v-2.4a6.2 6.2 0 0 1 12.4 0v2.4"' + K + '/><path d="M9.9 8.6V5.8h4.2v2.8"' + K + "/>"),

    // ROSH HASHANAH - a shofar, taken from a wide flared mouth down to a narrow tip so the
    // taper is the recognisable part. REJECTED: apple and honey, which is two objects, and an
    // apple on its own is just fruit.
    rosh_hashanah: S('<path d="M20.4 5.4c-1.4 5.2-3.8 8.8-7.2 11-2.8 1.8-6 2.4-9.6 1.8"' + K + '/><path d="M20.4 5.4l-3.8.6M20.4 5.4l.6 3.8"' + K + "/>"),

    // HALLOWEEN - a pumpkin, read by its wide squat body and single rib. REJECTED: a ghost,
    // which is an unidentifiable blob once it is this small, and a bat, whose wings merge.
    halloween: S('<ellipse cx="12" cy="14.2" rx="7.4" ry="6.4"' + K + '/><path d="M12 7.8V4.6"' + K + '/><path d="M12 7.8c-2 0-3.6 2.9-3.6 6.4s1.6 6.4 3.6 6.4"' + K + "/>"),

    // DIWALI - a diya, the oil lamp: a shallow dish with one flame at its lip. REJECTED:
    // fireworks, which New Year already owns, and two of the same glyph is one too many.
    diwali: S('<path d="M4.4 14.2h15.2c0 3.1-3.4 5.2-7.6 5.2s-7.6-2.1-7.6-5.2Z"' + K + '/><path d="M17.2 13.9c1.7-1.3 1.9-3.1.6-4.8-.4 1.5-1.9 1.5-2.1 2.9-.1.9.4 1.5 1.5 1.9Z"' + K + "/>"),

    // THANKSGIVING - one autumn leaf on its stem. REJECTED: a turkey, whose feathers are
    // unreadable at any small size; and a cornucopia, which is simply a cone.
    thanksgiving: S('<path d="M12 20.8v-7.4"' + K + '/><path d="M12 13.4c-4.8 0-8-3.4-8-8.2 4.8 0 8 3.4 8 8.2Z"' + K + '/><path d="M12 13.4c4.8 0 8-3.4 8-8.2-4.8 0-8 3.4-8 8.2Z"' + K + "/>"),

    // HANUKKAH - a menorah reduced to its structure: a stem, two curved arms and three flames.
    // Nine candles at this size is nine vertical lines and reads as a barcode, so the
    // BRANCHING is drawn instead of the count. REJECTED: a dreidel, an indistinct spinning top.
    hanukkah: S('<path d="M12 9.4v8.8M8.2 18.2h7.6"' + K + '/><path d="M4.6 9.4c0 3.3 2 5.2 4.4 5.2M19.4 9.4c0 3.3-2 5.2-4.4 5.2"' + K + '/><path d="M4.6 7.3h.01M12 6.8h.01M19.4 7.3h.01"' + K + "/>"),

    // CHRISTMAS - a conifer in two tiers with a trunk. REJECTED: a bauble, which is a circle
    // with a hook and reads as a keyring; and a star, which Independence Day already has.
    christmas: S('<path d="M12 3.4 6.8 10.6h10.4Z"' + K + '/><path d="M12 8.4 4.9 17h14.2Z"' + K + '/><path d="M12 17v3.6M9.6 20.6h4.8"' + K + "/>"),

    // NEW YEAR'S EVE - a clock a moment short of midnight, which is the whole of the evening.
    // REJECTED: a champagne flute, for the same reason New Year's Day rejected it.
    new_years_eve: S('<circle cx="12" cy="12" r="8.4"' + K + '/><path d="M12 12V6.4M12 12l3.1 1.9"' + K + "/>"),
  };

  // =========================================================================
  // THE REGISTRY
  //
  // kind: "fixed"  -> month/day every year
  //       "rule"   -> nth weekday of a month; n of -1 means the last one
  //       "tabled" -> looked up above; absent past the end of the table
  //
  // days:     how long the occasion runs, default 1. The same glyph shows throughout.
  // priority: when two occasions land on one date the HIGHER number wins. Explicit here
  //           rather than accidental in the ordering, so a later insertion cannot change
  //           which glyph shows on a shared date.
  // =========================================================================
  var REGISTRY = [
    { id: "new_year", name: "New Year's Day", kind: "fixed", month: 1, day: 1, glyph: "new_year", priority: 60 },
    { id: "mlk", name: "Martin Luther King Jr. Day", kind: "rule", month: 1, weekday: 1, n: 3, glyph: "mlk", priority: 40 },
    { id: "lunar_new_year", name: "Lunar New Year", kind: "tabled", table: "lunar_new_year", glyph: "lunar_new_year", priority: 60 },
    { id: "ramadan", name: "Ramadan", kind: "tabled", table: "ramadan", days: 30, glyph: "ramadan", priority: 30 },
    { id: "valentines", name: "Valentine's Day", kind: "fixed", month: 2, day: 14, glyph: "valentines", priority: 50 },
    { id: "st_patricks", name: "St Patrick's Day", kind: "fixed", month: 3, day: 17, glyph: "st_patricks", priority: 50 },
    { id: "eid_al_fitr", name: "Eid al-Fitr", kind: "tabled", table: "eid_al_fitr", glyph: "eid_al_fitr", priority: 60 },
    { id: "easter", name: "Easter Sunday", kind: "tabled", table: "easter", glyph: "easter", priority: 60 },
    { id: "memorial", name: "Memorial Day", kind: "rule", month: 5, weekday: 1, n: -1, glyph: "memorial", priority: 40 },
    { id: "independence", name: "Independence Day", kind: "fixed", month: 7, day: 4, glyph: "independence", priority: 60 },
    { id: "labor", name: "Labor Day", kind: "rule", month: 9, weekday: 1, n: 1, glyph: "labor", priority: 40 },
    { id: "rosh_hashanah", name: "Rosh Hashanah", kind: "tabled", table: "rosh_hashanah", days: 2, glyph: "rosh_hashanah", priority: 55 },
    { id: "halloween", name: "Halloween", kind: "fixed", month: 10, day: 31, glyph: "halloween", priority: 60 },
    { id: "diwali", name: "Diwali", kind: "tabled", table: "diwali", glyph: "diwali", priority: 60 },
    { id: "thanksgiving", name: "Thanksgiving", kind: "rule", month: 11, weekday: 4, n: 4, glyph: "thanksgiving", priority: 60 },
    { id: "hanukkah", name: "Hanukkah", kind: "tabled", table: "hanukkah", days: 8, glyph: "hanukkah", priority: 55 },
    { id: "christmas", name: "Christmas", kind: "fixed", month: 12, day: 25, glyph: "christmas", priority: 70 },
    { id: "new_years_eve", name: "New Year's Eve", kind: "fixed", month: 12, day: 31, glyph: "new_years_eve", priority: 50 },
  ];

  /** The start date of an occasion in a given year, or null if it has none that year. */
  function startOf(entry, year) {
    if (!entry || typeof entry !== "object") return null;
    if (entry.kind === "fixed") {
      if (!(entry.month >= 1 && entry.month <= 12) || !(entry.day >= 1 && entry.day <= 31)) return null;
      return { y: year, m: entry.month, d: entry.day };
    }
    if (entry.kind === "rule") return nthWeekday(year, entry.month, entry.weekday, entry.n);
    if (entry.kind === "tabled") return tabled(entry.table, year);
    return null;
  }

  /**
   * Which occasion, if any, covers this date. Checks the previous year too, because a span
   * that starts in late December can still be running in January.
   */
  function occasionOn(date) {
    var today = partsOf(date);
    var best = null;
    for (var i = 0; i < REGISTRY.length; i++) {
      var entry = REGISTRY[i];
      var span = entry.days > 0 ? entry.days : 1;
      for (var back = 0; back <= 1; back++) {
        var start = startOf(entry, today.y - back);
        if (!start) continue;
        var offset = daysBetween(start, today);
        if (offset < 0 || offset >= span) continue;
        var priority = typeof entry.priority === "number" ? entry.priority : 0;
        if (!best || priority > best.priority) best = { entry: entry, priority: priority };
        break;
      }
    }
    return best ? best.entry : null;
  }

  // =========================================================================
  // THE PUBLIC SURFACE — three functions, each of which cannot throw.
  // =========================================================================

  /** The occasion covering a date, or null. Never throws. */
  App.holidayFor = function (date) {
    try {
      var d = date instanceof Date ? date : new Date();
      if (isNaN(d.getTime())) return null;
      var hit = occasionOn(d);
      if (!hit) return null;
      // A registry entry naming a glyph that does not exist is a bug, and it must not show as
      // an empty box: treat it as no occasion at all.
      if (!hit.glyph || !GLYPHS[hit.glyph]) return null;
      if (!hit.name) return null;
      return { id: hit.id, name: hit.name, svg: GLYPHS[hit.glyph] };
    } catch (e) {
      return null;
    }
  };

  /**
   * THE ONE FUNCTION THE SEARCH BOX CALLS. Returns markup, always. On an ordinary day, on a
   * malformed entry, on a missing glyph, on a bad date, or on any throw at all, this is the
   * ordinary mark and the search box is none the wiser.
   */
  App.holidayMark = function (date) {
    try {
      var hit = App.holidayFor(date);
      if (!hit) return App.brandCSvg;
      return '<span class="search-c-holiday" title="' + String(hit.name).replace(/"/g, "&quot;") + '">' + hit.svg + "</span>";
    } catch (e) {
      return App.brandCSvg;
    }
  };

  /** Suite hooks. Not used by the app itself. */
  App.holiday = {
    REGISTRY: REGISTRY,
    GLYPHS: GLYPHS,
    TABLE: TABLE,
    TABLE_LAST_YEAR: TABLE_LAST_YEAR,
    nthWeekday: nthWeekday,
    startOf: startOf,
    occasionOn: occasionOn,
  };
})(typeof window !== "undefined" ? window : globalThis);
