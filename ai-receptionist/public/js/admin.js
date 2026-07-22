(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, fmtDate, fmtDateOnly, statusBadge, roleLabel, toast } = App.util;

  let current = "portals";
  let portalsCache = [];

  function view() { return App.util.$("#view"); }
  function loading() { App.util.showSkeleton(view(), "table"); } // motion & branding: shared table skeleton (150ms appearance delay)

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
    if (v === "email") { App.state._devtoolsHint = { section: "history", subtab: "email" }; return renderDevTools(); } // devtools-data: the old Email route maps into History -> Email History
    if (v === "usage") return renderUsageBilling();
    if (v === "feedback") return App.feedback.renderMaster(view());
    if (v === "devtools" || v === "changelog") return renderDevTools(); // devtools shell (the router maps the old changelog route here too)
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
        render: (p) => `<span class="adm-t1">${esc(p.name)}</span>` },
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
        render: (p) => `<button class="btn btn-primary btn-sm t-openbtn adm-t2" data-act="open" data-id="${esc(p.id)}" title="Open tenant" aria-label="Open tenant">\u2197</button>` },
    ];

    // Persist the Tenants column layout per-browser, mirroring how portal.js persists
    // record-table layouts (recordLayoutKey/loadRecordLayout/saveRecordLayout): load the
    // saved order + hidden set on mount and write it back on save, so hiding/reordering a
    // column survives navigating away and back — identical behavior to the portal tables.
    const TENANTS_COLS_KEY = "admincols:tenants";
    const loadTenantsLayout = () => { try { return JSON.parse(localStorage.getItem(TENANTS_COLS_KEY) || "{}") || {}; } catch (e) { return {}; } };
    const saveTenantsLayout = (layout) => { try { localStorage.setItem(TENANTS_COLS_KEY, JSON.stringify(layout || {})); } catch (e) {} };
    const tenantsDefaultKeys = columns.map((c) => c.key);
    let tenantsLayout = loadTenantsLayout();
    // Apply the saved layout to the columns we mount with (like portal.js applies it
    // before mount) so there's no flash of the default layout before it settles.
    const initialColumns = App.table.applyColumnLayout(columns, tenantsLayout, tenantsDefaultKeys);

    // ---- Table/Panel view toggle + per-card field visibility (both persisted per-browser,
    // same localStorage pattern as the column layout above) ----
    const VIEW_KEY = "adminview:tenants";       // "table" | "panel" (default "table")
    const loadView = () => { try { const v = localStorage.getItem(VIEW_KEY); return v === "panel" ? "panel" : "table"; } catch (e) { return "table"; } };
    const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch (e) {} };
    const PANEL_FIELDS_KEY = "panelfields:tenants"; // { hidden: [...] } — which card fields are hidden
    const loadPanelFields = () => { try { return JSON.parse(localStorage.getItem(PANEL_FIELDS_KEY) || "{}") || {}; } catch (e) { return {}; } };
    const savePanelFields = (layout) => { try { localStorage.setItem(PANEL_FIELDS_KEY, JSON.stringify(layout || {})); } catch (e) {} };
    // Panel cards expose the SAME fields as the table columns (same keys/labels) so the
    // "Manage panels" picker and the cards stay in lock-step. Order on the card is fixed,
    // so the picker is check-on/off only (no reorder).
    const panelFieldCols = columns.map((c) => ({ key: c.key, label: c.label }));
    const panelDefaultKeys = panelFieldCols.map((c) => c.key);
    let panelLayout = loadPanelFields();

    // The card grid lives alongside the table body (inside .table-area) so the filter rail,
    // toolbar, search, saved filters, etc. are shared and behave identically in both views.
    let panelGrid = null;
    function buildCard(p) {
      const hidden = new Set(panelLayout.hidden || []);
      const shows = (key) => !hidden.has(key);
      const card = el("div", "card tenants-panel-card");
      card.classList.add("adm-card");

      // Header: prominent NAME (no initials badge) + the Open-tenant arrow (same markup).
      const head = el("div");
      head.classList.add("adm-head");
      const title = el("div");
      title.classList.add("adm-title");
      if (shows("name")) title.textContent = p.name;
      head.appendChild(title);
      if (shows("actions")) {
        const openWrap = el("div");
        openWrap.innerHTML = `<button class="btn btn-primary btn-sm t-openbtn adm-t2" data-act="open" data-id="${esc(p.id)}" title="Open tenant" aria-label="Open tenant">\u2197</button>`;
        head.appendChild(openWrap);
      }
      card.appendChild(head);

      if (shows("status")) { const s = el("div"); s.innerHTML = statusBadge(p.status); card.appendChild(s); }

      if (shows("ai")) {
        const aiWrap = el("div");
        aiWrap.classList.add("adm-aiwrap");
        const lbl = el("span", "cell-muted u-meta", "AI Receptionist");
        aiWrap.appendChild(lbl);
        const selWrap = el("div");
        selWrap.innerHTML = `<select class="input portal-recep-sel t-voice" data-id="${esc(p.id)}">${voiceOptionsHtml(voiceModeOf(p))}</select>`;
        aiWrap.appendChild(selWrap);
        card.appendChild(aiWrap);
      }

      const stats = el("div");
      stats.classList.add("adm-stats");
      const stat = (label, val) => { const d = el("div"); d.innerHTML = `<span class="cell-muted">${esc(label)}:</span> ${esc(String(val == null ? "—" : val))}`; return d; };
      if (shows("created")) stats.appendChild(stat("Created", fmtDate(p.createdAt)));
      if (shows("calls")) stats.appendChild(stat("Calls", p.calls));
      if (shows("contacts")) stats.appendChild(stat("Contacts", p.contacts));
      if (shows("users")) stats.appendChild(stat("Users", p.users));
      if (stats.children.length) card.appendChild(stats);

      // Card click opens the detail panel — but, exactly like the table's row click, ignore
      // clicks that land on an inline control (the AI select or the Open arrow).
      card.addEventListener("click", (e) => {
        if (e.target && e.target.closest("button, a, input, select, label")) return;
        renderTenantDetail(p);
      });
      return card;
    }
    // Re-render the whole grid from the CURRENT filtered/sorted rows. Called by the table's
    // onRender hook so cards always mirror Filters/Saved Filters/Search/sort.
    function renderCards(list) {
      if (!panelGrid) return;
      panelGrid.innerHTML = "";
      if (!list || !list.length) {
        const none = el("div", "cell-muted", portals.length ? "No results match your filters." : "No tenants yet.");
        none.classList.add("adm-none");
        panelGrid.appendChild(none);
        return;
      }
      list.forEach((p) => panelGrid.appendChild(buildCard(p)));
    }

    const handle = App.table.mount({
      container: tableHost,
      rows: portals,
      columns: initialColumns,
      rowId: (p) => p.id,
      tableId: "admin-tenants",
      scrollX: true,
      defaultSort: "created",
      defaultSortDir: "desc",
      // Clicking a row (but not an inline control — App.table ignores clicks on
      // button/select/input/label) opens the admin-side detail panel. It never enters
      // the portal.
      onRowClick: (p) => renderTenantDetail(p),
      // Mirror the exact filtered/sorted rows into the card grid on every table render,
      // so the Panel view stays in sync with Filters/Saved Filters/Search/sort. No-op
      // until the grid element exists (created just after mount).
      onRender: (filtered) => renderCards(filtered),
      emptyHtml: `<div class="empty"><div class="empty-emoji">&#127970;</div><h3>No tenants yet</h3><p>Create your first client tenant to get started.</p></div>`,
    });

    // Create the card grid inside the table area (next to the filter rail) and hide it until
    // Panel view is selected. Populated immediately from the current filtered rows.
    const tableArea = tableHost.querySelector(".table-area");
    const tableBody = tableHost.querySelector(".table-wrap");
    panelGrid = el("div", "tenants-panel-grid");
    panelGrid.classList.add("u-hidden");
    if (tableArea) tableArea.appendChild(panelGrid); else wrap.appendChild(panelGrid);
    renderCards(handle.getFiltered());

    // Top button row, left->right: [Filters][Saved filters] … [Table|Panels toggle][Manage][+ Create tenant][Search].
    // Filters stays flush-left (first in toolbar-left); Saved filters sits beside it. In the
    // right group we insert Create BEFORE Search, then the Manage button before Create, then
    // the view toggle before Manage — so the final order is [toggle][Manage][Create][Search].
    mountAdminSavedFilters(handle, "admin-tenants");
    const create = el("button", "btn btn-primary btn-sm", "+ Create tenant");
    create.onclick = () => renderSetupScreen();
    if (handle.toolbarRight) handle.toolbarRight.insertBefore(create, handle.toolbarRight.firstChild);

    // ONE context-aware Manage button. In Table view it manages columns (reorder + show/hide,
    // persisted like before); in Panel view the SAME button relabels to "Manage panels" and
    // opens a check-on/off-only picker for which fields show on each card. Inserted before
    // Create so it lands to the left of it (mirroring the old shared control's position).
    const manageBtn = el("button", "btn btn-ghost btn-sm", "");
    manageBtn.onclick = () => {
      if (currentView === "panel") {
        App.table.openColumnManager(panelFieldCols, panelLayout, panelDefaultKeys, (nl) => {
          panelLayout = { order: nl.order, hidden: nl.hidden };
          savePanelFields(panelLayout);
          renderCards(handle.getFiltered());
        }, { title: "Manage panels", help: "Check to show a field on each card.", saveText: "Save panels", savedToast: "Panels updated", noReorder: true });
      } else {
        App.table.openColumnManager(columns, tenantsLayout, tenantsDefaultKeys, (nl) => {
          tenantsLayout = { order: nl.order, hidden: nl.hidden };
          saveTenantsLayout(tenantsLayout);
          handle.setColumns(App.table.applyColumnLayout(columns, tenantsLayout, tenantsDefaultKeys));
        });
      }
    };
    if (handle.toolbarRight) handle.toolbarRight.insertBefore(manageBtn, handle.toolbarRight.firstChild);

    // Compact Table | Panels segmented toggle, inserted before Manage so it ends up leftmost
    // in the right group. Persists the choice and switches the view live (no reload).
    const toggle = el("div", "view-toggle");
    const tBtn = el("button", "view-toggle-btn", "Table");
    const pBtn = el("button", "view-toggle-btn", "Panels");
    tBtn.type = "button"; pBtn.type = "button";
    toggle.appendChild(tBtn); toggle.appendChild(pBtn);
    tBtn.onclick = () => applyView("table");
    pBtn.onclick = () => applyView("panel");
    if (handle.toolbarRight) handle.toolbarRight.insertBefore(toggle, handle.toolbarRight.firstChild);

    // Caption below the button/search row, above the table. Its left edge must line up
    // with the Filters button and the first table column — both of which sit 18px in
    // (.toolbar-left has padding-left:18px; thead th / tbody td have padding …18px; .card
    // itself has NO padding). So the caption needs margin-left:18px, not 0 (a prior "fix"
    // set it to 0, which is why it read 18px too far left).
    const caption = el("p", "cell-muted");
    caption.classList.add("adm-caption");
    const tbEl = tableHost.querySelector(".table-toolbar");
    if (tbEl) tbEl.insertAdjacentElement("afterend", caption); else tableHost.insertBefore(caption, tableHost.firstChild);

    // Switch between table & panel views live. Toggling swaps which body is visible, relabels
    // the Manage button + caption, updates the toggle's active state, and persists the choice.
    // Filters / Saved Filters / Search / sort are shared by both views (single source of truth).
    let currentView = loadView();
    function applyView(v) {
      currentView = (v === "panel") ? "panel" : "table";
      saveView(currentView);
      const isPanel = currentView === "panel";
      if (tableBody) tableBody.classList.toggle("u-hidden", isPanel);
      if (panelGrid) panelGrid.classList.toggle("u-hidden", !isPanel);
      tBtn.classList.toggle("active", !isPanel);
      pBtn.classList.toggle("active", isPanel);
      manageBtn.innerHTML = isPanel
        ? `<span class="btn-icon">&#9776;</span> Manage panels`
        : `<span class="btn-icon">&#9776;</span> Manage columns`;
      caption.textContent = isPanel
        ? "Click a tenant panel to edit its properties (page access, users, status)."
        : "Click a tenant row to edit its properties (page access, users, status).";
      if (isPanel) renderCards(handle.getFiltered());
    }
    applyView(currentView);

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
    const head = el("div", "page-actions"); head.classList.add("adm-head2");
    const h = el("h2", "settings-h u-flex-1", "Users");
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

  async function enterPortal(p) {
    App.state.currentPortalId = p.id;
    App.state.currentPortalName = p.name;
    // Read the AI Receptionist flag from the just-loaded card data so the left nav
    // is correct on the FIRST paint of this entry (no stale cached value, no flash),
    // and clear the cache key so it's re-confirmed fresh from the server on entry.
    App.state.receptionistEnabled = !!(p && (p.receptionistEnabled === true || (p.voiceMode && p.voiceMode !== "OFF")));
    App.state._recepFor = null;
    // Re-sync the cached identity so the portal view renders the LIVE role (e.g. after
    // a make-owner promotion the sidebar shows "Owner", matching the admin Users list —
    // not a stale "Super Admin"). Non-blocking-safe: awaited, but errors are swallowed
    // inside refreshMe so entry never gets stuck.
    if (App.refreshMe) { await App.refreshMe(); }
    App.go("#/dashboard");
  }

  // ===================== Owner page-lock (master-hub only) =====================
  // The lockable FIXED app pages only. Record-type pages (Contacts/Jobs/Bookings/
  // Equipment/…) are intentionally NOT here — they're governed by Modules (nav
  // visibility) + role permissions. Server enforcement (LOCKABLE_HREFS + lockGate)
  // is unchanged, so any record-type lock set elsewhere still 403s.
  const LOCKABLE_PAGES = [
    { label: "Home Dashboard", hrefs: ["#/dashboard"] },
    { label: "Calls", hrefs: ["#/calls"] },
    { label: "Analytics", hrefs: ["#/reports"] },
    { label: "Automations", hrefs: ["#/automations"] },
    { label: "Communication", hrefs: ["#/communication"] },
    { label: "Learning Center", hrefs: ["#/learn"] },
    { label: "Feedback", hrefs: ["#/feedback"] },
    { label: "Billing", hrefs: ["#/billing"] },
  ];
  // Build a checklist of lockable pages into `host`, reflecting `lockedHrefs`. Polarity is
  // "checked = the page is ON/available"; UNCHECKING a page LOCKS it (adds its hrefs to the
  // locked set). A box is checked when NONE of its hrefs are locked; toggling adds/removes
  // all of them together (so a multi-href page moves as one). Default (no locked hrefs) =
  // everything checked = nothing locked. Returns a getter for the LOCKED hrefs (unchanged
  // contract — callers still PATCH/POST lockedPages) and calls onChange(lockedHrefs) on
  // every toggle. Shared by the config view + the create-tenant wizard.
  function lockChecklist(host, lockedHrefs, onChange) {
    const locked = new Set(lockedHrefs || []);
    LOCKABLE_PAGES.forEach((pg) => {
      const row = el("label"); row.classList.add("adm-row-click");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = pg.hrefs.every((h) => !locked.has(h));
      cb.onchange = () => { pg.hrefs.forEach((h) => { if (cb.checked) locked.delete(h); else locked.add(h); }); if (onChange) onChange(Array.from(locked)); };
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
    const h = el("h2", "settings-h", "Pages");
    sec.appendChild(h);
    const hint = el("p", "cell-muted"); hint.classList.add("adm-hint");
    hint.textContent = "Checked = the page is on and available for this tenant. Uncheck a page to LOCK it — a locked page is hidden from everyone in the tenant, including its Portal Admin, and can't be reached by direct link or API until an admin unlocks it here. (Record-type sections are managed as Modules, chosen when the tenant is created and toggled under Settings → Modules & Fields.)";
    sec.appendChild(hint);
    const card = el("div", "card"); card.classList.add("adm-card2");
    const listHost = el("div");
    const getLocked = lockChecklist(listHost, portal.lockedPages || []);
    card.appendChild(listHost);
    const save = el("button", "btn btn-primary btn-sm u-mt-12", "Save page access");
    save.onclick = async () => {
      save.disabled = true;
      try {
        await App.api("/api/admin/portals/" + encodeURIComponent(portal.id), { method: "PATCH", body: JSON.stringify({ lockedPages: getLocked() }) });
        portal.lockedPages = getLocked();
        toast("Pages updated"); save.disabled = false;
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
      const bar = el("div", "page-actions adm-bar-center");
      const back = el("button", "btn btn-ghost btn-sm", "← Back to tenants");
      back.onclick = () => renderPortals();
      const title = el("div", "page-title", esc(portal.name)); title.classList.add("adm-title2");
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

      const caption = el("p", "cell-muted"); caption.classList.add("adm-caption2");
      caption.textContent = "Configure this tenant’s page access, users, and status. This does not enter the portal.";
      wrap.appendChild(caption);

      wrap.appendChild(pageAccessSection(portal));

      const usersHost = el("div", "u-mt-24");
      usersHost.innerHTML = `<h2 class="settings-h">Users</h2><div class="cell-muted adm-t3">Loading users…</div>`;
      wrap.appendChild(usersHost);

      // Per-tenant Billing & Usage drill-in (KPIs + charts + editable billing status above).
      const usageHost = el("div", "u-mt-24");
      usageHost.innerHTML = `<h2 class="settings-h">Billing &amp; Usage</h2><div class="cell-muted adm-t3">Loading usage…</div>`;
      wrap.appendChild(usageHost);

      // Render the shell (Back + Suspend + Page access) IMMEDIATELY, then fill Users async
      // so a slow or failing users fetch can't block or hang the panel.
      view().innerHTML = ""; view().appendChild(wrap);
      usersSectionInto(usersHost, portal).catch((e) => {
        usersHost.innerHTML = `<h2 class="settings-h">Users</h2><div class="card"><p class="cell-muted">Couldn’t load users: ${esc((e && e.message) || "error")}</p></div>`;
      });
      usageHost.innerHTML = `<h2 class="settings-h">Billing &amp; Usage</h2>`;
      const usageInner = el("div"); usageHost.appendChild(usageInner);
      renderTenantUsageInto(usageInner, portal.id, portal.name).catch((e) => {
        usageHost.innerHTML = `<h2 class="settings-h">Billing &amp; Usage</h2><div class="card"><p class="cell-muted">Couldn’t load usage: ${esc((e && e.message) || "error")}</p></div>`;
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
    const draft = { users: [], themePreset: "", voiceMode: "OFF", lockedPages: [], hiddenRecordTypes: [] };

    // Built-in theme preset ids (match src/theme/themes.ts). "" = leave the default.
    const THEME_PRESETS = [
      ["", "Default (Classic Clarity)"], ["warm", "Warm Light"], ["slate", "Slate"],
      ["steel", "Steel Blue"], ["contrast", "High Contrast"], ["dark", "Dark"], ["midnight", "Midnight"],
    ];

    function elNote(text) { const d = el("div", "cell-muted"); d.classList.add("adm-d"); d.textContent = text; return d; }
    function leave(toList) {
      App.state.currentPortalId = prior.id;
      App.state.currentPortalName = prior.name;
      if (toList) render("portals");
    }
    function sectionCard(n, title, desc) {
      const card = el("div", "card");
      card.classList.add("adm-card3");
      const head = el("div"); head.classList.add("adm-head3");
      const num = el("div", null, String(n));
      num.classList.add("adm-step-num");
      const tt = el("div"); tt.innerHTML = `<div class="adm-t1">${esc(title)}</div><div class="cell-muted adm-t4">${esc(desc)}</div>`;
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
      <p class="cell-muted adm-t5">Notify email is optional — it's where call summaries and notifications go.</p>
      <label class="field-label adm-t6">Billing status *</label>
      <select id="sp-billing" class="input">
        <option value="">Select a billing status…</option>
        <option value="free">Free</option>
        <option value="trial">Trial</option>
        <option value="paid">Paid</option>
        <option value="exception">Exception</option>
      </select>
      <p class="cell-muted adm-t5">Required — pick how this tenant is billed. You can change it later from the tenant's detail panel.</p>`;
    s1.appendChild(f1);
    wrap.appendChild(s1);

    // ---- Step 2: add users (queued into the draft; invited on Finish) ----
    const s2 = sectionCard(2, "Add users", "Queue teammates to invite. Each gets an invite link when you finish. You can add none, one, or several.");
    const uForm = el("div"); uForm.classList.add("adm-uform");
    uForm.innerHTML = `
      <div class="adm-t7"><label class="field-label">Email</label><input id="sp-user-email" class="input adm-t8" type="email" placeholder="teammate@company.com" /></div>
      <div class="adm-t9"><label class="field-label">Role</label><select id="sp-user-role" class="input adm-t8"><option value="CLIENT_USER">Client user</option><option value="PORTAL_ADMIN">Portal admin</option></select></div>`;
    const addUserBtn = el("button", "btn btn-ghost btn-sm", "+ Add to list");
    uForm.appendChild(addUserBtn);
    s2.appendChild(uForm);
    const uList = el("div", "u-mt-10");
    s2.appendChild(uList);
    function paintUsers() {
      uList.innerHTML = "";
      if (!draft.users.length) { uList.appendChild(elNote("No users queued yet — that's fine, you can invite people later too.")); return; }
      draft.users.forEach((u, i) => {
        const row = el("div"); row.classList.add("adm-row-line");
        row.innerHTML = `<span class="u-flex-1">${esc(u.email)}</span><span class="pill adm-t10">${u.role === "PORTAL_ADMIN" ? "Portal admin" : "Client user"}</span>`;
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
    const vCap = el("p", "cell-muted"); vCap.classList.add("adm-vcap");
    vCap.textContent = "Off declines inbound calls. Standard voice is the basic back-and-forth receptionist. Premium voice uses the smooth ElevenLabs voice.";
    s4.appendChild(vWrap); s4.appendChild(vCap);
    // Pages (owner hard-lock) — fixed app pages only; sets the INITIAL locked set.
    const lockHost = el("div", "u-mt-16");
    const lockLab = el("label", "field-label", "Pages"); lockLab.classList.add("adm-locklab");
    const lockNote = el("p", "cell-muted"); lockNote.classList.add("adm-locknote");
    lockNote.textContent = "Checked = the page is on and available (all pages start on). Uncheck a page to LOCK it — a locked page is blocked for everyone in the tenant, including its Portal Admin, and can't be reached by menu, direct link, or API unless an admin unlocks it later. (Record-type sections are managed under Modules below.)";
    lockHost.appendChild(lockLab); lockHost.appendChild(lockNote);
    lockChecklist(lockHost, draft.lockedPages, (arr) => { draft.lockedPages = arr; });
    s4.appendChild(lockHost);

    // ---- Modules (record-type VISIBILITY at creation) ------------------------
    // A checklist of the record-type modules this new tenant starts with, each
    // listed individually and pulled from the registry (so a future type appears
    // here automatically). Contacts is core (always on). Unchecking a module HIDES
    // its nav item — the type is still created, so it can be turned back on later
    // under Settings → Modules & Fields with no data risk. Default: everything checked.
    // This is VISIBILITY only (reversible hide), distinct from the hard-lock above.
    const secHost = el("div", "u-mt-16");
    const secLab = el("label", "field-label", "Modules"); secLab.classList.add("adm-locklab");
    const secNote = el("p", "cell-muted"); secNote.classList.add("adm-locknote");
    secNote.textContent = "Checked = the module is on and visible in this portal (all modules start on). Uncheck one to hide it — it's still created, so you can turn it back on anytime under Settings → Modules & Fields with no data risk.";
    secHost.appendChild(secLab); secHost.appendChild(secNote);
    const secList = el("div"); secList.appendChild(el("p", "cell-muted", "Loading…"));
    secHost.appendChild(secList);
    s4.appendChild(secHost);
    App.api("/api/admin/portals/record-type-options").then((r) => {
      const options = (r && r.options) || [];
      secList.innerHTML = "";
      options.forEach((opt) => {
        const row = el("label"); row.classList.add("adm-row-click");
        const cb = el("input"); cb.type = "checkbox"; cb.checked = true;
        const name = opt.labelPlural || opt.label || opt.key;
        if (!opt.togglable) {
          // Contact (core): always on, not editable.
          cb.disabled = true; row.classList.add("u-cursor-default");
          row.appendChild(cb); row.appendChild(document.createTextNode(" " + name + " (always on)"));
        } else {
          // Every togglable module starts ON (checked) so a new portal has everything
          // available by default, matching the pages list. Unchecking hides it (adds its
          // key to hiddenRecordTypes); the type is still seeded, so it's reversible under
          // Settings → Modules & Fields. (opt.defaultHidden still marks the pre-built
          // industry modules in the registry, but no longer forces them off here.)
          cb.checked = true;
          cb.onchange = () => {
            const set = new Set(draft.hiddenRecordTypes);
            if (cb.checked) set.delete(opt.key); else set.add(opt.key);
            draft.hiddenRecordTypes = Array.from(set);
          };
          row.appendChild(cb); row.appendChild(document.createTextNode(" " + name));
        }
        secList.appendChild(row);
      });
    }).catch(() => { secList.innerHTML = ""; secList.appendChild(el("p", "cell-muted", "Couldn't load modules — the tenant will start with all modules visible.")); });
    wrap.appendChild(s4);

    // ---- Footer: Finish creates the tenant, then applies the draft, then enters it ----
    const footer = el("div", "page-actions");
    footer.classList.add("adm-footer");
    const finish = el("button", "btn btn-primary btn-sm", "Finish — go to tenant");
    finish.onclick = async () => {
      const nameEl = document.querySelector("#sp-name");
      const emailEl = document.querySelector("#sp-email");
      const billingEl = document.querySelector("#sp-billing");
      const name = nameEl ? nameEl.value.trim() : "";
      const notifyEmail = emailEl ? emailEl.value.trim() : "";
      const billingStatus = billingEl ? billingEl.value : "";
      if (!name) { toast("Business name is required", true); if (nameEl) nameEl.focus(); return; }
      if (!billingStatus) { toast("Pick a billing status to create the tenant", true); if (billingEl) billingEl.focus(); return; }
      finish.disabled = true;

      // 1) Create the tenant. If THIS fails, nothing was persisted — stay on the screen.
      let portal;
      try {
        portal = await App.api("/api/admin/portals", { method: "POST", body: JSON.stringify({ name, notifyEmail, lockedPages: draft.lockedPages, billingStatus, hiddenRecordTypes: draft.hiddenRecordTypes }) });
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
      let emailFailed = 0; // invite record created, but the email couldn't be sent
      for (const u of draft.users) {
        try {
          const r = await App.api(`/api/admin/portals/${portal.id}/invites`, { method: "POST", body: JSON.stringify({ email: u.email, role: u.role }) });
          invited++;
          if (r && r.emailed === false) emailFailed++;
        } catch (e) { problems.push("invite " + u.email); }
      }

      // 3) Report + enter the tenant (never leave an orphan silently).
      const okMsg = `Tenant created${draft.users.length ? `, ${invited}/${draft.users.length} invite(s) sent` : ""}`;
      if (problems.length) toast(`${okMsg}. Couldn't apply: ${problems.join(", ")} — you can finish those inside the tenant.`, true);
      else if (emailFailed) toast(`${okMsg}, but ${emailFailed} invite email${emailFailed === 1 ? "" : "s"} couldn't be sent — open the tenant's Users to copy the link${emailFailed === 1 ? "" : "s"}.`, true);
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
      pencil.classList.add("adm-pencil");
      pencil.onclick = () => startNameEdit(cell, u, canEdit);
      cell.appendChild(pencil);
    }
  }

  function startNameEdit(cell, u, canEdit) {
    cell.innerHTML = "";
    const input = el("input", "input");
    input.value = u.name || "";
    input.classList.add("adm-input");
    const save = el("button", "btn btn-primary btn-sm", "Save");
    save.classList.add("u-ml-6");
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    cancel.classList.add("u-ml-4");
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
        <p class="sub adm-t11">We'll email them an invite link automatically — or write a custom email and place the link yourself.</p>
        <button id="cu-go" class="btn btn-primary btn-block adm-t12">Send invite</button>
        <button id="cu-custom" class="btn btn-ghost btn-block u-mt-8">Write custom email</button>
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
        <p class="sub adm-t13">${note}</p>
        <label class="field-label">Activation link</label>
        <input id="ir-link" class="input" type="text" readonly value="${esc(link || "")}" />
        <button id="ir-copy" class="btn btn-primary btn-block adm-t6">Copy link</button>
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

  // ---------------- Developer Tools (the shell) ----------------
  // A settings-style section grid (the portal Settings tiles pattern) over a sub-tab
  // row (the AI-Receptionist settings-tabs pattern) — both DATA-DRIVEN so future
  // sections (and the coming Audit Log sub-tab) are one-line additions.
  const DEVTOOL_SECTIONS = [
    { key: "history", label: "History", render: renderHistorySection },
    { key: "health", label: "System Health", render: renderHealthSection }, // audit-fixes-health batch
    // future sections register here
  ];
  const HISTORY_SUBTABS = [
    { key: "changelog", label: "Change Log", mount: (host) => renderChangelog(host) },
    { key: "auditlog", label: "Audit Log", mount: (host) => renderAuditLog(host) }, // devtools batch 3
    { key: "email", label: "Email History", mount: (host) => renderEmail(host) }, // devtools-data: the hub Email tab, relocated verbatim
  ];

  function renderDevTools() {
    view().innerHTML = "";
    const wrap = el("div", "fade-in settings-tiles-shell");
    const tiles = el("div", "settings-tiles");
    const panel = el("div");
    // health v2: a ONE-SHOT deep-link hint ({ section, subtab, auditFilter }) lets
    // health panels jump straight into the Audit Log pre-filtered. Consumed on read.
    const hint = App.state._devtoolsHint || null;
    let active = (hint && hint.section) || (DEVTOOL_SECTIONS[0] && DEVTOOL_SECTIONS[0].key);
    function paintTiles() {
      tiles.innerHTML = "";
      DEVTOOL_SECTIONS.forEach((s) => {
        const tile = el("a", "settings-tile" + (s.key === active ? " active" : ""), esc(s.label));
        tile.onclick = (e) => { e.preventDefault(); if (active !== s.key) { active = s.key; paintTiles(); paintPanel(); } };
        tiles.appendChild(tile);
      });
    }
    function paintPanel() {
      panel.innerHTML = "";
      const s = DEVTOOL_SECTIONS.find((x) => x.key === active);
      if (s) s.render(panel);
    }
    wrap.appendChild(tiles);
    wrap.appendChild(panel);
    view().appendChild(wrap);
    paintTiles();
    paintPanel();
  }

  function renderHistorySection(panel) {
    const bar = el("div", "settings-tabs");
    const body = el("div");
    const hint = App.state._devtoolsHint || null;
    let active = (hint && hint.subtab) || (HISTORY_SUBTABS[0] && HISTORY_SUBTABS[0].key);
    function paintBar() {
      bar.innerHTML = "";
      HISTORY_SUBTABS.forEach((t) => {
        const b = el("button", null, t.label);
        b.className = "settings-tab" + (active === t.key ? " active" : "");
        b.onclick = () => { if (active !== t.key) { active = t.key; paintBar(); paintBody(); } };
        bar.appendChild(b);
      });
    }
    function paintBody() {
      body.innerHTML = "";
      const t = HISTORY_SUBTABS.find((x) => x.key === active);
      if (t) t.mount(body);
    }
    panel.appendChild(bar);
    panel.appendChild(body);
    paintBar();
    paintBody();
  }

  // ---------------- System Health (audit-fixes-health batch) ----------------
  // Cached service checks as status cards (the settings-tile pattern), grouped
  // External / Internal / Background / Last 24h, with a top banner and Re-check now.
  const HEALTH_SUBTABS = [
    { key: "overview", label: "Overview", mount: (host) => renderHealthOverview(host) },
    { key: "errors", label: "Errors", mount: (host) => renderErrorsTable(host, {}) }, // devtools-data
    { key: "webhooks", label: "Webhooks", mount: (host) => renderWebhooksTable(host, {}) }, // devtools-data
    // future health sub-tabs register here
  ];
  function renderHealthSection(panel) {
    const bar = el("div", "settings-tabs");
    const body = el("div");
    let active = HEALTH_SUBTABS[0] && HEALTH_SUBTABS[0].key;
    function paintBar() {
      bar.innerHTML = "";
      HEALTH_SUBTABS.forEach((t) => {
        const b = el("button", null, t.label);
        b.className = "settings-tab" + (active === t.key ? " active" : "");
        b.onclick = () => { if (active !== t.key) { active = t.key; paintBar(); paintBody(); } };
        bar.appendChild(b);
      });
    }
    function paintBody() { body.innerHTML = ""; const t = HEALTH_SUBTABS.find((x) => x.key === active); if (t) t.mount(body); }
    panel.appendChild(bar);
    panel.appendChild(body);
    paintBar();
    paintBody();
  }

  const HEALTH_GROUP_LABELS = { external: "External services", internal: "Internal", background: "Background work", pulse: "Last 24 hours" };
  const HEALTH_CHECK_LABELS = { twilio: "Twilio", openai: "OpenAI", elevenlabs: "ElevenLabs", mapbox: "Mapbox", google: "Google Calendar", stripe: "Stripe", database: "Database", process: "Process", scheduler: "Scheduler", geoQueue: "Geocode queue", auditSweep: "Audit retention", automations: "Automations", dripQueue: "Drip queue", requests: "Requests", webhooks: "Webhook deliveries", errors: "Errors", failedLogins: "Failed logins" };

  // Health v2 — the two FACES. External services wear their integration LOGO (the
  // same asset set Settings -> Integrations uses); everything else wears a small
  // inline-SVG mini-widget drawn in the current accent (stroke/fill = currentColor).
  const HEALTH_LOGOS = { twilio: "/img/twilio.png", openai: "/img/openai.webp", elevenlabs: "/img/elevenlabs.png", mapbox: "/img/mapbox.png", google: "/img/google-calendar.webp", stripe: "/img/stripe.png" };
  const HW = (inner) => `<svg class="health-widget" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const HEALTH_WIDGETS = {
    database: HW('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'),
    process: HW('<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
    scheduler: HW('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
    geoQueue: HW('<path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/>'),
    auditSweep: HW('<path d="M12 3l8 3v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6z"/><path d="M9 12l2 2 4-4.5"/>'),
    automations: HW('<path d="M13 2L4.5 13.5H11l-1 8.5L18.5 10H12z"/>'),
    dripQueue: HW('<path d="M12 3s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11z"/>'),
    requests: HW('<path d="M2 12h4l3-7 4 14 3-7h6"/>'),
    webhooks: HW('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M3 7l9 6 9-6"/>'),
    errors: HW('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><path d="M12 17.6v.2"/>'),
    failedLogins: HW('<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/><path d="M12 14.5v2.5"/>'),
  };

  // Health v2 — plain-language captions: one honest line per tile (required wording
  // for Google Calendar / Stripe / ElevenLabs per spec).
  const HEALTH_CAPTIONS = {
    twilio: "Provides the phone numbers and call routing for the AI receptionist.",
    openai: "The language model that powers the AI receptionist's conversations.",
    elevenlabs: "Premium call voices \u2014 synthesized by Twilio ConversationRelay using ElevenLabs; no direct API connection from Clarity.",
    mapbox: "Turns addresses into map locations for contact and record maps.",
    google: "Syncs busy times and bookings with connected Google Calendars.",
    stripe: "Powers tenant billing \u2014 charges, invoices, and payment records in Billing & Usage.",
    database: "The Postgres database storing all portal data.",
    process: "The Clarity app process itself \u2014 uptime and memory.",
    scheduler: "The heartbeat that runs automations and scheduled work every couple of minutes.",
    geoQueue: "The background queue that turns contact and record addresses into map locations.",
    auditSweep: "The hourly cleanup that enforces the audit trail's retention policy.",
    automations: "Automation runs over the last day \u2014 failures here mean an automation needs attention.",
    dripQueue: "Delayed and scheduled automation steps waiting for their moment to run.",
    requests: "Web traffic counters for the last day.",
    webhooks: "Inbound webhook deliveries \u2014 calls, texts, billing events, and email reports arriving from connected services.",
    errors: "Errors captured from tenant browsers and the server over the last day \u2014 including crashes that would otherwise be invisible.",
    failedLogins: "Sign-in attempts that failed in the last day, straight from the audit trail.",
  };

  // devtools-data — the Errors table: ONE component serving both the System Health
  // "Errors" sub-tab (full) and the Errors tile's expanded panel (pre-filtered 24h).
  // Shared machinery throughout: App.table.mount, the audit-pattern filter bar with
  // the four date presets, the shared export modal, the shared detail modal.
  async function renderErrorsTable(hostEl, opts) {
    opts = opts || {};
    const mount = hostEl || view();
    App.util.showSkeleton(mount, "table");
    let portals;
    try { portals = await App.api("/api/admin/portals"); }
    catch (e) { mount.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
    const f = Object.assign({ source: "", tenantId: "", from: "", to: "" }, opts.filter || {});

    const wrap = el("div", "fade-in");
    const bar = el("div", "adm-auditbar table-lead");
    const mkSel = (pairs, onchange) => { const s = el("select", "input adm-cadsel"); pairs.forEach((p) => { const o = el("option", null, esc(p[1])); o.value = p[0]; s.appendChild(o); }); s.onchange = () => onchange(s.value); return s; };
    const srcSel = mkSel([["", "All sources"], ["client", "Client (browser)"], ["server", "Server"]], (v) => { f.source = v; reload(); });
    if (f.source) srcSel.value = f.source;
    bar.appendChild(srcSel);
    const tenantSel = mkSel([["", "All tenants"]].concat((portals || []).map((p) => [p.id, p.name])), (v) => { f.tenantId = v; reload(); });
    if (f.tenantId) tenantSel.value = f.tenantId;
    bar.appendChild(tenantSel);
    const dayIso = (d) => d.toISOString().slice(0, 10);
    const rangeSel = mkSel([["all", "All time"], ["today", "Today"], ["7", "Last 7 days"], ["14", "Last 14 days"]], (v) => {
      const now = new Date();
      if (v === "all") { f.from = ""; f.to = ""; }
      else if (v === "today") { f.from = dayIso(now); f.to = dayIso(now); }
      else { const d = new Date(now.getTime() - (Number(v) - 1) * 86400000); f.from = dayIso(d); f.to = dayIso(now); }
      reload();
    });
    if (f.from && f.to && f.from === f.to) rangeSel.value = "today";
    bar.appendChild(rangeSel);
    wrap.appendChild(bar);
    const tableHost = el("div");
    wrap.appendChild(tableHost);

    const srcPill = (s) => s === "server" ? `<span class="pill skipped">server</span>` : `<span class="pill">client</span>`;
    const columns = [
      { key: "createdAt", label: "Time", type: "date", get: (r) => r.createdAt, render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` },
      { key: "source", label: "Source", type: "text", get: (r) => r.source, render: (r) => srcPill(r.source) },
      { key: "tenant", label: "Tenant", type: "text", get: (r) => r.tenant || "", render: (r) => esc(r.tenant || "\u2014") },
      { key: "userLabel", label: "User", type: "text", get: (r) => r.userLabel || "", render: (r) => esc(r.userLabel || "\u2014") },
      { key: "message", label: "Message", type: "text", get: (r) => r.message, cellClass: "cell-strong", render: (r) => esc(String(r.message).slice(0, 140)) },
      { key: "route", label: "Route", type: "text", get: (r) => r.route || "", render: (r) => `<span class="cell-muted">${esc(r.route || "\u2014")}</span>` },
      { key: "userAgent", label: "User agent", type: "text", get: (r) => r.userAgent || "", render: (r) => `<span class="cell-muted">${esc((r.userAgent || "\u2014").slice(0, 60))}</span>` },
      { key: "stack", label: "Stack", type: "text", get: (r) => (r.stack ? "present" : ""), render: (r) => `<span class="cell-muted">${r.stack ? "present \u2014 click the row" : "\u2014"}</span>` },
      { key: "id", label: "ID", type: "text", get: (r) => r.id, render: (r) => `<span class="cell-muted">${esc(r.id)}</span>` },
    ];
    const defaultKeys = ["createdAt", "source", "tenant", "userLabel", "message", "route"];
    function openErrorDetail(r) {
      const inner = el("div");
      inner.innerHTML = `<div class="modal-head"><h2>Error detail</h2><button class="icon-btn" id="err-close">&times;</button></div>`;
      const body = el("div", "modal-body");
      const mg = el("div", "adm-audit-metagrid");
      mg.innerHTML = [
        ["Time", fmtDate(r.createdAt)],
        ["Source", srcPill(r.source)],
        ["Tenant", esc(r.tenant || "\u2014")],
        ["User", esc(r.userLabel || "\u2014")],
        ["Route", esc(r.route || "\u2014")],
        ["User agent", esc(r.userAgent || "\u2014")],
      ].map((kv) => `<div class="adm-audit-metak cell-muted">${esc(kv[0])}</div><div class="adm-audit-metav">${kv[1]}</div>`).join("");
      body.appendChild(mg);
      body.appendChild(el("h3", "settings-sub", "Message"));
      body.appendChild(el("p", "adm-audit-metav", esc(r.message)));
      if (r.stack) {
        body.appendChild(el("h3", "settings-sub", "Stack"));
        const pre = el("pre", "err-stack", esc(r.stack));
        body.appendChild(pre);
      }
      inner.appendChild(body);
      const overlay = modal(inner);
      inner.querySelector("#err-close").onclick = () => overlay.remove();
    }
    let handle = null;
    async function reload() {
      App.util.showSkeleton(tableHost, "table");
      const p = new URLSearchParams();
      p.set("limit", "500");
      if (f.source) p.set("source", f.source);
      if (f.tenantId) p.set("tenantId", f.tenantId);
      if (f.from) p.set("from", f.from);
      if (f.to) p.set("to", f.to);
      let rows;
      try { rows = (await App.api(`/api/admin/errors?${p.toString()}`)).rows || []; }
      catch (e) { tableHost.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
      tableHost.innerHTML = "";
      handle = App.table.mount({
        container: tableHost, columns: App.table.applyColumnLayout(columns, {}, defaultKeys), rows,
        tableId: "admin-errors" + (opts.embedId ? "-" + opts.embedId : ""),
        pageSize: 25,
        emptyHtml: `<div class="card cell-muted adm-t14">No errors captured. Quiet is good.</div>`,
        onRowClick: (r) => openErrorDetail(r),
      });
      App.table.manageColumns(handle, columns, { defaultKeys });
      const exportBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8679;</span> Export`);
      exportBtn.onclick = () => App.exportModal({
        title: "Export errors",
        columns: columns.map((c) => ({ key: c.key, label: c.label, type: c.type, get: c.get })),
        rows: handle.getFiltered(),
        dataType: "errors",
        namePlaceholder: "e.g. this week's errors",
        filterLabel: "Which errors to export",
        unitPlural: "Errors",
        sheetName: "Errors",
        countText: (n) => n + " error" + (n === 1 ? "" : "s"),
        saveHistory: true,
        historyApi: App.api,
        historyBase: "/api/admin/exports",
      });
      if (handle.toolbarRight) handle.toolbarRight.insertBefore(exportBtn, handle.toolbarRight.firstChild);
    }
    mount.innerHTML = "";
    mount.appendChild(wrap);
    await reload();
  }

  // devtools-data — the Webhooks table: ONE component serving the "Webhooks"
  // sub-tab (full) and the Webhook-deliveries tile's panel (pre-filtered 24h).
  async function renderWebhooksTable(hostEl, opts) {
    opts = opts || {};
    const mount = hostEl || view();
    App.util.showSkeleton(mount, "table");
    let portals;
    try { portals = await App.api("/api/admin/portals"); }
    catch (e) { mount.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
    const f = Object.assign({ provider: "", outcome: "", tenantId: "", from: "", to: "" }, opts.filter || {});

    const wrap = el("div", "fade-in");
    const bar = el("div", "adm-auditbar table-lead");
    const mkSel = (pairs, onchange) => { const s = el("select", "input adm-cadsel"); pairs.forEach((p) => { const o = el("option", null, esc(p[1])); o.value = p[0]; s.appendChild(o); }); s.onchange = () => onchange(s.value); return s; };
    const provSel = mkSel([["", "All providers"], ["twilio", "Twilio"], ["google", "Google"], ["stripe", "Stripe"], ["other", "Other"]], (v) => { f.provider = v; reload(); });
    if (f.provider) provSel.value = f.provider;
    bar.appendChild(provSel);
    const outSel = mkSel([["", "All outcomes"], ["ok", "OK"], ["fail", "Failed"]], (v) => { f.outcome = v; reload(); });
    if (f.outcome) outSel.value = f.outcome;
    bar.appendChild(outSel);
    const tenantSel = mkSel([["", "All tenants"]].concat((portals || []).map((p) => [p.id, p.name])), (v) => { f.tenantId = v; reload(); });
    if (f.tenantId) tenantSel.value = f.tenantId;
    bar.appendChild(tenantSel);
    const dayIso = (d) => d.toISOString().slice(0, 10);
    bar.appendChild(mkSel([["all", "All time"], ["today", "Today"], ["7", "Last 7 days"], ["14", "Last 14 days"]], (v) => {
      const now = new Date();
      if (v === "all") { f.from = ""; f.to = ""; }
      else if (v === "today") { f.from = dayIso(now); f.to = dayIso(now); }
      else { const d = new Date(now.getTime() - (Number(v) - 1) * 86400000); f.from = dayIso(d); f.to = dayIso(now); }
      reload();
    }));
    wrap.appendChild(bar);
    const tableHost = el("div");
    wrap.appendChild(tableHost);

    const outPill = (o) => o === "fail" ? `<span class="pill skipped">fail</span>` : `<span class="pill success">ok</span>`;
    const columns = [
      { key: "createdAt", label: "Time", type: "date", get: (r) => r.createdAt, render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` },
      { key: "provider", label: "Provider", type: "text", get: (r) => r.provider, render: (r) => `<span class="pill">${esc(r.provider)}</span>` },
      { key: "summary", label: "What it was", type: "text", get: (r) => r.summary, cellClass: "cell-strong", render: (r) => esc(r.summary) },
      { key: "endpoint", label: "Endpoint", type: "text", get: (r) => r.endpoint, render: (r) => `<span class="cell-muted">${esc(r.endpoint)}</span>` },
      { key: "tenant", label: "Tenant", type: "text", get: (r) => r.tenant || "", render: (r) => esc(r.tenant || "\u2014") },
      { key: "outcome", label: "Outcome", type: "text", get: (r) => r.outcome, render: (r) => outPill(r.outcome) },
      { key: "httpStatus", label: "Status", type: "number", get: (r) => r.httpStatus, render: (r) => `<span class="cell-muted">${r.httpStatus}</span>` },
      { key: "latencyMs", label: "Latency", type: "number", get: (r) => r.latencyMs, render: (r) => `<span class="cell-muted">${r.latencyMs} ms</span>` },
      { key: "payloadExcerpt", label: "Excerpt", type: "text", get: (r) => (r.payloadExcerpt ? "present" : ""), render: (r) => `<span class="cell-muted">${r.payloadExcerpt ? "present \u2014 click the row" : "\u2014"}</span>` },
      { key: "error", label: "Error", type: "text", get: (r) => r.error || "", render: (r) => `<span class="cell-muted">${esc((r.error || "\u2014").slice(0, 60))}</span>` },
      { key: "id", label: "ID", type: "text", get: (r) => r.id, render: (r) => `<span class="cell-muted">${esc(r.id)}</span>` },
    ];
    const defaultKeys = ["createdAt", "provider", "summary", "tenant", "outcome", "httpStatus", "latencyMs"];
    function openWebhookDetail(r) {
      const inner = el("div");
      inner.innerHTML = `<div class="modal-head"><h2>Webhook delivery</h2><button class="icon-btn" id="wh-close">&times;</button></div>`;
      const body = el("div", "modal-body");
      const mg = el("div", "adm-audit-metagrid");
      mg.innerHTML = [
        ["Time", fmtDate(r.createdAt)],
        ["Provider", `<span class="pill">${esc(r.provider)}</span>`],
        ["What it was", esc(r.summary)],
        ["Endpoint", esc(r.endpoint)],
        ["Tenant", esc(r.tenant || "\u2014")],
        ["Outcome", outPill(r.outcome) + ` <span class="cell-muted">HTTP ${r.httpStatus} \u00b7 ${r.latencyMs} ms</span>`],
      ].map((kv) => `<div class="adm-audit-metak cell-muted">${esc(kv[0])}</div><div class="adm-audit-metav">${kv[1]}</div>`).join("");
      body.appendChild(mg);
      if (r.error) {
        body.appendChild(el("h3", "settings-sub", "Error"));
        body.appendChild(el("p", "adm-audit-metav", esc(r.error)));
      }
      body.appendChild(el("h3", "settings-sub", "Payload excerpt (redacted)"));
      body.appendChild(el("pre", "err-stack", esc(r.payloadExcerpt || "\u2014 nothing excerpted")));
      inner.appendChild(body);
      const overlay = modal(inner);
      inner.querySelector("#wh-close").onclick = () => overlay.remove();
    }
    let handle = null;
    async function reload() {
      App.util.showSkeleton(tableHost, "table");
      const p = new URLSearchParams();
      p.set("limit", "500");
      if (f.provider) p.set("provider", f.provider);
      if (f.outcome) p.set("outcome", f.outcome);
      if (f.tenantId) p.set("tenantId", f.tenantId);
      if (f.from) p.set("from", f.from);
      if (f.to) p.set("to", f.to);
      let rows;
      try { rows = (await App.api(`/api/admin/webhook-events?${p.toString()}`)).rows || []; }
      catch (e) { tableHost.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
      tableHost.innerHTML = "";
      handle = App.table.mount({
        container: tableHost, columns: App.table.applyColumnLayout(columns, {}, defaultKeys), rows,
        tableId: "admin-webhooks" + (opts.embedId ? "-" + opts.embedId : ""),
        pageSize: 25,
        emptyHtml: `<div class="card cell-muted adm-t14">No webhook deliveries recorded yet.</div>`,
        onRowClick: (r) => openWebhookDetail(r),
      });
      App.table.manageColumns(handle, columns, { defaultKeys });
      const exportBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8679;</span> Export`);
      exportBtn.onclick = () => App.exportModal({
        title: "Export webhook deliveries",
        columns: columns.map((c) => ({ key: c.key, label: c.label, type: c.type, get: c.get })),
        rows: handle.getFiltered(),
        dataType: "webhooks",
        namePlaceholder: "e.g. this week's webhooks",
        filterLabel: "Which deliveries to export",
        unitPlural: "Deliveries",
        sheetName: "Webhook deliveries",
        countText: (n) => n + " deliver" + (n === 1 ? "y" : "ies"),
        saveHistory: true,
        historyApi: App.api,
        historyBase: "/api/admin/exports",
      });
      if (handle.toolbarRight) handle.toolbarRight.insertBefore(exportBtn, handle.toolbarRight.firstChild);
    }
    mount.innerHTML = "";
    mount.appendChild(wrap);
    await reload();
  }

  // devtools-data — WHICH tiles are data-backed, and what their panel table IS.
  // ONE wrapper (mountHealthDataPanel) turns these configs into real tables on the
  // shared machinery; audit-shaped ones EMBED the DT-3 audit component itself.
  const dayIsoAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const HEALTH_DATA_PANELS = {
    failedLogins: { audit: () => ({ action: "auth.login_failed", status: "all", from: dayIsoAgo(1), to: dayIsoAgo(0) }), defaultKeys: ["createdAt", "tenant", "actor", "userType", "action", "ip"] },
    automations: { audit: () => ({ group: "automations", status: "all", from: dayIsoAgo(1), to: dayIsoAgo(0) }), defaultKeys: ["createdAt", "tenant", "actor", "userType", "action", "subject", "details"] },
    auditSweep: { audit: () => ({ status: "pending_deletion" }) },
    geoQueue: {
      fetch: "/api/admin/health/rows/geoQueue",
      columns: () => [
        { key: "updatedAt", label: "Updated", type: "date", get: (r) => r.updatedAt, render: (r) => `<span class="cell-muted">${fmtDate(r.updatedAt)}</span>` },
        { key: "tenant", label: "Tenant", type: "text", get: (r) => r.tenant, render: (r) => esc(r.tenant || "\u2014") },
        { key: "kind", label: "Kind", type: "text", get: (r) => r.kind, render: (r) => esc(r.kind) },
        { key: "label", label: "Contact / record", type: "text", get: (r) => r.label, cellClass: "cell-strong", render: (r) => esc(r.label || "\u2014") },
        { key: "fieldKey", label: "Address field", type: "text", get: (r) => r.fieldKey, render: (r) => esc(r.fieldKey || "\u2014") },
        { key: "status", label: "Status", type: "text", get: (r) => r.status, render: (r) => r.status === "failed" ? `<span class="pill skipped">failed</span>` : `<span class="pill">pending</span>` },
        { key: "error", label: "Error", type: "text", get: (r) => r.error, render: (r) => `<span class="cell-muted">${esc(r.error || "\u2014")}</span>` },
      ],
    },
    dripQueue: {
      fetch: "/api/admin/health/rows/dripQueue",
      columns: () => [
        { key: "dueAt", label: "Due", type: "date", get: (r) => r.dueAt, render: (r) => `<span class="cell-muted">${fmtDate(r.dueAt)}</span>` },
        { key: "tenant", label: "Tenant", type: "text", get: (r) => r.tenant, render: (r) => esc(r.tenant || "\u2014") },
        { key: "automationName", label: "Automation", type: "text", get: (r) => r.automationName, cellClass: "cell-strong", render: (r) => esc(r.automationName || "\u2014") },
        { key: "contactName", label: "Contact", type: "text", get: (r) => r.contactName, render: (r) => esc(r.contactName || "\u2014") },
        { key: "status", label: "Status", type: "text", get: (r) => r.status, render: (r) => r.status === "failed" ? `<span class="pill skipped">failed</span>` : `<span class="pill">overdue</span>` },
        { key: "error", label: "Error", type: "text", get: (r) => r.error, render: (r) => `<span class="cell-muted">${esc(r.error || "\u2014")}</span>` },
      ],
    },
    errors: { component: (host) => renderErrorsTable(host, { embedId: "panel", filter: { from: new Date(Date.now() - 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) } }) }, // the tile panel = the SAME component, pre-filtered ~24h
    webhooks: { component: (host) => renderWebhooksTable(host, { embedId: "panel", filter: { from: new Date(Date.now() - 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) } }) }, // ditto: the Task-6 rewire
  };

  // The ONE embedded data-table panel: audit-shaped configs EMBED renderAuditLog
  // (the DT-3 component, preset-filtered); row-shaped configs fetch + mount the
  // SAME App.table.mount machinery with a Tenant filter select. Configurations,
  // not seven implementations.
  async function mountHealthDataPanel(host, checkKey, cfg) {
    if (cfg.component) { await cfg.component(host); return; } // e.g. Errors: the sub-tab's own component, pre-filtered
    if (cfg.audit) { await renderAuditLog(host, { embedded: true, embedId: checkKey, filter: cfg.audit(), defaultKeys: cfg.defaultKeys }); return; }
    App.util.showSkeleton(host, "table");
    let rows = [];
    try { rows = (await App.api(cfg.fetch)).rows || []; }
    catch (e) { host.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
    host.innerHTML = "";
    const bar = el("div", "adm-auditbar table-lead");
    let tenantFilter = "";
    const tenants = Array.from(new Set(rows.map((r) => r.tenant).filter(Boolean))).sort();
    const mkSel = (pairs, onchange) => { const s = el("select", "input adm-cadsel"); pairs.forEach((p) => { const o = el("option", null, esc(p[1])); o.value = p[0]; s.appendChild(o); }); s.onchange = () => onchange(s.value); return s; };
    bar.appendChild(mkSel([["", "All tenants"]].concat(tenants.map((t) => [t, t])), (v) => { tenantFilter = v; paint(); }));
    host.appendChild(bar);
    const tableHost = el("div");
    host.appendChild(tableHost);
    function paint() {
      tableHost.innerHTML = "";
      App.table.mount({
        container: tableHost,
        columns: cfg.columns(),
        rows: tenantFilter ? rows.filter((r) => r.tenant === tenantFilter) : rows,
        tableId: "admin-health-" + checkKey,
        pageSize: 25,
        emptyHtml: `<div class="card cell-muted adm-t14">Nothing in the queue.</div>`,
      });
    }
    paint();
  }

  // Health v2 — the expanded detail panel. Full width, directly beneath the tile's
  // SECTION row; a strict accordion (opening another tile's panel closes the open
  // one in that section); \u2715 closes. Content: caption, full untruncated status,
  // per-tile extras, the recent-checks ring-buffer table (shared table styling),
  // and a per-tile Re-check that runs ONLY that check.
  const healthPanelHosts = {}; // groupKey -> host element (rebuilt each paint)
  function closeHealthPanel(host) { if (host) { host.innerHTML = ""; host.classList.add("u-hidden"); if (host._openKey) host._openKey = null; } }
  async function openHealthPanel(groupKey, checkKey, tile) {
    const host = healthPanelHosts[groupKey];
    if (!host) return;
    if (host._openKey === checkKey) { closeHealthPanel(host); return; } // toggling the same tile closes
    host._openKey = checkKey;
    host.classList.remove("u-hidden");
    host.innerHTML = `<div class="card health-panel"><span class="cell-muted">Loading\u2026</span></div>`;
    let d;
    try { d = await App.api(`/api/admin/health/detail/${encodeURIComponent(checkKey)}`); }
    catch (e) { host.innerHTML = `<div class="card health-panel cell-muted">${esc(e.message)}</div>`; return; }
    if (host._openKey !== checkKey) return; // another tile opened meanwhile
    paintHealthPanel(host, groupKey, checkKey, tile, d);
  }
  function healthHistoryRows(history) {
    return (history || []).map((h) => `<tr><td class="cell-muted">${fmtDate(h.checkedAt)}</td><td><span class="health-dot ${esc(h.status)}"></span> ${esc(h.status)}</td><td>${h.latencyMs} ms</td><td class="health-hist-detail">${esc(h.detail)}</td></tr>`).join("");
  }
  function paintHealthPanel(host, groupKey, checkKey, tile, d) {
    const label = HEALTH_CHECK_LABELS[checkKey] || checkKey;
    const cur = d.current;
    const panel = el("div", "card health-panel");
    const head = el("div", "health-panel-head");
    head.innerHTML = `<strong>${esc(label)}</strong>`;
    const closeBtn = el("button", "icon-btn health-panel-close", "\u2715");
    closeBtn.setAttribute("aria-label", "Close " + label + " details");
    head.appendChild(closeBtn);
    panel.appendChild(head);
    panel.appendChild(el("p", "cell-muted health-caption", HEALTH_CAPTIONS[checkKey] || ""));

    const statusWrap = el("div", "health-panel-status");
    function statusHtml(c) {
      if (!c) return `<span class="cell-muted">No check has run yet \u2014 use Re-check now.</span>`;
      return `<span class="health-card-head"><span class="health-dot ${esc(c.status)}"></span><strong>${esc(c.status.toUpperCase())}</strong></span><span class="health-panel-detail">${esc(c.detail)}</span><span class="cell-muted health-card-meta">${c.latencyMs} ms \u00b7 checked ${fmtDate(c.checkedAt)}</span>`;
    }
    statusWrap.innerHTML = statusHtml(cur);
    panel.appendChild(statusWrap);

    // per-tile extras (cheap reads served by the detail endpoint; infra tiles only —
    // the data-backed tiles' old lists/links are SUPERSEDED by their real tables)
    const dataCfg = HEALTH_DATA_PANELS[checkKey];
    const ex = d.extras || {};
    if (checkKey === "twilio" && ex.phoneNumber) {
      panel.appendChild(el("p", "cell-muted health-extra", "Number: " + esc(ex.phoneNumber) + " \u00b7 " + esc(ex.webhookNote || "")));
    }
    if (checkKey === "scheduler") {
      panel.appendChild(el("p", "cell-muted health-extra", "The table below doubles as the tick log \u2014 each row is one look at the heartbeat."));
    }

    // the recent-checks table (ring buffer; shared table styling). On DATA-BACKED
    // tiles the underlying-rows table is the star, so the check history collapses
    // behind a small link; infrastructure tiles keep it front and center.
    const histWrap = el("div");
    const histHead = el("h4", "settings-sub", "Recent checks");
    const twrap = el("div", "table-wrap card health-history");
    twrap.innerHTML = `<table><thead><tr><th>Time</th><th>Status</th><th>Latency</th><th>Detail</th></tr></thead><tbody>${healthHistoryRows(d.history) || `<tr><td colspan="4" class="cell-muted">No checks recorded yet.</td></tr>`}</tbody></table>`;
    histWrap.appendChild(histHead);
    histWrap.appendChild(twrap);
    histWrap.appendChild(el("p", "cell-muted health-panel-foot", `History is kept in memory (last ${d.historyLimit || 30} checks per item) and resets when the app restarts.`));
    if (dataCfg) {
      histWrap.classList.add("u-hidden");
      const histToggle = el("button", "btn btn-ghost btn-sm health-hist-toggle", "Check history \u25b8");
      histToggle.onclick = () => { const open = histWrap.classList.toggle("u-hidden"); histToggle.textContent = open ? "Check history \u25b8" : "Check history \u25be"; };
      panel.appendChild(histToggle);
      const dataHost = el("div", "health-data-host");
      panel.appendChild(dataHost);
      panel.appendChild(histWrap);
      mountHealthDataPanel(dataHost, checkKey, dataCfg); // the star: REAL underlying rows
    } else {
      panel.appendChild(histWrap);
    }

    // per-tile re-check: runs ONLY this check; updates the face + status + table
    const re = el("button", "btn btn-ghost btn-sm health-recheck-one", "Re-check now");
    re.onclick = async () => {
      re.disabled = true;
      try {
        const r = await App.api(`/api/admin/health/recheck/${encodeURIComponent(checkKey)}`, { method: "POST" });
        statusWrap.innerHTML = statusHtml(r.check);
        twrap.querySelector("tbody").innerHTML = healthHistoryRows(r.history);
        if (tile) { // repaint BOTH faces' dot + the back detail/meta in place
          tile.querySelectorAll(".health-dot").forEach((dEl) => { dEl.className = "health-dot " + r.check.status; });
          const det = tile.querySelector(".health-card-detail"); if (det) det.textContent = r.check.detail;
          const metaEl = tile.querySelector(".health-card-meta"); if (metaEl) metaEl.textContent = `${r.check.latencyMs} ms \u00b7 ${fmtDate(r.check.checkedAt)}`;
        }
      } catch (e) { toast(e.message); }
      re.disabled = false;
    };
    head.insertBefore(re, closeBtn);
    closeBtn.onclick = () => closeHealthPanel(host);

    host.innerHTML = "";
    host.appendChild(panel);
  }

  async function renderHealthOverview(host) {
    App.util.showSkeleton(host, "widgets");
    let snap;
    try { snap = await App.api("/api/admin/health"); }
    catch (e) { host.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
    paintHealth(host, snap);
  }

  function paintHealth(host, snap) {
    host.innerHTML = "";
    const wrap = el("div", "fade-in");
    // health v2: NO banner — the per-tile dots carry status. One small right-aligned
    // "Re-check all" above the first section is the only global control.
    const reAllRow = el("div", "health-reall-row");
    const recheck = el("button", "btn btn-ghost btn-sm", "Re-check all");
    recheck.onclick = async () => {
      recheck.disabled = true;
      App.util.showSkeleton(host, "widgets");
      try {
        const fresh = await App.api("/api/admin/health/recheck", { method: "POST" });
        paintHealth(host, fresh);
      } catch (e) { toast(e.message); paintHealth(host, snap); }
    };
    reAllRow.appendChild(recheck);
    wrap.appendChild(reAllRow);

    Object.keys(snap.groups).forEach((gk) => {
      const checks = snap.groups[gk] || {};
      wrap.appendChild(el("div", "eyebrow health-group-eyebrow", esc(HEALTH_GROUP_LABELS[gk] || gk)));
      const scroller = el("div", "health-scroller");
      const grid = el("div", "settings-tiles health-grid");
      scroller.appendChild(grid);
      const panelHost = el("div", "health-panel-host u-hidden");
      healthPanelHosts[gk] = panelHost;
      // snap-scroll affordance: fades/chevron only where there IS more to scroll
      const syncFade = () => {
        scroller.classList.toggle("can-left", grid.scrollLeft > 4);
        scroller.classList.toggle("can-right", grid.scrollLeft + grid.clientWidth < grid.scrollWidth - 4);
      };
      grid.addEventListener("scroll", syncFade, { passive: true });
      scroller.appendChild(el("span", "health-hint", "\u203a"));
      requestAnimationFrame(syncFade);
      Object.keys(checks).forEach((ck) => {
        const c = checks[ck];
        // Health v2: a TWO-FACED tile. Hover flips (mouse enter/leave), tap flips
        // (touch/first click), Enter/Space flips (keyboard); clicking the flipped
        // BACK — or its "Expand \u2197" affordance — opens the expanded panel.
        // Identical footprint both faces (absolutely-stacked in a fixed-height
        // inner), so flipping causes ZERO layout shift. Reduced motion: crossfade.
        const tile = el("div", "settings-tile health-card health-flip");
        tile.tabIndex = 0;
        tile.setAttribute("role", "button");
        tile.setAttribute("aria-label", (HEALTH_CHECK_LABELS[ck] || ck) + " health tile — press Enter to flip, again to expand");
        const faceMedia = HEALTH_LOGOS[ck]
          ? `<img class="intg-logo health-face-logo" src="${esc(HEALTH_LOGOS[ck])}" alt="${esc(HEALTH_CHECK_LABELS[ck] || ck)} logo">`
          : (HEALTH_WIDGETS[ck] || "");
        tile.innerHTML = `<div class="health-flip-inner">
          <div class="health-face health-face-front">${faceMedia}<span class="health-card-head"><span class="health-dot ${esc(c.status)}"></span><strong>${esc(HEALTH_CHECK_LABELS[ck] || ck)}</strong></span></div>
          <div class="health-face health-face-back"><span class="health-card-head"><span class="health-dot ${esc(c.status)}"></span><strong>${esc(HEALTH_CHECK_LABELS[ck] || ck)}</strong></span><span class="cell-muted health-card-detail">${esc(c.detail)}</span><span class="cell-muted health-card-meta">${c.latencyMs} ms \u00b7 ${fmtDate(c.checkedAt)}</span><button class="btn btn-ghost btn-sm health-expand" type="button">Expand \u2197</button></div>
        </div>`;
        const flip = (on) => tile.classList.toggle("flipped", on === undefined ? undefined : !!on);
        tile.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") flip(true); });
        tile.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") flip(false); });
        tile.addEventListener("click", (e) => {
          if (!tile.classList.contains("flipped")) { flip(true); return; } // first tap (touch) flips
          openHealthPanel(gk, ck, tile); // the flipped back (or Expand) opens the panel
        });
        tile.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!tile.classList.contains("flipped")) flip(true); else openHealthPanel(gk, ck, tile); }
          if (e.key === "Escape") flip(false);
        });
        grid.appendChild(tile);
      });
      wrap.appendChild(scroller);
      wrap.appendChild(panelHost); // the full-width panel opens directly beneath this section's row
    });
    host.appendChild(wrap);
  }

  // ---------------- Audit Log (devtools batch 3) ----------------
  // READ-ONLY viewer over the DT-2 AuditEvent trail, on the SAME App.table.mount
  // machinery as the Change Log and tenant lists (sortable columns, the shared search
  // box, manage-columns, pagination) — no parallel table. Server-side filters ride
  // the DT-2 indexes; the table pages the loaded window client-side like its siblings.
  const AUDIT_COLS_KEY = "clarity_admin_audit_cols";
  const AUDIT_PAGE_LIMIT = 200; // server window per fetch (capped server-side at 500)

  function auditDetailsSummary(r) {
    const d = r.diff && typeof r.diff === "object" ? Object.keys(r.diff).length : 0;
    if (d) return d + (d === 1 ? " field changed" : " fields changed");
    const m = r.meta || {};
    if (m.imported !== undefined) return m.imported + " rows imported" + (m.skipped ? ", " + m.skipped + " skipped" : "");
    if (m.rows !== undefined) return m.rows + " rows";
    if (m.count !== undefined) return m.count + " rows";
    if (m.recipients !== undefined) return m.recipients + (m.recipients === 1 ? " recipient" : " recipients");
    // Auth events: their substance is the User + the IP COLUMN — Details never
    // duplicates the IP (audit-fixes batch). Other meta falls through below.
    if (m.status) return String(m.status);
    return "\u2014";
  }

  // One value, rendered safely for the diff table: JSON pretty-printed small; long
  // values truncated with an inline expand. Read-only; everything escaped.
  function auditValHtml(v) {
    let text;
    if (v === undefined) text = "\u2014";
    else if (v === null) text = "null";
    else if (typeof v === "object") { try { text = JSON.stringify(v, null, 1); } catch (e) { text = String(v); } }
    else text = String(v);
    const LONG = 120;
    if (text.length <= LONG) return `<span class="adm-diff-val">${esc(text)}</span>`;
    return `<span class="adm-diff-val"><span class="adm-diff-short">${esc(text.slice(0, LONG))}\u2026 <button class="btn btn-ghost btn-sm adm-diff-expand" type="button">Show all</button></span><span class="adm-diff-full u-hidden">${esc(text)}</span></span>`;
  }

  function openAuditDetail(r, tenantName, userTypeOf) {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Audit event</h2><button class="icon-btn" id="aud-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    const metaGrid = el("div", "adm-audit-metagrid");
    const rowsHtml = [
      ["Time", fmtDate(r.createdAt)],
      ["Tenant", tenantName[r.tenantId] || "\u2014"],
      ["User", `${esc(r.actorLabel)}${r.actorId ? ` <span class="cell-muted">${esc(r.actorId)}</span>` : ""}`],
      ["User Type", esc(userTypeOf ? userTypeOf(r) : r.actorType)],
      ["Action", esc(r.action)],
      ["Subject", `${esc(r.subjectLabel || "\u2014")} <span class="cell-muted">${esc(r.subjectType)}${r.subjectId ? " \u00b7 " + esc(r.subjectId) : ""}</span>`],
      ["Record type", esc(r.recordTypeKey || "\u2014")],
      ["Status", r.status === "pending_deletion" ? `<span class="pill skipped">pending deletion</span>` : `<span class="pill success">active</span>`],
    ];
    metaGrid.innerHTML = rowsHtml.map(([k, v]) => `<div class="adm-audit-metak cell-muted">${esc(k)}</div><div class="adm-audit-metav">${v}</div>`).join("");
    body.appendChild(metaGrid);

    const diffKeys = r.diff && typeof r.diff === "object" ? Object.keys(r.diff) : [];
    if (diffKeys.length) {
      body.appendChild(el("h3", "settings-sub", "Changes"));
      const t = el("table", "adm-diff-table");
      t.innerHTML = `<thead><tr><th>Field</th><th>Before</th><th></th><th>After</th></tr></thead><tbody>` +
        diffKeys.map((k) => { const d = r.diff[k] || {}; return `<tr><td class="cell-strong">${esc(k)}</td><td class="adm-diff-old">${auditValHtml(d.from)}</td><td class="adm-diff-arrow">\u2192</td><td class="adm-diff-new">${auditValHtml(d.to)}</td></tr>`; }).join("") + `</tbody>`;
      body.appendChild(t);
    }
    const metaKeys = r.meta && typeof r.meta === "object" ? Object.keys(r.meta) : [];
    if (metaKeys.length) {
      body.appendChild(el("h3", "settings-sub", "Details"));
      const mg = el("div", "adm-audit-metagrid");
      mg.innerHTML = metaKeys.map((k) => `<div class="adm-audit-metak cell-muted">${esc(k)}</div><div class="adm-audit-metav">${auditValHtml(r.meta[k])}</div>`).join("");
      body.appendChild(mg);
    }
    if (!diffKeys.length && !metaKeys.length) body.appendChild(el("p", "cell-muted", "No additional detail was recorded for this event."));
    inner.appendChild(body);
    const overlay = modal(inner);
    inner.querySelector("#aud-close").onclick = () => overlay.remove();
    body.addEventListener("click", (e) => {
      const b = e.target && e.target.closest(".adm-diff-expand");
      if (!b) return;
      const val = b.closest(".adm-diff-val");
      val.querySelector(".adm-diff-short").classList.add("u-hidden");
      val.querySelector(".adm-diff-full").classList.remove("u-hidden");
    });
  }

  // devtools-data: renderAuditLog is EMBEDDABLE — opts { embedded, filter, defaultKeys }
  // let health panels reuse THE audit table component with preset filters (no fork).
  async function renderAuditLog(hostEl, opts) {
    opts = opts || {};
    const mount = hostEl || view();
    App.util.showSkeleton(mount, "table");
    let meta, portals;
    try {
      meta = await App.api("/api/admin/audit-events/meta");
      portals = await App.api("/api/admin/portals");
    } catch (e) { mount.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
    const tenantName = {};
    (portals || []).forEach((p) => { tenantName[p.id] = p.name; });

    // filter state (server-side; the DT-2 [status, createdAt] index backs the default view)
    const f = { tenantId: "", actorType: "", group: "", status: "active", from: "", to: "", action: "" }; // action: exact-match preset used by embedded panels
    // health v2: consume a one-shot deep-link prefilter (e.g. the Automations panel
    // links here with group=automations + the 7-day range).
    const hint = App.state._devtoolsHint || null;
    if (hint && hint.auditFilter) Object.assign(f, hint.auditFilter);
    App.state._devtoolsHint = null;
    if (opts.filter) Object.assign(f, opts.filter); // embedded preset (wins over hints)
    let rows = [];
    let nextCursor = null;

    const wrap = el("div", "fade-in");
    // the retention note interpolates the SERVER'S OWN constants — the copy can't drift
    const note = el("p", "cell-muted adm-audit-note table-lead",
      esc("Events are kept " + meta.retention.ACTIVE_DAYS + " days, then pending deletion for " + meta.retention.PENDING_DAYS + " more, then removed automatically."));
    if (!opts.embedded) wrap.appendChild(note); // embedded panels lead with the data, not the policy

    const bar = el("div", "adm-auditbar table-lead");
    const mkSel = (optionPairs, onchange) => { const s = el("select", "input adm-cadsel"); optionPairs.forEach((pair) => { const o = el("option", null, esc(pair[1])); o.value = pair[0]; s.appendChild(o); }); s.onchange = () => onchange(s.value); return s; };
    const tenantSel = mkSel([["", "All tenants"]].concat((portals || []).map((p) => [p.id, p.name])), (v) => { f.tenantId = v; reload(); });
    if (f.tenantId) tenantSel.value = f.tenantId;
    bar.appendChild(tenantSel);
    const actorSel = mkSel([["", "All actors"], ["user", "People"], ["ai", "AI receptionist"], ["automation", "Automations"], ["system", "System"]], (v) => { f.actorType = v; reload(); });
    if (f.actorType) actorSel.value = f.actorType;
    bar.appendChild(actorSel);
    const groupSel = mkSel([["", "All actions"]].concat(meta.groups.map((g) => [g.key, g.label])), (v) => { f.group = v; reload(); });
    if (f.group) groupSel.value = f.group;
    bar.appendChild(groupSel);
    const statusSel = mkSel([["active", "Active"], ["pending_deletion", "Pending deletion"], ["all", "All"]], (v) => { f.status = v; reload(); });
    if (f.status !== "active") statusSel.value = f.status;
    bar.appendChild(statusSel);
    // ONE "Date range" preset select — exactly four options (health-v2: the custom
    // date pair is gone; the Time column's sort covers fine-grained needs).
    const dayIso = (d) => d.toISOString().slice(0, 10);
    const rangeSel = mkSel([["all", "All time"], ["today", "Today"], ["7", "Last 7 days"], ["14", "Last 14 days"]], (v) => {
      const now = new Date();
      if (v === "all") { f.from = ""; f.to = ""; }
      else if (v === "today") { f.from = dayIso(now); f.to = dayIso(now); }
      else { const d = new Date(now.getTime() - (Number(v) - 1) * 86400000); f.from = dayIso(d); f.to = dayIso(now); }
      reload();
    });
    bar.appendChild(rangeSel);
    wrap.appendChild(bar);

    const tableHost = el("div");
    wrap.appendChild(tableHost);
    const moreWrap = el("div", "adm-audit-more");
    const moreBtn = el("button", "btn btn-ghost btn-sm", "Load older events");
    moreWrap.appendChild(moreBtn);
    wrap.appendChild(moreWrap);

    // User Type: humans show their ROLE (hub roles persist through impersonation —
    // captured from req.realUser); custom portal roles resolve via the meta roster;
    // non-humans map from actorType; historical events (no actorRole) show an em-dash.
    const ROLE_LABELS = { OWNER: "Owner", SUPER_ADMIN: "Super Admin", AUDITOR: "Auditor", PORTAL_ADMIN: "Portal admin", CLIENT_USER: "Client user" };
    const userTypeOf = (r) => {
      if (r.actorType === "ai") return "AI receptionist";
      if (r.actorType === "system") return "System";
      if (r.actorType === "automation") return "Automation";
      const role = r.actorRole;
      if (!role) return "\u2014";
      if (role.indexOf("CUSTOM:") === 0) return (meta.customRoles && meta.customRoles[role.slice(7)]) || "Custom role";
      return ROLE_LABELS[role] || role;
    };
    const columns = [
      { key: "createdAt", label: "Time", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` },
      { key: "tenant", label: "Tenant", type: "text", get: (r) => tenantName[r.tenantId] || "", render: (r) => esc(tenantName[r.tenantId] || "\u2014") },
      { key: "actor", label: "User", type: "text", get: (r) => r.actorLabel, cellClass: "cell-strong", render: (r) => esc(r.actorLabel) }, // name only — the pill moved into User Type
      { key: "userType", label: "User Type", type: "text", get: (r) => userTypeOf(r), render: (r) => esc(userTypeOf(r)) },
      { key: "action", label: "Action", type: "text", get: (r) => r.action, render: (r) => esc(r.action) },
      { key: "subject", label: "Subject", type: "text", get: (r) => r.subjectLabel || r.subjectType, render: (r) => `${esc(r.subjectLabel || "\u2014")} <span class="cell-muted">${esc(r.subjectType)}</span>` },
      { key: "details", label: "Details", type: "text", get: (r) => auditDetailsSummary(r), render: (r) => esc(auditDetailsSummary(r)) },
      { key: "actorId", label: "Actor ID", type: "text", get: (r) => r.actorId || "", render: (r) => `<span class="cell-muted">${esc(r.actorId || "\u2014")}</span>` },
      { key: "subjectId", label: "Subject ID", type: "text", get: (r) => r.subjectId || "", render: (r) => `<span class="cell-muted">${esc(r.subjectId || "\u2014")}</span>` },
      { key: "recordTypeKey", label: "Record type", type: "text", get: (r) => r.recordTypeKey || "", render: (r) => esc(r.recordTypeKey || "\u2014") },
      { key: "status", label: "Status", type: "text", get: (r) => r.status, render: (r) => r.status === "pending_deletion" ? `<span class="pill skipped">pending deletion</span>` : `<span class="pill success">active</span>` },
      { key: "ip", label: "IP", type: "text", get: (r) => (r.meta && r.meta.ip) || "", render: (r) => `<span class="cell-muted">${esc((r.meta && r.meta.ip) || "\u2014")}</span>` },
    ];
    const defaultKeys = opts.defaultKeys || ["createdAt", "tenant", "actor", "userType", "action", "subject", "details"];
    const loadLayout = () => { try { return JSON.parse(localStorage.getItem(AUDIT_COLS_KEY) || "{}") || {}; } catch (e) { return {}; } };
    const saveLayout = (l) => { try { localStorage.setItem(AUDIT_COLS_KEY, JSON.stringify(l || {})); } catch (e) {} };
    let layout = loadLayout();

    let handle = null;
    function mountTable() {
      tableHost.innerHTML = "";
      const initial = App.table.applyColumnLayout(columns, layout, defaultKeys);
      handle = App.table.mount({
        container: tableHost, columns: initial, rows,
        tableId: opts.embedded ? "admin-auditlog-embed-" + (opts.embedId || "panel") : "admin-auditlog",
        defaultSort: "createdAt", defaultSortDir: "desc",
        emptyHtml: `<div class="card cell-muted adm-t14">No audit events match.</div>`,
        pageSize: 25,
        onRowClick: (r) => openAuditDetail(r, tenantName, userTypeOf),
        rowClass: (r) => (r.status === "pending_deletion" ? "adm-audit-pending" : ""),
      });
      App.table.manageColumns(handle, columns, { defaultKeys, order: layout.order, hidden: layout.hidden, onSave: (nl) => { layout = { order: nl.order, hidden: nl.hidden }; saveLayout(layout); } });
      // Export — immediately LEFT of Manage columns (the charges-page precedent),
      // through App.exportModal wholesale: field selection (hidden ID columns
      // included as selectable fields), CSV vs Excel, and the master-hub recent-
      // exports history. Exports the CURRENTLY FILTERED, loaded window.
      const exportBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8679;</span> Export`);
      exportBtn.onclick = () => App.exportModal({
        title: "Export audit events",
        columns: columns.map((c) => ({ key: c.key, label: c.label, type: c.type, get: c.get, text: c.text })),
        rows: handle.getFiltered(),
        dataType: "audit",
        namePlaceholder: "e.g. July audit trail",
        filterLabel: "Which events to export",
        unitPlural: "Events",
        sheetName: "Audit events",
        countText: (n) => n + " event" + (n === 1 ? "" : "s"),
        saveHistory: true,
        historyApi: App.api,
        historyBase: "/api/admin/exports",
      });
      const manageBtnEl = handle.toolbarRight && handle.toolbarRight.firstChild;
      if (handle.toolbarRight) handle.toolbarRight.insertBefore(exportBtn, manageBtnEl);
      moreWrap.classList.toggle("u-hidden", !nextCursor);
    }

    function queryString(cursor) {
      const p = new URLSearchParams();
      p.set("limit", String(AUDIT_PAGE_LIMIT));
      p.set("status", f.status);
      if (f.tenantId) p.set("tenantId", f.tenantId);
      if (f.actorType) p.set("actorType", f.actorType);
      if (f.group) { const g = meta.groups.find((x) => x.key === f.group); if (g) p.set("actions", g.prefixes.join(",")); }
      if (f.action) p.set("action", f.action);
      if (f.from) p.set("from", f.from);
      if (f.to) p.set("to", f.to);
      if (cursor) p.set("cursor", cursor);
      return p.toString();
    }
    async function reload() {
      App.util.showSkeleton(tableHost, "table");
      try {
        const r = await App.api(`/api/admin/audit-events?${queryString(null)}`);
        rows = r.events || [];
        nextCursor = r.nextCursor || null;
      } catch (e) { tableHost.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
      mountTable();
    }
    moreBtn.onclick = async () => {
      if (!nextCursor) return;
      moreBtn.disabled = true;
      try {
        const r = await App.api(`/api/admin/audit-events?${queryString(nextCursor)}`);
        rows = rows.concat(r.events || []);
        nextCursor = r.nextCursor || null;
      } catch (e) { toast(e.message); }
      moreBtn.disabled = false;
      mountTable();
    };

    mount.innerHTML = "";
    mount.appendChild(wrap);
    await reload();
  }

  // ---------------- Change Log ----------------
  // Product-level log of every change shipped, read from the DB (never git).
  // Reuses App.table.mount — same sort/filter/pagination as the other hub tables.
  // Devtools shell: the SAME function, now mountable into any host (the Change Log
  // sub-tab passes one; with no argument it behaves exactly as it always did).
  async function renderChangelog(hostEl) {
    const mount = hostEl || view();
    App.util.showSkeleton(mount, "table");
    let rows;
    try { rows = await App.api("/api/admin/changelog"); }
    catch (e) { mount.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
    if (!Array.isArray(rows)) rows = [];

    mount.innerHTML = "";
    const host = el("div", "fade-in");
    mount.appendChild(host);

    const columns = [
      { key: "date", label: "Date", type: "date", get: (r) => r.date, text: (r) => fmtDateOnly(r.date), render: (r) => `<span class="cell-muted">${fmtDateOnly(r.date)}</span>` },
      { key: "type", label: "Type", type: "text", get: (r) => r.type, cellClass: "cell-strong", render: (r) => esc(r.type || "—") },
      { key: "description", label: "Description", type: "text", get: (r) => r.description, render: (r) => esc(r.description || "—") },
    ];
    const empty = `<div class="card cell-muted adm-t14">No changes logged yet.</div>`;
    App.table.mount({
      container: host, columns, rows,
      tableId: "admin-changelog",
      defaultSort: "date", defaultSortDir: "desc",
      emptyHtml: empty, pageSize: 25,
    });
  }

  // ---------------- Master-hub Email deliverability page (OWNER/SUPER_ADMIN) ----------------
  // Combined status: prefer the live delivery status (from the Resend webhook), else fall
  // back to the send outcome. Bounced/complained/failed render red (badge-failed).
  function emailStatusInfo(r) {
    const d = r && r.deliveryStatus;
    if (d) {
      const map = {
        delivered: ["badge-completed", "Delivered"],
        opened: ["badge-completed", "Opened"],
        clicked: ["badge-completed", "Clicked"],
        delivery_delayed: ["badge-progress", "Delayed"],
        bounced: ["badge-failed", "Bounced"],
        complained: ["badge-failed", "Complained"],
        failed: ["badge-failed", "Failed"],
      };
      return map[d] || ["badge-neutral", d];
    }
    const smap = { sent: ["badge-neutral", "Sent"], failed: ["badge-failed", "Failed"], mock: ["badge-neutral", "Mock"] };
    return smap[r && r.status] || ["badge-neutral", (r && r.status) || "—"];
  }
  const emailStatusText = (r) => emailStatusInfo(r)[1];
  function emailStatusBadge(r) { const p = emailStatusInfo(r); return `<span class="badge ${p[0]}">${esc(p[1])}</span>`; }
  const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "—");

  // LEVEL 1 — one row per SEND (grouped by communicationSendId; one-off sends are groups
  // of one). Columns: Date, Tenant, Sent by, Subject, Recipients (count), Status (count
  // summary). No Type column here. Click a send -> its recipient list (Level 2).
  // Email History (devtools-data batch): the hub's Email tab, relocated VERBATIM
  // into Developer Tools -> History. _emailHost threads the render target; with no
  // host set the trio behaves exactly as the old top-level tab did.
  let _emailHost = null;
  const emailHost = () => _emailHost || view();
  async function renderEmail(hostEl) {
    if (hostEl !== undefined) _emailHost = hostEl;
    App.util.showSkeleton(emailHost(), "table");
    let rows;
    try { rows = await App.api("/api/admin/email-logs"); }
    catch (e) { emailHost().innerHTML = `<div class="card cell-muted adm-t14">${esc(e.message)}</div>`; return; }
    if (!Array.isArray(rows)) rows = [];

    emailHost().innerHTML = "";
    const wrap = el("div", "fade-in");
    emailHost().appendChild(wrap);
    const host = el("div");
    wrap.appendChild(host);

    const recipientsLabel = (n) => `${n} recipient${n === 1 ? "" : "s"}`;
    const columns = [
      { key: "date", label: "Date", type: "date", get: (r) => r.date, text: (r) => fmtDate(r.date), render: (r) => `<span class="cell-muted">${esc(fmtDate(r.date))}</span>` },
      { key: "tenant", label: "Tenant", type: "text", get: (r) => r.tenantName || "", render: (r) => esc(r.tenantName || "—") },
      { key: "sentby", label: "Sent by", type: "text", get: (r) => r.sentByName || "", render: (r) => esc(r.sentByName || "—") },
      { key: "subject", label: "Subject", type: "text", get: (r) => r.subject, render: (r) => esc(r.subject || "—") },
      { key: "recipients", label: "Recipients", type: "number", get: (r) => r.recipientCount, render: (r) => String(r.recipientCount) },
      // Status at this level is a SIMPLE COUNT SUMMARY — per-recipient statuses live in the drill-in.
      { key: "status", label: "Status", type: "text", get: (r) => recipientsLabel(r.recipientCount), render: (r) => `<span class="cell-muted">${esc(recipientsLabel(r.recipientCount))}</span>` },
    ];
    const empty = `<div class="card cell-muted adm-t14">No emails sent yet.</div>`;
    App.table.mount({
      container: host, columns, rows,
      rowId: (r) => r.groupKey,
      tableId: "admin-email-sends",
      scrollX: true,
      defaultSort: "date", defaultSortDir: "desc",
      onRowClick: (r) => renderEmailRecipients(r),
      emptyHtml: empty, pageSize: 50,
    });

    const caption = el("p", "cell-muted");
    caption.classList.add("adm-caption");
    caption.textContent = "Every email send across all tenants (one row per send). Click a send to see its recipients and delivery status.";
    const tbEl = host.querySelector(".table-toolbar");
    if (tbEl) tbEl.insertAdjacentElement("afterend", caption); else host.insertBefore(caption, host.firstChild);
  }

  // LEVEL 2 — the recipient list for ONE send. Always shown (even for a single-recipient
  // send, which renders a one-row list). Click a recipient -> full detail (Level 3).
  async function renderEmailRecipients(group) {
    App.util.showSkeleton(emailHost(), "table");
    let rows;
    try { rows = await App.api("/api/admin/email-logs/recipients?group=" + encodeURIComponent(group.groupKey)); }
    catch (e) { emailHost().innerHTML = `<div class="card cell-muted adm-t14">${esc(e.message)}</div>`; return; }
    if (!Array.isArray(rows)) rows = [];

    emailHost().innerHTML = "";
    const wrap = el("div", "fade-in");
    emailHost().appendChild(wrap);
    const back = el("button", "btn btn-ghost btn-sm", "\u2190 Back to Email");
    back.onclick = () => renderEmail();
    wrap.appendChild(back);

    const hd = el("div"); hd.classList.add("adm-hd");
    const count = group.recipientCount != null ? group.recipientCount : rows.length;
    hd.innerHTML = `<h2 class="adm-t15">${esc(group.subject || "(no subject)")}</h2>` +
      `<div class="cell-muted adm-t16">${esc(group.tenantName || "—")} \u00b7 ${count} recipient${count === 1 ? "" : "s"}${group.sentByName ? " \u00b7 sent by " + esc(group.sentByName) : ""}</div>`;
    wrap.appendChild(hd);

    const host = el("div");
    wrap.appendChild(host);
    const columns = [
      { key: "to", label: "Recipient", type: "text", get: (r) => r.toName || r.toEmail, render: (r) => r.toName ? `${esc(r.toName)} <span class="cell-muted">${esc(r.toEmail)}</span>` : esc(r.toEmail || "—") },
      { key: "status", label: "Status", type: "status", get: (r) => emailStatusText(r), render: (r) => emailStatusBadge(r) },
      { key: "date", label: "Sent at", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${esc(fmtDate(r.createdAt))}</span>` },
    ];
    const empty = `<div class="card cell-muted adm-t14">No recipients recorded for this send.</div>`;
    App.table.mount({
      container: host, columns, rows,
      rowId: (r) => r.id,
      tableId: "admin-email-recipients",
      scrollX: true,
      defaultSort: "to", defaultSortDir: "asc",
      onRowClick: (r) => renderEmailDetail(r, () => renderEmailRecipients(group)),
      emptyHtml: empty, pageSize: 50,
    });
  }

  // LEVEL 3 — full single-email detail. `onBack` returns to the recipient list (Level 2);
  // falls back to the Email list if somehow opened without a parent send.
  function renderEmailDetail(r, onBack) {
    emailHost().innerHTML = "";
    const wrap = el("div", "fade-in");
    emailHost().appendChild(wrap);
    const back = el("button", "btn btn-ghost btn-sm", onBack ? "\u2190 Back to recipients" : "\u2190 Back to Email");
    back.onclick = onBack || (() => renderEmail());
    wrap.appendChild(back);

    const card = el("div", "card");
    card.classList.add("adm-card4");
    const head = el("div"); head.classList.add("adm-head4");
    const title = el("h2", null, esc(r.subject || "(no subject)")); title.classList.add("adm-title3");
    head.appendChild(title);
    const badge = el("span"); badge.innerHTML = emailStatusBadge(r); head.appendChild(badge);
    card.appendChild(head);

    const grid = el("div"); grid.classList.add("adm-grid");
    const line = (label, html) => {
      const l = el("div", "cell-muted", esc(label));
      const v = el("div"); v.innerHTML = (html == null || html === "") ? "\u2014" : html;
      grid.appendChild(l); grid.appendChild(v);
    };
    line("Recipient", r.toName ? `${esc(r.toName)} <span class="cell-muted">&lt;${esc(r.toEmail)}&gt;</span>` : esc(r.toEmail || "—"));
    line("Tenant", esc(r.tenantName || "—"));
    line("Sent by", esc(r.sentByName || "—"));
    line("Type", esc(r.type || "—"));
    line("Subject", esc(r.subject || "—"));
    line("Send status", esc(cap(r.status)));
    line("Delivery status", r.deliveryStatus
      ? emailStatusBadge(r) + (r.deliveryDetail ? ` <span class="cell-muted">${esc(r.deliveryDetail)}</span>` : "")
      : `<span class="cell-muted">No delivery events yet</span>`);
    line("Sent at", esc(fmtDate(r.createdAt)));
    line("Last event", esc(r.lastEventAt ? fmtDate(r.lastEventAt) : "—"));
    line("Opened at", esc(r.openedAt ? fmtDate(r.openedAt) : "—"));
    if (r.errorMessage) line("Error", `<span class="adm-t17">${esc(r.errorMessage)}</span>`);
    if (r.providerMessageId) line("Message ID", `<span class="cell-muted adm-t18">${esc(r.providerMessageId)}</span>`);
    card.appendChild(grid);
    wrap.appendChild(card);
  }

  // ---------------- Billing rates editor (Billing & Usage → Billing Rates tab) ----------------
  // Renders the editable rate form into `host`. Reuses the SINGLE existing rates store +
  // endpoint (GET/PUT /api/admin/billing-rates) — no duplicate store. Brand logos reuse the
  // same /img assets the Integrations cards use.
  async function billingRatesInto(host) {
    host.innerHTML = `<div class="cell-muted u-pad-8">Loading rates…</div>`;
    let rates;
    try { rates = await App.api("/api/admin/billing-rates"); }
    catch (e) { host.innerHTML = `<div class="card cell-muted adm-t14">${esc(e.message)}</div>`; return; }
    rates = rates || {};
    host.innerHTML = "";

    const intro = el("p", "cell-muted");
    intro.classList.add("adm-intro");
    intro.textContent = "Editable cost rates used to estimate dollar costs from recorded usage. Changing these does not bill anyone — it only affects future estimates.";
    host.appendChild(intro);

    const card = el("div", "card");
    card.classList.add("adm-card5");
    const OPENAI = "/img/openai.webp", TWILIO = "/img/twilio.png";
    const fields = [
      ["openAiInputPer1kTokens", "OpenAI input — $ per 1K tokens", OPENAI],
      ["openAiOutputPer1kTokens", "OpenAI output — $ per 1K tokens", OPENAI],
      ["twilioPerCallMinute", "Twilio — $ per call minute", TWILIO],
      ["twilioPerNumberMonthly", "Twilio — $ per phone number / month", TWILIO],
      ["twilioPerSms", "Twilio — $ per SMS", TWILIO],
    ];
    const inputs = {};
    const grid = el("div"); grid.classList.add("adm-grid2");
    fields.forEach(([key, label, logo]) => {
      const ic = el("span"); ic.innerHTML = `<img src="${logo}" alt="" class="adm-t19">`;
      const l = el("label", "field-label", label); l.classList.add("adm-l");
      const inp = el("input", "input"); inp.type = "number"; inp.min = "0"; inp.step = "0.0001"; inp.classList.add("adm-l");
      inp.value = rates[key] != null ? String(rates[key]) : "0";
      inputs[key] = inp;
      grid.appendChild(ic); grid.appendChild(l); grid.appendChild(inp);
    });
    card.appendChild(grid);

    const foot = el("div"); foot.classList.add("adm-foot");
    const save = el("button", "btn btn-primary btn-sm", "Save rates");
    save.onclick = async () => {
      const body = {};
      for (const [key] of fields) {
        const n = Number(inputs[key].value);
        if (!isFinite(n) || n < 0) { toast(`${key} must be a non-negative number`, true); return; }
        body[key] = n;
      }
      save.disabled = true;
      try { const updated = await App.api("/api/admin/billing-rates", { method: "PUT", body: JSON.stringify(body) }); for (const [key] of fields) if (updated && updated[key] != null) inputs[key].value = String(updated[key]); toast("Rates saved"); }
      catch (e) { toast(e.message, true); }
      finally { save.disabled = false; }
    };
    foot.appendChild(save);
    card.appendChild(foot);
    // Task 6c: rates card + notifications card sit side by side (wrap on narrow screens).
    const row = el("div"); row.classList.add("adm-row");
    card.classList.add("adm-flexcard");
    row.appendChild(card);
    host.appendChild(row);

    await billingNotifySettingsInto(row);
  }

  // Approval-notification settings (global): recipients, lead days, cadence, enabled.
  async function billingNotifySettingsInto(host) {
    const card = el("div", "card"); card.classList.add("adm-card6");
    card.appendChild(el("h3", "adm-h3 u-mb-4x", "Approval notifications"));
    const note = el("p", "cell-muted"); note.classList.add("adm-note"); note.textContent = "Who gets emailed to approve auto-drafted charges, and how far ahead of the due date.";
    card.appendChild(note);
    const bodyWrap = el("div"); bodyWrap.innerHTML = `<div class="cell-muted u-meta">Loading…</div>`; card.appendChild(bodyWrap);
    host.appendChild(card);

    let cfg;
    try { cfg = await App.api("/api/admin/billing-notify-config"); }
    catch (e) { bodyWrap.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; return; }
    bodyWrap.innerHTML = "";

    // Enabled toggle.
    const enWrap = el("label"); enWrap.classList.add("adm-enwrap");
    const enCb = el("input"); enCb.type = "checkbox"; enCb.checked = !!cfg.enabled;
    enWrap.appendChild(enCb); enWrap.appendChild(document.createTextNode("Send approval reminder emails"));
    bodyWrap.appendChild(enWrap);

    // Recipients (add/remove).
    bodyWrap.appendChild(el("label", "field-label adm-lbl-m6", "Recipients"));
    let recipients = (cfg.recipients || []).slice();
    const chips = el("div"); chips.classList.add("adm-chips");
    function paintChips() {
      chips.innerHTML = "";
      if (!recipients.length) { const e = el("span", "cell-muted u-meta", "No recipients — the owner won’t be emailed."); chips.appendChild(e); }
      recipients.forEach((r, i) => {
        const chip = el("span"); chip.classList.add("adm-chip");
        chip.appendChild(document.createTextNode(r));
        const x = el("button", "icon-btn", "×"); x.classList.add("adm-x"); x.onclick = () => { recipients.splice(i, 1); paintChips(); };
        chip.appendChild(x); chips.appendChild(chip);
      });
    }
    paintChips(); bodyWrap.appendChild(chips);
    const addRow = el("div"); addRow.classList.add("adm-addrow");
    const addInp = el("input", "input"); addInp.type = "email"; addInp.placeholder = "name@example.com"; addInp.classList.add("adm-addinp");
    const addBtn = el("button", "btn btn-ghost btn-sm", "Add");
    function addEmail() { const v = (addInp.value || "").trim().toLowerCase(); if (!v) return; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast("Enter a valid email", true); return; } if (!recipients.includes(v)) recipients.push(v); addInp.value = ""; paintChips(); }
    addBtn.onclick = addEmail; addInp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } };
    addRow.appendChild(addInp); addRow.appendChild(addBtn); bodyWrap.appendChild(addRow);

    // Lead days + cadence.
    const row = el("div"); row.classList.add("adm-row2");
    const leadInp = el("input", "input"); leadInp.type = "number"; leadInp.min = "0"; leadInp.max = "365"; leadInp.step = "1"; leadInp.classList.add("adm-leadinp"); leadInp.value = String(cfg.leadDays);
    const cadSel = el("select", "input"); cadSel.classList.add("adm-cadsel");
    [["once", "Once"], ["daily_until_approved", "Daily until approved"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (cfg.cadence === v) o.selected = true; cadSel.appendChild(o); });
    row.appendChild(field("Lead days before due", leadInp));
    row.appendChild(field("Cadence", cadSel));
    bodyWrap.appendChild(row);

    // Optional customer receipt on payment (default OFF).
    const rcpWrap = el("label"); rcpWrap.classList.add("adm-rcpwrap");
    const rcpCb = el("input"); rcpCb.type = "checkbox"; rcpCb.checked = !!cfg.emailCustomerReceipt;
    rcpWrap.appendChild(rcpCb); rcpWrap.appendChild(document.createTextNode("Email the customer a short receipt when a charge is paid (Stripe also sends its own receipt)"));
    bodyWrap.appendChild(rcpWrap);

    const save = el("button", "btn btn-primary btn-sm", "Save notification settings");
    save.onclick = async () => {
      const body = { enabled: enCb.checked, recipients, leadDays: Number(leadInp.value || 0), cadence: cadSel.value, emailCustomerReceipt: rcpCb.checked };
      save.disabled = true;
      try { const u = await App.api("/api/admin/billing-notify-config", { method: "PATCH", body: JSON.stringify(body) }); recipients = (u.recipients || []).slice(); paintChips(); toast("Notification settings saved"); }
      catch (e) { toast(e.message, true); }
      finally { save.disabled = false; }
    };
    bodyWrap.appendChild(save);
  }

  // ================= Billing & Usage (reuses the reports widget engine) =================
  // The "usage" reporting source: one row per (tenant, day) bucket returned by the usage
  // endpoints. reportFields let the shared engine chart/sum any measure over time or tenant.
  const USAGE_FIELDS = [
    { key: "date", label: "Date", type: "date" },
    { key: "tenant", label: "Tenant", type: "text" },
    { key: "calls", label: "Calls", type: "number" },
    { key: "callMinutes", label: "Call minutes", type: "number" },
    { key: "promptTokens", label: "Prompt tokens", type: "number" },
    { key: "completionTokens", label: "Completion tokens", type: "number" },
    { key: "totalTokens", label: "Total tokens", type: "number" },
    { key: "emails", label: "Emails", type: "number" },
    { key: "sms", label: "SMS", type: "number" },
    { key: "callCost", label: "Call cost", type: "number" },
    { key: "tokenCost", label: "Token cost", type: "number" },
    { key: "numberCost", label: "Number cost", type: "number" },
    { key: "totalCost", label: "Total cost", type: "number" },
  ];
  const USAGE_TOP = USAGE_FIELDS.map((f) => f.key);

  function fmtMoney(v) {
    const n = Number(v) || 0;
    if (n !== 0 && Math.abs(n) < 0.01) return "$" + n.toFixed(4);
    return "$" + n.toFixed(2);
  }
  // Map endpoint day-buckets -> engine rows. Bucket start is a plain YYYY-MM-DD; we anchor it
  // at local noon so the engine's date bucketing never drifts across timezones. numberCost is
  // a monthly line item carried at the range level (not per-day), so it's 0 on each row; the
  // per-row totalCost is the usage-driven call+token+sms cost that sums cleanly over time.
  function usageRowsFromBuckets(buckets, tenantName) {
    return (buckets || []).map((b) => {
      const u = b.units || {}, c = b.cost || {};
      const totalCost = (c.callCost || 0) + (c.tokenCost || 0) + (c.smsCost || 0);
      return {
        date: b.start + "T12:00:00",
        tenant: tenantName || "All",
        calls: u.calls || 0,
        callMinutes: Math.round(((u.callSeconds || 0) / 60) * 1000) / 1000,
        promptTokens: u.promptTokens || 0,
        completionTokens: u.completionTokens || 0,
        totalTokens: u.totalTokens || 0,
        emails: u.emails || 0,
        sms: u.sms || 0,
        callCost: c.callCost || 0,
        tokenCost: c.tokenCost || 0,
        numberCost: 0,
        totalCost: Math.round(totalCost * 1e6) / 1e6,
      };
    });
  }
  const usageSource = (rows) => ({ key: "usage", label: "Usage", topLevel: USAGE_TOP, rows: rows || [], reportFields: USAGE_FIELDS });

  // Portfolio source: one row per tenant (all portals) over the range. Inherently macro.
  const PORTFOLIO_FIELDS = [
    { key: "tenant", label: "Portal", type: "text" },
    { key: "billingStatus", label: "Billing status", type: "text" },
    { key: "calls", label: "Calls", type: "number" },
    { key: "callMinutes", label: "Call minutes", type: "number" },
    { key: "promptTokens", label: "Prompt tokens", type: "number" },
    { key: "completionTokens", label: "Completion tokens", type: "number" },
    { key: "totalTokens", label: "Total tokens", type: "number" },
    { key: "emails", label: "Emails", type: "number" },
    { key: "estCost", label: "Est. cost", type: "number" },
    { key: "billed", label: "Billed", type: "number" },
    { key: "paid", label: "Paid", type: "number" },
    { key: "outstanding", label: "Outstanding", type: "number" },
  ];
  const PORTFOLIO_TOP = PORTFOLIO_FIELDS.map((f) => f.key);
  const portfolioSource = (rows) => ({ key: "portfolio", label: "By portal (all portals)", topLevel: PORTFOLIO_TOP, rows: rows || [], reportFields: PORTFOLIO_FIELDS, defaultGroupByKey: "tenant", defaultScope: "macro" });

  // Charges source: one row per charge over the range (all tenants for macro, one tenant otherwise).
  const CHARGES_FIELDS = [
    { key: "tenant", label: "Portal", type: "text" },
    { key: "billingStatus", label: "Billing status", type: "text" },
    { key: "status", label: "Status", type: "text" },
    { key: "periodStart", label: "Period start", type: "date" },
    { key: "periodEnd", label: "Period end", type: "date" },
    { key: "createdAt", label: "Created", type: "date" },
    { key: "approvedAt", label: "Approved", type: "date" },
    { key: "paidAt", label: "Paid", type: "date" },
    { key: "amount", label: "Amount", type: "number" },
    { key: "paid", label: "Paid amount", type: "number" },
    { key: "outstanding", label: "Outstanding", type: "number" },
  ];
  const CHARGES_TOP = CHARGES_FIELDS.map((f) => f.key);
  const chargesSource = (rows) => ({ key: "charges", label: "Charges", topLevel: CHARGES_TOP, rows: rows || [], reportFields: CHARGES_FIELDS, defaultScope: "both" });

  // A titled chart card whose body is sized so Chart.js (maintainAspectRatio:false) fills it.
  function usageChartCard(title, widgetDef, source, grouping, charts) {
    const card = el("div", "card"); card.classList.add("adm-card7");
    card.appendChild(el("div", "adm-card-title", esc(title)));
    const body = el("div"); body.classList.add("adm-body");
    card.appendChild(body);
    const w = Object.assign({}, widgetDef);
    if (grouping && Array.isArray(w.groupBy)) w.groupBy = w.groupBy.map((d) => (d.key === "date" ? { key: "date", date: grouping } : d));
    try { App.reports.renderWidgetBody(body, w, source, source.rows, source.reportFields, charts); }
    catch (e) { body.innerHTML = `<p class="cell-muted">${esc(e.message)}</p>`; }
    return card;
  }
  function kpiCard(label, value) {
    const card = el("div", "card stat-pill"); card.classList.add("adm-card8"); // Phase 9a: usage KPIs adopt the stat-pill finish
    const v = el("div", null, String(value)); v.classList.add("adm-v");
    const l = el("div", "cell-muted stat-pill-cap", label); l.classList.add("adm-l2");
    card.appendChild(v); card.appendChild(l);
    return card;
  }
  // Map endpoint totals -> quick KPI values (kept for the By-portal summary only; Overview and
  // the drill-in are now fully widget/dashboard-driven).
  function fmtInt(n) { return String(Math.round(Number(n) || 0)); }

  // Range + grouping control. Defaults to the last 30 days, grouped by day. onChange fires
  // with { from, to, grouping } whenever any input changes.
  function usageRangeControl(onChange) {
    const wrap = el("div"); wrap.classList.add("adm-wrap");
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const from0 = iso(new Date(Date.now() - 29 * 86400000)), to0 = iso(today);
    function field(label, node) { const d = el("div"); d.classList.add("adm-aiwrap"); const l = el("span", "cell-muted u-meta", label); d.appendChild(l); d.appendChild(node); return d; }
    const fromEl = el("input", "input"); fromEl.type = "date"; fromEl.value = from0; fromEl.classList.add("adm-cadsel");
    const toEl = el("input", "input"); toEl.type = "date"; toEl.value = to0; toEl.classList.add("adm-cadsel");
    const grpEl = el("select", "input"); grpEl.classList.add("adm-cadsel");
    [["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]].forEach(([v, lbl]) => { const o = el("option", null, lbl); o.value = v; grpEl.appendChild(o); });
    const fire = () => onChange({ from: fromEl.value, to: toEl.value, grouping: grpEl.value });
    [fromEl, toEl, grpEl].forEach((n) => n.addEventListener("change", fire));
    wrap.appendChild(field("From", fromEl)); wrap.appendChild(field("To", toEl)); wrap.appendChild(field("Group by", grpEl));
    return { el: wrap, get: () => ({ from: fromEl.value, to: toEl.value, grouping: grpEl.value }) };
  }

  // ---- Reusable, CUSTOMIZABLE usage dashboard (shared by the tenant drill-in + macro Overview) ----
  // Renders a global billing dashboard (scope) with the reused reports widget engine + editor:
  // add/edit/remove widgets that persist to the SHARED scope. cfg.load(from,to) returns the
  // usage rows for the current range; the range/grouping controls re-fetch + re-render. Because
  // the layout lives in the shared scope, editing from any tenant changes every tenant's layout,
  // while the DATA stays per-tenant (each cfg.load pulls that tenant's usage).
  // ---- Billing dashboards via the FULL reports engine (resize, reorder, multiple dashboards,
  // per-widget range + scope). Shared across the hub; rendered per-context (macro/tenant). ----
  // cfg: { context: "macro"|"tenant", load(from,to) -> usage rows }.
  function renderBillingDashboards(host, cfg) {
    const context = cfg.context;
    const tenantId = cfg.tenantId || null;
    // One range control shared by buildSources (reads current range) + renderTop (triggers reload).
    let reloadFn = () => {};
    const ctrl = usageRangeControl(() => reloadFn());
    function buildUsageSource() {
      const r = ctrl.get();
      const chargesUrl = `/api/admin/billing/charges-source?from=${r.from}&to=${r.to}` + (tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : "");
      return Promise.all([
        Promise.resolve(cfg.load(r.from, r.to)),
        App.api(`/api/admin/billing/portfolio?from=${r.from}&to=${r.to}`).catch(() => ({ rows: [] })),
        App.api(chargesUrl).catch(() => ({ rows: [] })),
      ]).then(([usageRows, portfolio, charges]) => {
        const usage = usageSource(usageRows);
        usage.dateKey = "date"; usage.grouping = r.grouping; usage.rangeFrom = r.from; usage.rangeTo = r.to;
        const port = portfolioSource((portfolio && portfolio.rows) || []); // range baked in server-side; no dateKey
        const chg = chargesSource((charges && charges.rows) || []);
        chg.dateKey = "createdAt"; chg.grouping = r.grouping; chg.rangeFrom = r.from; chg.rangeTo = r.to;
        return { usage, portfolio: port, charges: chg };
      });
    }
    const engine = App.reports.createDashboardEngine(host, {
      defaultSourceKey: "usage",
      showScope: true,
      applyGrouping: true,
      widgetFilter: (w) => {
        const s = w && w.scope ? w.scope : "both";
        return context === "macro" ? s !== "tenant" : s !== "macro";
      },
      hiddenNote: context === "tenant" ? "Some widgets appear only on the master-hub overview." : null,
      banner: context === "tenant" ? `Showing data for ${cfg.tenantName || "this portal"} only.` : null,
      loadDashboards: () => App.api("/api/admin/billing-dashboards"),
      buildSources: buildUsageSource,
      persistDashboard: (d) => App.api(`/api/admin/billing-dashboards/${encodeURIComponent(d.id)}`, { method: "PATCH", body: JSON.stringify({ widgets: d.widgets }) }),
      createDashboard: (name) => App.api("/api/admin/billing-dashboards", { method: "POST", body: JSON.stringify({ name }) }),
      renameDashboard: (id, name) => App.api(`/api/admin/billing-dashboards/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
      deleteDashboard: (id) => App.api(`/api/admin/billing-dashboards/${encodeURIComponent(id)}`, { method: "DELETE" }),
      renderTop: (reload) => { reloadFn = reload; return ctrl.el; },
    });
    return engine.boot();
  }
  function renderTenantUsageInto(host, tenantId, tenantName) {
    host.innerHTML = "";
    const sub = el("div", "tabs u-mb-12");
    const body = el("div", "tab-body");
    let active = "usage";
    const SUB = [["usage", "Usage"], ["billing", "Billing"]];
    function paint() {
      Array.from(sub.children).forEach((b) => b.classList.toggle("active", b.dataset.k === active));
      body.innerHTML = "";
      if (active === "usage") renderTenantUsageDash(body, tenantId, tenantName);
      else renderTenantBillingInto(body, tenantId, tenantName);
    }
    SUB.forEach(([k, label]) => { const b = el("button", "tab" + (k === active ? " active" : ""), label); b.dataset.k = k; b.onclick = () => { if (active === k) return; active = k; paint(); }; sub.appendChild(b); });
    host.appendChild(sub); host.appendChild(body);
    paint();
    return Promise.resolve();
  }

  function renderTenantUsageDash(host, tenantId, tenantName) {
    return renderBillingDashboards(host, {
      context: "tenant",
      tenantId: tenantId,
      tenantName: tenantName,
      load: async (from, to) => {
        const d = await App.api(`/api/admin/usage/tenant/${encodeURIComponent(tenantId)}?bucket=day&from=${from}&to=${to}`);
        return usageRowsFromBuckets(d.buckets, d.tenantName || tenantName);
      },
    });
  }

  // ---- Billing subtab: terms (BillingConfig + billingStatus) + charge/payment ledger ----
  async function renderTenantBillingInto(host, tenantId, tenantName) {
    host.dataset.billingHost = tenantId;
    host.innerHTML = `<div class="cell-muted u-pad-8">Loading billing…</div>`;
    let cfg, ledger;
    try { [cfg, ledger] = await Promise.all([App.api(`/api/admin/billing-config/${encodeURIComponent(tenantId)}`), App.api(`/api/admin/charges/tenant/${encodeURIComponent(tenantId)}`)]); }
    catch (e) { host.innerHTML = `<div class="card cell-muted adm-t14">${esc(e.message)}</div>`; return; }
    host.innerHTML = "";
    host.appendChild(billingTermsCard(tenantId, cfg));
    host.appendChild(chargesLedgerCard(tenantId, tenantName, ledger));
  }

  function field(label, node) { const d = el("div"); d.classList.add("adm-d2"); const l = el("span", "cell-muted u-meta", label); d.appendChild(l); d.appendChild(node); return d; }
  function checkRow(label, checked) { const w = el("label"); w.classList.add("adm-w"); const cb = el("input"); cb.type = "checkbox"; cb.checked = !!checked; w.appendChild(cb); w.appendChild(document.createTextNode(label)); return { el: w, cb }; }
  function dateInput(v) { const i = el("input", "input"); i.type = "date"; i.classList.add("adm-cadsel"); if (v) i.value = String(v).slice(0, 10); return i; }
  function numInput(v, step) { const i = el("input", "input"); i.type = "number"; i.step = step || "0.01"; i.min = "0"; i.classList.add("adm-i"); i.value = v == null ? "" : String(v); return i; }

  function openTermsHistory(tenantId, tenantName) {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Terms history</h2><button class="icon-btn" id="th-close">&times;</button></div>
      <div class="modal-body"><div class="cell-muted adm-t20">Loading…</div></div>`;
    const overlay = modal(inner); const body = inner.querySelector(".modal-body");
    inner.querySelector("#th-close").onclick = () => overlay.remove();
    App.api(`/api/admin/billing-config/${encodeURIComponent(tenantId)}/audit`).then((rows) => {
      if (!rows || !rows.length) { body.innerHTML = `<div class="cell-muted adm-t20">No terms changes recorded yet.</div>`; return; }
      body.innerHTML = `<div class="adm-t21">${rows.map((a) => `
        <div class="adm-t22">
          <span class="adm-dot-info"></span>
          <div class="u-flex-1"><div class="adm-t23">${esc(a.note)}</div>
          <div class="cell-muted u-meta">${esc(a.actorName || "Unknown")} · ${esc(fmtDate(a.createdAt))}</div></div>
        </div>`).join("")}</div>`;
    }).catch((e) => { body.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; });
  }

  function billingTermsCard(tenantId, cfg) {
    const card = el("div", "card"); card.classList.add("adm-card9");
    const head = el("div"); head.classList.add("adm-head5");
    head.appendChild(el("h3", "adm-h3", "Billing terms"));
    const hist = el("button", "btn btn-ghost btn-sm", "History"); hist.onclick = () => openTermsHistory(tenantId, cfg.tenantName);
    head.appendChild(hist);
    card.appendChild(head);

    // billingStatus (updated via the portals endpoint).
    const statusSel = el("select", "input"); statusSel.classList.add("adm-cadsel");
    [["free", "Free"], ["trial", "Trial"], ["paid", "Paid"], ["exception", "Exception"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if ((cfg.billingStatus || "") === v) o.selected = true; statusSel.appendChild(o); });
    if (!cfg.billingStatus) { const o = el("option", null, "—"); o.value = ""; o.selected = true; statusSel.insertBefore(o, statusSel.firstChild); }
    statusSel.onchange = async () => { try { await App.api(`/api/admin/portals/${encodeURIComponent(tenantId)}`, { method: "PATCH", body: JSON.stringify({ billingStatus: statusSel.value }) }); toast("Billing status updated"); } catch (e) { toast(e.message, true); statusSel.value = cfg.billingStatus || ""; } };

    const flat = checkRow("Flat fee", cfg.hasFlatFee); const flatAmt = numInput(cfg.flatFeeAmount);
    const pass = checkRow("Passthrough (usage cost + markup)", cfg.hasPassthrough); const markup = numInput(cfg.passthroughMarkupPct, "0.1");
    const periodSel = el("select", "input"); periodSel.classList.add("adm-cadsel");
    [["monthly", "Monthly"], ["annual", "Annual"], ["custom", "Custom (days)"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (cfg.billingPeriod === v) o.selected = true; periodSel.appendChild(o); });
    const customDays = numInput(cfg.customPeriodDays, "1"); customDays.step = "1"; customDays.classList.add("adm-w-90");
    const customWrap = field("Custom days", customDays);
    function syncCustom() { customWrap.classList.toggle("u-hidden", periodSel.value !== "custom"); }
    periodSel.onchange = syncCustom;
    const cStart = dateInput(cfg.contractStart), cEnd = dateInput(cfg.contractEnd);
    const curr = el("input", "input"); curr.classList.add("adm-curr"); curr.value = cfg.currency || "USD"; curr.maxLength = 3;

    const row1 = el("div"); row1.classList.add("adm-row1");
    row1.appendChild(field("Billing status", statusSel));
    row1.appendChild(field("Period", periodSel));
    row1.appendChild(customWrap);
    row1.appendChild(field("Currency", curr));
    card.appendChild(row1);

    const row2 = el("div"); row2.classList.add("adm-row1");
    const flatCell = el("div"); flatCell.classList.add("adm-flatcell"); flatCell.appendChild(flat.el); flatCell.appendChild(field("Amount", flatAmt));
    const passCell = el("div"); passCell.classList.add("adm-flatcell"); passCell.appendChild(pass.el); passCell.appendChild(field("Markup %", markup));
    row2.appendChild(flatCell); row2.appendChild(passCell);
    card.appendChild(row2);

    const row3 = el("div"); row3.classList.add("adm-row3");
    row3.appendChild(field("Contract start", cStart)); row3.appendChild(field("Contract end", cEnd));
    card.appendChild(row3);

    syncCustom();
    const save = el("button", "btn btn-primary btn-sm u-mt-14", "Save terms");
    save.onclick = async () => {
      const body = {
        hasFlatFee: flat.cb.checked, flatFeeAmount: Number(flatAmt.value || 0),
        hasPassthrough: pass.cb.checked, passthroughMarkupPct: Number(markup.value || 0),
        billingPeriod: periodSel.value, customPeriodDays: periodSel.value === "custom" ? Number(customDays.value || 0) : null,
        contractStart: cStart.value || null, contractEnd: cEnd.value || null, currency: (curr.value || "USD").toUpperCase(),
      };
      try { await App.api(`/api/admin/billing-config/${encodeURIComponent(tenantId)}`, { method: "PATCH", body: JSON.stringify(body) }); toast("Billing terms saved"); }
      catch (e) { toast(e.message, true); }
    };
    card.appendChild(save);

    // ---- Payments (Stripe) — connection status + billing email + connect button ----
    const sep = el("div"); sep.classList.add("adm-sep"); card.appendChild(sep);
    const sh = el("div"); sh.classList.add("adm-sh");
    sh.appendChild(el("h4", "adm-h4", "Payments (Stripe)"));
    if (cfg.stripeConfigured && cfg.stripeMode === "test") { const t = el("span", null, "TEST"); t.classList.add("adm-minitag", "adm-minitag-warn"); sh.appendChild(t); }
    if (cfg.stripeConfigured && cfg.stripeMode === "live") { const t = el("span", null, "LIVE"); t.classList.add("adm-minitag", "adm-minitag-danger"); sh.appendChild(t); }
    card.appendChild(sh);

    const short = (id) => (id && id.length > 14 ? id.slice(0, 10) + "…" + id.slice(-4) : id);
    const statusLine = el("div"); statusLine.classList.add("adm-statusline");
    function paintStatus(customerId) {
      if (!cfg.stripeConfigured) { statusLine.innerHTML = `<span class="txt-amber">● Stripe not configured</span> <span class="cell-muted">— add STRIPE_SECRET_KEY to enable.</span>`; return; }
      if (customerId) statusLine.innerHTML = `<span class="txt-green">● Connected</span> <span class="cell-muted">${esc(short(customerId))}</span>`;
      else statusLine.innerHTML = `<span class="txt-faint">○ Not connected</span>`;
    }
    paintStatus(cfg.stripeCustomerId);
    card.appendChild(statusLine);

    // Billing email (saved to BillingConfig.billingEmail).
    const emailWrap = el("div"); emailWrap.classList.add("adm-emailwrap");
    const emailInp = el("input", "input"); emailInp.type = "email"; emailInp.placeholder = "billing@portal.com"; emailInp.classList.add("adm-emailinp"); emailInp.value = cfg.billingEmail || "";
    const emailBtn = el("button", "btn btn-ghost btn-sm", "Save email");
    emailBtn.onclick = async () => {
      const v = (emailInp.value || "").trim();
      emailBtn.disabled = true;
      try { await App.api(`/api/admin/billing-config/${encodeURIComponent(tenantId)}`, { method: "PATCH", body: JSON.stringify({ billingEmail: v || null }) }); cfg.billingEmail = v || null; toast("Billing email saved"); }
      catch (e) { toast(e.message, true); }
      finally { emailBtn.disabled = false; }
    };
    emailWrap.appendChild(field("Billing email", emailInp));
    emailWrap.appendChild(emailBtn);
    card.appendChild(emailWrap);

    // Connect button.
    const connect = el("button", "btn btn-ghost btn-sm", "Connect Stripe customer");
    if (!cfg.stripeConfigured) { connect.disabled = true; connect.title = "Stripe not configured"; }
    if (cfg.stripeCustomerId) connect.textContent = "Re-check Stripe customer";
    connect.onclick = async () => {
      connect.disabled = true;
      try {
        const r = await App.api(`/api/admin/tenants/${encodeURIComponent(tenantId)}/stripe-customer`, { method: "POST" });
        cfg.stripeCustomerId = r.customerId; paintStatus(r.customerId);
        connect.textContent = "Re-check Stripe customer";
        toast(r.created ? "Stripe customer created" : "Already connected");
      } catch (e) { toast(e.message, true); }
      finally { connect.disabled = !cfg.stripeConfigured ? true : false; }
    };
    card.appendChild(connect);

    return card;
  }

  function chargeStatusBadge(c) {
    const map = { draft: "#6b7280", approved: "#2563eb", paid: "#16a34a", unpaid: "#dc2626", void: "#9ca3af" };
    const b = el("span", "adm-badge", cap(c.status)); if (map[c.status]) b.style.setProperty("--badge-bg", map[c.status]);
    return b;
  }

  function chargeStatusBadgeHTML(c) {
    const map = { draft: "#6b7280", approved: "#2563eb", paid: "#16a34a", unpaid: "#dc2626", void: "#9ca3af" };
    return `<span class="adm-badge" style="--badge-bg:${map[c.status] || "var(--ink-faint)"}">${esc(cap(c.status))}</span>`;
  }

  // Stripe invoice status pill (+ optional hosted-link). "Not invoiced" when none.
  // Rich lifecycle state (precedence: void > paid > failed > overdue > status). Used for the
  // filterable "State" column + detail pill so Failed/Overdue are distinct from plain unpaid.
  function chargeStateLabel(c) {
    if (c.status === "void") return "Void";
    if (c.isPaid || c.status === "paid") return "Paid";
    if (c.paymentFailed) return "Failed";
    if (c.overdue) return "Overdue";
    if (c.status === "draft") return "Draft";
    if (c.status === "approved") return "Approved";
    return cap(c.status || "");
  }
  function chargeStatePillHTML(c) {
    const label = chargeStateLabel(c);
    const color = { Void: "#9ca3af", Paid: "#16a34a", Failed: "#dc2626", Overdue: "#b45309", Draft: "#6b7280", Approved: "#2563eb", Unpaid: "#dc2626" }[label] || "#6b7280";
    return `<span class="adm-badge" style="--badge-bg:${color}">${esc(label)}</span>`;
  }

  function invoiceStatusHTML(c) {
    if (!c.stripeInvoiceId) return `<span class="cell-muted">Not invoiced</span>`;
    const map = { draft: "#6b7280", open: "#2563eb", paid: "#16a34a", void: "#9ca3af", uncollectible: "#dc2626" };
    const st = c.stripeInvoiceStatus || "open";
    const badge = `<span class="adm-badge" style="--badge-bg:${map[st] || "var(--ink-faint)"}">${esc(cap(st))}</span>`;
    const link = c.stripeInvoiceUrl ? ` <a href="${esc(c.stripeInvoiceUrl)}" target="_blank" rel="noopener" class="link-btn" class="adm-link">payment link</a>` : "";
    return badge + link;
  }

  // Charges table column layout persists per-browser under ONE shared key so it applies to every
  // tenant's charges table (mirrors the Tenants table's admincols pattern).
  const CHARGES_COLS_KEY = "chargescols";
  const loadChargesLayout = () => { try { return JSON.parse(localStorage.getItem(CHARGES_COLS_KEY) || "{}") || {}; } catch (e) { return {}; } };
  const saveChargesLayout = (l) => { try { localStorage.setItem(CHARGES_COLS_KEY, JSON.stringify(l || {})); } catch (e) {} };

  // Operator charge-export columns (master all-tenants + per-tenant). Order + labels match the
  // spec: Tenant, Period start/end, Amount, Currency, Status, Paid, Outstanding, Due, Created,
  // Approved, Paid date, Notes. Reused by the shared export modal (client-safe fields only — no
  // cost/markup/breakdown are ever on the charge objects the hub tables load).
  function chargeExportColumns(withTenant) {
    const cols = [];
    if (withTenant) cols.push({ key: "tenant", label: "Tenant", type: "text", get: (c) => c.tenant || c.tenantName || c.tenantId || "" });
    cols.push(
      { key: "periodStart", label: "Period start", type: "date", get: (c) => c.periodStart, text: (c) => fmtDateOnly(c.periodStart) },
      { key: "periodEnd", label: "Period end", type: "date", get: (c) => c.periodEnd, text: (c) => fmtDateOnly(c.periodEnd) },
      { key: "amount", label: "Amount", type: "number", get: (c) => money2(c.amount) },
      { key: "currency", label: "Currency", type: "text", get: (c) => c.currency || "USD" },
      { key: "state", label: "Status", type: "text", get: (c) => chargeStateLabel(c) },
      { key: "paid", label: "Paid", type: "text", get: (c) => (c.isPaid ? "Yes" : (c.status === "void" ? "—" : "No")) },
      { key: "outstanding", label: "Outstanding", type: "number", get: (c) => money2(c.outstanding) },
      { key: "dueDate", label: "Due date", type: "date", get: (c) => c.dueDate, text: (c) => (c.dueDate ? fmtDateOnly(c.dueDate) : "") },
      { key: "createdAt", label: "Created", type: "date", get: (c) => c.createdAt, text: (c) => (c.createdAt ? fmtDateOnly(c.createdAt) : "") },
      { key: "approvedAt", label: "Approved", type: "date", get: (c) => c.approvedAt, text: (c) => (c.approvedAt ? fmtDateOnly(c.approvedAt) : "") },
      { key: "paidAt", label: "Paid date", type: "date", get: (c) => c.paidAt, text: (c) => (c.paidAt ? fmtDateOnly(c.paidAt) : "") },
      { key: "notes", label: "Notes", type: "text", get: (c) => c.notes || "" },
    );
    return cols;
  }
  // Build export-modal opts for a charges set. `historyBase`/`scope` select master vs per-tenant
  // history; App.api carries the master/admin auth.
  function chargeExportOpts(rows, opts) {
    opts = opts || {};
    return {
      title: "Export charges",
      columns: chargeExportColumns(!!opts.withTenant),
      rows: rows || [],
      dataType: "charge",
      namePlaceholder: opts.namePlaceholder || "e.g. Q2 charges",
      filterLabel: "Which charges to export",
      unitPlural: "Charges",
      sheetName: "Charges",
      countText: (n) => n + " charge" + (n === 1 ? "" : "s"),
      saveHistory: true,
      historyApi: App.api,
      historyBase: opts.historyBase,
      scope: opts.scope || null,
    };
  }

  function chargesLedgerCard(tenantId, tenantName, ledger) {
    const card = el("div", "card"); card.classList.add("adm-card10");
    const head = el("div"); head.classList.add("adm-head6");
    head.appendChild(el("h3", "adm-h3", "Charges"));
    card.appendChild(head);

    const t = ledger.totals || { billed: 0, paid: 0, outstanding: 0 };
    const totals = el("div"); totals.classList.add("adm-totals");
    [["Billed", t.billed], ["Paid", t.paid], ["Outstanding", t.outstanding]].forEach(([l, v]) => { const d = el("div"); d.innerHTML = `<div class="adm-t24">${esc(fmtMoney(v))}</div><div class="cell-muted adm-t25">${l}</div>`; totals.appendChild(d); });
    card.appendChild(totals);

    const charges = ledger.charges || [];
    const byId = {}; charges.forEach((c) => (byId[c.id] = c));
    const period = (c) => `${fmtDateOnly(c.periodStart)} – ${fmtDateOnly(c.periodEnd)}`;

    // Manageable columns (defaults marked below). Created/Approved/Paid date/Notes default OFF.
    const manageable = [
      { key: "period", label: "Period", type: "text", get: (c) => c.periodStart, text: (c) => period(c), render: (c) => esc(period(c)) },
      { key: "amount", label: "Amount", type: "number", get: (c) => c.amount, text: (c) => fmtMoney(c.amount) + " " + (c.currency || ""), render: (c) => esc(fmtMoney(c.amount) + " " + (c.currency || "")) },
      { key: "status", label: "Status", type: "text", get: (c) => c.status, text: (c) => cap(c.status), render: (c) => chargeStatusBadgeHTML(c) },
      { key: "state", label: "State", type: "text", get: (c) => chargeStateLabel(c), text: (c) => chargeStateLabel(c), render: (c) => chargeStatePillHTML(c) },
      { key: "paid", label: "Paid", type: "text", get: (c) => (c.isPaid ? 1 : 0), text: (c) => (c.isPaid ? "Paid" : (c.status === "void" ? "—" : "Unpaid")), render: (c) => (c.isPaid ? "✅" : (c.status === "void" ? "—" : "❌")) },
      { key: "outstanding", label: "Outstanding", type: "number", get: (c) => c.outstanding, text: (c) => fmtMoney(c.outstanding), render: (c) => esc(fmtMoney(c.outstanding)) },
      { key: "due", label: "Due", type: "date", get: (c) => c.dueDate, text: (c) => (c.dueDate ? fmtDateOnly(c.dueDate) : "—"), render: (c) => (c.dueDate ? esc(fmtDateOnly(c.dueDate)) : "—") },
      { key: "created", label: "Created", type: "date", get: (c) => c.createdAt, text: (c) => fmtDateOnly(c.createdAt), render: (c) => esc(fmtDateOnly(c.createdAt)) },
      { key: "approved", label: "Approved", type: "date", get: (c) => c.approvedAt, text: (c) => (c.approvedAt ? fmtDateOnly(c.approvedAt) : "—"), render: (c) => (c.approvedAt ? esc(fmtDateOnly(c.approvedAt)) : "—") },
      { key: "paidDate", label: "Paid date", type: "date", get: (c) => c.paidAt, text: (c) => (c.paidAt ? fmtDateOnly(c.paidAt) : "—"), render: (c) => (c.paidAt ? esc(fmtDateOnly(c.paidAt)) : "—") },
      { key: "notes", label: "Notes", type: "text", get: (c) => c.notes || "", text: (c) => c.notes || "", render: (c) => (c.notes ? esc(c.notes) : `<span class="cell-muted">—</span>`) },
      { key: "invoice", label: "Invoice", type: "text", get: (c) => c.stripeInvoiceStatus || "", text: (c) => (c.stripeInvoiceId ? (c.stripeInvoiceStatus || "open") : "Not invoiced"), render: (c) => invoiceStatusHTML(c) },
    ];
    const defaultKeys = ["period", "amount", "state", "paid", "outstanding", "due"];
    const actionsCol = {
      key: "__act", label: "", type: "text", filterable: false, get: () => "",
      render: (c) => (c.status !== "void" ? `<div class="adm-t26"><button class="btn btn-ghost btn-sm" data-act="pay" data-id="${esc(c.id)}">Payment</button></div>` : ""),
    };

    let layout = loadChargesLayout();
    const applied = () => App.table.applyColumnLayout(manageable, layout, defaultKeys).concat([actionsCol]);

    const tableHost = el("div"); tableHost.className = "table-flush"; card.appendChild(tableHost);
    const handle = App.table.mount({
      container: tableHost, rows: charges, rowId: (c) => c.id, columns: applied(), scrollX: true,
      tableId: "admin-tenant-charges",
      defaultSort: "period", defaultSortDir: "desc",
      onRowClick: (c) => openChargeDetail(tenantId, tenantName, c),
      emptyHtml: `<div class="card cell-muted adm-t14">No charges yet. Click “+ Create charge”.</div>`,
      onRender: () => {
        App.util.$$("button[data-act]", tableHost).forEach((btn) => {
          btn.onclick = (e) => { e.stopPropagation(); const c = byId[btn.dataset.id]; if (!c) return; openPaymentModal(tenantId, tenantName, c); };
        });
      },
    });

    // Toolbar (right group): [Manage columns][+ Create charge][Search] — Manage directly left of Create.
    const create = el("button", "btn btn-primary btn-sm", "+ Create charge");
    create.onclick = () => openChargeModal(tenantId, tenantName, null);
    if (handle.toolbarRight) handle.toolbarRight.insertBefore(create, handle.toolbarRight.firstChild);
    const manageBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#9776;</span> Manage columns`);
    manageBtn.onclick = () => App.table.openColumnManager(manageable, layout, defaultKeys, (nl) => { layout = { order: nl.order, hidden: nl.hidden }; saveChargesLayout(layout); handle.setColumns(applied()); });
    if (handle.toolbarRight) handle.toolbarRight.insertBefore(manageBtn, handle.toolbarRight.firstChild);
    // Export charges (this tenant) — left of Manage columns. Reuses the shared export modal +
    // that tenant's export history (listExports(tenantId)).
    const exportBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8679;</span> Export charges`);
    exportBtn.onclick = () => App.exportModal(chargeExportOpts(handle.getFiltered(), {
      withTenant: false,
      namePlaceholder: `e.g. ${tenantName || "Tenant"} charges`,
      historyBase: `/api/admin/exports/tenant/${encodeURIComponent(tenantId)}`,
    }));
    if (handle.toolbarRight) handle.toolbarRight.insertBefore(exportBtn, manageBtn);

    return card;
  }

  function refreshBilling(tenantId, tenantName) {
    const host = document.querySelector(`[data-billing-host="${tenantId}"]`);
    if (host) renderTenantBillingInto(host, tenantId, tenantName);
  }

  function money2(v) { const n = Number(v || 0); return Math.round(n * 100) / 100; }

  function openChargeModal(tenantId, tenantName, existing, onSaved, opts) {
    opts = opts || {};
    const tenants = opts.tenants || null; // when provided: required Tenant picker (central create)
    const hideSuggest = !!opts.hideSuggest || !!tenants;
    const inner = el("div");
    const today = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
    const d0 = existing ? String(existing.periodStart).slice(0, 10) : iso(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    const d1 = existing ? String(existing.periodEnd).slice(0, 10) : iso(new Date(today.getFullYear(), today.getMonth(), 0));
    const tenantPickerHTML = tenants ? `<label class="field-label">Tenant</label><select id="c-tenant" class="input"><option value="">— Select a portal —</option>${tenants.map((t) => `<option value="${esc(t.id)}">${esc(t.name || t.id)}</option>`).join("")}</select>` : "";
    // M3: material fields (amount/period) are locked once a charge leaves draft — it may be tied
    // to a finalized Stripe invoice. Void + re-create to bill a different amount.
    const locked = !!existing && existing.status !== "draft";
    const dis = locked ? "disabled" : "";
    inner.innerHTML = `<div class="modal-head"><h2>${existing ? "Edit charge" : "Create charge"}</h2><button class="icon-btn" id="c-close">&times;</button></div>
      <div class="modal-body">
        ${tenantPickerHTML}
        ${locked ? `<div class="cell-muted" class="adm-note-warn">This charge is <b>${esc(existing.status)}</b>, so the amount and period are locked. To bill a different amount, void this charge and create a new one. You can still edit the note and due date.</div>` : ""}
        <div class="adm-t27">
          <div class="adm-t28"><label class="field-label">Period start</label><input id="c-start" class="input" type="date" value="${d0}" ${dis}></div>
          <div class="adm-t28"><label class="field-label">Period end</label><input id="c-end" class="input" type="date" value="${d1}" ${dis}></div>
        </div>
        ${hideSuggest ? "" : `<div class="adm-t29"><button id="c-suggest" class="btn btn-ghost btn-sm">✨ Suggest amount from terms</button> <span id="c-sugnote" class="cell-muted adm-t25"></span></div>`}
        <label class="field-label">Amount</label><input id="c-amount" class="input" type="number" step="0.01" min="0" value="${existing ? money2(existing.amount) : ""}" placeholder="0.00" ${dis}>
        <label class="field-label">Due date (optional)</label><input id="c-due" class="input" type="date" value="${existing && existing.dueDate ? String(existing.dueDate).slice(0, 10) : ""}">
        <label class="field-label">Notes</label><input id="c-notes" class="input" value="${existing ? esc(existing.notes || "") : ""}" placeholder="optional">
        <div id="c-breakdown" class="cell-muted adm-t30"></div>
        <button id="c-save" class="btn btn-primary btn-block">${existing ? "Save changes" : "Save as draft"}</button>
      </div>`;
    const overlay = modal(inner); const $ = (s) => inner.querySelector(s);
    let breakdown = existing ? existing.breakdown : null;
    $("#c-close").onclick = () => overlay.remove();
    function showBreakdown(b) { if (!b) { $("#c-breakdown").innerHTML = ""; return; } const us = b.usageSnapshot || {}; $("#c-breakdown").innerHTML = `Flat ${esc(fmtMoney(b.flatFee))} + passthrough ${esc(fmtMoney(b.passthroughBaseCost))}×(1+${esc(String(b.markupPct))}%) = ${esc(fmtMoney(b.passthroughAmount))}. Usage: ${us.calls || 0} calls, ${us.minutes || 0} min, ${us.tokens || 0} tokens, ${us.emails || 0} emails.`; }
    showBreakdown(breakdown);
    if ($("#c-suggest")) $("#c-suggest").onclick = async () => {
      $("#c-sugnote").textContent = "Computing…";
      try { const s = await App.api(`/api/admin/charges/suggest/${encodeURIComponent(tenantId)}`, { method: "POST", body: JSON.stringify({ periodStart: $("#c-start").value, periodEnd: $("#c-end").value }) }); $("#c-amount").value = money2(s.amount); breakdown = s.breakdown; showBreakdown(breakdown); $("#c-sugnote").textContent = "Suggested — adjust if needed."; }
      catch (e) { $("#c-sugnote").textContent = ""; toast(e.message, true); }
    };
    $("#c-save").onclick = async () => {
      const targetTenant = tenants ? ($("#c-tenant") && $("#c-tenant").value) : tenantId;
      if (tenants && !targetTenant) { toast("Please select a tenant", true); return; }
      // On a locked (non-draft) charge only benign fields go up — the server rejects material
      // fields on non-draft charges, so sending them (even unchanged) would 400.
      const body = locked
        ? { dueDate: $("#c-due").value || null, notes: $("#c-notes").value || null }
        : { periodStart: $("#c-start").value, periodEnd: $("#c-end").value, amount: Number($("#c-amount").value || 0), breakdown: breakdown || {}, dueDate: $("#c-due").value || null, notes: $("#c-notes").value || null };
      try {
        if (existing) await App.api(`/api/admin/charges/${encodeURIComponent(existing.id)}`, { method: "PATCH", body: JSON.stringify(body) });
        else await App.api(`/api/admin/charges/tenant/${encodeURIComponent(targetTenant)}`, { method: "POST", body: JSON.stringify(body) });
        overlay.remove(); toast(existing ? "Charge updated" : "Charge created"); if (onSaved) onSaved(); else refreshBilling(tenantId, tenantName);
      } catch (e) { toast(e.message, true); }
    };
  }

  function openPaymentModal(tenantId, tenantName, charge, onSaved) {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Record payment</h2><button class="icon-btn" id="p-close">&times;</button></div>
      <div class="modal-body">
        <div class="cell-muted adm-t31">Outstanding: ${esc(fmtMoney(charge.outstanding))} of ${esc(fmtMoney(charge.amount))}</div>
        <label class="field-label">Amount</label><input id="p-amount" class="input" type="number" step="0.01" min="0" value="${money2(charge.outstanding || charge.amount)}">
        <label class="field-label">Paid on</label><input id="p-date" class="input" type="date" value="${new Date().toISOString().slice(0, 10)}">
        <label class="field-label">Method (optional)</label><input id="p-method" class="input" placeholder="card / check / wire">
        <label class="field-label">Notes</label><input id="p-notes" class="input" placeholder="optional">
        <button id="p-save" class="btn btn-primary btn-block">Record payment</button>
      </div>`;
    const overlay = modal(inner); const $ = (s) => inner.querySelector(s);
    $("#p-close").onclick = () => overlay.remove();
    $("#p-save").onclick = async () => {
      try { await App.api(`/api/admin/charges/${encodeURIComponent(charge.id)}/payments`, { method: "POST", body: JSON.stringify({ amount: Number($("#p-amount").value || 0), paidAt: $("#p-date").value || undefined, method: $("#p-method").value || null, notes: $("#p-notes").value || null }) }); overlay.remove(); toast("Payment recorded"); if (onSaved) onSaved(); else refreshBilling(tenantId, tenantName); }
      catch (e) { toast(e.message, true); }
    };
  }

  // Action icon/color + label for an audit action.
  function auditDot(action) {
    const map = { charge_created: "#6b7280", charge_updated: "#d97706", status_changed: "#7c3aed", charge_approved: "#2563eb", charge_voided: "#9ca3af", payment_recorded: "#16a34a", terms_updated: "#0ea5e9", invoice_created: "#0ea5e9", invoice_sent: "#0ea5e9", invoice_paid: "#16a34a", payment_failed: "#dc2626", invoice_voided: "#9ca3af", invoice_uncollectible: "#dc2626" };
    return map[action] || "#6b7280";
  }
  function auditActionLabel(action) {
    const map = { charge_created: "Created", charge_updated: "Edited", status_changed: "Status changed", charge_approved: "Approved", charge_voided: "Voided", payment_recorded: "Payment recorded", terms_updated: "Terms updated", invoice_created: "Invoice created", invoice_sent: "Invoice sent", invoice_paid: "Invoice paid", payment_failed: "Payment failed", invoice_voided: "Invoice voided", invoice_uncollectible: "Invoice uncollectible" };
    return map[action] || action;
  }

  // Approve a charge behind a password-confirmation gate. Used everywhere approve is possible
  // (per-tenant detail modal + central Charges tab). The server re-verifies the password.
  function confirmApprove(chargeId, onDone) {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Confirm approval</h2><button class="icon-btn" id="ca-close">&times;</button></div>
      <div class="modal-body">
        <p class="cell-muted adm-t32">Approving finalizes this charge as owed. Enter your password to confirm.</p>
        <label class="field-label">Your password</label>
        <input id="ca-pw" class="input" type="password" autocomplete="current-password" placeholder="Password">
        <div id="ca-err" class="adm-form-err u-hidden"></div>
        <div class="adm-t33">
          <button id="ca-ok" class="btn btn-primary btn-sm">Confirm &amp; approve</button>
          <button id="ca-cancel" class="btn btn-ghost btn-sm">Cancel</button>
        </div>
      </div>`;
    const overlay = modal(inner); const $ = (s) => inner.querySelector(s);
    const close = () => overlay.remove();
    $("#ca-close").onclick = close; $("#ca-cancel").onclick = close;
    const pw = $("#ca-pw"); setTimeout(() => pw.focus(), 30);
    async function submit() {
      const password = pw.value;
      if (!password) { $("#ca-err").classList.remove("u-hidden"); $("#ca-err").textContent = "Enter your password."; return; }
      $("#ca-ok").disabled = true; $("#ca-err").classList.add("u-hidden");
      try {
        await App.api(`/api/admin/charges/${encodeURIComponent(chargeId)}/approve`, { method: "POST", body: JSON.stringify({ password }) });
        toast("Charge approved"); close(); if (onDone) onDone();
      } catch (e) {
        $("#ca-ok").disabled = false; $("#ca-err").classList.remove("u-hidden");
        $("#ca-err").textContent = /confirmation failed|password/i.test(e.message || "") ? "Incorrect password — approval blocked." : (e.message || "Approval failed");
        pw.select();
      }
    }
    $("#ca-ok").onclick = submit;
    pw.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
  }

  function openChargeDetail(tenantId, tenantName, chargeInit, onChange) {
    const inner = el("div");
    const overlay = modal(inner);
    const chargeId = chargeInit.id;

    // Build timeline events from the audit log; fall back to charge fields for pre-audit charges.
    function buildEvents(charge, audit) {
      if (audit && audit.length) {
        return audit.map((a) => ({
          t: a.createdAt, dot: auditDot(a.action),
          label: auditActionLabel(a.action),
          who: a.actorName || "Unknown",
          sub: a.note || "",
        }));
      }
      // Fallback: synthesize created/approved/payments from the charge object.
      const events = [];
      events.push({ t: charge.createdAt, dot: "#6b7280", label: "Created", who: "", sub: `${fmtMoney(charge.amount)} ${charge.currency || ""} charge created` });
      if (charge.approvedAt) events.push({ t: charge.approvedAt, dot: "#2563eb", label: "Approved", who: "", sub: "Charge finalized — awaiting payment" });
      const paysAsc = (charge.payments || []).slice().sort((a, b2) => new Date(a.paidAt).getTime() - new Date(b2.paidAt).getTime());
      let running = 0;
      paysAsc.forEach((p) => {
        running = Math.round((running + p.amount) * 100) / 100;
        const out = Math.max(0, Math.round((charge.amount - running) * 100) / 100);
        const bits = []; if (p.method) bits.push(esc(p.method)); bits.push(`paid ${esc(fmtMoney(running))}`); bits.push(`outstanding ${esc(fmtMoney(out))}`); if (p.notes) bits.push(esc(p.notes));
        events.push({ t: p.paidAt, dot: out <= 0 ? "#16a34a" : "#0ea5e9", label: `Payment ${fmtMoney(p.amount)}`, who: "", sub: bits.join(" · ") });
      });
      return events;
    }

    function render(charge, audit, sstatus) {
      const b = charge.breakdown || {}; const us = b.usageSnapshot || {};
      const STATUSES = ["draft", "approved", "paid", "unpaid", "void"];
      const stripeOn = !!(sstatus && sstatus.configured);
      const events = buildEvents(charge, audit);
      const timelineHTML = events.map((e) => `
        <div class="adm-t22">
          <span class="adm-dot" style="--dot:${e.dot}"></span>
          <div class="u-flex-1">
            <div class="adm-t23">${esc(e.label)} <span class="cell-muted adm-t34">· ${esc(e.t ? fmtDate(e.t) : "—")}${e.who ? " · " + esc(e.who) : ""}</span></div>
            ${e.sub ? `<div class="cell-muted u-meta">${esc(e.sub)}</div>` : ""}
          </div>
        </div>`).join("") || `<div class="cell-muted adm-t20">No activity yet.</div>`;

      inner.innerHTML = `<div class="modal-head"><h2>Charge detail</h2><button class="icon-btn" id="d-close">&times;</button></div>
        <div class="modal-body">
          <div class="adm-t35"><b>${esc(fmtDateOnly(charge.periodStart))} – ${esc(fmtDateOnly(charge.periodEnd))}</b> · ${esc(fmtMoney(charge.amount))} ${esc(charge.currency || "")} · ${chargeStatusBadgeHTML(charge)}${(charge.paymentFailed || charge.overdue) ? " " + chargeStatePillHTML(charge) : ""}</div>
          <div class="cell-muted adm-t36">Breakdown — flat ${esc(fmtMoney(b.flatFee || 0))}, passthrough base ${esc(fmtMoney(b.passthroughBaseCost || 0))} × (1 + ${esc(String(b.markupPct || 0))}%) = ${esc(fmtMoney(b.passthroughAmount || 0))}.<br>Usage snapshot: ${us.calls || 0} calls · ${us.minutes || 0} min · ${us.tokens || 0} tokens · ${us.emails || 0} emails.</div>
          ${charge.dueDate ? `<div class="cell-muted adm-t20">Due ${esc(fmtDateOnly(charge.dueDate))}</div>` : ""}
          ${charge.notes ? `<div class="adm-t37">Notes: ${esc(charge.notes)}</div>` : ""}
          <label class="field-label adm-t6">Timeline</label>
          <div class="adm-t38">${timelineHTML}</div>
          <div class="cell-muted adm-t31">${esc(fmtMoney(charge.paidTotal))} paid · ${esc(fmtMoney(charge.outstanding))} outstanding${charge.paidAt ? ` · fully paid ${esc(fmtDateOnly(charge.paidAt))}` : ""}</div>
          <label class="field-label">Status</label>
          <select id="d-status" class="input adm-t39">${STATUSES.map((s) => `<option value="${s}"${charge.status === s ? " selected" : ""}>${cap(s)}</option>`).join("")}</select>
          <div class="adm-t40">
            ${charge.status === "draft" ? `<button id="d-approve" class="btn btn-primary btn-sm">Approve</button>` : ""}
            <button id="d-edit" class="btn btn-ghost btn-sm">Edit</button>
            <button id="d-pay" class="btn btn-ghost btn-sm">Record payment</button>
            ${(!charge.isPaid && charge.status !== "draft" && charge.status !== "void") ? `<button id="d-markpaid" class="btn btn-ghost btn-sm">Mark paid manually</button>` : ""}
            <button id="d-void" class="btn btn-ghost btn-sm" class="txt-danger">Void</button>
          </div>
          <div class="adm-t41"></div>
          <label class="field-label">Invoice (Stripe)</label>
          ${!stripeOn ? `<div class="cell-muted adm-t20">Stripe not connected — configure Stripe to invoice this charge.</div>`
            : (charge.status === "draft" ? `<div class="cell-muted adm-t20">Approve the charge to create its invoice.</div>`
            : `<div class="adm-t42">${invoiceStatusHTML(charge)}</div>
               <div class="adm-t43">
                 ${charge.stripeInvoiceUrl ? `<button id="d-copylink" class="btn btn-ghost btn-sm">Copy payment link</button><button id="d-openlink" class="btn btn-ghost btn-sm">Open</button>` : ""}
                 ${(!charge.stripeInvoiceId || charge.stripeInvoiceStatus === "void") ? `<button id="d-invoice" class="btn btn-primary btn-sm">Create invoice</button>` : `<button id="d-invoice" class="btn btn-ghost btn-sm">Retry invoice</button>`}
                 ${charge.stripeInvoiceId ? `<button id="d-send" class="btn btn-ghost btn-sm">Send to customer</button>` : ""}
               </div>`)}
        </div>`;
      const $ = (s) => inner.querySelector(s);
      $("#d-close").onclick = () => overlay.remove();
      if (charge.status === "draft" && $("#d-approve")) $("#d-approve").onclick = () => confirmApprove(charge.id, reload);
      $("#d-status").onchange = async () => { try { await App.api(`/api/admin/charges/${encodeURIComponent(charge.id)}/status`, { method: "POST", body: JSON.stringify({ status: $("#d-status").value }) }); toast("Status updated"); await reload(); } catch (e) { toast(e.message, true); } };
      $("#d-edit").onclick = () => openChargeModal(tenantId, tenantName, charge, reload); // stacked; detail reloads on save
      $("#d-pay").onclick = () => openPaymentModal(tenantId, tenantName, charge, reload);
      $("#d-void").onclick = async () => { if (!(await App.ui.confirmModal({ title: "Void charge", message: "Void this charge? It will be excluded from billed/outstanding totals.", confirmText: "Void charge" }))) return; try { await App.api(`/api/admin/charges/${encodeURIComponent(charge.id)}/void`, { method: "POST" }); toast("Charge voided"); await reload(); } catch (e) { toast(e.message, true); } };
      if ($("#d-markpaid")) $("#d-markpaid").onclick = async () => { if (!(await App.ui.confirmModal({ title: "Mark paid manually", message: "Record the outstanding balance as paid (e.g. the customer paid outside Stripe)? This can't be undone from here.", confirmText: "Mark paid" }))) return; const btn = $("#d-markpaid"); btn.disabled = true; try { await App.api(`/api/admin/charges/${encodeURIComponent(charge.id)}/mark-paid`, { method: "POST" }); toast("Charge marked paid"); await reload(); } catch (e) { toast(e.message, true); btn.disabled = false; } };
      if ($("#d-copylink")) $("#d-copylink").onclick = async () => { try { await navigator.clipboard.writeText(charge.stripeInvoiceUrl); toast("Payment link copied"); } catch (e) { window.prompt("Copy the payment link:", charge.stripeInvoiceUrl); } };
      if ($("#d-openlink")) $("#d-openlink").onclick = () => window.open(charge.stripeInvoiceUrl, "_blank", "noopener");
      if ($("#d-invoice")) $("#d-invoice").onclick = async () => { const btn = $("#d-invoice"); btn.disabled = true; try { const r = await App.api(`/api/admin/charges/${encodeURIComponent(charge.id)}/invoice`, { method: "POST" }); toast(r && r.created === false ? "Invoice already exists" : "Invoice created"); await reload(); } catch (e) { toast(e.message, true); btn.disabled = false; } };
      if ($("#d-send")) $("#d-send").onclick = async () => { if (!(await App.ui.confirmModal({ title: "Send invoice", message: "Email this invoice to the customer via Stripe?", confirmText: "Send invoice" }))) return; const btn = $("#d-send"); btn.disabled = true; try { await App.api(`/api/admin/charges/${encodeURIComponent(charge.id)}/invoice/send`, { method: "POST" }); toast("Invoice sent to customer"); await reload(); } catch (e) { toast(e.message, true); btn.disabled = false; } };
    }

    // Re-fetch the charge + its audit and re-render in place, then refresh the ledger behind.
    async function reload() {
      try {
        const [charge, audit, sstatus] = await Promise.all([
          App.api(`/api/admin/charges/${encodeURIComponent(chargeId)}`),
          App.api(`/api/admin/charges/${encodeURIComponent(chargeId)}/audit`).catch(() => []),
          App.api(`/api/admin/stripe/status`).catch(() => ({ configured: false })),
        ]);
        render(charge, audit || [], sstatus || { configured: false });
      } catch (e) { toast((e && e.message) || "Failed to refresh", true); }
      refreshBilling(tenantId, tenantName);
      if (onChange) onChange();
    }

    render(chargeInit, null, { configured: false }); // instant paint from the row data
    reload();                 // then load full audit + freshest charge + stripe status
  }

  // ---- Central "Charges" tab: every charge across all portals in one App.table. Its column
  // layout + saved filters are INDEPENDENT of the per-tenant charges table (separate keys). ----
  const CENTRAL_CHARGES_COLS_KEY = "central-charges-cols";
  const loadCentralChargesLayout = () => { try { return JSON.parse(localStorage.getItem(CENTRAL_CHARGES_COLS_KEY) || "{}") || {}; } catch (e) { return {}; } };
  const saveCentralChargesLayout = (l) => { try { localStorage.setItem(CENTRAL_CHARGES_COLS_KEY, JSON.stringify(l || {})); } catch (e) {} };

  async function renderCentralCharges(host) {
    host.innerHTML = `<div class="cell-muted u-pad-8">Loading charges…</div>`;
    let layout = loadCentralChargesLayout();
    const period = (c) => `${fmtDateOnly(c.periodStart)} – ${fmtDateOnly(c.periodEnd)}`;

    const manageable = [
      { key: "tenant", label: "Portal", type: "text", get: (c) => c.tenant, text: (c) => c.tenant, render: (c) => esc(c.tenant || "—") },
      { key: "period", label: "Period", type: "text", get: (c) => c.periodStart, text: (c) => period(c), render: (c) => esc(period(c)) },
      { key: "amount", label: "Amount", type: "number", get: (c) => c.amount, text: (c) => fmtMoney(c.amount), render: (c) => esc(fmtMoney(c.amount)) },
      { key: "currency", label: "Currency", type: "text", get: (c) => c.currency, text: (c) => c.currency || "", render: (c) => esc(c.currency || "—") },
      { key: "status", label: "Status", type: "text", get: (c) => c.status, text: (c) => cap(c.status), render: (c) => chargeStatusBadgeHTML(c) },
      { key: "state", label: "State", type: "text", get: (c) => chargeStateLabel(c), text: (c) => chargeStateLabel(c), render: (c) => chargeStatePillHTML(c) },
      { key: "paid", label: "Paid", type: "number", get: (c) => c.paidTotal, text: (c) => fmtMoney(c.paidTotal), render: (c) => esc(fmtMoney(c.paidTotal)) },
      { key: "outstanding", label: "Outstanding", type: "number", get: (c) => c.outstanding, text: (c) => fmtMoney(c.outstanding), render: (c) => esc(fmtMoney(c.outstanding)) },
      { key: "due", label: "Due", type: "date", get: (c) => c.dueDate, text: (c) => (c.dueDate ? fmtDateOnly(c.dueDate) : "—"), render: (c) => (c.dueDate ? esc(fmtDateOnly(c.dueDate)) : "—") },
      { key: "created", label: "Created", type: "date", get: (c) => c.createdAt, text: (c) => fmtDateOnly(c.createdAt), render: (c) => esc(fmtDateOnly(c.createdAt)) },
      { key: "approved", label: "Approved", type: "date", get: (c) => c.approvedAt, text: (c) => (c.approvedAt ? fmtDateOnly(c.approvedAt) : "—"), render: (c) => (c.approvedAt ? esc(fmtDateOnly(c.approvedAt)) : "—") },
      { key: "paidDate", label: "Paid date", type: "date", get: (c) => c.paidAt, text: (c) => (c.paidAt ? fmtDateOnly(c.paidAt) : "—"), render: (c) => (c.paidAt ? esc(fmtDateOnly(c.paidAt)) : "—") },
      { key: "notes", label: "Notes", type: "text", get: (c) => c.notes || "", text: (c) => c.notes || "", render: (c) => (c.notes ? esc(c.notes) : `<span class="cell-muted">—</span>`) },
      { key: "invoice", label: "Invoice", type: "text", get: (c) => c.stripeInvoiceStatus || "", text: (c) => (c.stripeInvoiceId ? (c.stripeInvoiceStatus || "open") : "Not invoiced"), render: (c) => invoiceStatusHTML(c) },
    ];
    const defaultKeys = ["tenant", "period", "amount", "state", "paid", "outstanding", "due", "created"];
    const actionsCol = {
      key: "__act", label: "", type: "text", filterable: false, get: () => "",
      render: (c) => `<div class="adm-t26">${c.status === "draft" ? `<button class="btn btn-ghost btn-sm" data-act="approve" data-id="${esc(c.id)}">Approve</button>` : ""}${c.status !== "void" ? `<button class="btn btn-ghost btn-sm" data-act="pay" data-id="${esc(c.id)}">Payment</button><button class="btn btn-ghost btn-sm" data-act="void" data-id="${esc(c.id)}" class="txt-danger">Void</button>` : ""}</div>`,
    };
    const applied = () => App.table.applyColumnLayout(manageable, layout, defaultKeys).concat([actionsCol]);

    let handle = null;
    async function load() {
      const prev = handle ? handle.getState() : null;
      let data;
      try { data = await App.api("/api/admin/charges/all"); }
      catch (e) { host.innerHTML = `<div class="card cell-muted adm-t14">${esc(e.message)}</div>`; return; }
      const charges = data.charges || [];
      const byId = {}; charges.forEach((c) => (byId[c.id] = c));
      host.innerHTML = "";
      handle = App.table.mount({
        container: host, rows: charges, rowId: (c) => c.id, columns: applied(), scrollX: true,
        tableId: "admin-central-charges",
        defaultSort: "created", defaultSortDir: "desc",
        onRowClick: (c) => openChargeDetail(c.tenantId, c.tenant, c, load),
        emptyHtml: `<div class="card cell-muted adm-t14">No charges yet.</div>`,
        onRender: () => {
          App.util.$$("button[data-act]", host).forEach((btn) => {
            btn.onclick = async (e) => {
              e.stopPropagation();
              const c = byId[btn.dataset.id]; if (!c) return;
              if (btn.dataset.act === "approve") { confirmApprove(c.id, load); return; }
              if (btn.dataset.act === "pay") { openPaymentModal(c.tenantId, c.tenant, c, load); return; }
              if (btn.dataset.act === "void") {
                if (!(await App.ui.confirmModal({ title: "Void charge", message: `Void this ${fmtMoney(c.amount)} charge for ${c.tenant}? It will be excluded from billed/outstanding totals.`, confirmText: "Void charge" }))) return;
                try { await App.api(`/api/admin/charges/${encodeURIComponent(c.id)}/void`, { method: "POST" }); toast("Charge voided"); load(); } catch (err) { toast(err.message, true); }
              }
            };
          });
        },
      });
      // Saved filters (own view key) + Manage columns (own localStorage key) — both independent
      // of the per-tenant charges table. Order in the right group: [Manage columns][Search].
      mountAdminSavedFilters(handle, "admin-central-charges");
      const manageBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#9776;</span> Manage columns`);
      manageBtn.onclick = () => App.table.openColumnManager(manageable, layout, defaultKeys, (nl) => { layout = { order: nl.order, hidden: nl.hidden }; saveCentralChargesLayout(layout); handle.setColumns(applied()); });
      if (handle.toolbarRight) handle.toolbarRight.insertBefore(manageBtn, handle.toolbarRight.firstChild);
      // + Create charge — to the LEFT of Manage columns. Opens the shared modal with a required
      // tenant picker and no "suggest from terms" (not applicable centrally).
      const createBtn = el("button", "btn btn-primary btn-sm", "+ Create charge");
      createBtn.onclick = async () => {
        let tenants = [];
        try { tenants = (await App.api("/api/admin/portals")) || []; } catch (e) { toast(e.message, true); return; }
        const list = tenants.map((t) => ({ id: t.id, name: t.name })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        openChargeModal(null, null, null, load, { tenants: list, hideSuggest: true });
      };
      if (handle.toolbarRight) handle.toolbarRight.insertBefore(createBtn, manageBtn);
      // Export charges (all tenants) — added to the toolbar; Create + Manage sit to its left.
      // Exports the currently-filtered rows via the shared modal + master export history.
      const exportBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8679;</span> Export charges`);
      exportBtn.onclick = () => App.exportModal(chargeExportOpts(handle.getFiltered(), {
        withTenant: true,
        namePlaceholder: "e.g. All charges — Q2",
        historyBase: "/api/admin/exports",
        scope: "all",
      }));
      const searchInput = handle.toolbarRight.querySelector(".search-input");
      if (handle.toolbarRight) handle.toolbarRight.insertBefore(exportBtn, searchInput);
      if (prev) handle.applyState(prev); // preserve active sort/filter/search across a live reload
    }
    await load();
  }

  // ---- Macro Billing & Usage page: Overview (editable dashboards) / Billing Rates ----
  async function renderUsageBilling() {
    view().innerHTML = "";
    const wrap = el("div", "fade-in");
    view().appendChild(wrap);
    // Header block: heading + Stripe mode pill share ONE container so their left edges are the
    // same origin (no reliance on default h1 margins). h1 gets a fixed bottom margin for the
    // gap; the pill sits flush-left directly beneath it.
    const head = el("div"); head.classList.add("adm-head7");
    const h1 = el("h1", "page-title", "Billing & Usage"); h1.classList.add("adm-h1");
    head.appendChild(h1);
    wrap.appendChild(head);
    // Stripe mode badge (TEST/LIVE) so the operator always knows if real money is in play.
    (async () => {
      try {
        const st = await App.api("/api/admin/stripe/status");
        if (!st || !st.configured) return;
        const badge = el("span");
        const live = st.mode === "live";
        badge.textContent = live ? "Stripe: LIVE mode" : "Stripe: TEST mode";
        // Block + fit-content + zero left margin => the pill's left edge sits exactly under the
        // heading text's left edge (same container content-left).
        badge.className = "adm-mode-pill" + (live ? " live" : "");
        badge.title = live ? "Live keys — real charges and payments." : "Test keys — no real money moves.";
        head.appendChild(badge);
      } catch (e) { /* ignore */ }
    })();

    const tabsBar = el("div", "tabs");
    const bodyEl = el("div", "tab-body");
    const TABS = [["overview", "Overview"], ["charges", "Charges"], ["rates", "Billing Rates"]];
    let active = "overview";
    const charts = [];
    function destroyCharts() { charts.forEach((c) => { try { c.destroy(); } catch (e) {} }); charts.length = 0; }

    async function paint() {
      destroyCharts();
      bodyEl.innerHTML = "";
      Array.from(tabsBar.children).forEach((b) => b.classList.toggle("active", b.dataset.k === active));
      if (active === "rates") { await billingRatesInto(bodyEl); return; }
      if (active === "charges") { const host = el("div"); bodyEl.appendChild(host); await renderCentralCharges(host); return; }

      if (active === "overview") {
        // Editable macro dashboard (scope "macro"), all-tenants data.
        const host = el("div"); bodyEl.appendChild(host);
        await renderBillingDashboards(host, {
          context: "macro",
          load: async (from, to) => {
            const d = await App.api(`/api/admin/usage/rows?bucket=day&from=${from}&to=${to}`);
            return d.rows || [];
          },
        });
        return;
      }
    }

    TABS.forEach(([k, label]) => {
      const b = el("button", "tab" + (k === active ? " active" : ""), label); b.dataset.k = k;
      b.onclick = () => { if (active === k) return; active = k; paint(); };
      tabsBar.appendChild(b);
    });
    wrap.appendChild(tabsBar); wrap.appendChild(bodyEl);
    await paint();
  }

  App.admin = { render };
})(typeof window !== "undefined" ? window : globalThis);
