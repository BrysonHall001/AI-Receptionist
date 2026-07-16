(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, roleLabel } = App.util;
  try { document.title = App.BRAND || "CRM"; } catch (e) {}

  function parseHash() {
    const raw = (location.hash || "#/").replace(/^#/, "");
    const [path, queryPart] = raw.split("?");
    const query = {};
    if (queryPart) queryPart.split("&").forEach((kv) => { const [k, v] = kv.split("="); query[decodeURIComponent(k)] = decodeURIComponent(v || ""); });
    return { path: path || "/", query };
  }

  App.go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

  App.afterLogin = () => {
    if (App.isAdminTier(App.state.me.role)) App.go("#/admin/portals");
    else App.go(App.firstAvailableNav()); // portal user lands on first available (skips a locked Home Dashboard)
  };

  // Re-sync the cached identity (App.state.me) with the server's LIVE view of the
  // user. App.state.me is captured once at boot and, before this, was never re-read
  // during ordinary hash navigation — so a role change applied out-of-band (e.g. the
  // make-owner promotion, which sets role=OWNER in the DB) showed up immediately in
  // freshly-fetched lists (the admin Users page calls /api/admin/users every render)
  // but NOT in the cached sidebar identity the portal view renders from. The two then
  // disagreed (Users: "Owner"; portal chip: stale "Super Admin"). Re-reading /me makes
  // every surface resolve the role from the same source. Returns the updated user.
  App.refreshMe = async function () {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (!res.ok) return App.state.me;
      const j = await res.json();
      App.state.me = j.user;
      App.state.features = j.features || App.state.features || {};
      return App.state.me;
    } catch (e) { return App.state.me; }
  };

  async function logout() {
    try { if (App.presence) App.presence.stop(); } catch (e) {}
    try { await App.api("/api/auth/logout", { method: "POST" }); } catch (e) {}
    App.state.me = null;
    App.state.currentPortalId = null;
    App.state.currentPortalName = null;
    if (App.theme) App.theme.resetToDefault();
    location.hash = "#/login";
  }

  // Top-left brand. When this portal has a white-label logo, the logo REPLACES the
  // "C" mark + name entirely; otherwise the default name shows.
  //
  // opts.attribution — show the small "A Vaala product" line under the logo. In the
  //   PORTAL view this is FALSE: the tagline is relocated to just above the user's
  //   name/role in the bottom user block. In the admin/master hub it stays TRUE
  //   (unchanged) so the master layout is untouched.
  // opts.adminContext — OWNER/SUPER_ADMIN/AUDITOR viewing a portal: show the
  //   "← All tenants" affordance at the top of the left column, to the top-right of
  //   the logo, with the portal name directly beneath it (no "Viewing:" prefix).
  function renderBrand(brandEl, opts) {
    opts = opts || {};
    App._brandOpts = opts; // remembered so App.refreshBrand repaints identically
    brandEl.innerHTML = "";
    const row = el("div", "brand-row");
    const logo = (App.theme && App.theme.getLogo && App.theme.getLogo()) || null;
    if (logo) {
      const img = el("img", "brand-logo"); img.src = logo; img.alt = "Logo";
      row.appendChild(img);
    } else {
      // Default Clarity branding as INLINE SVG (full wordmark when expanded, the
      // app icon when the rail collapses). Inline = no external file to break.
      const full = el("span", "brand-logo brand-logo--full");
      full.innerHTML = App.brandLogoSvg;
      const icon = el("span", "brand-logo brand-logo--icon");
      icon.innerHTML = App.brandIconSvg;
      row.appendChild(full);
      row.appendChild(icon);
    }
    if (opts.adminContext) {
      // 2×2 layout: the logo occupies the LEFT column (spanning both rows); "← All
      // tenants" sits top-right (beside the logo, top-aligned) with the portal name
      // flush directly beneath it — NOT wrapping under the logo. The grid modifier
      // (see .brand-row--with-context) keeps them beside the logo.
      row.classList.add("brand-row--with-context");
      const ctx = el("div", "brand-context");
      const back = el("a", "back-link", "← All tenants");
      back.href = "#/admin/portals";
      back.onclick = () => { App.state.currentPortalId = null; App.state.currentPortalName = null; };
      ctx.appendChild(back);
      ctx.appendChild(el("div", "brand-portal-name", esc(App.state.currentPortalName || "portal")));
      row.appendChild(ctx);
    }
    brandEl.appendChild(row);
    // Tagline stays under the logo ONLY where requested (admin). Portal relocates it
    // to the user block (see buildShell), so it is intentionally omitted here.
    if (opts.attribution) brandEl.appendChild(el("div", "brand-attribution", "A Vaala product"));
  }
  // Lets the Appearance panel repaint the brand immediately after a logo change —
  // reusing the SAME options the current shell rendered with (so the portal's
  // relocated tagline / All-tenants block don't reappear/disappear on a logo swap).
  App.refreshBrand = function () { const b = document.querySelector(".sidebar-brand"); if (b) renderBrand(b, App._brandOpts || { attribution: true }); };

  // The 3rd element (when present) is a label "kind": the nav text is resolved
  // at render time via App.label(kind,"many") so renaming the contact/job record
  // type (or a Tenant.labels override) updates the nav. Other items are app
  // FEATURE names, not object nouns, so they stay literal.
  const ADMIN_NAV = [["#/admin/portals", "Tenants"], ["#/admin/users", "Users"], ["#/admin/email", "Email"], ["#/admin/usage", "Billing & Usage"], ["#/admin/feedback", "Feedback"], ["#/admin/changelog", "Change Log"]];
  // The portal nav is now registry-driven: fixed pages + one item per record type
  // (from navModel.js, which reads the live record types with the three system types
  // as the always-present default). Exposed as a LIVE getter so the Settings → Labels
  // → "Pages & navigation" editor and other readers build from the same list the
  // sidebar uses. For a portal with only the three system types this is byte-for-byte
  // the historical PORTAL_NAV (same items, order, hrefs, labels).
  Object.defineProperty(App, "PORTAL_NAV", { configurable: true, get: function () { return App.buildPortalNav(); } });

  // ---- Per-portal nav config (single source of truth = App.state.labels.nav) ----
  // Read by the sidebar here and, later, by the per-row nav menu. Order, hide, and
  // per-href label overrides all live in one object so there's never a second store.
  App.navConfig = function () {
    const n = (App.state.labels && App.state.labels.nav) || {};
    return {
      order: Array.isArray(n.order) ? n.order : [],
      hidden: Array.isArray(n.hidden) ? n.hidden : [],
      labels: (n.labels && typeof n.labels === "object") ? n.labels : {},
    };
  };
  // Batch 3 — each portal nav item's required VIEW area. The sidebar derives from
  // these: an item shows only if the user has View for its area. null = always-visible
  // (Fields/Learning page-load isn't permission-gated; Feedback has its own role
  // logic; Dashboard is never hideable). View comes from the server (me.permView),
  // computed by the SAME resolver the server enforces with — so menus can never show
  // a page the user can't access, and system-role menus are unchanged (they have View
  // on every area). Cosmetic nav-hide is applied on top, separately.
  App.NAV_VIEW_AREA = {
    "#/dashboard": null,
    "#/calls": "calls",
    "#/contacts": "contacts",
    "#/jobs": "records",
    "#/bookings": "records",
    "#/reports": "reports",
    "#/communication": "communication",
    "#/automations": "automations",
    "#/learn": "learn",
    "#/feedback": null,
  };
  // View-permission check for a NON-nav permission area (e.g. "billing", which is a Settings
  // tab, not a sidebar page). Mirrors canViewNav's default: if permView hasn't loaded yet,
  // don't hide (the server still enforces the endpoint, so nothing leaks).
  App.canViewArea = function (areaKey) {
    var me = App.state.me;
    var pv = me && me.permView;
    if (!pv) return true;
    return pv[areaKey] === true;
  };
  App.canViewNav = function (href) {
    // Owner page-lock (beats everything, incl. null-area pages like Dashboard/Feedback):
    // a locked page is simply not viewable for anyone in the tenant.
    var me = App.state.me;
    if (me && me.lockedPages && me.lockedPages.indexOf(href) !== -1) return false;
    var area = App.NAV_VIEW_AREA[href];
    if (area === undefined && href.indexOf("#/records/") === 0) area = "records"; // future record types
    if (!area) return true; // always-visible items (page-load not permission-gated)
    var pv = me && me.permView;
    if (!pv) return true; // permissions not loaded yet -> don't hide (matches old default)
    return pv[area] === true;
  };
  // First page (in default nav order) the user can actually see — the silent landing
  // spot when a requested page isn't viewable (locked or no permission). No "locked"
  // messaging: locked pages simply behave as if they don't exist for the user.
  App.firstAvailableNav = function () {
    var order = App.buildPortalNav().map(function (it) { return it[0]; });
    for (var i = 0; i < order.length; i++) { if (App.canViewNav(order[i])) return order[i]; }
    // Nothing viewable (extreme case: every nav page locked). NEVER return a locked page:
    // fall back to Settings, which isn't a lockable page and always passes canViewNav, so
    // it renders without bouncing back through the redirect.
    return "#/settings";
  };
  // Owner page-lock helpers for page-ENUMERATING surfaces (labels editor, permissions
  // table, learning center, reorder…). A locked page must not appear anywhere a portal
  // user could see or reference it — these let each surface exclude locked pages. For the
  // master hub (Owner/Super Admin/Auditor) me.lockedPages is empty, so nothing is excluded.
  App.isPageLocked = function (href) {
    var me = App.state.me;
    return !!(me && me.lockedPages && me.lockedPages.indexOf(href) !== -1);
  };
  // Map a permission AREA to its nav href(s); an area is "locked" if any of its pages is.
  // The "records" area covers ALL non-contact record types (jobs, bookings, and any
  // future type), derived from the record-type list so it extends automatically.
  App.AREA_HREFS = { contacts: ["#/contacts"], automations: ["#/automations"], communication: ["#/communication"], dashboard: ["#/dashboard"], reports: ["#/reports"], calls: ["#/calls"], learn: ["#/learn"] };
  Object.defineProperty(App.AREA_HREFS, "records", { enumerable: true, configurable: true, get: function () { return App.recordsAreaHrefs(); } });
  App.isAreaLocked = function (areaKey) {
    var hrefs = App.AREA_HREFS[areaKey]; if (!hrefs) return false;
    for (var i = 0; i < hrefs.length; i++) if (App.isPageLocked(hrefs[i])) return true;
    return false;
  };
  // Map a record-type kind to its nav href. System kinds have a bespoke href
  // (contact→#/contacts, job→#/jobs, booking→#/bookings); custom kinds return null
  // so isRecordTypeLocked falls back to the records area (they live under records).
  App.recordKindHref = function (kind) {
    var href = App.recordTypeHref(kind);
    return href.indexOf("#/records/") === 0 ? null : href;
  };
  App.isRecordTypeLocked = function (typeKey) {
    var href = App.recordKindHref(typeKey);
    if (href) return App.isPageLocked(href);   // contact -> #/contacts, job -> #/jobs, etc.
    return App.isAreaLocked("records");          // custom record types live under records
  };
  // Home Dashboard is never COSMETICALLY hideable, so there's normally a landing page —
  // but an owner LOCK overrides that: a locked page (dashboard included) counts as hidden.
  App.isNavHidden = function (href) {
    var me = App.state.me;
    if (me && me.lockedPages && me.lockedPages.indexOf(href) !== -1) return true; // locked -> hidden
    if (href === "#/dashboard") return false; // otherwise Home Dashboard is never hidden
    return App.navConfig().hidden.indexOf(href) !== -1;
  };
  // Display text for a nav item: record-type items (kind set) keep flowing through
  // the labels system; the fixed items use the per-portal override, falling back to
  // the built-in literal when there's no override.
  App.navLabel = function (href, label, kind) {
    if (kind) return App.label(kind, "many");
    const o = App.navConfig().labels[href];
    return (o && String(o).trim()) ? o : label;
  };
  // Apply order + hide to a nav list. Items named in cfg.order come first in that
  // order; any remaining default items keep their original relative order (so a
  // newly-shipped nav item still shows even under an older saved order). An item is
  // shown only when the user has VIEW for it (access) AND it isn't portal-hidden
  // (cosmetic) — Home Dashboard always stays.
  App.applyNavConfig = function (navList) {
    const cfg = App.navConfig();
    const byHref = {}; navList.forEach((it) => { byHref[it[0]] = it; });
    const seen = {}; const ordered = [];
    cfg.order.forEach((href) => { if (byHref[href] && !seen[href]) { ordered.push(byHref[href]); seen[href] = true; } });
    // Items NOT in the saved order (e.g. a page like Calls dropped from an older saved
    // order during a layout change) are re-inserted at their NATURAL position — right
    // after their nearest preceding neighbour from the canonical nav — instead of being
    // appended at the very end. So Calls lands directly right of Home Dashboard again,
    // while any user reordering still wins once it's part of the saved order.
    navList.forEach((it, idx) => {
      if (seen[it[0]]) return;
      let insertAt = ordered.length;
      for (let k = idx - 1; k >= 0; k--) {
        const pos = ordered.findIndex((o) => o[0] === navList[k][0]);
        if (pos !== -1) { insertAt = pos + 1; break; }
      }
      ordered.splice(insertAt, 0, it);
      seen[it[0]] = true;
    });
    return ordered.filter((it) => {
      // Home Dashboard is always shown WITHOUT needing a View area — UNLESS it's locked.
      // Routing through canViewNav preserves the always-shown behavior when unlocked
      // (null area -> true) but excludes it when it's in me.lockedPages (lock wins).
      if (it[0] === "#/dashboard") return App.canViewNav("#/dashboard");
      if (cfg.hidden.indexOf(it[0]) !== -1) return false; // portal-hidden (cosmetic)
      return App.canViewNav(it[0]);                        // must have View (access)
    });
  };

  // ---- Writers: both go through the EXISTING admin-gated PATCH /api/labels, then
  // refresh the cache and repaint. Settings pane + hamburger are two views of this
  // one stored config, so after either writes, both reflect it. -------------------
  function navToast(msg, bad) { if (App.util && App.util.toast) App.util.toast(msg, bad); }
  // setTenantNav REPLACES the whole nav object, so callers must pass the COMPLETE
  // {order,hidden,labels} (we never send a partial that would wipe the rest).
  App.persistNav = async function (nav) {
    try {
      await App.portalApi("/api/labels", { method: "PATCH", body: JSON.stringify({ nav: { order: nav.order || [], hidden: nav.hidden || [], labels: nav.labels || {} } }) });
      await App.loadLabels();
      if (App._route) App._route();
    } catch (e) { navToast(e.message, true); }
  };
  // Renaming a record-type-backed item (Contacts/Jobs) goes through the record-type
  // label path — identical to the Settings noun editor — NOT a nav.labels override.
  App.persistTypeLabel = async function (key, one, many) {
    try {
      await App.portalApi("/api/labels", { method: "PATCH", body: JSON.stringify({ types: { [key]: { one: one, many: many } } }) });
      await App.loadLabels();
      if (App._route) App._route();
    } catch (e) { navToast(e.message, true); }
  };
  // Full ordering of ALL nav hrefs (saved order then defaults) — used by reorder so
  // hidden items keep their relative slot even though they aren't shown as targets.
  App.fullNavOrder = function () {
    const cfg = App.navConfig();
    const all = (App.PORTAL_NAV || []).map((it) => it[0]).filter((h) => !App.isPageLocked(h)); // locked pages aren't reorderable
    const seen = {}; const out = [];
    cfg.order.forEach((h) => { if (all.indexOf(h) !== -1 && !seen[h]) { out.push(h); seen[h] = true; } });
    all.forEach((h) => { if (!seen[h]) { out.push(h); seen[h] = true; } });
    return out;
  };

  // ---- Per-row hamburger: a desktop/touch shortcut onto the SAME config. The icon
  // is BOTH the menu trigger and the drag handle; we tell the two apart by MOVEMENT
  // (a small pixel threshold), never a hold-timer. -------------------------------
  const NAV_DRAG_THRESHOLD = 5; // px; small wiggle still counts as a click
  let navMenuEl = null;
  function closeNavMenu() {
    if (navMenuEl) { navMenuEl.remove(); navMenuEl = null; }
    document.removeEventListener("pointerdown", onNavMenuDocDown, true);
    document.removeEventListener("keydown", onNavMenuKey, true);
  }
  function onNavMenuDocDown(e) { if (navMenuEl && !navMenuEl.contains(e.target)) closeNavMenu(); }
  function onNavMenuKey(e) { if (e.key === "Escape") closeNavMenu(); }

  function navItemAt(x, y) {
    let n = document.elementFromPoint(x, y);
    while (n && !(n.classList && n.classList.contains("nav-item"))) n = n.parentElement;
    return (n && n.dataset && n.dataset.href) ? n : null;
  }
  function clearNavDragVisuals() {
    document.querySelectorAll(".nav-item.nav-dragging").forEach((n) => n.classList.remove("nav-dragging"));
    document.querySelectorAll(".nav-item.nav-drop-target").forEach((n) => n.classList.remove("nav-drop-target"));
  }

  function attachNavBurger(burger, rowEl, href, label, kind) {
    let sx = null, sy = null, dragging = false;
    burger.classList.add("u-touch-none");
    // Absorb the click so a burger interaction never navigates the parent link.
    burger.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    burger.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return; // primary button / touch only
      e.preventDefault(); e.stopPropagation();
      sx = e.clientX; sy = e.clientY; dragging = false;
      try { burger.setPointerCapture(e.pointerId); } catch (_) {}
    });
    burger.addEventListener("pointermove", (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging && (dx * dx + dy * dy) > NAV_DRAG_THRESHOLD * NAV_DRAG_THRESHOLD) {
        dragging = true; rowEl.classList.add("nav-dragging");
      }
      if (dragging) {
        e.preventDefault();
        clearNavDragVisuals(); rowEl.classList.add("nav-dragging");
        const t = navItemAt(e.clientX, e.clientY);
        if (t && t.dataset.href !== href) t.classList.add("nav-drop-target");
      }
    });
    burger.addEventListener("pointerup", (e) => {
      e.preventDefault(); e.stopPropagation();
      try { burger.releasePointerCapture(e.pointerId); } catch (_) {}
      const wasDragging = dragging; const ex = e.clientX, ey = e.clientY;
      sx = null; sy = null; dragging = false;
      if (wasDragging) {
        const t = navItemAt(ex, ey); const target = t && t.dataset.href;
        clearNavDragVisuals();
        if (target && target !== href) {
          let order = App.fullNavOrder().filter((h) => h !== href);
          let ti = order.indexOf(target); if (ti < 0) ti = order.length;
          order.splice(ti, 0, href);
          const cfg = App.navConfig();
          App.persistNav({ order: order, hidden: cfg.hidden, labels: cfg.labels });
        }
      } else {
        openNavMenu(burger, href, label, kind);
      }
    });
    burger.addEventListener("pointercancel", () => { sx = null; dragging = false; clearNavDragVisuals(); });
  }

  function openNavMenu(anchor, href, label, kind) {
    closeNavMenu();
    const menu = el("div", "nav-burger-menu");
    const rename = el("button", "nav-burger-item", "Rename…");
    rename.onclick = () => { closeNavMenu(); renameNavItem(href, label, kind); };
    menu.appendChild(rename);
    if (href !== "#/dashboard") { // Home Dashboard is never hideable
      const hide = el("button", "nav-burger-item nav-burger-danger", "Hide");
      hide.onclick = () => { closeNavMenu(); hideNavItem(href, label, kind); };
      menu.appendChild(hide);
    }
    document.body.appendChild(menu);
    navMenuEl = menu;
    const r = anchor.getBoundingClientRect();
    const pad = 8;
    menu.style.position = "fixed";
    menu.style.left = Math.round(Math.min(r.left, window.innerWidth - menu.offsetWidth - pad)) + "px";
    // Open below the burger, but if that would run off the bottom (e.g. a burger low
    // in the scrolling modules column), flip to open ABOVE it instead. Always clamped.
    let top = r.bottom + 4;
    if (top + menu.offsetHeight > window.innerHeight - pad) top = r.top - 4 - menu.offsetHeight;
    if (top < pad) top = pad;
    menu.style.top = Math.round(top) + "px";
    setTimeout(() => {
      document.addEventListener("pointerdown", onNavMenuDocDown, true);
      document.addEventListener("keydown", onNavMenuKey, true);
    }, 0);
  }

  async function renameNavItem(href, label, kind) {
    if (kind) {
      // Record-type-backed: edit the noun (singular), plural auto-derives — exactly
      // like the Settings noun editor. This updates the word everywhere it's used.
      const cur = App.label(kind, "one");
      const val = await App.ui.promptModal({ title: "Rename", label: "Singular name (the plural updates automatically — fine-tune it in Settings → Modules & Fields)", value: cur, okText: "Save" });
      if (val === null) return;
      const one = String(val).trim(); if (!one) { navToast("Name can’t be blank", true); return; }
      await App.persistTypeLabel(kind, one, App.pluralize(one));
    } else {
      const cfg = App.navConfig();
      const cur = cfg.labels[href] || label;
      const val = await App.ui.promptModal({ title: "Rename", label: "Menu label", value: cur, okText: "Save" });
      if (val === null) return;
      const name = String(val).trim();
      const labels = Object.assign({}, cfg.labels);
      if (name) labels[href] = name; else delete labels[href]; // blank = back to default
      await App.persistNav({ order: cfg.order, hidden: cfg.hidden, labels: labels });
    }
  }

  async function hideNavItem(href, label, kind) {
    const disp = kind ? App.label(kind, "many") : (App.navConfig().labels[href] || label);
    const ok = await App.ui.confirmModal({
      title: "Hide this page?",
      message: "“" + disp + "” will be removed from the left-hand menu. You can restore it any time from Settings → Pages.",
      confirmText: "Hide page",
    });
    if (!ok) return;
    const cfg = App.navConfig();
    const hidden = cfg.hidden.indexOf(href) === -1 ? cfg.hidden.concat([href]) : cfg.hidden;
    // persistNav repaints; if the user was viewing this page, route()'s hidden-page
    // guard sends them to Home Dashboard automatically.
    await App.persistNav({ order: cfg.order, hidden: hidden, labels: cfg.labels });
  }

  // ---- Impersonation (Batch B): enter/exit + visible state. NO enforcement yet
  // (view-only blocking = C, role downgrade = D); only the master admin surface is
  // locked server-side while impersonating. ------------------------------------
  App.loadImpersonation = async function () {
    App.state.impersonation = null;
    if (!App.state.me) return;
    // Always ask the server — it gates on the REAL identity (req.realUser). During
    // act-as-type our own me.role is the EFFECTIVE (downgraded) role, so we must NOT
    // gate on it here, or the banner/Exit would vanish exactly when impersonating.
    // A real non-super-admin just gets a 403 → caught → not impersonating.
    try { App.state.impersonation = await App.api("/api/impersonation"); }
    catch (e) { App.state.impersonation = null; }
  };
  function isImpersonating() { return !!(App.state.impersonation && App.state.impersonation.impersonating); }
  function impOverlay() { return (App.state.impersonation && App.state.impersonation.overlay) || null; }

  // Re-pull the effective identity (/api/auth/me returns the effective role/tenant
  // while impersonating) AND the impersonation state, then align the portal/label
  // context with the impersonated scope so the UI re-renders as the right role for
  // the right portal immediately after entering/leaving impersonation.
  async function refreshSession() {
    try { const res = await fetch("/api/auth/me", { credentials: "same-origin" }); if (res.ok) { const j = await res.json(); App.state.me = j.user; App.state.features = j.features || App.state.features || {}; } } catch (e) {}
    await App.loadImpersonation();
    const st = App.state.impersonation;
    if (st && st.impersonating && st.overlay && st.overlay.scopeTenantId) {
      // Follow the scope of whoever/whatever we're impersonating (the target user's
      // tenant for view-as, the current portal for act-as-type).
      App.state.currentPortalId = st.overlay.scopeTenantId;
      App.state.currentPortalName = st.scopeTenantName || App.state.currentPortalName || null;
    } else if (App.state._preImpPortal) {
      // Exited: restore exactly where the super-admin was before impersonating.
      App.state.currentPortalId = App.state._preImpPortal.id;
      App.state.currentPortalName = App.state._preImpPortal.name;
      App.state._preImpPortal = null;
    }
    App.state._labelsFor = null; // force a label reload for the (possibly changed) scope
  }
  async function startImpersonation(payload) {
    // Remember where we were, so Exit can put us back.
    App.state._preImpPortal = { id: App.state.currentPortalId, name: App.state.currentPortalName };
    try { await App.api("/api/impersonation/start", { method: "POST", body: JSON.stringify(payload) }); }
    catch (e) { App.util.toast(e.message, true); App.state._preImpPortal = null; return; }
    await refreshSession();
    App.go(App.firstAvailableNav()); // land on first available (skips a locked Home Dashboard)
  }
  // Guaranteed exit: hits the real-session-authorized exit endpoint, then refreshes
  // identity + state and lands on the dashboard — even if the call errored, we still
  // re-read so the UI can recover. Exit can never be blocked by impersonation itself.
  async function exitImpersonation() {
    try { await App.api("/api/impersonation/exit", { method: "POST" }); }
    catch (e) { /* swallow; still refresh below so we never get stuck */ }
    await refreshSession();
    App.go(App.firstAvailableNav());
  }

  let impMenuEl = null;
  function closeImpMenu() {
    if (impMenuEl) { impMenuEl.remove(); impMenuEl = null; }
    document.removeEventListener("pointerdown", onImpDocDown, true);
    document.removeEventListener("keydown", onImpKey, true);
  }
  function onImpDocDown(e) { if (impMenuEl && !impMenuEl.contains(e.target)) closeImpMenu(); }
  function onImpKey(e) { if (e.key === "Escape") closeImpMenu(); }

  async function openImpersonateMenu(anchor) {
    closeImpMenu();
    const portalId = App.state.currentPortalId;
    const portalName = App.state.currentPortalName;
    let data;
    // Scope targets to the open portal (empty tenantId -> backend returns no users).
    try { data = await App.api("/api/impersonation/targets?tenantId=" + encodeURIComponent(portalId || "")); }
    catch (e) { App.util.toast(e.message, true); return; }
    const menu = el("div", "imp-menu");
    // Act-as-type (needs a portal in context for the pinned scope)
    menu.appendChild(el("div", "imp-menu-sec", "Act as a user type" + (portalId ? " in " + esc(portalName || "this portal") : "")));
    (data.roles || []).forEach((role) => {
      const item = el("button", "imp-menu-item", esc(roleLabel ? roleLabel(role) : role));
      if (!portalId) { item.disabled = true; item.title = "Open a portal first"; }
      else item.onclick = async () => {
        closeImpMenu();
        const rl = roleLabel ? roleLabel(role) : role;
        const ok = await App.ui.confirmModal({ title: "Act as " + rl + "?", message: "You’ll act as a " + rl + " in " + (portalName || "this portal") + " with exactly that role’s permissions — anything the role can’t do is blocked. Your actions stay recorded as you.", confirmText: "Start" });
        if (ok) startImpersonation({ mode: "act-as-type", assumedRole: role, scopeTenantId: portalId });
      };
      menu.appendChild(item);
    });
    // Custom (per-portal) roles as assumable types — sent by customRoleId so the
    // session resolves to EXACTLY that role's permissions.
    (data.customRoles || []).forEach((cr) => {
      const item = el("button", "imp-menu-item", esc(cr.name) + " (custom role)");
      if (!portalId) { item.disabled = true; item.title = "Open a portal first"; }
      else item.onclick = async () => {
        closeImpMenu();
        const ok = await App.ui.confirmModal({ title: "Act as " + cr.name + "?", message: "You’ll act as the “" + cr.name + "” role in " + (portalName || "this portal") + " with exactly that role’s permissions — anything the role can’t do is blocked. Your actions stay recorded as you.", confirmText: "Start" });
        if (ok) startImpersonation({ mode: "act-as-type", customRoleId: cr.id, scopeTenantId: portalId });
      };
      menu.appendChild(item);
    });
    menu.appendChild(el("div", "imp-menu-sec", "View as a specific user" + (portalId ? " in " + esc(portalName || "this portal") : "")));
    const users = data.users || [];
    if (!portalId) menu.appendChild(el("div", "imp-menu-empty", "Open a portal first"));
    else if (!users.length) menu.appendChild(el("div", "imp-menu-empty", "No users available"));
    users.forEach((u) => {
      const label = (u.name || u.email) + " — " + (roleLabel ? roleLabel(u.role) : u.role);
      const item = el("button", "imp-menu-item", esc(label));
      item.onclick = async () => {
        closeImpMenu();
        const ok = await App.ui.confirmModal({ title: "View as " + (u.name || u.email) + "?", message: "You’ll see what this user sees. (View-only is enforced in a later build; for now nothing is restricted.) You can exit at any time.", confirmText: "View as user" });
        if (ok) startImpersonation({ mode: "view-as-user", targetUserId: u.id, scopeTenantId: portalId });
      };
      menu.appendChild(item);
    });
    document.body.appendChild(menu); impMenuEl = menu;
    // The trigger now lives in the BOTTOM-LEFT user box, so the menu must open UPWARD
    // and left-aligned to the button — and be clamped so it is always fully on-screen
    // (never cut off past the bottom, left, or right), whatever the button position.
    const r = anchor.getBoundingClientRect();
    const pad = 8, gap = 6;
    menu.style.position = "fixed";
    menu.style.top = "0px"; menu.style.left = "0px"; // neutral spot to measure at
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    // Left-align to the button, clamp within [pad, viewport - width - pad].
    let left = Math.max(pad, Math.min(r.left, window.innerWidth - mw - pad));
    // Prefer opening above the button; if there isn't room, clamp to the top and let
    // the menu's own max-height/scroll handle a very tall list. Final min() keeps it
    // off the bottom edge too.
    let top = r.top - gap - mh;
    if (top < pad) top = pad;
    top = Math.min(top, window.innerHeight - mh - pad);
    if (top < pad) top = pad;
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
    setTimeout(() => {
      document.addEventListener("pointerdown", onImpDocDown, true);
      document.addEventListener("keydown", onImpKey, true);
    }, 0);
  }

  function buildImpersonationControl() {
    if (isImpersonating()) {
      const btn = el("button", "btn btn-sm imp-exit-btn", "Exit Impersonation Mode");
      btn.onclick = exitImpersonation;
      return btn;
    }
    const btn = el("button", "btn btn-ghost btn-sm", "Impersonate as…");
    btn.onclick = (e) => { e.stopPropagation(); openImpersonateMenu(btn); };
    return btn;
  }

  function buildImpersonationBanner() {
    const ov = impOverlay();
    const st = App.state.impersonation || {};
    const banner = el("div", "imp-banner");
    let text;
    if (ov && ov.mode === "view-as-user") {
      text = "👁 Viewing as " + esc(st.targetName || "another user") + (st.scopeTenantName ? " · " + esc(st.scopeTenantName) : "") + " — read-only";
    } else if (ov && ov.mode === "act-as-type") {
      text = "🛡 Acting as " + esc(roleLabel ? roleLabel(ov.assumedRole) : ov.assumedRole) + (st.scopeTenantName ? " in " + esc(st.scopeTenantName) : "");
    } else {
      text = "Impersonation active";
    }
    banner.appendChild(el("span", "imp-banner-text", text));
    const exit = el("button", "btn btn-sm imp-banner-exit", "Exit");
    exit.onclick = exitImpersonation;
    banner.appendChild(exit);
    return banner;
  }

  function buildShell(section, activePath) {
    const me = App.state.me;
    const root = App.util.$("#app");
    root.innerHTML = "";

    // Per-user theming: the signed-in user's personal theme applies everywhere,
    // independent of portal context.
    if (App.theme) App.theme.loadAndApply().then(function () { if (App.refreshBrand) App.refreshBrand(); });

    const layout = el("div", "app-shell");
    const isAdmin = section === "admin";
    const isPortal = section === "portal";
    const isAdminTier = App.isAdminTier(me.role);
    const canEditNav = !isAdmin && me && (me.role === "PORTAL_ADMIN" || isAdminTier);
    // Collapse state (in-memory; persists across navigation within the session).
    if (isPortal && App.state.chromeCollapsed) layout.classList.add("chrome-collapsed");

    // Shared nav-anchor builder — used by BOTH the left column (modules) and the
    // new top row (pages), so the hamburger rename/reorder/hide works identically.
    function makeNavAnchor(tuple) {
      const href = tuple[0], label = tuple[1], kind = tuple[2];
      const text = isAdmin ? (kind ? App.label(kind, "many") : label) : App.navLabel(href, label, kind);
      const a = el("a", "nav-item" + (href === activePath ? " active" : "") + (canEditNav ? " nav-item--editable" : ""), esc(text));
      a.href = href;
      a.dataset.href = href;
      if (canEditNav) {
        const burger = el("span", "nav-burger", "⋮");
        burger.title = "Rename, reorder, or hide";
        attachNavBurger(burger, a, href, label, kind);
        a.appendChild(burger);
      }
      return a;
    }

    // Sidebar
    const side = el("aside", "sidebar");
    const brand = el("div", "sidebar-brand");
    // Portal view: tagline moves to the user block, and admin-tier gets the
    // "← All tenants" + portal-name context at the top of the left column. Admin
    // (master hub) is untouched: tagline stays under the logo, no context block.
    renderBrand(brand, isPortal ? { attribution: false, adminContext: false } : { attribution: true, adminContext: false });
    side.appendChild(brand);

    const nav = el("nav", "sidebar-nav");
    let items = isAdmin ? ADMIN_NAV.slice() : App.applyNavConfig(App.buildPortalNav());
    // The cross-tenant Email + Billing pages are OWNER/SUPER_ADMIN only — hide them from
    // Auditors (the backend endpoints enforce the same, this just keeps the nav honest).
    if (isAdmin && !(me.role === "OWNER" || me.role === "SUPER_ADMIN")) {
      items = items.filter(function (it) { return it[0] !== "#/admin/email" && it[0] !== "#/admin/usage"; });
    }
    // NOTE (Calls-missing diagnosis): Calls used to be REMOVED from the pages row whenever
    // the AI Receptionist read as "off" for the portal. That feature-flag gate — not the
    // menu order or the on/off flag derivation — is why Calls kept disappearing: it deleted
    // the item before it was ever placed. Calls is a normal page (call history) that should
    // always be reachable; the Calls PAGE itself shows a friendly "receptionist is off" note
    // when appropriate, and the server still guards /api/calls. So the nav item is no longer
    // gated on the receptionist here.
    // Portal: split into MODULES (record types -> left column) and PAGES (the rest
    // -> horizontal top row). Derived from the registry, so a future record type
    // lands in the left column automatically. Admin: everything stays in the sidebar.
    let pageItems = [];
    if (isPortal) {
      const moduleHrefs = new Set(App.recordTypeNavItems().map(function (it) { return it[0]; }));
      const moduleItems = items.filter(function (it) { return moduleHrefs.has(it[0]); });
      pageItems = items.filter(function (it) { return !moduleHrefs.has(it[0]); });
      moduleItems.forEach(function (it) { nav.appendChild(makeNavAnchor(it)); });
    } else {
      items.forEach(function (it) { nav.appendChild(makeNavAnchor(it)); });
    }
    side.appendChild(nav);

    const userBox = el("div", "sidebar-user");
    const chip = el("div");
    chip.innerHTML = `<div class="user-chip"><div class="user-avatar">${esc((me.name || me.email).charAt(0).toUpperCase())}</div>
      <div class="user-meta"><div class="user-name">${esc(me.name || me.email)}</div><div class="user-role">${esc(roleLabel(me.role))}</div></div></div>`;
    userBox.appendChild(chip);
    // Admin-tier in a portal: Sign out (a little under half width) + Impersonate as an
    // equal-width button to its right. Everyone else: Sign out unchanged (full width).
    if (isPortal && isAdminTier) {
      const actionRow = el("div", "user-actions actions-row"); // layout hardening: adopts the actions-row primitive (wraps at squeeze — acceptance case 2)
      const logoutBtn = el("button", "btn btn-ghost btn-sm user-action-half", "Sign out");
      logoutBtn.id = "logout-btn";
      const imp = buildImpersonationControl();
      imp.classList.add("user-action-half");
      actionRow.appendChild(logoutBtn);
      actionRow.appendChild(imp);
      userBox.appendChild(actionRow);
    } else {
      const logoutBtn = el("button", "btn btn-ghost btn-sm btn-block", "Sign out");
      logoutBtn.id = "logout-btn";
      userBox.appendChild(logoutBtn);
    }
    // Admin-tier viewing a portal: the "← All tenants" + portal-name block lives at the
    // BOTTOM of the left column now — right-aligned, two lines stacked, sitting directly
    // ABOVE the thin divider that tops the user block. (Removed from beside the logo.)
    if (isPortal && isAdminTier) {
      const ctxWrap = el("div", "sidebar-context");
      const back = el("a", "back-link", "← All tenants");
      back.href = "#/admin/portals";
      back.onclick = () => { App.state.currentPortalId = null; App.state.currentPortalName = null; };
      ctxWrap.appendChild(back);
      ctxWrap.appendChild(el("div", "brand-portal-name", esc(App.state.currentPortalName || "portal")));
      side.appendChild(ctxWrap);
    }
    // Portal view: "A Vaala product" now sits BELOW that divider, grouped with the user
    // chip (moved inside the user block, above the chip). Admin (master hub) keeps the
    // tagline under the logo, untouched.
    if (isPortal) userBox.insertBefore(el("div", "brand-attribution sidebar-tagline", "A Vaala product"), userBox.firstChild);
    side.appendChild(userBox);
    layout.appendChild(side);

    // Main
    const main = el("div", "main");
    if (isImpersonating()) main.appendChild(buildImpersonationBanner());

    // Collapse toggle — sits in the top-left corner (intersection of the pages row
    // and the modules column). One click hides BOTH; click again restores. Stays
    // visible in either state (anchored to .main, above the collapsible chrome).
    if (isPortal) {
      const toggle = el("button", "chrome-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-label", "Toggle menus");
      toggle.title = App.state.chromeCollapsed ? "Show menus" : "Hide menus";
      toggle.innerHTML = "&#9776;"; // ☰
      toggle.onclick = function () {
        App.state.chromeCollapsed = !App.state.chromeCollapsed;
        layout.classList.toggle("chrome-collapsed", App.state.chromeCollapsed);
        toggle.title = App.state.chromeCollapsed ? "Show menus" : "Hide menus";
      };
      main.appendChild(toggle);
    }

    if (isPortal) {
      // Top row: PAGES (moved from the left column), horizontal, each with its full
      // burger menu (Rename/Hide/reorder — same makeNavAnchor as the left column).
      // The page items live in a FLEXING, horizontally-scrolling strip so they reach
      // the whole width and overflow scrolls (never clips); the presence strip + the
      // Settings gear are pinned to the upper-right and stay visible.
      const pagesRow = el("nav", "portal-pages-row");
      const pagesScroll = el("div", "pages-scroll");
      pageItems.forEach(function (it) { pagesScroll.appendChild(makeNavAnchor(it)); });
      pagesRow.appendChild(pagesScroll);

      const pagesRight = el("div", "pages-row-right");
      const presenceStrip = el("div", "presence-strip");
      presenceStrip.classList.add("app-presence-strip");
      pagesRight.appendChild(presenceStrip);
      if (App.presence) App.presence.mount(presenceStrip);
      // Settings gear — relocated here (upper-right of the top row) now that the old
      // context row is gone. Still opens Settings.
      const gear = el("a", "icon-btn gear");
      gear.href = "#/settings";
      gear.title = "Settings";
      gear.innerHTML = "&#9881;";
      pagesRight.appendChild(gear);
      pagesRow.appendChild(pagesRight);

      main.appendChild(pagesRow);
    } else {
      // Admin (master hub) — UNCHANGED: the top bar carries the page title, and there
      // is no portal presence strip, so presence is stopped.
      const topbar = el("header", "topbar");
      const topLeft = el("div", "top-left");
      const titleMap = { "#/dashboard": "Home Dashboard", "#/calls": "Calls", "#/contacts": App.label("contact", "many"), "#/jobs": App.label("job", "many"), "#/reports": "Analytics", "#/communication": "Communication", "#/automations": "Automations", "#/feedback": "Feedback", "#/settings": "Settings", "#/admin/portals": "Tenants", "#/admin/users": "Users", "#/admin/email": "Email", "#/admin/usage": "Billing & Usage", "#/admin/feedback": "Feedback", "#/admin/changelog": "Change Log" };
      let pageTitle = titleMap[activePath];
      if (!pageTitle) {
        const found = items.find(function (it) { return it[0] === activePath; });
        if (found) pageTitle = found[2] ? App.label(found[2], "many") : found[1];
      }
      if (!pageTitle) pageTitle = "Admin";
      topLeft.appendChild(el("h1", "page-title", pageTitle));
      topbar.appendChild(topLeft);
      topbar.appendChild(el("div", "top-right"));
      if (App.presence) App.presence.stop();
      main.appendChild(topbar);
    }

    const content = el("div", "content");
    // Item 3 — one CONSISTENT, left-aligned page/module title at the top of the content
    // region (just under the pages row), shown for EVERY portal page/module using the
    // SAME label the nav uses (relabel-aware via App.navLabel/App.label). Pages that
    // used to hardcode their own top-level heading had it removed so it isn't doubled.
    if (isPortal) {
      const title = portalPageTitle(activePath);
      if (title) content.appendChild(el("h1", "page-title content-page-title", esc(title)));
    }
    const viewEl = el("div");
    viewEl.id = "view";
    content.appendChild(viewEl);
    main.appendChild(content);
    layout.appendChild(main);

    root.appendChild(layout);
    App.util.$("#logout-btn").onclick = logout;
  }

  // The consistent portal page/module title for an active hash. Resolved from the FULL
  // portal nav (so a hidden-but-URL-reachable page still gets a title) via the same
  // label path the sidebar uses; Settings and the fixed pages have explicit fallbacks.
  function portalPageTitle(activePath) {
    if (activePath === "#/settings") return "Settings";
    const full = (App.buildPortalNav && App.buildPortalNav()) || [];
    const found = full.find(function (it) { return it[0] === activePath; });
    if (found) return App.navLabel(found[0], found[1], found[2]);
    const fixed = { "#/dashboard": "Home Dashboard", "#/calls": "Calls", "#/reports": "Analytics", "#/communication": "Communication", "#/automations": "Automations", "#/learn": "Learning Center", "#/feedback": "Feedback" };
    return fixed[activePath] || "";
  }
  App.portalPageTitle = portalPageTitle; // exposed for the layout self-test

  function route() {
    const { path, query } = parseHash();
    const me = App.state.me;

    // Keep the cached identity in step with the live role. Without this, App.state.me
    // is only ever read at boot, so a role change applied while the user is logged in
    // (e.g. the make-owner promotion) is reflected in freshly-fetched lists but not in
    // the cached sidebar identity — the admin Users list and the portal view then
    // disagree. We re-read /me in the background and, only if the role actually
    // changed, repaint. Skipped while impersonating (there /me is the intended
    // EFFECTIVE role and the impersonation flow already owns App.state.me), and
    // guarded so the fetches never overlap or loop (once refreshed, the role matches
    // and no further repaint happens).
    if (me && !isImpersonating() && !App.state._meSyncing) {
      App.state._meSyncing = true;
      App.refreshMe().then(function (u) {
        App.state._meSyncing = false;
        if (u && u.role !== me.role && App._route) App._route();
      }).catch(function () { App.state._meSyncing = false; });
    }

    // Foundation (relabeling): keep the per-portal label cache warm — but only
    // when there's a portal in context. A SUPER_ADMIN who hasn't picked a portal
    // has no tenant to scope to, so requesting labels then is meaningless (and
    // was causing a 400 on /api/labels).
    if (me && (!App.isAdminTier(me.role) || App.state.currentPortalId)) App.ensureLabels();
    if (me && (!App.isAdminTier(me.role) || App.state.currentPortalId)) App.ensureReceptionistFlag();

    // Unauthenticated
    if (!me) {
      if (path === "/forgot") return App.auth.renderForgot();
      if (path === "/reset") return App.auth.renderReset(query.token || "");
      return App.auth.renderLogin();
    }

    // Authenticated but sitting on an auth route -> go home
    if (path === "/" || path === "/login" || path === "/forgot" || path === "") {
      return App.afterLogin();
    }

    // Master (admin) section
    if (path.indexOf("/admin") === 0) {
      if (!App.isAdminTier(me.role)) return App.go(App.firstAvailableNav());
      // Email + Billing are OWNER/SUPER_ADMIN only; an Auditor who deep-links is bounced to Tenants.
      if ((path === "/admin/email" || path === "/admin/usage") && !(me.role === "OWNER" || me.role === "SUPER_ADMIN")) return App.go("#/admin/portals");
      const sub = path === "/admin/users" ? "users" : path === "/admin/email" ? "email" : path === "/admin/usage" ? "usage" : path === "/admin/feedback" ? "feedback" : path === "/admin/changelog" ? "changelog" : "portals";
      buildShell("admin", "#/admin/" + sub);
      return App.admin.render(sub);
    }

    // Contact profile page
    if (path.indexOf("/contact/") === 0) {
      const id = path.slice("/contact/".length);
      if (App.isAdminTier(me.role) && !App.state.currentPortalId) return App.go("#/admin/portals");
      buildShell("portal", "#/contacts");
      return App.portal.renderContact(id);
    }

    // Record (e.g. Job) detail page
    if (path.indexOf("/record/") === 0) {
      const id = path.slice("/record/".length);
      if (App.isAdminTier(me.role) && !App.state.currentPortalId) return App.go("#/admin/portals");
      buildShell("portal", "#/jobs");
      return App.portal.renderRecord(id);
    }

    // Recycle Bin read-only preview (contact or record). Stays INSIDE the bin:
    // buildShell highlights Settings (the bin now lives there), and the renderer is read-only.
    if (path.indexOf("/recycle/contact/") === 0) {
      const id = path.slice("/recycle/contact/".length);
      if (App.isAdminTier(me.role) && !App.state.currentPortalId) return App.go("#/admin/portals");
      buildShell("portal", "#/settings");
      return App.portal.renderRecycledPreview("contact", id);
    }
    if (path.indexOf("/recycle/record/") === 0) {
      const id = path.slice("/recycle/record/".length);
      if (App.isAdminTier(me.role) && !App.state.currentPortalId) return App.go("#/admin/portals");
      buildShell("portal", "#/settings");
      return App.portal.renderRecycledPreview("record", id);
    }

    // Old Inbound link now lives inside Settings.
    if (path === "/inbound") return App.go("#/settings/leadcapture");

    // Old Fields page now lives inside Settings.
    if (path === "/fields") return App.go("#/settings/fields");
    if (path === "/recycle") return App.go("#/settings/data/recycle");

    // Settings (with optional sub-section, e.g. #/settings/appearance) — the
    // sub-section drives the in-view sub-shell; refresh/back keep their place.
    if (path === "/settings" || path.indexOf("/settings/") === 0) {
      if (App.isAdminTier(me.role) && !App.state.currentPortalId) return App.go("#/admin/portals");
      buildShell("portal", "#/settings");
      const sub = path === "/settings" ? "" : path.slice("/settings/".length);
      return App.portal.render("settings", sub);
    }

    // Data-driven record-type list page (e.g. Equipment at #/records/<key>). System
    // types keep their bespoke routes above; every OTHER type renders through the same
    // generic record-list view Jobs/Bookings already use. Access is governed by the
    // shared "records" permission area (canViewNav), so no per-type gating is needed.
    const rtList = path.match(/^\/records\/([A-Za-z0-9_-]+)$/);
    if (rtList) {
      if (App.isAdminTier(me.role) && !App.state.currentPortalId) return App.go("#/admin/portals");
      if (App.canViewNav && App.canViewNav("#" + path) === false) return App.go(App.firstAvailableNav());
      buildShell("portal", "#" + path);
      return App.portal.render("recordlist", rtList[1]);
    }

    // Portal section — fixed pages + registry-derived record-type routes. System
    // types map to their bespoke views (/contacts→contacts, /jobs→jobs, /bookings→
    // bookings); a future #/records/<key> maps to null until its view is wired, so it
    // falls through exactly like any unknown path today (no change for the three).
    const portalViews = { "/dashboard": "dashboard", "/calls": "calls", "/reports": "reports", "/communication": "communication", "/automations": "automations", "/learn": "learn", "/feedback": "feedback", "/settings": "settings" };
    const rtViews = App.recordTypePortalViews();
    Object.keys(rtViews).forEach(function (p) { if (rtViews[p]) portalViews[p] = rtViews[p]; });
    if (portalViews[path]) {
      if (App.isAdminTier(me.role) && !App.state.currentPortalId) return App.go("#/admin/portals");
      // Batch 3: hide is now COSMETIC — a hidden page the user can View still loads by
      // URL (reachable, just not in the menu). Access is governed by VIEW: a page the
      // user has no View permission for sends them to the always-present Home Dashboard.
      // For system roles this never triggers (they have View everywhere), so a hidden
      // page that used to redirect now loads.
      if (App.canViewNav && App.canViewNav("#" + path) === false) return App.go(App.firstAvailableNav());
      buildShell("portal", path === "/settings" ? "#/settings" : "#" + path);
      return App.portal.render(portalViews[path]);
    }

    // Fallback
    return App.afterLogin();
  }

  async function boot() {
    // MOTION & BRANDING — full-page first load: the centered brand with the animated C
    // (slides left, rebounds off the wordmark, settles; ~600ms loop; token-colored;
    // static under reduced motion). Same 150ms delay rule as skeletons, and the first
    // route render clears #app, so it can never linger past real content.
    const loaderT = setTimeout(function () {
      const app = document.getElementById("app");
      if (!app || app.childElementCount) return;
      const l = el("div", "brand-loader");
      l.id = "boot-loader";
      l.innerHTML = App.brandLogoSvg;
      app.appendChild(l);
    }, 150);
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      const j = res.ok ? await res.json() : null;
      App.state.me = j ? j.user : null;
      App.state.features = (j && j.features) || {};
    } catch (e) { App.state.me = null; }
    await App.loadImpersonation(); // so the banner/control reflect state on first paint + after refresh
    clearTimeout(loaderT);
    const bl = document.getElementById("boot-loader"); if (bl) bl.remove();
    routeWithMotion(); // first paint is a page change too
  }

  // MOTION & BRANDING — staggered page materialization, ROUTE CHANGES ONLY.
  // The .page-stagger class is added to the content host right after a navigation and
  // removed ~400ms later, so blocks inserted by the incoming page (including fast async
  // fetches) fade-slide in with a 25ms/item stagger capped at 150ms — while re-renders,
  // re-sorts, and filters inside a page (which happen after the window closes, on the
  // same route) never re-trigger it. Opacity/transform only; nothing blocks pointers;
  // the global prefers-reduced-motion block turns it off entirely.
  function routeWithMotion() {
    route();
    requestAnimationFrame(function () {
      const c = document.querySelector(".content");
      if (!c) return;
      c.classList.remove("page-stagger");
      void c.offsetWidth; // restart the animation window for the new page
      c.classList.add("page-stagger");
      clearTimeout(App._staggerT);
      App._staggerT = setTimeout(function () { c.classList.remove("page-stagger"); }, 400);
    });
  }
  window.addEventListener("hashchange", routeWithMotion);
  App._route = route;
  boot();
})(typeof window !== "undefined" ? window : globalThis);
