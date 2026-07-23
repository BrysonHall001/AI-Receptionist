// Registry-driven record-type NAV model (foundation). Pure functions (no DOM), so
// app.js consumes them AND a Node self-test can load this file directly.
//
// Convention: the three SYSTEM record types keep their historical bespoke hrefs
// (#/contacts, #/jobs, #/bookings) — too much depends on them — while ANY OTHER
// record type uses #/records/<key>. The portal nav = the fixed pages with one item
// per record type spliced in where the three sit today. For a portal that has only
// the three system types this is byte-for-byte the historical PORTAL_NAV.
(function (global) {
  var App = global.App || (global.App = {});

  var SYSTEM_RT_HREF = { contact: "#/contacts", job: "#/jobs", booking: "#/bookings" };

  // href for a record type key (system → bespoke; other → #/records/<key>).
  App.recordTypeHref = function (key) { return SYSTEM_RT_HREF[key] || ("#/records/" + key); };

  // The record types that drive the nav: the live list once fetched into
  // App.state.recordTypes, else the three system types (which ALWAYS exist), so the
  // nav is identical today even before any fetch. Registry order.
  App.recordTypesForNav = function () {
    var live = App.state && App.state.recordTypes;
    if (Array.isArray(live) && live.length) return live;
    return [
      { key: "contact", label: "Contact", labelPlural: "Contacts" },
      { key: "job", label: "Job Opening", labelPlural: "Job Openings" }, // stock label since the Work Orders batch
      { key: "booking", label: "Booking", labelPlural: "Bookings" },
    ];
  };

  // [href, defaultLabel, kind] per record type. defaultLabel is only a fallback —
  // the sidebar relabels record items via App.label(kind,"many").
  App.recordTypeNavItems = function () {
    return App.recordTypesForNav().map(function (t) {
      return [App.recordTypeHref(t.key), t.labelPlural || t.label || t.key, t.key];
    });
  };

  // Full portal nav = fixed pages + record-type items spliced after Calls / before Analytics.
  App.buildPortalNav = function () {
    var before = [["#/dashboard", "Home Dashboard"], ["#/calls", "Calls"]];
    var after = [["#/reports", "Analytics"], ["#/automations", "Automations"], ["#/communication", "Communication"], ["#/learn", "Learning Center"], ["#/feedback", "Feedback"]];
    return before.concat(App.recordTypeNavItems(), after);
  };

  // Hrefs that make up the "records" permission area — ALL non-contact record types
  // (jobs, bookings, and any future type). Contact has its own area.
  App.recordsAreaHrefs = function () {
    var hrefs = [];
    App.recordTypesForNav().forEach(function (t) { if (t.key !== "contact") hrefs.push(App.recordTypeHref(t.key)); });
    return hrefs;
  };

  // Router path → portal view-key for record types. System types map to their
  // bespoke view keys; a future type maps to null (its page view is wired later).
  var RT_VIEW_KEY = { contact: "contacts", job: "jobs", booking: "bookings" };
  App.recordTypePortalViews = function () {
    var m = {};
    App.recordTypesForNav().forEach(function (t) { m[App.recordTypeHref(t.key).slice(1)] = RT_VIEW_KEY[t.key] || null; });
    return m;
  };
})(typeof window !== "undefined" ? window : globalThis);
