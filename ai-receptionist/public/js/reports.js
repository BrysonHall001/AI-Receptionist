(function (global) {
  const App = global.App || (global.App = {});
  const U = () => App.util;

  // ===================== pure engine =====================
  // Default top-level (non-custom) keys for the built-in Contacts source. Each
  // data source declares its OWN top-level keys (src.topLevel); anything not in
  // that list is read from row.customFields[key]. This single rule is what makes
  // valueOf source-aware — there is no per-source branching inside valueOf.
  const CONTACT_TOP = ["name", "phone", "email", "intent", "createdAt", "callCount"];
  function valueOf(src, row, key) {
    if (!row) return undefined;
    const top = (src && src.topLevel) || CONTACT_TOP;
    if (top.indexOf(key) >= 0) return row[key];
    return (row.customFields || {})[key];
  }
  function scalar(v) { if (v == null) return ""; if (Array.isArray(v)) return v.join(", "); if (typeof v === "boolean") return v ? "Yes" : "No"; return String(v); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function bucketDate(iso, g) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "(none)";
    if (g === "day") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (g === "year") return "" + d.getFullYear();
    if (g === "week") { const j = new Date(d.getFullYear(), 0, 1); const wk = Math.ceil(((d - j) / 86400000 + j.getDay() + 1) / 7); return `${d.getFullYear()}-W${pad(wk)}`; }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  // WALL-CLOCK date bucketing for appointment times. appointmentAt is zoneless
  // wall-clock digits parked in a UTC-slot ISO string ("2026-07-01T23:30:00.000Z").
  // We bucket by SLICING those digits — never `new Date(iso)` + local getters, which
  // would timezone-shift the date (e.g. roll an 11:30 PM appointment to the next or
  // previous day). day/month/year are pure string slices; week derives its number
  // from Date.UTC on the SLICED Y/M/D (UTC getters only), so it never drifts either.
  function bucketWallClock(iso, g) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "(none)";
    const Y = m[1], Mo = m[2], D = m[3];
    if (g === "day") return `${Y}-${Mo}-${D}`;
    if (g === "year") return Y;
    if (g === "week") {
      const d = new Date(Date.UTC(+Y, +Mo - 1, +D));
      const j = new Date(Date.UTC(+Y, 0, 1));
      const wk = Math.ceil(((d - j) / 86400000 + j.getUTCDay() + 1) / 7);
      return `${Y}-W${pad(wk)}`;
    }
    return `${Y}-${Mo}`;
  }
  function toDims(v, legacyDate) {
    if (Array.isArray(v)) return v.map((d) => (typeof d === "string" ? { key: d } : d)).filter((d) => d && d.key);
    if (typeof v === "string" && v) return [{ key: v, date: legacyDate }];
    return [];
  }
  function dimMeta(fields, dim) { const f = fields.find((x) => x.key === dim.key) || { key: dim.key, label: dim.key, type: "text" }; return { key: f.key, label: f.label, type: f.type, bucket: dim.date, catOrder: f.catOrder || null, wallClock: !!f.wallClock }; }
  function oneLabel(src, c, dm) {
    const v = valueOf(src, c, dm.key);
    if (dm.type === "date") return v ? (dm.wallClock ? bucketWallClock(v, dm.bucket || "month") : bucketDate(v, dm.bucket || "month")) : "(none)";
    if (v == null || v === "") return "(empty)";
    if (Array.isArray(v)) return v.length ? v.join(", ") : "(empty)";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  }
  function compoundLabel(src, c, dims, fields) { return dims.map((d) => oneLabel(src, c, dimMeta(fields, d))).join(" / "); }
  // Round a measure result: call minutes to 3 decimals (they derive from callSeconds/60 and
  // otherwise show long repeating decimals once summed); everything else to 6 decimals to strip
  // floating-point noise without changing meaningful precision. Integers/counts are unaffected.
  function roundMeasure(v, field) { const d = field === "callMinutes" ? 3 : 6; const p = Math.pow(10, d); return Math.round((Number(v) || 0) * p) / p; }
  function liLike(v) { return Array.isArray(v) && v.length > 0 && v.every(function (x) { return x && typeof x === "object" && ("unitPrice" in x || "quantity" in x); }); }
  function measureValue(src, rows, m) {
    if (!m || m.op === "count") return rows.length;
    const nums = rows.map((r) => { const v = valueOf(src, r, m.field); return Number(liLike(v) && App.fields && App.fields.lineItemsTotal ? App.fields.lineItemsTotal(v) : v); }).filter((n) => !isNaN(n));
    if (m.op === "sum") return roundMeasure(nums.reduce((a, b) => a + b, 0), m.field);
    if (m.op === "avg") return nums.length ? roundMeasure(nums.reduce((a, b) => a + b, 0) / nums.length, m.field) : 0;
    return rows.length;
  }
  function buildColumns(src, fields) { return fields.map((f) => ({ key: f.key, label: f.label, type: f.type === "percent" ? "number" : f.type, get: (r) => valueOf(src, r, f.key), text: (r) => scalar(valueOf(src, r, f.key)) })); }
  function groupRows(src, rows, dims, fields) { const map = new Map(); rows.forEach((r) => { const k = compoundLabel(src, r, dims, fields); if (!map.has(k)) map.set(k, []); map.get(k).push(r); }); return map; }
  function measureLabel(m, fields) { if (!m || m.op === "count") return "Count"; const f = fields.find((x) => x.key === m.field); return (m.op === "sum" ? "Sum of " : "Average of ") + (f ? f.label : m.field); }
  const CAP = 40;
  function aggregate(src, rows, fields, w) {
    const cols = buildColumns(src, fields);
    const filtered = (App.table && App.table.pipeline) ? App.table.pipeline(rows, cols, { rules: w.filters || [] }) : rows.slice();
    const measure = w.measure || { op: "count" };
    if (w.type === "kpi") return { kind: "kpi", value: measureValue(src, filtered, measure) };
    const groupDims = toDims(w.groupBy, w.groupByDate);
    if (!groupDims.length) return { kind: "kpi", value: measureValue(src, filtered, measure) };
    const seriesDims = toDims(w.series, w.seriesDate);
    // When the (single) group dimension is an ordered category (e.g. pipeline
    // stage), sort by that order instead of by count/alpha. Generic: any field
    // can carry a catOrder map {label: index}; nothing is funnel-specific here.
    const single = groupDims.length === 1 ? dimMeta(fields, groupDims[0]) : null;
    const catOrder = single && single.catOrder ? single.catOrder : null;
    const catRank = (lab) => { const r = catOrder ? catOrder[lab] : undefined; return (r === undefined || r === null) ? 1e9 : r; };
    if (w.type === "stacked" || w.type === "heatmap") {
      const xMap = groupRows(src, filtered, groupDims, fields);
      let labels = Array.from(xMap.keys());
      labels.sort(catOrder ? (a, b) => (catRank(a) - catRank(b)) || String(a).localeCompare(String(b)) : undefined);
      if (labels.length > CAP) labels = labels.slice(0, CAP);
      const seriesNames = seriesDims.length ? Array.from(new Set(filtered.map((r) => compoundLabel(src, r, seriesDims, fields)))).sort().slice(0, CAP) : ["All"];
      const series = seriesNames.map((sn) => ({ name: sn, data: labels.map((lab) => { const rws = (xMap.get(lab) || []).filter((r) => !seriesDims.length || compoundLabel(src, r, seriesDims, fields) === sn); return measureValue(src, rws, measure); }) }));
      if (w.type === "heatmap") { let max = 0; series.forEach((s) => s.data.forEach((v) => { if (v > max) max = v; })); return { kind: "heatmap", cols: labels, rows: seriesNames, series, max }; }
      return { kind: "stacked", labels, series, measureLabel: measureLabel(measure, fields) };
    }
    const map = groupRows(src, filtered, groupDims, fields);
    let entries = Array.from(map.entries()).map(([label, rws]) => [label, measureValue(src, rws, measure)]);
    const isDate = single && single.type === "date";
    entries.sort((a, b) => (catOrder ? (catRank(a[0]) - catRank(b[0])) || String(a[0]).localeCompare(String(b[0])) : (isDate ? String(a[0]).localeCompare(String(b[0])) : b[1] - a[1])));
    if (entries.length > CAP) entries = entries.slice(0, CAP);
    return { kind: "series", labels: entries.map((e) => e[0]), data: entries.map((e) => e[1]), measureLabel: measureLabel(measure, fields) };
  }

  const PALETTE = ["#5b5bd6", "#3aa675", "#e0a23b", "#c2453f", "#3b82c4", "#8a4fc4", "#d2689a", "#4cae9e", "#9a8a3b", "#6b7280"];
  function baseOpts(stacked, hideScales) {
    const o = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: stacked || hideScales } } };
    if (!hideScales) o.scales = { x: { stacked: !!stacked, ticks: { maxRotation: 60, minRotation: 0, autoSkip: true, callback: function (v) { const lab = this.getLabelForValue ? this.getLabelForValue(v) : v; return (typeof lab === "string" && lab.length > 18) ? lab.slice(0, 17) + "…" : lab; } } }, y: { stacked: !!stacked, beginAtZero: true } };
    return o;
  }
  function defaultListColumns(src) { return (src.reportFields || []).slice(0, 4).map((f) => f.key); }

  // List / table widget — reuses the report engine's columns (buildColumns) and
  // the SAME filter pipeline (App.table.pipeline) as the Contacts table, then
  // renders a compact, read-only table of the chosen columns. Recent-first when
  // the source has a date field, so a fresh one mirrors a "recent rows" feed.
  function renderListWidget(host, w, src, rows, fields) {
    const { el, esc } = U();
    host.innerHTML = "";
    const byKey = {}; fields.forEach((f) => { byKey[f.key] = f; });
    const chosenKeys = (Array.isArray(w.columns) && w.columns.length ? w.columns : defaultListColumns(src)).filter((k) => byKey[k]);
    if (!chosenKeys.length) { host.appendChild(el("div", "cell-muted", "No columns selected.")); return; }
    const allCols = buildColumns(src, fields);
    const colByKey = {}; allCols.forEach((c) => { colByKey[c.key] = c; });
    const filtered = (App.table && App.table.pipeline) ? App.table.pipeline(rows, allCols, { rules: w.filters || [] }) : rows.slice();
    const dateField = fields.find((f) => f.type === "date");
    let out = filtered.slice();
    if (dateField) out.sort((a, b) => { const av = new Date(valueOf(src, a, dateField.key) || 0).getTime(); const bv = new Date(valueOf(src, b, dateField.key) || 0).getTime(); return bv - av; });
    const limit = (w.limit && w.limit > 0) ? w.limit : 50;
    const total = out.length;
    out = out.slice(0, limit);
    const box = el("div", "widget-list");
    const table = el("table");
    const thead = el("thead"); const htr = el("tr");
    chosenKeys.forEach((k) => htr.appendChild(el("th", null, esc(byKey[k].label))));
    thead.appendChild(htr); table.appendChild(thead);
    const tb = el("tbody");
    if (!out.length) { const tr = el("tr"); const td = el("td", "cell-muted", "No rows."); td.colSpan = chosenKeys.length; tr.appendChild(td); tb.appendChild(tr); }
    else out.forEach((r) => {
      const tr = el("tr");
      chosenKeys.forEach((k) => { const c = colByKey[k]; const v = c ? scalar(c.text ? c.text(r) : c.get(r)) : ""; tr.appendChild(el("td", null, esc(v == null ? "" : String(v)))); });
      tb.appendChild(tr);
    });
    table.appendChild(tb); box.appendChild(table);
    if (total > out.length) box.appendChild(el("div", "widget-list-more", "Showing " + out.length + " of " + total));
    host.appendChild(box);
  }

  function renderWidgetBody(host, w, src, rows, fields, charts) {
    if (w.type === "list") { renderListWidget(host, w, src, rows, fields); return; }
    const agg = aggregate(src, rows, fields, w);
    host.innerHTML = "";
    const { el, esc } = U();
    if (agg.kind === "kpi") { const k = el("div", "kpi"); k.appendChild(el("div", "kpi-value", String(agg.value))); k.appendChild(el("div", "kpi-label", measureLabel(w.measure, fields))); host.appendChild(k); return; } // visual fixes 2: no inner pill — the widget CARD is the surface (accent bar lives on the card)
    if (agg.kind === "heatmap") {
      const table = el("table", "heatmap"); const thead = el("thead"); const htr = el("tr"); htr.appendChild(el("th", "", ""));
      agg.cols.forEach((c) => htr.appendChild(el("th", "", esc(c)))); thead.appendChild(htr); table.appendChild(thead);
      const tb = el("tbody");
      agg.rows.forEach((rowName, ri) => { const tr = el("tr"); tr.appendChild(el("th", "", esc(rowName)));
        agg.cols.forEach((_, ci) => { const v = agg.series[ri] ? agg.series[ri].data[ci] : 0; const inten = agg.max ? v / agg.max : 0; const td = el("td", "hm-cell" + (inten > 0.6 ? " hm-hot" : ""), String(v)); td.style.setProperty("--hm-a", String(0.08 + inten * 0.72)); tr.appendChild(td); });
        tb.appendChild(tr); });
      table.appendChild(tb); const wrap = el("div", "heatmap-wrap"); wrap.appendChild(table); host.appendChild(wrap); return;
    }
    if (typeof Chart === "undefined") { host.innerHTML = `<p class="cell-muted">Charts need an internet connection.</p>`; return; }
    const canvas = document.createElement("canvas"); host.appendChild(canvas);
    let config;
    if (agg.kind === "stacked") config = { type: "bar", data: { labels: agg.labels, datasets: agg.series.map((s, i) => ({ label: s.name, data: s.data, backgroundColor: PALETTE[i % PALETTE.length] })) }, options: baseOpts(true) };
    else if (w.type === "pie") config = { type: "pie", data: { labels: agg.labels, datasets: [{ data: agg.data, backgroundColor: agg.labels.map((_, i) => PALETTE[i % PALETTE.length]) }] }, options: baseOpts(false, true) };
    else if (w.type === "line") config = { type: "line", data: { labels: agg.labels, datasets: [{ label: agg.measureLabel, data: agg.data, borderColor: PALETTE[0], backgroundColor: "rgba(91,91,214,0.15)", tension: 0.3, fill: true }] }, options: baseOpts(false) };
    else config = { type: "bar", data: { labels: agg.labels, datasets: [{ label: agg.measureLabel, data: agg.data, backgroundColor: PALETTE[0] }] }, options: baseOpts(false) };
    const ch = new Chart(canvas, config); if (charts) charts.push(ch);
  }

  // ===================== view factory =====================
  // ===================== reusable widget editor =====================
  // Self-contained "Add/Edit widget" modal, driven entirely by cfg so it can serve BOTH the
  // portal Reports dashboards and the master-hub Billing & Usage dashboards. cfg:
  //   sources: { key -> source }, sourceKeys: string[], widget: existing|null,
  //   defaultSourceKey: string, onSave: async (widget) => void
  function openWidgetEditor(cfg) {
    const { el, esc, toast } = U();
    function modal(inner) { const overlay = el("div", "modal-overlay"); const box = el("div", "modal modal-wide"); box.appendChild(inner); overlay.appendChild(box); overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); }; document.body.appendChild(overlay); return overlay; }
    function dimListEditor(host2, fields, initialDims, onChange) {
      const rows = []; const list = el("div", "dim-list"); host2.appendChild(list);
      const addBtn = el("button", "btn btn-ghost btn-sm", "+ Add dimension"); host2.appendChild(addBtn);
      function addRow(initial) {
        const row = el("div", "dim-row");
        const sel = el("select", "input"); const blank = el("option", null, "— select —"); blank.value = ""; sel.appendChild(blank);
        fields.forEach((f) => { const o = el("option", null, f.label); o.value = f.key; sel.appendChild(o); });
        const dateSel = el("select", "input"); [["day", "By day"], ["week", "By week"], ["month", "By month"], ["year", "By year"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (v === "month") o.selected = true; dateSel.appendChild(o); }); dateSel.classList.add("u-hidden");
        const rm = el("button", "icon-btn", "×");
        const entry = { get: () => { if (!sel.value) return null; const f = fields.find((x) => x.key === sel.value); return f && f.type === "date" ? { key: sel.value, date: dateSel.value } : { key: sel.value }; } };
        function syncDate() { const f = fields.find((x) => x.key === sel.value); dateSel.classList.toggle("u-hidden", !(f && f.type === "date")); }
        sel.onchange = () => { syncDate(); onChange && onChange(); }; dateSel.onchange = () => onChange && onChange();
        rm.onclick = () => { list.removeChild(row); const i = rows.indexOf(entry); if (i >= 0) rows.splice(i, 1); onChange && onChange(); };
        if (initial) { sel.value = initial.key; if (initial.date) dateSel.value = initial.date; } syncDate();
        row.appendChild(sel); row.appendChild(dateSel); row.appendChild(rm); rows.push(entry); list.appendChild(row);
      }
      (initialDims && initialDims.length ? initialDims : []).forEach(addRow);
      addBtn.onclick = () => { addRow(null); onChange && onChange(); };
      return { getDims: () => rows.map((r) => r.get()).filter(Boolean) };
    }
    try {
      const sources = cfg.sources;
      const defaultKey = cfg.defaultSourceKey;
      const existing = cfg.widget || null;
      const w = existing ? JSON.parse(JSON.stringify(existing)) : { id: "w" + Date.now(), title: "", type: "kpi", measure: { op: "count" }, groupBy: [], series: [], filters: [] };
      if (!w.measure) w.measure = { op: "count" };
      let previewCharts = [];
      let curSrcKey = (w.source && sources[w.source]) ? w.source : defaultKey;
      const srcOpts = (cfg.sourceKeys || Object.keys(sources)).map((k) => ({ key: k, label: sources[k] ? sources[k].label : k }));
      const inner = el("div");
      inner.innerHTML = `<div class="modal-head"><h2>${existing ? "Edit widget" : "Add widget"}</h2><button class="icon-btn" id="w-close">&times;</button></div>
        <div class="modal-body">
          <label class="field-label">Title</label><input id="w-title" class="input" value="${esc(w.title || "")}" placeholder="e.g. Cost by month" />
          <label class="field-label">Data source</label>
          <select id="w-source" class="input">${srcOpts.map((o) => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join("")}</select>
          <label class="field-label">Type</label>
          <select id="w-type" class="input"><option value="kpi">KPI (single number)</option><option value="bar">Bar chart</option><option value="stacked">Stacked bar</option><option value="line">Line chart</option><option value="pie">Pie chart</option><option value="heatmap">Heat map</option><option value="list">List / table</option></select>
          <div id="w-measure-wrap"><label class="field-label">Measure</label>
          <div class="w-row"><select id="w-mop" class="input"><option value="count">Count</option><option value="sum">Sum of…</option><option value="avg">Average of…</option></select>
          <select id="w-mfield" class="input u-block u-hidden"></select></div></div>
          <div id="w-group-wrap"><label class="field-label">Group by</label><div id="w-group"></div></div>
          <div id="w-series-wrap" class="u-hidden"><label class="field-label" id="w-series-label">Stack by</label><div id="w-series"></div></div>
          <div id="w-list-wrap" class="u-hidden"><label class="field-label">Columns</label><div id="w-list-cols" class="w-list-cols"></div></div>
          <label class="field-label">Filters</label><div id="w-filters"></div>
          ${cfg.showScope ? `<label class="field-label">Show in</label>
          <select id="w-scope" class="input"><option value="both">Both (overview + tenant panels)</option><option value="macro">Overview only</option><option value="tenant">Tenant panels only</option></select>` : ""}
          <label class="w-list-col rw-range-toggle"><input type="checkbox" id="w-range-on"> Use a custom date range for this widget</label>
          <div id="w-range-wrap" class="rw-range-wrap u-hidden">
            <div class="rw-range-col"><label class="field-label u-m-0">From</label><input id="w-range-from" class="input rw-date-in" type="date"></div>
            <div class="rw-range-col"><label class="field-label u-m-0">To</label><input id="w-range-to" class="input rw-date-in" type="date"></div>
          </div>
          <div class="w-preview-label">Preview</div><div id="w-preview" class="w-preview"></div>
          <button id="w-save" class="btn btn-primary btn-block">${existing ? "Save widget" : "Add widget"}</button>
        </div>`;
      const overlay = modal(inner); const $ = (s) => inner.querySelector(s);
      $("#w-close").onclick = () => overlay.remove();
      $("#w-source").value = curSrcKey; $("#w-type").value = w.type; $("#w-mop").value = w.measure.op;
      if (cfg.showScope && $("#w-scope")) $("#w-scope").value = ["both", "macro", "tenant"].indexOf(w.scope) >= 0 ? w.scope : ((sources[curSrcKey] && sources[curSrcKey].defaultScope) || "both");
      // Per-widget date range override (optional; unset = use the page's global range).
      if (w.range && w.range.from && w.range.to) { $("#w-range-on").checked = true; $("#w-range-from").value = String(w.range.from).slice(0, 10); $("#w-range-to").value = String(w.range.to).slice(0, 10); $("#w-range-wrap").classList.remove("u-hidden"); }
      $("#w-range-on").addEventListener("change", () => { $("#w-range-wrap").classList.toggle("u-hidden", !$("#w-range-on").checked); });
      function curSource() { return sources[curSrcKey] || sources[defaultKey]; }
      let groupEd, seriesEd, listColsEd;
      function listColsEditor(hostEl, flds, chosen, onChange) {
        const sel = new Set(chosen || []); const boxes = [];
        flds.forEach((f) => { const lab = el("label", "w-list-col"); const cb = el("input"); cb.type = "checkbox"; cb.value = f.key; if (sel.has(f.key)) cb.checked = true; cb.onchange = () => onChange && onChange(); lab.appendChild(cb); lab.appendChild(document.createTextNode(" " + f.label)); hostEl.appendChild(lab); boxes.push(cb); });
        return { getCols: () => boxes.filter((b) => b.checked).map((b) => b.value) };
      }
      function rebuildForSource(initial) {
        const src = curSource();
        const numericFields = src.reportFields.filter((f) => f.type === "number" || f.type === "percent" || f.type === "line_items" || f.type === "progress");
        $("#w-mfield").innerHTML = numericFields.map((f) => `<option value="${esc(f.key)}">${esc(f.label)}</option>`).join("");
        if (initial && w.measure && w.measure.field) $("#w-mfield").value = w.measure.field;
        // Visual fixes 2 — sources with NO numeric fields (e.g. Calls: caller/phone/reason/
        // status/date are all text or dates) used to render an EMPTY field select for
        // Sum/Avg, with the select chevron painting as a stray dark bar. A measure that
        // has nothing to operate on is disabled; the field select is HIDDEN whenever it
        // would be empty (sync() enforces it), and the op snaps back to Count.
        const hasNumeric = numericFields.length > 0;
        $("#w-mop").options[1].disabled = !hasNumeric;
        $("#w-mop").options[2].disabled = !hasNumeric;
        if (!hasNumeric && $("#w-mop").value !== "count") { $("#w-mop").value = "count"; w.measure = { op: "count" }; }
        $("#w-mop").options[0].textContent = "Count of " + String(src.label || "records").toLowerCase();
        if (!initial) w.filters = [];
        $("#w-group").innerHTML = ""; $("#w-series").innerHTML = "";
        const gInit = initial ? toDims(w.groupBy, w.groupByDate) : (src.defaultGroupByKey ? [{ key: src.defaultGroupByKey }] : []);
        groupEd = dimListEditor($("#w-group"), src.reportFields, gInit, () => preview());
        seriesEd = dimListEditor($("#w-series"), src.reportFields, initial ? toDims(w.series, w.seriesDate) : [], () => preview());
        $("#w-filters").innerHTML = "";
        $("#w-filters").appendChild(App.table.ruleEditor(buildColumns(src, src.reportFields), src.rows, w.filters, () => preview()));
        $("#w-list-cols").innerHTML = "";
        const colInit = (initial && Array.isArray(w.columns) && w.columns.length) ? w.columns : defaultListColumns(src);
        listColsEd = listColsEditor($("#w-list-cols"), src.reportFields, colInit, () => preview());
      }
      function sync() { const t = $("#w-type").value; const isList = t === "list"; $("#w-measure-wrap").classList.toggle("u-hidden", isList); $("#w-mfield").classList.toggle("u-hidden", !(!isList && $("#w-mop").value !== "count" && $("#w-mfield").options.length > 0)); /* never render an EMPTY select */ $("#w-group-wrap").classList.toggle("u-hidden", isList || t === "kpi"); const ns = t === "stacked" || t === "heatmap"; $("#w-series-wrap").classList.toggle("u-hidden", !ns); $("#w-series-label").textContent = t === "heatmap" ? "Rows (second dimension)" : "Stack by"; $("#w-list-wrap").classList.toggle("u-hidden", !isList); preview(); }
      function collect() {
        const t = $("#w-type").value; const mop = $("#w-mop").value;
        const base = { id: w.id, title: $("#w-title").value.trim() || "Untitled", source: curSrcKey, type: t, filters: w.filters, cw: w.cw, ch: w.ch };
        if (t === "list") { base.columns = listColsEd ? listColsEd.getCols() : []; base.measure = { op: "count" }; base.groupBy = []; base.series = []; return base; }
        base.measure = (mop === "count" || !$("#w-mfield").value) ? { op: "count" } : { op: mop, field: $("#w-mfield").value }; // belt + braces: no field -> Count
        base.groupBy = t === "kpi" ? [] : groupEd.getDims();
        base.series = (t === "stacked" || t === "heatmap") ? seriesEd.getDims() : [];
        return base;
      }
      // scope + per-widget range are applied to whatever collect() returns, on every path.
      function collectFull() {
        const base = collect();
        if (cfg.showScope && $("#w-scope")) base.scope = $("#w-scope").value;
        else if (w.scope) base.scope = w.scope;
        if ($("#w-range-on").checked && $("#w-range-from").value && $("#w-range-to").value) base.range = { from: $("#w-range-from").value, to: $("#w-range-to").value };
        return base;
      }
      function preview() { previewCharts.forEach((c) => { try { c.destroy(); } catch (e) {} }); previewCharts = []; try { const s = curSource(); renderWidgetBody($("#w-preview"), collect(), s, s.rows, s.reportFields, previewCharts); } catch (e) { $("#w-preview").innerHTML = `<p class="cell-muted">${esc(e.message)}</p>`; } }
      $("#w-source").addEventListener("change", () => { curSrcKey = $("#w-source").value; if (cfg.showScope && $("#w-scope") && !existing) { const ds = (sources[curSrcKey] && sources[curSrcKey].defaultScope) || "both"; $("#w-scope").value = ds; } rebuildForSource(false); sync(); });
      ["#w-type", "#w-mop", "#w-mfield", "#w-title"].forEach((s) => { $(s).addEventListener("change", sync); $(s).addEventListener("input", preview); });
      rebuildForSource(true); sync();
      $("#w-save").onclick = async () => { const widget = collectFull(); try { await cfg.onSave(widget); overlay.remove(); toast(existing ? "Widget saved" : "Widget added"); } catch (e) { toast((e && e.message) || "Save failed", true); } };
    } catch (err) { console.error("widget editor error", err); U().toast("Couldn't open editor: " + (err && err.message ? err.message : err), true); }
  }

  function createView(host, opts) {
    opts = opts || {};
    const compact = !!opts.compact;
    // The Home Dashboard is shared per-portal; only admins can edit it. Regular
    // Reports-page dashboards keep their existing (everyone) editability.
    const canEdit = !opts.home || !!(App.state.me && App.state.me.role && App.state.me.role !== "CLIENT_USER");
    const cardH = compact ? 200 : 260;
    const state = { dashboards: [], sources: {}, currentId: null, charts: [] };
    const { el, esc, toast } = U();
    const api = { boot, refresh: boot };

    // ---- Data sources -------------------------------------------------------
    // A "source" is one reportable dataset: the built-in Contacts, or a record
    // type (Jobs/Policies/...). Each carries its rows, its pickable reportFields,
    // and the topLevel keys valueOf reads directly off the row. The whole report
    // engine is run against whichever source a widget names (default Contacts).
    function buildContactSource(contacts, fields) {
      const reportFields = (fields || []).concat([
        { key: "createdAt", label: "Time Created", type: "date" },
        { key: "callCount", label: "Number of calls", type: "number" },
      ]);
      return { key: "contacts", label: "Contacts", topLevel: CONTACT_TOP, rows: contacts || [], reportFields: reportFields, dateKey: "createdAt" };
    }
    function buildRecordSource(rt, rows, fields, resourcesById) {
      // Synthetic top-level fields mirror what Contacts get. Keys are the real
      // record properties (title/stageKey/subtypeKey/createdAt) so valueOf reads
      // them directly; labels are friendly. Status here is the RECORD-LEVEL
      // status (Record.stageKey) — NOT the pipeline/join stage (out of scope).
      const reportFields = [
        { key: "title", label: "Title", type: "text" },
        { key: "stageKey", label: "Status", type: "text" },
        { key: "subtypeKey", label: "Type", type: "text" },
      ].concat(fields || []).concat([
        { key: "createdAt", label: "Time Created", type: "date" },
      ]);
      const topLevel = ["title", "stageKey", "subtypeKey", "createdAt"];
      // Bookings carry two extra real columns: the appointment time and the assigned
      // resource (staff). Add them ONLY for the booking type. "appointmentAt" is a
      // WALL-CLOCK date (wallClock:true routes it to the slicing bucketer, never the
      // new Date() one). "resource" is resolved to the staff NAME (reusing the same
      // resource list the calendar uses); unknown/absent → "Unassigned".
      if (rt.key === "booking") {
        reportFields.push({ key: "appointmentAt", label: "Appointment Date", type: "date", wallClock: true });
        reportFields.push({ key: "resource", label: "Staff", type: "text" });
        topLevel.push("appointmentAt", "resource");
        const byId = resourcesById || {};
        (rows || []).forEach((r) => { if (r) r.resource = r.resourceId ? (byId[r.resourceId] || "Unassigned") : "Unassigned"; });
      }
      return {
        key: rt.key,
        label: rt.labelPlural || rt.label || rt.key,
        topLevel: topLevel,
        rows: rows || [],
        reportFields: reportFields,
        dateKey: "createdAt",
      };
    }
    // Pipeline / Funnel source: one row per contact-in-a-policy link. Stage is an
    // ORDERED category (catOrder = stage label -> pipeline-order index) so the
    // funnel shows stages in pipeline order. Contact CUSTOM fields are pickable
    // too (read from row.customFields); contact system fields are represented by
    // the explicit "Contact name" top-level field.
    function buildFunnelSource(rows, contactFields) {
      const order = {};
      (rows || []).forEach((r) => {
        const k = r.stageLabel; const o = (typeof r.stageOrder === "number") ? r.stageOrder : 9999;
        if (k != null && (!(k in order) || o < order[k])) order[k] = o;
      });
      const customContact = (contactFields || []).filter((f) => f && !f.system);
      const reportFields = [
        { key: "stageLabel", label: "Stage", type: "text", catOrder: order },
        { key: "recordTypeLabel", label: "Policy / record type", type: "text" },
        { key: "recordStatusLabel", label: "Record status", type: "text" },
        { key: "subtypeLabel", label: "Type", type: "text" },
        { key: "contactName", label: "Contact name", type: "text" },
        { key: "createdAt", label: "Time Created", type: "date" },
      ].concat(customContact);
      return {
        key: "pipeline",
        label: "Pipeline / Funnel",
        topLevel: ["stageLabel", "stageKey", "stageOrder", "recordTypeLabel", "recordStatusLabel", "subtypeLabel", "contactName", "contactIntent", "createdAt"],
        rows: rows || [],
        reportFields: reportFields,
        defaultGroupByKey: "stageLabel",
        dateKey: "createdAt",
      };
    }
    // Calls source — the call log as a reportable dataset (all fields top-level).
    function buildCallsSource(calls) {
      const reportFields = [
        { key: "name", label: "Caller", type: "text" },
        { key: "phone", label: "Phone", type: "text" },
        { key: "intent", label: "Reason", type: "text" },
        { key: "status", label: "Status", type: "text" },
        { key: "createdAt", label: "Time Created", type: "date" },
      ];
      return { key: "calls", label: "Calls", topLevel: ["name", "phone", "intent", "status", "createdAt"], rows: calls || [], reportFields: reportFields, dateKey: "createdAt" };
    }

    async function reloadSources() {
      if (!opts.buildSources) return;
      try { state.sources = await opts.buildSources(); } catch (e) { toast(e.message, true); }
      paint();
    }

    async function boot() {
      host.innerHTML = `<div class="card"><div class="skeleton">Loading…</div></div>`;
      // Billing / custom engine path: dashboards + sources come from opts hooks.
      if (opts.loadDashboards || opts.buildSources) {
        try {
          if (opts.loadDashboards) state.dashboards = await opts.loadDashboards();
          if (opts.buildSources) state.sources = await opts.buildSources();
        } catch (e) { host.innerHTML = `<div class="card"><p class="cell-muted">${esc(e.message)}</p></div>`; return api; }
        if (opts.renderTop && !state.topNode) state.topNode = opts.renderTop(reloadSources);
        if (!state.currentId && state.dashboards.length) state.currentId = state.dashboards[0].id;
        paint();
        return api;
      }
      try {
        const dashReq = opts.home ? App.portalApi("/api/dashboards/home") : App.portalApi("/api/dashboards");
        const [d, contacts, contactFields, recordTypes, pipeline, calls, resources] = await Promise.all([
          dashReq,
          // Owner page-lock: a locked page's data API 403s — catch so the builder still
          // loads (that source is filtered out of the picker below).
          App.portalApi("/api/contacts").catch(() => []),
          App.portalApi("/api/fields"),
          App.portalApi("/api/record-types"),
          // Defensive: if the pipeline route isn't present yet, the funnel source
          // is simply empty rather than breaking the whole Reports page.
          App.portalApi("/api/pipeline").catch(() => []),
          App.portalApi("/api/calls").catch(() => []),
          // Resources (staff) for the booking "Staff" dimension — id -> name.
          App.portalApi("/api/resources").catch(() => []),
        ]);
        state.dashboards = opts.home ? [d] : d;
        // id -> staff name, reused to resolve the booking source's resource column.
        const resourcesById = {};
        (Array.isArray(resources) ? resources : []).forEach((r) => { if (r && r.id) resourcesById[r.id] = r.name; });

        const sources = { contacts: buildContactSource(contacts, contactFields) };
        // Every record type except the built-in "contact" one becomes a source — minus any
        // whose page is locked for this tenant (owner page-lock).
        const types = (Array.isArray(recordTypes) ? recordTypes : []).filter((rt) => rt && rt.key && rt.key !== "contact" && !(App.isRecordTypeLocked && App.isRecordTypeLocked(rt.key)));
        const loaded = await Promise.all(types.map(async (rt) => {
          const [rows, fields] = await Promise.all([
            App.portalApi("/api/records?type=" + encodeURIComponent(rt.key)).catch(() => []),
            App.portalApi("/api/fields?recordType=" + encodeURIComponent(rt.key)).catch(() => []),
          ]);
          return buildRecordSource(rt, Array.isArray(rows) ? rows : [], Array.isArray(fields) ? fields : [], resourcesById);
        }));
        loaded.forEach((s) => { sources[s.key] = s; });
        // Pipeline / Funnel source (one row per contact-in-a-policy link).
        sources.pipeline = buildFunnelSource(Array.isArray(pipeline) ? pipeline : [], contactFields);
        // Calls source (powers the List widget's "recent calls" feed and more).
        sources.calls = buildCallsSource(Array.isArray(calls) ? calls : []);
        state.sources = sources;
      } catch (e) { host.innerHTML = `<div class="card"><p class="cell-muted">${esc(e.message)}</p></div>`; return api; }
      if (!state.currentId && state.dashboards.length) state.currentId = state.dashboards[0].id;
      paint();
      return api;
    }

    // The source a widget reports on; absent/unknown source safely falls back to
    // Contacts so every widget built before this change keeps working unchanged.
    function sourceForWidget(w) {
      return state.sources[(w && w.source) || "contacts"] || state.sources.contacts;
    }
    // Sources offered in the builder dropdown: Contacts first, then record types — minus
    // any whose page is locked for this tenant (owner page-lock).
    function sourceLocked(k) {
      if (!App.isPageLocked) return false;
      if (k === "contacts") return App.isPageLocked("#/contacts");
      if (k === "calls") return App.isPageLocked("#/calls");
      if (k === "pipeline") return App.isPageLocked("#/contacts") || (App.isAreaLocked && App.isAreaLocked("records"));
      return App.isRecordTypeLocked ? App.isRecordTypeLocked(k) : false;
    }
    function sourceOptions() {
      const keys = Object.keys(state.sources).filter((k) => !sourceLocked(k));
      const ordered = keys.indexOf("contacts") !== -1 ? ["contacts"].concat(keys.filter((k) => k !== "contacts")) : keys;
      return ordered.map((k) => ({ key: k, label: state.sources[k] ? state.sources[k].label : k }));
    }
    function current() { return state.dashboards.find((d) => d.id === state.currentId) || null; }
    function destroyCharts() { state.charts.forEach((c) => { try { c.destroy(); } catch (e) {} }); state.charts = []; }

    function paint() {
      destroyCharts();
      host.innerHTML = "";
      const wrap = el("div", "fade-in");

      const bar = el("div", "reports-bar");
      if (opts.home) {
        bar.appendChild(el("div", "reports-bar-left"));
        const right = el("div", "reports-bar-right");
        if (canEdit) {
          const addW = el("button", "btn btn-primary btn-sm", "+ Add widget"); addW.onclick = () => openEditor(null);
          right.appendChild(addW);
        }
        bar.appendChild(right);
        wrap.appendChild(bar);
      } else {
      const left = el("div", "reports-bar-left");
      if (state.dashboards.length) {
        const sel = el("select", "input reports-select");
        state.dashboards.forEach((d) => { const o = el("option", null, esc(d.name)); o.value = d.id; if (d.id === state.currentId) o.selected = true; sel.appendChild(o); });
        sel.onchange = () => { state.currentId = sel.value; paint(); };
        left.appendChild(sel);
      } else left.appendChild(el("span", "cell-muted", "No dashboards yet"));
      bar.appendChild(left);

      const right = el("div", "reports-bar-right");
      const newDash = el("button", "btn btn-ghost btn-sm", "+ New dashboard"); newDash.onclick = newDashboard; right.appendChild(newDash);
      if (current()) {
        const rename = el("button", "btn btn-ghost btn-sm", "Rename"); rename.onclick = renameDashboard;
        const del = el("button", "btn btn-ghost btn-sm", "Delete dashboard"); del.onclick = deleteCurrent;
        const addW = el("button", "btn btn-primary btn-sm", "+ Add widget"); addW.onclick = () => openEditor(null);
        right.appendChild(rename); right.appendChild(del); right.appendChild(addW);
      }
      bar.appendChild(right);
      wrap.appendChild(bar);
      }

      const dash = current();
      if (state.topNode) wrap.appendChild(state.topNode);
      if (!dash) { const e = el("div", "card"); e.innerHTML = `<div class="empty"><div class="empty-emoji">📊</div><h3>Create your first dashboard</h3><p>Build KPIs and charts from your CRM data.</p></div>`; wrap.appendChild(e); host.appendChild(wrap); return; }
      // On-ramp cards (Analytics only): "Start from a template" + "Build with a wizard".
      if (opts.onramps && canEdit) wrap.appendChild(entryRow());
      const allWidgets = dash.widgets || [];
      const widgets = opts.widgetFilter ? allWidgets.filter(opts.widgetFilter) : allWidgets;
      const hiddenCount = allWidgets.length - widgets.length;
      // Scope banner (e.g. tenant panels): makes it obvious every widget is filtered to one portal.
      if (opts.banner) { const bn = el("div", "rp-banner"); bn.textContent = opts.banner; wrap.appendChild(bn); }
      if (opts.hiddenNote && hiddenCount > 0) { const n = el("div", "cell-muted rp-hidden-note"); n.textContent = opts.hiddenNote; wrap.appendChild(n); }
      if (!widgets.length) { const e = el("div", "card"); e.innerHTML = `<div class="empty"><div class="empty-emoji">➕</div><h3>No widgets yet</h3><p>Click “Add widget” to build your first chart.</p></div>`; wrap.appendChild(e); host.appendChild(wrap); return; }

      const grid = el("div", "widget-grid");
      widgets.forEach((w) => grid.appendChild(buildCard(w, dash)));
      wrap.appendChild(grid);
      host.appendChild(wrap);
      renderBodies(dash);
    }

    // ----- widget sizing + reordering -----
    function normSize(w) {
      let cw = parseInt(w && w.cw, 10); if (!(cw >= 1 && cw <= 4)) cw = 1;
      let ch = (w && (w.ch === "s" || w.ch === "m" || w.ch === "t")) ? w.ch : ((w && w.type === "kpi") ? "s" : "m");
      return { cw, ch };
    }
    function setSize(wid, patch) {
      const d = current(); if (!d) return;
      const w = (d.widgets || []).find((x) => x.id === wid); if (!w) return;
      if (patch.cw != null) w.cw = patch.cw;
      if (patch.ch != null) w.ch = patch.ch;
      persist(d); paint();
    }
    function clearDropMarkers() { U().$$(".widget-card", host).forEach((c) => c.classList.remove("drop-before", "drop-after")); }
    function reorder(fromId, toId, before) {
      const d = current(); if (!d || fromId === toId) return;
      const ws = d.widgets || [];
      const fromIdx = ws.findIndex((x) => x.id === fromId); if (fromIdx < 0) return;
      const [moved] = ws.splice(fromIdx, 1);
      let toIdx = ws.findIndex((x) => x.id === toId);
      if (toIdx < 0) ws.push(moved); else { if (!before) toIdx += 1; ws.splice(toIdx, 0, moved); }
      d.widgets = ws; persist(d); paint();
    }
    function attachDnD(card, handle, wid) {
      handle.draggable = true;
      handle.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", wid);
        try { e.dataTransfer.setDragImage(card, 20, 20); } catch (_) {}
        setTimeout(() => card.classList.add("dragging"), 0);
      });
      handle.addEventListener("dragend", () => { card.classList.remove("dragging"); clearDropMarkers(); });
      card.addEventListener("dragover", (e) => {
        e.preventDefault(); e.dataTransfer.dropEffect = "move";
        const r = card.getBoundingClientRect(); const before = e.clientX < r.left + r.width / 2;
        card.classList.toggle("drop-before", before); card.classList.toggle("drop-after", !before);
      });
      card.addEventListener("dragleave", () => card.classList.remove("drop-before", "drop-after"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = e.dataTransfer.getData("text/plain");
        const r = card.getBoundingClientRect(); const before = e.clientX < r.left + r.width / 2;
        clearDropMarkers();
        if (from) reorder(from, wid, before);
      });
    }

    function buildCard(w, dash) {
      const sz = normSize(w);
      const card = el("div", "widget-card" + (w.type === "kpi" ? " widget-kpi" : ""));
      card.dataset.id = w.id;
      card.dataset.w = String(sz.cw);
      card.dataset.h = sz.ch;
      const head = el("div", "widget-head");
      const titleWrap = el("div", "widget-title-wrap");
      const handle = el("span", "drag-handle", "⠿"); handle.title = "Drag to reorder";
      titleWrap.appendChild(handle);
      titleWrap.appendChild(el("div", "widget-title", esc(w.title || "Untitled")));
      head.appendChild(titleWrap);
      if (canEdit) {
      const actions = el("div", "widget-actions");
      const wSel = el("select", "w-size-select"); wSel.title = "Width";
      [["1", "S"], ["2", "M"], ["3", "L"], ["4", "Full"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (v === String(sz.cw)) o.selected = true; wSel.appendChild(o); });
      wSel.onchange = () => setSize(w.id, { cw: parseInt(wSel.value, 10) });
      const hSel = el("select", "w-size-select"); hSel.title = "Height";
      [["s", "Short"], ["m", "Med"], ["t", "Tall"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (v === sz.ch) o.selected = true; hSel.appendChild(o); });
      hSel.onchange = () => setSize(w.id, { ch: hSel.value });
      actions.appendChild(wSel); actions.appendChild(hSel);
      const dup = el("button", "icon-btn", "⧉"); dup.title = "Duplicate"; dup.onclick = () => openDuplicate(w);
      const edit = el("button", "icon-btn", "✎"); edit.title = "Edit"; edit.onclick = () => openEditor(w);
      const del = el("button", "icon-btn", "×"); del.title = "Delete"; del.onclick = () => removeWidget(w.id);
      actions.appendChild(dup); actions.appendChild(edit); actions.appendChild(del);
      head.appendChild(actions);
      }
      card.appendChild(head);
      const body = el("div", "widget-body");
      card.appendChild(body);
      if (canEdit) attachDnD(card, handle, w.id); else handle.classList.add("u-hidden");
      return card;
    }

    // Filter a source's rows to a [from,to] window (inclusive) using the source's date key.
    // Backwards-compatible: no dateKey or no range -> rows unchanged.
    function filterRowsByRange(src, rows, range) {
      if (!src || !src.dateKey || !range || !range.from || !range.to) return rows;
      const lo = new Date(String(range.from).slice(0, 10) + "T00:00:00.000Z").getTime();
      const hi = new Date(String(range.to).slice(0, 10) + "T23:59:59.999Z").getTime();
      return (rows || []).filter((r) => { const v = r && r[src.dateKey]; if (!v) return false; const t = new Date(v).getTime(); return t >= lo && t <= hi; });
    }
    // Apply the page grouping to a widget's date dimensions (billing only).
    function applyGroupingToWidget(w, grouping) {
      if (!grouping) return w;
      const c = Object.assign({}, w);
      if (Array.isArray(c.groupBy)) c.groupBy = c.groupBy.map((dm) => (dm && dm.key === "date" ? { key: "date", date: grouping } : dm));
      return c;
    }

    function renderBodies(dash) {
      destroyCharts();
      U().$$(".widget-card", host).forEach((card) => {
        const w = (dash.widgets || []).find((x) => x.id === card.dataset.id);
        const body = card.querySelector(".widget-body");
        if (w && body) {
          try {
            const src = sourceForWidget(w);
            const rw = opts.applyGrouping ? applyGroupingToWidget(w, src.grouping) : w;
            // Per-widget range override wins; otherwise fall back to the source's page range.
            const range = (w.range && w.range.from && w.range.to) ? w.range : (src.rangeFrom && src.rangeTo ? { from: src.rangeFrom, to: src.rangeTo } : null);
            const rows = filterRowsByRange(src, src.rows, range);
            renderWidgetBody(body, rw, src, rows, src.reportFields, state.charts);
          } catch (e) { body.innerHTML = `<p class="cell-muted">${esc(e.message)}</p>`; }
        }
      });
    }

    async function persist(dash) { if (opts.persistDashboard) { try { await opts.persistDashboard(dash); } catch (e) { toast(e.message, true); } return; } try { await App.portalApi(`/api/dashboards/${dash.id}`, { method: "PATCH", body: JSON.stringify({ name: dash.name, widgets: dash.widgets }) }); } catch (e) { toast(e.message, true); } }
    async function newDashboard() { const name = await App.ui.promptModal({ title: "New dashboard", label: "Dashboard name", value: "New dashboard", okText: "Create" }); if (!name || !name.trim()) return; try { const d = opts.createDashboard ? await opts.createDashboard(name.trim()) : await App.portalApi("/api/dashboards", { method: "POST", body: JSON.stringify({ name: name.trim() }) }); state.dashboards.push(d); state.currentId = d.id; paint(); toast("Dashboard created"); } catch (e) { toast(e.message, true); } }
    async function renameDashboard() { const d = current(); if (!d) return; const name = await App.ui.promptModal({ title: "Rename dashboard", label: "Dashboard name", value: d.name, okText: "Rename" }); if (!name || !name.trim()) return; d.name = name.trim(); if (opts.renameDashboard) { try { await opts.renameDashboard(d.id, d.name); } catch (e) { toast(e.message, true); } } else { await persist(d); } paint(); }
    async function deleteCurrent() { const d = current(); if (!d) return; if (!(await App.ui.confirmModal({ title: "Delete dashboard", message: `Delete dashboard “${d.name}” and its widgets?`, confirmText: "Delete dashboard" }))) return; try { if (opts.deleteDashboard) await opts.deleteDashboard(d.id); else await App.portalApi(`/api/dashboards/${d.id}`, { method: "DELETE" }); state.dashboards = state.dashboards.filter((x) => x.id !== d.id); state.currentId = state.dashboards.length ? state.dashboards[0].id : null; paint(); toast("Dashboard deleted"); } catch (e) { toast(e.message, true); } }
    async function removeWidget(wid) { const d = current(); if (!d) return; if (!(await App.ui.confirmModal({ title: "Remove widget", message: "Remove this widget?", confirmText: "Remove widget" }))) return; d.widgets = (d.widgets || []).filter((w) => w.id !== wid); persist(d); paint(); }

    function openDuplicate(w) {
      const inner = el("div");
      inner.innerHTML = `<div class="modal-head"><h2>Duplicate widget</h2><button class="icon-btn" id="d-close">&times;</button></div>
        <div class="modal-body"><label class="field-label">Copy “${esc(w.title || "Untitled")}” to dashboard:</label>
        <select id="d-target" class="input">${state.dashboards.map((d) => `<option value="${d.id}"${d.id === state.currentId ? " selected" : ""}>${esc(d.name)}</option>`).join("")}</select>
        <button id="d-go" class="btn btn-primary btn-block u-mt-14">Duplicate</button></div>`;
      const overlay = modal(inner);
      inner.querySelector("#d-close").onclick = () => overlay.remove();
      inner.querySelector("#d-go").onclick = async () => {
        const target = state.dashboards.find((d) => d.id === inner.querySelector("#d-target").value); if (!target) return;
        const copy = JSON.parse(JSON.stringify(w)); copy.id = "w" + Date.now() + Math.floor(Math.random() * 999); copy.title = (w.title || "Untitled") + " (copy)";
        target.widgets = target.widgets || []; target.widgets.push(copy); await persist(target); overlay.remove();
        toast(target.id === state.currentId ? "Widget duplicated" : `Copied to “${target.name}”`);
        if (target.id === state.currentId) paint();
      };
    }

    function dimListEditor(host2, fields, initialDims, onChange) {
      const rows = []; const list = el("div", "dim-list"); host2.appendChild(list);
      const addBtn = el("button", "btn btn-ghost btn-sm", "+ Add dimension"); host2.appendChild(addBtn);
      function addRow(initial) {
        const row = el("div", "dim-row");
        const sel = el("select", "input"); const blank = el("option", null, "— select —"); blank.value = ""; sel.appendChild(blank);
        fields.forEach((f) => { const o = el("option", null, f.label); o.value = f.key; sel.appendChild(o); });
        const dateSel = el("select", "input"); [["day", "By day"], ["week", "By week"], ["month", "By month"], ["year", "By year"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (v === "month") o.selected = true; dateSel.appendChild(o); }); dateSel.classList.add("u-hidden");
        const rm = el("button", "icon-btn", "×");
        const entry = { get: () => { if (!sel.value) return null; const f = fields.find((x) => x.key === sel.value); return f && f.type === "date" ? { key: sel.value, date: dateSel.value } : { key: sel.value }; } };
        function syncDate() { const f = fields.find((x) => x.key === sel.value); dateSel.classList.toggle("u-hidden", !(f && f.type === "date")); }
        sel.onchange = () => { syncDate(); onChange && onChange(); }; dateSel.onchange = () => onChange && onChange();
        rm.onclick = () => { list.removeChild(row); const i = rows.indexOf(entry); if (i >= 0) rows.splice(i, 1); onChange && onChange(); };
        if (initial) { sel.value = initial.key; if (initial.date) dateSel.value = initial.date; } syncDate();
        row.appendChild(sel); row.appendChild(dateSel); row.appendChild(rm); rows.push(entry); list.appendChild(row);
      }
      (initialDims && initialDims.length ? initialDims : []).forEach(addRow);
      addBtn.onclick = () => { addRow(null); onChange && onChange(); };
      return { getDims: () => rows.map((r) => r.get()).filter(Boolean) };
    }

    function openEditor(existing) {
      let dash = current();
      if (!dash && state.dashboards.length) { state.currentId = state.dashboards[0].id; dash = current(); }
      if (!dash) { toast("Create a dashboard first", true); return; }
      openWidgetEditor({
        sources: state.sources,
        sourceKeys: opts.defaultSourceKey ? Object.keys(state.sources) : sourceOptions().map((o) => o.key),
        widget: existing,
        defaultSourceKey: opts.defaultSourceKey || "contacts",
        showScope: !!opts.showScope,
        onSave: async (widget) => {
          dash.widgets = dash.widgets || [];
          const idx = dash.widgets.findIndex((x) => x.id === widget.id);
          if (idx >= 0) dash.widgets[idx] = widget; else dash.widgets.push(widget);
          await persist(dash); paint();
        },
      });
    }

    function modal(inner) { const overlay = el("div", "modal-overlay"); const box = el("div", "modal modal-wide"); box.appendChild(inner); overlay.appendChild(box); overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); }; document.body.appendChild(overlay); return overlay; }

    // ===================== Analytics on-ramps (templates + wizard) =====================
    function ensureOnrampCss() {
      if (document.getElementById("reports-onramp-css")) return;
      const st = document.createElement("style"); st.id = "reports-onramp-css";
      st.textContent =
        ".rw-entry-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px}" +
        ".rw-entry-card{display:flex;align-items:center;gap:13px;padding:15px 16px;border:1px solid var(--line-strong);border-radius:var(--radius);background:var(--panel);cursor:pointer;transition:border-color .12s,box-shadow .12s,transform .04s}" +
        ".rw-entry-card:hover{border-color:var(--accent);box-shadow:var(--shadow)}.rw-entry-card:active{transform:translateY(1px)}.rw-entry-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
        ".rw-entry-icon{flex:0 0 auto;width:38px;height:38px;border-radius:var(--radius-sm);background:var(--accent-soft);color:var(--accent);display:inline-flex;align-items:center;justify-content:center}" +
        ".rw-entry-main{min-width:0;flex:1;display:flex;flex-direction:column}.rw-entry-title{font-size:14px;font-weight:700;color:var(--ink)}.rw-entry-sub{font-size:var(--text-xs);color:var(--ink-faint);margin-top:2px}.rw-entry-cta{flex:0 0 auto;font-size:var(--text-xs);font-weight:700;color:var(--accent)}" +
        ".preset-cat-head{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-faint);margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}.preset-cat-head:first-of-type{margin-top:6px}" +
        ".preset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(238px,1fr));gap:12px}" +
        ".preset-card{display:flex;flex-direction:column;gap:11px;border:1px solid var(--line-strong);border-radius:var(--radius);background:var(--panel);padding:14px}" +
        ".preset-card .preset-name{font-size:14px;font-weight:700;color:var(--ink)}.preset-card .preset-desc{font-size:var(--text-xs);color:var(--ink-soft);margin-top:3px;line-height:1.45}" +
        ".preset-shape{display:flex;gap:6px;flex-wrap:wrap}.preset-shape .shape-chip{font-size:var(--text-xs);font-weight:600;padding:3px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent)}" +
        ".preset-card-foot{display:flex;gap:7px;margin-top:auto}.preset-card-foot .btn{flex:1;justify-content:center}" +
        ".rw-wiz-steps{display:flex;gap:6px;margin:2px 0 16px}.rw-wiz-step{flex:1;height:4px;border-radius:2px;background:var(--line)}.rw-wiz-step.on{background:var(--accent)}" +
        ".rw-wiz-opt{display:block;width:100%;text-align:left;border:1px solid var(--line-strong);background:var(--panel);color:var(--ink);border-radius:var(--radius-sm);padding:11px 13px;margin-bottom:8px;cursor:pointer;font-size:var(--text-sm)}" +
        ".rw-wiz-opt:hover{border-color:var(--accent)}.rw-wiz-opt.sel{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}" +
        ".rw-wiz-foot{display:flex;justify-content:space-between;gap:10px;margin-top:16px}@media (max-width:640px){.rw-entry-row{grid-template-columns:1fr}.preset-grid{grid-template-columns:1fr}}";
      document.head.appendChild(st);
    }
    const gridGlyph = () => `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="1" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="1" y="10" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="10" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>`;
    const sparkGlyph = () => `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1.5l1.7 4.3 4.3 1.7-4.3 1.7L9 13.5 7.3 9.2 3 7.5l4.3-1.7L9 1.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    const CHART_LABEL = { kpi: "Number", bar: "Bar chart", line: "Line chart", pie: "Pie chart", stacked: "Stacked bar", heatmap: "Heatmap", list: "Table" };
    const chartLabel = (t) => CHART_LABEL[t] || t;
    // Relabel user-facing copy through the SAME helper the rest of the app uses, so a
    // portal that renamed a noun (e.g. Contacts → "yogurt parfaits") sees its own word.
    const RL = (s) => (App.relabelText ? App.relabelText(s, { all: true }) : s);

    function entryRow() {
      ensureOnrampCss();
      const row = el("div", "rw-entry-row");
      const mk = (glyph, title, sub, cta, onClick) => {
        const c = el("div", "rw-entry-card"); c.setAttribute("role", "button"); c.tabIndex = 0;
        c.innerHTML = `<span class="rw-entry-icon">${glyph}</span><span class="rw-entry-main"><span class="rw-entry-title">${title}</span><span class="rw-entry-sub">${sub}</span></span><span class="rw-entry-cta">${cta}</span>`;
        c.onclick = onClick; c.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } };
        return c;
      };
      row.appendChild(mk(gridGlyph(), "Start from a template", "Browse ready-made report widgets and add one to this dashboard.", "Browse →", openTemplateGallery));
      row.appendChild(mk(sparkGlyph(), "Build with a wizard", "Answer a few questions and we'll build the widget for you.", "Start →", openWizard));
      return row;
    }

    // Clone a preset/wizard widget, drop anything not present in THIS portal's sources
    // (graceful), assign an id, then append + persist + repaint via the normal path.
    function sanitizeWidget(def) {
      const src = state.sources[def.source];
      if (!src) return { error: "This template's data source isn't available in this portal." };
      const w = JSON.parse(JSON.stringify(def));
      const byKey = {}; (src.reportFields || []).forEach((f) => { byKey[f.key] = f; });
      w.groupBy = (w.groupBy || []).filter((d) => d && byKey[d.key]);
      w.series = (w.series || []).filter((d) => d && byKey[d.key]);
      if (w.measure && (w.measure.op === "sum" || w.measure.op === "avg")) {
        const f = byKey[w.measure.field];
        if (!f || (f.type !== "number" && f.type !== "percent")) w.measure = { op: "count" };
      }
      w.series = w.series || []; w.filters = w.filters || [];
      return { widget: w };
    }
    async function applyWidget(def) {
      let dash = current();
      if (!dash && state.dashboards.length) { state.currentId = state.dashboards[0].id; dash = current(); }
      if (!dash) { toast("Create a dashboard first", true); return false; }
      const s = sanitizeWidget(def);
      if (s.error) { toast(s.error, true); return false; }
      s.widget.id = "w" + Date.now() + Math.floor(Math.random() * 999);
      dash.widgets = dash.widgets || []; dash.widgets.push(s.widget);
      await persist(dash); paint();
      return true;
    }

    async function openTemplateGallery() {
      ensureOnrampCss();
      const inner = el("div");
      inner.innerHTML = `<div class="modal-head"><h2>Report templates</h2><button class="icon-btn" id="tpl-close">&times;</button></div><div class="modal-body" id="tpl-body"><div class="cell-muted">Loading…</div></div>`;
      const overlay = modal(inner);
      inner.querySelector("#tpl-close").onclick = () => overlay.remove();
      let data;
      try { data = await App.portalApi("/api/reports/presets"); }
      catch (e) { inner.querySelector("#tpl-body").innerHTML = `<div class="cell-muted">Couldn't load templates.</div>`; return; }
      const body = inner.querySelector("#tpl-body"); body.innerHTML = "";
      const cats = data.categories || [], presets = data.presets || [];
      // Only categories that actually have templates get a tab (empties are skipped).
      const tabs = cats.filter((c) => presets.some((p) => p.category === c.key));
      // Safety net: any template whose category isn't in the server list still shows,
      // grouped under an "Other" tab at the end.
      const known = new Set(cats.map((c) => c.key));
      const orphans = presets.filter((p) => !known.has(p.category));
      if (orphans.length) tabs.push({ key: "__other", label: "Other" });
      if (!tabs.length) { body.innerHTML = `<div class="cell-muted">No templates available.</div>`; return; }

      const presetsFor = (key) => (key === "__other" ? orphans : presets.filter((p) => p.category === key));
      const gallery = el("div", "tpl-gallery");
      const rail = el("div", "tpl-cats");
      const panel = el("div", "tpl-panel");
      gallery.appendChild(rail); gallery.appendChild(panel); body.appendChild(gallery);

      const makeCard = (p) => {
        const card = el("div", "preset-card");
        card.innerHTML = `<div><div class="preset-name">${esc(RL(p.name))}</div><div class="preset-desc">${esc(RL(p.description))}</div></div>
          <div class="preset-shape"><span class="shape-chip">${esc(chartLabel(p.type))}</span></div>
          <div class="preset-card-foot"><button class="btn btn-primary btn-sm">Add to dashboard</button></div>`;
        card.querySelector("button").onclick = async () => {
          const def = Object.assign({}, p.widget, { title: RL(p.widget.title) });
          if (await applyWidget(def)) { overlay.remove(); toast("Widget added"); }
        };
        return card;
      };

      const selectCat = (cat) => {
        [...rail.children].forEach((b) => b.classList.toggle("active", b.dataset.key === cat.key));
        panel.innerHTML = "";
        panel.appendChild(el("div", "tpl-panel-title", esc(cat.label)));
        const grid = el("div", "preset-grid");
        presetsFor(cat.key).forEach((p) => grid.appendChild(makeCard(p)));
        panel.appendChild(grid);
      };

      tabs.forEach((cat, i) => {
        const b = el("button", "tpl-cat" + (i === 0 ? " active" : ""));
        b.dataset.key = cat.key;
        b.innerHTML = `${esc(cat.label)}<span class="tpl-cat-count">${presetsFor(cat.key).length}</span>`;
        b.onclick = () => selectCat(cat);
        rail.appendChild(b);
      });
      selectCat(tabs[0]);
    }

    function openWizard() {
      ensureOnrampCss();
      const srcOpts = sourceOptions();
      if (!srcOpts.length) { toast("No data sources available yet.", true); return; }
      const draft = { source: srcOpts[0].key, measureOp: "count", measureField: null, groupKey: "", groupDate: "day", type: "auto", title: "" };
      let step = 1; const LAST = 5; let previewCharts = [];
      const inner = el("div"); const overlay = modal(inner);
      const clearPreview = () => { previewCharts.forEach((c) => { try { c.destroy(); } catch (e) {} }); previewCharts = []; };
      overlay.addEventListener("click", (e) => { if (e.target === overlay) clearPreview(); });
      const srcObj = () => state.sources[draft.source] || state.sources[srcOpts[0].key];
      const fieldLabel = (k) => { const f = (srcObj().reportFields || []).find((x) => x.key === k); return f ? f.label : k; };
      const isDate = (k) => { const f = (srcObj().reportFields || []).find((x) => x.key === k); return !!(f && f.type === "date"); };
      const numericFields = () => (srcObj().reportFields || []).filter((f) => f.type === "number" || f.type === "percent" || f.type === "line_items" || f.type === "progress");
      function inferType() { if (!draft.groupKey) return "kpi"; return isDate(draft.groupKey) ? "line" : "bar"; }
      function autoTitle() {
        const sl = (srcOpts.find((o) => o.key === draft.source) || {}).label || draft.source;
        let m = draft.measureOp === "count" ? sl : (draft.measureOp === "sum" ? "Total " : "Average ") + fieldLabel(draft.measureField);
        if (draft.groupKey) m += " by " + (isDate(draft.groupKey) ? draft.groupDate : fieldLabel(draft.groupKey));
        return RL(m);
      }
      function buildWidget() {
        const type = draft.type === "auto" ? inferType() : draft.type;
        const measure = draft.measureOp === "count" ? { op: "count" } : { op: draft.measureOp, field: draft.measureField };
        const groupBy = draft.groupKey ? [isDate(draft.groupKey) ? { key: draft.groupKey, date: draft.groupDate } : { key: draft.groupKey }] : [];
        return { title: (draft.title || "").trim() || autoTitle(), type, source: draft.source, measure, groupBy, series: [], filters: [] };
      }
      function optBtn(label, selected, onClick) { const b = el("button", "rw-wiz-opt" + (selected ? " sel" : "")); b.innerHTML = label; b.onclick = onClick; return b; }
      function render() {
        clearPreview();
        const titles = ["", "What do you want to look at?", "What do you want to measure?", "Break it down by? (optional)", "How should it look?", "Review & add"];
        const steps = [1, 2, 3, 4, 5].map((n) => `<div class="rw-wiz-step${n <= step ? " on" : ""}"></div>`).join("");
        inner.innerHTML = `<div class="modal-head"><h2>Build a widget</h2><button class="icon-btn" id="wz-close">&times;</button></div>
          <div class="modal-body"><div class="rw-wiz-steps">${steps}</div><h3 class="rw-step-title">${esc(titles[step])}</h3><div id="wz-body"></div>
          <div class="rw-wiz-foot"><button class="btn btn-ghost btn-sm" id="wz-back">Back</button><button class="btn btn-primary btn-sm" id="wz-next">${step === LAST ? "Add to dashboard" : "Next →"}</button></div></div>`;
        inner.querySelector("#wz-close").onclick = () => { clearPreview(); overlay.remove(); };
        const back = inner.querySelector("#wz-back"); back.disabled = step === 1; back.classList.toggle("u-invisible", step === 1);
        back.onclick = () => { step = Math.max(1, step - 1); render(); };
        inner.querySelector("#wz-next").onclick = onNext;
        const body = inner.querySelector("#wz-body");

        if (step === 1) {
          srcOpts.forEach((o) => body.appendChild(optBtn(esc(RL(o.label)), draft.source === o.key, () => { if (draft.source !== o.key) { draft.source = o.key; draft.measureOp = "count"; draft.measureField = null; draft.groupKey = ""; } render(); })));
        } else if (step === 2) {
          body.appendChild(optBtn("<b>Count</b> — how many " + esc(RL((srcOpts.find((o) => o.key === draft.source) || {}).label || "rows").toLowerCase()), draft.measureOp === "count", () => { draft.measureOp = "count"; render(); }));
          const nums = numericFields();
          if (!nums.length) { const p = el("p", "cell-muted rp-note6"); p.textContent = "This source has no numeric fields, so counting is the only option."; body.appendChild(p); }
          nums.forEach((f) => {
            body.appendChild(optBtn("<b>Total</b> of " + esc(RL(f.label)), draft.measureOp === "sum" && draft.measureField === f.key, () => { draft.measureOp = "sum"; draft.measureField = f.key; render(); }));
            body.appendChild(optBtn("<b>Average</b> of " + esc(RL(f.label)), draft.measureOp === "avg" && draft.measureField === f.key, () => { draft.measureOp = "avg"; draft.measureField = f.key; render(); }));
          });
        } else if (step === 3) {
          body.appendChild(optBtn("<b>Don't break it down</b> — one total", !draft.groupKey, () => { draft.groupKey = ""; render(); }));
          (srcObj().reportFields || []).forEach((f) => body.appendChild(optBtn("By " + esc(RL(f.label)), draft.groupKey === f.key, () => { draft.groupKey = f.key; render(); })));
          if (draft.groupKey && isDate(draft.groupKey)) {
            const g = el("div", "u-mt-10");
            g.innerHTML = `<label class="field-label">Group dates by</label>`;
            const sel = el("select", "input"); [["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (v === draft.groupDate) o.selected = true; sel.appendChild(o); });
            sel.onchange = () => { draft.groupDate = sel.value; }; g.appendChild(sel); body.appendChild(g);
          }
        } else if (step === 4) {
          body.appendChild(optBtn("<b>Pick a sensible default for me</b> — currently: " + chartLabel(inferType()), draft.type === "auto", () => { draft.type = "auto"; render(); }));
          const types = draft.groupKey ? ["bar", "line", "pie"] : ["kpi"];
          types.forEach((t) => body.appendChild(optBtn(chartLabel(t), draft.type === t, () => { draft.type = t; render(); })));
          if (!draft.groupKey) { const p = el("p", "cell-muted rp-note6"); p.textContent = "With no breakdown, a single number (KPI) fits best."; body.appendChild(p); }
        } else if (step === 5) {
          const nameWrap = el("div"); nameWrap.innerHTML = `<label class="field-label">Widget name</label>`;
          const nameIn = el("input", "input"); nameIn.value = draft.title || autoTitle(); nameIn.oninput = () => { draft.title = nameIn.value; };
          nameWrap.appendChild(nameIn); body.appendChild(nameWrap);
          body.appendChild(el("div", "field-label", "Preview"));
          const pv = el("div", "card rp-preview"); body.appendChild(pv);
          try { const s = srcObj(); renderWidgetBody(pv, buildWidget(), s, s.rows, s.reportFields, previewCharts); }
          catch (e) { pv.innerHTML = `<p class="cell-muted">${esc(e.message)}</p>`; }
        }
      }
      async function onNext() {
        if (step < LAST) { step++; render(); return; }
        clearPreview();
        if (await applyWidget(buildWidget())) { overlay.remove(); toast("Widget added"); }
      }
      render();
    }

    return api;
  }

  App.reports = {
    render: (host) => createView(host, { onramps: true }).boot(),
    mountHome: (host) => createView(host, { compact: true, home: true, onramps: true }).boot(),
    aggregate, valueOf, bucketDate, measureValue, renderWidgetBody, openWidgetEditor,
    createDashboardEngine: (host, o) => createView(host, o || {}),
  };
})(typeof window !== "undefined" ? window : globalThis);
