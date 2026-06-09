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
    if (App.state.me.role === "SUPER_ADMIN") App.go("#/admin/portals");
    else App.go("#/dashboard");
  };

  async function logout() {
    try { await App.api("/api/auth/logout", { method: "POST" }); } catch (e) {}
    App.state.me = null;
    App.state.currentPortalId = null;
    App.state.currentPortalName = null;
    if (App.theme) App.theme.resetToDefault();
    location.hash = "#/login";
  }

  // The 3rd element (when present) is a label "kind": the nav text is resolved
  // at render time via App.label(kind,"many") so renaming the contact/job record
  // type (or a Tenant.labels override) updates the nav. Other items are app
  // FEATURE names, not object nouns, so they stay literal.
  const PORTAL_NAV = [["#/dashboard", "Home Dashboard"], ["#/calls", "Calls"], ["#/contacts", "Contacts", "contact"], ["#/jobs", "Jobs", "job"], ["#/fields", "Fields"], ["#/reports", "Reports"], ["#/automations", "Automations"], ["#/learn", "Learning Center"]];
  const ADMIN_NAV = [["#/admin/portals", "Portals"], ["#/admin/users", "Users"]];

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
  // Home Dashboard is never hideable, so there's always a landing page.
  App.isNavHidden = function (href) {
    if (href === "#/dashboard") return false;
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
  // newly-shipped nav item still shows even under an older saved order). Hidden
  // items are dropped — except Home Dashboard, which always stays.
  App.applyNavConfig = function (navList) {
    const cfg = App.navConfig();
    const byHref = {}; navList.forEach((it) => { byHref[it[0]] = it; });
    const seen = {}; const ordered = [];
    cfg.order.forEach((href) => { if (byHref[href] && !seen[href]) { ordered.push(byHref[href]); seen[href] = true; } });
    navList.forEach((it) => { if (!seen[it[0]]) { ordered.push(it); seen[it[0]] = true; } });
    return ordered.filter((it) => it[0] === "#/dashboard" || cfg.hidden.indexOf(it[0]) === -1);
  };

  function buildShell(section, activePath) {
    const me = App.state.me;
    const root = App.util.$("#app");
    root.innerHTML = "";

    // Per-user theming: the signed-in user's personal theme applies everywhere,
    // independent of portal context.
    if (App.theme) App.theme.loadAndApply();

    const layout = el("div", "app-shell");

    // Sidebar
    const side = el("aside", "sidebar");
    const brand = el("div", "sidebar-brand");
    brand.innerHTML = `<div class="brand-mark">${esc((App.BRAND||"C").charAt(0))}</div><div class="brand-name">${esc(App.BRAND||"CRM")}</div>`;
    side.appendChild(brand);

    const nav = el("nav", "sidebar-nav");
    const isAdmin = section === "admin";
    const items = isAdmin ? ADMIN_NAV : App.applyNavConfig(PORTAL_NAV);
    items.forEach(([href, label, kind]) => {
      const text = isAdmin ? (kind ? App.label(kind, "many") : label) : App.navLabel(href, label, kind);
      const a = el("a", "nav-item" + (href === activePath ? " active" : ""), esc(text));
      a.href = href;
      nav.appendChild(a);
    });
    side.appendChild(nav);

    const userBox = el("div", "sidebar-user");
    if (section === "portal") {
      const rb = el("a", "recycle-link" + (activePath === "#/recycle" ? " active" : ""), `<span class="rb-icon">&#128465;</span><span>Recycle Bin</span>`);
      rb.href = "#/recycle";
      userBox.appendChild(rb);
    }
    const chip = el("div");
    chip.innerHTML = `<div class="user-chip"><div class="user-avatar">${esc((me.name || me.email).charAt(0).toUpperCase())}</div>
      <div class="user-meta"><div class="user-name">${esc(me.name || me.email)}</div><div class="user-role">${esc(roleLabel(me.role))}</div></div></div>
      <button class="btn btn-ghost btn-sm btn-block" id="logout-btn">Sign out</button>`;
    userBox.appendChild(chip);
    side.appendChild(userBox);
    layout.appendChild(side);

    // Main
    const main = el("div", "main");
    const topbar = el("header", "topbar");
    const topLeft = el("div", "top-left");

    if (section === "portal" && me.role === "SUPER_ADMIN") {
      const back = el("a", "back-link", "← All portals");
      back.href = "#/admin/portals";
      back.onclick = () => { App.state.currentPortalId = null; App.state.currentPortalName = null; };
      topLeft.appendChild(back);
      topLeft.appendChild(el("span", "context-banner", "Viewing: " + esc(App.state.currentPortalName || "portal")));
    } else {
      const titleMap = { "#/dashboard": "Home Dashboard", "#/calls": "Calls", "#/contacts": App.label("contact", "many"), "#/jobs": App.label("job", "many"), "#/fields": "Fields", "#/reports": "Reports", "#/automations": "Automations", "#/settings": "Settings", "#/admin/portals": "Portals", "#/admin/users": "Users" };
      topLeft.appendChild(el("h1", "page-title", titleMap[activePath] || "Home Dashboard"));
    }
    topbar.appendChild(topLeft);

    const topRight = el("div", "top-right");
    if (section === "portal") {
      const refresh = el("button", "btn btn-ghost btn-sm", "Refresh");
      refresh.onclick = () => App.portal.refresh();
      topRight.appendChild(refresh);

      const gear = el("a", "icon-btn gear");
      gear.href = "#/settings";
      gear.title = "Settings";
      gear.innerHTML = "&#9881;";
      topRight.appendChild(gear);
    }
    topbar.appendChild(topRight);
    main.appendChild(topbar);

    const content = el("div", "content");
    const viewEl = el("div");
    viewEl.id = "view";
    content.appendChild(viewEl);
    main.appendChild(content);
    layout.appendChild(main);

    root.appendChild(layout);
    App.util.$("#logout-btn").onclick = logout;
  }

  function route() {
    const { path, query } = parseHash();
    const me = App.state.me;

    // Foundation (relabeling): keep the per-portal label cache warm — but only
    // when there's a portal in context. A SUPER_ADMIN who hasn't picked a portal
    // has no tenant to scope to, so requesting labels then is meaningless (and
    // was causing a 400 on /api/labels).
    if (me && (me.role !== "SUPER_ADMIN" || App.state.currentPortalId)) App.ensureLabels();

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
      if (me.role !== "SUPER_ADMIN") return App.go("#/dashboard");
      const sub = path === "/admin/users" ? "users" : "portals";
      buildShell("admin", "#/admin/" + sub);
      return App.admin.render(sub);
    }

    // Contact profile page
    if (path.indexOf("/contact/") === 0) {
      const id = path.slice("/contact/".length);
      if (me.role === "SUPER_ADMIN" && !App.state.currentPortalId) return App.go("#/admin/portals");
      buildShell("portal", "#/contacts");
      return App.portal.renderContact(id);
    }

    // Record (e.g. Job) detail page
    if (path.indexOf("/record/") === 0) {
      const id = path.slice("/record/".length);
      if (me.role === "SUPER_ADMIN" && !App.state.currentPortalId) return App.go("#/admin/portals");
      buildShell("portal", "#/jobs");
      return App.portal.renderRecord(id);
    }

    // Old Inbound link now lives inside Settings.
    if (path === "/inbound") return App.go("#/settings/leadcapture");

    // Settings (with optional sub-section, e.g. #/settings/appearance) — the
    // sub-section drives the in-view sub-shell; refresh/back keep their place.
    if (path === "/settings" || path.indexOf("/settings/") === 0) {
      if (me.role === "SUPER_ADMIN" && !App.state.currentPortalId) return App.go("#/admin/portals");
      buildShell("portal", "#/settings");
      const sub = path === "/settings" ? "" : path.slice("/settings/".length);
      return App.portal.render("settings", sub);
    }

    // Portal section
    const portalViews = { "/dashboard": "dashboard", "/calls": "calls", "/contacts": "contacts", "/jobs": "jobs", "/recycle": "recycle", "/fields": "fields", "/reports": "reports", "/automations": "automations", "/learn": "learn", "/settings": "settings" };
    if (portalViews[path]) {
      if (me.role === "SUPER_ADMIN" && !App.state.currentPortalId) return App.go("#/admin/portals");
      // If this page has been hidden from the nav for this portal, send the user
      // to the always-present Home Dashboard rather than a page with no way back.
      if (App.isNavHidden && App.isNavHidden("#" + path)) return App.go("#/dashboard");
      buildShell("portal", path === "/settings" ? "#/settings" : "#" + path);
      return App.portal.render(portalViews[path]);
    }

    // Fallback
    return App.afterLogin();
  }

  async function boot() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      App.state.me = res.ok ? (await res.json()).user : null;
    } catch (e) { App.state.me = null; }
    route();
  }

  window.addEventListener("hashchange", route);
  App._route = route;
  boot();
})(typeof window !== "undefined" ? window : globalThis);
