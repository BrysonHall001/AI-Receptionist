(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, fmtDate, fmtDateOnly, statusBadge, roleLabel, toast } = App.util;

  let current = "portals";
  let portalsCache = [];

  function view() { return App.util.$("#view"); }
  function loading() { view().innerHTML = `<div class="card"><div class="skeleton">Loading…</div></div>`; }

  // ---- Voice mode (AI Receptionist 3-way choice) ----
  // OFF = decline calls; WALKIE = Standard voice (cheap Say/Gather); SMOOTH =
  // Premium voice (ElevenLabs ConversationRelay). The server keeps the legacy
  // receptionistEnabled boolean in sync, so older data still reads correctly.
  const VOICE_LABELS = { OFF: "Off", WALKIE: "Standard voice", SMOOTH: "Premium voice" };
  function voiceModeOf(p) {
    return (p && p.voiceMode) || (p && p.receptionistEnabled === true ? "WALKIE" : "OFF");
  }
  function voiceOptionsHtml(selected) {
    return ["OFF", "WALKIE", "SMOOTH"]
      .map((m) => `<option value="${m}" ${m === selected ? "selected" : ""}>${VOICE_LABELS[m]}</option>`)
      .join("");
  }
  function voiceToast(mode) {
    return mode === "OFF"
      ? "AI Receptionist turned off"
      : `AI Receptionist set to ${VOICE_LABELS[mode]}`;
  }

  async function render(v) {
    current = v;
    if (v === "users") return renderUsers();
    if (v === "feedback") return App.feedback.renderMaster(view());
    if (v === "changelog") return renderChangelog();
    return renderPortals();
  }

  function modal(inner) {
    const overlay = el("div", "modal-overlay");
    const box = el("div", "modal");
    box.appendChild(inner);
    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    return overlay;
  }

  // ---------------- Portals ----------------
  // Master-hub saved filters. The saved-filters SERVER feature is tenant-scoped
  // (SavedFilter.tenantId is required), and the master hub has no tenant context, so these
  // persist client-side in localStorage — the same pattern the app uses for other table
  // view prefs. Same UX as the portal's Saved Filters: save / apply / delete named filter
  // states via the table handle's getState()/applyState().
  function adminFiltersKey(view) { return "airec.adminSavedFilters." + view; }
  function loadAdminFilters(view) { try { return JSON.parse(localStorage.getItem(adminFiltersKey(view)) || "[]") || []; } catch (e) { return []; } }
  function saveAdminFilters(view, list) { try { localStorage.setItem(adminFiltersKey(view), JSON.stringify(list || [])); } catch (e) {} }
  function mountAdminSavedFilters(handle, view) {
    if (!handle || !handle.toolbarLeft) return;
    const dd = el("div", "saved-wrap");
    const btn = el("button", "btn btn-ghost btn-sm", "Saved Filters \u25be");
    const menu = el("div", "saved-menu hidden");
    dd.appendChild(btn); dd.appendChild(menu);
    handle.toolbarLeft.appendChild(dd);
    function paint() {
      const list = loadAdminFilters(view);
      menu.innerHTML = "";
      if (!list.length) menu.appendChild(el("div", "saved-empty", "No saved filters yet"));
      list.forEach((f, i) => {
        const row = el("div", "saved-item");
        const name = el("button", "saved-name", esc(f.name));
        name.onclick = () => { handle.applyState(f.definition); menu.classList.add("hidden"); toast("Applied \u201c" + f.name + "\u201d"); };
        const del = el("button", "saved-del", "\u00d7"); del.title = "Delete";
        del.onclick = (e) => { e.stopPropagation(); const cur = loadAdminFilters(view); cur.splice(i, 1); saveAdminFilters(view, cur); toast("Filter deleted"); paint(); };
        row.appendChild(name); row.appendChild(del); menu.appendChild(row);
      });
      menu.appendChild(el("div", "pop-sep"));
      const save = el("button", "saved-save", "+ Save current filter\u2026");
      save.onclick = async () => {
        const def = handle.getState();
        if (!def.rules.length && !Object.keys(def.colFilters || {}).length && !def.search) { toast("Set some filters first", true); return; }
        const name = await App.ui.promptModal({ title: "Save filter", label: "Name this filter", okText: "Save" });
        if (!name || !name.trim()) return;
        const cur = loadAdminFilters(view); cur.push({ name: name.trim(), definition: def }); saveAdminFilters(view, cur);
        toast("Filter saved"); paint();
      };
      menu.appendChild(save);
    }
    btn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle("hidden"); if (!menu.classList.contains("hidden")) setTimeout(() => document.addEventListener("click", () => menu.classList.add("hidden"), { once: true }), 0); };
    menu.addEventListener("click", (e) => e.stopPropagation());
    paint();
  }

  async function renderPortals() {
    loading();
    const portals = await App.api("/api/admin/portals");
    portalsCache = portals;
    const wrap = el("div", "fade-in");

    // Tenants list — the reusable App.table (same component as Contacts/Records),
    // so we get search, sort, column filters, saved filters, and the filter rail for free.
    // The `tenants-table-host` class scopes the compact-row CSS override to THIS table only.
    const tableHost = el("div", "tenants-table-host");
    wrap.appendChild(tableHost);

    const columns = [
      { key: "name", label: "Tenant Name", get: (p) => p.name,
        render: (p) => `<span style="font-weight:600">${esc(p.name)}</span>` },
      { key: "status", label: "Status", get: (p) => (p.status === "ACTIVE" ? "Active" : "Suspended"),
        render: (p) => statusBadge(p.status) },
      { key: "created", label: "Created", type: "date", get: (p) => p.createdAt, text: (p) => fmtDate(p.createdAt),
        render: (p) => esc(fmtDate(p.createdAt)) },
      { key: "ai", label: "AI Receptionist", get: (p) => VOICE_LABELS[voiceModeOf(p)],
        render: (p) => `<select class="input portal-recep-sel t-voice" data-id="${esc(p.id)}">${voiceOptionsHtml(voiceModeOf(p))}</select>` },
      { key: "calls", label: "Calls", type: "number", get: (p) => p.calls },
      { key: "contacts", label: "Contacts", type: "number", get: (p) => p.contacts },
      { key: "users", label: "Users", type: "number", get: (p) => p.users },
      // Actions column trimmed to a single compact square arrow that enters the portal.
      // Users, Page access, and Suspend/Activate now live in the row-detail panel (row click).
      { key: "actions", label: "Open tenant", filterable: false, get: () => "",
        render: (p) => `<button class="btn btn-primary btn-sm t-openbtn" data-act="open" data-id="${esc(p.id)}" title="Open tenant" aria-label="Open tenant" style="padding:4px 9px;line-height:1;min-width:0;font-size:14px">\u2197</button>` },
    ];

    // Persist the Tenants column layout per-browser, mirroring how portal.js persists
    // record-table layouts (recordLayoutKey/loadRecordLayout/saveRecordLayout): load the
    // saved order + hidden set on mount and write it back on save, so hiding/reordering a
    // column survives navigating away and back — identical behavior to the portal tables.
    const TENANTS_COLS_KEY = "admincols:tenants";
    const loadTenantsLayout = () => { try { return JSON.parse(localStorage.getItem(TENANTS_COLS_KEY) || "{}") || {}; } catch (e) { return {}; } };
    const saveTenantsLayout = (layout) => { try { localStorage.setItem(TENANTS_COLS_KEY, JSON.stringify(layout || {})); } catch (e) {} };
    const tenantsDefaultKeys = columns.map((c) => c.key);
    const tenantsLayout = loadTenantsLayout();
    // Apply the saved layout to the columns we mount with (like portal.js applies it
    // before mount) so there's no flash of the default layout before it settles.
    const initialColumns = App.table.applyColumnLayout(columns, tenantsLayout, tenantsDefaultKeys);

    const handle = App.table.mount({
      container: tableHost,
      rows: portals,
      columns: initialColumns,
      rowId: (p) => p.id,
      scrollX: true,
      defaultSort: "created",
      defaultSortDir: "desc",
      // Clicking a row (but not an inline control — App.table ignores clicks on
      // button/select/input/label) opens the admin-side detail panel. It never enters
      // the portal.
      onRowClick: (p) => renderTenantDetail(p),
      emptyHtml: `<div class="empty"><div class="empty-emoji">&#127970;</div><h3>No tenants yet</h3><p>Create your first client tenant to get started.</p></div>`,
    });

    // Top button row, left->right: [Filters][Saved filters] … [Manage columns][+ Create tenant][Search].
    // Filters stays flush-left (first in toolbar-left); Saved filters sits beside it. In the
    // right group we insert Create BEFORE Search, then Manage Columns before Create — so the
    // shared column manager ends up to the LEFT of Create tenant.
    mountAdminSavedFilters(handle, "admin-tenants");
    const create = el("button", "btn btn-primary btn-sm", "+ Create tenant");
    create.onclick = () => renderSetupScreen();
    if (handle.toolbarRight) handle.toolbarRight.insertBefore(create, handle.toolbarRight.firstChild);
    // Standard shared Manage Columns control (same component as Contacts/Records). Because
    // it inserts before toolbarRight.firstChild (now Create), it lands left of Create.
    // Pass the loaded order/hidden so it opens showing the persisted layout, and onSave
    // writes changes back to localStorage.
    App.table.manageColumns(handle, columns, {
      defaultKeys: tenantsDefaultKeys,
      order: tenantsLayout.order,
      hidden: tenantsLayout.hidden,
      onSave: (newLayout) => saveTenantsLayout(newLayout),
    });

    // Caption below the button/search row, above the table. Its left edge must line up
    // with the Filters button and the first table column — both of which sit 18px in
    // (.toolbar-left has padding-left:18px; thead th / tbody td have padding …18px; .card
    // itself has NO padding). So the caption needs margin-left:18px, not 0 (a prior "fix"
    // set it to 0, which is why it read 18px too far left).
    const caption = el("p", "cell-muted");
    caption.style.cssText = "font-size:12.5px;margin:4px 0 10px 18px";
    caption.textContent = "Click a tenant row to edit its properties (page access, users, status).";
    const tbEl = tableHost.querySelector(".table-toolbar");
    if (tbEl) tbEl.insertAdjacentElement("afterend", caption); else tableHost.insertBefore(caption, tableHost.firstChild);

    // Delegated handlers live on the stable host so they survive App.table's internal
    // re-renders. AI Receptionist select (change) + the Open-tenant arrow (click).
    const findP = (id) => portalsCache.find((x) => x.id === id);
    tableHost.addEventListener("change", async (e) => {
      const sel = e.target.closest && e.target.closest(".t-voice");
      if (!sel) return;
      const p = findP(sel.getAttribute("data-id"));
      if (!p) return;
      const voiceMode = sel.value;
      try {
        await App.api(`/api/admin/portals/${p.id}`, { method: "PATCH", body: JSON.stringify({ voiceMode }) });
        p.voiceMode = voiceMode; p.receptionistEnabled = voiceMode !== "OFF";
        toast(voiceToast(voiceMode));
      } catch (err) { toast(err.message, true); sel.value = voiceModeOf(p); }
    });
    tableHost.addEventListener("click", async (e) => {
      const btn = e.target.closest && e.target.closest("[data-act]");
      if (!btn) return;
      e.stopPropagation(); // don't let the arrow also trigger the row-detail click
      const p = findP(btn.getAttribute("data-id"));
      if (!p) return;
      if (btn.getAttribute("data-act") === "open") return enterPortal(p);
    });

    view().innerHTML = "";
    view().appendChild(wrap);
  }

  // ---------------- Per-tenant Users section (rendered inside the detail panel) ----
  // Lists and creates users for ONE tenant, scoped by ?tenantId. Renders INTO `host` so
  // it can sit alongside Page access + status in the tenant detail panel. Creation uses
  // the per-portal endpoint POST /api/users, which clamps the role to portal-admin/
  // client-user server-side, so only those two roles are offered.
  async function usersSectionInto(host, portal) {
    host.innerHTML = "";
    const head = el("div", "page-actions"); head.style.cssText = "align-items:center;margin-bottom:8px";
    const h = el("h2", "settings-h", "Users"); h.style.flex = "1";
    const create = el("button", "btn btn-primary btn-sm", "+ Create user");
    create.onclick = () => openCreateUser(portal);
    head.appendChild(h); head.appendChild(create);
    host.appendChild(head);

    let users = [];
    try { users = await App.api("/api/users?tenantId=" + encodeURIComponent(portal.id)); } catch (e) { toast(e.message, true); }

    const card = el("div", "card");
    const table = el("table");
    table.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th></th></tr></thead>`;
    const tb = el("tbody");
    if (!users.length) {
      const tr = el("tr");
      tr.innerHTML = `<td colspan="5" class="cell-muted">No users in this tenant yet.</td>`;
      tb.appendChild(tr);
    } else {
      users.forEach((u) => {
        const tr = el("tr");
        const lastCell = u.pending
          ? '<span class="badge badge-progress">Pending</span>'
          : (u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never");
        tr.innerHTML = `<td class="cell-strong">${esc(u.name || "—")}</td><td class="cell-mono">${esc(u.email)}</td>
          <td>${esc(roleLabel(u.role))}</td><td class="cell-muted">${lastCell}</td><td></td>`;
        if (u.pending) {
          const rev = el("button", "link-danger", "Revoke");
          rev.onclick = async () => {
            if (!(await App.ui.confirmModal({ title: "Revoke invite", message: `Revoke the pending invite for ${u.email}?`, confirmText: "Revoke" }))) return;
            try { await App.api("/api/invites/" + u.inviteId + "/revoke?tenantId=" + encodeURIComponent(portal.id), { method: "POST" }); toast("Invite revoked"); usersSectionInto(host, portal); }
            catch (e) { toast(e.message, true); }
          };
          tr.lastChild.appendChild(rev);
        } else if (u.id !== App.state.me.id) {
          const del = el("button", "link-danger", "Remove");
          del.onclick = async () => {
            if (!(await App.ui.confirmModal({ title: "Remove user", message: `Remove ${u.email}?`, confirmText: "Remove" }))) return;
            try { await App.api("/api/users/" + u.id + "?tenantId=" + encodeURIComponent(portal.id), { method: "DELETE" }); toast("User removed"); usersSectionInto(host, portal); }
            catch (e) { toast(e.message, true); }
          };
          tr.lastChild.appendChild(del);
        }
        tb.appendChild(tr);
      });
    }
    table.appendChild(tb);
    card.appendChild(table);
    host.appendChild(card);
  }

  function enterPortal(p) {
    App.state.currentPortalId = p.id;
    App.state.currentPortalName = p.name;
    // Read the AI Receptionist flag from the just-loaded card data so the left nav
    // is correct on the FIRST paint of this entry (no stale cached value, no flash),
    // and clear the cache key so it's re-confirmed fresh from the server on entry.
    App.state.receptionistEnabled = !!(p && p.receptionistEnabled === true);
    App.state._recepFor = null;
    App.go("#/dashboard");
  }

  // ===================== Owner page-lock (master-hub only) =====================
  // The lockable left-nav pages. Jobs & Bookings share the records area + endpoints, so
  // they're ONE lock unit (locking hides both nav items and blocks /records*).
  const LOCKABLE_PAGES = [
    { label: "Home Dashboard", hrefs: ["#/dashboard"] },
    { label: "Calls", hrefs: ["#/calls"] },
    { label: "Contacts", hrefs: ["#/contacts"] },
    { label: "Jobs & Bookings", hrefs: ["#/jobs", "#/bookings"] },
    { label: "Analytics", hrefs: ["#/reports"] },
    { label: "Automations", hrefs: ["#/automations"] },
    { label: "Communication", hrefs: ["#/communication"] },
    { label: "Learning Center", hrefs: ["#/learn"] },
    { label: "Feedback", hrefs: ["#/feedback"] },
  ];
  // Build a checklist of lockable pages into `host`, reflecting `lockedHrefs`. A box is
  // checked when ALL of its hrefs are locked; toggling adds/removes all of them (so the
  // Jobs & Bookings pair moves together). Returns a getter for the selected hrefs and
  // calls onChange(hrefs) on every toggle. Shared by the config view + wizard step 4.
  function lockChecklist(host, lockedHrefs, onChange) {
    const locked = new Set(lockedHrefs || []);
    LOCKABLE_PAGES.forEach((pg) => {
      const row = el("label"); row.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 0;cursor:pointer;border-top:1px solid var(--line,#eee)";
      const cb = el("input"); cb.type = "checkbox"; cb.checked = pg.hrefs.every((h) => locked.has(h));
      cb.onchange = () => { pg.hrefs.forEach((h) => { if (cb.checked) locked.add(h); else locked.delete(h); }); if (onChange) onChange(Array.from(locked)); };
      row.appendChild(cb); row.appendChild(document.createTextNode(" " + pg.label));
      host.appendChild(row);
    });
    return () => Array.from(locked);
  }

  // Page-access (owner page-lock) SECTION for the tenant detail panel. Returns a node with
  // the lockable-pages checklist + a Save button. PATCHes {lockedPages}; never enters the
  // portal. Owner-only by the admin router guard; no in-portal equivalent exists.
  function pageAccessSection(portal) {
    const sec = el("div");
    const h = el("h2", "settings-h", "Page access");
    sec.appendChild(h);
    const hint = el("p", "cell-muted"); hint.style.cssText = "font-size:12.5px;margin:0 0 8px";
    hint.textContent = "Lock pages for this tenant. A locked page is hidden from everyone in the tenant — including its Portal Admin — and can't be reached by direct link or API.";
    sec.appendChild(hint);
    const card = el("div", "card"); card.style.cssText = "padding:20px";
    const listHost = el("div");
    const getLocked = lockChecklist(listHost, portal.lockedPages || []);
    card.appendChild(listHost);
    const save = el("button", "btn btn-primary btn-sm", "Save page access"); save.style.marginTop = "12px";
    save.onclick = async () => {
      save.disabled = true;
      try {
        await App.api("/api/admin/portals/" + encodeURIComponent(portal.id), { method: "PATCH", body: JSON.stringify({ lockedPages: getLocked() }) });
        portal.lockedPages = getLocked();
        toast("Page access updated"); save.disabled = false;
      } catch (e) { toast(e.message, true); save.disabled = false; }
    };
    card.appendChild(save);
    sec.appendChild(card);
    return sec;
  }

  // Admin-side per-tenant DETAIL panel, opened by clicking a Tenants row. Composes Page
  // access + Users + Suspend/Activate. It NEVER enters the portal (no currentPortalId /
  // enterPortal) — "configure this tenant without entering it". Back returns to the table.
  async function renderTenantDetail(portalRow) {
    loading();
    let portal;
    try { portal = await App.api("/api/admin/portals/" + encodeURIComponent(portalRow.id)); }
    catch (e) { toast(e.message, true); return renderPortals(); }

    // Guard the whole build so a render error can NEVER leave the spinner up — show a
    // visible error state instead.
    try {
      const wrap = el("div", "fade-in");
      const bar = el("div", "page-actions"); bar.style.alignItems = "center";
      const back = el("button", "btn btn-ghost btn-sm", "← Back to tenants");
      back.onclick = () => renderPortals();
      const title = el("div", "page-title", esc(portal.name)); title.style.cssText = "flex:1;font-weight:600";
      // statusBadge() returns an HTML STRING (built for innerHTML / table cells), NOT a DOM
      // node — so it must go through innerHTML, not appendChild. (This mismatch was the
      // cause of the permanent "Loading…": appendChild(string) threw before the view swap.)
      const status = el("span"); status.innerHTML = statusBadge(portal.status);
      const toggle = el("button", "btn btn-ghost btn-sm", portal.status === "ACTIVE" ? "Suspend tenant" : "Activate tenant");
      toggle.onclick = async () => {
        toggle.disabled = true;
        const next = portal.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
        try { await App.api("/api/admin/portals/" + encodeURIComponent(portal.id), { method: "PATCH", body: JSON.stringify({ status: next }) }); portal.status = next; toast("Tenant updated"); renderTenantDetail(portal); }
        catch (e) { toast(e.message, true); toggle.disabled = false; }
      };
      bar.appendChild(back); bar.appendChild(title); bar.appendChild(status); bar.appendChild(toggle);
      wrap.appendChild(bar);

      const caption = el("p", "cell-muted"); caption.style.cssText = "margin:-4px 0 16px;font-size:12.5px";
      caption.textContent = "Configure this tenant’s page access, users, and status. This does not enter the portal.";
      wrap.appendChild(caption);

      wrap.appendChild(pageAccessSection(portal));

      const usersHost = el("div"); usersHost.style.marginTop = "22px";
      usersHost.innerHTML = `<h2 class="settings-h">Users</h2><div class="cell-muted" style="padding:6px">Loading users…</div>`;
      wrap.appendChild(usersHost);

      // Render the shell (Back + Suspend + Page access) IMMEDIATELY, then fill Users async
      // so a slow or failing users fetch can't block or hang the panel.
      view().innerHTML = ""; view().appendChild(wrap);
      usersSectionInto(usersHost, portal).catch((e) => {
        usersHost.innerHTML = `<h2 class="settings-h">Users</h2><div class="card"><p class="cell-muted">Couldn’t load users: ${esc((e && e.message) || "error")}</p></div>`;
      });
    } catch (e) {
      view().innerHTML = `<div class="card"><p class="cell-muted">Couldn’t open this tenant: ${esc((e && e.message) || "error")}</p></div>`;
      toast((e && e.message) || "Couldn’t open this tenant", true);
    }
  }

  // ===================== Create-tenant wizard (client-side DRAFT) =====================
  // ATOMIC: nothing is written until the user clicks "Finish". All four steps collect
  // into `draft` (name/email, queued user invites, theme preset, receptionist mode).
  // On Finish we create the tenant, then apply the queued config in sequence, then enter
  // it. Abandoning (Back / nav-away / tab-close) persists NOTHING — no tenant, no users,
  // no theme. Every step is active from the start; there is no "create tenant first" gate.
  function renderSetupScreen() {
    const prior = { id: App.state.currentPortalId, name: App.state.currentPortalName };
    const draft = { users: [], themePreset: "", voiceMode: "OFF", lockedPages: [] };

    // Built-in theme preset ids (match src/theme/themes.ts). "" = leave the default.
    const THEME_PRESETS = [
      ["", "Default (Clean Light)"], ["warm", "Warm Light"], ["slate", "Slate"],
      ["steel", "Steel Blue"], ["contrast", "High Contrast"], ["dark", "Dark"], ["midnight", "Midnight"],
    ];

    function elNote(text) { const d = el("div", "cell-muted"); d.style.cssText = "margin-top:8px;font-size:13px;"; d.textContent = text; return d; }
    function leave(toList) {
      App.state.currentPortalId = prior.id;
      App.state.currentPortalName = prior.name;
      if (toList) render("portals");
    }
    function sectionCard(n, title, desc) {
      const card = el("div", "card");
      card.style.cssText = "margin-bottom:16px;padding:20px;";
      const head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:12px;";
      const num = el("div", null, String(n));
      num.style.cssText = "flex:0 0 28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;background:var(--accent,#3257d6);color:#fff;";
      const tt = el("div"); tt.innerHTML = `<div style="font-weight:600">${esc(title)}</div><div class="cell-muted" style="font-size:13px">${esc(desc)}</div>`;
      head.appendChild(num); head.appendChild(tt);
      card.appendChild(head);
      return card;
    }

    const wrap = el("div", "fade-in");
    const head = el("div");
    head.innerHTML = `<h1 class="page-title">Create a tenant</h1>
      <p class="cell-muted">Fill in the steps below, then click Finish to create the tenant with everything set up at once. Nothing is saved until you click Finish — back out any time before then and nothing is created.</p>`;
    wrap.appendChild(head);

    // ---- Step 1: basic details ----
    const s1 = sectionCard(1, "Basic details", "The tenant's name, and optionally where call summaries go.");
    const f1 = el("div");
    f1.innerHTML = `
      <label class="field-label">Business name *</label><input id="sp-name" class="input" placeholder="Acme Plumbing" />
      <label class="field-label">Notify email</label><input id="sp-email" class="input" placeholder="owner@acme.com" />
      <p class="cell-muted" style="font-size:12.5px;margin:8px 0 0">Notify email is optional — it's where call summaries and notifications go.</p>`;
    s1.appendChild(f1);
    wrap.appendChild(s1);

    // ---- Step 2: add users (queued into the draft; invited on Finish) ----
    const s2 = sectionCard(2, "Add users", "Queue teammates to invite. Each gets an invite link when you finish. You can add none, one, or several.");
    const uForm = el("div"); uForm.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;";
    uForm.innerHTML = `
      <div style="flex:1 1 220px"><label class="field-label">Email</label><input id="sp-user-email" class="input" type="email" placeholder="teammate@company.com" style="margin-bottom:0" /></div>
      <div style="flex:0 0 170px"><label class="field-label">Role</label><select id="sp-user-role" class="input" style="margin-bottom:0"><option value="CLIENT_USER">Client user</option><option value="PORTAL_ADMIN">Portal admin</option></select></div>`;
    const addUserBtn = el("button", "btn btn-ghost btn-sm", "+ Add to list");
    uForm.appendChild(addUserBtn);
    s2.appendChild(uForm);
    const uList = el("div"); uList.style.marginTop = "10px";
    s2.appendChild(uList);
    function paintUsers() {
      uList.innerHTML = "";
      if (!draft.users.length) { uList.appendChild(elNote("No users queued yet — that's fine, you can invite people later too.")); return; }
      draft.users.forEach((u, i) => {
        const row = el("div"); row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line,#eee)";
        row.innerHTML = `<span style="flex:1">${esc(u.email)}</span><span class="pill" style="font-size:11px">${u.role === "PORTAL_ADMIN" ? "Portal admin" : "Client user"}</span>`;
        const rm = el("button", "btn btn-ghost btn-sm", "Remove");
        rm.onclick = () => { draft.users.splice(i, 1); paintUsers(); };
        row.appendChild(rm); uList.appendChild(row);
      });
    }
    addUserBtn.onclick = () => {
      const em = document.querySelector("#sp-user-email");
      const rl = document.querySelector("#sp-user-role");
      const email = (em.value || "").trim();
      if (!email || email.indexOf("@") === -1) { toast("Enter a valid email to queue", true); return; }
      draft.users.push({ email: email, role: rl.value });
      em.value = ""; paintUsers();
    };
    paintUsers();
    wrap.appendChild(s2);

    // ---- Step 3: appearance (theme preset into the draft; applied on Finish) ----
    const s3 = sectionCard(3, "Appearance", "Pick a starting theme for the tenant.");
    const tWrap = el("div");
    tWrap.innerHTML = `<label class="field-label">Theme</label>`;
    const tSel = el("select", "input");
    tSel.innerHTML = THEME_PRESETS.map((p) => `<option value="${p[0]}">${esc(p[1])}</option>`).join("");
    tSel.onchange = () => { draft.themePreset = tSel.value; };
    tWrap.appendChild(tSel);
    s3.appendChild(tWrap);
    wrap.appendChild(s3);

    // ---- Step 4: features (receptionist mode into the draft; applied on Finish) ----
    const s4 = sectionCard(4, "Features", "Turn on the AI Receptionist. New tenants start with it off.");
    const vWrap = el("div");
    vWrap.innerHTML = `<label class="field-label">AI Receptionist</label>`;
    const vSel = el("select", "input");
    vSel.innerHTML = voiceOptionsHtml("OFF"); vSel.value = "OFF";
    vSel.onchange = () => { draft.voiceMode = vSel.value; };
    vWrap.appendChild(vSel);
    const vCap = el("p", "cell-muted"); vCap.style.cssText = "margin:8px 0 0;font-size:13px;";
    vCap.textContent = "Off declines inbound calls. Standard voice is the basic back-and-forth receptionist. Premium voice uses the smooth ElevenLabs voice.";
    s4.appendChild(vWrap); s4.appendChild(vCap);
    // Page access (owner page-lock) — sets the INITIAL locked set into the draft.
    const lockHost = el("div"); lockHost.style.marginTop = "16px";
    const lockLab = el("label", "field-label", "Page access"); lockLab.style.cssText = "margin:0 0 2px";
    const lockNote = el("p", "cell-muted"); lockNote.style.cssText = "margin:0 0 4px;font-size:12.5px;";
    lockNote.textContent = "Lock pages so this tenant can't see or reach them. You can change this anytime from the tenant's row.";
    lockHost.appendChild(lockLab); lockHost.appendChild(lockNote);
    lockChecklist(lockHost, draft.lockedPages, (arr) => { draft.lockedPages = arr; });
    s4.appendChild(lockHost);
    wrap.appendChild(s4);

    // ---- Footer: Finish creates the tenant, then applies the draft, then enters it ----
    const footer = el("div", "page-actions");
    footer.style.cssText = "margin-top:8px;display:flex;gap:8px;";
    const finish = el("button", "btn btn-primary btn-sm", "Finish — go to tenant");
    finish.onclick = async () => {
      const nameEl = document.querySelector("#sp-name");
      const emailEl = document.querySelector("#sp-email");
      const name = nameEl ? nameEl.value.trim() : "";
      const notifyEmail = emailEl ? emailEl.value.trim() : "";
      if (!name) { toast("Business name is required", true); if (nameEl) nameEl.focus(); return; }
      finish.disabled = true;

      // 1) Create the tenant. If THIS fails, nothing was persisted — stay on the screen.
      let portal;
      try {
        portal = await App.api("/api/admin/portals", { method: "POST", body: JSON.stringify({ name, notifyEmail, lockedPages: draft.lockedPages }) });
      } catch (err) { toast(err.message || "Could not create the tenant", true); finish.disabled = false; return; }

      // 2) Apply the queued draft in sequence. Collect failures instead of throwing, so
      //    one bad step never hides the others or leaves a silent partial setup.
      App.state.currentPortalId = portal.id;
      App.state.currentPortalName = portal.name;
      const problems = [];
      if (draft.themePreset) {
        try { await App.portalApi("/api/theme", { method: "PATCH", body: JSON.stringify({ theme: { active: { mode: "preset", preset: draft.themePreset }, customs: [] } }) }); }
        catch (e) { problems.push("theme"); }
      }
      if (draft.voiceMode && draft.voiceMode !== "OFF") {
        try { await App.api(`/api/admin/portals/${portal.id}`, { method: "PATCH", body: JSON.stringify({ voiceMode: draft.voiceMode }) }); }
        catch (e) { problems.push("receptionist"); }
      }
      let invited = 0;
      for (const u of draft.users) {
        try { await App.api(`/api/admin/portals/${portal.id}/invites`, { method: "POST", body: JSON.stringify({ email: u.email, role: u.role }) }); invited++; }
        catch (e) { problems.push("invite " + u.email); }
      }

      // 3) Report + enter the tenant (never leave an orphan silently).
      const okMsg = `Tenant created${draft.users.length ? `, ${invited}/${draft.users.length} invite(s) sent` : ""}`;
      if (problems.length) toast(`${okMsg}. Couldn't apply: ${problems.join(", ")} — you can finish those inside the tenant.`, true);
      else toast(okMsg);
      enterPortal(portal); // sets currentPortalId + navigates into the new tenant
    };
    const back = el("button", "btn btn-ghost btn-sm", "Back to tenants");
    back.onclick = () => leave(true);
    footer.appendChild(finish); footer.appendChild(back);
    wrap.appendChild(footer);

    view().innerHTML = "";
    view().appendChild(wrap);
  }
  // ---------------- Users ----------------
  async function renderUsers() {
    loading();
    const users = await App.api("/api/admin/users");
    if (!portalsCache.length) { try { portalsCache = await App.api("/api/admin/portals"); } catch (e) {} }
    const wrap = el("div", "fade-in");
    const bar = el("div", "page-actions");
    const create = el("button", "btn btn-primary btn-sm", "+ Create user");
    create.onclick = () => openCreateUser();
    bar.appendChild(create);
    wrap.appendChild(bar);

    const card = el("div", "card");
    const table = el("table");
    table.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Tenant</th><th>Last login</th><th></th></tr></thead>`;
    const tb = el("tbody");
    users.forEach((u) => {
      const tr = el("tr");
      const expired = u.expiresAt && new Date(u.expiresAt).getTime() < Date.now();
      const statusNote = u.pending ? ""
        : u.disabled ? ' <span class="cell-muted">(disabled)</span>'
        : expired ? ' <span class="cell-muted">(expired)</span>'
        : (u.expiresAt ? ` <span class="cell-muted">(expires ${esc(fmtDate(u.expiresAt))})</span>` : "");
      const lastCell = u.pending
        ? '<span class="badge badge-progress">Pending</span>'
        : (u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never");
      tr.innerHTML = `<td class="cell-strong cu-name"></td><td class="cell-mono">${esc(u.email)}</td>
        <td>${esc(roleLabel(u.role))}${statusNote}</td><td class="cell-muted">${esc(u.tenantName || "—")}</td>
        <td class="cell-muted">${lastCell}</td><td></td>`;
      const meRole = App.state.me.role;
      // Item 2: an OWNER can edit any name; everyone else only their own row.
      // Pending invitees have no editable account yet, so never show the pencil.
      const canEditName = !u.pending && ((meRole === "OWNER") || (u.id === App.state.me.id));
      renderNameCell(tr.querySelector(".cu-name"), u, canEditName);
      if (u.pending) {
        const rev = el("button", "link-danger", "Revoke");
        rev.onclick = async () => { if (!(await App.ui.confirmModal({ title: "Revoke invite", message: `Revoke the pending invite for ${u.email}?`, confirmText: "Revoke" }))) return; try { await App.api(`/api/admin/invites/${u.inviteId}/revoke`, { method: "POST" }); toast("Invite revoked"); renderUsers(); } catch (e) { toast(e.message, true); } };
        tr.lastChild.appendChild(rev);
      } else {
        const canRemove = u.id !== App.state.me.id            // never yourself
          && u.role !== "OWNER"                                // no one can delete an owner
          && !(u.role === "SUPER_ADMIN" && meRole !== "OWNER"); // super-admins: owner only
        if (canRemove) {
          const del = el("button", "link-danger", "Remove");
          del.onclick = async () => { if (!(await App.ui.confirmModal({ title: "Remove user", message: `Remove ${u.email}?`, confirmText: "Remove" }))) return; try { await App.api(`/api/admin/users/${u.id}`, { method: "DELETE" }); toast("User removed"); renderUsers(); } catch (e) { toast(e.message, true); } };
          tr.lastChild.appendChild(del);
        }
      }
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    card.appendChild(table);
    wrap.appendChild(card);
    view().innerHTML = "";
    view().appendChild(wrap);
  }

  // Item 2 helpers: render a name cell, with an edit pencil when allowed.
  function renderNameCell(cell, u, canEdit) {
    cell.innerHTML = "";
    cell.appendChild(el("span", null, u.name || "—"));
    if (canEdit) {
      const pencil = el("button", null, "\u270E"); // pencil glyph
      pencil.title = "Edit name";
      pencil.setAttribute("aria-label", "Edit name");
      pencil.style.cssText = "margin-left:6px;background:none;border:none;cursor:pointer;color:var(--ink-soft);font-size:13px;padding:0";
      pencil.onclick = () => startNameEdit(cell, u, canEdit);
      cell.appendChild(pencil);
    }
  }

  function startNameEdit(cell, u, canEdit) {
    cell.innerHTML = "";
    const input = el("input", "input");
    input.value = u.name || "";
    input.style.cssText = "display:inline-block;max-width:170px;padding:4px 8px";
    const save = el("button", "btn btn-primary btn-sm", "Save");
    save.style.marginLeft = "6px";
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    cancel.style.marginLeft = "4px";
    cell.appendChild(input); cell.appendChild(save); cell.appendChild(cancel);
    input.focus();
    cancel.onclick = () => renderNameCell(cell, u, canEdit);
    save.onclick = async () => {
      try {
        const updated = await App.api(`/api/admin/users/${u.id}/name`, { method: "PATCH", body: JSON.stringify({ name: input.value.trim() }) });
        u.name = updated.name;
        // If I renamed myself, refresh the cached identity AND the sidebar chip,
        // which reads App.state.me (otherwise it keeps showing the old name).
        if (u.id === App.state.me.id) {
          App.state.me.name = updated.name;
          const display = updated.name || App.state.me.email;
          const nm = document.querySelector(".user-name"); if (nm) nm.textContent = display;
          const av = document.querySelector(".user-avatar"); if (av) av.textContent = display.charAt(0).toUpperCase();
        }
        toast("Name updated");
        renderNameCell(cell, u, canEdit);
      } catch (e) { toast(e.message, true); }
    };
  }

  function openCreateUser(portal) {
    const perPortal = !!portal; // per-portal mode: only portal-admin/client-user, no portal picker
    const inner = el("div");
    // Master form creates only top-tier, portal-less accounts (Super Admin / Auditor);
    // per-portal form creates only portal-admin / client-user for the chosen portal.
    const roleOptions = perPortal
      ? `<option value="CLIENT_USER">Client User</option><option value="PORTAL_ADMIN">Portal Admin</option>`
      : `<option value="SUPER_ADMIN">Super Admin</option><option value="AUDITOR">Auditor (3-day tester)</option>`;
    inner.innerHTML = `<div class="modal-head"><h2>${perPortal ? "Invite user · " + esc(portal.name) : "Invite user"}</h2><button class="icon-btn" id="cu-close">&times;</button></div>
      <div class="modal-body">
        <label class="field-label">Name</label><input id="cu-name" class="input" placeholder="Jane Doe" />
        <label class="field-label">Email *</label><input id="cu-email" class="input" placeholder="jane@acme.com" />
        <label class="field-label">Role *</label>
        <select id="cu-role" class="input">${roleOptions}</select>
        <p class="sub" style="margin:10px 0 0">We'll email them an invite link automatically — or write a custom email and place the link yourself.</p>
        <button id="cu-go" class="btn btn-primary btn-block" style="margin-top:14px">Send invite</button>
        <button id="cu-custom" class="btn btn-ghost btn-block" style="margin-top:8px">Write custom email</button>
      </div>`;
    const overlay = modal(inner);
    const roleSel = inner.querySelector("#cu-role");
    inner.querySelector("#cu-close").onclick = () => overlay.remove();
    inner.querySelector("#cu-go").onclick = async () => {
      const role = roleSel.value;
      const body = {
        name: inner.querySelector("#cu-name").value.trim(),
        email: inner.querySelector("#cu-email").value.trim(),
        role,
      };
      if (!body.email) { toast("Email is required", true); return; }
      try {
        let result;
        if (perPortal) {
          result = await App.api("/api/users?tenantId=" + encodeURIComponent(portal.id), { method: "POST", body: JSON.stringify(body) });
          overlay.remove(); renderTenantDetail(portal);
        } else {
          result = await App.api("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
          overlay.remove(); renderUsers();
        }
        showInviteResult(body.email, result && result.link, result && result.emailed);
      } catch (err) { toast(err.message, true); }
    };
    inner.querySelector("#cu-custom").onclick = () => {
      const role = roleSel.value;
      const name = inner.querySelector("#cu-name").value.trim();
      const email = inner.querySelector("#cu-email").value.trim();
      if (!email) { toast("Email is required", true); return; }
      // Same endpoints + invite token as the default send; only the body differs.
      App.inviteComposer.open({
        email,
        selfScope: true, // master-hub: insert the acting admin's OWN signature, not a stale tenant's
        send: (customHtml, customSubject) => {
          const payload = JSON.stringify({ name, email, role, customHtml, customSubject });
          return perPortal
            ? App.api("/api/users?tenantId=" + encodeURIComponent(portal.id), { method: "POST", body: payload })
            : App.api("/api/admin/users", { method: "POST", body: payload });
        },
        onSent: (result) => {
          overlay.remove();
          if (perPortal) renderTenantDetail(portal); else renderUsers();
          showInviteResult(email, result && result.link, result && result.emailed);
        },
      });
    };
  }

  // Success popup after an invite is created. Always shows the activation link so it
  // can be copied while email delivery is limited (no verified sending domain yet).
  function showInviteResult(email, link, emailed) {
    const inner = el("div");
    const note = emailed
      ? "An invite email was sent to " + esc(email) + " (it may land in spam)."
      : "Email couldn't be delivered right now, so copy this link and send it to " + esc(email) + " yourself.";
    inner.innerHTML = `<div class="modal-head"><h2>Invite sent</h2><button class="icon-btn" id="ir-close">&times;</button></div>
      <div class="modal-body">
        <p class="sub" style="margin:0 0 12px">${note}</p>
        <label class="field-label">Activation link</label>
        <input id="ir-link" class="input" type="text" readonly value="${esc(link || "")}" />
        <button id="ir-copy" class="btn btn-primary btn-block" style="margin-top:12px">Copy link</button>
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#ir-close").onclick = () => overlay.remove();
    const linkInput = inner.querySelector("#ir-link");
    inner.querySelector("#ir-copy").onclick = () => {
      try { linkInput.select(); } catch (e) {}
      const done = () => toast("Link copied");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link || "").then(done).catch(() => { try { document.execCommand("copy"); done(); } catch (e) {} });
      } else { try { document.execCommand("copy"); done(); } catch (e) {} }
    };
  }

  // ---------------- Change Log ----------------
  // Product-level log of every change shipped, read from the DB (never git).
  // Reuses App.table.mount — same sort/filter/pagination as the other hub tables.
  async function renderChangelog() {
    loading();
    let rows;
    try { rows = await App.api("/api/admin/changelog"); }
    catch (e) { view().innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
    if (!Array.isArray(rows)) rows = [];

    view().innerHTML = "";
    const host = el("div", "fade-in");
    view().appendChild(host);

    const columns = [
      { key: "date", label: "Date", type: "date", get: (r) => r.date, text: (r) => fmtDateOnly(r.date), render: (r) => `<span class="cell-muted">${fmtDateOnly(r.date)}</span>` },
      { key: "type", label: "Type", type: "text", get: (r) => r.type, cellClass: "cell-strong", render: (r) => esc(r.type || "—") },
      { key: "description", label: "Description", type: "text", get: (r) => r.description, render: (r) => esc(r.description || "—") },
    ];
    const empty = `<div class="card cell-muted" style="padding:18px">No changes logged yet.</div>`;
    App.table.mount({
      container: host, columns, rows,
      defaultSort: "date", defaultSortDir: "desc",
      emptyHtml: empty, pageSize: 25,
    });
  }

  App.admin = { render };
})(typeof window !== "undefined" ? window : globalThis);
