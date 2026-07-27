// EMERGENT LAYER 1 — the BELL, its unread BADGE, and the two-tab PANEL.
//
// Physical contract (batch spec 3a–3g):
//   * the bell is an .icon-btn sitting immediately BEFORE the settings gear, so
//     it inherits the gear's size, hit-area and spacing tokens exactly — and
//     the gear itself does not move (asserted in the suite).
//   * the badge is absolutely positioned INSIDE the bell's box, so it can never
//     shift the top bar; absent (not "0") at zero; capped at "9+".
//   * the panel is BODY-APPENDED at the house overlay layer (the .col-popover
//     mechanism), so no ancestor can clip it; it closes on outside click, Esc
//     (focus returns to the bell) and route change; opening shifts nothing.
//   * toasts appear ONLY for categories whose urgency is "toast" AND whose
//     per-user pref allows it — the server decides both; this file never does.
(function (window) {
  const App = (window.App = window.App || {});

  const PANEL_ID = "notif-panel";
  // VIEWPORT FIT LAW: the panel never extends past the bottom of the actual
  // window. 480px is a comfort cap, not a promise — the real limit is whatever
  // room is left below the bell, and it is recomputed on open, on resize and
  // on tab switch (a taller tab must not push the footer off-screen).
  const PANEL_COMFORT_MAX = 480;   // the shipped feel on a big screen
  const PANEL_MIN = 240;           // below this the panel is useless, so it climbs instead
  const PANEL_MARGIN = 16;         // --sp-4: breathing room above the window edge
  const PANEL_GAP = 8;             // --sp-2: gap between the bell and the panel
  let bellEl = null;
  let badgeEl = null;
  let lastSeenIds = null;   // ids already known — anything new may toast
  let pollTimer = null;
  let categories = [];

  function esc(s) { return App.util.esc(s); }
  function el(tag, cls, html) { return App.util.el(tag, cls, html); }

  function relTime(iso) {
    const then = new Date(iso).getTime();
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 1) return "now";
    if (mins < 60) return mins + "m";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h";
    const days = Math.round(hrs / 24);
    if (days < 7) return days + "d";
    return Math.round(days / 7) + "w";
  }

  function setBadge(count) {
    if (!bellEl) return;
    const n = Math.max(0, Number(count) || 0);
    if (!n) { if (badgeEl) { badgeEl.remove(); badgeEl = null; } return; }
    if (!badgeEl) { badgeEl = el("span", "notif-badge"); bellEl.appendChild(badgeEl); }
    badgeEl.textContent = n > 9 ? "9+" : String(n);
    badgeEl.setAttribute("aria-label", n + " unread notifications");
  }

  let panelCleanup = null;
  function closePanel(returnFocus) {
    const p = document.getElementById(PANEL_ID);
    if (p) p.remove();
    if (panelCleanup) { try { panelCleanup(); } catch (e) { /* */ } panelCleanup = null; }
    if (returnFocus && bellEl) { try { bellEl.focus(); } catch (e) { /* */ } }
  }

  /** Place and SIZE the panel against the live viewport. Returns the metrics so
   *  a test (or a curious human) can check the arithmetic. */
  function fitPanel(pop) {
    if (!pop || !bellEl) return null;
    const rect = bellEl.getBoundingClientRect();
    const width = 400;
    const viewportH = window.innerHeight || 800;
    let topInViewport = rect.bottom + PANEL_GAP;
    let available = viewportH - topInViewport - PANEL_MARGIN;
    if (available < PANEL_MIN) {
      // Not enough room below the bell: climb toward the top of the window
      // (rather than flipping above it, which would cover the very page the
      // panel is describing) and take what's left.
      topInViewport = Math.max(PANEL_MARGIN, viewportH - PANEL_MARGIN - PANEL_MIN);
      available = viewportH - topInViewport - PANEL_MARGIN;
    }
    const maxHeight = Math.max(PANEL_MIN, Math.min(PANEL_COMFORT_MAX, available));
    pop.style.setProperty("top", (topInViewport + window.scrollY) + "px");
    pop.style.setProperty("left", Math.max(8, Math.min(rect.right + window.scrollX - width, window.innerWidth - width - 8)) + "px");
    pop.style.setProperty("max-height", maxHeight + "px");
    return { topInViewport, maxHeight, viewportH, bottomInViewport: topInViewport + maxHeight, margin: PANEL_MARGIN };
  }

  function rowEl(n) {
    const row = el("button", "notif-row" + (n.readAt ? "" : " notif-unread"));
    row.type = "button";
    const ic = el("span", "notif-row-ic", App.icons ? App.icons.forNotificationCategory(n.category) : "");
    row.appendChild(ic);
    const mid = el("span", "notif-row-mid");
    mid.appendChild(el("span", "notif-row-title", esc(n.title)));
    if (n.body) mid.appendChild(el("span", "notif-row-body cell-muted", esc(n.body)));
    row.appendChild(mid);
    row.appendChild(el("span", "notif-row-time cell-muted", esc(relTime(n.createdAt))));
    row.onclick = async () => {
      try { await App.portalApi("/api/notifications/" + encodeURIComponent(n.id) + "/read", { method: "POST" }); } catch (e) { /* read state is best-effort */ }
      closePanel(false);
      refreshCount();
      if (n.link) App.go(n.link);
    };
    return row;
  }

  let suggestionCount = 0; // open suggestions the CURRENT user may act on
  function tabsEl(active, onPick) {
    const wrap = el("div", "notif-tabs");
    [["activity", "Activity"], ["suggestions", "Suggestions"]].forEach(([k, label]) => {
      const b = el("button", "seg-btn" + (k === active ? " seg-on" : ""), esc(label));
      b.type = "button";
      // The tab's OWN count pill — distinct from the bell badge, which counts
      // unread ACTIVITY only (the batch-30 contract, unchanged).
      if (k === "suggestions" && suggestionCount > 0) b.appendChild(el("span", "notif-tabcount", String(suggestionCount > 9 ? "9+" : suggestionCount)));
      b.onclick = () => onPick(k);
      wrap.appendChild(b);
    });
    return wrap;
  }

  /** A suggestion CARD: type label -> finding -> transparency line -> actions. */
  function suggestionCard(sg, onGone, opts) {
    const compact = !!(opts && opts.compact);   // panel density; the page uses the roomy default
    const card = el("div", "card notif-sug" + (compact ? " notif-sug--compact" : ""));
    const head = el("div", "notif-sug-head cell-muted");
    head.appendChild(el("span", "notif-sug-ic", App.icons ? App.icons.forNotificationCategory("suggestion") : ""));
    head.appendChild(el("span", null, esc(TYPE_LABELS[sg.type] || "Suggestion")));
    card.appendChild(head);
    card.appendChild(el("div", "notif-sug-title", esc(sg.title)));
    if (sg.transparency) card.appendChild(el("div", "notif-sug-why cell-muted", esc(sg.transparency)));
    const errLine = el("div", "notif-sug-err");
    errLine.style.setProperty("display", "none");
    card.appendChild(errLine);
    const row = el("div", "notif-sug-actions");
    const primary = el("button", "btn btn-primary btn-sm", esc(sg.verb || "Do it"));
    primary.type = "button";
    const dismiss = el("button", "btn btn-ghost btn-sm notif-sug-dismiss", "Dismiss");
    dismiss.type = "button";
    primary.onclick = async () => {
      primary.disabled = true; dismiss.disabled = true;
      const label = primary.textContent; primary.textContent = "Working\u2026";
      try {
        const r = await App.portalApi("/api/suggestions/" + encodeURIComponent(sg.id) + "/accept", { method: "POST" });
        // Replaced IN PLACE by a confirmation row (it leaves the list next open).
        card.innerHTML = "";
        card.classList.add("notif-sug-done");
        const conf = el("div", "notif-sug-conf");
        conf.appendChild(el("span", null, esc(r.outcome || "Done")));
        if (r.link) {
          const a2 = el("a", "btn btn-ghost btn-sm", "Open");
          a2.href = r.link;
          a2.onclick = () => { closePanel(false); };
          conf.appendChild(a2);
        }
        card.appendChild(conf);
        suggestionCount = Math.max(0, suggestionCount - 1);
      } catch (e) {
        primary.disabled = false; dismiss.disabled = false; primary.textContent = label;
        errLine.textContent = e.message || "That didn't work.";
        errLine.style.setProperty("display", "");
      }
    };
    dismiss.onclick = async () => {
      try { await App.portalApi("/api/suggestions/" + encodeURIComponent(sg.id) + "/dismiss", { method: "POST" }); }
      catch (e) { errLine.textContent = e.message || "Couldn't dismiss."; errLine.style.setProperty("display", ""); return; }
      card.remove();
      suggestionCount = Math.max(0, suggestionCount - 1);
      if (onGone) onGone();
      App.util.toast("Suggestion dismissed", false, {
        label: "Undo",
        onClick: async () => { try { await App.portalApi("/api/suggestions/" + encodeURIComponent(sg.id) + "/undismiss", { method: "POST" }); suggestionCount += 1; } catch (e2) { /* */ } },
      });
    };
    row.appendChild(primary); row.appendChild(dismiss);
    card.appendChild(row);
    return card;
  }
  const TYPE_LABELS = {
    repeated_phrase_field: "Repeated wording",
    manual_message_pattern: "Repeated manual step",
    unused_module: "Unused module",
    stage_stall: "Pipeline insight",
  };

  async function openPanel() {
    if (document.getElementById(PANEL_ID)) { closePanel(true); return; }
    const pop = el("div", "col-popover notif-panel");
    pop.id = PANEL_ID;
    pop.addEventListener("click", (e) => e.stopPropagation());
    const body = el("div", "notif-body");
    let tab = "activity";
    const head = el("div", "notif-head");
    const paintTabs = () => {
      head.innerHTML = "";
      head.appendChild(tabsEl(tab, (k) => { tab = k; paintTabs(); paint(); fitPanel(pop); }));
      // "See all" lives in the pinned HEADER now: it used to sit in the footer,
      // which is the first thing to fall off the bottom of a laptop screen.
      const headActions = el("div", "notif-head-actions");
      headActions.appendChild(seeAll);
      head.appendChild(headActions);
    };
    const paint = async () => {
      body.innerHTML = "";
      if (tab === "suggestions") {
        body.appendChild(el("div", "notif-empty cell-muted", "Loading\u2026"));
        try {
          const r = await App.portalApi("/api/suggestions");
          body.innerHTML = "";
          const items = (r && r.items) || [];
          suggestionCount = (r && r.openCount) || 0;
          paintTabs();
          if (!items.length) { body.appendChild(el("div", "notif-empty cell-muted", "Nothing right now — Clarity will post suggestions here as it spots patterns.")); return; }
          items.forEach((sg) => body.appendChild(suggestionCard(sg, () => { if (!body.querySelector(".notif-sug")) paint(); }, { compact: true })));
        } catch (e) {
          body.innerHTML = "";
          body.appendChild(el("div", "notif-empty cell-muted", "Couldn't load suggestions."));
        }
        return;
      }
      body.appendChild(el("div", "notif-empty cell-muted", "Loading…"));
      try {
        const r = await App.portalApi("/api/notifications?limit=20");
        body.innerHTML = "";
        visitorMode = !!(r && r.visitor);
        setBadge(r ? r.unread : null);
        allRead.style.setProperty("display", visitorMode ? "none" : "");
        if (visitorMode) body.appendChild(el("div", "notif-visitor cell-muted", "You're viewing as an admin \u2014 this is the workspace's activity, not your own."));
        const items = (r && r.items) || [];
        if (!items.length) { body.appendChild(el("div", "notif-empty cell-muted", visitorMode ? "Nothing has happened in this workspace yet." : "Nothing new \u2014 activity will show up here.")); return; }
        items.forEach((n) => body.appendChild(rowEl(n)));
      } catch (e) {
        body.innerHTML = "";
        body.appendChild(el("div", "notif-empty cell-muted", "Couldn't load notifications."));
      }
    };
    const foot = el("div", "notif-foot");
    // VISUAL NORMALIZATION: house small ghost buttons, not bespoke links.
    const allRead = el("button", "btn btn-ghost btn-sm notif-foot-l", "Mark all read");
    allRead.type = "button";
    allRead.onclick = async () => {
      try { await App.portalApi("/api/notifications/read-all", { method: "POST" }); } catch (e) { /* */ }
      refreshCount(); paint();
    };
    const seeAll = el("button", "btn btn-ghost btn-sm notif-head-see", "See all");
    seeAll.type = "button";
    seeAll.onclick = () => { closePanel(false); App.go("#/notifications"); };
    foot.appendChild(allRead);
    paintTabs();
    pop.appendChild(head);
    pop.appendChild(body);
    pop.appendChild(foot);
    document.body.appendChild(pop);
    // Anchored below-RIGHT of the bell in document coords (body-appended, so no
    // ancestor can clip it), then FITTED to the live viewport.
    fitPanel(pop);
    paint();
    // PERSISTENT listeners (not {once:true}): clicks INSIDE the panel are
    // normal — tabs, Mark all read — and must not consume the outside-click
    // watcher. Everything is torn down together in closePanel().
    const onKey = (e) => { if (e.key === "Escape") closePanel(true); };
    const onDocClick = (ev) => {
      if (ev.target && (ev.target === bellEl || (bellEl && bellEl.contains(ev.target)) || pop.contains(ev.target))) return;
      closePanel(false);
    };
    const onResize = () => fitPanel(pop);
    const onHash = () => closePanel(false); // route change closes it
    document.addEventListener("keydown", onKey);
    setTimeout(() => document.addEventListener("click", onDocClick), 0);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("resize", onResize);
    panelCleanup = () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("resize", onResize);
    };
  }

  /** Poll the count; toast anything NEW whose category is toast-urgency and
   *  whose per-user preference allows it (the server already applied both). */
  async function refreshCount(withToasts) {
    try {
      const r = await App.portalApi("/api/notifications?limit=10");
      categories = (r && r.categories) || categories;
      visitorMode = !!(r && r.visitor);
      setBadge(r ? r.unread : null);
      try { const sr = await App.portalApi("/api/suggestions?limit=1"); suggestionCount = (sr && sr.openCount) || 0; } catch (e2) { /* the tab pill is cosmetic */ }
      const items = (r && r.items) || [];
      if (withToasts && lastSeenIds) {
        const byKey = {};
        categories.forEach((c) => { byKey[c.key] = c; });
        items.filter((n) => !n.readAt && lastSeenIds.indexOf(n.id) === -1).reverse().forEach((n) => {
          const cat = byKey[n.category];
          if (!cat || cat.urgency !== "toast") return; // TOAST SCARCITY: badge-only stays silent
          App.util.toast(n.title, false, n.link ? { label: "Open", onClick: () => App.go(n.link) } : null);
        });
      }
      lastSeenIds = items.map((n) => n.id);
    } catch (e) { /* the bell is never allowed to break a page */ }
  }

  /** Mount the bell into the top bar (called by buildShell, before the gear). */
  function mount(host) {
    bellEl = el("button", "icon-btn notif-bell");
    bellEl.type = "button";
    bellEl.title = "Notifications";
    bellEl.setAttribute("aria-label", "Notifications");
    bellEl.innerHTML = App.icons ? App.icons.BELL_ICON : "&#128276;";
    bellEl.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openPanel(); };
    host.appendChild(bellEl);
    badgeEl = null;
    refreshCount(false);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => refreshCount(true), 60000);
    if (!window.__notifHashHook) {
      window.__notifHashHook = true;
      window.addEventListener("hashchange", () => { if (bellEl) refreshCount(true); });
    }
    return bellEl;
  }

  function stop() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } closePanel(false); bellEl = null; badgeEl = null; lastSeenIds = null; }

  // ------------------------------------------------------------ full page
  /** #/notifications — the same rows at full width, with category CHIPS (the
   *  house filter-chips pattern), a read/unread filter, text search over
   *  title+body, and the house "Load more" pagination (the audit log's
   *  precedent). Not a nav item, not lockable. */
  /** #/notifications — the full page.
   *
   *  ACTIVITY is homogeneous, so it is a real house TABLE (App.table.mount),
   *  which brings the house toolbar, Filters rail, search box, sorting and
   *  empty state with it — the same machinery every module list page uses, and
   *  the reason the toolbar now aligns to the content container by
   *  construction rather than by hand.
   *
   *  SUGGESTIONS is heterogeneous (each item has its own verb), so columns
   *  would be dishonest: it uses the SAME list machinery with a single content
   *  column plus an actions column, which reads as compact rows.
   */
  async function renderPage(host) {
    if (!host) return;
    host.innerHTML = "";
    const wrap = el("div", "notif-page");
    const h = el("div", "page-head");
    h.appendChild(el("h1", null, "Notifications"));
    wrap.appendChild(h);

    // House underline tabs — the same component as Settings → AI Receptionist
    // (portal.js #mountAiSettings), classes byte-for-byte.
    const bar = el("div", "settings-tabs");
    const content = el("div", "notif-page-content");
    wrap.appendChild(bar);
    wrap.appendChild(content);
    host.appendChild(wrap);

    let tab = "activity";
    const paintBar = () => {
      bar.innerHTML = "";
      [["activity", "Activity"], ["suggestions", "Suggestions"]].forEach(([k, label]) => {
        const b = el("button", null, esc(label));
        b.className = "settings-tab" + (tab === k ? " active" : "");
        b.onclick = () => { if (tab !== k) { tab = k; paintBar(); void paintTab(); } };
        bar.appendChild(b);
      });
    };

    async function paintActivity() {
      content.innerHTML = "";
      const host2 = el("div");
      content.appendChild(host2);
      let data;
      try { data = await App.portalApi("/api/notifications?limit=200"); }
      catch (e) { content.appendChild(el("div", "empty", "<h3>Couldn't load notifications</h3><p>Try again in a moment.</p>")); return; }
      categories = (data && data.categories) || categories;
      visitorMode = !!(data && data.visitor);
      const labelFor = {};
      categories.forEach((c) => { labelFor[c.key] = c.label; });
      const rows = ((data && data.items) || []).map((n) => ({
        id: n.id, category: n.category, categoryLabel: labelFor[n.category] || n.category,
        title: n.title, body: n.body || "", link: n.link || null,
        when: n.createdAt, whenLabel: relTime(n.createdAt), readAt: n.readAt,
      }));
      App.table.mount({
        container: host2,
        rows,
        rowId: (r) => r.id,
        tableId: "notif-activity",
        defaultSort: "when",
        defaultSortDir: "desc",
        rowClass: (r) => (r.readAt ? "" : "notif-row-unread"),
        emptyHtml: `<div class="empty"><h3>Nothing new</h3><p>Activity will show up here as things happen in this workspace.</p></div>`,
        columns: [
          { key: "categoryLabel", label: "Kind", cellClass: "notif-col-kind", get: (r) => r.categoryLabel,
            render: (r) => `<span class="notif-col-kindwrap"><span class="notif-row-ic">${App.icons ? App.icons.forNotificationCategory(r.category) : ""}</span>${esc(r.categoryLabel)}</span>` },
          { key: "title", label: "Notification", get: (r) => `${r.title} ${r.body || ""}`.trim(),
            render: (r) => `<span class="notif-col-title">${esc(r.title)}</span>${r.body ? `<span class="notif-col-body cell-muted">${esc(r.body)}</span>` : ""}` },
          { key: "when", label: "When", cellClass: "notif-col-when", type: "date", get: (r) => r.when,
            render: (r) => `<span title="${esc(new Date(r.when).toLocaleString())}">${esc(r.whenLabel)}</span>` },
        ],
        onRowClick: async (r) => {
          if (!visitorMode) { try { await App.portalApi("/api/notifications/" + encodeURIComponent(r.id) + "/read", { method: "POST" }); } catch (e) { /* best effort */ } }
          refreshCount();
          if (r.link) App.go(r.link);
        },
      });
    }

    async function paintSuggestions() {
      content.innerHTML = "";
      const host2 = el("div");
      content.appendChild(host2);
      let open, acc, dis;
      try {
        [open, acc, dis] = await Promise.all([
          App.portalApi("/api/suggestions?status=pending&limit=100"),
          App.portalApi("/api/suggestions?status=accepted&limit=50"),
          App.portalApi("/api/suggestions?status=dismissed&limit=50"),
        ]);
      } catch (e) { content.appendChild(el("div", "empty", "<h3>Couldn't load suggestions</h3><p>Try again in a moment.</p>")); return; }
      suggestionCount = (open && open.openCount) || 0;
      const rows = ((open && open.items) || []).map((s) => ({
        id: s.id, type: s.type, typeLabel: TYPE_LABELS[s.type] || "Suggestion",
        title: s.title, why: s.transparency || "", verb: s.verb || "Do it", actionType: s.actionType,
      }));
      App.table.mount({
        container: host2,
        rows,
        rowId: (r) => r.id,
        tableId: "notif-suggestions",
        rowClass: () => "notif-sug-row",
        emptyHtml: `<div class="empty"><h3>Nothing right now</h3><p>Clarity will post suggestions here as it spots patterns in your own data.</p></div>`,
        columns: [
          { key: "typeLabel", label: "Kind", cellClass: "notif-col-kind", get: (r) => r.typeLabel,
            render: (r) => `<span class="notif-col-kindwrap"><span class="notif-row-ic">${App.icons ? App.icons.forNotificationCategory("suggestion") : ""}</span>${esc(r.typeLabel)}</span>` },
          { key: "title", label: "What Clarity noticed", get: (r) => `${r.title} ${r.why || ""}`.trim(),
            render: (r) => `<span class="notif-sugrow-title" title="${esc(r.title)}">${esc(r.title)}</span>${r.why ? `<span class="notif-sugrow-why cell-muted">${esc(r.why)}</span>` : ""}` },
          { key: "actions", label: "", sortable: false, cellClass: "notif-col-actions", get: () => "", render: (r) => `<span class="notif-sugrow-actions"><button type="button" class="btn btn-primary btn-sm" data-sug-accept="${esc(r.id)}">${esc(r.verb)}</button><button type="button" class="btn btn-ghost btn-sm" data-sug-dismiss="${esc(r.id)}">Dismiss</button></span>` },
        ],
      });
      // Inline actions: the table renders cells as HTML, so the buttons are
      // wired by delegation on the container (row clicks already ignore
      // clicks that land on a button).
      host2.onclick = async (ev) => {
        const acceptBtn = ev.target && ev.target.closest ? ev.target.closest("[data-sug-accept]") : null;
        const dismissBtn = ev.target && ev.target.closest ? ev.target.closest("[data-sug-dismiss]") : null;
        if (!acceptBtn && !dismissBtn) return;
        const id = (acceptBtn || dismissBtn).getAttribute(acceptBtn ? "data-sug-accept" : "data-sug-dismiss");
        const btn = acceptBtn || dismissBtn;
        btn.disabled = true;
        try {
          if (acceptBtn) {
            const r2 = await App.portalApi("/api/suggestions/" + encodeURIComponent(id) + "/accept", { method: "POST" });
            App.util.toast(r2.outcome || "Done");
          } else {
            await App.portalApi("/api/suggestions/" + encodeURIComponent(id) + "/dismiss", { method: "POST" });
            App.util.toast("Suggestion dismissed", false, { label: "Undo", onClick: async () => { try { await App.portalApi("/api/suggestions/" + encodeURIComponent(id) + "/undismiss", { method: "POST" }); void paintSuggestions(); } catch (e) { /* */ } } });
          }
        } catch (e) { App.util.toast(e.message || "That didn't work", true); btn.disabled = false; return; }
        void paintSuggestions();
      };
      // History of what's already been decided, beneath the open list.
      const history = (((acc && acc.items) || []).concat(((dis && dis.items) || [])))
        .sort((a2, b2) => new Date(b2.actedAt || b2.createdAt) - new Date(a2.actedAt || a2.createdAt));
      if (history.length) {
        content.appendChild(el("div", "field-label notif-hist-h", "Earlier"));
        const card = el("div", "card notif-hist-card");
        history.forEach((s) => {
          const row = el("div", "notif-sug-hist");
          row.appendChild(el("span", null, esc(s.title)));
          row.appendChild(el("span", "cell-muted", esc(s.status === "accepted" ? (s.outcome || "Accepted") : "Dismissed")));
          row.appendChild(el("span", "cell-muted", esc(s.actedAt ? new Date(s.actedAt).toLocaleDateString() : "")));
          card.appendChild(row);
        });
        content.appendChild(card);
      }
    }

    const paintTab = () => (tab === "activity" ? paintActivity() : paintSuggestions());
    paintBar();
    await paintTab();
  }

  App.notifications = { mount, stop, refreshCount, openPanel, closePanel, relTime, setBadge, renderPage, fitPanel };
})(typeof window !== "undefined" ? window : globalThis);
