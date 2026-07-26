/* eslint-disable */
// ============ ICON REGISTRY (create-ui-2 batch) ============
// ONE mechanism for page + module icons everywhere (portal navs, hub create
// rows, LC scenes). Inline SVG — the house precedent (automations arrow,
// compose toolbar, brandLogoSvg) — stroke currentColor so every theme inherits
// for free. KEYED BY KEYS, never labels: pages by href, modules by the
// registry's stable module key. Relabeling can never move an icon.
(function () {
  const App = (window.App = window.App || {});

  const S = (paths) =>
    `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">${paths}</svg>`;
  const K = ' stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"';

  // ---- Pages (by href) ----
  const PAGE_ICONS = {
    "#/dashboard": S(`<path d="M2.5 6.5 8 2.2l5.5 4.3v6.3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6.5Z"${K}/><path d="M6.3 13.6V9.4h3.4v4.2"${K}/>`),
    "#/calls": S(`<path d="M3 2.6h2.6l1.2 3-1.6 1.2a9.4 9.4 0 0 0 3.9 3.9l1.2-1.6 3 1.2v2.6a1 1 0 0 1-1.1 1A11.9 11.9 0 0 1 2 3.7a1 1 0 0 1 1-1.1Z"${K}/>`),
    "#/reports": S(`<path d="M2.6 2.6v10.8h10.8"${K}/><path d="M5.4 10.4V7.6M8.2 10.4V5.2M11 10.4V6.4"${K}/>`),
    "#/automations": S(`<path d="M8.8 1.8 3.6 9h3.5l-.9 5.2L11.4 7H7.9l.9-5.2Z"${K}/>`),
    "#/communication": S(`<rect x="2" y="3.4" width="12" height="9.2" rx="1.4"${K}/><path d="m2.6 4.4 5.4 4.4 5.4-4.4"${K}/>`),
    "#/learn": S(`<path d="M8 3.4c-1.2-.9-2.9-1.2-5.2-1V12c2.3-.2 4 .1 5.2 1 1.2-.9 2.9-1.2 5.2-1V2.4c-2.3-.2-4 .1-5.2 1Z"${K}/><path d="M8 3.4V13"${K}/>`),
    "#/feedback": S(`<path d="M13.6 8.6a5.6 5.6 0 0 1-8 5L2.4 14l.9-2.8a5.6 5.6 0 1 1 10.3-2.6Z"${K}/>`),
    "#/billing": S(`<rect x="2" y="3.8" width="12" height="8.4" rx="1.4"${K}/><path d="M2 6.6h12"${K}/><path d="M4.4 10h3.2"${K}/>`),
  };

  // ---- Modules (by stable module key) ----
  const MODULE_ICONS = {
    contact: S(`<circle cx="5.6" cy="5.6" r="2.2"${K}/><path d="M1.9 13.4a3.7 3.7 0 0 1 7.4 0"${K}/><circle cx="11.2" cy="6.4" r="1.8"${K}/><path d="M10.2 10.3a3.2 3.2 0 0 1 4 3.1"${K}/>`),
    job: S(`<rect x="2.2" y="5" width="11.6" height="8" rx="1.3"${K}/><path d="M5.6 5V3.6a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2V5"${K}/><path d="M2.2 8.4h11.6"${K}/>`),
    booking: S(`<rect x="2.2" y="3.2" width="11.6" height="10" rx="1.3"${K}/><path d="M2.2 6.4h11.6M5.4 2v2.4M10.6 2v2.4"${K}/>`),
    work_order: S(`<path d="M9.8 4.4a3.1 3.1 0 0 0-4.2 3.7L2.4 11.3a1.3 1.3 0 0 0 1.8 1.8l3.2-3.2a3.1 3.1 0 0 0 3.7-4.2L9 7.8l-1.9-.5-.5-1.9 3.2-1Z"${K}/>`),
    equipment: S(`<circle cx="8" cy="8" r="2"${K}/><path d="M8 1.9v2M8 12.1v2M1.9 8h2M12.1 8h2M3.7 3.7l1.4 1.4M10.9 10.9l1.4 1.4M12.3 3.7l-1.4 1.4M5.1 10.9l-1.4 1.4"${K}/>`),
    estimate: S(`<path d="M8.6 2.2H3.4a.9.9 0 0 0-.9.9v5.2c0 .24.1.47.26.63l5.6 5.6a.9.9 0 0 0 1.27 0l5.2-5.2a.9.9 0 0 0 0-1.27l-5.6-5.6a.9.9 0 0 0-.63-.26Z"${K}/><circle cx="5.6" cy="5.6" r=".9" fill="currentColor"/>`),
    invoice: S(`<path d="M3.4 2.2h9.2v11.6l-1.8-1-1.6 1-1.6-1-1.6 1-1.6-1-1 1V2.2Z"${K}/><path d="M5.6 5.4h4.8M5.6 8h4.8"${K}/>`),
    product: S(`<path d="M8 1.9 13.9 5v6L8 14.1 2.1 11V5L8 1.9Z"${K}/><path d="M2.4 5.2 8 8.1l5.6-2.9M8 8.1v5.8"${K}/>`),
    task: S(`<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.6"${K}/><path d="m5.2 8.2 1.9 1.9 3.7-4"${K}/>`),
    vehicle: S(`<path d="M1.9 9.6 3 5.8a1.2 1.2 0 0 1 1.1-.9h4.4l3 3h2.1a1 1 0 0 1 1 1v2.3H1.9V9.6Z"${K}/><circle cx="4.9" cy="12.2" r="1.3"${K}/><circle cx="11.3" cy="12.2" r="1.3"${K}/>`),
    property: S(`<path d="M3 13.6V4.2a1 1 0 0 1 1-1h4.4a1 1 0 0 1 1 1v9.4M9.4 6.6H12a1 1 0 0 1 1 1v6"${K}/><path d="M1.8 13.6h12.4M5 5.6h2.4M5 8h2.4M5 10.4h2.4"${K}/>`),
  };

  // The APPROVED custom-module default: one generic cube, everywhere, until a
  // per-module picker exists. (Auto-assignment from a pool was rejected in R1 —
  // arbitrary glyphs read as meaning.)
  const CUSTOM_DEFAULT = S(`<path d="M8 2.2 13.4 5v6L8 13.8 2.6 11V5L8 2.2Z"${K}/><path d="M2.9 5.2 8 7.9l5.1-2.7M8 7.9v5.6"${K}/><circle cx="8" cy="5" r=".01" stroke="currentColor" stroke-width="1.1"/>`),
    SYSTEM_MODULE_KEYS = Object.keys(MODULE_ICONS);

  function forModuleKey(key) {
    return MODULE_ICONS[key] || CUSTOM_DEFAULT;
  }

  // Resolve any NAV HREF to its icon: pages directly; module hrefs through the
  // key baked into the href (#/contacts, #/jobs, #/bookings are the three fixed
  // module hrefs; every other module is #/records/<key>).
  function forNavHref(href) {
    if (PAGE_ICONS[href]) return PAGE_ICONS[href];
    if (href === "#/contacts") return MODULE_ICONS.contact;
    if (href === "#/jobs") return MODULE_ICONS.job;
    if (href === "#/bookings") return MODULE_ICONS.booking;
    const m = /^#\/records\/(.+)$/.exec(String(href || ""));
    if (m) return forModuleKey(m[1]);
    return null; // unknown page: no icon (never a wrong one)
  }

  // The stable ICON KEY a DOM hook can assert on (data-ic-key).
  function keyForNavHref(href) {
    if (PAGE_ICONS[href]) return "page:" + href.slice(2);
    if (href === "#/contacts") return "module:contact";
    if (href === "#/jobs") return "module:job";
    if (href === "#/bookings") return "module:booking";
    const m = /^#\/records\/(.+)$/.exec(String(href || ""));
    if (m) return SYSTEM_MODULE_KEYS.indexOf(m[1]) >= 0 ? "module:" + m[1] : "module:custom";
    return null;
  }

  // Create-page v2: template-card + AI-segment glyphs, same weight system.
  // UI-fidelity v3 (owner's mockup): General = sparkle constellation;
  // Field Services = crossed tools (wrench + screwdriver).
  const TEMPLATE_ICONS = {
    general: S(`<path d="M8.6 3.2 9.7 6.9l3.7 1.1-3.7 1.1-1.1 3.7-1.1-3.7L3.8 8l3.7-1.1 1.1-3.7Z"${K}/><path d="M3.9 2.6v2M2.9 3.6h2"${K}/><path d="M12.9 12.2v1.8M12 13.1h1.8"${K}/>`),
    field_services: S(`<path d="M5.9 7.1 3 4.2a2.1 2.1 0 0 1 2.6-2.6l-.9 1.6.9 1.2 1.5.2 1-1.7A2.1 2.1 0 0 1 5.9 7.1Z"${K}/><path d="m6.2 6.9 6.4 6.4"${K}/><path d="M12.9 3.1 6.7 9.3M12.9 3.1l.9 1 -1.4 2.2-1.7.3"${K}/><path d="m4.6 10.9 2.7 2.7-1.2 1.2a1.9 1.9 0 0 1-2.7-2.7l1.2-1.2Z"${K}/>`),
    __default: CUSTOM_DEFAULT,
  };
  // UI-fidelity v3 (owner's mockup): power / telephone / diamond.
  const AI_STATE_ICONS = {
    OFF: S(`<path d="M8 1.9v5.4"${K}/><path d="M5 3.9a5.3 5.3 0 1 0 6 0"${K}/>`),
    WALKIE: S(`<path d="M2.2 6.4c0-1 .5-1.8 1.4-2.1a13.6 13.6 0 0 1 8.8 0c.9.3 1.4 1.1 1.4 2.1v1.2a.9.9 0 0 1-1 .9l-2-.2a.9.9 0 0 1-.8-.9v-.9a7.9 7.9 0 0 0-3.9 0v.9a.9.9 0 0 1-.8.9l-2 .2a.9.9 0 0 1-1-.9V6.4Z"${K}/><path d="M8 9.2v2.6M5.4 13.4h5.2M6.1 11.8h3.8"${K}/>`),
    SMOOTH: S(`<path d="M4.6 2.8h6.8l2.6 3.4L8 13.6 2 6.2l2.6-3.4Z"${K}/><path d="M2 6.2h12M5.9 6.2 8 13.6 10.1 6.2M4.6 2.8l1.3 3.4M11.4 2.8l-1.3 3.4"${K}/>`),
  };
  function forTemplateKey(key) { return TEMPLATE_ICONS[key] || TEMPLATE_ICONS.__default; }

  App.icons = { forModuleKey, forNavHref, keyForNavHref, forTemplateKey, PAGE_ICONS, MODULE_ICONS, CUSTOM_DEFAULT, TEMPLATE_ICONS, AI_STATE_ICONS };
})();
