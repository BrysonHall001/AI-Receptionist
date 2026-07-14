(function (global) {
  const App = global.App || (global.App = {});
  const hasDOM = typeof document !== "undefined";

  // ---------- pure helpers (unit-testable) ----------
  function colText(col, row) {
    const v = col.text ? col.text(row) : col.get(row);
    if (v == null || v === "—") return "";
    return String(v);
  }
  function colSort(col, row) {
    return col.get ? col.get(row) : col.text ? col.text(row) : "";
  }
  function cmp(a, b, type) {
    const aEmpty = a == null || a === "";
    const bEmpty = b == null || b === "";
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (type === "date") return new Date(a).getTime() - new Date(b).getTime();
    if (type === "number") return Number(a) - Number(b);
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }
  // ---------- date helpers ----------
  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function subtractTime(fromMs, amount, unit) {
    const d = new Date(fromMs);
    const n = Number(amount) || 0;
    if (unit === "weeks") d.setDate(d.getDate() - n * 7);
    else if (unit === "months") d.setMonth(d.getMonth() - n);
    else if (unit === "years") d.setFullYear(d.getFullYear() - n);
    else d.setDate(d.getDate() - n); // days (default)
    return d.getTime();
  }

  // ---------- calendar-day helpers (timezone/day-boundary correctness) ----------
  // Relative date filters ("today", ranges) must compare on the SAME calendar day the
  // table SHOWS, not on a raw UTC instant. Whole-day values are displayed in UTC (see
  // util.fmtDateOnly, which renders the literal Y-M-D digits in UTC — e.g. the Change
  // Log, whose rows are stored at UTC midnight); time-of-day values are displayed in
  // local time (util.fmtDate). So a bare date or an exact UTC-midnight instant keys off
  // its UTC Y-M-D digits, while anything with a real time-of-day keys off its LOCAL day.
  // This fixes the bug where "today" returned nothing because a UTC-midnight row fell
  // into the previous LOCAL day. Returns "YYYY-MM-DD" (or "" when the value is empty).
  function localDayKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function dayKeyOf(value) {
    if (value == null || value === "") return "";
    const s = String(value);
    const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (bare) return `${bare[1]}-${bare[2]}-${bare[3]}`;
    const utcMidnight = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z$/.exec(s);
    if (utcMidnight) return `${utcMidnight[1]}-${utcMidnight[2]}-${utcMidnight[3]}`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : localDayKey(d);
  }
  function todayKey() { return localDayKey(new Date()); }
  // A <input type="date"> value is already "YYYY-MM-DD"; use its digits directly.
  function inputDayKey(v) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || "")); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; }
  // today minus N units, as a day key (for "in the previous N days/weeks/…").
  function shiftDayKey(baseKey, amount, unit) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseKey || "");
    if (!m) return "";
    const d = new Date(+m[1], +m[2] - 1, +m[3]); // local midnight of that calendar day
    const n = Number(amount) || 0;
    if (unit === "weeks") d.setDate(d.getDate() - n * 7);
    else if (unit === "months") d.setMonth(d.getMonth() - n);
    else if (unit === "years") d.setFullYear(d.getFullYear() - n);
    else d.setDate(d.getDate() - n);
    return localDayKey(d);
  }

  function evalRule(row, rule, cols) {
    const col = cols.find((c) => c.key === rule.field);
    if (!col) return true;
    // Audience membership: server-authoritative. In the client preview we only know membership if the
    // row carries __audienceIds (it usually doesn't), so treat unknown as non-match to avoid false hits.
    if (rule.op === "in_audience" || rule.op === "not_in_audience") {
      const ids = col.get ? col.get(row) : [];
      const inIt = Array.isArray(ids) && ids.includes(rule.value);
      return rule.op === "in_audience" ? inIt : !inIt;
    }
    const text = colText(col, row).toLowerCase();
    const raw = colSort(col, row);
    const val = (rule.value == null ? "" : String(rule.value)).toLowerCase();
    const t = raw ? new Date(raw).getTime() : NaN;
    switch (rule.op) {
      case "contains": return text.includes(val);
      case "not_contains": return !text.includes(val);
      case "is": return text === val;
      case "is_not": return text !== val;
      case "empty": return text === "";
      case "not_empty": return text !== "";
      case "before": return !!raw && t < new Date(rule.value).getTime();
      case "after": return !!raw && t > new Date(rule.value).getTime();
      case "gt": return Number(raw) > Number(rule.value);
      case "lt": return Number(raw) < Number(rule.value);
      case "today": {
        const dk = dayKeyOf(raw);
        return !!dk && dk === todayKey();
      }
      case "between": {
        const dk = dayKeyOf(raw);
        if (!dk) return false;
        const a = inputDayKey(rule.value);
        const b = inputDayKey(rule.value2);
        return (!a || dk >= a) && (!b || dk <= b);
      }
      case "previous": {
        const dk = dayKeyOf(raw);
        if (!dk) return false;
        const tk = todayKey();
        const from = shiftDayKey(tk, rule.value, rule.unit || "days");
        return !!from && dk >= from && dk <= tk;
      }
      default: return true;
    }
  }

  // Is a rule filled in enough to apply? Incomplete rules are ignored.
  function ruleComplete(rule) {
    if (!rule || !rule.field || !rule.op) return false;
    if (rule.op === "empty" || rule.op === "not_empty" || rule.op === "today") return true;
    if (rule.op === "between") return rule.value != null && rule.value !== "" && rule.value2 != null && rule.value2 !== "";
    if (rule.op === "previous") return rule.value != null && rule.value !== "" && !!rule.unit;
    return rule.value != null && rule.value !== "";
  }

  // AND/OR: AND binds tighter than OR -> (A AND B) OR (C AND D).
  function evalRules(row, rules, cols) {
    const active = (rules || []).filter(ruleComplete);
    if (!active.length) return true;
    const groups = [];
    let cur = [];
    active.forEach((r, idx) => {
      if (idx > 0 && r.conj === "OR") { groups.push(cur); cur = []; }
      cur.push(r);
    });
    if (cur.length) groups.push(cur);
    return groups.some((g) => g.every((r) => evalRule(row, r, cols)));
  }

  function pipeline(rows, cols, st) {
    let out = rows.slice();
    if (st.rules && st.rules.length) {
      out = out.filter((r) => evalRules(r, st.rules, cols));
    }
    if (st.colFilters) {
      for (const k of Object.keys(st.colFilters)) {
        const term = (st.colFilters[k] || "").trim().toLowerCase();
        if (!term) continue;
        const col = cols.find((c) => c.key === k);
        if (!col) continue;
        out = out.filter((r) => colText(col, r).toLowerCase().includes(term));
      }
    }
    if (st.search && st.search.trim()) {
      const term = st.search.trim().toLowerCase();
      out = out.filter((r) => cols.some((c) => colText(c, r).toLowerCase().includes(term)));
    }
    if (st.sortKey) {
      const col = cols.find((c) => c.key === st.sortKey);
      if (col) {
        const dir = st.sortDir === "desc" ? -1 : 1;
        out.sort((a, b) => cmp(colSort(col, a), colSort(col, b), col.type) * dir);
      }
    }
    return out;
  }

  // ---------- operators available per column type ----------
  const COMMON_EMPTY = [["empty", "is empty"], ["not_empty", "is not empty"]];
  const OPS = {
    text: [["contains", "contains"], ["not_contains", "does not contain"], ["is", "is"], ["is_not", "is not"], ...COMMON_EMPTY],
    status: [["is", "is"], ["is_not", "is not"], ...COMMON_EMPTY],
    date: [["today", "today"], ["between", "between"], ["previous", "in the previous"], ["after", "after"], ["before", "before"], ...COMMON_EMPTY],
    number: [["is", "is"], ["gt", "greater than"], ["lt", "less than"], ...COMMON_EMPTY],
    audience: [["in_audience", "is in"], ["not_in_audience", "is not in"]],
  };

  // ---------- rendering ----------
  function mount(opts) {
    if (!hasDOM) return;
    const { container, rows, onRowClick, emptyHtml } = opts;
    let columns = (opts.columns || []).slice();
    const rowId = opts.rowId || ((r) => r.id);
    const selectable = !!opts.selectable;
    const selected = new Set();

    // ---- Persist sort view-state (sortKey + sortDir) per table, so it survives
    // navigating away / reloading. Same try/catch localStorage pattern used for the
    // column layouts in admin.js/portal.js. Keyed by a STABLE per-table id: callers
    // may pass opts.tableId; otherwise we derive one from the (order-independent)
    // set of column keys, which is stable for a given logical table. Only view state.
    const sortStoreId = opts.tableId
      ? String(opts.tableId)
      : "sig:" + (opts.columns || []).map((c) => c && c.key).filter(Boolean).slice().sort().join(",");
    const SORT_STORE_KEY = "tblsort:" + sortStoreId;
    function loadSort() { try { return JSON.parse(localStorage.getItem(SORT_STORE_KEY) || "null"); } catch (e) { return null; } }
    function saveSort() { try { localStorage.setItem(SORT_STORE_KEY, JSON.stringify({ sortKey: state.sortKey, sortDir: state.sortDir })); } catch (e) {} }
    const savedSort = loadSort();

    const state = { search: "", colFilters: {}, rules: [], sortKey: (savedSort && savedSort.sortKey) || opts.defaultSort || null, sortDir: (savedSort && savedSort.sortDir) || opts.defaultSortDir || "desc", railOpen: false, page: 0 };
    const { el, esc, debounce } = App.util;
    function fireSel() { if (opts.onSelectionChange) opts.onSelectionChange(Array.from(selected)); }

    container.innerHTML = "";
    const layout = el("div", "table-layout");
    const rail = el("aside", "filter-rail");
    const area = el("div", "table-area");
    layout.appendChild(rail);
    layout.appendChild(area);

    // Toolbar (search + filter toggle + chips)
    const toolbar = el("div", "table-toolbar");
    const left = el("div", "toolbar-left");
    const filterToggle = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#9776;</span> Filters`);
    left.appendChild(filterToggle);
    const chips = el("div", "filter-chips");
    left.appendChild(chips);
    const right = el("div", "toolbar-right");
    const search = el("input", "search-input");
    search.type = "search";
    search.placeholder = "Search…";
    right.appendChild(search);
    toolbar.appendChild(left);
    toolbar.appendChild(right);

    // Opt-in horizontal scroll for tables with many columns (e.g. Contacts):
    // the modifier class lets the table size to its content and overflow into the
    // existing .table-wrap scroller. Tables that don't pass scrollX are unaffected.
    const tableWrap = el("div", "table-wrap card" + (opts.scrollX ? " table-wrap--wide" : ""));
    area.appendChild(tableWrap);

    function distinctValues(col) {
      const set = new Set();
      rows.forEach((r) => { const t = colText(col, r); if (t) set.add(t); });
      return Array.from(set).sort();
    }

    function renderRail() {
      rail.classList.toggle("open", state.railOpen);
      rail.innerHTML = "";
      const head = el("div", "rail-head");
      head.appendChild(el("span", "rail-title", "Filters"));
      if (state.rules.length) {
        const clear = el("button", "rail-clear", "Clear all");
        clear.onclick = () => { state.rules = []; renderRail(); render(); };
        head.appendChild(clear);
      }
      rail.appendChild(head);
      rail.appendChild(ruleEditor(columns, rows, state.rules, () => render()));
    }

    function renderChips() {
      chips.innerHTML = "";
      const active = state.rules.filter(ruleComplete);
      const colCount = Object.values(state.colFilters).filter((v) => (v || "").trim()).length;
      const total = active.length + colCount;
      if (total > 0) {
        const chip = el("span", "chip", `${total} filter${total > 1 ? "s" : ""} active`);
        chips.appendChild(chip);
      }
    }

    function render() {
      const filtered = pipeline(rows, columns, state);
      // Opt-in pagination: only active when opts.pageSize is set (e.g. Calls page).
      // Other tables pass no pageSize and are completely unaffected.
      const pageSize = opts.pageSize || 0;
      let pageRows = filtered;
      let totalPages = 1;
      if (pageSize > 0) {
        totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        if (state.page >= totalPages) state.page = totalPages - 1;
        if (state.page < 0) state.page = 0;
        pageRows = filtered.slice(state.page * pageSize, state.page * pageSize + pageSize);
      }
      tableWrap.innerHTML = "";
      if (!rows.length && emptyHtml) {
        tableWrap.innerHTML = emptyHtml;
        if (opts.onEmptyMount) opts.onEmptyMount(tableWrap);
        renderChips();
        if (opts.onRender) opts.onRender(filtered, state);
        return;
      }
      const table = el("table");
      const thead = el("thead");
      const htr = el("tr");
      let selAll = null;
      if (selectable) {
        const th = el("th", "sel-col");
        selAll = el("input"); selAll.type = "checkbox"; selAll.title = "Select all shown";
        selAll.onclick = (e) => e.stopPropagation();
        selAll.onchange = () => {
          const ids = filtered.map(rowId);
          if (selAll.checked) ids.forEach((id) => selected.add(id));
          else ids.forEach((id) => selected.delete(id));
          fireSel();
          render();
        };
        th.appendChild(selAll);
        htr.appendChild(th);
      }
      columns.forEach((c) => {
        const th = el("th", c.headerClass || "");
        const wrap = el("div", "th-wrap");
        const label = el("span", "th-label", esc(c.label));
        if (c.sortable !== false) {
          label.onclick = () => {
            if (state.sortKey === c.key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
            else { state.sortKey = c.key; state.sortDir = "asc"; }
            saveSort();
            render();
          };
        } else { label.classList.add("u-cursor-default"); }
        wrap.appendChild(label);
        if (c.sortable !== false && state.sortKey === c.key) wrap.appendChild(el("span", "th-caret", state.sortDir === "asc" ? "▲" : "▼"));
        if (c.filterable !== false) {
          const fbtn = el("button", "th-filter" + (state.colFilters[c.key] ? " active" : ""), "&#9662;");
          fbtn.onclick = (e) => { e.stopPropagation(); openColPopover(th, c); };
          wrap.appendChild(fbtn);
        }
        th.appendChild(wrap);
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);

      const tb = el("tbody");
      const span = columns.length + (selectable ? 1 : 0);
      if (!filtered.length) {
        const tr = el("tr");
        const td = el("td", "cell-muted", "No results match your filters.");
        td.colSpan = span;
        td.classList.add("tbl-empty-cell");
        
        tr.appendChild(td);
        tb.appendChild(tr);
      } else {
        pageRows.forEach((row) => {
          const tr = el("tr");
          if (opts.highlightId && row.id === opts.highlightId) tr.classList.add("row-new");
          const id = rowId(row);
          if (selectable) {
            if (selected.has(id)) tr.classList.add("row-selected");
            const td = el("td", "sel-col");
            const cb = el("input"); cb.type = "checkbox"; cb.checked = selected.has(id);
            cb.onclick = (e) => e.stopPropagation();
            cb.onchange = () => {
              if (cb.checked) selected.add(id); else selected.delete(id);
              tr.classList.toggle("row-selected", cb.checked);
              if (selAll) { const ids = filtered.map(rowId); selAll.checked = ids.every((x) => selected.has(x)); selAll.indeterminate = !selAll.checked && ids.some((x) => selected.has(x)); }
              fireSel();
            };
            td.appendChild(cb);
            tr.appendChild(td);
          }
          columns.forEach((c) => {
            const td = el("td", c.cellClass || "");
            td.innerHTML = c.render ? c.render(row) : esc(colText(c, row) || "—");
            tr.appendChild(td);
          });
          if (onRowClick) tr.addEventListener("click", (e) => { if (e.target && e.target.closest("button, a, input, select, label, .rp-toggle, .rp-dl")) return; onRowClick(row); });
          tb.appendChild(tr);
        });
        // Render only as many rows as there are real records on this page — no
        // empty filler rows. Pagination still caps the page at pageSize.
      }
      table.appendChild(tb);
      tableWrap.appendChild(table);

      if (selectable && selAll) {
        const ids = filtered.map(rowId);
        selAll.checked = ids.length > 0 && ids.every((x) => selected.has(x));
        selAll.indeterminate = !selAll.checked && ids.some((x) => selected.has(x));
      }

      // Footer count. When pagination is ON (Calls), show the current page's
      // range ("Showing 1–6 of 17"). When OFF (Contacts, Recycle Bin, Jobs),
      // keep the existing "filtered of total" behavior unchanged.
      let countText;
      if (pageSize > 0) {
        const total = filtered.length;
        if (total === 0) {
          countText = "Showing 0 of 0";
        } else {
          const start = state.page * pageSize + 1;
          const end = state.page * pageSize + pageRows.length;
          countText = `Showing ${start}\u2013${end} of ${total}`;
        }
      } else {
        countText = `${filtered.length} of ${rows.length}`;
      }
      const count = el("div", "table-count", countText);
      tableWrap.appendChild(count);

      // Pager controls (only when pagination is active).
      if (pageSize > 0) {
        const pager = el("div", "table-pager");
        pager.classList.add("tbl-pager");
        const prev = el("button", "btn btn-ghost btn-sm", "‹ Prev");
        const next = el("button", "btn btn-ghost btn-sm", "Next ›");
        const ind = el("span", "table-pager-info", `Page ${state.page + 1} of ${totalPages}`);
        ind.classList.add("txt-faint", "pt-fs-sm");
        prev.disabled = state.page <= 0;
        next.disabled = state.page >= totalPages - 1;
        prev.onclick = () => { if (state.page > 0) { state.page--; render(); } };
        next.onclick = () => { if (state.page < totalPages - 1) { state.page++; render(); } };
        pager.appendChild(prev);
        pager.appendChild(ind);
        pager.appendChild(next);
        tableWrap.appendChild(pager);
      }
      renderChips();
      // Opt-in notify hook: lets a caller mirror the EXACT filtered/sorted rows into an
      // alternate view (e.g. a card/panel grid) so Filters/Saved Filters/Search/sort stay
      // the single source of truth. Backwards-compatible — no-op unless opts.onRender is set.
      if (opts.onRender) opts.onRender(filtered, state);
    }

    function openColPopover(anchor, col) {
      closePopover();
      const pop = el("div", "col-popover");
      pop.addEventListener("click", (e) => e.stopPropagation());
      const sortAsc = el("button", "pop-item", "↑ Sort ascending");
      const sortDesc = el("button", "pop-item", "↓ Sort descending");
      sortAsc.onclick = () => { state.sortKey = col.key; state.sortDir = "asc"; saveSort(); closePopover(); render(); };
      sortDesc.onclick = () => { state.sortKey = col.key; state.sortDir = "desc"; saveSort(); closePopover(); render(); };
      pop.appendChild(sortAsc);
      pop.appendChild(sortDesc);
      pop.appendChild(el("div", "pop-sep"));
      const inp = el("input", "pop-input");
      inp.type = "text";
      inp.placeholder = "Filter " + col.label + "…";
      inp.value = state.colFilters[col.key] || "";
      inp.oninput = App.util.debounce(() => { state.colFilters[col.key] = inp.value; state.page = 0; render(); }, 200);
      pop.appendChild(inp);
      document.body.appendChild(pop);
      const rect = anchor.getBoundingClientRect();
      pop.style.top = rect.bottom + window.scrollY + 4 + "px";
      pop.style.left = Math.min(rect.left + window.scrollX, window.innerWidth - 240) + "px";
      inp.focus();
      setTimeout(() => document.addEventListener("click", closePopover, { once: true }), 0);
    }
    function closePopover() {
      App.util.$$(".col-popover").forEach((p) => p.remove());
    }

    filterToggle.onclick = () => { state.railOpen = !state.railOpen; renderRail(); };
    search.oninput = App.util.debounce(() => { state.search = search.value; state.page = 0; render(); }, 180);

    container.appendChild(toolbar);
    container.appendChild(layout);
    renderRail();
    render();

    // Public handle so callers can save/apply filters and add toolbar controls.
    function getState() {
      return {
        search: state.search,
        colFilters: { ...state.colFilters },
        rules: state.rules.map((r) => ({ ...r })),
        sortKey: state.sortKey,
        sortDir: state.sortDir,
      };
    }
    function applyState(def) {
      def = def || {};
      state.search = def.search || "";
      state.colFilters = { ...(def.colFilters || {}) };
      state.rules = (def.rules || []).map((r) => ({ ...r }));
      state.sortKey = def.sortKey || null;
      state.sortDir = def.sortDir || "desc";
      saveSort();
      search.value = state.search;
      if ((state.rules.length || Object.keys(state.colFilters).length) && !state.railOpen) state.railOpen = true;
      renderRail();
      render();
    }
    function getFiltered() { return pipeline(rows, columns, state); }

    function setColumns(newCols) { columns = (newCols || []).slice(); render(); }
    function getSelected() { return Array.from(selected); }
    function clearSelection() { selected.clear(); fireSel(); render(); }

    return { getState, applyState, getFiltered, setColumns, getSelected, clearSelection, getColumns: () => columns, toolbarLeft: left, toolbarRight: right, columns, rows };
  }

  // Reusable rule-builder used by the rail and the Export dialog.
  function ruleEditor(columns, rows, rules, onChange) {
    const { el, esc, debounce } = App.util;
    const wrap = el("div", "rule-editor");
    const filterable = columns.filter((c) => c.filterable !== false);
    function distinct(col) {
      const set = new Set();
      rows.forEach((r) => { const t = colText(col, r); if (t) set.add(t); });
      return Array.from(set).sort();
    }
    function valueNodes(rule, col) {
      const op = rule.op;
      if (op === "empty" || op === "not_empty" || op === "today") return [];
      if (op === "between") {
        const a = el("input", "rule-val"); a.type = "date"; a.value = rule.value || ""; a.onchange = () => { rule.value = a.value; onChange(); };
        const sep = el("span", "rule-and", "and");
        const b = el("input", "rule-val"); b.type = "date"; b.value = rule.value2 || ""; b.onchange = () => { rule.value2 = b.value; onChange(); };
        return [a, sep, b];
      }
      if (op === "previous") {
        const n = el("input", "rule-val rule-num"); n.type = "number"; n.min = "1"; n.placeholder = "2"; n.value = rule.value || "";
        n.oninput = debounce(() => { rule.value = n.value; onChange(); }, 200);
        const u = el("select", "rule-val");
        [["days", "days"], ["weeks", "weeks"], ["months", "months"], ["years", "years"]].forEach(([v, lbl]) => { const o = el("option", null, lbl); o.value = v; if ((rule.unit || "days") === v) o.selected = true; u.appendChild(o); });
        if (!rule.unit) rule.unit = "days";
        u.onchange = () => { rule.unit = u.value; onChange(); };
        return [n, u];
      }
      let input;
      if (col.type === "audience") {
        // Value is an audience id, chosen from the audiences passed on the column (col.options).
        input = el("select", "rule-val");
        const blank = el("option", null, "\u2014"); blank.value = ""; input.appendChild(blank);
        (col.options || []).forEach((a) => { const o = el("option", null, esc(a.name || a.label || a.id)); o.value = a.id || a.value; if ((a.id || a.value) === rule.value) o.selected = true; input.appendChild(o); });
        input.onchange = () => { rule.value = input.value; onChange(); };
      } else if (col.type === "status") {
        input = el("select", "rule-val");
        const blank = el("option", null, "\u2014"); blank.value = ""; input.appendChild(blank);
        distinct(col).forEach((v) => { const o = el("option", null, esc(v)); o.value = v; if (v === rule.value) o.selected = true; input.appendChild(o); });
        input.onchange = () => { rule.value = input.value; onChange(); };
      } else if (col.type === "date") {
        input = el("input", "rule-val"); input.type = "date"; input.value = rule.value || "";
        input.onchange = () => { rule.value = input.value; onChange(); };
      } else {
        input = el("input", "rule-val"); input.type = col.type === "number" ? "number" : "text"; input.value = rule.value || ""; input.placeholder = "value";
        input.oninput = debounce(() => { rule.value = input.value; onChange(); }, 200);
        input.onchange = () => { rule.value = input.value; onChange(); };
      }
      return [input];
    }
    function redraw() {
      wrap.innerHTML = "";
      rules.forEach((rule, idx) => {
        const r = el("div", "rule");
        if (idx > 0) {
          const conj = el("select", "rule-conj");
          [["AND", "AND"], ["OR", "OR"]].forEach(([v, lbl]) => { const o = el("option", null, lbl); o.value = v; if ((rule.conj || "AND") === v) o.selected = true; conj.appendChild(o); });
          if (!rule.conj) rule.conj = "AND";
          conj.onchange = () => { rule.conj = conj.value; onChange(); };
          r.appendChild(conj);
        }
        const fieldSel = el("select", "rule-field");
        filterable.forEach((c) => { const o = el("option", null, esc(c.label)); o.value = c.key; if (c.key === rule.field) o.selected = true; fieldSel.appendChild(o); });
        fieldSel.onchange = () => { rule.field = fieldSel.value; rule.op = null; rule.value = ""; rule.value2 = ""; rule.unit = ""; redraw(); onChange(); };
        r.appendChild(fieldSel);

        const col = columns.find((c) => c.key === rule.field) || filterable[0];
        const ops = OPS[col.type] || OPS.text;
        const opSel = el("select", "rule-op");
        ops.forEach(([v, lbl]) => { const o = el("option", null, esc(lbl)); o.value = v; if (v === rule.op) o.selected = true; opSel.appendChild(o); });
        if (!rule.op) rule.op = ops[0][0];
        opSel.onchange = () => { rule.op = opSel.value; redraw(); onChange(); };
        r.appendChild(opSel);

        valueNodes(rule, col).forEach((n) => r.appendChild(n));

        const rm = el("button", "rule-remove", "&times;");
        rm.title = "Remove";
        rm.onclick = () => { rules.splice(idx, 1); redraw(); onChange(); };
        r.appendChild(rm);
        wrap.appendChild(r);
      });
      const add = el("button", "rail-add", "+ Add criteria");
      add.onclick = () => { const c = filterable[0]; rules.push({ field: c.key, op: (OPS[c.type] || OPS.text)[0][0], value: "", conj: "AND" }); redraw(); onChange(); };
      wrap.appendChild(add);
    }
    redraw();
    return wrap;
  }

  // ---------- Shared "Manage columns" affordance (show/hide + drag reorder) ----------
  // Generic version of the Contacts column picker: works for ANY App.table handle. It
  // wires a "Manage columns" button into the table's toolbar; the popup toggles/reorders
  // columns and calls handle.setColumns() with the visible subset. Layout is in-memory
  // unless the caller wires getLayout/setLayout to persist it.
  function applyColumnLayout(all, layout, defaultKeys) {
    const byKey = {}; all.forEach((c) => (byKey[c.key] = c));
    const defaults = (defaultKeys && defaultKeys.length ? defaultKeys : all.map((c) => c.key));
    const hasLayout = layout && ((layout.order || []).length || (layout.hidden || []).length);
    if (!hasLayout) return defaults.filter((k) => byKey[k]).map((k) => byKey[k]);
    const hidden = new Set(layout.hidden || []);
    const ordered = [];
    (layout.order || []).forEach((k) => { if (byKey[k]) ordered.push(byKey[k]); });
    all.forEach((c) => { if (ordered.indexOf(c) === -1) ordered.push(c); });
    return ordered.filter((c) => !hidden.has(c.key));
  }

  // options (all optional, defaults preserve the original "Manage columns" behavior):
  //   title     — modal heading (default "Manage columns")
  //   help      — helper line under the heading
  //   saveText  — primary button label (default "Save columns")
  //   savedToast— toast on save (default "Columns updated")
  //   noReorder — check-on/off ONLY, no drag handles / no reordering (for the panel
  //               field picker, where card layout order is fixed)
  function openColumnManager(allColumns, layout, defaultKeys, onSave, options) {
    options = options || {};
    const noReorder = !!options.noReorder;
    const el = App.util.el, esc = App.util.esc;
    const byKey = {}; allColumns.forEach((c) => (byKey[c.key] = c));
    let order = (layout && layout.order && layout.order.length) ? layout.order.filter((k) => byKey[k]) : (defaultKeys || allColumns.map((c) => c.key)).filter((k) => byKey[k]);
    allColumns.forEach((c) => { if (order.indexOf(c.key) === -1) order.push(c.key); });
    const hidden = new Set((layout && layout.hidden) || []);

    const overlay = el("div", "modal-overlay");
    const modal = el("div", "modal");
    modal.innerHTML = `<div class="modal-head"><h2>${esc(options.title || "Manage columns")}</h2><button class="icon-btn" id="mc-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    const help = el("p", "cell-muted", options.help || (noReorder ? "Check to show." : "Check to show, drag to reorder.")); help.classList.add("u-mb-10");
    body.appendChild(help);
    const list = el("div", "mc-list"); body.appendChild(list);
    function paint() {
      list.innerHTML = "";
      order.forEach((key) => {
        const c = byKey[key]; if (!c) return;
        const row = el("div", "mc-row"); row.dataset.key = key;
        const lab = el("label", "mc-label");
        const cb = el("input"); cb.type = "checkbox"; cb.checked = !hidden.has(key);
        cb.onchange = () => { if (cb.checked) hidden.delete(key); else hidden.add(key); };
        // Drag-to-reorder is opt-out: the panel field picker (noReorder) shows check
        // boxes only, since cards render fields in a fixed layout.
        if (!noReorder) {
          row.draggable = true;
          const grip = el("span", "mc-drag", "\u283F");
          row.appendChild(grip);
        }
        lab.appendChild(cb); lab.appendChild(document.createTextNode(" " + (c.label || key)));
        row.appendChild(lab);
        if (!noReorder) {
          row.addEventListener("dragstart", (e) => { row.classList.add("dragging"); e.dataTransfer.setData("text/plain", key); });
          row.addEventListener("dragend", () => row.classList.remove("dragging"));
          row.addEventListener("dragover", (e) => { e.preventDefault(); });
          row.addEventListener("drop", (e) => {
            e.preventDefault();
            const from = e.dataTransfer.getData("text/plain"); const to = key;
            if (from === to) return;
            order = order.filter((k) => k !== from);
            order.splice(order.indexOf(to), 0, from);
            paint();
          });
        }
        list.appendChild(row);
      });
    }
    paint();
    const foot = el("div", "modal-foot");
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    const save = el("button", "btn btn-primary btn-sm", options.saveText || "Save columns");
    foot.appendChild(cancel); foot.appendChild(save);
    modal.appendChild(body); modal.appendChild(foot); overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    modal.querySelector("#mc-close").onclick = close;
    cancel.onclick = close;
    save.onclick = () => { onSave({ order: order.slice(), hidden: Array.from(hidden) }); close(); if (App.util.toast) App.util.toast(options.savedToast || "Columns updated"); };
  }

  // Wire the button into a mounted table handle. `allColumns` is the full set; the table
  // starts showing `defaultKeys` (default: all). Returns { getLayout }.
  function mountColumnManager(handle, allColumns, opts) {
    opts = opts || {};
    const el = App.util.el;
    const defaultKeys = opts.defaultKeys || allColumns.map((c) => c.key);
    let layout = { order: (opts.order || defaultKeys).slice(), hidden: (opts.hidden || []).slice() };
    function apply() { handle.setColumns(applyColumnLayout(allColumns, layout, defaultKeys)); }
    const btn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#9776;</span> Manage columns`);
    btn.onclick = () => openColumnManager(allColumns, layout, defaultKeys, (nl) => { layout = nl; if (opts.onSave) opts.onSave(nl); apply(); });
    if (handle.toolbarRight) handle.toolbarRight.insertBefore(btn, handle.toolbarRight.firstChild);
    apply();
    return { getLayout: () => layout };
  }

  App.table = { pipeline, evalRule, evalRules, ruleComplete, mount, ruleEditor, OPS, manageColumns: mountColumnManager, openColumnManager, applyColumnLayout };
})(typeof window !== "undefined" ? window : globalThis);
