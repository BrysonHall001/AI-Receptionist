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
  function suggestionCard(sg, onGone) {
    const card = el("div", "card notif-sug");
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
    const paintTabs = () => { head.innerHTML = ""; head.appendChild(tabsEl(tab, (k) => { tab = k; paintTabs(); paint(); })); };
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
          items.forEach((sg) => body.appendChild(suggestionCard(sg, () => { if (!body.querySelector(".notif-sug")) paint(); })));
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
    const seeAll = el("button", "btn btn-ghost btn-sm notif-foot-r", "See all");
    seeAll.type = "button";
    seeAll.onclick = () => { closePanel(false); App.go("#/notifications"); };
    foot.appendChild(allRead); foot.appendChild(seeAll);
    paintTabs();
    pop.appendChild(head);
    pop.appendChild(body);
    pop.appendChild(foot);
    document.body.appendChild(pop);
    // anchored below-RIGHT of the bell, in document coords (body-appended, so no
    // ancestor can clip it); clamped to the viewport.
    const rect = bellEl.getBoundingClientRect();
    const width = 400;
    pop.style.setProperty("top", (rect.bottom + window.scrollY + 8) + "px");
    pop.style.setProperty("left", Math.max(8, Math.min(rect.right + window.scrollX - width, window.innerWidth - width - 8)) + "px");
    paint();
    // PERSISTENT listeners (not {once:true}): clicks INSIDE the panel are
    // normal — tabs, Mark all read — and must not consume the outside-click
    // watcher. Everything is torn down together in closePanel().
    const onKey = (e) => { if (e.key === "Escape") closePanel(true); };
    const onDocClick = (ev) => {
      if (ev.target && (ev.target === bellEl || (bellEl && bellEl.contains(ev.target)) || pop.contains(ev.target))) return;
      closePanel(false);
    };
    const onHash = () => closePanel(false); // route change closes it
    document.addEventListener("keydown", onKey);
    setTimeout(() => document.addEventListener("click", onDocClick), 0);
    window.addEventListener("hashchange", onHash);
    panelCleanup = () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("hashchange", onHash);
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
  async function renderPage(host) {
    if (!host) return;
    host.innerHTML = "";
    const wrap = el("div", "notif-page");
    const h = el("div", "page-head");
    h.appendChild(el("h1", null, "Notifications"));
    wrap.appendChild(h);

    const state = { cats: [], unreadOnly: false, q: "", before: null, items: [] };
    const toolbar = el("div", "toolbar notif-toolbar");
    const left = el("div", "toolbar-left");
    const chips = el("div", "filter-chips");
    left.appendChild(chips);
    const right = el("div", "toolbar-right");
    const search = el("input", "search-input");
    search.type = "search"; search.placeholder = "Search notifications…";
    right.appendChild(App.util.searchBox ? App.util.searchBox(search) : search);
    toolbar.appendChild(left); toolbar.appendChild(right);
    wrap.appendChild(toolbar);

    const listCard = el("div", "card notif-page-card");
    const listHost = el("div", "notif-page-list");
    listCard.appendChild(listHost);
    const moreWrap = el("div", "notif-page-more");
    const moreBtn = el("button", "btn btn-ghost btn-sm", "Load more");
    moreWrap.appendChild(moreBtn);
    listCard.appendChild(moreWrap);
    wrap.appendChild(listCard);
    host.appendChild(wrap);

    // Emergent layer 2: the page gains a SUGGESTIONS view alongside Activity,
    // using the same chip row (the house filter pattern) as its switch.
    let view = "activity";
    const viewRow = el("div", "filter-chips notif-viewrow");
    const paintViews = () => {
      viewRow.innerHTML = "";
      [["activity", "Activity"], ["suggestions", "Suggestions"]].forEach(([k, label]) => {
        const b = el("button", "chip notif-chip" + (view === k ? " notif-chip-on" : ""), esc(label));
        b.type = "button";
        b.onclick = () => { view = k; paintViews(); if (view === "suggestions") paintSuggestions(); else reload(); };
        viewRow.appendChild(b);
      });
    };
    async function paintSuggestions() {
      chips.innerHTML = "";
      moreWrap.style.setProperty("display", "none");
      listHost.innerHTML = "";
      listHost.appendChild(el("div", "notif-empty cell-muted", "Loading\u2026"));
      try {
        const [openR, accR, disR] = await Promise.all([
          App.portalApi("/api/suggestions?status=pending&limit=50"),
          App.portalApi("/api/suggestions?status=accepted&limit=50"),
          App.portalApi("/api/suggestions?status=dismissed&limit=50"),
        ]);
        if (view !== "suggestions") return; // ditto, the other way
        listHost.innerHTML = "";
        const open = (openR && openR.items) || [];
        if (!open.length) listHost.appendChild(el("div", "notif-empty cell-muted", "Nothing right now — Clarity will post suggestions here as it spots patterns."));
        open.forEach((sg) => listHost.appendChild(suggestionCard(sg, () => paintSuggestions())));
        const history = ((accR && accR.items) || []).concat((disR && disR.items) || []);
        if (history.length) {
          listHost.appendChild(el("div", "field-label notif-hist-h", "Earlier"));
          history.sort((a2, b2) => new Date(b2.actedAt || b2.createdAt) - new Date(a2.actedAt || a2.createdAt)).forEach((sg) => {
            const row = el("div", "notif-sug-hist");
            row.appendChild(el("span", null, esc(sg.title)));
            row.appendChild(el("span", "cell-muted", esc(sg.status === "accepted" ? (sg.outcome || "Accepted") : "Dismissed")));
            row.appendChild(el("span", "cell-muted", esc(sg.actedAt ? new Date(sg.actedAt).toLocaleDateString() : "")));
            listHost.appendChild(row);
          });
        }
      } catch (e) {
        listHost.innerHTML = "";
        listHost.appendChild(el("div", "notif-empty cell-muted", "Couldn't load suggestions."));
      }
    }
    const paintChips = () => {
      chips.innerHTML = "";
      const unreadChip = el("button", "chip notif-chip" + (state.unreadOnly ? " notif-chip-on" : ""), "Unread only");
      unreadChip.type = "button";
      unreadChip.onclick = () => { state.unreadOnly = !state.unreadOnly; reload(); };
      chips.appendChild(unreadChip);
      categories.forEach((c) => {
        const on = state.cats.indexOf(c.key) !== -1;
        const b = el("button", "chip notif-chip" + (on ? " notif-chip-on" : ""), esc(c.label));
        b.type = "button";
        b.onclick = () => {
          state.cats = on ? state.cats.filter((k) => k !== c.key) : state.cats.concat([c.key]);
          reload();
        };
        chips.appendChild(b);
      });
    };

    const paintRows = () => {
      listHost.innerHTML = "";
      if (!state.items.length) { listHost.appendChild(el("div", "notif-empty cell-muted", "Nothing here yet.")); return; }
      state.items.forEach((n) => listHost.appendChild(rowEl(n)));
    };

    async function fetchPage(append) {
      const params = ["limit=25"];
      if (state.cats.length) params.push("categories=" + encodeURIComponent(state.cats.join(",")));
      if (state.unreadOnly) params.push("unread=1");
      if (state.q) params.push("q=" + encodeURIComponent(state.q));
      if (append && state.before) params.push("before=" + encodeURIComponent(state.before));
      try {
        const r = await App.portalApi("/api/notifications?" + params.join("&"));
        if (view !== "activity") return; // the user switched while this was in flight
        categories = (r && r.categories) || categories;
        const items = (r && r.items) || [];
        state.items = append ? state.items.concat(items) : items;
        state.before = items.length ? items[items.length - 1].createdAt : state.before;
        moreWrap.style.setProperty("display", r && r.hasMore ? "" : "none");
        paintChips(); paintRows();
        setBadge(r && r.unread);
      } catch (e) {
        listHost.innerHTML = "";
        listHost.appendChild(el("div", "notif-empty cell-muted", "Couldn't load notifications."));
      }
    }
    function reload() { state.before = null; return fetchPage(false); }
    wrap.insertBefore(viewRow, toolbar); // the view switch sits above the filters
    paintViews();
    moreBtn.onclick = () => fetchPage(true);
    let searchTimer = null;
    search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = search.value.trim(); reload(); }, 250); };
    await reload();
  }

  App.notifications = { mount, stop, refreshCount, openPanel, closePanel, relTime, setBadge, renderPage };
})(typeof window !== "undefined" ? window : globalThis);
