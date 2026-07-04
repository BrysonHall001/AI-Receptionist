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
    if (v === "email") return renderEmail();
    if (v === "usage") return renderUsageBilling();
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
      card.style.cssText = "padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:8px";

      // Header: prominent NAME (no initials badge) + the Open-tenant arrow (same markup).
      const head = el("div");
      head.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:10px";
      const title = el("div");
      title.style.cssText = "font-weight:700;font-size:15px;min-width:0;overflow:hidden;text-overflow:ellipsis";
      if (shows("name")) title.textContent = p.name;
      head.appendChild(title);
      if (shows("actions")) {
        const openWrap = el("div");
        openWrap.innerHTML = `<button class="btn btn-primary btn-sm t-openbtn" data-act="open" data-id="${esc(p.id)}" title="Open tenant" aria-label="Open tenant" style="padding:4px 9px;line-height:1;min-width:0;font-size:14px">\u2197</button>`;
        head.appendChild(openWrap);
      }
      card.appendChild(head);

      if (shows("status")) { const s = el("div"); s.innerHTML = statusBadge(p.status); card.appendChild(s); }

      if (shows("ai")) {
        const aiWrap = el("div");
        aiWrap.style.cssText = "display:flex;flex-direction:column;gap:3px";
        const lbl = el("span", "cell-muted", "AI Receptionist"); lbl.style.fontSize = "11.5px";
        aiWrap.appendChild(lbl);
        const selWrap = el("div");
        selWrap.innerHTML = `<select class="input portal-recep-sel t-voice" data-id="${esc(p.id)}">${voiceOptionsHtml(voiceModeOf(p))}</select>`;
        aiWrap.appendChild(selWrap);
        card.appendChild(aiWrap);
      }

      const stats = el("div");
      stats.style.cssText = "display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px";
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
        none.style.cssText = "padding:24px;grid-column:1/-1;text-align:center";
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
    panelGrid.style.display = "none";
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
    caption.style.cssText = "font-size:12.5px;margin:4px 0 10px 18px";
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
      if (tableBody) tableBody.style.display = isPanel ? "none" : "";
      if (panelGrid) panelGrid.style.display = isPanel ? "" : "none";
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

      // Per-tenant Billing & Usage drill-in (KPIs + charts + editable billing status above).
      const usageHost = el("div"); usageHost.style.marginTop = "26px";
      usageHost.innerHTML = `<h2 class="settings-h">Billing &amp; Usage</h2><div class="cell-muted" style="padding:6px">Loading usage…</div>`;
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
      <p class="cell-muted" style="font-size:12.5px;margin:8px 0 0">Notify email is optional — it's where call summaries and notifications go.</p>
      <label class="field-label" style="margin-top:12px">Billing status *</label>
      <select id="sp-billing" class="input">
        <option value="">Select a billing status…</option>
        <option value="free">Free</option>
        <option value="trial">Trial</option>
        <option value="paid">Paid</option>
        <option value="exception">Exception</option>
      </select>
      <p class="cell-muted" style="font-size:12.5px;margin:8px 0 0">Required — pick how this tenant is billed. You can change it later from the tenant's detail panel.</p>`;
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
        portal = await App.api("/api/admin/portals", { method: "POST", body: JSON.stringify({ name, notifyEmail, lockedPages: draft.lockedPages, billingStatus }) });
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
  async function renderEmail() {
    loading();
    let rows;
    try { rows = await App.api("/api/admin/email-logs"); }
    catch (e) { view().innerHTML = `<div class="card cell-muted" style="padding:18px">${esc(e.message)}</div>`; return; }
    if (!Array.isArray(rows)) rows = [];

    view().innerHTML = "";
    const wrap = el("div", "fade-in");
    view().appendChild(wrap);
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
    const empty = `<div class="card cell-muted" style="padding:18px">No emails sent yet.</div>`;
    App.table.mount({
      container: host, columns, rows,
      rowId: (r) => r.groupKey,
      scrollX: true,
      defaultSort: "date", defaultSortDir: "desc",
      onRowClick: (r) => renderEmailRecipients(r),
      emptyHtml: empty, pageSize: 50,
    });

    const caption = el("p", "cell-muted");
    caption.style.cssText = "font-size:12.5px;margin:4px 0 10px 18px";
    caption.textContent = "Every email send across all tenants (one row per send). Click a send to see its recipients and delivery status.";
    const tbEl = host.querySelector(".table-toolbar");
    if (tbEl) tbEl.insertAdjacentElement("afterend", caption); else host.insertBefore(caption, host.firstChild);
  }

  // LEVEL 2 — the recipient list for ONE send. Always shown (even for a single-recipient
  // send, which renders a one-row list). Click a recipient -> full detail (Level 3).
  async function renderEmailRecipients(group) {
    loading();
    let rows;
    try { rows = await App.api("/api/admin/email-logs/recipients?group=" + encodeURIComponent(group.groupKey)); }
    catch (e) { view().innerHTML = `<div class="card cell-muted" style="padding:18px">${esc(e.message)}</div>`; return; }
    if (!Array.isArray(rows)) rows = [];

    view().innerHTML = "";
    const wrap = el("div", "fade-in");
    view().appendChild(wrap);
    const back = el("button", "btn btn-ghost btn-sm", "\u2190 Back to Email");
    back.onclick = () => renderEmail();
    wrap.appendChild(back);

    const hd = el("div"); hd.style.cssText = "margin:12px 0 8px";
    const count = group.recipientCount != null ? group.recipientCount : rows.length;
    hd.innerHTML = `<h2 style="margin:0;font-size:18px">${esc(group.subject || "(no subject)")}</h2>` +
      `<div class="cell-muted" style="font-size:12.5px;margin-top:2px">${esc(group.tenantName || "—")} \u00b7 ${count} recipient${count === 1 ? "" : "s"}${group.sentByName ? " \u00b7 sent by " + esc(group.sentByName) : ""}</div>`;
    wrap.appendChild(hd);

    const host = el("div");
    wrap.appendChild(host);
    const columns = [
      { key: "to", label: "Recipient", type: "text", get: (r) => r.toName || r.toEmail, render: (r) => r.toName ? `${esc(r.toName)} <span class="cell-muted">${esc(r.toEmail)}</span>` : esc(r.toEmail || "—") },
      { key: "status", label: "Status", type: "status", get: (r) => emailStatusText(r), render: (r) => emailStatusBadge(r) },
      { key: "date", label: "Sent at", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${esc(fmtDate(r.createdAt))}</span>` },
    ];
    const empty = `<div class="card cell-muted" style="padding:18px">No recipients recorded for this send.</div>`;
    App.table.mount({
      container: host, columns, rows,
      rowId: (r) => r.id,
      scrollX: true,
      defaultSort: "to", defaultSortDir: "asc",
      onRowClick: (r) => renderEmailDetail(r, () => renderEmailRecipients(group)),
      emptyHtml: empty, pageSize: 50,
    });
  }

  // LEVEL 3 — full single-email detail. `onBack` returns to the recipient list (Level 2);
  // falls back to the Email list if somehow opened without a parent send.
  function renderEmailDetail(r, onBack) {
    view().innerHTML = "";
    const wrap = el("div", "fade-in");
    view().appendChild(wrap);
    const back = el("button", "btn btn-ghost btn-sm", onBack ? "\u2190 Back to recipients" : "\u2190 Back to Email");
    back.onclick = onBack || (() => renderEmail());
    wrap.appendChild(back);

    const card = el("div", "card");
    card.style.cssText = "padding:22px;margin-top:12px;max-width:760px";
    const head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap";
    const title = el("h2", null, esc(r.subject || "(no subject)")); title.style.cssText = "margin:0;font-size:18px";
    head.appendChild(title);
    const badge = el("span"); badge.innerHTML = emailStatusBadge(r); head.appendChild(badge);
    card.appendChild(head);

    const grid = el("div"); grid.style.cssText = "display:grid;grid-template-columns:150px 1fr;gap:9px 16px;font-size:13.5px;align-items:start";
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
    if (r.errorMessage) line("Error", `<span style="color:var(--red)">${esc(r.errorMessage)}</span>`);
    if (r.providerMessageId) line("Message ID", `<span class="cell-muted" style="font-family:monospace;font-size:12px">${esc(r.providerMessageId)}</span>`);
    card.appendChild(grid);
    wrap.appendChild(card);
  }

  // ---------------- Billing rates editor (Billing & Usage → Billing Rates tab) ----------------
  // Renders the editable rate form into `host`. Reuses the SINGLE existing rates store +
  // endpoint (GET/PUT /api/admin/billing-rates) — no duplicate store. Brand logos reuse the
  // same /img assets the Integrations cards use.
  async function billingRatesInto(host) {
    host.innerHTML = `<div class="cell-muted" style="padding:8px">Loading rates…</div>`;
    let rates;
    try { rates = await App.api("/api/admin/billing-rates"); }
    catch (e) { host.innerHTML = `<div class="card cell-muted" style="padding:18px">${esc(e.message)}</div>`; return; }
    rates = rates || {};
    host.innerHTML = "";

    const intro = el("p", "cell-muted");
    intro.style.cssText = "font-size:12.5px;margin:0 0 14px";
    intro.textContent = "Editable cost rates used to estimate dollar costs from recorded usage. Changing these does not bill anyone — it only affects future estimates.";
    host.appendChild(intro);

    const card = el("div", "card");
    card.style.cssText = "padding:22px;max-width:600px";
    const OPENAI = "/img/openai.webp", TWILIO = "/img/twilio.png";
    const fields = [
      ["openAiInputPer1kTokens", "OpenAI input — $ per 1K tokens", OPENAI],
      ["openAiOutputPer1kTokens", "OpenAI output — $ per 1K tokens", OPENAI],
      ["twilioPerCallMinute", "Twilio — $ per call minute", TWILIO],
      ["twilioPerNumberMonthly", "Twilio — $ per phone number / month", TWILIO],
      ["twilioPerSms", "Twilio — $ per SMS", TWILIO],
    ];
    const inputs = {};
    const grid = el("div"); grid.style.cssText = "display:grid;grid-template-columns:24px 1fr 140px;gap:12px 14px;align-items:center";
    fields.forEach(([key, label, logo]) => {
      const ic = el("span"); ic.innerHTML = `<img src="${logo}" alt="" style="width:20px;height:20px;object-fit:contain;border-radius:4px;display:block">`;
      const l = el("label", "field-label", label); l.style.cssText = "margin:0";
      const inp = el("input", "input"); inp.type = "number"; inp.min = "0"; inp.step = "0.0001"; inp.style.cssText = "margin:0";
      inp.value = rates[key] != null ? String(rates[key]) : "0";
      inputs[key] = inp;
      grid.appendChild(ic); grid.appendChild(l); grid.appendChild(inp);
    });
    card.appendChild(grid);

    const foot = el("div"); foot.style.cssText = "margin-top:18px;display:flex;gap:8px;align-items:center";
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
    const row = el("div"); row.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start";
    card.style.flex = "1 1 340px"; card.style.minWidth = "300px";
    row.appendChild(card);
    host.appendChild(row);

    await billingNotifySettingsInto(row);
  }

  // Approval-notification settings (global): recipients, lead days, cadence, enabled.
  async function billingNotifySettingsInto(host) {
    const card = el("div", "card"); card.style.cssText = "padding:20px;flex:1 1 340px;min-width:300px";
    card.appendChild(el("h3", null, "Approval notifications")).style.cssText = "margin:0 0 4px;font-size:15px";
    const note = el("p", "cell-muted"); note.style.cssText = "margin:0 0 14px;font-size:12.5px"; note.textContent = "Who gets emailed to approve auto-drafted charges, and how far ahead of the due date.";
    card.appendChild(note);
    const bodyWrap = el("div"); bodyWrap.innerHTML = `<div class="cell-muted" style="font-size:12px">Loading…</div>`; card.appendChild(bodyWrap);
    host.appendChild(card);

    let cfg;
    try { cfg = await App.api("/api/admin/billing-notify-config"); }
    catch (e) { bodyWrap.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; return; }
    bodyWrap.innerHTML = "";

    // Enabled toggle.
    const enWrap = el("label"); enWrap.style.cssText = "display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:14px";
    const enCb = el("input"); enCb.type = "checkbox"; enCb.checked = !!cfg.enabled;
    enWrap.appendChild(enCb); enWrap.appendChild(document.createTextNode("Send approval reminder emails"));
    bodyWrap.appendChild(enWrap);

    // Recipients (add/remove).
    bodyWrap.appendChild(el("label", "field-label", "Recipients")).style.margin = "0 0 6px";
    let recipients = (cfg.recipients || []).slice();
    const chips = el("div"); chips.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px";
    function paintChips() {
      chips.innerHTML = "";
      if (!recipients.length) { const e = el("span", "cell-muted", "No recipients — the owner won’t be emailed."); e.style.fontSize = "12px"; chips.appendChild(e); }
      recipients.forEach((r, i) => {
        const chip = el("span"); chip.style.cssText = "display:inline-flex;align-items:center;gap:6px;background:var(--surface-2,#eef1f5);border-radius:14px;padding:3px 6px 3px 10px;font-size:12.5px";
        chip.appendChild(document.createTextNode(r));
        const x = el("button", "icon-btn", "×"); x.style.cssText = "width:18px;height:18px;line-height:1"; x.onclick = () => { recipients.splice(i, 1); paintChips(); };
        chip.appendChild(x); chips.appendChild(chip);
      });
    }
    paintChips(); bodyWrap.appendChild(chips);
    const addRow = el("div"); addRow.style.cssText = "display:flex;gap:8px;margin-bottom:14px";
    const addInp = el("input", "input"); addInp.type = "email"; addInp.placeholder = "name@example.com"; addInp.style.cssText = "margin:0;max-width:280px";
    const addBtn = el("button", "btn btn-ghost btn-sm", "Add");
    function addEmail() { const v = (addInp.value || "").trim().toLowerCase(); if (!v) return; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast("Enter a valid email", true); return; } if (!recipients.includes(v)) recipients.push(v); addInp.value = ""; paintChips(); }
    addBtn.onclick = addEmail; addInp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } };
    addRow.appendChild(addInp); addRow.appendChild(addBtn); bodyWrap.appendChild(addRow);

    // Lead days + cadence.
    const row = el("div"); row.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px";
    const leadInp = el("input", "input"); leadInp.type = "number"; leadInp.min = "0"; leadInp.max = "365"; leadInp.step = "1"; leadInp.style.cssText = "margin:0;width:90px"; leadInp.value = String(cfg.leadDays);
    const cadSel = el("select", "input"); cadSel.style.cssText = "margin:0;width:auto";
    [["once", "Once"], ["daily_until_approved", "Daily until approved"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (cfg.cadence === v) o.selected = true; cadSel.appendChild(o); });
    row.appendChild(field("Lead days before due", leadInp));
    row.appendChild(field("Cadence", cadSel));
    bodyWrap.appendChild(row);

    const save = el("button", "btn btn-primary btn-sm", "Save notification settings");
    save.onclick = async () => {
      const body = { enabled: enCb.checked, recipients, leadDays: Number(leadInp.value || 0), cadence: cadSel.value };
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
    const card = el("div", "card"); card.style.cssText = "padding:16px";
    card.appendChild(el("div", null, esc(title))).style.cssText = "font-weight:600;font-size:13.5px;margin-bottom:10px";
    const body = el("div"); body.style.cssText = "height:240px;position:relative";
    card.appendChild(body);
    const w = Object.assign({}, widgetDef);
    if (grouping && Array.isArray(w.groupBy)) w.groupBy = w.groupBy.map((d) => (d.key === "date" ? { key: "date", date: grouping } : d));
    try { App.reports.renderWidgetBody(body, w, source, source.rows, source.reportFields, charts); }
    catch (e) { body.innerHTML = `<p class="cell-muted">${esc(e.message)}</p>`; }
    return card;
  }
  function kpiCard(label, value) {
    const card = el("div", "card"); card.style.cssText = "padding:16px 18px";
    const v = el("div", null, String(value)); v.style.cssText = "font-size:22px;font-weight:700;line-height:1.1";
    const l = el("div", "cell-muted", label); l.style.cssText = "font-size:12px;margin-top:4px";
    card.appendChild(v); card.appendChild(l);
    return card;
  }
  // Map endpoint totals -> quick KPI values (kept for the By-portal summary only; Overview and
  // the drill-in are now fully widget/dashboard-driven).
  function fmtInt(n) { return String(Math.round(Number(n) || 0)); }

  // Range + grouping control. Defaults to the last 30 days, grouped by day. onChange fires
  // with { from, to, grouping } whenever any input changes.
  function usageRangeControl(onChange) {
    const wrap = el("div"); wrap.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px";
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const from0 = iso(new Date(Date.now() - 29 * 86400000)), to0 = iso(today);
    function field(label, node) { const d = el("div"); d.style.cssText = "display:flex;flex-direction:column;gap:3px"; const l = el("span", "cell-muted", label); l.style.fontSize = "11.5px"; d.appendChild(l); d.appendChild(node); return d; }
    const fromEl = el("input", "input"); fromEl.type = "date"; fromEl.value = from0; fromEl.style.cssText = "margin:0;width:auto";
    const toEl = el("input", "input"); toEl.type = "date"; toEl.value = to0; toEl.style.cssText = "margin:0;width:auto";
    const grpEl = el("select", "input"); grpEl.style.cssText = "margin:0;width:auto";
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
    const sub = el("div", "tabs"); sub.style.marginBottom = "12px";
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
    host.innerHTML = `<div class="cell-muted" style="padding:8px">Loading billing…</div>`;
    let cfg, ledger;
    try { [cfg, ledger] = await Promise.all([App.api(`/api/admin/billing-config/${encodeURIComponent(tenantId)}`), App.api(`/api/admin/charges/tenant/${encodeURIComponent(tenantId)}`)]); }
    catch (e) { host.innerHTML = `<div class="card cell-muted" style="padding:18px">${esc(e.message)}</div>`; return; }
    host.innerHTML = "";
    host.appendChild(billingTermsCard(tenantId, cfg));
    host.appendChild(chargesLedgerCard(tenantId, tenantName, ledger));
  }

  function field(label, node) { const d = el("div"); d.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:150px"; const l = el("span", "cell-muted", label); l.style.fontSize = "11.5px"; d.appendChild(l); d.appendChild(node); return d; }
  function checkRow(label, checked) { const w = el("label"); w.style.cssText = "display:flex;align-items:center;gap:8px;font-size:13px"; const cb = el("input"); cb.type = "checkbox"; cb.checked = !!checked; w.appendChild(cb); w.appendChild(document.createTextNode(label)); return { el: w, cb }; }
  function dateInput(v) { const i = el("input", "input"); i.type = "date"; i.style.cssText = "margin:0;width:auto"; if (v) i.value = String(v).slice(0, 10); return i; }
  function numInput(v, step) { const i = el("input", "input"); i.type = "number"; i.step = step || "0.01"; i.min = "0"; i.style.cssText = "margin:0;width:130px"; i.value = v == null ? "" : String(v); return i; }

  function openTermsHistory(tenantId, tenantName) {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Terms history</h2><button class="icon-btn" id="th-close">&times;</button></div>
      <div class="modal-body"><div class="cell-muted" style="font-size:12.5px">Loading…</div></div>`;
    const overlay = modal(inner); const body = inner.querySelector(".modal-body");
    inner.querySelector("#th-close").onclick = () => overlay.remove();
    App.api(`/api/admin/billing-config/${encodeURIComponent(tenantId)}/audit`).then((rows) => {
      if (!rows || !rows.length) { body.innerHTML = `<div class="cell-muted" style="font-size:12.5px">No terms changes recorded yet.</div>`; return; }
      body.innerHTML = `<div style="border-left:2px solid var(--border,#e5e7eb);padding-left:12px">${rows.map((a) => `
        <div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0">
          <span style="width:9px;height:9px;border-radius:50%;background:#0ea5e9;margin-top:5px;flex:0 0 auto"></span>
          <div style="flex:1"><div style="font-size:13px;font-weight:600">${esc(a.note)}</div>
          <div class="cell-muted" style="font-size:12px">${esc(a.actorName || "Unknown")} · ${esc(fmtDate(a.createdAt))}</div></div>
        </div>`).join("")}</div>`;
    }).catch((e) => { body.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; });
  }

  function billingTermsCard(tenantId, cfg) {
    const card = el("div", "card"); card.style.cssText = "padding:18px;margin-bottom:16px";
    const head = el("div"); head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin:0 0 12px";
    head.appendChild(el("h3", null, "Billing terms")).style.cssText = "margin:0;font-size:15px";
    const hist = el("button", "btn btn-ghost btn-sm", "History"); hist.onclick = () => openTermsHistory(tenantId, cfg.tenantName);
    head.appendChild(hist);
    card.appendChild(head);

    // billingStatus (updated via the portals endpoint).
    const statusSel = el("select", "input"); statusSel.style.cssText = "margin:0;width:auto";
    [["free", "Free"], ["trial", "Trial"], ["paid", "Paid"], ["exception", "Exception"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if ((cfg.billingStatus || "") === v) o.selected = true; statusSel.appendChild(o); });
    if (!cfg.billingStatus) { const o = el("option", null, "—"); o.value = ""; o.selected = true; statusSel.insertBefore(o, statusSel.firstChild); }
    statusSel.onchange = async () => { try { await App.api(`/api/admin/portals/${encodeURIComponent(tenantId)}`, { method: "PATCH", body: JSON.stringify({ billingStatus: statusSel.value }) }); toast("Billing status updated"); } catch (e) { toast(e.message, true); statusSel.value = cfg.billingStatus || ""; } };

    const flat = checkRow("Flat fee", cfg.hasFlatFee); const flatAmt = numInput(cfg.flatFeeAmount);
    const pass = checkRow("Passthrough (usage cost + markup)", cfg.hasPassthrough); const markup = numInput(cfg.passthroughMarkupPct, "0.1");
    const periodSel = el("select", "input"); periodSel.style.cssText = "margin:0;width:auto";
    [["monthly", "Monthly"], ["annual", "Annual"], ["custom", "Custom (days)"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (cfg.billingPeriod === v) o.selected = true; periodSel.appendChild(o); });
    const customDays = numInput(cfg.customPeriodDays, "1"); customDays.step = "1"; customDays.style.width = "90px";
    const customWrap = field("Custom days", customDays);
    function syncCustom() { customWrap.style.display = periodSel.value === "custom" ? "flex" : "none"; }
    periodSel.onchange = syncCustom;
    const cStart = dateInput(cfg.contractStart), cEnd = dateInput(cfg.contractEnd);
    const curr = el("input", "input"); curr.style.cssText = "margin:0;width:80px"; curr.value = cfg.currency || "USD"; curr.maxLength = 3;

    const row1 = el("div"); row1.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px";
    row1.appendChild(field("Billing status", statusSel));
    row1.appendChild(field("Period", periodSel));
    row1.appendChild(customWrap);
    row1.appendChild(field("Currency", curr));
    card.appendChild(row1);

    const row2 = el("div"); row2.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px";
    const flatCell = el("div"); flatCell.style.cssText = "display:flex;flex-direction:column;gap:6px"; flatCell.appendChild(flat.el); flatCell.appendChild(field("Amount", flatAmt));
    const passCell = el("div"); passCell.style.cssText = "display:flex;flex-direction:column;gap:6px"; passCell.appendChild(pass.el); passCell.appendChild(field("Markup %", markup));
    row2.appendChild(flatCell); row2.appendChild(passCell);
    card.appendChild(row2);

    const row3 = el("div"); row3.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end";
    row3.appendChild(field("Contract start", cStart)); row3.appendChild(field("Contract end", cEnd));
    card.appendChild(row3);

    syncCustom();
    const save = el("button", "btn btn-primary btn-sm", "Save terms"); save.style.marginTop = "14px";
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
    const sep = el("div"); sep.style.cssText = "border-top:1px solid var(--border,#e5e7eb);margin:16px 0 12px"; card.appendChild(sep);
    const sh = el("div"); sh.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px";
    sh.appendChild(el("h4", null, "Payments (Stripe)")).style.cssText = "margin:0;font-size:13.5px";
    if (cfg.stripeConfigured && cfg.stripeTestMode) { const t = el("span", null, "TEST"); t.style.cssText = "font-size:10px;font-weight:700;color:#92400e;background:#fef3c7;border-radius:6px;padding:1px 6px"; sh.appendChild(t); }
    card.appendChild(sh);

    const short = (id) => (id && id.length > 14 ? id.slice(0, 10) + "…" + id.slice(-4) : id);
    const statusLine = el("div"); statusLine.style.cssText = "font-size:12.5px;margin-bottom:10px";
    function paintStatus(customerId) {
      if (!cfg.stripeConfigured) { statusLine.innerHTML = `<span style="color:#b45309">● Stripe not configured</span> <span class="cell-muted">— add STRIPE_SECRET_KEY to enable.</span>`; return; }
      if (customerId) statusLine.innerHTML = `<span style="color:#16a34a">● Connected</span> <span class="cell-muted">${esc(short(customerId))}</span>`;
      else statusLine.innerHTML = `<span style="color:#6b7280">○ Not connected</span>`;
    }
    paintStatus(cfg.stripeCustomerId);
    card.appendChild(statusLine);

    // Billing email (saved to BillingConfig.billingEmail).
    const emailWrap = el("div"); emailWrap.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px";
    const emailInp = el("input", "input"); emailInp.type = "email"; emailInp.placeholder = "billing@portal.com"; emailInp.style.cssText = "margin:0;max-width:260px"; emailInp.value = cfg.billingEmail || "";
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
    const b = el("span", null, cap(c.status)); b.style.cssText = `display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;color:#fff;background:${map[c.status] || "#6b7280"}`;
    return b;
  }

  function chargeStatusBadgeHTML(c) {
    const map = { draft: "#6b7280", approved: "#2563eb", paid: "#16a34a", unpaid: "#dc2626", void: "#9ca3af" };
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;color:#fff;background:${map[c.status] || "#6b7280"}">${esc(cap(c.status))}</span>`;
  }

  // Stripe invoice status pill (+ optional hosted-link). "Not invoiced" when none.
  function invoiceStatusHTML(c) {
    if (!c.stripeInvoiceId) return `<span class="cell-muted">Not invoiced</span>`;
    const map = { draft: "#6b7280", open: "#2563eb", paid: "#16a34a", void: "#9ca3af", uncollectible: "#dc2626" };
    const st = c.stripeInvoiceStatus || "open";
    const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;color:#fff;background:${map[st] || "#6b7280"}">${esc(cap(st))}</span>`;
    const link = c.stripeInvoiceUrl ? ` <a href="${esc(c.stripeInvoiceUrl)}" target="_blank" rel="noopener" class="link-btn" style="color:var(--accent,#2563eb);text-decoration:underline;font-size:12px">payment link</a>` : "";
    return badge + link;
  }

  // Charges table column layout persists per-browser under ONE shared key so it applies to every
  // tenant's charges table (mirrors the Tenants table's admincols pattern).
  const CHARGES_COLS_KEY = "chargescols";
  const loadChargesLayout = () => { try { return JSON.parse(localStorage.getItem(CHARGES_COLS_KEY) || "{}") || {}; } catch (e) { return {}; } };
  const saveChargesLayout = (l) => { try { localStorage.setItem(CHARGES_COLS_KEY, JSON.stringify(l || {})); } catch (e) {} };

  function chargesLedgerCard(tenantId, tenantName, ledger) {
    const card = el("div", "card"); card.style.cssText = "padding:18px";
    const head = el("div"); head.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px";
    head.appendChild(el("h3", null, "Charges")).style.cssText = "margin:0;font-size:15px";
    card.appendChild(head);

    const t = ledger.totals || { billed: 0, paid: 0, outstanding: 0 };
    const totals = el("div"); totals.style.cssText = "display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px";
    [["Billed", t.billed], ["Paid", t.paid], ["Outstanding", t.outstanding]].forEach(([l, v]) => { const d = el("div"); d.innerHTML = `<div style="font-size:19px;font-weight:700">${esc(fmtMoney(v))}</div><div class="cell-muted" style="font-size:11.5px">${l}</div>`; totals.appendChild(d); });
    card.appendChild(totals);

    const charges = ledger.charges || [];
    const byId = {}; charges.forEach((c) => (byId[c.id] = c));
    const period = (c) => `${fmtDateOnly(c.periodStart)} – ${fmtDateOnly(c.periodEnd)}`;

    // Manageable columns (defaults marked below). Created/Approved/Paid date/Notes default OFF.
    const manageable = [
      { key: "period", label: "Period", type: "text", get: (c) => c.periodStart, text: (c) => period(c), render: (c) => esc(period(c)) },
      { key: "amount", label: "Amount", type: "number", get: (c) => c.amount, text: (c) => fmtMoney(c.amount) + " " + (c.currency || ""), render: (c) => esc(fmtMoney(c.amount) + " " + (c.currency || "")) },
      { key: "status", label: "Status", type: "text", get: (c) => c.status, text: (c) => cap(c.status), render: (c) => chargeStatusBadgeHTML(c) },
      { key: "paid", label: "Paid", type: "text", get: (c) => (c.isPaid ? 1 : 0), text: (c) => (c.isPaid ? "Paid" : (c.status === "void" ? "—" : "Unpaid")), render: (c) => (c.isPaid ? "✅" : (c.status === "void" ? "—" : "❌")) },
      { key: "outstanding", label: "Outstanding", type: "number", get: (c) => c.outstanding, text: (c) => fmtMoney(c.outstanding), render: (c) => esc(fmtMoney(c.outstanding)) },
      { key: "due", label: "Due", type: "date", get: (c) => c.dueDate, text: (c) => (c.dueDate ? fmtDateOnly(c.dueDate) : "—"), render: (c) => (c.dueDate ? esc(fmtDateOnly(c.dueDate)) : "—") },
      { key: "created", label: "Created", type: "date", get: (c) => c.createdAt, text: (c) => fmtDateOnly(c.createdAt), render: (c) => esc(fmtDateOnly(c.createdAt)) },
      { key: "approved", label: "Approved", type: "date", get: (c) => c.approvedAt, text: (c) => (c.approvedAt ? fmtDateOnly(c.approvedAt) : "—"), render: (c) => (c.approvedAt ? esc(fmtDateOnly(c.approvedAt)) : "—") },
      { key: "paidDate", label: "Paid date", type: "date", get: (c) => c.paidAt, text: (c) => (c.paidAt ? fmtDateOnly(c.paidAt) : "—"), render: (c) => (c.paidAt ? esc(fmtDateOnly(c.paidAt)) : "—") },
      { key: "notes", label: "Notes", type: "text", get: (c) => c.notes || "", text: (c) => c.notes || "", render: (c) => (c.notes ? esc(c.notes) : `<span class="cell-muted">—</span>`) },
      { key: "invoice", label: "Invoice", type: "text", get: (c) => c.stripeInvoiceStatus || "", text: (c) => (c.stripeInvoiceId ? (c.stripeInvoiceStatus || "open") : "Not invoiced"), render: (c) => invoiceStatusHTML(c) },
    ];
    const defaultKeys = ["period", "amount", "status", "paid", "outstanding", "due"];
    const actionsCol = {
      key: "__act", label: "", type: "text", filterable: false, get: () => "",
      render: (c) => (c.status !== "void" ? `<div style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-act="pay" data-id="${esc(c.id)}">Payment</button></div>` : ""),
    };

    let layout = loadChargesLayout();
    const applied = () => App.table.applyColumnLayout(manageable, layout, defaultKeys).concat([actionsCol]);

    const tableHost = el("div"); card.appendChild(tableHost);
    const handle = App.table.mount({
      container: tableHost, rows: charges, rowId: (c) => c.id, columns: applied(), scrollX: true,
      defaultSort: "period", defaultSortDir: "desc",
      onRowClick: (c) => openChargeDetail(tenantId, tenantName, c),
      emptyHtml: `<div class="card cell-muted" style="padding:18px">No charges yet. Click “+ Create charge”.</div>`,
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

    return card;
  }

  function refreshBilling(tenantId, tenantName) {
    const host = document.querySelector(`[data-billing-host="${tenantId}"]`);
    if (host) renderTenantBillingInto(host, tenantId, tenantName);
  }

  function money2(v) { const n = Number(v || 0); return Math.round(n * 100) / 100; }

  function openChargeModal(tenantId, tenantName, existing, onSaved) {
    const inner = el("div");
    const today = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
    const d0 = existing ? String(existing.periodStart).slice(0, 10) : iso(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    const d1 = existing ? String(existing.periodEnd).slice(0, 10) : iso(new Date(today.getFullYear(), today.getMonth(), 0));
    inner.innerHTML = `<div class="modal-head"><h2>${existing ? "Edit charge" : "Create charge"}</h2><button class="icon-btn" id="c-close">&times;</button></div>
      <div class="modal-body">
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:3px"><label class="field-label">Period start</label><input id="c-start" class="input" type="date" value="${d0}"></div>
          <div style="display:flex;flex-direction:column;gap:3px"><label class="field-label">Period end</label><input id="c-end" class="input" type="date" value="${d1}"></div>
        </div>
        <div style="margin:8px 0"><button id="c-suggest" class="btn btn-ghost btn-sm">✨ Suggest amount from terms</button> <span id="c-sugnote" class="cell-muted" style="font-size:11.5px"></span></div>
        <label class="field-label">Amount</label><input id="c-amount" class="input" type="number" step="0.01" min="0" value="${existing ? money2(existing.amount) : ""}" placeholder="0.00">
        <label class="field-label">Due date (optional)</label><input id="c-due" class="input" type="date" value="${existing && existing.dueDate ? String(existing.dueDate).slice(0, 10) : ""}">
        <label class="field-label">Notes</label><input id="c-notes" class="input" value="${existing ? esc(existing.notes || "") : ""}" placeholder="optional">
        <div id="c-breakdown" class="cell-muted" style="font-size:12px;margin:8px 0"></div>
        <button id="c-save" class="btn btn-primary btn-block">${existing ? "Save changes" : "Save as draft"}</button>
      </div>`;
    const overlay = modal(inner); const $ = (s) => inner.querySelector(s);
    let breakdown = existing ? existing.breakdown : null;
    $("#c-close").onclick = () => overlay.remove();
    function showBreakdown(b) { if (!b) { $("#c-breakdown").innerHTML = ""; return; } const us = b.usageSnapshot || {}; $("#c-breakdown").innerHTML = `Flat ${esc(fmtMoney(b.flatFee))} + passthrough ${esc(fmtMoney(b.passthroughBaseCost))}×(1+${esc(String(b.markupPct))}%) = ${esc(fmtMoney(b.passthroughAmount))}. Usage: ${us.calls || 0} calls, ${us.minutes || 0} min, ${us.tokens || 0} tokens, ${us.emails || 0} emails.`; }
    showBreakdown(breakdown);
    $("#c-suggest").onclick = async () => {
      $("#c-sugnote").textContent = "Computing…";
      try { const s = await App.api(`/api/admin/charges/suggest/${encodeURIComponent(tenantId)}`, { method: "POST", body: JSON.stringify({ periodStart: $("#c-start").value, periodEnd: $("#c-end").value }) }); $("#c-amount").value = money2(s.amount); breakdown = s.breakdown; showBreakdown(breakdown); $("#c-sugnote").textContent = "Suggested — adjust if needed."; }
      catch (e) { $("#c-sugnote").textContent = ""; toast(e.message, true); }
    };
    $("#c-save").onclick = async () => {
      const body = { periodStart: $("#c-start").value, periodEnd: $("#c-end").value, amount: Number($("#c-amount").value || 0), breakdown: breakdown || {}, dueDate: $("#c-due").value || null, notes: $("#c-notes").value || null };
      try {
        if (existing) await App.api(`/api/admin/charges/${encodeURIComponent(existing.id)}`, { method: "PATCH", body: JSON.stringify(body) });
        else await App.api(`/api/admin/charges/tenant/${encodeURIComponent(tenantId)}`, { method: "POST", body: JSON.stringify(body) });
        overlay.remove(); toast(existing ? "Charge updated" : "Charge created"); if (onSaved) onSaved(); else refreshBilling(tenantId, tenantName);
      } catch (e) { toast(e.message, true); }
    };
  }

  function openPaymentModal(tenantId, tenantName, charge, onSaved) {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Record payment</h2><button class="icon-btn" id="p-close">&times;</button></div>
      <div class="modal-body">
        <div class="cell-muted" style="font-size:12px;margin-bottom:8px">Outstanding: ${esc(fmtMoney(charge.outstanding))} of ${esc(fmtMoney(charge.amount))}</div>
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
    const map = { charge_created: "#6b7280", charge_updated: "#d97706", status_changed: "#7c3aed", charge_approved: "#2563eb", charge_voided: "#9ca3af", payment_recorded: "#16a34a", terms_updated: "#0ea5e9" };
    return map[action] || "#6b7280";
  }
  function auditActionLabel(action) {
    const map = { charge_created: "Created", charge_updated: "Edited", status_changed: "Status changed", charge_approved: "Approved", charge_voided: "Voided", payment_recorded: "Payment recorded", terms_updated: "Terms updated" };
    return map[action] || action;
  }

  // Approve a charge behind a password-confirmation gate. Used everywhere approve is possible
  // (per-tenant detail modal + central Charges tab). The server re-verifies the password.
  function confirmApprove(chargeId, onDone) {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Confirm approval</h2><button class="icon-btn" id="ca-close">&times;</button></div>
      <div class="modal-body">
        <p class="cell-muted" style="font-size:13px;margin:0 0 10px">Approving finalizes this charge as owed. Enter your password to confirm.</p>
        <label class="field-label">Your password</label>
        <input id="ca-pw" class="input" type="password" autocomplete="current-password" placeholder="Password">
        <div id="ca-err" style="color:#dc2626;font-size:12.5px;margin:6px 0 0;display:none"></div>
        <div style="display:flex;gap:8px;margin-top:14px">
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
      if (!password) { $("#ca-err").style.display = "block"; $("#ca-err").textContent = "Enter your password."; return; }
      $("#ca-ok").disabled = true; $("#ca-err").style.display = "none";
      try {
        await App.api(`/api/admin/charges/${encodeURIComponent(chargeId)}/approve`, { method: "POST", body: JSON.stringify({ password }) });
        toast("Charge approved"); close(); if (onDone) onDone();
      } catch (e) {
        $("#ca-ok").disabled = false; $("#ca-err").style.display = "block";
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
        <div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0">
          <span style="width:9px;height:9px;border-radius:50%;background:${e.dot};margin-top:5px;flex:0 0 auto"></span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${esc(e.label)} <span class="cell-muted" style="font-weight:400">· ${esc(e.t ? fmtDate(e.t) : "—")}${e.who ? " · " + esc(e.who) : ""}</span></div>
            ${e.sub ? `<div class="cell-muted" style="font-size:12px">${esc(e.sub)}</div>` : ""}
          </div>
        </div>`).join("") || `<div class="cell-muted" style="font-size:12.5px">No activity yet.</div>`;

      inner.innerHTML = `<div class="modal-head"><h2>Charge detail</h2><button class="icon-btn" id="d-close">&times;</button></div>
        <div class="modal-body">
          <div style="margin-bottom:6px"><b>${esc(fmtDateOnly(charge.periodStart))} – ${esc(fmtDateOnly(charge.periodEnd))}</b> · ${esc(fmtMoney(charge.amount))} ${esc(charge.currency || "")} · ${chargeStatusBadgeHTML(charge)}</div>
          <div class="cell-muted" style="font-size:12.5px;margin-bottom:4px">Breakdown — flat ${esc(fmtMoney(b.flatFee || 0))}, passthrough base ${esc(fmtMoney(b.passthroughBaseCost || 0))} × (1 + ${esc(String(b.markupPct || 0))}%) = ${esc(fmtMoney(b.passthroughAmount || 0))}.<br>Usage snapshot: ${us.calls || 0} calls · ${us.minutes || 0} min · ${us.tokens || 0} tokens · ${us.emails || 0} emails.</div>
          ${charge.dueDate ? `<div class="cell-muted" style="font-size:12.5px">Due ${esc(fmtDateOnly(charge.dueDate))}</div>` : ""}
          ${charge.notes ? `<div style="font-size:12.5px;margin-top:4px">Notes: ${esc(charge.notes)}</div>` : ""}
          <label class="field-label" style="margin-top:12px">Timeline</label>
          <div style="border-left:2px solid var(--border,#e5e7eb);padding-left:12px;margin:2px 0 6px">${timelineHTML}</div>
          <div class="cell-muted" style="font-size:12px;margin-bottom:8px">${esc(fmtMoney(charge.paidTotal))} paid · ${esc(fmtMoney(charge.outstanding))} outstanding${charge.paidAt ? ` · fully paid ${esc(fmtDateOnly(charge.paidAt))}` : ""}</div>
          <label class="field-label">Status</label>
          <select id="d-status" class="input" style="width:auto">${STATUSES.map((s) => `<option value="${s}"${charge.status === s ? " selected" : ""}>${cap(s)}</option>`).join("")}</select>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            ${charge.status === "draft" ? `<button id="d-approve" class="btn btn-primary btn-sm">Approve</button>` : ""}
            <button id="d-edit" class="btn btn-ghost btn-sm">Edit</button>
            <button id="d-pay" class="btn btn-ghost btn-sm">Record payment</button>
            <button id="d-void" class="btn btn-ghost btn-sm" style="color:#dc2626">Void</button>
          </div>
          <div style="border-top:1px solid var(--border,#e5e7eb);margin:14px 0 10px"></div>
          <label class="field-label">Invoice (Stripe)</label>
          ${!stripeOn ? `<div class="cell-muted" style="font-size:12.5px">Stripe not connected — configure Stripe to invoice this charge.</div>`
            : (charge.status === "draft" ? `<div class="cell-muted" style="font-size:12.5px">Approve the charge to create its invoice.</div>`
            : `<div style="font-size:12.5px;margin-bottom:8px">${invoiceStatusHTML(charge)}</div>
               <div style="display:flex;gap:8px;flex-wrap:wrap">
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
    host.innerHTML = `<div class="cell-muted" style="padding:8px">Loading charges…</div>`;
    let layout = loadCentralChargesLayout();
    const period = (c) => `${fmtDateOnly(c.periodStart)} – ${fmtDateOnly(c.periodEnd)}`;

    const manageable = [
      { key: "tenant", label: "Portal", type: "text", get: (c) => c.tenant, text: (c) => c.tenant, render: (c) => esc(c.tenant || "—") },
      { key: "period", label: "Period", type: "text", get: (c) => c.periodStart, text: (c) => period(c), render: (c) => esc(period(c)) },
      { key: "amount", label: "Amount", type: "number", get: (c) => c.amount, text: (c) => fmtMoney(c.amount), render: (c) => esc(fmtMoney(c.amount)) },
      { key: "currency", label: "Currency", type: "text", get: (c) => c.currency, text: (c) => c.currency || "", render: (c) => esc(c.currency || "—") },
      { key: "status", label: "Status", type: "text", get: (c) => c.status, text: (c) => cap(c.status), render: (c) => chargeStatusBadgeHTML(c) },
      { key: "paid", label: "Paid", type: "number", get: (c) => c.paidTotal, text: (c) => fmtMoney(c.paidTotal), render: (c) => esc(fmtMoney(c.paidTotal)) },
      { key: "outstanding", label: "Outstanding", type: "number", get: (c) => c.outstanding, text: (c) => fmtMoney(c.outstanding), render: (c) => esc(fmtMoney(c.outstanding)) },
      { key: "due", label: "Due", type: "date", get: (c) => c.dueDate, text: (c) => (c.dueDate ? fmtDateOnly(c.dueDate) : "—"), render: (c) => (c.dueDate ? esc(fmtDateOnly(c.dueDate)) : "—") },
      { key: "created", label: "Created", type: "date", get: (c) => c.createdAt, text: (c) => fmtDateOnly(c.createdAt), render: (c) => esc(fmtDateOnly(c.createdAt)) },
      { key: "approved", label: "Approved", type: "date", get: (c) => c.approvedAt, text: (c) => (c.approvedAt ? fmtDateOnly(c.approvedAt) : "—"), render: (c) => (c.approvedAt ? esc(fmtDateOnly(c.approvedAt)) : "—") },
      { key: "paidDate", label: "Paid date", type: "date", get: (c) => c.paidAt, text: (c) => (c.paidAt ? fmtDateOnly(c.paidAt) : "—"), render: (c) => (c.paidAt ? esc(fmtDateOnly(c.paidAt)) : "—") },
      { key: "notes", label: "Notes", type: "text", get: (c) => c.notes || "", text: (c) => c.notes || "", render: (c) => (c.notes ? esc(c.notes) : `<span class="cell-muted">—</span>`) },
      { key: "invoice", label: "Invoice", type: "text", get: (c) => c.stripeInvoiceStatus || "", text: (c) => (c.stripeInvoiceId ? (c.stripeInvoiceStatus || "open") : "Not invoiced"), render: (c) => invoiceStatusHTML(c) },
    ];
    const defaultKeys = ["tenant", "period", "amount", "status", "paid", "outstanding", "due", "created"];
    const actionsCol = {
      key: "__act", label: "", type: "text", filterable: false, get: () => "",
      render: (c) => `<div style="display:flex;gap:4px;flex-wrap:wrap">${c.status === "draft" ? `<button class="btn btn-ghost btn-sm" data-act="approve" data-id="${esc(c.id)}">Approve</button>` : ""}${c.status !== "void" ? `<button class="btn btn-ghost btn-sm" data-act="pay" data-id="${esc(c.id)}">Payment</button><button class="btn btn-ghost btn-sm" data-act="void" data-id="${esc(c.id)}" style="color:#dc2626">Void</button>` : ""}</div>`,
    };
    const applied = () => App.table.applyColumnLayout(manageable, layout, defaultKeys).concat([actionsCol]);

    let handle = null;
    async function load() {
      const prev = handle ? handle.getState() : null;
      let data;
      try { data = await App.api("/api/admin/charges/all"); }
      catch (e) { host.innerHTML = `<div class="card cell-muted" style="padding:18px">${esc(e.message)}</div>`; return; }
      const charges = data.charges || [];
      const byId = {}; charges.forEach((c) => (byId[c.id] = c));
      host.innerHTML = "";
      handle = App.table.mount({
        container: host, rows: charges, rowId: (c) => c.id, columns: applied(), scrollX: true,
        defaultSort: "created", defaultSortDir: "desc",
        onRowClick: (c) => openChargeDetail(c.tenantId, c.tenant, c, load),
        emptyHtml: `<div class="card cell-muted" style="padding:18px">No charges yet.</div>`,
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
      if (prev) handle.applyState(prev); // preserve active sort/filter/search across a live reload
    }
    await load();
  }

  // ---- Macro Billing & Usage page: Overview (editable dashboards) / Billing Rates ----
  async function renderUsageBilling() {
    view().innerHTML = "";
    const wrap = el("div", "fade-in");
    view().appendChild(wrap);
    wrap.appendChild(el("h1", "page-title", "Billing & Usage"));

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
