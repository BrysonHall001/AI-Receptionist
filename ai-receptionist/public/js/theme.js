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

  // ---- Phase 9b.2: personality SLIDERS (revises 9b's segmented enums in place) ----
  // Seven dimensions, each a 0..100 int (plus shadowColor, a hex or null=neutral), applied
  // live via body.style.setProperty — the SAME precedence custom colors use. The shared
  // interpolation map below is the single deterministic slider->tokens function; every
  // formula is documented in docs/design-system.md. PRESET_PERSONALITIES expresses each
  // theme's exaggerated personality as positions; custom fields override per 9b precedence.
  const COMPONENT_VARS = ["--radius", "--radius-sm", "--shadow", "--shadow-lg", "--border-w", "--border-c", "--btn-radius", "--btn-pad-x", "--nav-active-bg", "--nav-active-ink", "--nav-active-bar", "--nav-active-glow", "--table-row-pad", "--list-row-pad"];
  function clearComponents() { const s = document.body.style; COMPONENT_VARS.forEach((v) => s.removeProperty(v)); }

  // Defaults chosen so the formulas REPRODUCE the untouched Clean Light values exactly:
  // corners 35 -> 10px/7px; buttons 23 -> 7px radius + 14px pad (the spec's 35 would give
  // 10px/15px — a visible change, so the default is the position that lands on today);
  // shadows 40 -> the 9a standard verbatim; borders 40 -> 1px --line cards + --line-strong
  // controls; nav 40 -> soft pill with a 0px bar (band start = today); density 64 ->
  // 13px --table-row-pad + 8px list rows (the spec's 40 would give 10px — visibly denser).
  const PERSONALITY_DEFAULTS = { corners: 35, buttons: 23, shadows: 40, borders: 25, navHighlight: 40, density: 64, shadowColor: null, borderColor: null };
  // (borders default moved 40 -> 25 with the ring redefinition: 25 is the position whose
  // 0..4px lerp lands EXACTLY on today's 1px hairline — the pixel-identical default.)

  // 9b enum -> 9b.2 position mapping (legacy saves load correctly forever; map on read,
  // write the numeric format on save).
  const LEGACY_MAP = {
    corners: { sharp: 8, soft: 35, round: 85 },
    shadows: { crisp: 20, standard: 40, blended: 75 },
    borders: { hairline: 25, strong: 80 }, // hairline remapped 40 -> 25 with the ring system (25 = the 1px position)
    buttons: { rect: 10, soft: 35, pill: 90 },
  };
  function normalizePersonality(ut) {
    ut = ut || {};
    const out = {};
    for (const k of ["corners", "shadows", "borders", "buttons", "navHighlight", "density"]) {
      let v = ut[k];
      if (typeof v === "string" && LEGACY_MAP[k] && LEGACY_MAP[k][v] != null) v = LEGACY_MAP[k][v];
      v = Number(v);
      if (Number.isFinite(v) && (k in ut)) out[k] = Math.max(0, Math.min(100, Math.round(v)));
    }
    if (typeof ut.shadowColor === "string" && isHex(ut.shadowColor)) out.shadowColor = ut.shadowColor.trim();
    if (typeof ut.borderColor === "string" && isHex(ut.borderColor)) out.borderColor = ut.borderColor.trim();
    return out;
  }

  // Exaggerated preset personalities (Phase 9b.2 assignment): positions per theme.
  const PRESET_PERSONALITIES = {
    light:     {},
    warm:      {},
    neutral:   { corners: 35, shadows: 20, borders: 40, buttons: 10, navHighlight: 35, density: 40 },
    slate:     { corners: 8,  shadows: 18, borders: 40, buttons: 10, navHighlight: 32, density: 30 },
    steel:     { corners: 6,  shadows: 15, borders: 40, buttons: 8,  navHighlight: 30, density: 28 },
    contrast:  { corners: 5,  shadows: 15, borders: 82, buttons: 8,  navHighlight: 40, density: 32 },
    dark:      {},
    midnight:  { corners: 8,  shadows: 20, borders: 40, buttons: 10, navHighlight: 35, density: 40 },
    graphite:  { corners: 35, shadows: 20, borders: 40, buttons: 10, navHighlight: 35, density: 50 },
    sand:      { corners: 82, shadows: 72, borders: 40, buttons: 45, navHighlight: 45, density: 58 },
    forest:    { corners: 38, shadows: 75, borders: 40, buttons: 35, navHighlight: 45, density: 55 },
    aero:      { corners: 85, shadows: 78, borders: 40, buttons: 92, navHighlight: 55, density: 55 },
    dusk:      { corners: 8,  shadows: 22, borders: 80, buttons: 10, navHighlight: 90, density: 45, shadowColor: "#ff3df0" },
    cottage:   { corners: 38, shadows: 42, borders: 40, buttons: 30, navHighlight: 38, density: 55, shadowColor: "#785a32" },
    sunset:    { corners: 84, shadows: 74, borders: 40, buttons: 50, navHighlight: 48, density: 60 },
    dreamcore: { corners: 90, shadows: 85, borders: 40, buttons: 90, navHighlight: 82, density: 62 },
    academia:  { corners: 10, shadows: 40, borders: 78, buttons: 10, navHighlight: 40, density: 45 },
    vaporwave: { corners: 7,  shadows: 20, borders: 82, buttons: 90, navHighlight: 92, density: 42, shadowColor: "#ff6ad5" },
  };

  function isDarkSurface() {
    const panel = getComputedStyle(document.body).getPropertyValue("--panel").trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(panel) ? luminance(panel) <= 0.5 : false;
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  // Shadow keyframes: [pos, layer1(y,blur,alpha), layer2(y,blur,alpha)] and lg [pos, (y,blur,alpha)].
  // pos 40 reproduces today's strings VERBATIM (light: the 9a standard; dark: the Dark preset).
  const SHADOW_KEYS = {
    light: { s: [[0,[0,0,0],[0,0,0]], [25,[1,2,0.10],[2,8,0]], [40,[1,2,0.05],[2,8,0.08]], [70,[8,30,0.10],[2,10,0.06]], [100,[24,80,0.20],[6,30,0.12]]],
             lg: [[0,[0,0,0]], [25,[6,24,0.14]], [40,[10,40,0.16]], [70,[18,60,0.16]], [100,[32,110,0.26]]] },
    dark:  { s: [[0,[0,0,0],[0,0,0]], [25,[1,2,0.45],[4,16,0]], [40,[1,2,0.30],[4,16,0.40]], [70,[8,30,0.35],[2,10,0.25]], [100,[24,80,0.55],[6,30,0.35]]],
             lg: [[0,[0,0,0]], [25,[6,24,0.55]], [40,[10,40,0.60]], [70,[18,60,0.50]], [100,[32,110,0.65]]] },
  };
  function keyLerp(keys, pos) {
    let lo = keys[0], hi = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) if (pos >= keys[i][0] && pos <= keys[i + 1][0]) { lo = keys[i]; hi = keys[i + 1]; break; }
    const t = hi[0] === lo[0] ? 0 : (pos - lo[0]) / (hi[0] - lo[0]);
    return lo.slice(1).map((layer, li) => layer.map((v, vi) => lerp(v, hi[li + 1][vi], t)));
  }
  const rA = (x) => Math.round(x * 100) / 100;
  function shadowLayer(l, rgb) { return "0 " + Math.round(l[0]) + "px " + Math.round(l[1]) + "px rgba(" + rgb[0] + ", " + rgb[1] + ", " + rgb[2] + ", " + rA(l[2]) + ")"; }

  // THE shared interpolation map: positions -> token values. Pure + deterministic.
  function personalityTokens(p, dark) {
    const t = {};
    const P = Object.assign({}, PERSONALITY_DEFAULTS, p);
    // Corners: 0 brutally square -> 100 silly-bubble. radius = lerp(0,28); sm = 0.7x
    // (0.85x at >=90 so inputs/controls go bubble too). Default 35 -> 10px / 7px.
    const cr = lerp(0, 28, P.corners / 100);
    t["--radius"] = Math.round(cr) + "px";
    t["--radius-sm"] = Math.round(cr * (P.corners >= 90 ? 0.85 : 0.7)) + "px";
    // Buttons: radius lerp(2,24), snapping to the full 999px pill at >=85; pad-x lerp(12,20).
    // Default 23 -> 7px / 14px (today).
    t["--btn-radius"] = P.buttons >= 85 ? "999px" : Math.round(lerp(2, 24, P.buttons / 100)) + "px";
    t["--btn-pad-x"] = Math.round(lerp(12, 20, P.buttons / 100)) + "px";
    // Shadows: keyframed dual-layer; 0 = OFF; base color = shadowColor hex or the neutral
    // base (ink-family rgb(20,20,30) on light, black on dark — the Dark-preset precedent).
    const rgb = P.shadowColor ? hexToRgb(P.shadowColor) : (dark ? [0, 0, 0] : [20, 20, 30]);
    if (P.shadows === 0) { t["--shadow"] = "none"; t["--shadow-lg"] = "none"; }
    else {
      const K = SHADOW_KEYS[dark ? "dark" : "light"];
      const layers2 = keyLerp(K.s, P.shadows);
      const parts = [shadowLayer(layers2[0], rgb)];
      if (layers2[1][2] > 0.001) parts.push(shadowLayer(layers2[1], rgb));
      t["--shadow"] = parts.join(", ");
      t["--shadow-lg"] = shadowLayer(keyLerp(K.lg, P.shadows)[0], rgb);
    }
    // Borders (revisions 1): ONE global chrome ring. --border-w lerps 0px -> 4px in
    // quarter-px steps and paints as INSET box-shadow rings (buttons, cards/panels, the
    // sidebar's right edge, the topbar's bottom edge) — never border-width, so the slider
    // can never shift layout. 0 = borderless everywhere; 100 = chunky 4px chrome.
    // Default 25 -> exactly 1px = today's hairlines. --border-c = the Border-color pick
    // or the theme's --line (Neutral). ZERO-ZERO FLOOR: borders 0 + shadows 0 keeps the
    // 1px hairline so surfaces never vanish.
    let bw = Math.round(lerp(0, 4, P.borders / 100) * 4) / 4;
    if (P.borders === 0 && P.shadows === 0) bw = 1; // the structure floor
    t["--border-w"] = bw + "px";
    t["--border-c"] = P.borderColor ? P.borderColor : "var(--line)";
    // Nav highlight: continuous-ish bands (see docs). Band starts extend the previous
    // band's end state so dragging never pops. Default 40 = soft pill + 0px bar = today.
    const n = P.navHighlight;
    let bg, ink = "var(--accent)", bar = 0, glow = "none";
    if (n < 20) bg = "color-mix(in srgb, var(--accent-soft) " + Math.round(lerp(40, 100, n / 20)) + "%, transparent)";
    else if (n < 40) bg = "var(--accent-soft)";
    else if (n < 60) { bg = "var(--accent-soft)"; bar = Math.round(lerp(0, 3, (n - 40) / 20)); }
    else if (n < 80) { const q = Math.round(lerp(0, 100, (n - 60) / 20)); bg = "color-mix(in srgb, var(--accent) " + q + "%, var(--accent-soft))"; ink = q >= 50 ? "var(--on-accent)" : "var(--accent)"; bar = 3; }
    else { bg = "var(--accent)"; ink = "var(--on-accent)"; bar = 3; const g = Math.round(lerp(0, 18, (n - 80) / 20)); glow = g > 0 ? "0 0 " + g + "px var(--accent)" : "none"; }
    t["--nav-active-bg"] = bg; t["--nav-active-ink"] = ink; t["--nav-active-bar"] = bar + "px"; t["--nav-active-glow"] = glow;
    // Table density: --table-row-pad lerp(4,18); list rows scale off it (8/13 ratio,
    // clamped 3..12). Default 64 -> 13px / 8px (today, incl. the test-pinned 13px).
    const pad = Math.round(lerp(4, 18, P.density / 100));
    t["--table-row-pad"] = pad + "px";
    t["--list-row-pad"] = Math.max(3, Math.min(12, Math.round((pad * 8) / 13))) + "px";
    return t;
  }
  // exposed for the self-test (determinism assertions run against this same map)
  App._personality = { personalityTokens: personalityTokens, PRESET_PERSONALITIES: PRESET_PERSONALITIES, PERSONALITY_DEFAULTS: PERSONALITY_DEFAULTS, LEGACY_MAP: LEGACY_MAP, normalizePersonality: normalizePersonality };

  function applyPersonality(ut) {
    clearComponents();
    const active = (ut && ut.active) || {};
    const presetId = active.mode === "preset" ? active.preset : null;
    const base = (presetId && PRESET_PERSONALITIES[presetId]) || {};
    // 9b precedence, unchanged: the user's custom fields override the active preset's
    // personality exactly like custom colors override preset colors.
    const eff = Object.assign({}, PERSONALITY_DEFAULTS, base, normalizePersonality(ut));
    const tokens = personalityTokens(eff, isDarkSurface());
    const s = document.body.style;
    for (const k of Object.keys(tokens)) s.setProperty(k, tokens[k]);
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
      if (c) { applyResolved({ mode: "custom", custom: c }); applyPersonality(ut); return; }
    }
    applyResolved({ mode: "preset", preset: a.preset || "light" });
    applyPersonality(ut);
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
    // Phase 9c: the preview cards scope each theme's full token set; parse it once.
    const themeVars = await loadThemeVars();
    // Revisions 1: which carousel group is showing (follows the active preset's group).
    let carouselGroup = "basic";
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

    // THE preset-selection path (Phase 9c): extracted verbatim from the old dropdown's
    // onchange so the coverflow carousels fire the EXACT same select -> apply -> persist
    // -> re-render sequence. There is exactly one selection path.
    async function selectPreset(id) {
      prefs.active = { mode: "preset", preset: id };
      applyUserTheme(prefs);
      try { await persist(); } catch (e) { toast(e.message, true); }
      render();
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
    // ===== Revisions 1: THE shared segmented slider component =====
    // One component for every 0..100 slider in the app (Fun intensity + all Component
    // Style controls): a row of 12 small rectangles filled left-to-right in accent
    // (unfilled = --gray-soft), click OR drag across, keyboard arrows when focused,
    // fill animation on the motion token (the global reduced-motion block = instant).
    const FUN_SEGS = 12;
    function segSlider(opts) {
      const seg = el("div", "fun-seg");
      seg.tabIndex = 0;
      seg.setAttribute("role", "slider");
      seg.setAttribute("aria-valuemin", "0");
      seg.setAttribute("aria-valuemax", "100");
      seg.setAttribute("aria-label", opts.ariaLabel || "");
      let html = "";
      for (let i = 0; i < FUN_SEGS; i++) html += `<span class="fun-seg-i" data-i="${i}"></span>`;
      seg.innerHTML = html;
      const cells = Array.from(seg.querySelectorAll(".fun-seg-i"));
      let value = clampFun(opts.value);
      function paint() {
        const filled = Math.round((value / 100) * FUN_SEGS);
        cells.forEach((c, i) => c.classList.toggle("fun-seg-i--on", i < filled));
        seg.setAttribute("aria-valuenow", String(value));
      }
      function setValue(v, commit) {
        value = clampFun(v);
        paint();
        if (opts.onInput) opts.onInput(value);
        if (commit && opts.onCommit) opts.onCommit(value);
      }
      const idxToLevel = (i) => Math.round(((i + 1) / FUN_SEGS) * 100);
      const fromEvent = (e) => {
        const cell = e.target.closest ? e.target.closest(".fun-seg-i") : null;
        if (cell) return idxToLevel(Number(cell.dataset.i));
        const r = seg.getBoundingClientRect();
        return clampFun(Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * 100));
      };
      let dragging = false;
      seg.onpointerdown = (e) => { dragging = true; seg.setPointerCapture(e.pointerId); setValue(fromEvent(e)); };
      seg.onpointermove = (e) => { if (dragging) setValue(fromEvent(e)); };
      seg.onpointerup = (e) => { dragging = false; setValue(fromEvent(e), true); };
      seg.onkeydown = (e) => {
        const step = Math.round(100 / FUN_SEGS);
        if (e.key === "ArrowLeft") { e.preventDefault(); setValue(value - step, true); }
        else if (e.key === "ArrowRight") { e.preventDefault(); setValue(value + step, true); }
      };
      paint();
      return { el: seg, set: (v) => { value = clampFun(v); paint(); }, get value() { return value; } };
    }
    function funSlider() {
      const lvl = clampFun(prefs.funLevel);
      const row = el("div", "fun-slider-row");
      row.innerHTML =
        `<label class="fun-slider-label">Fun intensity ` +
        `<span class="cell-muted" style="font-weight:400">— only affects Fun themes</span></label>` +
        `<div class="fun-slider-controls">` +
        `<span class="fun-range-end">Calm</span>` +
        `<span class="fun-seg-host"></span>` +
        `<span class="fun-range-end">Extra</span>` +
        `<span class="fun-range-val" id="fun-val">${lvl}</span>` +
        `</div>`;
      const valEl = row.querySelector("#fun-val");
      // CONVERGED onto the shared segSlider — same prefs.funLevel field, same
      // App.theme.applyFun live path, same debounced persistence.
      const slider = segSlider({
        ariaLabel: "Fun intensity",
        value: lvl,
        onInput: (v) => { prefs.funLevel = v; valEl.textContent = String(v); App.theme.applyFun(v); scheduleFunSave(); },
        onCommit: () => scheduleFunSave(0),
      });
      row.querySelector(".fun-seg-host").replaceWith(slider.el);
      return row;
    }

    // ================= Phase 9c: coverflow carousels + live preview cards =================
    // The preview card scopes a theme's COMPLETE token set (palette from the THEMES block
    // in styles.css + that preset's 9b.2 personality tokens) onto the card root, so the
    // mock renders in ITS theme no matter which theme the app is running.
    const PALETTE_KEYS = ["--bg", "--panel", "--panel-2", "--ink", "--ink-soft", "--ink-faint", "--line", "--line-strong", "--accent", "--accent-soft", "--accent-strong", "--green", "--green-soft", "--amber", "--amber-soft", "--red", "--red-soft", "--gray-soft", "--row-hover", "--on-accent", "--sidebar-bg", "--topbar-bg", "--font-ui", "--font-display", "--pill-bg"];
    var _themeVarsCache; // HOTFIX KEPT (was `let` = TDZ crash: used above, declared here; `var` hoists; no initializer so the warm cache is never reset)
    async function loadThemeVars() {
      if (_themeVarsCache) return _themeVarsCache;
      let cssText = "";
      try { cssText = await fetch("/styles.css").then((r) => r.text()); } catch (e) { cssText = ""; }
      function blockVars(sel) {
        const i = cssText.indexOf(sel); const out = {}; if (i < 0) return out;
        const st = cssText.indexOf("{", i); let d = 1, j = st + 1;
        while (j < cssText.length && d > 0) { if (cssText[j] === "{") d++; else if (cssText[j] === "}") d--; j++; }
        const body = cssText.slice(st + 1, j - 1);
        const re = /(--[\w-]+):\s*([^;]+);/g; let m;
        while ((m = re.exec(body))) out[m[1]] = m[2].trim();
        return out;
      }
      const root = blockVars(":root {");
      const perTheme = {};
      (App._presetIds || []).forEach((id) => { perTheme[id] = id === "light" ? {} : blockVars('body[data-theme="' + id + '"] {'); });
      _themeVarsCache = { root, perTheme };
      return _themeVarsCache;
    }

    // Fun scenic STAND-INS: scenic/WebGL renderers never run in cards — each fun theme's
    // card background is a static CSS gradient echoing its scenery palette, composed from
    // that theme's own tokens (scoped on the card, so no raw values here).
    const GRADIENT_STANDINS = {
      aero: "linear-gradient(165deg, var(--accent-soft) 0%, var(--bg) 60%, var(--panel-2) 100%)",
      dusk: "linear-gradient(180deg, var(--bg) 0%, color-mix(in srgb, var(--accent) 30%, var(--bg)) 100%)",
      cottage: "linear-gradient(170deg, var(--panel-2) 0%, var(--bg) 100%)",
      vaporwave: "linear-gradient(160deg, color-mix(in srgb, var(--accent) 22%, var(--bg)) 0%, var(--bg) 55%, color-mix(in srgb, var(--green) 18%, var(--bg)) 100%)",
      forest: "linear-gradient(180deg, var(--bg) 0%, color-mix(in srgb, var(--accent) 14%, var(--bg)) 100%)",
      sunset: "linear-gradient(160deg, var(--amber-soft) 0%, var(--accent-soft) 55%, var(--bg) 100%)",
      dreamcore: "linear-gradient(180deg, var(--green-soft) 0%, var(--accent-soft) 45%, var(--amber-soft) 100%)",
      academia: "radial-gradient(120% 90% at 50% 40%, var(--panel-2) 0%, var(--bg) 70%)",
    };

    function hexLum(v) { return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test((v || "").trim()) ? luminance(v.trim()) : 1; }

    // ONE shared preview template: a compact Home-Dashboard mock, pure static markup,
    // built from the REAL component classes (nav-item/active, stat-pill, thead th, pill,
    // btn-primary) so it inherits palette AND personality from the scoped tokens.
    function themePreviewCard(p, vars) {
      const eff = Object.assign({}, vars.root, vars.perTheme[p.id] || {});
      const wrap = el("div", "thc-card");
      wrap.setAttribute("role", "option");
      wrap.setAttribute("aria-label", p.label);
      const scope = el("div", "thc-scope");
      // scope the palette…
      PALETTE_KEYS.forEach((k) => { if (eff[k]) scope.style.setProperty(k, eff[k]); });
      // …and the preset's personality tokens (the 9b.2 map, evaluated for THIS theme)
      const persona = personalityTokens(Object.assign({}, PERSONALITY_DEFAULTS, PRESET_PERSONALITIES[p.id] || {}), hexLum(eff["--panel"]) <= 0.5);
      Object.keys(persona).forEach((k) => scope.style.setProperty(k, persona[k]));
      scope.style.background = GRADIENT_STANDINS[p.id] || "var(--bg)";
      scope.innerHTML =
        '<div class="thc-app">' +
        '<div class="thc-topbar"><span class="thc-dot-sm"></span><span class="thc-topline"></span></div>' +
        '<div class="thc-cols">' +
        '<div class="thc-side"><span class="nav-item">Home</span><span class="nav-item active">Contacts</span><span class="nav-item">Analytics</span></div>' +
        '<div class="thc-main">' +
        '<div class="stat-pill thc-kpi"><div class="stat-pill-value">128</div><div class="stat-pill-cap">Clients</div></div>' +
        '<div class="card thc-table"><table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody>' +
        '<tr><td>Avery Lane</td><td><span class="pill success">Done</span></td></tr>' +
        '<tr><td>Sam Reyes</td><td><span class="pill">Open</span></td></tr>' +
        '<tr><td>Kai Moss</td><td><span class="pill skipped">Hold</span></td></tr>' +
        "</tbody></table></div>" +
        '<span class="btn btn-primary btn-sm thc-btn">New contact</span>' +
        "</div></div></div>";
      wrap.appendChild(scope);
      const name = el("div", "eyebrow thc-name", p.label);
      wrap.appendChild(name);
      return wrap;
    }

    // The coverflow carousel (built once, used for Basic and Fun). Geometry: center flat
    // scale 1; ±1 rotateY(∓38deg) scale .8; ±2 rotateY(∓55deg) scale .65 (a sliver at the
    // page edge); |d|>=3 hidden. Five visible max. Transitions ride the motion token;
    // the global prefers-reduced-motion block makes moves instant snaps. Under 700px the
    // coverflow flattens to a horizontal snap-scroll row (CSS class thc-flat).
    function coverflowCarousel(group, items, selectedId, vars) {
      const root = el("div", "thc-carousel");
      root.tabIndex = 0;
      root.setAttribute("role", "listbox");
      root.setAttribute("aria-label", (group === "basic" ? "Basic" : "Fun") + " themes");
      const stage = el("div", "thc-stage");
      let cur = Math.max(0, items.findIndex((p) => p.id === selectedId));
      const cards = items.map((p, i) => {
        const c = themePreviewCard(p, vars);
        c.onclick = () => { if (i !== cur) pick(i); };
        stage.appendChild(c);
        return c;
      });
      const leftBtn = el("button", "icon-btn thc-arrow thc-arrow-left", "\u2039");
      leftBtn.type = "button"; leftBtn.setAttribute("aria-label", "Previous theme");
      const rightBtn = el("button", "icon-btn thc-arrow thc-arrow-right", "\u203a");
      rightBtn.type = "button"; rightBtn.setAttribute("aria-label", "Next theme");
      const dots = el("div", "thc-dots");
      const dotEls = items.map((p, i) => {
        const d = el("button", "thc-dot");
        d.type = "button"; d.title = p.label; d.setAttribute("aria-label", p.label);
        d.onclick = () => pick(i);
        dots.appendChild(d);
        return d;
      });
      function layout() {
        cards.forEach((c, i) => {
          const d = i - cur;
          c.className = "thc-card " + (d === 0 ? "thc-d0" : d === -1 ? "thc-dm1" : d === 1 ? "thc-dp1" : d === -2 ? "thc-dm2" : d === 2 ? "thc-dp2" : "thc-dhide");
          c.setAttribute("aria-selected", d === 0 ? "true" : "false");
        });
        dotEls.forEach((d, i) => d.classList.toggle("thc-dot--on", i === cur));
        leftBtn.disabled = cur === 0; rightBtn.disabled = cur === items.length - 1;
      }
      function pick(i) {
        i = Math.max(0, Math.min(items.length - 1, i));
        if (i === cur) return;
        cur = i;
        layout(); // the card rotates to center…
        selectPreset(items[i].id); // …and centering IS selecting (the ONE shared path)
      }
      leftBtn.onclick = () => pick(cur - 1);
      rightBtn.onclick = () => pick(cur + 1);
      root.onkeydown = (e) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); pick(cur - 1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); pick(cur + 1); }
      };
      // <700px: flatten to a snap-scroll row (same click-to-select, same labels)
      const fit = () => root.classList.toggle("thc-flat", root.clientWidth > 0 && root.clientWidth < 700);
      if (typeof ResizeObserver !== "undefined") new ResizeObserver(fit).observe(root);
      setTimeout(fit, 0);
      root.appendChild(leftBtn); root.appendChild(stage); root.appendChild(rightBtn); root.appendChild(dots);
      layout();
      return root;
    }

    function swatchHTML(sw) { return (sw || []).map((s) => `<span class="theme-swatch" style="background:${isHex(s) ? s : "transparent"}"></span>`).join(""); }

    // Phase 9c: presetSelect (the two dropdowns) is GONE — the carousels are the only
    // preset pickers, wired to the same selectPreset path.

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
        }
        // (Phase 9c: the preset-dropdown branch is gone with the dropdowns themselves.)
      });
    }

    function render() {
      host.innerHTML = "";
      const wrap = el("div", "theme-section");

      // Phase 9c: page intro -> Basic carousel -> Fun carousel + intensity -> two-column
      // lower zone. The carousels are the ONLY preset pickers (the dropdowns are gone);
      // the roster + grouping still come from the same source (the /api/theme presets
      // list), and centering a card fires the same selectPreset path the dropdowns used.
      wrap.appendChild(el("p", "settings-intro cell-muted", "Pick a theme — the cards are live previews of each theme's colors and component personality. Centering a card applies and saves it."));
      const activePreset = prefs.active.mode === "preset" ? prefs.active.preset : null;
      // Revisions 1: ONE carousel at a time, with a group switcher above it. The visible
      // carousel's centered card = the applied theme. Switching groups: if the saved
      // theme belongs to the new group, just center it (no theme change); if not, center
      // that group's FIRST card AND apply it — deliberately literal: flipping the
      // dropdown flips the theme; the carousel is the source of truth.
      if (activePreset) { const ap = presets.find((p) => p.id === activePreset); if (ap) carouselGroup = ap.group; }
      const groupRow = el("div", "thc-group-row");
      const groupSel = document.createElement("select");
      groupSel.className = "input theme-dd thc-group-sel";
      [["basic", "Basic"], ["fun", "Fun"]].forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; groupSel.appendChild(o); });
      groupSel.value = carouselGroup;
      groupSel.onchange = () => {
        carouselGroup = groupSel.value;
        const groupPresets = presets.filter((p) => p.group === carouselGroup);
        const belongs = activePreset && groupPresets.some((p) => p.id === activePreset);
        if (belongs) render(); // center the saved theme; NO theme change
        else selectPreset(groupPresets[0].id); // apply the group's first card (re-renders)
      };
      groupRow.appendChild(el("span", "eyebrow", "Themes"));
      groupRow.appendChild(groupSel);
      wrap.appendChild(groupRow);
      wrap.appendChild(coverflowCarousel(carouselGroup, presets.filter((p) => p.group === carouselGroup), activePreset, themeVars));
      if (carouselGroup === "fun") wrap.appendChild(funSlider()); // intensity ONLY under Fun

      // Two-column lower zone (stacks under ~900px): Design-your-own | Logo/white-label.
      const lower = el("div", "thc-lower");
      const lowerLeft = el("div", "thc-lower-col");
      const lowerRight = el("div", "thc-lower-col");
      lower.appendChild(lowerLeft); lower.appendChild(lowerRight);

      if (prefs.customs.length) {
        lowerLeft.appendChild(el("div", "theme-group-label", "Your saved themes"));
        lowerLeft.appendChild(savedSelect());
      }
      // the existing builders are untouched; they just mount into the columns now
      lowerLeft.appendChild(el("div", "theme-group-label", "Design your own"));
      const designer = el("div", "theme-card theme-custom-card");
      const fontOpts = fonts.map((f) => `<option value="${esc(f.id)}"${f.id === editor.font ? " selected" : ""}>${esc(f.label)}</option>`).join("");
      // Phase 9b.2: the seven personality controls are SLIDERS (0..100). The shown value =
      // the saved field, mapped from a legacy 9b enum if needed, else the ACTIVE preset's
      // exaggerated position, else the dimension default. Sliders reuse the Fun-intensity
      // slider's styling for now (the segmented-rectangle restyle is 9c's page redesign).
      const presetId = prefs.active && prefs.active.mode === "preset" ? prefs.active.preset : null;
      const presetPersona = Object.assign({}, PERSONALITY_DEFAULTS, (presetId && PRESET_PERSONALITIES[presetId]) || {});
      const effPersona = Object.assign({}, presetPersona, normalizePersonality(prefs));
      const HINTS = { corners: ["Square", "Soft", "Round"], buttons: ["Rect", "Soft", "Pill"], shadows: ["Flat", "Standard", "Dreamy"], borders: ["Airy", "Hairline", "Bold"], navHighlight: ["Whisper", "Pill", "Glow"], density: ["Tight", "Cozy", "Airy"] };
      const hintFor = (key, v) => HINTS[key][v < 34 ? 0 : v < 67 ? 1 : 2] + " " + v;
      const sliderRow = (label, key) => {
        const v = effPersona[key];
        return `<div class="theme-custom-row theme-slider-row"><label>${label}</label>` +
          `<div class="fun-slider-controls th-p-slider" data-dim-host="${key}" data-dim-label="${label}">` +
          `<span class="fun-range-val th-p-hint" data-hint="${key}">${hintFor(key, v)}</span></div></div>`;
      };
      designer.innerHTML = `
        <div class="theme-custom">
          <div class="th-two-col">
          <div class="theme-custom-row"><label>Background color</label><input type="color" id="th-bg" value="${editor.background}"></div>
          <div class="theme-custom-row"><label>Content panel color</label><input type="color" id="th-panel" value="${editor.panel}"></div>
          <div class="theme-custom-row"><label>Top bar color</label><input type="color" id="th-top" value="${editor.topbar}"></div>
          <div class="theme-custom-row"><label>Sidebar color</label><input type="color" id="th-side" value="${editor.sidebar}"></div>
          <div class="theme-custom-row"><label>Font color</label><input type="color" id="th-fg" value="${editor.fontColor}"></div>
          <div class="theme-custom-row"><label>Shadow color</label><div class="th-shadowc-row"><input type="color" id="th-shadowc" value="${esc(effPersona.shadowColor || (luminance((getComputedStyle(document.body).getPropertyValue("--panel").trim() || "#ffffff")) <= 0.5 ? "#000000" : "#14141e"))}"><button type="button" id="th-shadowc-neutral" class="th-comp-reset">Neutral</button></div></div>
          <div class="theme-custom-row"><label>Border color</label><div class="th-shadowc-row"><input type="color" id="th-borderc" value="${esc(effPersona.borderColor || (getComputedStyle(document.body).getPropertyValue("--line").trim().match(/^#[0-9a-fA-F]{6}$/) ? getComputedStyle(document.body).getPropertyValue("--line").trim() : "#e4e4e2"))}"><button type="button" id="th-borderc-neutral" class="th-comp-reset">Neutral</button></div></div>
          <div class="theme-custom-row"><label>Font</label><select id="th-font" class="input">${fontOpts}</select></div>
          </div>
          <div class="theme-comp-head"><span class="eyebrow">Component style</span><button type="button" id="th-comp-reset" class="th-comp-reset">Reset to theme default</button></div>
          <div class="th-two-col">
          ${sliderRow("Corners", "corners")}
          ${sliderRow("Buttons", "buttons")}
          ${sliderRow("Shadows", "shadows")}
          ${sliderRow("Borders", "borders")}
          ${sliderRow("Nav highlight", "navHighlight")}
          ${sliderRow("Table Row Height", "density")}
          </div>
        </div>`;
      lowerLeft.appendChild(designer);

      // ---- Logo / White-label (below the Font row). Applies to this portal for
      // everyone, regardless of which theme is active. Reuses the same base64
      // image approach as custom-field images; stored in the portal theme. ----
      lowerRight.appendChild(el("div", "theme-group-label", "Logo / White-label"));
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
      // layout hardening: the logo controls row is the actions-row primitive (was an
      // ad-hoc inline flex); the conditional top margin rides the existing utility.
      const logoControls = el("div", "actions-row" + (prefs.logo ? " u-mt-10" : ""));
      const logoFile = el("input"); logoFile.type = "file"; logoFile.accept = "image/png,image/jpeg"; logoFile.className = "input grow"; // hardening: .grow replaces the inline flex
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
      lowerRight.appendChild(logoCard);

      const saveBar = el("div", "actions-row u-mt-14"); // hardening: actions-row primitive
      const saveBtn = el("button", "btn btn-primary btn-sm", "Save as new theme…");
      saveBar.appendChild(saveBtn);
      lowerLeft.appendChild(saveBar);
      wrap.appendChild(lower);
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
      // Revisions 1: every Component Style control is the SHARED segSlider (the segmented
      // Fun-intensity style, app-wide). Same live apply + debounced persistence as 9b.2.
      let pSaveTimer = null;
      const schedulePersonalitySave = () => { if (pSaveTimer) clearTimeout(pSaveTimer); pSaveTimer = setTimeout(async () => { pSaveTimer = null; try { await persist(); } catch (e) { toast(e.message, true); } }, 300); };
      designer.querySelectorAll(".th-p-slider[data-dim-host]").forEach((host) => {
        const key = host.dataset.dimHost;
        const slider = segSlider({
          ariaLabel: host.dataset.dimLabel,
          value: effPersona[key],
          onInput: (v) => {
            prefs[key] = v; // numeric = the persisted format
            const hint = designer.querySelector(`[data-hint="${key}"]`); if (hint) hint.textContent = hintFor(key, v);
            applyPersonality(prefs); // live, over whatever theme is active
            schedulePersonalitySave();
          },
          onCommit: () => schedulePersonalitySave(),
        });
        host.insertBefore(slider.el, host.firstChild);
      });
      const shadowC = designer.querySelector("#th-shadowc");
      shadowC.oninput = () => { prefs.shadowColor = shadowC.value; applyPersonality(prefs); schedulePersonalitySave(); };
      designer.querySelector("#th-shadowc-neutral").onclick = () => { delete prefs.shadowColor; applyPersonality(prefs); schedulePersonalitySave(); };
      // Border color: mirrors Shadow color's neutral pattern EXACTLY (pick -> live +
      // persisted with the other custom colors; Neutral -> back to the theme's --line).
      const borderC = designer.querySelector("#th-borderc");
      borderC.oninput = () => { prefs.borderColor = borderC.value; applyPersonality(prefs); schedulePersonalitySave(); };
      designer.querySelector("#th-borderc-neutral").onclick = () => { delete prefs.borderColor; applyPersonality(prefs); schedulePersonalitySave(); };
      designer.querySelector("#th-comp-reset").onclick = async () => {
        ["corners", "shadows", "borders", "buttons", "navHighlight", "density", "shadowColor", "borderColor"].forEach((k) => { delete prefs[k]; });
        applyPersonality(prefs); // back to the ACTIVE preset's exaggerated positions
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
