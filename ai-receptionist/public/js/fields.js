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
    checkbox: "Checkbox",
    single_select: "Single select",
    multi_select: "Multi-select",
    phone: "Phone",
    url: "URL",
    email: "Email",
    formula: "Formula",
    image: "Image",
    file: "File",
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

  // Display string for a field value (used in read contexts).
  function formatValue(def, value, fields, values) {
    if (def.type === "formula") return computeFormula(def.formula, fields || [], values || {});
    if (def.type === "percent") return value === "" || value == null ? "" : `${value}%`;
    if (def.type === "currency") {
      if (value === "" || value == null) return "";
      const n = Number(value);
      return isFinite(n) ? "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
    }
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
    container.innerHTML = "";
    const formulaUpdaters = [];

    function refreshFormulas() { formulaUpdaters.forEach((fn) => fn()); }

    fields.forEach((def) => {
      const row = el("div", "form-row");
      // Wide field types span both columns in a two-column grid layout.
      if (def.type === "textarea" || def.type === "multi_select" || def.type === "image" || def.type === "file" || def.type === "formula") row.classList.add("form-row--wide");
      const lab = el("label", "form-label", esc(def.label) + (def.required ? ' <span class="req">*</span>' : ""));
      row.appendChild(lab);

      const setVal = (v) => { values[def.key] = v; if (opts.onChange) opts.onChange(); refreshFormulas(); };
      let node;

      if (def.type === "formula") {
        node = el("div", "form-static");
        const update = () => { node.textContent = computeFormula(def.formula, allFields, values) || "—"; };
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
          : def.type === "phone" ? "tel" : def.type === "date" ? "date" : "text";
        let v = values[def.key];
        if (def.type === "date" && v) v = String(v).slice(0, 10);
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

  App.fields = { TYPE_LABELS, TYPES_WITH_OPTIONS, SYSTEM_KEYS, renderEditor, renderGroupedEditor, formatValue, computeFormula };
})(typeof window !== "undefined" ? window : globalThis);
