// Per-USER theming on the client (personal preference, portal-independent).
//
// SECURITY: presets are applied by setting body[data-theme] to a charset-safe
// id only. Custom values are applied via the CSSOM API (style.setProperty) with
// re-validated hex strings + a font id mapped to a hardcoded stack — never by
// building <style>/innerHTML from user input. Theme names are escaped on render.
(function (global) {
  const App = global.App || (global.App = {});

  const FONT_STACKS = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    rounded: '"Nunito", "Segoe UI", system-ui, sans-serif',
    geometric: '"Poppins", "Century Gothic", system-ui, sans-serif',
    humanist: '"Segoe UI", Candara, "Trebuchet MS", system-ui, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  };

  const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const isHex = (v) => typeof v === "string" && HEX_RE.test(v.trim());
  const MAX_NAME = 40;
  const DEFAULT_CUSTOM = { background: "#ffffff", fontColor: "#1a1a1e", sidebar: "#ffffff", topbar: "#ffffff", panel: "#ffffff", font: "system" };

  function hexToRgb(h) { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function toHex(r, g, b) { const f = (x) => ("0" + Math.max(0, Math.min(255, Math.round(x))).toString(16)).slice(-2); return "#" + f(r) + f(g) + f(b); }
  function mix(hex, target, amt) { const [r, g, b] = hexToRgb(hex); return toHex(r + (target - r) * amt, g + (target - g) * amt, b + (target - b) * amt); }
  function luminance(hex) { const [r, g, b] = hexToRgb(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
  function genId() { return "c" + Math.random().toString(36).slice(2, 10); }

  const CUSTOM_VARS = ["--bg", "--ink", "--sidebar-bg", "--topbar-bg", "--panel", "--panel-2", "--line", "--line-strong", "--row-hover", "--font-ui"];
  function clearCustom() { const s = document.body.style; CUSTOM_VARS.forEach((v) => s.removeProperty(v)); }

  // Apply a RESOLVED theme: {mode:"preset",preset} or {mode:"custom",custom:{...}}.
  function applyResolved(t) {
    t = t || {};
    if (t.mode === "custom" && t.custom) {
      const c = t.custom;
      document.body.dataset.theme = "custom";
      clearCustom();
      const s = document.body.style;
      if (isHex(c.fontColor)) s.setProperty("--ink", c.fontColor.trim());
      if (isHex(c.sidebar)) s.setProperty("--sidebar-bg", c.sidebar.trim());
      if (isHex(c.topbar)) s.setProperty("--topbar-bg", c.topbar.trim());
      if (isHex(c.background)) s.setProperty("--bg", c.background.trim());
      s.setProperty("--font-ui", FONT_STACKS[c.font] || FONT_STACKS.system);
      if (isHex(c.panel)) {
        const panel = c.panel.trim();
        s.setProperty("--panel", panel);
        const light = luminance(panel) > 0.5;
        s.setProperty("--panel-2", light ? mix(panel, 0, 0.04) : mix(panel, 255, 0.1));
        s.setProperty("--line", light ? mix(panel, 0, 0.1) : mix(panel, 255, 0.16));
        s.setProperty("--line-strong", light ? mix(panel, 0, 0.17) : mix(panel, 255, 0.26));
        s.setProperty("--row-hover", light ? mix(panel, 0, 0.04) : mix(panel, 255, 0.08));
      }
      return;
    }
    clearCustom();
    const id = typeof t.preset === "string" && /^[a-z0-9_-]+$/.test(t.preset) ? t.preset : "light";
    document.body.dataset.theme = id;
  }

  // Resolve a UserTheme {active, customs} and apply it.
  function applyUserTheme(ut) {
    ut = ut || {};
    const a = ut.active || {};
    if (a.mode === "custom") {
      const c = (ut.customs || []).find((x) => x.id === a.customId);
      if (c) { applyResolved({ mode: "custom", custom: c }); return; }
    }
    applyResolved({ mode: "preset", preset: a.preset || "light" });
  }

  function resetToDefault() { clearCustom(); document.body.dataset.theme = "light"; }

  async function loadAndApply() {
    try {
      const res = await App.portalApi("/api/theme");
      applyUserTheme(res.theme);
      return res;
    } catch (e) {
      resetToDefault();
      return null;
    }
  }

  // ---- Settings UI ----
  async function mountSettings(host) {
    const { el, esc, toast } = App.util;
    host.innerHTML = `<div class="cell-muted" style="padding:8px 0">Loading themes…</div>`;
    let data;
    try { data = await App.portalApi("/api/theme"); }
    catch (e) { host.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; return; }

    const presets = data.presets || [];
    const fonts = data.fonts || [];
    // prefs is the live, editable per-user theme state.
    let prefs = data.theme && data.theme.active ? data.theme : { active: { mode: "preset", preset: "light" }, customs: [] };
    // editor working colors (live preview only until saved)
    let editor = activeCustomColors() || { ...DEFAULT_CUSTOM };

    function activeCustomColors() {
      if (prefs.active.mode === "custom") { const c = prefs.customs.find((x) => x.id === prefs.active.customId); if (c) return { background: c.background, fontColor: c.fontColor, sidebar: c.sidebar, topbar: c.topbar, panel: c.panel, font: c.font }; }
      return null;
    }

    async function persist() {
      const res = await App.portalApi("/api/theme", { method: "PATCH", body: JSON.stringify({ theme: prefs }) });
      prefs = res.theme;
      return prefs;
    }

    function swatchHTML(sw) { return (sw || []).map((s) => `<span class="theme-swatch" style="background:${isHex(s) ? s : "transparent"}"></span>`).join(""); }

    function presetSelect(group) {
      const row = el("div", "theme-dd-row");
      const sel = document.createElement("select");
      sel.className = "input theme-dd"; sel.dataset.group = group;
      const ph = document.createElement("option");
      ph.value = ""; ph.textContent = group === "basic" ? "Choose a basic theme…" : "Choose a fun theme…";
      sel.appendChild(ph);
      presets.filter((p) => p.group === group).forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.label; sel.appendChild(o); });
      const sw = el("div", "theme-swatches theme-dd-swatches");
      sel.onchange = async () => {
        if (!sel.value) return;
        prefs.active = { mode: "preset", preset: sel.value };
        applyUserTheme(prefs);
        try { await persist(); } catch (e) { toast(e.message, true); }
        render();
      };
      row.appendChild(sel); row.appendChild(sw);
      return row;
    }

    function savedSelect() {
      const row = el("div", "theme-dd-row");
      const sel = document.createElement("select");
      sel.className = "input theme-dd"; sel.dataset.saved = "1";
      const ph = document.createElement("option");
      ph.value = ""; ph.textContent = "Choose a saved theme…";
      sel.appendChild(ph);
      prefs.customs.forEach((c) => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
      const sw = el("div", "theme-swatches theme-dd-swatches");
      sel.onchange = async () => {
        if (!sel.value) return;
        prefs.active = { mode: "custom", customId: sel.value };
        editor = activeCustomColors() || editor;
        applyUserTheme(prefs);
        try { await persist(); } catch (e) { toast(e.message, true); }
        render();
      };
      const del = el("button", "btn btn-ghost btn-sm", "Delete");
      del.onclick = async () => {
        if (!sel.value) { toast("Pick a saved theme to delete", true); return; }
        prefs.customs = prefs.customs.filter((c) => c.id !== sel.value);
        if (prefs.active.mode === "custom" && prefs.active.customId === sel.value) prefs.active = { mode: "preset", preset: "light" };
        applyUserTheme(prefs);
        try { await persist(); toast("Theme deleted"); } catch (e) { toast(e.message, true); }
        render();
      };
      row.appendChild(sel); row.appendChild(sw); row.appendChild(del);
      return row;
    }

    function syncControls() {
      host.querySelectorAll(".theme-dd").forEach((sel) => {
        const sw = sel.parentNode.querySelector(".theme-dd-swatches");
        if (sel.dataset.saved) {
          const val = prefs.active.mode === "custom" ? prefs.active.customId : "";
          sel.value = prefs.customs.some((c) => c.id === val) ? val : "";
          const c = prefs.customs.find((x) => x.id === sel.value);
          if (sw) sw.innerHTML = c ? swatchHTML([c.background, c.panel, c.fontColor]) : "";
        } else {
          const group = sel.dataset.group;
          const inGroup = prefs.active.mode === "preset" && presets.some((p) => p.group === group && p.id === prefs.active.preset);
          sel.value = inGroup ? prefs.active.preset : "";
          const p = presets.find((x) => x.id === sel.value);
          if (sw) sw.innerHTML = p ? swatchHTML(p.swatches) : "";
        }
      });
    }

    function render() {
      host.innerHTML = "";
      const wrap = el("div", "theme-section");

      if (prefs.customs.length) {
        wrap.appendChild(el("div", "theme-group-label", "Your saved themes"));
        wrap.appendChild(savedSelect());
      }
      wrap.appendChild(el("div", "theme-group-label", "Basic"));
      wrap.appendChild(presetSelect("basic"));
      wrap.appendChild(el("div", "theme-group-label", "Fun"));
      wrap.appendChild(presetSelect("fun"));

      wrap.appendChild(el("div", "theme-group-label", "Design your own"));
      const designer = el("div", "theme-card theme-custom-card");
      const fontOpts = fonts.map((f) => `<option value="${esc(f.id)}"${f.id === editor.font ? " selected" : ""}>${esc(f.label)}</option>`).join("");
      designer.innerHTML = `
        <div class="theme-custom">
          <div class="theme-custom-row"><label>Background color</label><input type="color" id="th-bg" value="${editor.background}"></div>
          <div class="theme-custom-row"><label>Content panel color</label><input type="color" id="th-panel" value="${editor.panel}"></div>
          <div class="theme-custom-row"><label>Top bar color</label><input type="color" id="th-top" value="${editor.topbar}"></div>
          <div class="theme-custom-row"><label>Sidebar color</label><input type="color" id="th-side" value="${editor.sidebar}"></div>
          <div class="theme-custom-row"><label>Font color</label><input type="color" id="th-fg" value="${editor.fontColor}"></div>
          <div class="theme-custom-row"><label>Font</label><select id="th-font" class="input">${fontOpts}</select></div>
        </div>`;
      wrap.appendChild(designer);

      const saveBar = el("div");
      saveBar.style.marginTop = "14px";
      const saveBtn = el("button", "btn btn-primary btn-sm", "Save as new theme…");
      saveBar.appendChild(saveBtn);
      wrap.appendChild(saveBar);
      host.appendChild(wrap);

      function readEditor() {
        editor = {
          background: host.querySelector("#th-bg").value,
          panel: host.querySelector("#th-panel").value,
          topbar: host.querySelector("#th-top").value,
          sidebar: host.querySelector("#th-side").value,
          fontColor: host.querySelector("#th-fg").value,
          font: host.querySelector("#th-font").value,
        };
      }
      // live preview while designing (not persisted until "Save as new theme")
      const preview = () => { readEditor(); applyResolved({ mode: "custom", custom: editor }); };
      ["#th-bg", "#th-panel", "#th-top", "#th-side", "#th-fg"].forEach((id) => { host.querySelector(id).oninput = preview; });
      host.querySelector("#th-font").onchange = preview;

      saveBtn.onclick = async () => {
        readEditor();
        let name = window.prompt("Name this theme:", "");
        if (name === null) return; // cancelled
        name = String(name).replace(/[<>]/g, "").trim().slice(0, MAX_NAME);
        if (!name) name = "My theme";
        const id = genId();
        prefs.customs.push({ id, name, ...editor });
        prefs.active = { mode: "custom", customId: id };
        applyUserTheme(prefs);
        try { await persist(); toast("Theme saved"); } catch (e) { toast(e.message, true); }
        editor = activeCustomColors() || editor;
        render();
      };

      syncControls();
    }

    render();
  }

  App.theme = { applyResolved, applyUserTheme, resetToDefault, loadAndApply, mountSettings };
})(typeof window !== "undefined" ? window : globalThis);
