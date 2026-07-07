// "Who's online" presence — Google-Drive-style avatar dots in the portal top bar.
// Singleton with careful lifecycle: heartbeat every ~45s and poll every ~30s while
// the tab is VISIBLE and we're inside a portal; pause on tab-hide; stop on leaving
// the portal or signing out. Fails quietly (keeps last dots; retries next cycle).
(function (global) {
  const App = global.App || (global.App = {});
  const HEARTBEAT_MS = 45000, POLL_MS = 30000, DOT = 27, MAX_SHOWN = 6;

  let container = null, present = [], hbTimer = 0, pollTimer = 0, running = false, bound = false;

  function inPortal() { return !!(App.state && App.state.currentPortalId); }

  // Readable initial text: dark ink on light dots, white on dark dots.
  function textOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#fff";
    const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.55 ? "#14140f" : "#ffffff";
  }

  function dotEl(p, overlap) {
    const d = document.createElement("div");
    d.className = "presence-dot";
    d.title = p.name || "Member";
    d.textContent = p.initial || "?";
    d.style.cssText =
      "width:" + DOT + "px;height:" + DOT + "px;border-radius:50%;display:flex;align-items:center;justify-content:center;" +
      "font-size:12px;font-weight:700;user-select:none;flex:0 0 auto;background:" + (p.color || "#888") + ";color:" + textOn(p.color) + ";" +
      "border:2px solid var(--topbar-bg);box-shadow:0 1px 2px rgba(0,0,0,.25);" + (overlap ? "margin-left:-8px;" : "");
    return d;
  }

  function render() {
    if (!container) return;
    container.innerHTML = "";
    if (!present.length) return;
    const shown = present.slice(0, MAX_SHOWN);
    shown.forEach((p, i) => container.appendChild(dotEl(p, i > 0)));
    if (present.length > MAX_SHOWN) {
      const more = document.createElement("div");
      more.className = "presence-dot presence-more";
      more.title = present.slice(MAX_SHOWN).map((p) => p.name).join(", ");
      more.textContent = "+" + (present.length - MAX_SHOWN);
      more.style.cssText =
        "width:" + DOT + "px;height:" + DOT + "px;border-radius:50%;display:flex;align-items:center;justify-content:center;" +
        "font-size:11px;font-weight:700;flex:0 0 auto;margin-left:-8px;background:var(--gray-soft);color:var(--ink);" +
        "border:2px solid var(--topbar-bg);";
      container.appendChild(more);
    }
  }

  async function heartbeat() {
    try { await App.portalApi("/api/presence/heartbeat", { method: "POST" }); } catch (e) { /* quiet */ }
  }
  async function poll() {
    try {
      const r = await App.portalApi("/api/presence");
      present = (r && r.present) || [];
      render();
    } catch (e) { /* keep last dots; retry next cycle */ }
  }

  function startTimers() {
    if (!hbTimer) hbTimer = setInterval(() => { if (!document.hidden) heartbeat(); }, HEARTBEAT_MS);
    if (!pollTimer) pollTimer = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  }
  function stopTimers() { if (hbTimer) clearInterval(hbTimer); if (pollTimer) clearInterval(pollTimer); hbTimer = pollTimer = 0; }

  function onVisibility() {
    if (!running) return;
    if (document.hidden) { stopTimers(); }
    else { heartbeat(); poll(); startTimers(); }
  }

  // Called on every portal render with the fresh strip element.
  function mount(el) {
    container = el;
    if (!inPortal()) { stop(); return; }
    render(); // paint cached dots immediately into the new element
    if (!running) {
      running = true;
      if (!bound) { document.addEventListener("visibilitychange", onVisibility); bound = true; }
      heartbeat(); poll(); startTimers();
    }
  }

  function stop() {
    running = false;
    stopTimers();
    if (bound) { document.removeEventListener("visibilitychange", onVisibility); bound = false; }
    present = [];
    container = null;
  }

  // After changing your own dot color, refresh immediately so it updates live.
  function refresh() { if (running) poll(); }

  App.presence = { mount, stop, refresh };
})(typeof window !== "undefined" ? window : globalThis);
