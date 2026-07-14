// <plumbing-exempt> theme.js IS the theming plumbing: its style/setProperty work applies
// tenant Appearance and theme tokens at runtime (the sanctioned mechanism itself). Exempt
// from the design ratchet by this marker, honored by designAudit.ts. Deleting it re-enables counting.
// Per-PORTAL theming on the client (branding shared by everyone in the portal).
// The Appearance pane loads/saves the PORTAL's theme via /api/theme; the server
// resolves it by tenant. Only PORTAL_ADMIN/SUPER_ADMIN see the editing controls
// (CLIENT_USER gets a read-only notice), and the server enforces the same rule.
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

  // ---- Phase 9b: component-personality overrides (Design-your-own COMPONENT STYLE) ----
  // The four optional fields (corners/shadows/borders/buttons) on the saved theme override
  // the active preset's personality via body.style.setProperty — the SAME precedence
  // mechanism custom colors use (inline style beats the data-theme block). Absent field =
  // the preset's own personality shows through. Values mirror docs/design-system.md.
  const COMPONENT_VARS = ["--radius", "--radius-sm", "--shadow", "--shadow-lg", "--card-border", "--btn-radius", "--btn-weight", "--btn-pad-x"];
  function clearComponents() { const s = document.body.style; COMPONENT_VARS.forEach((v) => s.removeProperty(v)); }
  const COMPONENT_DEFAULTS = { corners: "soft", shadows: "standard", borders: "hairline", buttons: "soft" };
  function isDarkSurface() {
    // Shadows derive alphas from black on dark surfaces (the Dark preset's precedent).
    const panel = getComputedStyle(document.body).getPropertyValue("--panel").trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(panel) ? luminance(panel) <= 0.5 : false;
  }
  const SHADOWS = {
    light: {
      crisp: ["0 1px 2px rgba(20,20,30,0.10)", "0 6px 24px rgba(20,20,30,0.14)"],
      standard: ["0 1px 2px rgba(20,20,30,0.05), 0 2px 8px rgba(20,20,30,0.08)", "0 10px 40px rgba(20,20,30,0.16)"],
      blended: ["0 8px 30px rgba(20,20,30,0.10), 0 2px 10px rgba(20,20,30,0.06)", "0 18px 60px rgba(20,20,30,0.16)"],
    },
    dark: {
      crisp: ["0 1px 2px rgba(0,0,0,0.45)", "0 6px 24px rgba(0,0,0,0.55)"],
      standard: ["0 1px 2px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.4)", "0 10px 40px rgba(0,0,0,0.6)"],
      blended: ["0 8px 30px rgba(0,0,0,0.35), 0 2px 10px rgba(0,0,0,0.25)", "0 18px 60px rgba(0,0,0,0.5)"],
    },
  };
  function applyComponents(ut) {
    clearComponents();
    ut = ut || {};
    const s = document.body.style;
    if (ut.corners === "sharp") { s.setProperty("--radius", "3px"); s.setProperty("--radius-sm", "2px"); }
    else if (ut.corners === "soft") { s.setProperty("--radius", "10px"); s.setProperty("--radius-sm", "7px"); }
    else if (ut.corners === "round") { s.setProperty("--radius", "16px"); s.setProperty("--radius-sm", "12px"); }
    if (ut.shadows === "crisp" || ut.shadows === "standard" || ut.shadows === "blended") {
      const pair = SHADOWS[isDarkSurface() ? "dark" : "light"][ut.shadows];
      s.setProperty("--shadow", pair[0]); s.setProperty("--shadow-lg", pair[1]);
    }
    if (ut.borders === "hairline") s.setProperty("--card-border", "var(--line)");
    else if (ut.borders === "strong") s.setProperty("--card-border", "var(--line-strong)");
    if (ut.buttons === "rect") { s.setProperty("--btn-radius", "4px"); s.setProperty("--btn-weight", "600"); s.setProperty("--btn-pad-x", "14px"); }
    else if (ut.buttons === "soft") { s.setProperty("--btn-radius", "var(--radius-sm)"); s.setProperty("--btn-weight", "650"); s.setProperty("--btn-pad-x", "14px"); }
    else if (ut.buttons === "pill") { s.setProperty("--btn-radius", "999px"); s.setProperty("--btn-weight", "600"); s.setProperty("--btn-pad-x", "18px"); }
  }

  // Apply a RESOLVED theme: {mode:"preset",preset} or {mode:"custom",custom:{...}}.
  function applyResolved(t) {
    t = t || {};
    if (t.mode === "custom" && t.custom) {
      const c = t.custom;
      document.body.dataset.theme = "custom";
      if (App.scene) App.scene.mount("custom");
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
    let id = typeof t.preset === "string" && /^[a-z0-9_-]+$/.test(t.preset) ? t.preset : "light";
    // Safe fallback: a saved preset id that no longer exists (e.g. a retired theme)
    // resolves to the default rather than leaving a blank/broken theme. Uses the
    // server's known preset list once loaded; before that, the charset check stands.
    if (App._presetIds && App._presetIds.length && App._presetIds.indexOf(id) === -1) id = "light";
    document.body.dataset.theme = id;
    if (App.scene) App.scene.mount(id);
  }

  // Resolve a UserTheme {active, customs, funLevel, components} and apply it.
  // Component choices are applied AFTER the resolved theme so they override the active
  // preset's personality — the same precedence order custom colors already use.
  function applyUserTheme(ut) {
    ut = ut || {};
    applyFun(ut.funLevel);
    const a = ut.active || {};
    if (a.mode === "custom") {
      const c = (ut.customs || []).find((x) => x.id === a.customId);
      if (c) { applyResolved({ mode: "custom", custom: c }); applyComponents(ut); return; }
    }
    applyResolved({ mode: "preset", preset: a.preset || "light" });
    applyComponents(ut);
  }

  function resetToDefault() { clearCustom(); clearComponents(); document.body.dataset.theme = "light"; if (App.scene) App.scene.mount("light"); applyFun(0); }

  // Fun-theme decoration intensity. Validates to a finite 0..1 before touching the
  // CSSOM. Only fun-preset CSS reads --fun, so this is a no-op for basic/custom themes.
  function applyFun(level) {
    let n = typeof level === "number" ? level : Number(level);
    if (!isFinite(n)) n = 0;
    n = Math.max(0, Math.min(100, n));
    document.body.style.setProperty("--fun", String(n / 100));
  }

  async function loadAndApply() {
    try {
      const res = await App.portalApi("/api/theme");
      if (res && res.presets) App._presetIds = res.presets.map((p) => p.id);
      applyUserTheme(res.theme);
      App.portalLogo = (res.theme && res.theme.logo) || null;
      return res;
    } catch (e) {
      resetToDefault();
      App.portalLogo = null;
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
    if (data.presets) App._presetIds = data.presets.map((p) => p.id);
    const fonts = data.fonts || [];

    // Branding is a portal-admin setting. A CLIENT_USER sees the portal's theme
    // applied to their UI but cannot change it - show a read-only notice and stop
    // before building any editing controls. (The server also rejects their saves.)
    const role = App.state.me && App.state.me.role;
    if (role === "CLIENT_USER") {
      host.innerHTML =
        `<div class="cell-muted" style="padding:8px 0">` +
        `The appearance of this portal is set by an administrator, so the theme isn't editable from your account.` +
        `</div>`;
      return;
    }

    // prefs is the live, editable PORTAL theme state.
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

    const clampFun = (v) => { let n = Number(v); if (!isFinite(n)) n = 0; return Math.max(0, Math.min(100, Math.round(n))); };
    let funSaveTimer = null;
    // Debounce the server PATCH: we update --fun live on every drag, but only save
    // after the user pauses/releases (~300ms idle), not on every pixel.
    function scheduleFunSave(delay) {
      if (funSaveTimer) clearTimeout(funSaveTimer);
      funSaveTimer = setTimeout(async () => {
        funSaveTimer = null;
        try { await persist(); } catch (e) { toast(e.message, true); }
      }, delay == null ? 300 : delay);
    }

    // Continuous "Fun intensity" slider. Lives beneath the Fun dropdown; drives the
    // --fun CSS variable live (0..1) so fun-theme decoration animates smoothly, and
    // only affects fun presets. Persisted (clamped 0..100) via the debounced save.
    function funSlider() {
      const lvl = clampFun(prefs.funLevel);
      const row = el("div", "fun-slider-row");
      row.innerHTML =
        `<label class="fun-slider-label" for="fun-range">Fun intensity ` +
        `<span class="cell-muted" style="font-weight:400">— only affects Fun themes</span></label>` +
        `<div class="fun-slider-controls">` +
        `<span class="fun-range-end">Calm</span>` +
        `<input type="range" id="fun-range" class="fun-range" min="0" max="100" step="1" value="${lvl}" aria-label="Fun intensity">` +
        `<span class="fun-range-end">Extra</span>` +
        `<span class="fun-range-val" id="fun-val">${lvl}</span>` +
        `</div>`;
      const range = row.querySelector("#fun-range");
      const valEl = row.querySelector("#fun-val");
      range.oninput = () => {
        const v = clampFun(range.value);
        valEl.textContent = String(v);
        prefs.funLevel = v;
        App.theme.applyFun(v);   // live, cheap (just sets --fun)
        scheduleFunSave();       // debounced server save
      };
      range.onchange = () => { prefs.funLevel = clampFun(range.value); scheduleFunSave(0); }; // save promptly on release
      return row;
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
      wrap.appendChild(funSlider());

      wrap.appendChild(el("div", "theme-group-label", "Design your own"));
      const designer = el("div", "theme-card theme-custom-card");
      const fontOpts = fonts.map((f) => `<option value="${esc(f.id)}"${f.id === editor.font ? " selected" : ""}>${esc(f.label)}</option>`).join("");
      // Phase 9b: the four component-style segmented rows. Selected segment = the saved
      // field, or the dimension's default when the field is absent (preset personality).
      const compRow = (label, key, opts) => {
        const cur = prefs[key] || COMPONENT_DEFAULTS[key];
        const segs = opts.map(([v, l]) => `<button type="button" class="view-toggle-btn${v === cur ? " active" : ""}" data-comp="${key}" data-val="${v}">${l}</button>`).join("");
        return `<div class="theme-custom-row"><label>${label}</label><div class="view-toggle theme-comp-seg">${segs}</div></div>`;
      };
      designer.innerHTML = `
        <div class="theme-custom">
          <div class="theme-custom-row"><label>Background color</label><input type="color" id="th-bg" value="${editor.background}"></div>
          <div class="theme-custom-row"><label>Content panel color</label><input type="color" id="th-panel" value="${editor.panel}"></div>
          <div class="theme-custom-row"><label>Top bar color</label><input type="color" id="th-top" value="${editor.topbar}"></div>
          <div class="theme-custom-row"><label>Sidebar color</label><input type="color" id="th-side" value="${editor.sidebar}"></div>
          <div class="theme-custom-row"><label>Font color</label><input type="color" id="th-fg" value="${editor.fontColor}"></div>
          <div class="theme-custom-row"><label>Font</label><select id="th-font" class="input">${fontOpts}</select></div>
          <div class="theme-comp-head"><span class="eyebrow">Component style</span><button type="button" id="th-comp-reset" class="th-comp-reset">Reset to theme default</button></div>
          ${compRow("Corners", "corners", [["sharp", "Sharp"], ["soft", "Soft"], ["round", "Round"]])}
          ${compRow("Shadows", "shadows", [["crisp", "Crisp"], ["standard", "Standard"], ["blended", "Blended"]])}
          ${compRow("Borders", "borders", [["hairline", "Hairline"], ["strong", "Strong"]])}
          ${compRow("Buttons", "buttons", [["rect", "Rectangular"], ["soft", "Soft"], ["pill", "Pill"]])}
        </div>`;
      wrap.appendChild(designer);

      // ---- Logo / White-label (below the Font row). Applies to this portal for
      // everyone, regardless of which theme is active. Reuses the same base64
      // image approach as custom-field images; stored in the portal theme. ----
      wrap.appendChild(el("div", "theme-group-label", "Logo / White-label"));
      const logoCard = el("div", "theme-card");
      logoCard.style.padding = "14px";
      const logoCap = el("p", "cell-muted");
      logoCap.style.cssText = "font-size:12.5px;margin:0 0 10px";
      logoCap.textContent = "Upload a PNG or JPEG (max 500 KB) to replace the name in the top-left corner for everyone in this portal. Leave empty to keep the default branding.";
      logoCard.appendChild(logoCap);
      if (prefs.logo) {
        const prev = el("img", "brand-logo-preview");
        prev.src = prefs.logo;
        logoCard.appendChild(prev);
      }
      const logoControls = el("div");
      logoControls.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:" + (prefs.logo ? "10px" : "0") + ";flex-wrap:wrap";
      const logoFile = el("input"); logoFile.type = "file"; logoFile.accept = "image/png,image/jpeg"; logoFile.className = "input"; logoFile.style.flex = "1";
      logoFile.onchange = async () => {
        const f = logoFile.files[0]; if (!f) return;
        if (f.type !== "image/png" && f.type !== "image/jpeg") { toast("Logo must be a PNG or JPEG image", true); logoFile.value = ""; return; }
        if (f.size > 500 * 1024) { toast("Logo must be under 500 KB", true); logoFile.value = ""; return; }
        const r = new FileReader();
        r.onload = async () => {
          prefs.logo = String(r.result);
          try { await persist(); App.portalLogo = (prefs && prefs.logo) || null; if (App.refreshBrand) App.refreshBrand(); toast("Logo saved"); }
          catch (e) { toast(e.message, true); }
          render();
        };
        r.readAsDataURL(f);
      };
      logoControls.appendChild(logoFile);
      if (prefs.logo) {
        const rm = el("button", "link-danger", "Remove logo");
        rm.onclick = async () => {
          prefs.logo = null;
          try { await persist(); App.portalLogo = null; if (App.refreshBrand) App.refreshBrand(); toast("Logo removed"); }
          catch (e) { toast(e.message, true); }
          render();
        };
        logoControls.appendChild(rm);
      }
      logoCard.appendChild(logoControls);
      wrap.appendChild(logoCard);

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
      // Phase 9b: component-style segments apply live via setProperty AND persist
      // immediately (same live-apply as the color pickers; same persist as the preset
      // selects). Absent field = preset personality; a click sets the field.
      designer.querySelectorAll(".theme-comp-seg .view-toggle-btn").forEach((b) => {
        b.onclick = async () => {
          prefs[b.dataset.comp] = b.dataset.val;
          designer.querySelectorAll(`.view-toggle-btn[data-comp="${b.dataset.comp}"]`).forEach((x) => x.classList.toggle("active", x === b));
          applyComponents(prefs); // live, over whatever theme is active
          try { await persist(); } catch (e) { toast(e.message, true); }
        };
      });
      designer.querySelector("#th-comp-reset").onclick = async () => {
        ["corners", "shadows", "borders", "buttons"].forEach((k) => { delete prefs[k]; });
        applyComponents(prefs); // clears the overrides -> the preset's personality returns
        try { await persist(); toast("Component style reset to the theme default"); } catch (e) { toast(e.message, true); }
        render();
      };

      // live preview while designing (not persisted until "Save as new theme")
      const preview = () => { readEditor(); applyResolved({ mode: "custom", custom: editor }); };
      ["#th-bg", "#th-panel", "#th-top", "#th-side", "#th-fg"].forEach((id) => { host.querySelector(id).oninput = preview; });
      host.querySelector("#th-font").onchange = preview;

      saveBtn.onclick = async () => {
        readEditor();
        let name = await App.ui.promptModal({ title: "Save theme", label: "Name this theme", okText: "Save" });
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

  App.theme = { applyResolved, applyUserTheme, applyFun, resetToDefault, loadAndApply, mountSettings, getLogo: function () { return App.portalLogo || null; } };
})(typeof window !== "undefined" ? window : globalThis);
