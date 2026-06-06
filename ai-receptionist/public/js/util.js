(function (global) {
  const App = global.App || (global.App = {});

  // Product brand — change this one line to rename the app everywhere in-app.
  App.BRAND = "Clarity CRM";

  App.state = { me: null, currentPortalId: null, currentPortalName: null };

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
    return { SUPER_ADMIN: "Super Admin", PORTAL_ADMIN: "Portal Admin", CLIENT_USER: "Client User" }[role] || role;
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
      t.style.transition = "opacity .2s ease";
      t.style.opacity = "0";
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
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // Portal-scoped API: a super admin appends ?tenantId of the portal they entered.
  function portalApi(path, opts) {
    let url = path;
    if (App.state.me && App.state.me.role === "SUPER_ADMIN" && App.state.currentPortalId) {
      url += (url.indexOf("?") >= 0 ? "&" : "?") + "tenantId=" + encodeURIComponent(App.state.currentPortalId);
    }
    return api(url, opts);
  }

  App.util = { $, $$, el, esc, fmtDate, statusBadge, roleLabel, toast, debounce };
  App.api = api;
  App.portalApi = portalApi;
})(typeof window !== "undefined" ? window : globalThis);
