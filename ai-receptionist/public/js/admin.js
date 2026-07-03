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
    if (v === "billing") return renderBilling();
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

      // Billing status — viewable + editable here (same OWNER/SUPER_ADMIN/AUDITOR master-hub
      // gate as the rest of this panel). Changing it PATCHes the tenant immediately.
      const billRow = el("div"); billRow.style.cssText = "display:flex;align-items:center;gap:10px;margin:2px 0 14px";
      const billLbl = el("span", "cell-muted", "Billing status"); billLbl.style.fontSize = "13px";
      const billSel = el("select", "input"); billSel.style.cssText = "width:auto;margin:0;padding:4px 8px";
      [["free", "Free"], ["trial", "Trial"], ["paid", "Paid"], ["exception", "Exception"]].forEach(([v, lbl]) => {
        const o = el("option", null, lbl); o.value = v; if ((portal.billingStatus || "") === v) o.selected = true; billSel.appendChild(o);
      });
      if (!portal.billingStatus) { const o = el("option", null, "—"); o.value = ""; o.selected = true; billSel.insertBefore(o, billSel.firstChild); }
      billSel.onchange = async () => {
        const next = billSel.value; if (!next) return;
        billSel.disabled = true;
        try { await App.api("/api/admin/portals/" + encodeURIComponent(portal.id), { method: "PATCH", body: JSON.stringify({ billingStatus: next }) }); portal.billingStatus = next; toast("Billing status updated"); }
        catch (e) { toast(e.message, true); billSel.value = portal.billingStatus || ""; }
        finally { billSel.disabled = false; }
      };
      billRow.appendChild(billLbl); billRow.appendChild(billSel);
      wrap.appendChild(billRow);

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

  // ---------------- Master-hub Billing rates (OWNER/SUPER_ADMIN) ----------------
  // Simple view/edit for the editable cost rates. No dollar math yet — this only stores
  // the numbers later batches will use to estimate costs from raw usage.
  async function renderBilling() {
    loading();
    let rates;
    try { rates = await App.api("/api/admin/billing-rates"); }
    catch (e) { view().innerHTML = `<div class="card cell-muted" style="padding:18px">${esc(e.message)}</div>`; return; }
    rates = rates || {};

    view().innerHTML = "";
    const wrap = el("div", "fade-in");
    view().appendChild(wrap);
    const head = el("div");
    head.innerHTML = `<h1 class="page-title">Billing rates</h1>` +
      `<p class="cell-muted" style="font-size:12.5px;margin:2px 0 14px">Editable cost rates used later to estimate dollar costs from recorded usage. Changing these does not bill anyone — it only affects future estimates.</p>`;
    wrap.appendChild(head);

    const card = el("div", "card");
    card.style.cssText = "padding:22px;max-width:560px";
    const fields = [
      ["openAiInputPer1kTokens", "OpenAI input — $ per 1K tokens"],
      ["openAiOutputPer1kTokens", "OpenAI output — $ per 1K tokens"],
      ["twilioPerCallMinute", "Twilio — $ per call minute"],
      ["twilioPerNumberMonthly", "Twilio — $ per phone number / month"],
      ["twilioPerSms", "Twilio — $ per SMS"],
    ];
    const inputs = {};
    const grid = el("div"); grid.style.cssText = "display:grid;grid-template-columns:1fr 140px;gap:10px 16px;align-items:center";
    fields.forEach(([key, label]) => {
      const l = el("label", "field-label", label); l.style.cssText = "margin:0";
      const inp = el("input", "input"); inp.type = "number"; inp.min = "0"; inp.step = "0.0001"; inp.style.cssText = "margin:0";
      inp.value = rates[key] != null ? String(rates[key]) : "0";
      inputs[key] = inp;
      grid.appendChild(l); grid.appendChild(inp);
    });
    card.appendChild(grid);

    const foot = el("div"); foot.style.cssText = "margin-top:18px;display:flex;gap:8px;align-items:center";
    const save = el("button", "btn btn-primary btn-sm", "Save rates");
    const note = el("span", "cell-muted"); note.style.fontSize = "12.5px";
    save.onclick = async () => {
      const body = {};
      for (const [key] of fields) {
        const n = Number(inputs[key].value);
        if (!isFinite(n) || n < 0) { toast(`${key} must be a non-negative number`, true); return; }
        body[key] = n;
      }
      save.disabled = true; note.textContent = "";
      try { const updated = await App.api("/api/admin/billing-rates", { method: "PUT", body: JSON.stringify(body) }); for (const [key] of fields) if (updated && updated[key] != null) inputs[key].value = String(updated[key]); toast("Rates saved"); note.textContent = "Saved."; }
      catch (e) { toast(e.message, true); }
      finally { save.disabled = false; }
    };
    foot.appendChild(save); foot.appendChild(note);
    card.appendChild(foot);
    wrap.appendChild(card);
  }

  App.admin = { render };
})(typeof window !== "undefined" ? window : globalThis);
