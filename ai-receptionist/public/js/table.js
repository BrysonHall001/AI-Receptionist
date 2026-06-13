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

  function evalRule(row, rule, cols) {
    const col = cols.find((c) => c.key === rule.field);
    if (!col) return true;
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
        if (!raw) return false;
        const s = startOfToday();
        return t >= s && t < s + 86400000;
      }
      case "between": {
        if (!raw) return false;
        const a = new Date(rule.value).getTime();
        const end = new Date(rule.value2); end.setHours(23, 59, 59, 999);
        return t >= a && t <= end.getTime();
      }
      case "previous": {
        if (!raw) return false;
        const now = Date.now();
        return t >= subtractTime(now, rule.value, rule.unit || "days") && t <= now;
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
  };

  // ---------- rendering ----------
  function mount(opts) {
    if (!hasDOM) return;
    const { container, rows, onRowClick, emptyHtml } = opts;
    let columns = (opts.columns || []).slice();
    const rowId = opts.rowId || ((r) => r.id);
    const selectable = !!opts.selectable;
    const selected = new Set();
    const state = { search: "", colFilters: {}, rules: [], sortKey: opts.defaultSort || null, sortDir: opts.defaultSortDir || "desc", railOpen: false, page: 0 };
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

    const tableWrap = el("div", "table-wrap card");
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
        const th = el("th");
        const wrap = el("div", "th-wrap");
        const label = el("span", "th-label", esc(c.label));
        label.onclick = () => {
          if (state.sortKey === c.key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          else { state.sortKey = c.key; state.sortDir = "asc"; }
          render();
        };
        wrap.appendChild(label);
        if (state.sortKey === c.key) wrap.appendChild(el("span", "th-caret", state.sortDir === "asc" ? "▲" : "▼"));
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
        td.style.textAlign = "center";
        td.style.padding = "32px";
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
          if (onRowClick) tr.addEventListener("click", () => onRowClick(row));
          tb.appendChild(tr);
        });
        // Keep the table a consistent height when a page isn't full.
        if (pageSize > 0) {
          for (let i = pageRows.length; i < pageSize; i++) {
            const tr = el("tr", "row-filler");
            const td = el("td"); td.colSpan = span; td.innerHTML = "&nbsp;";
            tr.appendChild(td);
            tb.appendChild(tr);
          }
        }
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
        pager.style.cssText = "display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 0 2px;";
        const prev = el("button", "btn btn-ghost btn-sm", "‹ Prev");
        const next = el("button", "btn btn-ghost btn-sm", "Next ›");
        const ind = el("span", "table-pager-info", `Page ${state.page + 1} of ${totalPages}`);
        ind.style.cssText = "color:var(--muted,#6b7280);font-size:13px;";
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
    }

    function openColPopover(anchor, col) {
      closePopover();
      const pop = el("div", "col-popover");
      pop.addEventListener("click", (e) => e.stopPropagation());
      const sortAsc = el("button", "pop-item", "↑ Sort ascending");
      const sortDesc = el("button", "pop-item", "↓ Sort descending");
      sortAsc.onclick = () => { state.sortKey = col.key; state.sortDir = "asc"; closePopover(); render(); };
      sortDesc.onclick = () => { state.sortKey = col.key; state.sortDir = "desc"; closePopover(); render(); };
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
      if (col.type === "status") {
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

  App.table = { pipeline, evalRule, evalRules, ruleComplete, mount, ruleEditor, OPS };
})(typeof window !== "undefined" ? window : globalThis);
