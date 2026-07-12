(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc } = App.util;

  const TYPE_LABELS = {
    text: "Text",
    textarea: "Long text",
    number: "Number",
    percent: "Percent",
    currency: "Currency",
    date: "Date",
    time: "Time",
    datetime: "Date & time",
    checkbox: "Checkbox",
    single_select: "Single select",
    multi_select: "Multi-select",
    phone: "Phone",
    url: "URL",
    email: "Email",
    formula: "Formula",
    image: "Image",
    file: "File",
    address: "Address",
    rating: "Rating",
    duration: "Duration",
    line_items: "Line items",
  };
  const TYPES_WITH_OPTIONS = ["single_select", "multi_select"];
  const SYSTEM_KEYS = ["name", "phone", "email", "intent"];

  function scalar(v) {
    if (v == null) return "";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  }

  function computeFormula(formula, fields, values) {
    if (!formula) return "";
    return formula.replace(/\{\{([^}]+)\}\}/g, (_m, name) => {
      const f = fields.find((ff) => ff.label.toLowerCase() === String(name).trim().toLowerCase());
      return f ? scalar(values[f.key]) : "";
    });
  }

  function fmtMoney(n) {
    const x = Number(n);
    return isFinite(x) ? "$" + x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  }
  // Line items: value is an array of { description, quantity, unitPrice }. Line total and
  // grand total are DERIVED. These helpers normalize/summarize and are the single source of
  // truth reused by the editor, list cells, reporting, and export.
  function lineItemsRows(v) {
    if (!Array.isArray(v)) return [];
    return v.map(function (r) {
      r = r || {};
      return { description: r.description == null ? "" : String(r.description), quantity: r.quantity, unitPrice: r.unitPrice };
    });
  }
  function lineItemRowTotal(r) { return (Math.max(0, Number((r && r.quantity)) || 0)) * (Math.max(0, Number((r && r.unitPrice)) || 0)); }
  function lineItemsTotal(v) { return lineItemsRows(v).reduce(function (sum, r) { return sum + lineItemRowTotal(r); }, 0); }
  function lineItemsCount(v) {
    return lineItemsRows(v).filter(function (r) { return (r.description && String(r.description).trim()) || Number(r.quantity) || Number(r.unitPrice); }).length;
  }
  // Compact one-line summary for list cells etc. e.g. "3 items · $815.00".
  function lineItemsSummary(v) {
    const n = lineItemsCount(v);
    if (!n) return "";
    return n + (n === 1 ? " item · " : " items · ") + fmtMoney(lineItemsTotal(v));
  }

  function fmtDuration(mins) {
    const n = Math.max(0, Math.round(Number(mins) || 0));
    const h = Math.floor(n / 60), m = n % 60;
    if (!n) return "0m";
    return (h ? h + "h" : "") + (h && m ? " " : "") + (m ? m + "m" : "");
  }
  function fmtAddress(v) {
    if (!v) return "";
    if (typeof v === "string") return v;
    return [v.street, v.city, v.state, v.postal, v.country].map(function (x) { return (x == null ? "" : String(x)).trim(); }).filter(Boolean).join(", ");
  }
  // Friendly clock time from stored "HH:mm" (24-hour) -> "2:30 PM".
  function fmtTime(v) {
    if (v == null || v === "") return "";
    const m = /^(\d{1,2}):(\d{2})/.exec(String(v));
    if (!m) return String(v);
    let H = parseInt(m[1], 10); const M = m[2];
    if (!isFinite(H)) return String(v);
    const ap = H >= 12 ? "PM" : "AM";
    let h12 = H % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + M + " " + ap;
  }
  const MON_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Friendly date+time from stored "YYYY-MM-DDTHH:mm" -> "Jun 5, 2026 2:30 PM".
  function fmtDateTime(v) {
    if (v == null || v === "") return "";
    const s = String(v);
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(s);
    if (!m) return s;
    const mo = MON_ABBR[parseInt(m[2], 10) - 1] || m[2];
    return mo + " " + parseInt(m[3], 10) + ", " + m[1] + " " + fmtTime(m[4] + ":" + m[5]);
  }

  // Display string for a field value (used in read contexts).
  function formatValue(def, value, fields, values) {
    if (def.type === "formula") return computeFormula(def.formula, fields || [], values || {});
    if (def.type === "percent") return value === "" || value == null ? "" : `${value}%`;
    if (def.type === "currency") {
      if (value === "" || value == null) return "";
      return fmtMoney(value);
    }
    if (def.type === "line_items") return lineItemsSummary(value);
    if (def.type === "rating") { const n = Number(value); return value === "" || value == null || !isFinite(n) ? "" : `${Math.round(n)}/5`; }
    if (def.type === "duration") return value === "" || value == null ? "" : fmtDuration(value);
    if (def.type === "time") return fmtTime(value);
    if (def.type === "datetime") return fmtDateTime(value);
    if (def.type === "address") return fmtAddress(value);
    if (def.type === "checkbox") return value ? "Yes" : "No";
    if (def.type === "image") return value ? "(image)" : "";
    if (def.type === "file") return value ? ((value && value.name) || "(file)") : "";
    return scalar(value);
  }

  // Build an editor for a set of fields into `container`, mutating `values`.
  // Returns a recompute() for formula fields.
  function renderEditor(container, fields, values, opts) {
    opts = opts || {};
    const readOnly = !!opts.readOnly;
    const allFields = opts.allFields || fields; // formulas may reference fields in other sections
    // Invoices' computed Total reads from the line_items field (if the module has one).
    const liKey = (allFields.find((f) => f.type === "line_items") || {}).key;
    container.innerHTML = "";
    const formulaUpdaters = [];

    function refreshFormulas() { formulaUpdaters.forEach((fn) => fn()); }

    fields.forEach((def) => {
      const row = el("div", "form-row");
      // Wide field types span both columns in a two-column grid layout.
      if (def.type === "textarea" || def.type === "multi_select" || def.type === "image" || def.type === "file" || def.type === "address" || def.type === "line_items" || def.type === "formula") row.classList.add("form-row--wide");
      const lab = el("label", "form-label", esc(def.label) + (def.required ? ' <span class="req">*</span>' : ""));
      row.appendChild(lab);

      const setVal = (v) => { values[def.key] = v; if (opts.onChange) opts.onChange(); refreshFormulas(); };
      let node;

      if (def.type === "formula") {
        node = el("div", "form-static");
        const update = () => { node.textContent = computeFormula(def.formula, allFields, values) || "—"; };
        update();
        formulaUpdaters.push(update);
      } else if (def.type === "currency" && def.key === "total" && liKey) {
        // Invoices' COMPUTED Total (Task 2): read-only, derived live from the line_items
        // field's summed total. Never hand-typed; the server recomputes authoritatively too.
        node = el("div", "form-static form-computed-total");
        const update = () => { const t = lineItemsTotal(values[liKey]); values[def.key] = t; node.textContent = fmtMoney(t) || "$0.00"; };
        update();
        formulaUpdaters.push(update);
      } else if (def.type === "textarea") {
        node = el("textarea", "input"); node.rows = 3; node.value = values[def.key] || "";
        node.disabled = readOnly; node.oninput = () => setVal(node.value);
      } else if (def.type === "checkbox") {
        node = el("label", "form-check");
        const cb = el("input"); cb.type = "checkbox"; cb.checked = !!values[def.key]; cb.disabled = readOnly;
        cb.onchange = () => setVal(cb.checked);
        node.appendChild(cb); node.appendChild(el("span", null, "Yes"));
      } else if (def.type === "single_select") {
        node = el("select", "input"); node.disabled = readOnly;
        const blank = el("option", null, "—"); blank.value = ""; node.appendChild(blank);
        (def.options || []).forEach((o) => { const op = el("option", null, esc(o)); op.value = o; if (values[def.key] === o) op.selected = true; node.appendChild(op); });
        node.onchange = () => setVal(node.value);
      } else if (def.type === "multi_select") {
        node = el("div", "form-multi");
        const cur = Array.isArray(values[def.key]) ? values[def.key].slice() : [];
        (def.options || []).forEach((o) => {
          const c = el("label", "form-check");
          const cb = el("input"); cb.type = "checkbox"; cb.checked = cur.indexOf(o) >= 0; cb.disabled = readOnly;
          cb.onchange = () => { const arr = Array.isArray(values[def.key]) ? values[def.key].slice() : []; const i = arr.indexOf(o); if (cb.checked && i < 0) arr.push(o); if (!cb.checked && i >= 0) arr.splice(i, 1); setVal(arr); };
          c.appendChild(cb); c.appendChild(el("span", null, esc(o)));
          node.appendChild(c);
        });
      } else if (def.type === "image") {
        node = el("div", "form-image");
        const preview = el("img", "form-img-preview");
        if (values[def.key]) preview.src = values[def.key]; else preview.style.display = "none";
        node.appendChild(preview);
        if (!readOnly) {
          const file = el("input"); file.type = "file"; file.accept = "image/*"; file.className = "input";
          file.onchange = () => {
            const f = file.files[0]; if (!f) return;
            if (f.size > 1024 * 1024) { App.util.toast("Image must be under 1 MB", true); file.value = ""; return; }
            const r = new FileReader();
            r.onload = () => { setVal(String(r.result)); preview.src = String(r.result); preview.style.display = "block"; };
            r.readAsDataURL(f);
          };
          node.appendChild(file);
          if (values[def.key]) {
            const rm = el("button", "link-danger", "Remove image");
            rm.onclick = () => { setVal(""); preview.style.display = "none"; rm.remove(); };
            node.appendChild(rm);
          }
        }
      } else if (def.type === "rating") {
        // 1–5 stars; click a star to set, click the current value to clear.
        node = el("div", "form-rating");
        const cur = Number(values[def.key]) || 0;
        const stars = [];
        const paint = (n) => stars.forEach((st, i) => { st.textContent = i < n ? "\u2605" : "\u2606"; st.classList.toggle("on", i < n); });
        for (let i = 1; i <= 5; i++) {
          const st = el("button", "form-star"); st.type = "button"; st.dataset.n = String(i);
          if (!readOnly) st.onclick = () => { const nv = (Number(values[def.key]) || 0) === i ? "" : i; setVal(nv); paint(Number(nv) || 0); };
          else st.disabled = true;
          stars.push(st); node.appendChild(st);
        }
        paint(cur);
      } else if (def.type === "duration") {
        // Two inputs (hours + minutes) that store a single integer number of minutes.
        node = el("div", "form-duration");
        const total = Math.max(0, Math.round(Number(values[def.key]) || 0));
        const hIn = el("input", "input"); hIn.type = "number"; hIn.min = "0"; hIn.placeholder = "0"; hIn.value = total ? String(Math.floor(total / 60)) : "";
        const mIn = el("input", "input"); mIn.type = "number"; mIn.min = "0"; mIn.max = "59"; mIn.placeholder = "0"; mIn.value = total ? String(total % 60) : "";
        hIn.disabled = mIn.disabled = readOnly;
        const sync = () => { const mins = (parseInt(hIn.value, 10) || 0) * 60 + (parseInt(mIn.value, 10) || 0); setVal(mins ? mins : ""); };
        hIn.oninput = sync; mIn.oninput = sync;
        node.appendChild(hIn); node.appendChild(el("span", "form-suffix", "h"));
        node.appendChild(mIn); node.appendChild(el("span", "form-suffix", "m"));
      } else if (def.type === "line_items") {
        // Repeating-row mini-table: Description | Qty | Unit price | Line total (auto) | ×,
        // with a live grand-total row and "+ Add row". Stored value is an array of
        // { description, quantity, unitPrice }; fully-empty rows are dropped on commit;
        // qty/price are coerced to non-negative numbers. Money reuses the currency format.
        node = el("div", "form-line-items");
        const work = lineItemsRows(values[def.key]);
        if (!work.length) work.push({ description: "", quantity: "", unitPrice: "" });
        const nonNeg = (x) => { const n = Number(x); return isFinite(n) && n > 0 ? n : 0; };
        const rowIsEmpty = (r) => !(String(r.description || "").trim() || Number(r.quantity) || Number(r.unitPrice));
        function commit() {
          const clean = work.map((r) => ({ description: String(r.description || "").trim(), quantity: nonNeg(r.quantity), unitPrice: nonNeg(r.unitPrice) })).filter((r) => !rowIsEmpty(r));
          setVal(clean);
        }
        if (readOnly) {
          // Static, readable table (used in the read-only "All fields" / recycle preview).
          const items = work.filter((r) => !rowIsEmpty(r));
          const tbl = el("table", "li-table li-table--ro");
          const thead = el("tr"); ["Description", "Qty", "Unit price", "Line total"].forEach((h, i) => { const th = el("th", i ? "li-num" : null, h); thead.appendChild(th); });
          tbl.appendChild(thead);
          if (!items.length) { const tr = el("tr"); const td = el("td", "cell-muted"); td.colSpan = 4; td.textContent = "No line items"; tr.appendChild(td); tbl.appendChild(tr); }
          items.forEach((r) => { const tr = el("tr"); tr.appendChild(el("td", null, esc(r.description || ""))); tr.appendChild(el("td", "li-num", esc(String(nonNeg(r.quantity))))); tr.appendChild(el("td", "li-num", esc(fmtMoney(r.unitPrice)))); tr.appendChild(el("td", "li-num", esc(fmtMoney(lineItemRowTotal(r))))); tbl.appendChild(tr); });
          const tot = el("tr", "li-total-row"); const tl = el("td", "li-total-label"); tl.colSpan = 3; tl.textContent = "Total"; tot.appendChild(tl); tot.appendChild(el("td", "li-num li-grand", esc(fmtMoney(lineItemsTotal(items))))); tbl.appendChild(tot);
          node.appendChild(tbl);
        } else {
          const tbl = el("table", "li-table");
          const grand = el("span", "li-grand");
          function drawTotals() {
            const rowTotals = node.querySelectorAll(".li-row-total");
            work.forEach((r, i) => { if (rowTotals[i]) rowTotals[i].textContent = fmtMoney(lineItemRowTotal(r)); });
            grand.textContent = fmtMoney(lineItemsTotal(work));
          }
          function render() {
            tbl.innerHTML = "";
            const head = el("tr"); ["Description", "Qty", "Unit price", "Line total", ""].forEach((h, i) => { const th = el("th", (i >= 1 && i <= 3) ? "li-num" : null, h); head.appendChild(th); });
            tbl.appendChild(head);
            work.forEach((r, idx) => {
              const tr = el("tr", "li-row");
              const dTd = el("td"); const dIn = el("input", "input"); dIn.value = r.description || ""; dIn.placeholder = "Description"; dIn.oninput = () => { r.description = dIn.value; commit(); }; dTd.appendChild(dIn); tr.appendChild(dTd);
              const qTd = el("td", "li-num"); const qIn = el("input", "input li-qty"); qIn.type = "number"; qIn.min = "0"; qIn.step = "any"; qIn.value = r.quantity == null ? "" : r.quantity; qIn.oninput = () => { r.quantity = qIn.value; drawTotals(); commit(); }; qTd.appendChild(qIn); tr.appendChild(qTd);
              const pTd = el("td", "li-num"); const pWrap = el("div", "form-currency li-price-wrap"); pWrap.appendChild(el("span", "form-prefix", "$")); const pIn = el("input", "input li-price"); pIn.type = "number"; pIn.min = "0"; pIn.step = "0.01"; pIn.inputMode = "decimal"; pIn.value = r.unitPrice == null ? "" : r.unitPrice; pIn.oninput = () => { r.unitPrice = pIn.value; drawTotals(); commit(); }; pWrap.appendChild(pIn); pTd.appendChild(pWrap); tr.appendChild(pTd);
              const tTd = el("td", "li-num"); tTd.appendChild(el("span", "li-row-total", fmtMoney(lineItemRowTotal(r)))); tr.appendChild(tTd);
              const xTd = el("td", "li-x-cell"); const x = el("button", "li-x", "×"); x.type = "button"; x.title = "Remove row"; x.onclick = () => { work.splice(idx, 1); if (!work.length) work.push({ description: "", quantity: "", unitPrice: "" }); render(); commit(); }; xTd.appendChild(x); tr.appendChild(xTd);
              tbl.appendChild(tr);
            });
            const totRow = el("tr", "li-total-row"); const tl = el("td", "li-total-label"); tl.colSpan = 3; tl.textContent = "Total"; totRow.appendChild(tl); const gTd = el("td", "li-num"); gTd.appendChild(grand); totRow.appendChild(gTd); totRow.appendChild(el("td")); tbl.appendChild(totRow);
            drawTotals();
          }
          render();
          node.appendChild(tbl);
          const addBtn = el("button", "btn btn-ghost btn-sm li-add", "+ Add row"); addBtn.type = "button";
          addBtn.onclick = () => { work.push({ description: "", quantity: "", unitPrice: "" }); render(); };
          node.appendChild(addBtn);
        }
      } else if (def.type === "address") {
        // Structured address stored as { street, city, state, postal, country }.
        node = el("div", "form-address");
        const cur = (values[def.key] && typeof values[def.key] === "object") ? values[def.key] : {};
        const parts = [["street", "Street"], ["city", "City"], ["state", "State / region"], ["postal", "Postal code"], ["country", "Country"]];
        const model = { street: cur.street || "", city: cur.city || "", state: cur.state || "", postal: cur.postal || "", country: cur.country || "" };
        const commit = () => { const any = Object.keys(model).some((k) => String(model[k]).trim()); setVal(any ? Object.assign({}, model) : ""); };
        parts.forEach(([k, ph]) => {
          const inp = el("input", "input form-address-part"); inp.placeholder = ph; inp.value = model[k]; inp.disabled = readOnly;
          if (k === "street") inp.classList.add("form-address-street");
          inp.oninput = () => { model[k] = inp.value; commit(); };
          node.appendChild(inp);
        });
      } else if (def.type === "file") {
        // Parallel to "image": store { name, data-URL }. Accepts any file (PDF/doc/etc),
        // shows a filename + open/download link. Same in-value storage as image.
        node = el("div", "form-file");
        const info = el("div", "form-file-info");
        const renderInfo = () => {
          info.innerHTML = "";
          const v = values[def.key];
          const href = v && (v.data || (typeof v === "string" ? v : ""));
          if (href) {
            const a = el("a", "form-file-link", esc((v && v.name) || "Attachment"));
            a.href = href; a.target = "_blank"; a.rel = "noopener"; a.download = (v && v.name) || "attachment";
            info.appendChild(a);
          } else { info.appendChild(el("span", "cell-muted", "No file")); }
        };
        renderInfo();
        node.appendChild(info);
        if (!readOnly) {
          const file = el("input"); file.type = "file"; file.className = "input";
          let rmBtn = null;
          file.onchange = () => {
            const f = file.files[0]; if (!f) return;
            if (f.size > 2 * 1024 * 1024) { App.util.toast("File must be under 2 MB", true); file.value = ""; return; }
            const r = new FileReader();
            r.onload = () => {
              setVal({ name: f.name, data: String(r.result) }); renderInfo();
              if (!rmBtn) { rmBtn = el("button", "link-danger", "Remove file"); rmBtn.onclick = () => { setVal(""); renderInfo(); rmBtn.remove(); rmBtn = null; }; node.appendChild(rmBtn); }
            };
            r.readAsDataURL(f);
          };
          node.appendChild(file);
          if (values[def.key]) {
            rmBtn = el("button", "link-danger", "Remove file");
            rmBtn.onclick = () => { setVal(""); renderInfo(); rmBtn.remove(); rmBtn = null; };
            node.appendChild(rmBtn);
          }
        }
      } else {
        node = el("input", "input");
        node.type = def.type === "number" || def.type === "percent" || def.type === "currency" ? "number"
          : def.type === "email" ? "email" : def.type === "url" ? "url"
          : def.type === "phone" ? "tel" : def.type === "date" ? "date"
          : def.type === "time" ? "time" : def.type === "datetime" ? "datetime-local" : "text";
        let v = values[def.key];
        if (def.type === "date" && v) v = String(v).slice(0, 10);
        else if (def.type === "datetime" && v) v = String(v).replace(" ", "T").slice(0, 16);
        node.value = v == null ? "" : v;
        node.disabled = readOnly;
        node.oninput = () => setVal(node.value);
        if (def.type === "percent") { const wrap = el("div", "form-percent"); wrap.appendChild(node); wrap.appendChild(el("span", "form-suffix", "%")); row.appendChild(lab); row.appendChild(wrap); container.appendChild(row); return; }
        if (def.type === "currency") { node.step = "0.01"; node.inputMode = "decimal"; const wrap = el("div", "form-currency"); wrap.appendChild(el("span", "form-prefix", "$")); wrap.appendChild(node); row.appendChild(lab); row.appendChild(wrap); container.appendChild(row); return; }
      }

      row.appendChild(node);
      container.appendChild(row);
    });

    return refreshFormulas;
  }

  // Render fields grouped under their section headings (in section order), each
  // group laid out in a responsive two-column grid. Reuses renderEditor per group.
  // Backward compatible: fields with no section render under "Ungrouped" (or with
  // no heading at all if the type has no sections defined), so nothing disappears.
  function renderGroupedEditor(container, fields, values, sections, opts) {
    opts = opts || {};
    container.innerHTML = "";
    const refreshers = [];
    const combinedOnChange = () => { refreshers.forEach((fn) => fn && fn()); if (opts.onChange) opts.onChange(); };
    const sortByOrder = (arr) => arr.slice().sort((a, b) => (a.order || 0) - (b.order || 0));

    const secs = (sections || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const bySection = {};
    secs.forEach((s) => (bySection[s.id] = []));
    const ungrouped = [];
    fields.forEach((f) => { if (f.sectionId && bySection[f.sectionId]) bySection[f.sectionId].push(f); else ungrouped.push(f); });

    function renderGroup(title, groupFields) {
      if (!groupFields.length) return;
      const sec = el("div", "field-section");
      if (title) sec.appendChild(el("div", "field-section-title", esc(title)));
      const grid = el("div", "field-grid");
      const refresh = renderEditor(grid, sortByOrder(groupFields), values, Object.assign({}, opts, { allFields: fields, onChange: combinedOnChange }));
      refreshers.push(refresh);
      sec.appendChild(grid);
      container.appendChild(sec);
    }

    secs.forEach((s) => renderGroup(s.label, bySection[s.id]));
    if (ungrouped.length) renderGroup(secs.length ? "Ungrouped" : null, ungrouped);
    return combinedOnChange;
  }

  App.fields = { TYPE_LABELS, TYPES_WITH_OPTIONS, SYSTEM_KEYS, renderEditor, renderGroupedEditor, formatValue, computeFormula, fmtDuration, fmtAddress, fmtMoney, lineItemsRows, lineItemsTotal, lineItemsSummary };
})(typeof window !== "undefined" ? window : globalThis);
