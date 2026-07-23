(function (global) {
  const App = global.App || (global.App = {});

  // Product brand — change this one line to rename the app everywhere in-app.
  App.BRAND = "Clarity CRM";

  // Brand logo as INLINE SVG (no external file needed, so it can't be broken by
  // static-file serving or caching, and always sizes correctly). Used by the
  // sidebar header (default branding) and the login page. Sizing is handled in
  // CSS (.brand-logo--full svg / .brand-logo--icon svg / .auth-logo svg).
  // MOTION & BRANDING: the default brand is THEME-AWARE — the C phone-mark takes
  // var(--accent) and the "larity" wordmark takes var(--ink), so every preset (and any
  // custom accent) re-tints the logo instantly. Same geometry as the original asset.
  // White-label is untouched: an uploaded tenant logo still REPLACES this entirely
  // (renderBrand's `if (logo)` branch never reaches these constants).
  App.brandLogoSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 372 96" role="img" aria-label="Clarity">` +
    `<g transform="translate(8,12)" fill="var(--accent)" class="brand-c">` +
    `<path d="M58.06 19.94 A27 27 0 1 0 58.06 60.06 L52.04 53.37 A18 18 0 1 1 52.04 26.63 Z"/>` +
    `<ellipse cx="55.05" cy="23.28" rx="13" ry="9" transform="rotate(-48 55.05 23.28)"/>` +
    `<ellipse cx="55.05" cy="56.72" rx="13" ry="9" transform="rotate(48 55.05 56.72)"/>` +
    `<path d="M58.68 9.76 A14 14 0 0 1 68.36 18.95" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M59.71 5.90 A18 18 0 0 1 72.17 17.72" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" opacity="0.6"/>` +
    `</g>` +
    `<text x="92" y="78" font-family="'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif" font-size="76" font-weight="700" letter-spacing="-2" fill="var(--ink)" class="brand-word">larity</text>` +
    `</svg>`;
  App.brandIconSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="Clarity">` +
    `<rect width="240" height="240" rx="54" fill="var(--accent)"/>` +
    `<g transform="translate(14.7,16) scale(2.6)" fill="var(--on-accent)">` +
    `<path d="M58.06 19.94 A27 27 0 1 0 58.06 60.06 L52.04 53.37 A18 18 0 1 1 52.04 26.63 Z"/>` +
    `<ellipse cx="55.05" cy="23.28" rx="13" ry="9" transform="rotate(-48 55.05 23.28)"/>` +
    `<ellipse cx="55.05" cy="56.72" rx="13" ry="9" transform="rotate(48 55.05 56.72)"/>` +
    `<path d="M58.68 9.76 A14 14 0 0 1 68.36 18.95" fill="none" stroke="var(--on-accent)" stroke-width="2.4" stroke-linecap="round" opacity="0.9"/>` +
    `<path d="M59.71 5.90 A18 18 0 0 1 72.17 17.72" fill="none" stroke="var(--on-accent)" stroke-width="2.4" stroke-linecap="round" opacity="0.6"/>` +
    `</g>` +
    `</svg>`;

  // MOTION & BRANDING: the small standalone C mark (same geometry as the logo's C),
  // decorative, token-colored — used inside the shared search box.
  App.brandCSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="24 8 68 84" aria-hidden="true" focusable="false">` +
    `<g transform="translate(8,12)" fill="var(--accent)">` +
    `<path d="M58.06 19.94 A27 27 0 1 0 58.06 60.06 L52.04 53.37 A18 18 0 1 1 52.04 26.63 Z"/>` +
    `<ellipse cx="55.05" cy="23.28" rx="13" ry="9" transform="rotate(-48 55.05 23.28)"/>` +
    `<ellipse cx="55.05" cy="56.72" rx="13" ry="9" transform="rotate(48 55.05 56.72)"/>` +
    `<path d="M58.68 9.76 A14 14 0 0 1 68.36 18.95" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M59.71 5.90 A18 18 0 0 1 72.17 17.72" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" opacity="0.6"/>` +
    `</g></svg>`;
  // LC-2 — THE shared stepper: a flat, instructional prev/next carousel (frames, dots,
  // per-frame captions, keyboard arrows). Built as a general component — the Learning
  // Center's visual demos are its first consumer. Transitions are opacity-only on the
  // motion token; the global prefers-reduced-motion block makes swaps instant.
  App.ui = App.ui || {};
  App.ui.stepper = function (frames, opts) {
    opts = opts || {};
    const root = document.createElement("div");
    root.className = "lstep";
    root.tabIndex = 0;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", opts.label || "Step-by-step illustration");
    const viewport = document.createElement("div");
    viewport.className = "lstep-viewport";
    root.appendChild(viewport);
    const caption = document.createElement("div");
    caption.className = "scene-caption";
    const controls = document.createElement("div");
    controls.className = "lstep-controls";
    const prev = document.createElement("button");
    prev.className = "icon-btn lstep-arrow"; prev.type = "button"; prev.innerHTML = "&larr;"; prev.setAttribute("aria-label", "Previous step");
    const dotsWrap = document.createElement("div");
    dotsWrap.className = "lstep-dots";
    const next = document.createElement("button");
    next.className = "icon-btn lstep-arrow"; next.type = "button"; next.innerHTML = "&rarr;"; next.setAttribute("aria-label", "Next step");
    controls.appendChild(prev); controls.appendChild(dotsWrap); controls.appendChild(next);
    let idx = 0;
    const frameEls = frames.map(function (f, i) {
      const fr = document.createElement("div");
      fr.className = "lstep-frame" + (i === 0 ? " active" : "");
      fr.appendChild(f.el);
      viewport.appendChild(fr);
      const dot = document.createElement("button");
      dot.className = "lstep-dot" + (i === 0 ? " active" : ""); dot.type = "button";
      dot.setAttribute("aria-label", "Step " + (i + 1) + " of " + frames.length);
      dot.onclick = function () { go(i); };
      dotsWrap.appendChild(dot);
      return fr;
    });
    function go(i) {
      idx = (i + frames.length) % frames.length;
      frameEls.forEach(function (fr, j) { fr.classList.toggle("active", j === idx); });
      Array.prototype.forEach.call(dotsWrap.children, function (d, j) { d.classList.toggle("active", j === idx); });
      caption.textContent = frames[idx].caption || "";
      prev.disabled = idx === 0; next.disabled = idx === frames.length - 1;
    }
    prev.onclick = function () { if (idx > 0) go(idx - 1); };
    next.onclick = function () { if (idx < frames.length - 1) go(idx + 1); };
    root.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); if (idx > 0) go(idx - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); if (idx < frames.length - 1) go(idx + 1); }
    });
    caption.textContent = frames[0] && frames[0].caption || "";
    prev.disabled = true; next.disabled = frames.length <= 1;
    root.appendChild(caption);
    if (frames.length > 1) root.appendChild(controls);
    return root;
  };

  // MOTION & BRANDING — shared skeletons. showSkeleton(host, kind) waits
  // SKELETON_DELAY_MS (150) and only inserts the shimmer if the host is STILL empty —
  // fast fetches never flash one; the real render simply replaces innerHTML, so the
  // skeleton can never outlive the data. Shapes match the incoming content: "table" =
  // a header band + rows; "widgets" = a grid of widget-sized blocks. Shimmer colors
  // are tokens (--gray-soft / --panel-2); the global reduced-motion block freezes the
  // sweep into static shapes.
  App.util = App.util || {}; // HOTFIX KEPT: without this guard + the Object.assign merge below, the later canonical assignment CLOBBERED showSkeleton/searchBox/SKELETON_DELAY_MS
  App.util.SKELETON_DELAY_MS = 150;
  App.util.showSkeleton = function (host, kind) {
    host.innerHTML = "";
    const t = setTimeout(function () {
      if (host.childElementCount) return; // data beat the delay — never flash
      const wrap = document.createElement("div");
      if (kind === "widgets") {
        wrap.className = "skel-widgets";
        wrap.innerHTML = new Array(4).fill('<div class="skel-shimmer skel-widget" aria-hidden="true"></div>').join("");
      } else {
        wrap.className = "card skel-table";
        wrap.setAttribute("aria-busy", "true");
        wrap.innerHTML = '<div class="skel-shimmer skel-head" aria-hidden="true"></div>' + new Array(6).fill('<div class="skel-shimmer skel-line" aria-hidden="true"></div>').join("");
      }
      host.appendChild(wrap);
    }, App.util.SKELETON_DELAY_MS);
    return { cancel: function () { clearTimeout(t); } };
  };

  // THE shared search box: magnifier left (currentColor -> --ink-faint via CSS),
  // the C mark right (decorative, hidden while the input is non-empty via the pure-CSS
  // :placeholder-shown sibling rule — no JS state to drift). Wraps the given input;
  // the input keeps its .search-input class so every existing selector still matches.
  App.util.searchBox = function (input) {
    const box = document.createElement("span");
    box.className = "search-box";
    box.innerHTML =
      `<span class="search-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg></span>`;
    box.appendChild(input);
    box.insertAdjacentHTML("beforeend", `<span class="search-c" aria-hidden="true">${App.brandCSvg}</span>`);
    return box;
  };

  App.state = { me: null, currentPortalId: null, currentPortalName: null, labels: { types: {}, generic: {} }, features: {} };
  // Client-visible feature flags come from /api/auth/me (features). Texting/SMS is
  // hidden across the UI when this is false (server also gates the send path).
  App.smsEnabled = function () { return !!(App.state.features && App.state.features.smsEnabled); };

  // Top admin tier: OWNER, SUPER_ADMIN, or AUDITOR (a tester with the same full
  // reach as super-admin). Mirrors the server's isAdminTier so the UI treats all
  // three the same (master hub, impersonation, nav-edit, etc.).
  App.isAdminTier = function (role) { return role === "OWNER" || role === "SUPER_ADMIN" || role === "AUDITOR"; };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  };
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = new Date();
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + `, ${time}`;
  }
  // Date-only, wall-clock-safe: shows the calendar day from a date/ISO string with
  // NO local-timezone conversion and NO time. Reads the Y-M-D digits and renders
  // them in UTC, so a date stored at UTC midnight (e.g. the Change Log) never slips
  // to the previous evening. Same UTC-slot pattern the booking calendar uses.
  function fmtDateOnly(iso) {
    if (!iso) return "—";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return "—";
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
      .toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  }

  function statusBadge(status) {
    const map = {
      COMPLETED: ["badge-completed", "Completed"],
      FAILED: ["badge-failed", "Missed"],
      COLLECTING_INFO: ["badge-progress", "In progress"],
      GREETING: ["badge-progress", "In progress"],
      INIT: ["badge-neutral", "New"],
      ACTIVE: ["badge-completed", "Active"],
      SUSPENDED: ["badge-failed", "Suspended"],
    };
    const [cls, label] = map[status] || ["badge-neutral", status || "—"];
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  function roleLabel(role) {
    return { OWNER: "Owner", SUPER_ADMIN: "Super Admin", PORTAL_ADMIN: "Portal Admin", CLIENT_USER: "Client User", AUDITOR: "Auditor" }[role] || role;
  }

  function toast(message, isError) {
    let host = $("#toasts");
    if (!host) {
      host = el("div", "toasts");
      host.id = "toasts";
      document.body.appendChild(host);
    }
    const t = el("div", "toast" + (isError ? " error" : ""));
    t.appendChild(el("span", "toast-dot"));
    t.appendChild(el("span", null, esc(message)));
    host.appendChild(t);
    setTimeout(() => {
      t.classList.add("toast-fading");
      
      setTimeout(() => t.remove(), 200);
    }, 2800);
  }

  function debounce(fn, ms) {
    let h;
    return (...args) => {
      clearTimeout(h);
      h = setTimeout(() => fn(...args), ms);
    };
  }

  // Core API call. Redirects to login on 401.
  async function api(path, opts) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...(opts || {}),
    });
    if (res.status === 401) {
      App.state.me = null;
      if (location.hash.indexOf("#/reset") !== 0) location.hash = "#/login";
      throw new Error("Not authenticated");
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.data = data; err.status = res.status; throw err; }
    return data;
  }

  // Portal-scoped API: a super admin appends ?tenantId of the portal they entered.
  function portalApi(path, opts) {
    let url = path;
    if (App.state.me && App.isAdminTier(App.state.me.role) && App.state.currentPortalId) {
      url += (url.indexOf("?") >= 0 ? "&" : "?") + "tenantId=" + encodeURIComponent(App.state.currentPortalId);
    }
    return api(url, opts);
  }

  Object.assign(App.util, { $, $$, el, esc, fmtDate, fmtDateOnly, statusBadge, roleLabel, toast, debounce }); // HOTFIX KEPT: merge, never replace (the skeleton/search helpers registered above must survive)
  App.api = api;
  App.portalApi = portalApi;

  // ===================== NAMING LAYER (Step 1: foundation) =====================
  // Built-in English defaults — the FINAL fallback so nothing breaks before the
  // cache loads or when a word has no override. Record-type words (contact/job)
  // normally come from live data and override these.
  const LABEL_DEFAULTS = {
    contact: { one: "Contact", many: "Contacts" },
    job: { one: "Job Opening", many: "Job Openings" }, // relabeled (Work Orders batch) — recruiting reads as what it is
    work_order: { one: "Work Order", many: "Work Orders" },
    record: { one: "Record", many: "Records" },
    stage: { one: "Stage", many: "Stages" },
    resource: { one: "Resource", many: "Resources" },
    candidate: { one: "Candidate", many: "Candidates" },
  };

  // App.label(kind, form) -> the per-portal display word for this portal.
  //   kind: a record-type key ("contact","job",…) or a generic word ("record","stage")
  //   form: "one" (singular, default) or "many" (plural)
  // Fallback chain (first hit wins):
  //   1) live record-type label/labelPlural  (App.state.labels.types[kind])
  //   2) per-portal generic override bag      (App.state.labels.generic[kind])
  //   3) built-in English default            (LABEL_DEFAULTS[kind])
  //   4) the kind string itself, capitalized  (last-ditch, never blank)
  // NOTE: returns the word in its stored case; callers that need lowercase apply
  // .toLowerCase() themselves (same as the existing record-page code does today).
  App.label = function (kind, form) {
    const k = String(kind || "").toLowerCase();
    const f = form === "many" ? "many" : "one";
    const labels = (App.state && App.state.labels) || { types: {}, generic: {} };
    const t = labels.types && labels.types[k];
    if (t && t[f]) return t[f];
    const g = labels.generic && labels.generic[k];
    if (g && g[f]) return g[f];
    const d = LABEL_DEFAULTS[k];
    if (d && d[f]) return d[f];
    return k ? k.charAt(0).toUpperCase() + k.slice(1) : "";
  };

  // Shared English pluralizer (used by the Labels editor's auto-plural AND any
  // count agreement). Irregulars first, then the regular rules. Preserves the
  // input's leading capitalization.
  const IRREGULAR_PLURALS = {
    person: "people", child: "children", man: "men", woman: "women",
    foot: "feet", tooth: "teeth", goose: "geese", mouse: "mice",
    leaf: "leaves", life: "lives", knife: "knives", wife: "wives", half: "halves",
    datum: "data", analysis: "analyses", staff: "staff", series: "series",
  };
  App.pluralize = function (s) {
    const w = String(s || "").trim();
    if (!w) return "";
    const low = w.toLowerCase();
    let out;
    if (IRREGULAR_PLURALS[low]) out = IRREGULAR_PLURALS[low];
    else if (/[^aeiou]y$/.test(low)) return w.slice(0, -1) + "ies";
    else if (/(s|x|z|ch|sh)$/.test(low)) return w + "es";
    else return w + "s";
    // irregular: match the input's leading case
    return /^[A-Z]/.test(w) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
  };

  // Count-aware label: singular when n===1, plural otherwise (so 0 and 2+ use
  // the plural — "0 Clients", "1 Client", "3 Clients"). Never blank/undefined.
  App.labelFor = function (kind, n) { return App.label(kind, Number(n) === 1 ? "one" : "many"); };
  // "3 Clients" / "1 Client" — number + the matching form.
  App.countLabel = function (kind, n) { return n + " " + App.labelFor(kind, n); };

  // Swap the built-in English object-nouns in a display string for this portal's
  // labels. By default only Contact(s)/Candidate(s) are swapped (these never
  // collide with common words or feature names here). Pass {all:true} in
  // controlled contexts (trigger/action labels, builder hints) to also swap
  // Job(s)/Record(s)/Stage(s) — NOT for free prose, where "a record of…" or
  // "scheduled jobs" would be mangled. Whole-word, case- and number-preserving.
  App.relabelText = function (text, opts) {
    if (text == null) return text;
    let out = String(text);
    const o = opts || {};
    const swap = (one, many, kind) => {
      const Lm = App.label(kind, "many"), Lo = App.label(kind, "one");
      out = out
        .replace(new RegExp("\\b" + many + "\\b", "g"), Lm)
        .replace(new RegExp("\\b" + one + "\\b", "g"), Lo)
        .replace(new RegExp("\\b" + many.toLowerCase() + "\\b", "g"), Lm.toLowerCase())
        .replace(new RegExp("\\b" + one.toLowerCase() + "\\b", "g"), Lo.toLowerCase());
    };
    swap("Contact", "Contacts", "contact");
    swap("Candidate", "Candidates", "contact"); // candidates = the linked contacts
    if (o.all) {
      swap("Job Opening", "Job Openings", "job");
      swap("Job", "Jobs", "job"); // legacy copy still says Job(s); keep swapping it in controlled contexts
      swap("Work Order", "Work Orders", "work_order");
      swap("Record", "Records", "record");
      swap("Stage", "Stages", "stage");
    }
    return out;
  };

  // Load this portal's labels into the cache. Safe to call repeatedly; no-op on
  // failure (keeps defaults). Nothing in the UI reads App.label() yet, so a late
  // load has no visible effect — this just makes the cache available.
  App.loadLabels = async function () {
    try {
      const data = await portalApi("/api/labels");
      App.state.labels = { types: data.types || {}, generic: data.generic || {}, nav: data.nav || { order: [], hidden: [], labels: {} } };
    } catch (e) { /* keep whatever we had; defaults still work */ }
    return App.state.labels;
  };

  // Warm the live record-type registry so the sidebar shows every type the portal
  // has (Contacts/Jobs/Bookings + data-driven ones like Equipment), not just the
  // built-in fallback trio. On failure we keep whatever's cached (fallback still works).
  App.loadRecordTypes = async function () {
    try {
      const types = await portalApi("/api/record-types");
      if (Array.isArray(types)) App.state.recordTypes = types;
    } catch (e) { /* keep fallback */ }
    return App.state.recordTypes;
  };

  // Warm the cache once per portal context (re-loads if the portal changes).
  // After the first successful load, repaint the current view once so the nav /
  // page title reflect this portal's labels even on first entry. The per-portal
  // guard prevents any loop (the repainted route() call early-returns here).
  App.ensureLabels = function () {
    const key = App.state.currentPortalId || "self";
    if (App.state._labelsFor === key) return;
    App.state._labelsFor = key;
    Promise.all([App.loadLabels(), App.loadRecordTypes()]).then(function () { if (App._route) App._route(); });
  };

  // Warm the per-portal "AI Receptionist" on/off flag once per portal context,
  // mirroring ensureLabels. The sidebar uses it to hide the Calls nav item when
  // the feature is off. This is cosmetic only — the server still enforces access.
  App.ensureReceptionistFlag = function () {
    const key = App.state.currentPortalId || "self";
    if (App.state._recepFor === key) return;
    App.state._recepFor = key;
    portalApi("/api/settings")
      .then(function (p) {
        // Source of truth is voiceMode (OFF/WALKIE/SMOOTH); the legacy receptionistEnabled
        // boolean isn't always synced when a portal is set to a voice mode, so treat any
        // non-OFF voiceMode as ON too. Otherwise Calls gets hidden on portals that are
        // actually running the receptionist.
        App.state.receptionistEnabled = !!(p && (p.receptionistEnabled === true || (p.voiceMode && p.voiceMode !== "OFF")));
        if (App._route) App._route();
      })
      .catch(function () { /* leave as-is; nav shows, server still enforces */ });
  };
})(typeof window !== "undefined" ? window : globalThis);
