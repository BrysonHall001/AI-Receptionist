/* GLOBAL SEARCH — the top-bar input and its results panel.
 *
 * Server results (records, contacts, calls) come from /api/search, already
 * permission-filtered. GUIDES are searched HERE, in the browser, because the
 * Learning Center lives in this bundle — App.learn.activeGuides() has already
 * resolved the tenant's variant and feature-tagging, so a guide the tenant
 * doesn't have can never appear.
 *
 * The panel follows the VIEWPORT FIT LAW: its height is computed from the live
 * viewport every time it opens and on resize, it scrolls internally, and
 * nothing renders below the fold.
 */
(function () {
  const App = window.App || (window.App = {});
  const { el, esc, debounce } = App.util;

  const MIN_CHARS = 2;
  const DEBOUNCE_MS = 250;
  const PANEL_MAX = 460;      // comfort cap; the viewport always wins
  const PANEL_MIN = 200;
  const PANEL_MARGIN = 16;    // --sp-4
  const PANEL_GAP = 6;

  let inputEl = null;
  let wrapEl = null;    // the house search-box that carries the input
  let panelEl = null;
  let focusIndex = -1;
  let rows = [];              // flat list of focusable result rows
  let lastQuery = "";

  /** Settings pages matching a query. The catalog is the one the settings page
   *  renders (portal.js SECTIONS), exposed for reuse — already filtered to what
   *  this person may open, so no separate permission check is needed here. */
  function settingsHits(q) {
    const cat = (App.portal && App.portal.settingsCatalog && App.portal.settingsCatalog()) || [];
    const needle = q.toLowerCase();
    return cat
      .filter((sx) => String(sx.label || "").toLowerCase().indexOf(needle) !== -1)
      .slice(0, 5)
      .map((sx) => ({
        type: "settings", id: sx.key, title: sx.label,
        context: "Settings", href: "#/settings/" + sx.key, at: null,
        exact: String(sx.label).toLowerCase() === needle,
      }));
  }

  /** Guides matching a query, from the set this tenant actually has. */
  function guideHits(q) {
    if (!App.learn || !App.learn.activeGuides) return [];
    const needle = q.toLowerCase();
    const out = [];
    try {
      App.learn.activeGuides().forEach((section) => {
        (section.items || []).forEach((it) => {
          const title = String(it.title || "");
          const body = (it.body || []).map((b) => (b && (b.p || b.tip || b.h || (Array.isArray(b.ul) ? b.ul.join(" ") : ""))) || "").join(" ");
          const hay = (title + " " + body).toLowerCase();
          if (hay.indexOf(needle) === -1) return;
          out.push({
            type: "guide",
            id: it.id,
            title: App.relabelText ? App.relabelText(title) : title,
            context: App.relabelText ? App.relabelText(section.cat || "Learning Center") : (section.cat || "Learning Center"),
            href: "#/learn?guide=" + encodeURIComponent(it.id),
            at: null,
            exact: title.toLowerCase() === needle,
            prefix: title.toLowerCase().indexOf(needle) === 0,
          });
        });
      });
    } catch (e) { /* the guide set is a convenience; never break search */ }
    out.sort((a, b) => (b.exact - a.exact) || (b.prefix - a.prefix) || a.title.localeCompare(b.title));
    return out.slice(0, 5);
  }

  /** Size and place the panel against the LIVE viewport. */
  function fitPanel() {
    if (!panelEl || !inputEl) return null;
    const rect = inputEl.getBoundingClientRect();
    const viewportH = window.innerHeight || 800;
    let top = rect.bottom + PANEL_GAP;
    let available = viewportH - top - PANEL_MARGIN;
    if (available < PANEL_MIN) {
      top = Math.max(PANEL_MARGIN, viewportH - PANEL_MARGIN - PANEL_MIN);
      available = viewportH - top - PANEL_MARGIN;
    }
    const maxHeight = Math.max(PANEL_MIN, Math.min(PANEL_MAX, available));
    const width = Math.max(320, Math.min(520, window.innerWidth - 32));
    panelEl.style.setProperty("top", (top + window.scrollY) + "px");
    panelEl.style.setProperty("left", Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - width - 8)) + "px");
    panelEl.style.setProperty("width", width + "px");
    panelEl.style.setProperty("max-height", maxHeight + "px");
    return { top, maxHeight, bottom: top + maxHeight, viewportH, margin: PANEL_MARGIN };
  }

  function closePanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; }
    rows = []; focusIndex = -1;
    window.removeEventListener("resize", fitPanel);
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = el("div", "gs-panel card");
    panelEl.id = "gs-panel";
    panelEl.setAttribute("role", "listbox");
    panelEl.addEventListener("click", (e) => e.stopPropagation());
    document.body.appendChild(panelEl);
    window.addEventListener("resize", fitPanel);
    fitPanel();
    return panelEl;
  }

  function paintState(html) {
    const p = ensurePanel();
    p.innerHTML = "";
    p.appendChild(el("div", "gs-state cell-muted", html));
    rows = []; focusIndex = -1;
    fitPanel();
  }

  function rowEl(hit) {
    const row = el("button", "gs-row");
    row.type = "button";
    row.setAttribute("role", "option");
    const ic = el("span", "gs-row-ic");
    ic.innerHTML = iconFor(hit);
    const mid = el("span", "gs-row-mid");
    const t = el("span", "gs-row-title", esc(hit.title || "(untitled)"));
    t.title = hit.title || "";
    mid.appendChild(t);
    const ctx = snippetEl(hit) || (hit.context ? contextEl(hit.context) : null);
    if (ctx) mid.appendChild(ctx);
    row.appendChild(ic); row.appendChild(mid);
    if (hit.at) row.appendChild(el("span", "gs-row-meta cell-muted", esc(shortDate(hit.at))));
    row.onclick = () => go(hit);
    return row;
  }

  /** A plain context caption. */
  function contextEl(text) {
    const c = el("span", "gs-row-ctx cell-muted");
    c.textContent = text;
    c.title = text;
    return c;
  }

  /** The snippet, with the matched terms emphasised.
   *  The payload is DATA — { text, marks: [[start, end], …] } — so the text is
   *  written with textContent and only OUR OWN <mark> elements are created.
   *  There is no path by which stored content becomes markup. */
  function snippetEl(hit) {
    const sn = hit && hit.snippet;
    if (!sn || typeof sn.text !== "string" || !sn.text) return null;
    const wrap = el("span", "gs-row-ctx cell-muted");
    wrap.title = sn.text;
    const marks = Array.isArray(sn.marks) ? sn.marks.slice(0, 12) : [];
    let at = 0;
    marks.forEach((m) => {
      const start = Math.max(at, Math.min(sn.text.length, m[0] | 0));
      const end = Math.max(start, Math.min(sn.text.length, m[1] | 0));
      if (start > at) wrap.appendChild(document.createTextNode(sn.text.slice(at, start)));
      const mk = el("mark", "gs-mark");
      mk.textContent = sn.text.slice(start, end);
      wrap.appendChild(mk);
      at = end;
    });
    if (at < sn.text.length) wrap.appendChild(document.createTextNode(sn.text.slice(at)));
    return wrap;
  }

  function shortDate(iso) {
    try { return new Date(iso).toLocaleDateString(); } catch (e) { return ""; }
  }

  function iconFor(hit) {
    if (!App.icons) return "";
    if (hit.type === "contact") return App.icons.forModuleKey("contact");
    if (hit.type === "call") return App.icons.forNotificationCategory("call_missed_or_failed");
    if (hit.type === "guide") return App.icons.forNavHref ? App.icons.forNavHref("#/learn") : "";
    if (hit.type === "settings") return App.icons.forNavHref ? App.icons.forNavHref("#/settings") : "";
    if (hit.type === "automation") return App.icons.forNotificationCategory("automation_failed");
    if (hit.type === "template" || hit.type === "survey") return App.icons.forNavHref ? App.icons.forNavHref("#/communication") : "";
    if (hit.type === "dashboard") return App.icons.forNavHref ? App.icons.forNavHref("#/reports") : "";
    const key = (hit.groupKey || "").indexOf("record:") === 0 ? hit.groupKey.slice(7) : "";
    return key ? App.icons.forModuleKey(key) : App.icons.forModuleKey("general");
  }

  function go(hit) {
    closePanel();
    if (inputEl) inputEl.blur();
    if (hit && hit.href) App.go(hit.href);
  }

  function paintResults(result, guides) {
    const p = ensurePanel();
    p.innerHTML = "";
    rows = []; focusIndex = -1;
    const groups = (result.groups || []).slice();
    const settings = settingsHits(result.query || lastQuery || "");
    if (settings.length) groups.push({ key: "settings", label: "Settings", hits: settings });
    if (guides.length) groups.push({ key: "guide", label: "Guides", hits: guides });
    if (!groups.length) { paintState("Nothing matched \u201c" + esc(result.query || lastQuery) + "\u201d."); return; }
    groups.forEach((g) => {
      p.appendChild(el("div", "gs-group field-label", esc(g.label)));
      (g.hits || []).forEach((h) => {
        const r = rowEl({ ...h, groupKey: h.groupKey || g.key });
        p.appendChild(r);
        rows.push(r);
      });
    });
    // SEE ALL — the house text button in the panel footer, matching batch 34's
    // See-all treatment (which lives in the notification panel's chrome).
    const foot = el("div", "gs-foot");
    const seeAll = el("button", "btn btn-ghost btn-sm", result.truncated ? "See all results" : "Open in full page");
    seeAll.onclick = () => { const q = (inputEl && inputEl.value.trim()) || lastQuery; closePanel(); App.go("#/search?q=" + encodeURIComponent(q)); };
    foot.appendChild(seeAll);
    p.appendChild(foot);
    fitPanel();
  }

  // ---- recent searches: per user, per tenant portal ----
  let recents = [];
  async function loadRecents() {
    try { const r = await App.portalApi("/api/search/recent"); recents = (r && r.recent) || []; }
    catch (e) { recents = []; }
    return recents;
  }
  function remember(q) {
    // fire-and-forget: a search must never wait on its own history
    App.portalApi("/api/search/recent", { method: "POST", body: JSON.stringify({ q }) })
      .then((r) => { recents = (r && r.recent) || recents; })
      .catch(() => { /* history is a convenience */ });
  }
  function paintRecents() {
    const p = ensurePanel();
    p.innerHTML = "";
    rows = []; focusIndex = -1;
    if (!recents.length) { p.appendChild(el("div", "gs-state cell-muted", "Start typing to search this portal.")); fitPanel(); return; }
    const head = el("div", "gs-group gs-recent-head");
    head.appendChild(el("span", "field-label", "Recent"));
    const clear = el("button", "btn btn-ghost btn-sm", "Clear");
    clear.onclick = async (e) => {
      e.stopPropagation();
      recents = [];
      try { await App.portalApi("/api/search/recent", { method: "DELETE" }); } catch (err) { /* */ }
      paintRecents();
    };
    head.appendChild(clear);
    p.appendChild(head);
    recents.forEach((q) => {
      const row = el("button", "gs-row");
      row.type = "button";
      const ic = el("span", "gs-row-ic");
      ic.innerHTML = (App.icons && App.icons.forNavHref) ? App.icons.forNavHref("#/learn") : "";
      const mid = el("span", "gs-row-mid");
      const t2 = el("span", "gs-row-title");
      t2.textContent = q;
      mid.appendChild(t2);
      row.appendChild(ic); row.appendChild(mid);
      row.onclick = () => { if (inputEl) { inputEl.value = q; runSearch(q); } };
      p.appendChild(row);
      rows.push(row);
    });
    fitPanel();
  }

  const runSearch = debounce(async (q) => {
    if (q.length < MIN_CHARS) { closePanel(); return; }
    lastQuery = q;
    paintState("Searching\u2026");
    let result = { query: q, groups: [], truncated: false };
    try { result = await App.portalApi("/api/search?snippets=1&q=" + encodeURIComponent(q)); }
    catch (e) { /* the guides half still works offline */ }
    if (q !== lastQuery) return;   // a later keystroke owns the panel
    paintResults(result, guideHits(q));
    remember(q);
  }, DEBOUNCE_MS);

  function focusRow(i) {
    if (!rows.length) return;
    focusIndex = (i + rows.length) % rows.length;
    rows.forEach((r, n) => r.classList.toggle("gs-row--active", n === focusIndex));
    const r = rows[focusIndex];
    if (r && r.scrollIntoView) { try { r.scrollIntoView({ block: "nearest" }); } catch (e) { /* */ } }
  }

  function onKey(e) {
    if (e.key === "Escape") { closePanel(); if (inputEl) inputEl.blur(); return; }
    if (!panelEl) return;
    if (e.key === "ArrowDown") { e.preventDefault(); focusRow(focusIndex + 1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); focusRow(focusIndex - 1); return; }
    if (e.key === "Enter" && focusIndex >= 0 && rows[focusIndex]) { e.preventDefault(); rows[focusIndex].click(); return; }
    if (e.key === "Tab" && rows.length) {
      // Keep focus inside the panel while it's open.
      e.preventDefault();
      focusRow(focusIndex + (e.shiftKey ? -1 : 1));
    }
  }

  /** Build the input. The caller places it. */
  function mount() {
    if (wrapEl) return wrapEl;   // the WRAPPER, not the bare input
    const input = el("input", "search-input gs-input");
    input.type = "search";
    input.placeholder = "Search\u2026";
    input.setAttribute("aria-label", "Search this portal");
    input.autocomplete = "off";
    input.oninput = () => runSearch(input.value.trim());
    input.onkeydown = onKey;
    input.onfocus = async () => {
      const q = input.value.trim();
      if (q.length >= MIN_CHARS) { runSearch(q); return; }
      // Empty and focused: offer what this person searched for last, in THIS portal.
      await loadRecents();
      if (document.activeElement === input && !input.value.trim()) paintRecents();
    };
    // The house search box supplies the magnifying glass and the brand mark.
    const wrap = App.util.searchBox(input);
    wrap.classList.add("gs-wrap");
    inputEl = input;
    wrapEl = wrap;
    return wrap;
  }

  /**
   * #/search?q=… — every match, filterable by type.
   * Reachable from the panel and by direct URL only, like the notifications
   * page: it is a destination, not a nav item.
   */
  async function renderPage(host) {
    if (!host) return;
    const q = ((App.routeQuery && App.routeQuery.q) || "").toString();
    host.innerHTML = "";
    const wrap = el("div", "gs-page");
    const head = el("div", "page-head");
    head.appendChild(el("h1", null, q ? `Results for \u201c${esc(q)}\u201d` : "Search"));
    wrap.appendChild(head);
    const tabsBar = el("div", "settings-tabs");
    const body = el("div", "gs-page-body");
    wrap.appendChild(tabsBar); wrap.appendChild(body);
    host.appendChild(wrap);

    if (q.length < MIN_CHARS) {
      body.appendChild(el("div", "empty", "<h3>Search this portal</h3><p>Type at least two characters in the box at the top, or press Ctrl-K.</p>"));
      return;
    }
    body.appendChild(el("div", "gs-state cell-muted", "Searching\u2026"));

    let result = { query: q, groups: [], truncated: false };
    try { result = await App.portalApi("/api/search?snippets=1&total=200&perGroup=50&q=" + encodeURIComponent(q)); }
    catch (e) { body.innerHTML = ""; body.appendChild(el("div", "empty", "<h3>Couldn't run that search</h3><p>Try again in a moment.</p>")); return; }

    const groups = (result.groups || []).slice();
    const settings = settingsHits(q);
    if (settings.length) groups.push({ key: "settings", label: "Settings", hits: settings });
    const guides = guideHits(q);
    if (guides.length) groups.push({ key: "guide", label: "Guides", hits: guides });

    let filter = "all";
    let shown = 20;
    const PAGE = 20;

    function paintTabs() {
      tabsBar.innerHTML = "";
      const tabs = [["all", "All"]].concat(groups.map((g) => [g.key, g.label]));
      tabs.forEach(([key, label]) => {
        const b = el("button", null, esc(label));
        b.className = "settings-tab" + (filter === key ? " active" : "");
        b.onclick = () => { if (filter !== key) { filter = key; shown = PAGE; paintBody(); paintTabs(); } };
        tabsBar.appendChild(b);
      });
    }

    function paintBody() {
      body.innerHTML = "";
      const visible = groups.filter((g) => filter === "all" || g.key === filter);
      const flat = [];
      visible.forEach((g) => g.hits.forEach((h) => flat.push({ ...h, groupKey: h.groupKey || g.key, groupLabel: g.label })));
      if (!flat.length) {
        body.appendChild(el("div", "empty", `<h3>Nothing matched \u201c${esc(q)}\u201d</h3><p>Try fewer words, or a phrase you know appears in the thing you want.</p>`));
        return;
      }
      const list = el("div", "gs-page-list card");
      flat.slice(0, shown).forEach((h) => {
        const row = rowEl(h);
        row.classList.add("gs-page-row");
        const badge = el("span", "pill gs-page-type", esc(h.groupLabel || h.type));
        row.insertBefore(badge, row.lastChild && row.lastChild.className === "gs-row-meta" ? row.lastChild : null);
        list.appendChild(row);
      });
      body.appendChild(list);
      if (flat.length > shown) {
        const more = el("div", "gs-page-more");
        const btn = el("button", "btn btn-ghost btn-sm", `Load more (${flat.length - shown} left)`);
        btn.onclick = () => { shown += PAGE; paintBody(); };
        more.appendChild(btn);
        body.appendChild(more);
      }
    }

    paintTabs(); paintBody();
  }

  // Cmd/Ctrl-K from anywhere in the portal; Esc closes.
  function bindShortcut() {
    if (bindShortcut._bound) return;
    bindShortcut._bound = true;
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "k") {
        // Prefer the live node: a repaint may have replaced or detached the one
        // we cached, and focusing a detached element does nothing at all.
        const live = document.querySelector(".gs-input") || inputEl;
        if (!live) return;
        e.preventDefault();
        inputEl = live;
        live.focus();
        try { live.select(); } catch (err) { /* not all inputs select */ }
      }
    });
    document.addEventListener("click", (e) => {
      if (!panelEl) return;
      if (inputEl && (e.target === inputEl || inputEl.contains(e.target))) return;
      closePanel();
    });
  }

  App.globalSearch = { mount, bindShortcut, closePanel, fitPanel, renderPage, _rows: () => rows, _guideHits: guideHits, _settingsHits: settingsHits, _recents: () => recents, MIN_CHARS, DEBOUNCE_MS };
})();
