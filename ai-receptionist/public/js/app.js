(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, roleLabel } = App.util;

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
    location.hash = "#/login";
  }

  const PORTAL_NAV = [["#/dashboard", "Dashboard"], ["#/calls", "Calls"], ["#/contacts", "Contacts"], ["#/fields", "Fields"]];
  const ADMIN_NAV = [["#/admin/portals", "Portals"], ["#/admin/users", "Users"]];

  function buildShell(section, activePath) {
    const me = App.state.me;
    const root = App.util.$("#app");
    root.innerHTML = "";
    const layout = el("div", "app-shell");

    // Sidebar
    const side = el("aside", "sidebar");
    const brand = el("div", "sidebar-brand");
    brand.innerHTML = `<div class="brand-mark">R</div><div class="brand-name">Receptionist</div>`;
    side.appendChild(brand);

    const nav = el("nav", "sidebar-nav");
    const items = section === "admin" ? ADMIN_NAV : PORTAL_NAV;
    items.forEach(([href, label]) => {
      const a = el("a", "nav-item" + (href === activePath ? " active" : ""), esc(label));
      a.href = href;
      nav.appendChild(a);
    });
    side.appendChild(nav);

    const userBox = el("div", "sidebar-user");
    userBox.innerHTML = `<div class="user-chip"><div class="user-avatar">${esc((me.name || me.email).charAt(0).toUpperCase())}</div>
      <div class="user-meta"><div class="user-name">${esc(me.name || me.email)}</div><div class="user-role">${esc(roleLabel(me.role))}</div></div></div>
      <button class="btn btn-ghost btn-sm btn-block" id="logout-btn">Sign out</button>`;
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
      const titleMap = { "#/dashboard": "Dashboard", "#/calls": "Calls", "#/contacts": "Contacts", "#/fields": "Fields", "#/settings": "Settings", "#/admin/portals": "Portals", "#/admin/users": "Users" };
      topLeft.appendChild(el("h1", "page-title", titleMap[activePath] || "Dashboard"));
    }
    topbar.appendChild(topLeft);

    const topRight = el("div", "top-right");
    if (section === "portal") {
      const refresh = el("button", "btn btn-ghost btn-sm", "Refresh");
      refresh.onclick = () => App.portal.refresh();
      topRight.appendChild(refresh);

      const sim = el("button", "btn btn-ghost btn-sm");
      sim.id = "simulate-btn";
      sim.innerHTML = `<span class="btn-icon">&#9654;</span> Simulate call`;
      sim.onclick = () => App.portal.simulate();
      topRight.appendChild(sim);

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

    // Portal section
    const portalViews = { "/dashboard": "dashboard", "/calls": "calls", "/contacts": "contacts", "/fields": "fields", "/settings": "settings" };
    if (portalViews[path]) {
      if (me.role === "SUPER_ADMIN" && !App.state.currentPortalId) return App.go("#/admin/portals");
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
