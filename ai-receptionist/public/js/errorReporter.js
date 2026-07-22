/* devtools-data — the Clarity client error reporter.
 *
 * BOOT-ORDER SAFETY (ledger-style note — util.js taught us this lesson): this file
 * loads FIRST, before every vendor and app script, precisely so that a crash in ANY
 * later file — including the boot path that would otherwise white-screen a tenant's
 * browser — still produces an ErrorEvent row. It therefore depends on NOTHING:
 * no App namespace, no util helpers, no vendor globals. Everything below is wrapped
 * so the reporter itself can NEVER throw, never log noise, and never loop: capture
 * failures die silently, reports are deduped per session, capped, batched, and the
 * server rate-limits per IP on top.
 *
 * PRIVACY: only { message, stack (truncated), route, ts } ever leaves the page.
 * No form values, no message bodies, no tokens.
 */
(function () {
  "use strict";
  try {
    var MAX_PER_SESSION = 20;      // hard session cap
    var STACK_MAX = 4000;          // client-side truncation (server truncates again)
    var FLUSH_MS = 1500;           // batch window
    var sent = 0;
    var seen = {};                 // message|route dedupe for the session
    var queue = [];
    var timer = null;

    function route() {
      try { return String((location.hash || location.pathname || "")).slice(0, 300); } catch (e) { return ""; }
    }
    function flush() {
      timer = null;
      var batch = queue.splice(0, queue.length);
      for (var i = 0; i < batch.length; i++) {
        try {
          // fetch with keepalive so even a mid-navigation crash report survives;
          // .catch(noop) — a failed report is simply gone, by contract.
          fetch("/api/client-errors", {
            method: "POST",
            credentials: "same-origin",
            keepalive: true,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batch[i]),
          }).catch(function () {});
        } catch (e) { /* silent by contract */ }
      }
    }
    function report(message, stack) {
      try {
        if (sent >= MAX_PER_SESSION) return;
        var msg = String(message || "(unknown error)").slice(0, 1000);
        var key = msg + "|" + route();
        if (seen[key]) return;
        seen[key] = true;
        sent++;
        queue.push({ message: msg, stack: stack ? String(stack).slice(0, STACK_MAX) : null, route: route(), meta: { ts: Date.now() } });
        if (!timer) timer = setTimeout(flush, FLUSH_MS);
      } catch (e) { /* silent by contract */ }
    }

    var prevOnError = window.onerror;
    window.onerror = function (message, source, lineno, colno, error) {
      try { report(message, error && error.stack ? error.stack : (source || "") + ":" + lineno + ":" + colno); } catch (e) { /* silent */ }
      if (typeof prevOnError === "function") { try { return prevOnError.apply(this, arguments); } catch (e) { return false; } }
      return false; // never suppress default handling
    };
    window.addEventListener("unhandledrejection", function (ev) {
      try {
        var r = ev && ev.reason;
        report(r && r.message ? r.message : String(r), r && r.stack ? r.stack : null);
      } catch (e) { /* silent */ }
    });
  } catch (e) { /* the reporter itself may never be the problem */ }
})();
