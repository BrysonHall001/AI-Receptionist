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
    if (hit.context) {
      const c = el("span", "gs-row-ctx cell-muted", esc(hit.context));
      c.title = hit.context;
      mid.appendChild(c);
    }
    row.appendChild(ic); row.appendChild(mid);
    if (hit.at) row.appendChild(el("span", "gs-row-meta cell-muted", esc(shortDate(hit.at))));
    row.onclick = () => go(hit);
    return row;
  }

  function shortDate(iso) {
    try { return new Date(iso).toLocaleDateString(); } catch (e) { return ""; }
  }

  function iconFor(hit) {
    if (!App.icons) return "";
    if (hit.type === "contact") return App.icons.forModuleKey("contact");
    if (hit.type === "call") return App.icons.forNotificationCategory("call_missed_or_failed");
    if (hit.type === "guide") return App.icons.forNavHref ? App.icons.forNavHref("#/learn") : "";
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
    if (result.truncated) p.appendChild(el("div", "gs-more cell-muted", "Keep typing to narrow this down."));
    fitPanel();
  }

  const runSearch = debounce(async (q) => {
    if (q.length < MIN_CHARS) { closePanel(); return; }
    lastQuery = q;
    paintState("Searching\u2026");
    let result = { query: q, groups: [], truncated: false };
    try { result = await App.portalApi("/api/search?q=" + encodeURIComponent(q)); }
    catch (e) { /* the guides half still works offline */ }
    if (q !== lastQuery) return;   // a later keystroke owns the panel
    paintResults(result, guideHits(q));
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
    input.onfocus = () => { if (input.value.trim().length >= MIN_CHARS) runSearch(input.value.trim()); };
    // The house search box supplies the magnifying glass and the brand mark.
    const wrap = App.util.searchBox(input);
    wrap.classList.add("gs-wrap");
    inputEl = input;
    wrapEl = wrap;
    return wrap;
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

  App.globalSearch = { mount, bindShortcut, closePanel, fitPanel, _rows: () => rows, _guideHits: guideHits, MIN_CHARS, DEBOUNCE_MS };
})();
