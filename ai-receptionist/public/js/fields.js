(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc } = App.util;

  const TYPE_LABELS = {
    text: "Text",
    textarea: "Long text",
    number: "Number",
    percent: "Percent",
    date: "Date",
    checkbox: "Checkbox",
    single_select: "Single select",
    multi_select: "Multi-select",
    phone: "Phone",
    url: "URL",
    email: "Email",
    formula: "Formula",
    image: "Image",
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
    if (def.type === "checkbox") return value ? "Yes" : "No";
    if (def.type === "image") return value ? "(image)" : "";
    return scalar(value);
  }

  // Build an editor for a set of fields into `container`, mutating `values`.
  // Returns a recompute() for formula fields.
  function renderEditor(container, fields, values, opts) {
    opts = opts || {};
    const readOnly = !!opts.readOnly;
    container.innerHTML = "";
    const formulaUpdaters = [];

    function refreshFormulas() { formulaUpdaters.forEach((fn) => fn()); }

    fields.forEach((def) => {
      const row = el("div", "form-row");
      const lab = el("label", "form-label", esc(def.label) + (def.required ? ' <span class="req">*</span>' : ""));
      row.appendChild(lab);

      const setVal = (v) => { values[def.key] = v; if (opts.onChange) opts.onChange(); refreshFormulas(); };
      let node;

      if (def.type === "formula") {
        node = el("div", "form-static");
        const update = () => { node.textContent = computeFormula(def.formula, fields, values) || "—"; };
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
      } else {
        node = el("input", "input");
        node.type = def.type === "number" || def.type === "percent" ? "number"
          : def.type === "email" ? "email" : def.type === "url" ? "url"
          : def.type === "phone" ? "tel" : def.type === "date" ? "date" : "text";
        let v = values[def.key];
        if (def.type === "date" && v) v = String(v).slice(0, 10);
        node.value = v == null ? "" : v;
        node.disabled = readOnly;
        node.oninput = () => setVal(node.value);
        if (def.type === "percent") { const wrap = el("div", "form-percent"); wrap.appendChild(node); wrap.appendChild(el("span", "form-suffix", "%")); row.appendChild(lab); row.appendChild(wrap); container.appendChild(row); return; }
      }

      row.appendChild(node);
      container.appendChild(row);
    });

    return refreshFormulas;
  }

  App.fields = { TYPE_LABELS, TYPES_WITH_OPTIONS, SYSTEM_KEYS, renderEditor, formatValue, computeFormula };
})(typeof window !== "undefined" ? window : globalThis);
