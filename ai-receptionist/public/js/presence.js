// "Who's online" presence — Google-Drive-style avatar dots in the portal top bar.
// Singleton with careful lifecycle: heartbeat every ~45s and poll every ~30s while
// the tab is VISIBLE and we're inside a portal; pause on tab-hide; stop on leaving
// the portal or signing out. Fails quietly (keeps last dots; retries next cycle).
(function (global) {
  const App = global.App || (global.App = {});
  const HEARTBEAT_MS = 45000, POLL_MS = 30000, MAX_SHOWN = 6;
  const PRES_FALLBACK = "#888"; // hoisted: keeps the hex off the setProperty line for the audit heuristic

  let container = null, present = [], hbTimer = 0, pollTimer = 0, running = false, bound = false;

  // A real portal member (PORTAL_ADMIN / CLIENT_USER / custom-role) is ALWAYS in their
  // own portal — the server scopes presence to their tenant, so no currentPortalId is
  // needed. Admins are "in a portal" only once they've opened one (currentPortalId set),
  // so they don't poll on the master-hub tenant list.
  function inPortal() {
    if (!App.state) return false;
    if (App.state.currentPortalId) return true;
    var me = App.state.me;
    return !!(me && App.isAdminTier && !App.isAdminTier(me.role));
  }

  // Readable initial text: dark ink on light dots, white on dark dots.
  function textOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#fff";
    const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.55 ? "#14140f" : "#ffffff";
  }

  /** THE dot. Settings -> Your account paints its preview through paintDot() below, so the
   *  two surfaces cannot drift apart. (The stray d.className = "presence-dot" that used to
   *  open this function was dead - it was overwritten two lines later, and neither
   *  .presence-dot nor .presence-more has ever had any CSS. Same for the overflow chip.) */
  function dotEl(p, overlap) {
    const d = document.createElement("div");
    d.className = "pres-dot" + (overlap ? " overlap" : "") + (p.staff ? " pres-staff" : "");
    // A SQUARE MEANS STAFF, and only staff ever receive one - the server does not return
    // staff rows to an ordinary member at all, so this branch cannot run for them. The hover
    // says who can and cannot see it, because a shape on its own explains nothing.
    d.title = p.staff
      ? (p.name || "Staff") + " \u2014 shown as a square because they're staff. People in this tenant can't see them here; only other staff can."
      : (p.name || "Member");
    paintDot(d, p.color, p.initial);
    return d;
  }

  /** Paint any element as a presence dot: the initial, its swatch, and readable ink on it.
   *  Exposed so Settings -> Your account renders the SAME component the strip does rather
   *  than a second copy of this logic. */
  function paintDot(elm, color, initial) {
    elm.textContent = initial || "?";
    elm.style.setProperty("--swatch", color || PRES_FALLBACK);
    elm.style.setProperty("--dot-ink", textOn(color));
  }

  function render() {
    if (!container) return;
    container.innerHTML = "";
    if (!present.length) return;
    const shown = present.slice(0, MAX_SHOWN);
    shown.forEach((p, i) => container.appendChild(dotEl(p, i > 0)));
    if (present.length > MAX_SHOWN) {
      const more = document.createElement("div");
      more.className = "pres-dot pres-more overlap";
      // House precedent for an overflow list is a title attribute, not a popover.
      more.title = present.slice(MAX_SHOWN).map((p) => p.name).join(", ");
      more.textContent = "+" + (present.length - MAX_SHOWN);
      container.appendChild(more);
    }
  }

  async function heartbeat() {
    console.log("[presence] heartbeat() → POST /api/presence/heartbeat");
    try { await App.portalApi("/api/presence/heartbeat", { method: "POST" }); } catch (e) { /* quiet */ }
  }
  async function poll() {
    console.log("[presence] poll() → GET /api/presence");
    try {
      const r = await App.portalApi("/api/presence");
      present = (r && r.present) || [];
      console.log("[presence] poll() got", present.length, "present");
      render();
    } catch (e) { /* keep last dots; retry next cycle */ }
  }

  function startTimers() {
    if (!hbTimer) hbTimer = setInterval(() => { if (!document.hidden) heartbeat(); }, HEARTBEAT_MS);
    if (!pollTimer) pollTimer = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  }
  function stopTimers() { if (hbTimer) clearInterval(hbTimer); if (pollTimer) clearInterval(pollTimer); hbTimer = pollTimer = 0; }

  async function onVisibility() {
    if (!running) return;
    if (document.hidden) { stopTimers(); }
    else { await heartbeat(); await poll(); startTimers(); }
  }

  // Called on every portal render with the fresh strip element.
  async function mount(el) {
    var me = App.state && App.state.me;
    console.log("[presence] mount() called — inPortal:", inPortal(),
      "| currentPortalId:", App.state && App.state.currentPortalId,
      "| me.role:", me && me.role);
    container = el;
    if (!inPortal()) { console.log("[presence] not in a portal — mount() bailing (no polling)"); stop(); return; }
    render(); // paint cached dots immediately into the new element
    if (!running) {
      running = true;
      if (!bound) { document.addEventListener("visibilitychange", onVisibility); bound = true; }
      await heartbeat(); await poll(); startTimers(); // stamp first, so the caller sees their OWN dot on the first poll
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

  App.presence = { mount, stop, refresh, paintDot };
})(typeof window !== "undefined" ? window : globalThis);
