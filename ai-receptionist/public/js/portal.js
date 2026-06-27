(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, fmtDate, statusBadge, roleLabel, toast } = App.util;

  let current = "dashboard";
  let fieldDropHandled = false; // set true when a field is dropped on a section list

  function view() { return App.util.$("#view"); }
  function setView(v) { current = v; }

  // ---- Calls live auto-refresh ----
  // The Calls page has no server push and previously fetched /api/calls only
  // once on render. This gently polls while the Calls view is open so a call
  // shows as "In progress" the moment it starts and flips to "Completed" when it
  // ends, with NO manual browser refresh — for BOTH the walkie-talkie and the
  // ConversationRelay paths (both create the call row at call start). It repaints
  // ONLY when the data actually changed, and never while the user is typing,
  // selecting text, or viewing a call, so it cannot disrupt anything.
  let callsPoll = null; // setInterval id while the Calls view is active
  let callsSig = null;  // signature of the last painted calls (skip no-op repaints)
  let callsVisHandler = null; // fires an immediate refresh when the tab regains focus

  function stopCallsPoll() {
    if (callsPoll) { clearInterval(callsPoll); callsPoll = null; }
    if (callsVisHandler) {
      document.removeEventListener("visibilitychange", callsVisHandler);
      window.removeEventListener("focus", callsVisHandler);
      callsVisHandler = null;
    }
    callsSig = null;
  }
  function callsSignature(rows) {
    // Include intent (the "Reason") and name so the table repaints when those get
    // captured mid-call, not only when status changes — otherwise a reason that
    // lands while the status is unchanged wouldn't show until a manual refresh.
    return (rows || []).map((r) => r.id + ":" + r.status + ":" + (r.intent || "") + ":" + (r.name || "")).join("|");
  }
  function callsRefreshBlocked() {
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return true;
    const drawer = App.util.$("#drawer");
    if (drawer && !drawer.classList.contains("hidden")) return true; // a call detail is open
    if (document.querySelector(".menu:not(.hidden)")) return true;   // a dropdown menu is open
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length > 0) return true;                  // user is selecting text
    return false;
  }

  async function render(v, sub) {
    setView(v);
    stopCallsPoll(); // any navigation stops the Calls poll; renderCalls restarts it
    if (v === "calls") return renderCalls();
    if (v === "contacts") return renderContacts();
    if (v === "jobs") return renderRecordList("job");
    if (v === "bookings") return renderRecordList("booking");
    if (v === "recycle") return renderRecycleBin();
    if (v === "fields") return renderFields();
    if (v === "reports") return App.reports.render(view());
    if (v === "communication") return App.communication.render(view());
    if (v === "automations") return App.automations.render(view());
    if (v === "learn") return App.learn.render(view());
    if (v === "feedback") return App.feedback.renderPortal(view());
    if (v === "settings") return renderSettings(sub);
    return App.reports.mountHome(view());
  }
  function refresh() { return render(current); }

  function loading() { view().innerHTML = `<div class="card"><div class="skeleton">Loading…</div></div>`; }

  // ---------------- Dashboard ----------------
  // (Old hand-built Dashboard page retired — the "#/dashboard" view now renders the persistent Home Dashboard via App.reports.mountHome.)

  // ---------------- Calls ----------------
  async function renderCalls() {
    loading();
    // Respect the per-portal AI Receptionist switch. When it's off, don't render
    // the Calls UI or pull call data — show a simple notice instead. (The server
    // also returns 403 on /api/calls when off; this is the friendly UI side.)
    let settings = {};
    try { settings = await App.portalApi("/api/settings"); } catch (e) {}
    App.state.receptionistEnabled = !!(settings && settings.receptionistEnabled === true);
    if (!App.state.receptionistEnabled) {
      view().innerHTML = "";
      const off = el("div", "card");
      off.style.cssText = "margin-top:8px;padding:32px;text-align:center;";
      off.innerHTML =
        `<h3 style="margin:0 0 6px;">AI Receptionist is off</h3>` +
        `<p class="cell-muted" style="margin:0;">This feature isn't enabled for this portal.</p>`;
      view().appendChild(off);
      return;
    }
    const calls = await App.portalApi("/api/calls");
    view().innerHTML = "";
    const container = el("div", "fade-in");
    view().appendChild(container);
    let handle = buildCallsTable(container, calls);
    callsSig = callsSignature(calls);
    // AI Instructions editor below the table. Mount it INTO the table's
    // .table-area column (not the full-width view) so it shares the exact same
    // width constraint as the Calls panel above and their edges line up. Falls
    // back to the full view if the area isn't found. It is preserved across live
    // refreshes (the node is moved, not rebuilt), so in-progress edits survive.
    const tableArea = container.querySelector(".table-area");
    await mountAiInstructions(tableArea || view());

    // Start the live auto-refresh for this Calls view (stopped on navigation).
    callsPoll = setInterval(() => {
      if (current !== "calls") { stopCallsPoll(); return; }
      refreshCallsTable(container, () => handle, (h) => { handle = h; });
    }, 4000);

    // Browsers throttle (or pause) setInterval on a backgrounded tab — so if you
    // were watching your phone during a call, the 4s poll may not have fired and
    // the row can look stale. This refreshes the moment you return to the tab, so
    // a finished call (walkie OR smooth) flips In progress -> Completed with no
    // manual refresh. Reuses the same refreshCallsTable mechanism.
    callsVisHandler = () => {
      if (current === "calls" && document.visibilityState !== "hidden") {
        refreshCallsTable(container, () => handle, (h) => { handle = h; });
      }
    };
    document.addEventListener("visibilitychange", callsVisHandler);
    window.addEventListener("focus", callsVisHandler);
  }

  // Shared call column definitions — reused by the Calls table, the Calls-page
  // export, the Data Administration export dropdown, and the Data Backup. The first
  // six are what the Calls page shows; the rest are export-friendly extras hidden on
  // the page (defaultOff) but available to include in an export. Timestamps use
  // fmtDate — the SAME formatter the page already uses (no new timezone conversion).
  function callColumnDefs() {
    return [
      { key: "name", label: "Caller", type: "text", get: (r) => r.name, text: (r) => r.name || "Unknown caller", cellClass: "cell-strong", render: (r) => esc(r.name || "Unknown caller") },
      { key: "phone", label: "Phone", type: "text", get: (r) => r.phone || r.fromNumber, cellClass: "cell-mono" },
      { key: "fromNumber", label: "Caller ID", type: "text", get: (r) => r.fromNumber, cellClass: "cell-mono", render: (r) => esc(r.fromNumber || "—") },
      { key: "intent", label: "Reason", type: "text", get: (r) => r.intent, cellClass: "cell-muted cell-truncate", render: (r) => esc(r.intent || "—") },
      { key: "status", label: "Status", type: "status", get: (r) => r.status, text: (r) => ({ COMPLETED: "Completed", FAILED: "Missed", COLLECTING_INFO: "In progress", GREETING: "In progress", INIT: "New" }[r.status] || r.status), render: (r) => statusBadge(r.status) },
      { key: "createdAt", label: "When", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` },
      { key: "email", label: "Email", type: "text", get: (r) => r.email, text: (r) => r.email || "", defaultOff: true },
      { key: "turnCount", label: "Turns", type: "number", get: (r) => r.turnCount, text: (r) => (r.turnCount == null ? "" : String(r.turnCount)), defaultOff: true },
      { key: "finalizedAt", label: "Finalized", type: "date", get: (r) => r.finalizedAt, text: (r) => (r.finalizedAt ? fmtDate(r.finalizedAt) : ""), defaultOff: true },
      { key: "callSid", label: "Call ID", type: "text", get: (r) => r.callSid, text: (r) => r.callSid || "", defaultOff: true },
    ];
  }
  function callExportOpts(columns, rows) {
    return {
      title: "Export calls",
      columns, rows,
      dataType: "call",
      namePlaceholder: "e.g. June calls",
      filterLabel: "Which calls to export",
      unitPlural: "Calls",
      sheetName: "Calls",
      countText: (n) => n + (n === 1 ? " call" : " calls"),
      saveHistory: true,
    };
  }

  // Build (or rebuild) ONLY the Calls table into `container`, returning the table
  // handle. Shared by the initial render and the live refresh so the two paint
  // identically. Does not touch the AI Instructions editor.
  function buildCallsTable(container, calls) {
    container.innerHTML = "";
    const columns = callColumnDefs();
    const handle = App.table.mount({
      container, columns, rows: calls, onRowClick: (r) => openCall(r.id),
      defaultSort: "createdAt", defaultSortDir: "desc", highlightId: App._highlightCallId,
      emptyHtml: emptyCalls().outerHTML, pageSize: 6,
    });
    // Always-visible "Simulate call" in the toolbar (next to Search), so it works
    // whether or not any calls exist yet. Same simulate() action as before.
    if (handle && handle.toolbarRight) {
      const sim = el("button", "btn btn-primary btn-sm", `<span class="btn-icon">&#9654;</span> Simulate call`);
      sim.id = "simulate-btn";
      sim.onclick = simulate;
      handle.toolbarRight.insertBefore(sim, handle.toolbarRight.firstChild);
      // Export calls — same shared exporter/history as Contacts (saves to history).
      const exportBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8679;</span> Export`);
      exportBtn.onclick = () => openExport(callExportOpts(handle ? handle.getColumns() : columns, calls));
      handle.toolbarRight.insertBefore(exportBtn, sim);
    }
    App._highlightCallId = null;
    return handle;
  }

  // Live refresh: re-fetch calls; if the data changed and the user isn't mid-
  // interaction, repaint ONLY the table — preserving the AI Instructions editor
  // node (and its unsaved text) and the table's sort/search/filter state.
  async function refreshCallsTable(container, getHandle, setHandle) {
    let calls;
    try { calls = await App.portalApi("/api/calls"); } catch { return; }
    const sig = callsSignature(calls);
    if (sig === callsSig) return;       // nothing changed -> no repaint
    if (callsRefreshBlocked()) return;  // don't disrupt the user; catch it next tick
    callsSig = sig;

    // Detach the AI Instructions card so it survives the table remount untouched.
    const aiCard = container.querySelector(".ai-instructions-card");
    if (aiCard && aiCard.parentNode) aiCard.parentNode.removeChild(aiCard);

    // Preserve sort/search/filters across the remount.
    const prevHandle = getHandle && getHandle();
    const prevState = prevHandle && prevHandle.getState ? prevHandle.getState() : null;

    const handle = buildCallsTable(container, calls);
    if (prevState && handle && handle.applyState) handle.applyState(prevState);
    if (setHandle) setHandle(handle);

    // Re-attach the AI editor into the fresh table area (same node => edits kept).
    if (aiCard) {
      const area = container.querySelector(".table-area") || container;
      area.appendChild(aiCard);
    }
  }

  // Per-portal AI Instructions box. Visibility/permission is decided by the server
  // (GET returns `editable`); we only render the box when editing is allowed.
  async function mountAiInstructions(host) {
    let data;
    try { data = await App.portalApi("/api/account/ai-instructions"); }
    catch { return; }
    if (!data || !data.editable) return;

    const sec = el("div", "card ai-instructions-card");
    sec.style.cssText = "margin-top:18px;padding:18px;";
    // Header row splits into two halves: caption on the LEFT, the Receptionist
    // voice picker top-right. The textarea below stays FULL WIDTH (unchanged).
    const head = el("div");
    head.style.cssText = "display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;margin:0 0 12px;";

    const headLeft = el("div");
    headLeft.style.cssText = "flex:1 1 340px;min-width:260px;";
    headLeft.innerHTML =
      `<h3 style="margin:0 0 6px;">AI Instructions</h3>` +
      `<p class="cell-muted" style="margin:0;">Tell your AI receptionist about your business — services, hours, pricing, anything callers might ask. This is added on top of its built-in ability to stay helpful and capture caller details automatically.</p>`;

    // The 5 allowed voices (kept in sync with src/config/voices.ts); the server
    // also sends this list, but we keep a fallback so the picker always renders.
    const VOICE_FALLBACK = [
      { id: "uIZsnBL0YK1S5j69bAih", label: "Warm & Friendly" },
      { id: "Gfpl8Yo74Is0W6cPUWWT", label: "Clear & Professional" },
      { id: "cCYjmrGZaI86GUJ7F2Nn", label: "Deep & Warm" },
      { id: "WtA85syCrJwasGeHGH2p", label: "Energetic & Upbeat" },
      { id: "Yg7C1g7suzNt5TisIqkZ", label: "British Conversational" },
    ];
    const voiceOptions = (data.voiceOptions && data.voiceOptions.length) ? data.voiceOptions : VOICE_FALLBACK;

    const headRight = el("div");
    headRight.style.cssText = "flex:0 1 260px;min-width:210px;display:flex;flex-direction:column;gap:5px;";
    const voiceLabel = el("label", "cell-muted");
    voiceLabel.style.cssText = "font-size:13px;font-weight:600;";
    voiceLabel.textContent = "Receptionist voice";
    const voiceSel = el("select", "input");
    voiceSel.style.cssText = "width:100%;";
    voiceOptions.forEach((o) => {
      const opt = el("option");
      opt.value = o.id;
      opt.textContent = o.label;
      if (o.id === (data.voiceId || "")) opt.selected = true;
      voiceSel.appendChild(opt);
    });
    const voiceNote = el("p", "cell-muted");
    voiceNote.style.cssText = "margin:0;font-size:12px;";
    voiceNote.textContent = "Applies on Premium voice.";
    if ((data.voiceMode || "OFF") === "SMOOTH") voiceNote.style.display = "none";
    const voiceStatus = el("span", "cell-muted");
    voiceStatus.style.cssText = "font-size:12px;min-height:14px;";

    voiceSel.onchange = async () => {
      voiceSel.disabled = true;
      voiceStatus.textContent = "Saving…";
      try {
        await App.portalApi("/api/account/voice", { method: "PATCH", body: JSON.stringify({ voiceId: voiceSel.value }) });
        voiceStatus.textContent = "Saved.";
        App.util.toast("Receptionist voice saved");
        setTimeout(() => { if (voiceStatus.textContent === "Saved.") voiceStatus.textContent = ""; }, 2500);
      } catch (e) {
        voiceStatus.textContent = "";
        App.util.toast((e && e.message) || "Save failed", true);
      } finally {
        voiceSel.disabled = false;
      }
    };

    headRight.appendChild(voiceLabel);
    headRight.appendChild(voiceSel);
    headRight.appendChild(voiceNote);
    headRight.appendChild(voiceStatus);

    head.appendChild(headLeft);
    head.appendChild(headRight);
    sec.appendChild(head);

    const ta = el("textarea", "input");
    ta.rows = 8;
    ta.style.cssText = "width:100%;resize:vertical;min-height:160px;";
    ta.value = data.aiInstructions || "";
    ta.placeholder = "e.g. We're a plumbing company open Mon–Sat, 8am–6pm. We service Rheem and Bradford White water heaters. For emergencies, let the caller know we offer same-day visits and ask for the best callback number.";
    sec.appendChild(ta);

    const bar = el("div");
    bar.style.cssText = "margin-top:10px;display:flex;gap:10px;align-items:center;";
    const save = el("button", "btn btn-primary", "Save");
    const status = el("span", "cell-muted");
    status.style.fontSize = "13px";
    save.onclick = async () => {
      save.disabled = true;
      status.textContent = "Saving…";
      try {
        await App.portalApi("/api/account/ai-instructions", { method: "PATCH", body: JSON.stringify({ aiInstructions: ta.value }) });
        status.textContent = "Saved.";
        App.util.toast("AI Instructions saved");
        setTimeout(() => { if (status.textContent === "Saved.") status.textContent = ""; }, 2500);
      } catch (e) {
        status.textContent = "";
        App.util.toast((e && e.message) || "Save failed", true);
      } finally {
        save.disabled = false;
      }
    };
    bar.appendChild(save);
    bar.appendChild(status);
    sec.appendChild(bar);

    host.appendChild(sec);
  }

  // ---------------- Google Calendar card (relocated to Integrations) ----------------
  // Moved INTACT from the Calls AI-instructions card. Same /api/google/* wiring,
  // OAuth state, sync toggle, and per-resource mapping — only its home changed.
  function mountGoogleCard(host) {
    // ---- Google Calendar connection (read-only; minimal connect/disconnect) ----
    // Connect/Disconnect/status + per-resource calendar mapping. NO freebusy/
    // availability wiring yet. Tokens never reach the browser.
    const gWrap = el("div");
    gWrap.style.cssText = "";
    gWrap.innerHTML =
      `<p class="cell-muted" style="margin:0 0 10px;">Connect your Google Calendar so Clarity can read busy times (read-only), then map each calendar to a staff member.</p>`;
    const gStatusLine = el("p", "cell-muted");
    gStatusLine.style.cssText = "margin:0 0 10px;font-size:13px;";
    gStatusLine.textContent = "Checking…";
    const gHealth = el("div"); // sync-health + write-scope state (populated when connected)
    gHealth.style.cssText = "margin:0 0 10px;font-size:12px;";
    const gBar = el("div");
    gBar.style.cssText = "display:flex;gap:10px;align-items:center;";
    const gMap = el("div"); // per-resource calendar mapping (populated when connected)
    gMap.style.cssText = "margin-top:14px;";
    gWrap.appendChild(gStatusLine);
    gWrap.appendChild(gHealth);
    gWrap.appendChild(gBar);
    gWrap.appendChild(gMap);
    host.appendChild(gWrap);

    // Build the Connect URL the same way portalApi scopes the tenant (super-admin
    // appends ?tenantId of the entered portal). It's a TOP-LEVEL navigation, not fetch.
    function googleConnectUrl() {
      let url = "/api/google/connect";
      if (App.state.me && App.isAdminTier(App.state.me.role) && App.state.currentPortalId) {
        url += "?tenantId=" + encodeURIComponent(App.state.currentPortalId);
      }
      return url;
    }

    async function renderGoogle() {
      let data;
      try { data = await App.portalApi("/api/google/status"); }
      catch { gStatusLine.textContent = "Couldn't load Google status."; gBar.innerHTML = ""; gMap.innerHTML = ""; return; }
      gBar.innerHTML = "";
      gHealth.innerHTML = "";
      gMap.innerHTML = "";
      if (!data.configured) {
        gStatusLine.textContent = "Google Calendar isn't set up on this server yet.";
        return;
      }
      if (data.connected) {
        gStatusLine.innerHTML = `Connected${data.accountEmail ? " as <strong>" + App.util.esc(data.accountEmail) + "</strong>" : ""}.`;

        // ---- Sync health: last synced + status, so drift is never silent. ----
        const rows = [];
        if (data.syncStatus === "degraded") {
          rows.push(`<span style="color:var(--danger,#b91c1c);font-weight:600;">⚠ Sync degraded</span>` +
            (data.lastSyncError ? ` — ${App.util.esc(data.lastSyncError)}` : ""));
        } else if (data.syncStatus === "ok") {
          rows.push(`<span style="color:var(--ok,#15803d);font-weight:600;">● Sync OK</span>`);
        }
        if (data.lastSyncedAt) {
          rows.push(`Last synced: ${new Date(data.lastSyncedAt).toLocaleString()}`);
        } else if (data.syncEnabled) {
          rows.push("Not synced yet.");
        }
        if (!data.syncEnabled) rows.push(`<span class="cell-muted">Sync is currently turned off.</span>`);

        // ---- Write-scope: prompt a one-time reconnect to enable write-back (F). ----
        if (data.writeGranted) {
          rows.push(`<span style="color:var(--ok,#15803d);">Write-back ready.</span>`);
        } else {
          rows.push(`<span class="cell-muted">Write-back is not enabled yet (reading still works).</span>`);
        }
        gHealth.innerHTML = rows.map((r) => `<div style="margin:2px 0;">${r}</div>`).join("");

        // ---- Visible on/off control for two-way sync (replaces hidden DB flags). ----
        const toggleWrap = el("label");
        toggleWrap.style.cssText = "display:flex;gap:8px;align-items:center;margin:8px 0 4px;font-size:13px;cursor:pointer;";
        const toggle = el("input"); toggle.type = "checkbox"; toggle.checked = !!(data.syncEnabled || data.pushEnabled);
        const toggleTxt = el("span", null, "Two-way calendar sync");
        toggleWrap.appendChild(toggle); toggleWrap.appendChild(toggleTxt);
        const toggleStat = el("span", "cell-muted"); toggleStat.style.cssText = "font-size:12px;margin-left:6px;";
        toggleWrap.appendChild(toggleStat);
        toggle.onchange = async () => {
          const on = toggle.checked;
          toggle.disabled = true; toggleStat.textContent = "Saving…";
          try {
            // Read-in turns on regardless; push only when write-back is granted.
            await App.portalApi("/api/google/sync/settings", { method: "POST", body: JSON.stringify({ syncEnabled: on, pushEnabled: on && !!data.writeGranted }) });
            App.util.toast(on ? (data.writeGranted ? "Two-way sync on" : "Sync on (reconnect to enable write-back)") : "Sync off");
            renderGoogle();
          } catch (e) {
            toggleStat.textContent = ""; toggle.checked = !on; App.util.toast((e && e.message) || "Couldn't update", true);
          } finally { toggle.disabled = false; }
        };
        gHealth.appendChild(toggleWrap);

        if (!data.writeGranted) {
          const recon = el("button", "btn btn-primary btn-sm", "Reconnect to enable write-back");
          recon.onclick = () => { window.location.href = googleConnectUrl(); };
          gBar.appendChild(recon);
        }

        const dis = el("button", "btn btn-ghost btn-sm", "Disconnect");
        dis.onclick = async () => {
          if (App.ui && App.ui.confirmModal && !(await App.ui.confirmModal({ title: "Disconnect Google Calendar", message: "Disconnect this Google account? Clarity will stop reading its calendars.", confirmText: "Disconnect" }))) return;
          dis.disabled = true;
          try { await App.portalApi("/api/google/disconnect", { method: "POST" }); App.util.toast("Google Calendar disconnected"); renderGoogle(); }
          catch (e) { App.util.toast((e && e.message) || "Disconnect failed", true); dis.disabled = false; }
        };
        gBar.appendChild(dis);
        renderMappings(data.mappings || []);
      } else {
        gStatusLine.textContent = "Not connected.";
        const conn = el("button", "btn btn-primary btn-sm", "Connect Google Calendar");
        conn.onclick = () => { window.location.href = googleConnectUrl(); };
        gBar.appendChild(conn);
      }
    }

    // Per-resource calendar mapping. Reuses the same <select> + save-on-change +
    // toast pattern as the voice/timezone pickers. Distinguishes "couldn't reach
    // Google" (reconnect prompt) from "connected, zero calendars" (clear note).
    async function renderMappings(mappings) {
      gMap.innerHTML = `<div class="cell-muted" style="font-size:13px;">Loading calendars…</div>`;
      let calendars, resources;
      try {
        [calendars, resources] = await Promise.all([
          App.portalApi("/api/google/calendars"),
          App.portalApi("/api/resources"),
        ]);
      } catch (e) {
        // The calendars call fails closed with needsReconnect; show that, not an empty list.
        const needsReconnect = e && e.data && e.data.needsReconnect;
        gMap.innerHTML = "";
        const warn = el("p", "cell-muted");
        warn.style.cssText = "font-size:13px;color:var(--danger,#b91c1c);";
        warn.textContent = needsReconnect
          ? "Google connection needs reconnecting — click Disconnect, then Connect again."
          : ((e && e.message) || "Couldn't load calendars.");
        gMap.appendChild(warn);
        return;
      }
      const cals = (calendars && calendars.calendars) || [];
      const byResource = {};
      (mappings || []).forEach((m) => { byResource[m.resourceId] = m; });

      gMap.innerHTML = "";
      const title = el("div", "form-label", "Map calendars to staff");
      gMap.appendChild(title);

      if (!resources.length) {
        const none = el("p", "cell-muted"); none.style.cssText = "font-size:13px;";
        none.textContent = "Add staff/resources first, then map a calendar to each.";
        gMap.appendChild(none);
        return;
      }
      if (!cals.length) {
        const none = el("p", "cell-muted"); none.style.cssText = "font-size:13px;";
        none.textContent = "Connected, but this Google account has no calendars to map.";
        gMap.appendChild(none);
        return;
      }

      resources.forEach((r) => {
        const row = el("div");
        row.style.cssText = "display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap;";
        const name = el("div"); name.style.cssText = "min-width:140px;font-size:13px;font-weight:600;";
        name.textContent = r.name;
        const sel = el("select", "input"); sel.style.cssText = "min-width:240px;";
        const cur = byResource[r.id];
        // "Not mapped" option
        const optNone = el("option"); optNone.value = ""; optNone.textContent = "— Not mapped —"; sel.appendChild(optNone);
        // If the current mapping's calendar is gone from the account, keep it visible.
        if (cur && !cals.some((c) => c.id === cur.googleCalendarId)) {
          const opt = el("option"); opt.value = cur.googleCalendarId;
          opt.textContent = (cur.calendarSummary || cur.googleCalendarId) + " (unavailable)";
          opt.selected = true; sel.appendChild(opt);
        }
        cals.forEach((c) => {
          const opt = el("option"); opt.value = c.id;
          opt.textContent = c.summary + (c.primary ? " (primary)" : "");
          if (cur && cur.googleCalendarId === c.id) opt.selected = true;
          sel.appendChild(opt);
        });
        const stat = el("span", "cell-muted"); stat.style.cssText = "font-size:12px;min-height:14px;";
        sel.onchange = async () => {
          sel.disabled = true; stat.textContent = "Saving…";
          try {
            if (!sel.value) {
              await App.portalApi("/api/google/calendars/map", { method: "DELETE", body: JSON.stringify({ resourceId: r.id }) });
              App.util.toast(r.name + " unmapped");
            } else {
              const chosen = cals.find((c) => c.id === sel.value);
              await App.portalApi("/api/google/calendars/map", { method: "PUT", body: JSON.stringify({ resourceId: r.id, googleCalendarId: sel.value, calendarSummary: chosen ? chosen.summary : null }) });
              App.util.toast(r.name + " mapped to " + (chosen ? chosen.summary : "calendar"));
            }
            stat.textContent = "Saved.";
            setTimeout(() => { if (stat.textContent === "Saved.") stat.textContent = ""; }, 2000);
          } catch (e) {
            stat.textContent = "";
            App.util.toast((e && e.message) || "Save failed", true);
          } finally { sel.disabled = false; }
        };
        row.appendChild(name); row.appendChild(sel); row.appendChild(stat);
        gMap.appendChild(row);
      });
    }

    // One-time toast from the OAuth round-trip's ?google=<flag>, then clear it.
    (function consumeGoogleFlag() {
      const m = /[?&]google=([^&#]+)/.exec(window.location.search || "");
      if (!m) return;
      const flag = decodeURIComponent(m[1]);
      const msg = {
        connected: ["Google Calendar connected", false],
        denied: ["Google sign-in was cancelled", true],
        state: ["Sign-in expired or didn't match — please try again", true],
        auth: ["Please sign in again, then reconnect", true],
        unconfigured: ["Google Calendar isn't set up on this server yet", true],
        error: ["Couldn't connect Google Calendar — please try again", true],
      }[flag];
      if (msg) App.util.toast(msg[0], msg[1]);
      try { const u = new URL(window.location.href); u.searchParams.delete("google"); history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) {}
    })();

    renderGoogle();
  }

  // ---------------- Integrations ----------------
  // Three integration cards (Twilio, OpenAI, Google Calendar), each with its
  // brand logo. SEE is open to every portal role (values always shown). EDIT for
  // Twilio + OpenAI is admin-tier only (OWNER/SUPER_ADMIN/AUDITOR) — others get a
  // grayed/disabled control; the SERVER also enforces this (the disabled UI is
  // not the boundary). Google is editable by all roles.
  async function renderIntegrations(host) {
    let s;
    try { s = await App.portalApi("/api/settings"); }
    catch { host.innerHTML = `<div class="cell-muted" style="padding:8px;">Couldn't load integrations.</div>`; return; }

    const me = App.state.me || {};
    const canEditTO = App.isAdminTier(me.role); // Twilio + OpenAI edit gate

    host.innerHTML = "";
    const wrap = el("div");
    wrap.innerHTML = `<h2 class="settings-h">Integrations</h2>`;
    const intro = el("p", "cell-muted", "Connect and manage the services that power your receptionist.");
    intro.style.cssText = "margin:0 0 16px;";
    wrap.appendChild(intro);

    // Responsive tile grid: tiles never shrink below 320px — they wrap to fewer
    // columns instead (auto-fill + minmax), so controls never get compressed.
    // Equal-height rows via align-items:stretch; 16px gutters.
    const grid = el("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;align-items:stretch;";
    wrap.appendChild(grid);

    // Shared tile: brand logo + title header; returns the body element to fill.
    // Controls inside render at full, normal size — the grid wraps, never narrows them.
    function card(logo, title) {
      const c = el("div", "card");
      c.style.cssText = "padding:18px;margin:0;display:flex;flex-direction:column;min-width:0;";
      const head = el("div");
      head.style.cssText = "display:flex;align-items:center;gap:10px;margin:0 0 12px;";
      const img = el("img"); img.src = logo; img.alt = title + " logo";
      img.style.cssText = "width:26px;height:26px;object-fit:contain;flex:0 0 auto;";
      const h = el("h3", null, esc(title)); h.style.cssText = "margin:0;";
      head.appendChild(img); head.appendChild(h);
      c.appendChild(head);
      const body = el("div"); body.style.cssText = "flex:1 1 auto;"; c.appendChild(body);
      grid.appendChild(c);
      return body;
    }

    // ---- Twilio: connected phone number ----
    (function twilio() {
      const body = card("/img/twilio.png", "Twilio");
      const label = el("label", "cell-muted", "Connected phone number");
      label.style.cssText = "font-size:13px;font-weight:600;display:block;margin:0 0 6px;";
      body.appendChild(label);
      const inp = el("input", "input"); inp.value = s.phoneNumber || ""; inp.placeholder = "+1 555 555 5555";
      inp.style.cssText = "width:100%;"; // full tile inner width — never narrowed to fit
      body.appendChild(inp);
      if (!canEditTO) {
        inp.disabled = true;
        const note = el("p", "cell-muted", "View only — ask an owner or super admin to change this.");
        note.style.cssText = "font-size:12px;margin:8px 0 0;";
        body.appendChild(note);
        return;
      }
      const barB = el("div"); barB.style.cssText = "margin-top:10px;display:flex;gap:10px;align-items:center;";
      const save = el("button", "btn btn-primary btn-sm", "Save");
      const stat = el("span", "cell-muted"); stat.style.cssText = "font-size:12px;";
      save.onclick = async () => {
        save.disabled = true; stat.textContent = "Saving…";
        try {
          await App.portalApi("/api/integrations/twilio", { method: "PATCH", body: JSON.stringify({ phoneNumber: inp.value }) });
          stat.textContent = "Saved."; App.util.toast("Twilio number saved");
          setTimeout(() => { if (stat.textContent === "Saved.") stat.textContent = ""; }, 2500);
        } catch (e) { stat.textContent = ""; App.util.toast((e && e.message) || "Save failed", true); }
        finally { save.disabled = false; }
      };
      barB.appendChild(save); barB.appendChild(stat); body.appendChild(barB);
    })();

    // ---- OpenAI: AI receptionist on/off ----
    (function openai() {
      const body = card("/img/openai.webp", "OpenAI");
      const desc = el("p", "cell-muted", "Powers the AI receptionist that answers and handles your calls.");
      desc.style.cssText = "font-size:13px;margin:0 0 10px;";
      body.appendChild(desc);
      const tWrap = el("label");
      tWrap.style.cssText = "display:flex;gap:8px;align-items:center;font-size:14px;" + (canEditTO ? "cursor:pointer;" : "");
      const tog = el("input"); tog.type = "checkbox"; tog.checked = (s.receptionistEnabled === true);
      const txt = el("span", null, "AI receptionist enabled");
      const stat = el("span", "cell-muted"); stat.style.cssText = "font-size:12px;margin-left:6px;";
      tWrap.appendChild(tog); tWrap.appendChild(txt); tWrap.appendChild(stat);
      body.appendChild(tWrap);
      if (!canEditTO) {
        tog.disabled = true;
        const note = el("p", "cell-muted", "View only — ask an owner or super admin to change this.");
        note.style.cssText = "font-size:12px;margin:8px 0 0;";
        body.appendChild(note);
        return;
      }
      tog.onchange = async () => {
        const on = tog.checked; tog.disabled = true; stat.textContent = "Saving…";
        try {
          await App.portalApi("/api/integrations/openai", { method: "PATCH", body: JSON.stringify({ enabled: on }) });
          stat.textContent = ""; App.util.toast(on ? "AI receptionist on" : "AI receptionist off");
        } catch (e) { stat.textContent = ""; tog.checked = !on; App.util.toast((e && e.message) || "Couldn't update", true); }
        finally { tog.disabled = false; }
      };
    })();

    // ---- Google Calendar: the relocated card (editable by all roles) ----
    (function google() {
      const body = card("/img/google-calendar.webp", "Google Calendar");
      mountGoogleCard(body);
    })();

    host.appendChild(wrap);
  }


  // ---------------- Data Administration (Settings section) ----------------
  // A centralized home for the EXISTING importers/exporters plus the combined
  // import+export history (the data Batch A produced). Reuses every existing modal
  // and column builder — no new import/export logic. Sub-tabs use the same .tabs
  // strip the record detail view uses.
  async function renderDataAdmin(panel) {
    panel.innerHTML = "";
    const wrap = el("div", "fade-in");
    wrap.appendChild(el("h2", "settings-h", "Data Administration"));
    const tabsBar = el("div", "tabs");
    const tabBody = el("div", "tab-body");
    const SUBS = [["import", "Import"], ["export", "Export"], ["backup", "Data Backup"], ["history", "Import / Export History"], ["reports", "Reports"]];
    let active = "import";
    function setTab(key) {
      active = key;
      App.util.$$(".tab", tabsBar).forEach((t) => t.classList.toggle("active", t.dataset.tab === key));
      tabBody.innerHTML = "";
      if (key === "import") tabImport(tabBody);
      else if (key === "export") tabExport(tabBody);
      else if (key === "backup") tabBackup(tabBody);
      else if (key === "reports") tabReports(tabBody);
      else tabHistory(tabBody);
    }
    SUBS.forEach(([key, label]) => {
      const t = el("button", "tab" + (key === active ? " active" : ""), esc(label));
      t.dataset.tab = key;
      t.onclick = () => setTab(key);
      tabsBar.appendChild(t);
    });
    wrap.appendChild(tabsBar);
    wrap.appendChild(tabBody);
    panel.appendChild(wrap);
    setTab("import");
  }

  // Importable types are Contacts + the record types (Jobs, Bookings, custom). The
  // system "contact" record type is excluded here so Contacts isn't listed twice.
  // Events and Feedback are export-only (no import path exists), so they're not here.
  async function tabImport(host) {
    host.innerHTML = "";
    let types = [];
    try { types = await App.portalApi("/api/record-types"); } catch (e) { /* empty */ }
    const grid = el("div");
    grid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:4px;";
    const cBtn = el("button", "btn btn-ghost", `<span class="btn-icon">&#8681;</span> ${esc(App.label("contact", "many"))}`);
    cBtn.onclick = () => openImport();
    grid.appendChild(cBtn);
    (types || []).filter((t) => t.key !== "contact").forEach((t) => {
      const b = el("button", "btn btn-ghost", `<span class="btn-icon">&#8681;</span> ${esc(t.labelPlural || t.label)}`);
      b.onclick = async () => {
        let fields = [];
        try { fields = await App.portalApi("/api/fields?recordType=" + encodeURIComponent(t.key)); } catch (e) { /* empty */ }
        openRecordImport(t.key, fields, t);
      };
      grid.appendChild(b);
    });
    host.appendChild(grid);
  }

  // Export sub-tab: a type dropdown that renders the SAME export form inline (no
  // popup) via openExport({ inline:true }). Includes Contacts, every record type,
  // Events, and Feedback (Feedback only for owner/super-admin/auditor).
  function dataEventExportOpts(events) {
    return {
      columns: [
        { key: "type", label: "Event", type: "text", get: (r) => r.type },
        { key: "actor", label: "By", type: "text", get: (r) => r.actorName || r.actorType || "" },
        { key: "occurredAt", label: "When", type: "date", get: (r) => r.occurredAt, text: (r) => fmtDate(r.occurredAt) },
      ],
      rows: events,
      title: "Export events", namePlaceholder: "e.g. June automation events",
      filterLabel: "Which events to export", unitPlural: "events", sheetName: "Events",
      dataType: "event", countText: (n) => n + " event" + (n === 1 ? "" : "s"), saveHistory: true,
    };
  }
  function dataFeedbackExportOpts(rows) {
    return {
      columns: App.feedback.ticketExportColumns({ portal: false, rows }),
      rows,
      title: "Export feedback", namePlaceholder: "e.g. Resolved tickets — June",
      filterLabel: "Which tickets to include", unitPlural: "rows", sheetName: "Tickets",
      dataType: "feedback", savedFilters: false, countText: (n) => n + (n === 1 ? " row" : " rows"), saveHistory: true,
    };
  }
  async function tabExport(host) {
    host.innerHTML = "";
    let types = [];
    try { types = await App.portalApi("/api/record-types"); } catch (e) { /* empty */ }
    const isAdmin = !!(App.state.me && App.isAdminTier(App.state.me.role));
    const options = [{ value: "contact", label: App.label("contact", "many") }];
    (types || []).filter((t) => t.key !== "contact").forEach((t) => options.push({ value: "rt:" + t.key, label: t.labelPlural || t.label }));
    options.push({ value: "call", label: "Calls" });
    options.push({ value: "event", label: "Events" });
    if (isAdmin) options.push({ value: "feedback", label: "Feedback" });

    // Button row mirroring the Import tab (same flex-wrap btn-ghost row with the ⇩
    // icon); each button renders that type's export form INLINE below via the SAME
    // buildOpts(value) + openExport({ inline:true }) the dropdown used.
    const grid = el("div");
    grid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:4px;margin-bottom:8px;";
    const formHost = el("div");

    let activeBtn = null;
    async function select(value, btn) {
      if (activeBtn) activeBtn.classList.remove("active");
      activeBtn = btn || null;
      if (btn) btn.classList.add("active");
      formHost.innerHTML = `<div class="cell-muted" style="padding:8px">Loading…</div>`;
      let opts;
      try { opts = await buildOpts(value); } catch (err) { formHost.innerHTML = `<div class="cell-muted" style="padding:8px">${esc(err.message)}</div>`; return; }
      if (!opts) { formHost.innerHTML = ""; return; }
      openExport(Object.assign({}, opts, { inline: true, container: formHost }));
    }

    options.forEach((o) => {
      const b = el("button", "btn btn-ghost", `<span class="btn-icon">&#8681;</span> ${esc(o.label)}`);
      b.onclick = () => select(o.value, b);
      grid.appendChild(b);
    });
    host.appendChild(grid);
    host.appendChild(formHost);

    async function buildOpts(value) {
      if (value === "contact") {
        const [fields, contacts] = await Promise.all([App.portalApi("/api/fields").catch(() => []), App.portalApi("/api/contacts").catch(() => [])]);
        return contactExportOpts(contactColumnDefs(fields), contacts);
      }
      if (value === "event") {
        const events = await App.portalApi("/api/automations/events").catch(() => []);
        return dataEventExportOpts(Array.isArray(events) ? events : []);
      }
      if (value === "call") {
        const calls = await App.portalApi("/api/calls").catch(() => []);
        return callExportOpts(callColumnDefs(), Array.isArray(calls) ? calls : []);
      }
      if (value === "feedback") {
        const rows = await App.portalApi("/api/feedback/export-rows").catch(() => []);
        return dataFeedbackExportOpts(Array.isArray(rows) ? rows : []);
      }
      if (value.indexOf("rt:") === 0) {
        const key = value.slice(3);
        const t = (types || []).find((x) => x.key === key) || { key, label: key, labelPlural: key };
        const [records, fields, resources] = await Promise.all([
          App.portalApi("/api/records?type=" + encodeURIComponent(key)).catch(() => []),
          App.portalApi("/api/fields?recordType=" + encodeURIComponent(key)).catch(() => []),
          key === "booking" ? App.portalApi("/api/resources").catch(() => []) : Promise.resolve([]),
        ]);
        const resById = {}; (resources || []).forEach((r) => { resById[r.id] = r; });
        return recordExportOpts(recordColumnDefs(fields, t, resById), records, t.labelPlural || t.label, key);
      }
      return null;
    }
  }

  // ---- Data Backup sub-tab: one-click blanket export of ALL portal data, as an
  // Excel workbook (one sheet per type) or a ZIP of CSVs (one per type). Reuses the
  // existing per-type read paths + column builders (so bookings keep wall-clock times
  // via recordColumnDefs/fmtAppt). Download-only: the file is assembled in the browser
  // and never stored; we only log that a backup happened (history row, no download).
  function backupStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // filename label only
  }
  // Only Name / Email / Role for the team sheet — never anything credential-bearing.
  function backupUserColumns() {
    return [
      { key: "name", label: "Name", type: "text", get: (r) => r.name || "", text: (r) => r.name || "" },
      { key: "email", label: "Email", type: "text", get: (r) => r.email || "", text: (r) => r.email || "" },
      { key: "role", label: "Role", type: "text", get: (r) => r.role || "", text: (r) => r.role || "" },
    ];
  }
  // Generic columns from the union of row keys (for Calls/Resources/Automations —
  // safe shapes with no credentials). Noise keys are dropped; objects are JSON'd.
  function backupGenericColumns(rows, dropKeys) {
    const drop = new Set(dropKeys || ["tenantId", "createdById"]);
    const keys = [];
    (rows || []).forEach((r) => { if (r && typeof r === "object") Object.keys(r).forEach((k) => { if (!drop.has(k) && keys.indexOf(k) === -1) keys.push(k); }); });
    return keys.map((k) => ({
      key: k, label: k, type: "text",
      get: (r) => r[k],
      text: (r) => { const v = r[k]; if (v == null) return ""; return typeof v === "object" ? JSON.stringify(v) : String(v); },
    }));
  }
  async function gatherBackupSections(opts) {
    const sections = [];
    const [cFields, contacts] = await Promise.all([App.portalApi("/api/fields").catch(() => []), App.portalApi("/api/contacts").catch(() => [])]);
    sections.push({ label: App.label("contact", "many"), columns: contactColumnDefs(cFields), rows: contacts || [] });

    const types = await App.portalApi("/api/record-types").catch(() => []);
    for (const t of (types || []).filter((x) => x.key !== "contact")) {
      const [records, fields, resources] = await Promise.all([
        App.portalApi("/api/records?type=" + encodeURIComponent(t.key)).catch(() => []),
        App.portalApi("/api/fields?recordType=" + encodeURIComponent(t.key)).catch(() => []),
        t.key === "booking" ? App.portalApi("/api/resources").catch(() => []) : Promise.resolve([]),
      ]);
      const resById = {}; (resources || []).forEach((r) => { resById[r.id] = r; });
      sections.push({ label: t.labelPlural || t.label, columns: recordColumnDefs(fields, t, resById), rows: records || [] });
    }

    const calls = await App.portalApi("/api/calls").catch(() => []);
    sections.push({ label: "Calls", columns: callColumnDefs(), rows: calls || [] });

    const events = await App.portalApi("/api/automations/events").catch(() => []);
    sections.push({ label: "Events", columns: dataEventExportOpts([]).columns, rows: events || [] });

    if (opts.isAdmin) {
      const fb = await App.portalApi("/api/feedback/export-rows").catch(() => []);
      sections.push({ label: "Feedback", columns: App.feedback.ticketExportColumns({ portal: false, rows: fb || [] }), rows: fb || [] });
    }

    const resources = await App.portalApi("/api/resources").catch(() => []);
    sections.push({ label: App.label("resource", "many"), columns: backupGenericColumns(resources, ["tenantId"]), rows: resources || [] });

    if (opts.includeAuto) {
      const autos = await App.portalApi("/api/automations").catch(() => []);
      sections.push({ label: "Automations", columns: backupGenericColumns(autos, ["tenantId"]), rows: autos || [] });
    }
    if (opts.includeTeam) {
      const users = await App.portalApi("/api/users").catch(() => []);
      sections.push({ label: "Team", columns: backupUserColumns(), rows: users || [] });
    }
    return sections;
  }
  function backupAOA(section) {
    const cols = section.columns.filter((c) => c.key);
    const header = cols.map((c) => c.label);
    const body = (section.rows || []).map((row) => cols.map((c) => { const v = c.text ? c.text(row) : c.get(row); return v == null ? "" : v; }));
    return [header, ...body];
  }
  function backupSheetName(label, used) {
    let n = String(label).replace(/[\\/?*\[\]:]/g, "").slice(0, 28) || "Sheet";
    const base = n; let i = 2;
    while (used.has(n)) { n = base.slice(0, 26) + " " + i; i++; }
    used.add(n);
    return n;
  }
  function buildBackupXlsx(sections, stamp) {
    if (typeof XLSX === "undefined") throw new Error("Excel needs internet — the spreadsheet library didn't load.");
    const wb = XLSX.utils.book_new();
    const used = new Set();
    sections.forEach((s) => { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(backupAOA(s)), backupSheetName(s.label, used)); });
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    downloadBlob(`portal-backup-${stamp}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }
  async function buildBackupZip(sections, stamp) {
    if (typeof JSZip === "undefined") throw new Error("CSV backup needs internet — the zip library didn't load.");
    const zip = new JSZip();
    const used = new Set();
    sections.forEach((s) => {
      const cols = s.columns.filter((c) => c.key);
      let fname = String(s.label).replace(/[\\/:*?"<>|]/g, "-").slice(0, 40) || "data";
      const base = fname; let i = 2;
      while (used.has(fname)) { fname = base + "-" + i; i++; }
      used.add(fname);
      zip.file(fname + ".csv", buildCSV(cols, s.rows || []));
    });
    downloadBlob(`portal-backup-${stamp}.zip`, await zip.generateAsync({ type: "blob" }));
  }
  async function tabBackup(host) {
    host.innerHTML = "";
    const isAdmin = !!(App.state.me && App.isAdminTier(App.state.me.role));
    const wrap = el("div");
    wrap.innerHTML = `
      <p class="cell-muted" style="margin-top:4px">Download a complete backup of this portal's data — one tab (Excel) or file (CSV zip) per data type: ${esc(App.label("contact", "many"))}, every record type, Calls, Events, Resources${isAdmin ? ", Feedback" : ""}, and optionally automations and team. Sign-in credentials and connected-account tokens are never included.</p>
      <div style="max-width:640px">
        <div style="display:flex;gap:36px;flex-wrap:wrap;align-items:flex-start;margin-top:14px">
          <div style="display:flex;flex-direction:column;gap:8px">
            <label class="ex-field"><input type="checkbox" id="bk-auto" checked /> <span>Include automation definitions</span></label>
            <label class="ex-field"><input type="checkbox" id="bk-team" checked /> <span>Include team (names, emails, roles)</span></label>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;min-width:300px">
            <label class="field-label" style="margin:0">Format</label>
            <select id="bk-format" class="input" style="max-width:340px">
              <option value="xlsx">Excel workbook (.xlsx) — one sheet per type</option>
              <option value="zip">CSV files (.zip) — one .csv per type</option>
            </select>
          </div>
        </div>
        <button id="bk-go" class="btn btn-primary" style="margin-top:18px">Download backup</button>
        <div id="bk-status" class="cell-muted" style="margin-top:10px"></div>
      </div>`;
    host.appendChild(wrap);
    const statusEl = wrap.querySelector("#bk-status");
    const btn = wrap.querySelector("#bk-go");
    btn.onclick = async () => {
      const fmt = wrap.querySelector("#bk-format").value;
      const includeAuto = wrap.querySelector("#bk-auto").checked;
      const includeTeam = wrap.querySelector("#bk-team").checked;
      btn.disabled = true;
      statusEl.textContent = "Gathering your data…";
      try {
        const sections = await gatherBackupSections({ includeAuto, includeTeam, isAdmin });
        const total = sections.reduce((n, s) => n + (s.rows ? s.rows.length : 0), 0);
        const THRESHOLD = 50000; // assembled in-browser; warn past this before risking a freeze
        if (total > THRESHOLD) {
          const ok = await confirmModal({ title: "Large backup", message: `This backup has about ${total.toLocaleString()} rows. It's built in your browser, which can be slow or run out of memory at this size. Continue anyway?`, confirmText: "Continue" });
          if (!ok) { statusEl.textContent = ""; btn.disabled = false; return; }
        }
        statusEl.textContent = "Assembling your " + (fmt === "zip" ? "ZIP" : "Excel file") + "… this may take a moment.";
        await new Promise((r) => setTimeout(r, 30)); // let the status paint before the heavy work
        const stamp = backupStamp();
        if (fmt === "zip") await buildBackupZip(sections, stamp);
        else buildBackupXlsx(sections, stamp);
        try { await App.portalApi("/api/backups", { method: "POST", body: JSON.stringify({ name: "Data backup " + stamp, rowCount: total }) }); } catch (e) { /* logging is best-effort */ }
        statusEl.textContent = `Backup downloaded — ${total.toLocaleString()} rows across ${sections.length} data types.`;
      } catch (e) {
        statusEl.textContent = "Backup failed: " + (e && e.message ? e.message : "unknown error");
      }
      btn.disabled = false;
    };
  }

  // Centralized cross-type history with Type / User / Download columns. Reads the
  // combined import+export history from Batch A (GET /api/exports, no filter).
  function dataHistoryTypeLabels(types) {
    const map = { contact: App.label("contact", "many"), feedback: "Feedback", event: "Event log", call: "Calls" };
    (types || []).forEach((t) => { map[t.key] = t.labelPlural || t.label; });
    return map;
  }
  function dataHistoryWhat(r, typeLabels) {
    if (r.kind === "backup") return "Full backup";
    if (r.kind === "report") {
      // Single-source report -> "<Type> · Report"; multi-source -> just "Report".
      return r.dataType ? ((typeLabels[r.dataType] || r.dataType) + " · Report") : "Report";
    }
    const typeLabel = r.dataType ? (typeLabels[r.dataType] || r.dataType) : "Other";
    return typeLabel + " · " + (r.kind === "import" ? "Import" : "Export");
  }
  async function tabHistory(host) {
    host.innerHTML = `<div class="cell-muted" style="padding:8px">Loading…</div>`;
    let rows = [], types = [];
    try { [rows, types] = await Promise.all([App.portalApi("/api/exports"), App.portalApi("/api/record-types").catch(() => [])]); }
    catch (e) { host.innerHTML = `<div class="cell-muted" style="padding:8px">${esc(e.message)}</div>`; return; }
    rows = Array.isArray(rows) ? rows : [];
    const typeLabels = dataHistoryTypeLabels(types);
    const typeLabelOf = (dt) => (dt ? (typeLabels[dt] || dt) : "Other");
    const countOf = (r) => (r.kind === "import"
      ? (r.okCount != null ? r.okCount : r.rowCount) + (r.failCount ? " (skipped " + r.failCount + ")" : "")
      : String(r.rowCount));

    const columns = [
      { key: "createdAt", label: "When", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` },
      { key: "what", label: "Type", type: "text", get: (r) => dataHistoryWhat(r, typeLabels), render: (r) => `<span class="pill${r.kind === "report" ? " report" : ""}">${esc(dataHistoryWhat(r, typeLabels))}</span>` },
      { key: "name", label: "Name", type: "text", get: (r) => r.name, render: (r) => esc(r.name || "—") },
      { key: "user", label: "User", type: "text", get: (r) => r.createdByName || "", render: (r) => `<span class="cell-muted">${esc(r.createdByName || "—")}</span>` },
      { key: "count", label: "Rows", type: "text", get: (r) => countOf(r), render: (r) => `<span class="cell-muted">${esc(countOf(r))}</span>` },
      { key: "download", label: "Download", type: "text", get: () => "", render: (r) => (r.downloadable ? `<button class="btn btn-ghost btn-sm da-dl" data-id="${esc(r.id)}" data-name="${esc(r.name || "export")}">Download</button>` : "") },
    ];

    const present = [];
    rows.forEach((r) => { const dt = r.dataType || "other"; if (present.indexOf(dt) === -1) present.push(dt); });
    const tabDefs = [["all", "All"]].concat(present.map((dt) => [dt, dt === "other" ? "Other" : typeLabelOf(dt)]));

    host.innerHTML = "";
    const filterTabs = el("div", "tabs");
    const tableHost = el("div");
    // Delegated download handler (survives App.table's internal re-renders).
    tableHost.addEventListener("click", async (e) => {
      const btn = e.target.closest ? e.target.closest(".da-dl") : null;
      if (!btn) return;
      e.stopPropagation();
      try { const r = await App.portalApi("/api/exports/" + encodeURIComponent(btn.dataset.id) + "/download"); downloadCSV((btn.dataset.name || "export").replace(/[^a-z0-9]+/gi, "-") + ".csv", r.csv); }
      catch (err) { toast(err.message, true); }
    });
    let activeType = "all";
    function mountTable() {
      const data = activeType === "all" ? rows : rows.filter((r) => (r.dataType || "other") === activeType);
      tableHost.innerHTML = "";
      App.table.mount({
        container: tableHost, columns, rows: data,
        defaultSort: "createdAt", defaultSortDir: "desc",
        emptyHtml: `<div class="card cell-muted" style="padding:18px">No import or export activity yet.</div>`,
        pageSize: 50,
      });
    }
    tabDefs.forEach(([key, label]) => {
      const t = el("button", "tab" + (key === "all" ? " active" : ""), esc(label));
      t.dataset.t = key;
      t.onclick = () => { activeType = key; App.util.$$(".tab", filterTabs).forEach((x) => x.classList.toggle("active", x.dataset.t === key)); mountTable(); };
      filterTabs.appendChild(t);
    });
    host.appendChild(filterTabs);
    host.appendChild(tableHost);
    mountTable();
  }

  // Data Administration → Reports. A LIST of every scheduled report (active AND
  // inactive), closely mirroring the Import / Export History table: Date Created,
  // Name, Created by, Rows, Download, and an Active/Inactive status pill. Below the
  // list sits a clearly-labelled stub for the report builder (lands next batch).
  // Reads GET /api/reports (each report joined with its latest ExportRecord run);
  // the Download button reuses the export-download route with the run's record id.
  // Format-aware download: plain CSV (text) or xlsx/zip (base64 -> bytes), rebuilding
  // the exact emailed file with the right extension. Reused by the reports list.
  function downloadArtifact(meta, fallbackName) {
    const base = String(fallbackName || meta.name || "report").replace(/[^a-z0-9]+/gi, "-");
    if (meta && meta.base64) {
      const bin = atob(meta.csv || "");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      downloadBlob(`${base}.${meta.ext || "bin"}`, new Blob([bytes], { type: meta.mime || "application/octet-stream" }));
    } else {
      downloadBlob(`${base}.${(meta && meta.ext) || "csv"}`, new Blob([(meta && meta.csv) || ""], { type: (meta && meta.mime) || "text/csv;charset=utf-8;" }));
    }
  }

  async function tabReports(host) {
    host.innerHTML = `<div class="cell-muted" style="padding:8px">Loading…</div>`;
    let rows = [], recordTypes = [], settings = {};
    try {
      [rows, recordTypes, settings] = await Promise.all([
        App.portalApi("/api/reports"),
        App.portalApi("/api/record-types").catch(() => []),
        App.portalApi("/api/settings").catch(() => ({})),
      ]);
    } catch (e) { host.innerHTML = `<div class="cell-muted" style="padding:8px">${esc(e.message)}</div>`; return; }
    rows = Array.isArray(rows) ? rows : [];
    recordTypes = Array.isArray(recordTypes) ? recordTypes : [];
    const portalTz = (settings && settings.timezone) || "America/New_York";

    const nextRunText = (r) => (r.mode !== "recurring" ? "—" : (!r.active ? "Paused" : (r.nextRunAt ? fmtDate(r.nextRunAt) : "—")));
    const lastRunText = (r) => (r.lastRunAt ? fmtDate(r.lastRunAt) : "—");
    const rowsOf = (r) => (r.latestRun && r.latestRun.rowCount != null ? String(r.latestRun.rowCount) : "—");
    // Derived three-state status: immediate => One-Time; recurring => Active/Inactive.
    const statusOf = (r) => (r.mode !== "recurring" ? "onetime" : (r.active ? "active" : "inactive"));
    const statusCell = (r) => {
      const s = statusOf(r);
      if (s === "onetime") return `<span class="pill">One-Time</span>`; // neutral, not a toggle
      const active = s === "active";
      return `<button class="pill ${active ? "success" : "skipped"} rp-toggle" data-id="${esc(r.id)}" data-active="${active ? "1" : "0"}" title="Click to ${active ? "pause" : "activate"}">${active ? "Active" : "Inactive"}</button>`;
    };
    const columns = [
      { key: "createdAt", label: "Date Created", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` },
      { key: "name", label: "Name", type: "text", get: (r) => r.name, render: (r) => esc(r.name || "—") },
      { key: "user", label: "Created by", type: "text", get: (r) => r.createdByName || "", render: (r) => `<span class="cell-muted">${esc(r.createdByName || "—")}</span>` },
      { key: "count", label: "Rows", type: "text", get: (r) => rowsOf(r), render: (r) => `<span class="cell-muted">${esc(rowsOf(r))}</span>` },
      { key: "nextRun", label: "Next run", type: "text", get: (r) => nextRunText(r), render: (r) => `<span class="cell-muted">${esc(nextRunText(r))}</span>` },
      { key: "lastRun", label: "Last run", type: "text", get: (r) => lastRunText(r), render: (r) => `<span class="cell-muted">${esc(lastRunText(r))}</span>` },
      { key: "download", label: "Download", type: "text", get: () => "", render: (r) => (r.latestRun && r.latestRun.downloadable ? `<button class="btn btn-ghost btn-sm rp-dl" data-id="${esc(r.latestRun.exportRecordId)}" data-name="${esc(r.name || "report")}">Download</button>` : "") },
      { key: "active", label: "Status", type: "text", get: (r) => (statusOf(r) === "onetime" ? "One-Time" : statusOf(r) === "active" ? "Active" : "Inactive"), render: (r) => statusCell(r) },
    ];

    host.innerHTML = "";

    // ----- (A) The list, with the same Filters affordance as the history table -----
    const filterTabs = el("div", "tabs");
    const tableHost = el("div");
    tableHost.addEventListener("click", async (e) => {
      const btn = e.target.closest ? e.target.closest(".rp-dl") : null;
      if (!btn) return;
      e.stopPropagation();
      try { const r = await App.portalApi("/api/exports/" + encodeURIComponent(btn.dataset.id) + "/download"); downloadArtifact(r, btn.dataset.name); }
      catch (err) { toast(err.message, true); }
    });
    // Active/Inactive toggle — flips ScheduledReport.active and refreshes the list.
    tableHost.addEventListener("click", async (e) => {
      const btn = e.target.closest ? e.target.closest(".rp-toggle") : null;
      if (!btn) return;
      e.stopPropagation();
      const makeActive = btn.dataset.active !== "1";
      btn.disabled = true;
      try {
        await App.portalApi("/api/reports/" + encodeURIComponent(btn.dataset.id) + "/active", { method: "PATCH", body: JSON.stringify({ active: makeActive }) });
        tabReports(host);
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    });
    let activeFilter = "all";
    function mountTable() {
      const data = activeFilter === "all" ? rows : rows.filter((r) => statusOf(r) === activeFilter);
      tableHost.innerHTML = "";
      App.table.mount({
        container: tableHost, columns, rows: data,
        defaultSort: "createdAt", defaultSortDir: "desc",
        onRowClick: (r) => openEdit(r.id),
        emptyHtml: `<div class="card cell-muted" style="padding:18px">No reports yet.</div>`,
        pageSize: 50,
      });
    }
    [["all", "All"], ["active", "Active"], ["inactive", "Inactive"], ["onetime", "One-Time"]].forEach(([key, label]) => {
      const t = el("button", "tab" + (key === "all" ? " active" : ""), esc(label));
      t.dataset.t = key;
      t.onclick = () => { activeFilter = key; App.util.$$(".tab", filterTabs).forEach((x) => x.classList.toggle("active", x.dataset.t === key)); mountTable(); };
      filterTabs.appendChild(t);
    });
    host.appendChild(filterTabs);
    const editHint = el("div", "cell-muted", "Click a report to edit its fields, filters, email body, or schedule.");
    editHint.style.cssText = "font-size:13px; margin:4px 2px 8px";
    host.appendChild(editHint);
    host.appendChild(tableHost);
    mountTable();

    // ----- (B) The Create-a-report form -----------------------------------------
    // Wrap the builder in the SAME .table-layout/.table-area structure App.table.mount
    // uses for the list above, so both panels share identical left/right edges and
    // width (the closed filter-rail's flex gap offsets both the same way). This is an
    // OUTER alignment only — the list table itself is untouched (no inner spacing,
    // column, or density change).
    const builder = reportBuilder(rows, recordTypes, portalTz, () => tabReports(host));
    const builderLayout = el("div", "table-layout");
    const builderRail = el("aside", "filter-rail"); // empty + closed (width:0), mirrors the list
    const builderArea = el("div", "table-area");
    builderArea.appendChild(builder);
    builderLayout.appendChild(builderRail);
    builderLayout.appendChild(builderArea);
    host.appendChild(builderLayout);

    // Click-to-edit: load the saved spec and prefill the SAME form bound to this id.
    async function openEdit(id) {
      try {
        const full = await App.portalApi("/api/reports/" + encodeURIComponent(id));
        builder.prefillReport(full);
        builder.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) { toast(e.message, true); }
    }
  }

  // The Create-a-report form: name + format + "start from saved" ABOVE a per-type
  // tab strip (one tab per reportable type), each with a field checklist + the
  // existing filter rule editor; recipients + "Send now" + a schedule stub BELOW.
  function reportBuilder(savedReports, recordTypes, portalTz, onSent) {
    const card = el("div", "card");
    card.style.cssText = "margin-top:18px; padding:18px";
    const headRow = el("div"); headRow.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:6px";
    const heading = el("h3", "settings-sub", "Create a report"); heading.style.margin = "0";
    const newBtn = el("button", "btn btn-ghost btn-sm", "New report"); newBtn.style.display = "none";
    headRow.appendChild(heading); headRow.appendChild(newBtn);
    card.appendChild(headRow);

    // Per-type working state. fields = Set of checked column KEYS (never labels).
    const state = { id: null, byType: {} };
    // Recurring cadence working state (used only when delivery = "schedule").
    const cad = { delivery: "now", days: new Set(), weekInterval: 1, times: {}, lastTime: "09:00" };
    const DOW = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
    recordTypes.forEach((t) => { state.byType[t.key] = { fields: new Set(), rules: [], loaded: false, cols: [], rows: [], bodyEl: null }; });

    // --- ABOVE: name, format, start-from-saved -------------------------------
    const top = el("div");
    top.style.cssText = "display:grid; gap:12px; grid-template-columns:1fr 160px; align-items:end; margin-bottom:14px";
    const nameWrap = el("label", "field");
    nameWrap.innerHTML = `<span class="field-label">Report name</span>`;
    const nameInput = el("input", "input"); nameInput.type = "text"; nameInput.placeholder = "e.g. Weekly leads";
    nameWrap.appendChild(nameInput);
    const fmtWrap = el("label", "field");
    fmtWrap.innerHTML = `<span class="field-label">Format</span>`;
    const fmtSel = el("select", "input"); fmtSel.innerHTML = `<option value="csv">CSV</option><option value="xlsx">Excel</option>`;
    fmtWrap.appendChild(fmtSel);
    top.appendChild(nameWrap); top.appendChild(fmtWrap);
    card.appendChild(top);

    if ((savedReports || []).length) {
      const startWrap = el("label", "field"); startWrap.style.marginBottom = "14px";
      startWrap.innerHTML = `<span class="field-label">Start from a saved report (optional)</span>`;
      const sel = el("select", "input");
      sel.innerHTML = `<option value="">— start blank —</option>` + savedReports.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
      sel.onchange = async () => {
        const id = sel.value;
        if (!id) { state.id = null; return; }
        try {
          const full = await App.portalApi("/api/reports/" + encodeURIComponent(id));
          prefill(full);
        } catch (e) { toast(e.message, true); }
      };
      startWrap.appendChild(sel);
      card.appendChild(startWrap);
    }

    // --- TABS: one per reportable type ---------------------------------------
    const tabStrip = el("div", "tabs");
    const tabBody = el("div"); tabBody.style.marginTop = "10px";
    let activeType = recordTypes.length ? recordTypes[0].key : null;

    recordTypes.forEach((t, i) => {
      const tb = el("button", "tab" + (i === 0 ? " active" : ""), esc(t.labelPlural || t.label || t.key));
      tb.dataset.k = t.key;
      tb.onclick = () => { activeType = t.key; App.util.$$(".tab", tabStrip).forEach((x) => x.classList.toggle("active", x.dataset.k === t.key)); showType(t.key); };
      tabStrip.appendChild(tb);
    });
    card.appendChild(tabStrip);
    card.appendChild(tabBody);

    async function loadType(typeKey) {
      const st = state.byType[typeKey];
      if (st.loaded) return;
      const type = recordTypes.find((t) => t.key === typeKey) || { key: typeKey, label: typeKey };
      try {
        if (typeKey === "contact") {
          const [fields, contacts] = await Promise.all([App.portalApi("/api/fields").catch(() => []), App.portalApi("/api/contacts").catch(() => [])]);
          st.cols = contactColumnDefs(fields || []);
          st.rows = Array.isArray(contacts) ? contacts : [];
        } else {
          const [fields, records, resources] = await Promise.all([
            App.portalApi("/api/fields?recordType=" + encodeURIComponent(typeKey)).catch(() => []),
            App.portalApi("/api/records?type=" + encodeURIComponent(typeKey)).catch(() => []),
            typeKey === "booking" ? App.portalApi("/api/resources").catch(() => []) : Promise.resolve([]),
          ]);
          const resById = {}; (resources || []).forEach((r) => { resById[r.id] = r; });
          st.cols = recordColumnDefs(fields || [], type, resById);
          st.rows = Array.isArray(records) ? records : [];
        }
      } catch (e) { st.cols = []; st.rows = []; }
      st.loaded = true;
    }

    async function showType(typeKey) {
      tabBody.innerHTML = `<div class="cell-muted" style="padding:8px">Loading…</div>`;
      await loadType(typeKey);
      const st = state.byType[typeKey];
      tabBody.innerHTML = "";
      st.bodyEl = tabBody;

      // Field checklist (stored as KEYS).
      const fieldsCard = el("div");
      fieldsCard.innerHTML = `<div class="field-label" style="margin-bottom:6px">Fields to include</div>`;
      const grid = el("div"); grid.style.cssText = "display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:6px 14px; margin-bottom:12px";
      st.cols.forEach((c) => {
        const lab = el("label"); lab.style.cssText = "display:flex; gap:7px; align-items:center; font-size:13px; cursor:pointer";
        const cb = el("input"); cb.type = "checkbox"; cb.checked = st.fields.has(c.key);
        cb.onchange = () => { if (cb.checked) st.fields.add(c.key); else st.fields.delete(c.key); updateSummary(); };
        lab.appendChild(cb); lab.appendChild(document.createTextNode(c.label));
        grid.appendChild(lab);
      });
      fieldsCard.appendChild(grid);
      tabBody.appendChild(fieldsCard);

      // Existing filter rule editor = "who to include" for this type.
      const rulesLabel = el("div", "field-label", "Who to include (filters)"); rulesLabel.style.marginBottom = "6px";
      tabBody.appendChild(rulesLabel);
      const rulesHost = el("div");
      rulesHost.appendChild(App.table.ruleEditor(st.cols, st.rows, st.rules, () => {}));
      tabBody.appendChild(rulesHost);
    }

    // --- BELOW: recipients, Send now, schedule stub --------------------------
    const summary = el("div", "cell-muted"); summary.style.cssText = "margin:14px 0 6px; font-size:13px";
    function includedTypes() { return recordTypes.filter((t) => state.byType[t.key].fields.size > 0); }
    function updateSummary() {
      const inc = includedTypes();
      summary.textContent = inc.length
        ? "This report includes: " + inc.map((t) => `${t.labelPlural || t.label} (${state.byType[t.key].fields.size} field${state.byType[t.key].fields.size === 1 ? "" : "s"})`).join(", ")
        : "Check at least one field in a tab to include that type.";
    }
    card.appendChild(summary);

    const recipWrap = el("label", "field");
    recipWrap.innerHTML = `<span class="field-label">Recipients (comma-separated emails)</span>`;
    const recipInput = el("input", "input"); recipInput.type = "text"; recipInput.placeholder = "you@example.com, teammate@example.com";
    recipWrap.appendChild(recipInput);
    card.appendChild(recipWrap);

    // Email body — REUSES the app's rich-text composer. Empty => executor uses its
    // default attachment-notice text. Round-trips on edit via getHTML()/setBody().
    const bodyWrap = el("div", "field"); bodyWrap.style.marginTop = "12px";
    bodyWrap.appendChild(el("span", "field-label", "Email body (optional)"));
    const bodyHost = el("div"); bodyWrap.appendChild(bodyHost);
    card.appendChild(bodyWrap);
    const bodyApi = App.compose.mount(bodyHost, { kind: "richtext" });

    // --- Delivery: Send now vs Send on a schedule ----------------------------
    const delivWrap = el("div"); delivWrap.style.cssText = "margin-top:14px";
    delivWrap.appendChild(el("div", "field-label", "Delivery"));
    const seg = el("div", "tabs"); seg.style.marginBottom = "8px";
    const nowTab = el("button", "tab active", "Send now");
    const schedTab = el("button", "tab", "Send on a schedule");
    seg.appendChild(nowTab); seg.appendChild(schedTab);
    delivWrap.appendChild(seg);
    card.appendChild(delivWrap);

    // --- Cadence builder (hidden until "Send on a schedule") ------------------
    const cadPanel = el("div", "card"); cadPanel.style.cssText = "padding:14px; margin-bottom:10px; display:none";
    cadPanel.appendChild(el("div", "field-label", "Which days"));
    const dayRow = el("div"); dayRow.style.cssText = "display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px";
    DOW.forEach(([n, label]) => {
      const b = el("button", "tab", label); b.dataset.d = String(n);
      b.onclick = () => {
        if (cad.days.has(n)) { cad.days.delete(n); delete cad.times[n]; }
        else { cad.days.add(n); if (!cad.times[n]) cad.times[n] = cad.lastTime; }
        b.classList.toggle("active", cad.days.has(n));
        renderTimes(); renderCadSummary();
      };
      dayRow.appendChild(b);
    });
    cadPanel.appendChild(dayRow);

    const intervalWrap = el("div"); intervalWrap.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:12px";
    intervalWrap.appendChild(el("span", "", "Every"));
    const intervalInput = el("input", "input"); intervalInput.type = "number"; intervalInput.min = "1"; intervalInput.value = "1"; intervalInput.style.width = "70px";
    intervalInput.onchange = () => { cad.weekInterval = Math.max(1, Math.floor(Number(intervalInput.value) || 1)); intervalInput.value = String(cad.weekInterval); renderCadSummary(); };
    intervalWrap.appendChild(intervalInput);
    intervalWrap.appendChild(el("span", "cell-muted", "week(s) — week 1 is the week you save this."));
    cadPanel.appendChild(intervalWrap);

    const timesLabel = el("div", "field-label", "Time per day"); cadPanel.appendChild(timesLabel);
    const timesHost = el("div"); timesHost.style.cssText = "display:flex; flex-direction:column; gap:6px; margin-bottom:6px"; cadPanel.appendChild(timesHost);
    function renderTimes() {
      timesHost.innerHTML = "";
      const sel = Array.from(cad.days).sort((a, b) => a - b);
      if (!sel.length) { timesHost.appendChild(el("div", "cell-muted", "Pick one or more days above.")); return; }
      const labelOf = (n) => (DOW.find((d) => d[0] === n) || [, ""])[1];
      sel.forEach((n) => {
        const row = el("div"); row.style.cssText = "display:flex; align-items:center; gap:10px";
        const lab = el("span"); lab.style.cssText = "width:42px"; lab.textContent = labelOf(n);
        const ti = el("input", "input"); ti.type = "time"; ti.value = cad.times[n] || cad.lastTime; ti.style.width = "140px";
        ti.onchange = () => { cad.times[n] = ti.value || "09:00"; cad.lastTime = cad.times[n]; renderCadSummary(); };
        const tz = el("span", "cell-muted"); tz.textContent = portalTz;
        row.appendChild(lab); row.appendChild(ti); row.appendChild(tz);
        timesHost.appendChild(row);
      });
    }
    const cadSummary = el("div"); cadSummary.style.cssText = "font-size:13px; margin-top:8px; font-weight:600";
    cadPanel.appendChild(cadSummary);
    function ord(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
    function fmt12(hhmm) { const [h, m] = (hhmm || "00:00").split(":").map(Number); const ap = h < 12 ? "AM" : "PM"; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${String(m).padStart(2, "0")} ${ap}`; }
    function renderCadSummary() {
      const sel = Array.from(cad.days).sort((a, b) => a - b);
      if (!sel.length) { cadSummary.textContent = "No schedule set yet."; return; }
      const every = cad.weekInterval === 1 ? "Every week" : `Every ${ord(cad.weekInterval)} week`;
      const labelOf = (n) => (DOW.find((d) => d[0] === n) || [, ""])[1];
      const parts = sel.map((n) => `${labelOf(n)} ${fmt12(cad.times[n] || cad.lastTime)}`);
      cadSummary.textContent = `${every} on ${parts.join(", ")} (${portalTz})`;
    }
    card.appendChild(cadPanel);
    renderTimes(); renderCadSummary();

    function setDelivery(mode) {
      cad.delivery = mode;
      nowTab.classList.toggle("active", mode === "now");
      schedTab.classList.toggle("active", mode === "schedule");
      cadPanel.style.display = mode === "schedule" ? "" : "none";
      submitBtn.textContent = mode === "schedule" ? "Save schedule" : "Send now";
    }
    nowTab.onclick = () => setDelivery("now");
    schedTab.onclick = () => setDelivery("schedule");

    const actions = el("div"); actions.style.cssText = "display:flex; gap:12px; align-items:center; margin-top:14px";
    const submitBtn = el("button", "btn btn-primary", "Send now");
    actions.appendChild(submitBtn);
    card.appendChild(actions);

    function setEditMode(editing) {
      heading.textContent = editing ? "Edit report" : "Create a report";
      newBtn.style.display = editing ? "" : "none";
    }
    function resetForm() {
      state.id = null;
      nameInput.value = ""; recipInput.value = ""; fmtSel.value = "csv";
      bodyApi.setBody("");
      recordTypes.forEach((t) => { const st = state.byType[t.key]; st.fields = new Set(); st.rules.length = 0; });
      cad.days = new Set(); cad.times = {}; cad.weekInterval = 1; intervalInput.value = "1";
      DOW.forEach(([n]) => { const b = dayRow.querySelector(`[data-d="${n}"]`); if (b) b.classList.remove("active"); });
      renderTimes(); renderCadSummary(); setDelivery("now"); setEditMode(false);
      updateSummary(); if (activeType) showType(activeType);
    }
    newBtn.onclick = resetForm;

    function prefill(full) {
      state.id = full.id || null;
      nameInput.value = full.name || "";
      fmtSel.value = full.format === "xlsx" ? "xlsx" : "csv";
      recipInput.value = (full.recipients || []).join(", ");
      bodyApi.setBody(full.emailBody || "");
      const types = (full.definition && full.definition.types) || {};
      recordTypes.forEach((t) => {
        const st = state.byType[t.key];
        const d = types[t.key] || {};
        st.fields = new Set(Array.isArray(d.fields) ? d.fields : []);
        st.rules.length = 0; (Array.isArray(d.rules) ? d.rules : []).forEach((r) => st.rules.push(r));
      });
      // Restore cadence if this saved report is recurring.
      cad.days = new Set(); cad.times = {}; cad.weekInterval = 1;
      const c = full.cadence;
      if (full.mode === "recurring" && c && Array.isArray(c.daysOfWeek)) {
        c.daysOfWeek.forEach((n) => cad.days.add(Number(n)));
        cad.weekInterval = Math.max(1, Math.floor(Number(c.weekInterval) || 1));
        Object.keys(c.times || {}).forEach((k) => { cad.times[Number(k)] = c.times[k]; });
        const firstTime = Object.values(cad.times)[0]; if (firstTime) cad.lastTime = firstTime;
        intervalInput.value = String(cad.weekInterval);
        DOW.forEach(([n]) => { const b = dayRow.querySelector(`[data-d="${n}"]`); if (b) b.classList.toggle("active", cad.days.has(n)); });
        renderTimes(); renderCadSummary();
        setDelivery("schedule");
      } else {
        DOW.forEach(([n]) => { const b = dayRow.querySelector(`[data-d="${n}"]`); if (b) b.classList.remove("active"); });
        renderTimes(); renderCadSummary();
        setDelivery("now");
      }
      setEditMode(!!state.id);
      updateSummary();
      if (activeType) showType(activeType);
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function collect() {
      const name = nameInput.value.trim();
      if (!name) { toast("Give the report a name.", true); return null; }
      const inc = includedTypes();
      if (!inc.length) { toast("Check at least one field to include.", true); return null; }
      const recipients = recipInput.value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!recipients.length || !recipients.every((e) => emailRe.test(e))) { toast("Enter one or more valid emails.", true); return null; }
      const definition = { types: {} };
      inc.forEach((t) => { const st = state.byType[t.key]; definition.types[t.key] = { fields: Array.from(st.fields), rules: st.rules.slice() }; });
      return { name, recipients, definition, format: fmtSel.value, emailBody: bodyApi.getHTML() };
    }

    submitBtn.onclick = async () => {
      const payload = collect();
      if (!payload) return;

      if (cad.delivery === "schedule") {
        const days = Array.from(cad.days).sort((a, b) => a - b);
        if (!days.length) { toast("Pick at least one day for the schedule.", true); return; }
        if (!days.every((n) => cad.times[n])) { toast("Set a time for each selected day.", true); return; }
        const cadence = { daysOfWeek: days, weekInterval: cad.weekInterval, times: {} };
        days.forEach((n) => { cadence.times[n] = cad.times[n]; });
        submitBtn.disabled = true; submitBtn.textContent = "Saving…";
        try {
          const res = await App.portalApi("/api/reports/save", { method: "POST", body: JSON.stringify({ id: state.id, ...payload, cadence }) });
          toast(`Schedule saved — ${res.summary}. Next run ${fmtDate(res.nextRunAt)}.`);
          onSent && onSent();
        } catch (e) { toast(e.message, true); submitBtn.disabled = false; submitBtn.textContent = "Save schedule"; }
        return;
      }

      submitBtn.disabled = true; submitBtn.textContent = "Sending…";
      try {
        const res = await App.portalApi("/api/reports/run", { method: "POST", body: JSON.stringify({ id: state.id, ...payload }) });
        toast(`Report sent (${res.rowCount} row${res.rowCount === 1 ? "" : "s"}) to ${payload.recipients.length} recipient${payload.recipients.length === 1 ? "" : "s"}.`);
        onSent && onSent();
      } catch (e) {
        toast(e.message, true);
        submitBtn.disabled = false; submitBtn.textContent = "Send now";
      }
    };

    updateSummary();
    if (activeType) showType(activeType);
    card.prefillReport = prefill;
    return card;
  }


  // ---------------- Contacts ----------------
  // Build the full set of available columns from Fields (system + custom),
  // plus two synthetic columns (Calls, Time Created). Used by Contacts + Recycle Bin.
  function contactColumnDefs(fields) {
    const SYS = { name: 1, phone: 1, email: 1, intent: 1 };
    const colType = (t) => (t === "number" ? "number" : t === "date" ? "date" : "text");
    const cols = (fields || []).map((f) => {
      const isSys = !!SYS[f.key];
      const get = isSys ? (r) => r[f.key] : (r) => (r.customFields || {})[f.key];
      const disp = (r) => { const v = get(r); return Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v); };
      return {
        key: f.key, label: f.label, type: colType(f.type), get, text: disp,
        cellClass: f.key === "name" ? "cell-strong" : f.key === "phone" ? "cell-mono" : f.key === "email" || f.key === "intent" ? "cell-muted" : "",
        render:
          f.type === "image"
            ? (r) => { const v = get(r); return v && /^data:image\//i.test(String(v)) ? `<img class="cell-thumb" src="${esc(String(v))}" alt="" />` : `<span class="cell-muted">—</span>`; }
            : f.key === "name"
            ? (r) => esc(disp(r) || "Unknown")
            : (r) => esc(disp(r) || "—"),
      };
    });
    cols.push({ key: "source", label: "Source", type: "text", get: (r) => r.source, text: (r) => r.source || "unknown", render: (r) => esc(r.source || "unknown") });
    cols.push({ key: "callerId", label: "Caller ID", type: "text", get: (r) => r.callerId, text: (r) => r.callerId || "", cellClass: "cell-mono", render: (r) => esc(r.callerId || "—") });
    cols.push({ key: "callCount", label: "Calls", type: "number", get: (r) => r.callCount, text: (r) => String(r.callCount || 0) });
    cols.push({ key: "createdAt", label: "Time Created", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` });
    return cols;
  }

  const DEFAULT_COLS = ["name", "phone", "email", "intent", "source", "callCount", "createdAt"];
  function applyColumnLayout(all, layout) {
    const byKey = {}; all.forEach((c) => (byKey[c.key] = c));
    const hasLayout = (layout && ((layout.order || []).length || (layout.hidden || []).length));
    if (!hasLayout) return DEFAULT_COLS.filter((k) => byKey[k]).map((k) => byKey[k]); // custom fields hidden by default
    const hidden = new Set(layout.hidden || []);
    const ordered = [];
    (layout.order || []).forEach((k) => { if (byKey[k]) ordered.push(byKey[k]); });
    all.forEach((c) => { if (ordered.indexOf(c) === -1) ordered.push(c); });
    return ordered.filter((c) => !hidden.has(c.key));
  }

  async function renderContacts() {
    loading();
    const [contacts, fields, colResp] = await Promise.all([
      App.portalApi("/api/contacts"),
      App.portalApi("/api/fields").catch(() => []),
      App.portalApi("/api/account/contact-columns").catch(() => ({ layout: {} })),
    ]);
    const allColumns = contactColumnDefs(fields);
    let layout = (colResp && colResp.layout) || {};
    let columns = applyColumnLayout(allColumns, layout);

    view().innerHTML = "";
    const container = el("div", "fade-in");
    const bar = el("div", "page-actions");
    const dummyBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#129302;</span> Create Dummy contact`);
    dummyBtn.onclick = async () => {
      dummyBtn.disabled = true;
      try { await App.portalApi("/api/contacts/dummy", { method: "POST", body: JSON.stringify({}) }); App.util.toast(("Dummy " + App.label("contact","one").toLowerCase() + " created")); renderContacts(); }
      catch (e) { App.util.toast(e.message, true); dummyBtn.disabled = false; }
    };
    const createBtn = el("button", "btn btn-primary btn-sm", `<span class="btn-icon">&#43;</span> Create ${App.label("contact", "one")}`);
    createBtn.onclick = () => openCreateContact();
    const importBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8681;</span> Import ${App.label("contact", "many").toLowerCase()}`);
    importBtn.onclick = openImport;
    const exportBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8679;</span> Export ${App.label("contact", "many").toLowerCase()}`);
    exportBtn.onclick = () => openExport(contactExportOpts(handle ? handle.getColumns() : columns, contacts));
    bar.appendChild(dummyBtn);
    bar.appendChild(createBtn);
    bar.appendChild(importBtn);
    bar.appendChild(exportBtn);
    container.appendChild(bar);
    const tableHost = el("div");
    container.appendChild(tableHost);
    view().appendChild(container);

    let handle;
    handle = App.table.mount({
      container: tableHost, columns, rows: contacts, selectable: true, rowId: (r) => r.id,
      scrollX: true, pageSize: 50,
      onRowClick: (r) => App.go("#/contact/" + r.id),
      onSelectionChange: (ids) => updateBulkBar(ids),
      defaultSort: "createdAt", defaultSortDir: "desc",
      emptyHtml: `<div class="empty"><div class="empty-emoji">&#128100;</div><h3>No contacts yet</h3><p>Contacts appear after calls are completed, or import a list.</p><button class="btn btn-primary" id="empty-import"><span class="btn-icon">&#8681;</span> Import contacts</button></div>`,
      onEmptyMount: (w) => { const b = w.querySelector("#empty-import"); if (b) b.onclick = openImport; },
    });
    if (handle && handle.toolbarLeft) mountSavedFilters(handle, "contacts");

    // Bulk actions (left) + selected count
    const bulkWrap = el("div", "bulk-wrap");
    const bulkBtn = el("button", "btn btn-ghost btn-sm", "Bulk Actions &#9662;");
    const bulkMenu = el("div", "bulk-menu hidden");
    const selCount = el("span", "bulk-count", "");
    bulkWrap.appendChild(bulkBtn); bulkWrap.appendChild(bulkMenu); bulkWrap.appendChild(selCount);
    handle.toolbarLeft.appendChild(bulkWrap);
    function updateBulkBar(ids) { selCount.textContent = ids.length ? `${ids.length} selected` : ""; }
    function selectedRows() { const set = new Set(handle.getSelected()); return contacts.filter((c) => set.has(c.id)); }
    const bulkMsg = el("div", "bulk-empty hidden", ("Select a " + App.label("contact","one").toLowerCase() + " first."));
    bulkMenu.appendChild(bulkMsg);
    let msgTimer = null;
    function needSelection(text) { bulkMsg.textContent = text || ("Select a " + App.label("contact","one").toLowerCase() + " first."); bulkMsg.classList.remove("hidden"); clearTimeout(msgTimer); msgTimer = setTimeout(() => bulkMsg.classList.add("hidden"), 1800); }
    function bulkItem(label, fn) { const b = el("button", "bulk-item", label); b.onclick = () => fn(); return b; }
    bulkMenu.appendChild(bulkItem("Email selected", () => { const rows = selectedRows(); if (!rows.length) return needSelection(); bulkMenu.classList.add("hidden"); App.communication.composeTo(rows.map((r) => r.id)); }));
    if (App.smsEnabled()) bulkMenu.appendChild(bulkItem("Text selected", () => { if (!handle.getSelected().length) return needSelection(); bulkMenu.classList.add("hidden"); bulkText(selectedRows()); }));
    bulkMenu.appendChild(bulkItem("Export selected", () => { const rows = selectedRows(); if (!rows.length) return needSelection(); bulkMenu.classList.add("hidden"); openExport(contactExportOpts(handle.getColumns(), rows)); }));
    bulkMenu.appendChild(el("div", "pop-sep"));
    bulkMenu.appendChild(bulkItem("Update a field…", () => { const ids = handle.getSelected(); if (!ids.length) return needSelection(); bulkMenu.classList.add("hidden"); openMassUpdate(ids, fields); }));
    bulkMenu.appendChild(bulkItem(("Merge " + App.label("contact","many").toLowerCase() + "…"), () => { const rows = selectedRows(); if (rows.length < 2) { needSelection(("Select at least 2 " + App.label("contact","many").toLowerCase() + " to merge.")); return; } bulkMenu.classList.add("hidden"); openMerge(rows, fields); }));
    bulkMenu.appendChild(el("div", "pop-sep"));
    bulkMenu.appendChild(bulkItem("Delete selected", async () => {
      const ids = handle.getSelected(); if (!ids.length) return needSelection();
      bulkMenu.classList.add("hidden");
      if (!(await confirmModal({ title: "Move to Recycle Bin", message: `Move ${App.countLabel("contact", ids.length).toLowerCase()} to the Recycle Bin?`, confirmText: "Move to Recycle Bin" }))) return;
      try { await App.portalApi("/api/contacts/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }); App.util.toast("Moved to Recycle Bin"); renderContacts(); }
      catch (e) { App.util.toast(e.message, true); }
    }));
    bulkBtn.onclick = (e) => { e.stopPropagation(); bulkMenu.classList.toggle("hidden"); if (!bulkMenu.classList.contains("hidden")) setTimeout(() => document.addEventListener("click", () => bulkMenu.classList.add("hidden"), { once: true }), 0); };
    bulkMenu.addEventListener("click", (e) => e.stopPropagation());

    // Manage columns (right, next to search)
    const mc = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#9776;</span> Manage columns`);
    mc.onclick = () => openManageColumns(allColumns, layout, async (newLayout) => {
      layout = newLayout;
      try { const r = await App.portalApi("/api/account/contact-columns", { method: "PATCH", body: JSON.stringify({ layout }) }); layout = r.layout; }
      catch (e) { App.util.toast(e.message, true); }
      handle.setColumns(applyColumnLayout(allColumns, layout));
    });
    if (handle.toolbarRight) handle.toolbarRight.insertBefore(mc, handle.toolbarRight.firstChild);
  }

  // ---------------- Manage columns popup (show/hide + drag reorder) ----------------
  function openManageColumns(allColumns, layout, onSave) {
    const byKey = {}; allColumns.forEach((c) => (byKey[c.key] = c));
    // working order: existing order first (known keys), then any remaining; default order if none.
    let order = (layout && layout.order && layout.order.length) ? layout.order.filter((k) => byKey[k]) : DEFAULT_COLS.filter((k) => byKey[k]);
    allColumns.forEach((c) => { if (order.indexOf(c.key) === -1) order.push(c.key); });
    const hidden = new Set((layout && layout.hidden) || allColumns.filter((c) => DEFAULT_COLS.indexOf(c.key) === -1).map((c) => c.key));
    if (layout && layout.order && layout.order.length) { /* explicit layout: trust its hidden set */ }

    const overlay = el("div", "modal-overlay");
    const modal = el("div", "modal");
    modal.innerHTML = `<div class="modal-head"><h2>Manage columns</h2><button class="icon-btn" id="mc-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    const help = el("p", "cell-muted", "Check to show, drag to reorder. Saved to your account.");
    help.style.marginBottom = "10px";
    body.appendChild(help);
    const list = el("div", "mc-list");
    body.appendChild(list);

    function paint() {
      list.innerHTML = "";
      order.forEach((key) => {
        const c = byKey[key]; if (!c) return;
        const row = el("div", "mc-row"); row.draggable = true; row.dataset.key = key;
        const handle = el("span", "mc-drag", "⠿");
        const lab = el("label", "mc-label");
        const cb = el("input"); cb.type = "checkbox"; cb.checked = !hidden.has(key);
        cb.onchange = () => { if (cb.checked) hidden.delete(key); else hidden.add(key); };
        lab.appendChild(cb); lab.appendChild(document.createTextNode(" " + c.label));
        row.appendChild(handle); row.appendChild(lab);
        row.addEventListener("dragstart", (e) => { row.classList.add("dragging"); e.dataTransfer.setData("text/plain", key); });
        row.addEventListener("dragend", () => row.classList.remove("dragging"));
        row.addEventListener("dragover", (e) => { e.preventDefault(); });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          const from = e.dataTransfer.getData("text/plain"); const to = key;
          if (from === to) return;
          order = order.filter((k) => k !== from);
          const idx = order.indexOf(to);
          order.splice(idx, 0, from);
          paint();
        });
        list.appendChild(row);
      });
    }
    paint();

    const foot = el("div", "modal-foot");
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    const save = el("button", "btn btn-primary btn-sm", "Save columns");
    foot.appendChild(cancel); foot.appendChild(save);

    modal.appendChild(body); modal.appendChild(foot); overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    modal.querySelector("#mc-close").onclick = close;
    cancel.onclick = close;
    save.onclick = () => { onSave({ order: order.slice(), hidden: Array.from(hidden) }); close(); App.util.toast("Columns updated"); };
  }

  // ---------------- Bulk text (SMS) — reuses the single-contact send endpoint ----------------
  // (Bulk EMAIL now routes through Communication → Email → Compose via the audience
  // picker preload; this text-only path is what remains of the old inline bulk send.)
  function bulkText(rows) {
    const reachable = rows.filter((r) => r.phone);
    const overlay = el("div", "modal-overlay");
    const modal = el("div", "modal");
    const title = "Text selected " + App.label("contact", "many").toLowerCase();
    modal.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="icon-btn" id="bc-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    const note = el("p", "cell-muted");
    note.textContent = `${reachable.length} of ${rows.length} selected have a phone number and will receive this.`;
    note.style.marginBottom = "10px";
    body.appendChild(note);
    const composerHost = el("div");
    body.appendChild(composerHost);
    const api = App.compose.mount(composerHost, { kind: "sms" });
    const foot = el("div", "modal-foot");
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    const send = el("button", "btn btn-primary btn-sm", "Send texts");
    foot.appendChild(cancel); foot.appendChild(send);
    modal.appendChild(body); modal.appendChild(foot); overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    modal.querySelector("#bc-close").onclick = close;
    cancel.onclick = close;
    send.onclick = async () => {
      if (!reachable.length) { App.util.toast("No reachable recipients", true); return; }
      send.disabled = true; send.textContent = "Sending…";
      let ok = 0, fail = 0;
      for (const r of reachable) {
        try {
          await App.portalApi(`/api/contacts/${r.id}/text`, { method: "POST", body: JSON.stringify({ body: api.getText ? api.getText() : api.getHTML() }) });
          ok++;
        } catch (e) { fail++; }
      }
      App.util.toast(`Sent ${ok}${fail ? `, ${fail} failed` : ""}`);
      close();
    };
  }

  // ---------------- Field input builder (shared by create + mass update) ----------------
  function fieldInput(f, value) {
    const wrap = el("div", "form-row");
    wrap.appendChild(el("label", "field-label", esc(f.label) + (f.required ? " *" : "")));
    let getValue;
    const opts = Array.isArray(f.options) ? f.options : [];
    if (f.type === "select") {
      const s = el("select", "input");
      s.appendChild(el("option", null, "— none —"));
      opts.forEach((o) => { const op = el("option", null, esc(o)); op.value = o; if (o === value) op.selected = true; s.appendChild(op); });
      wrap.appendChild(s); getValue = () => s.value || null;
    } else if (f.type === "multi_select") {
      const box = el("div", "ms-box");
      const cur = Array.isArray(value) ? value : [];
      const boxes = opts.map((o) => { const lab = el("label", "ms-opt"); const cb = el("input"); cb.type = "checkbox"; cb.value = o; if (cur.includes(o)) cb.checked = true; lab.appendChild(cb); lab.appendChild(document.createTextNode(" " + o)); box.appendChild(lab); return cb; });
      wrap.appendChild(box); getValue = () => boxes.filter((b) => b.checked).map((b) => b.value);
    } else if (f.type === "boolean") {
      const lab = el("label", "ms-opt"); const cb = el("input"); cb.type = "checkbox"; if (value === true) cb.checked = true; lab.appendChild(cb); lab.appendChild(document.createTextNode(" Yes")); wrap.appendChild(lab); getValue = () => cb.checked;
    } else {
      const inp = el("input", "input");
      inp.type = f.type === "number" || f.type === "percent" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text";
      if (value != null) inp.value = value;
      wrap.appendChild(inp); getValue = () => (inp.value.trim() === "" ? null : (inp.type === "number" ? Number(inp.value) : inp.value.trim()));
    }
    return { wrap, get: getValue, key: f.key };
  }

  // ---------------- Add contact (manual) ----------------
  async function openCreateContact() {
    const [fields, settings] = await Promise.all([
      App.portalApi("/api/fields").catch(() => []),
      App.portalApi("/api/settings").catch(() => ({})),
    ]);
    const requireEmail = settings && settings.requireEmail !== false;
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Create contact</h2><button class="icon-btn" id="cc-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    inner.appendChild(body);

    const SYS = { name: 1, phone: 1, email: 1, intent: 1 };
    const sysOrder = ["name", "phone", "email", "intent"];
    const byKey = {}; (fields || []).forEach((f) => (byKey[f.key] = f));
    const inputs = [];
    // System fields first, in a friendly order, with required flags applied.
    sysOrder.forEach((k) => {
      const f = byKey[k] || { key: k, label: k[0].toUpperCase() + k.slice(1), type: k === "intent" ? "textarea" : "text" };
      const required = k === "email" ? requireEmail : false;
      const inp = fieldInput({ ...f, required }, null);
      body.appendChild(inp.wrap); inputs.push(inp);
    });
    // Custom (non-system) fields.
    (fields || []).filter((f) => !SYS[f.key]).forEach((f) => { const inp = fieldInput(f, null); body.appendChild(inp.wrap); inputs.push(inp); });

    const foot = el("div", "modal-foot");
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    const save = el("button", "btn btn-primary btn-sm", ("Create " + App.label("contact","one").toLowerCase()));
    foot.appendChild(cancel); foot.appendChild(save);
    inner.appendChild(foot);
    const overlay = modal(inner);
    inner.querySelector("#cc-close").onclick = () => overlay.remove();
    cancel.onclick = () => overlay.remove();
    save.onclick = async () => {
      const vals = {}; inputs.forEach((i) => (vals[i.key] = i.get()));
      const payload = { name: vals.name, phone: vals.phone, email: vals.email, intent: vals.intent, customFields: {} };
      Object.keys(vals).forEach((k) => { if (!SYS[k]) payload.customFields[k] = vals[k]; });
      if (requireEmail && !payload.email) { toast("Email is required for this CRM", true); return; }
      if (!payload.email && !payload.phone) { toast("Add at least an email or a phone number", true); return; }
      save.disabled = true; save.textContent = "Creating…";
      try { await App.portalApi("/api/contacts", { method: "POST", body: JSON.stringify(payload) }); toast(App.label("contact","one") + " created"); overlay.remove(); renderContacts(); }
      catch (e) { toast(e.message, true); save.disabled = false; save.textContent = ("Create " + App.label("contact","one").toLowerCase()); }
    };
  }

  // ---------------- Mass update one field ----------------
  function openMassUpdate(ids, fields) {
    // Updatable = name, intent, and custom fields. Phone/email excluded (unique).
    const updatable = [{ key: "name", label: "Name", type: "text" }, { key: "intent", label: "Last reason", type: "textarea" }]
      .concat((fields || []).filter((f) => !f.system).map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options })));
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Update a field</h2><button class="icon-btn" id="mu-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    body.appendChild(el("p", "cell-muted", `This will update ${ids.length} selected ${App.labelFor("contact", ids.length).toLowerCase()}.`));
    const pickRow = el("div", "form-row");
    pickRow.appendChild(el("label", "field-label", "Field to change"));
    const pick = el("select", "input");
    updatable.forEach((f) => { const o = el("option", null, esc(f.label)); o.value = f.key; pick.appendChild(o); });
    pickRow.appendChild(pick); body.appendChild(pickRow);
    const valHost = el("div"); body.appendChild(valHost);
    let current = null;
    function renderVal() {
      const f = updatable.find((x) => x.key === pick.value);
      valHost.innerHTML = ""; current = fieldInput({ ...f, label: "New value" }, null); valHost.appendChild(current.wrap);
    }
    pick.onchange = renderVal; renderVal();
    inner.appendChild(body);
    const foot = el("div", "modal-foot");
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    const apply = el("button", "btn btn-primary btn-sm", "Apply to selected");
    foot.appendChild(cancel); foot.appendChild(apply); inner.appendChild(foot);
    const overlay = modal(inner);
    inner.querySelector("#mu-close").onclick = () => overlay.remove();
    cancel.onclick = () => overlay.remove();
    apply.onclick = async () => {
      const field = pick.value; const value = current.get();
      if (!(await confirmModal({ title: "Apply to all selected", message: `Set "${field}" on ${App.countLabel("contact", ids.length).toLowerCase()}? This can't be undone in bulk.`, confirmText: "Apply" }))) return;
      apply.disabled = true; apply.textContent = "Applying…";
      try { const r = await App.portalApi("/api/contacts/bulk-update", { method: "POST", body: JSON.stringify({ ids, field, value }) }); toast(`Updated ${App.countLabel("contact", r.count).toLowerCase()}`); overlay.remove(); renderContacts(); }
      catch (e) { toast(e.message, true); apply.disabled = false; apply.textContent = "Apply to selected"; }
    };
  }

  // ---------------- Merge contacts ----------------
  function openMerge(rows, fields) {
    let survivorId = rows[0].id;
    const customDefs = (fields || []).filter((f) => !f.system);
    const FIELD_DEFS = [{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "intent", label: "Last reason" }]
      .concat(customDefs.map((f) => ({ key: f.key, label: f.label })));
    const chosen = {}; // key -> value

    function valOf(c, key) { return (key === "name" || key === "email" || key === "intent") ? c[key] : (c.customFields || {})[key]; }
    function disp(v) { return Array.isArray(v) ? v.join(", ") : v == null || v === "" ? "—" : String(v); }

    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Merge ${rows.length} contacts</h2><button class="icon-btn" id="mg-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    inner.appendChild(body);

    const survWrap = el("div", "form-row");
    survWrap.appendChild(el("label", "field-label", ("Keep as the surviving " + App.label("contact","one").toLowerCase())));
    const survSel = el("select", "input");
    rows.forEach((c) => { const o = el("option", null, esc((c.name || "Unknown") + " · " + (c.phone || ""))); o.value = c.id; survSel.appendChild(o); });
    survWrap.appendChild(survSel); body.appendChild(survWrap);
    body.appendChild(el("p", "cell-muted", (`The surviving ${App.label("contact","one").toLowerCase()}'s phone number is always kept. For other fields, pick which value to keep.`)));

    const grid = el("div", "merge-grid");
    body.appendChild(grid);

    function paintGrid() {
      const survivor = rows.find((c) => c.id === survivorId);
      grid.innerHTML = "";
      // phone row (read-only, survivor wins)
      const pr = el("div", "merge-field");
      pr.innerHTML = `<div class="merge-key">Phone</div><div class="merge-vals"><span class="merge-kept">${esc(survivor.phone || "—")} (kept)</span></div>`;
      grid.appendChild(pr);
      FIELD_DEFS.forEach((fd) => {
        const values = []; const seen = new Set();
        rows.forEach((c) => { const v = valOf(c, fd.key); const d = disp(v); if (!seen.has(d)) { seen.add(d); values.push({ v, d }); } });
        // default chosen = survivor's value
        if (chosen[fd.key] === undefined) chosen[fd.key] = valOf(survivor, fd.key);
        const row = el("div", "merge-field");
        row.appendChild(el("div", "merge-key", esc(fd.label)));
        const vals = el("div", "merge-vals");
        values.forEach(({ v, d }) => {
          const lab = el("label", "merge-opt");
          const r = el("input"); r.type = "radio"; r.name = "mg-" + fd.key;
          if (disp(chosen[fd.key]) === d) r.checked = true;
          r.onchange = () => { chosen[fd.key] = v; };
          lab.appendChild(r); lab.appendChild(document.createTextNode(" " + d));
          vals.appendChild(lab);
        });
        row.appendChild(vals); grid.appendChild(row);
      });
    }
    survSel.onchange = () => { survivorId = survSel.value; Object.keys(chosen).forEach((k) => delete chosen[k]); paintGrid(); };
    paintGrid();

    const warn = el("div", "merge-warn");
    warn.innerHTML = `<strong>Before you merge:</strong> the other ${rows.length - 1} ${App.label("contact","many").toLowerCase()} will be merged into the one you keep. Their calls and activity history move to the surviving ${App.label("contact","one").toLowerCase()}, and the merged-away ${App.label("contact","many").toLowerCase()} are moved to the <strong>Recycle Bin</strong> (restorable for 30 days). The surviving ${App.label("contact","one").toLowerCase()} keeps its phone number.`;
    body.appendChild(warn);

    const foot = el("div", "modal-foot");
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    const go = el("button", "btn btn-primary btn-sm", ("Merge " + App.label("contact","many").toLowerCase()));
    foot.appendChild(cancel); foot.appendChild(go); inner.appendChild(foot);
    const overlay = modal(inner);
    inner.querySelector("#mg-close").onclick = () => overlay.remove();
    cancel.onclick = () => overlay.remove();
    go.onclick = async () => {
      const loserIds = rows.map((c) => c.id).filter((id) => id !== survivorId);
      const fieldValues = {}; Object.keys(chosen).forEach((k) => { if (k !== "phone") fieldValues[k] = chosen[k]; });
      if (!(await confirmModal({ title: "Merge contacts", message: `Merge ${App.countLabel("contact", loserIds.length).toLowerCase()} into the surviving one? This moves their history and sends them to the Recycle Bin.`, confirmText: "Merge" }))) return;
      go.disabled = true; go.textContent = "Merging…";
      try { await App.portalApi("/api/contacts/merge", { method: "POST", body: JSON.stringify({ survivorId, loserIds, fieldValues }) }); toast((App.label("contact","many") + " merged")); overlay.remove(); renderContacts(); }
      catch (e) { toast(e.message, true); go.disabled = false; go.textContent = ("Merge " + App.label("contact","many").toLowerCase()); }
    };
  }

  // ---------------- Recycle Bin ----------------
  async function renderRecycleBin() {
    loading();
    // Contacts live in their own table/endpoint; records (jobs/bookings/custom)
    // come back across ALL types from one endpoint and get split per type below.
    let delContacts, delRecords, types, resources, cFields, cCols;
    try {
      [delContacts, delRecords, types, resources, cFields, cCols] = await Promise.all([
        App.portalApi("/api/contacts/deleted"),
        App.portalApi("/api/records/deleted").catch(() => []),
        App.portalApi("/api/record-types").catch(() => []),
        App.portalApi("/api/resources").catch(() => []),
        App.portalApi("/api/fields").catch(() => []),
        App.portalApi("/api/account/contact-columns").catch(() => ({ layout: {} })),
      ]);
    } catch (e) {
      view().innerHTML = `<div class="card"><p class="cell-muted">${esc((e && e.message) || "Couldn't load the Recycle Bin.")}</p></div>`;
      return;
    }

    const resById = {}; (resources || []).forEach((r) => { resById[r.id] = r; });

    // Group deleted records by record type, keep types in their display order.
    const recsByType = {};
    (delRecords || []).forEach((r) => { (recsByType[r.recordTypeId] = recsByType[r.recordTypeId] || []).push(r); });
    const typesWithDeleted = (types || []).filter((t) => (recsByType[t.id] || []).length);

    // Each such type's fields drive its columns (same as the live list). Parallel.
    const fieldsByType = {};
    await Promise.all(typesWithDeleted.map(async (t) => {
      fieldsByType[t.id] = await App.portalApi("/api/fields?recordType=" + encodeURIComponent(t.key)).catch(() => []);
    }));

    view().innerHTML = "";
    const container = el("div", "fade-in");
    const head = el("div", "rb-head");
    head.innerHTML = `<div><h1 class="rb-title">&#128465; Recycle Bin</h1><p class="cell-muted">Deleted items are kept for 30 days, then permanently removed. They don't appear anywhere else.</p></div>`;
    const backBtn = el("a", "btn btn-ghost btn-sm", ("← Back to " + App.label("contact", "many")));
    backBtn.href = "#/contacts";
    head.appendChild(backBtn);
    container.appendChild(head);
    view().appendChild(container);

    // Show the days-left countdown beneath the primary cell (the old bin's pattern).
    const withCountdown = (columns, primaryKey, nameOf) => columns.map((c) => c.key === primaryKey
      ? { ...c, render: (r) => `${esc(nameOf(r))}<div class="rb-countdown">${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} until permanent deletion</div>` }
      : c);

    // One restorable, paginated table section (reuses App.table + the Restore
    // control). pageSize 5 paginates — nothing is hidden; Prev/Next reach it all.
    function section(title, columns, rows, restoreUrl, previewBase) {
      const sec = el("div", "rb-section");
      sec.appendChild(el("h2", "rb-section-title", `${title} (${rows.length})`));
      const tableHost = el("div");
      sec.appendChild(tableHost);
      container.appendChild(sec);

      const rc = el("span", "bulk-count", "");
      let handle;
      handle = App.table.mount({
        container: tableHost, columns, rows, selectable: true, rowId: (r) => r.id, pageSize: 5,
        onRowClick: (r) => App.go(previewBase + r.id), // read-only preview, stays in the bin
        onSelectionChange: (ids) => { rc.textContent = ids.length ? `${ids.length} selected` : ""; },
        emptyHtml: `<div class="empty"><div class="empty-emoji">&#128465;</div><h3>Nothing here</h3><p>These will appear here for 30 days after deletion.</p></div>`,
      });
      const restoreBtn = el("button", "btn btn-primary btn-sm", "Restore selected");
      restoreBtn.onclick = async () => {
        const ids = handle.getSelected();
        if (!ids.length) { App.util.toast("Select something to restore first.", true); return; }
        try { await App.portalApi(restoreUrl, { method: "POST", body: JSON.stringify({ ids }) }); App.util.toast("Restored"); renderRecycleBin(); }
        catch (e) { App.util.toast((e && e.message) || "Restore failed", true); }
      };
      if (handle.toolbarLeft) { handle.toolbarLeft.appendChild(restoreBtn); handle.toolbarLeft.appendChild(rc); }
    }

    // Contacts table.
    const contactCols = withCountdown(applyColumnLayout(contactColumnDefs(cFields), (cCols && cCols.layout) || {}).slice(), "name", (r) => r.name || "Unknown");
    section(App.label("contact", "many"), contactCols, delContacts || [], "/api/contacts/restore", "#/recycle/contact/");

    // One table per record type that has deleted items (Jobs, Bookings, custom…).
    typesWithDeleted.forEach((t) => {
      const base = recordColumnDefs(fieldsByType[t.id] || [], t, resById);
      const cols = withCountdown(applyRecordLayout(base, loadRecordLayout(t.key)).slice(), "title", (r) => r.title || "Untitled");
      section(t.labelPlural || t.label, cols, recsByType[t.id] || [], "/api/records/restore", "#/recycle/record/");
    });

    // Truly-empty state (no deleted contacts AND no deleted records of any type).
    if (!(delContacts || []).length && !(delRecords || []).length) {
      const empty = el("div", "card");
      empty.innerHTML = `<div class="empty"><div class="empty-emoji">&#128465;</div><h3>Recycle Bin is empty</h3><p>Deleted items will appear here for 30 days.</p></div>`;
      container.appendChild(empty);
    }
  }

  // ---------------- Recycle Bin: read-only preview ----------------
  // The preview REUSES the real detail renderers (renderContact / renderRecord)
  // in read-only mode (opts.preview), so a deleted item mirrors its real page and
  // stays in sync if that page changes. This dispatcher just routes by kind.
  function renderRecycledPreview(kind, id) {
    if (kind === "contact") return renderContact(id, { preview: true });
    return renderRecord(id, { preview: true });
  }

  // Preview chrome shared by both renderers: the read-only badge, the
  // "Moved to Recycle Bin on [date] by [user]" note (date-only when deletedBy is
  // null — pre-Batch-A items), and the Restore action.
  function recyclePreviewChrome(kind, data, id) {
    const box = el("div", "rb-preview-chrome");
    box.appendChild(el("span", "rb-readonly-badge", "Read-only preview"));
    const when = data.deletedAt ? new Date(data.deletedAt).toLocaleString() : null;
    const who = data.deletedBy ? (" by " + data.deletedBy) : "";
    let left = "";
    if (data.deletedAt) {
      const dleft = Math.max(0, Math.ceil((new Date(data.deletedAt).getTime() + 30 * 86400000 - Date.now()) / 86400000));
      left = ` · ${dleft} day${dleft === 1 ? "" : "s"} until permanent deletion`;
    }
    const note = el("p", "rb-preview-note cell-muted");
    note.textContent = (when ? `Moved to Recycle Bin on ${when}${who}.` : "In the Recycle Bin.") + left;
    box.appendChild(note);
    const restoreBtn = el("button", "btn btn-primary btn-sm", "Restore");
    restoreBtn.onclick = async () => {
      restoreBtn.disabled = true;
      const url = kind === "contact" ? "/api/contacts/restore" : "/api/records/restore";
      try { await App.portalApi(url, { method: "POST", body: JSON.stringify({ ids: [id] }) }); App.util.toast("Restored"); App.go("#/recycle"); }
      catch (e) { restoreBtn.disabled = false; App.util.toast((e && e.message) || "Restore failed", true); }
    };
    box.appendChild(restoreBtn);
    return box;
  }

  // Shown when a previewed item is no longer in the bin (restored or purged).
  function recycleMissing() {
    view().innerHTML = "";
    const card = el("div", "card rb-preview");
    const back = el("a", "btn btn-ghost btn-sm", "← Back to Recycle Bin");
    back.href = "#/recycle";
    card.appendChild(back);
    const p = el("p", "cell-muted");
    p.style.marginTop = "12px";
    p.textContent = "This item is no longer in the Recycle Bin — it may have been restored or permanently removed.";
    card.appendChild(p);
    view().appendChild(card);
  }

  // ---------------- Saved filters dropdown ----------------
  async function mountSavedFilters(handle, viewName) {
    const dd = el("div", "saved-wrap");
    const btn = el("button", "btn btn-ghost btn-sm", "Saved Filters &#9662;");
    const menu = el("div", "saved-menu hidden");
    dd.appendChild(btn);
    dd.appendChild(menu);
    handle.toolbarLeft.appendChild(dd);

    let list = [];
    async function load() {
      try { list = await App.portalApi(`/api/saved-filters?view=${encodeURIComponent(viewName)}`); }
      catch (e) { list = []; }
      paint();
    }
    function paint() {
      menu.innerHTML = "";
      if (!list.length) menu.appendChild(el("div", "saved-empty", "No saved filters yet"));
      list.forEach((f) => {
        const row = el("div", "saved-item");
        const name = el("button", "saved-name", esc(f.name));
        name.onclick = () => { handle.applyState(f.definition); menu.classList.add("hidden"); App.util.toast(`Applied “${f.name}”`); };
        const del = el("button", "saved-del", "&times;");
        del.title = "Delete";
        del.onclick = async (e) => { e.stopPropagation(); if (!(await confirmModal({ title: "Delete filter", message: `Delete saved filter “${f.name}”?`, confirmText: "Delete" }))) return; try { await App.portalApi(`/api/saved-filters/${f.id}`, { method: "DELETE" }); App.util.toast("Filter deleted"); load(); } catch (err) { App.util.toast(err.message, true); } };
        row.appendChild(name);
        row.appendChild(del);
        menu.appendChild(row);
      });
      menu.appendChild(el("div", "pop-sep"));
      const save = el("button", "saved-save", "+ Save current filter…");
      save.onclick = async () => {
        const def = handle.getState();
        if (!def.rules.length && !Object.keys(def.colFilters).length && !def.search) { App.util.toast("Set some filters first", true); return; }
        const name = await promptModal({ title: "Save filter", label: "Name this filter", okText: "Save" });
        if (!name || !name.trim()) return;
        try { await App.portalApi("/api/saved-filters", { method: "POST", body: JSON.stringify({ name: name.trim(), view: viewName, definition: def }) }); App.util.toast("Filter saved"); load(); }
        catch (err) { App.util.toast(err.message, true); }
      };
      menu.appendChild(save);
    }
    btn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle("hidden"); if (!menu.classList.contains("hidden")) setTimeout(() => document.addEventListener("click", close, { once: true }), 0); };
    function close() { menu.classList.add("hidden"); }
    menu.addEventListener("click", (e) => e.stopPropagation());
    load();
  }

  // ---------------- Export contacts ----------------
  function csvCell(v) {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCSV(filename, text) {
    downloadBlob(filename, new Blob([text], { type: "text/csv;charset=utf-8;" }));
  }
  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  // Shared CSV builder + one-call download, reused by the contacts export below
  // AND the feedback ticket export, so the CSV format stays identical everywhere.
  // columns: [{ label, get(row) | text(row) }] — same shape the table uses.
  function buildCSV(cols, rows) {
    const header = cols.map((c) => csvCell(c.label)).join(",");
    const lines = rows.map((row) => cols.map((c) => csvCell(c.text ? c.text(row) : c.get(row))).join(","));
    return [header, ...lines].join("\n");
  }
  App.exportCSV = function (filename, cols, rows) {
    const base = String(filename || "export").replace(/[^a-z0-9]+/gi, "-");
    downloadCSV(`${base}.csv`, buildCSV(cols, rows));
  };

  // Read a CSV or Excel file into an array of row-arrays of strings.
  function readFileRows(file, cb) {
    const name = (file.name || "").toLowerCase();
    const reader = new FileReader();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      if (typeof XLSX === "undefined") { App.util.toast("Excel support needs an internet connection — try a CSV", true); return; }
      reader.onload = () => {
        try {
          const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
          cb(aoa.map((r) => r.map((c) => (c == null ? "" : String(c)))).filter((r) => r.some((c) => c.trim() !== "")));
        } catch (e) { App.util.toast("Couldn't read that Excel file", true); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => cb(parseCSV(String(reader.result)));
      reader.readAsText(file);
    }
  }

  // Descriptor-driven export modal, shared by Contacts and Feedback (no fork).
  // opts: { title, columns, rows, savedFilters, savedFilterView, namePlaceholder,
  //         countText(n), unitPlural, sheetName, filterLabel, saveHistory }
  async function openExport(opts) {
    const columns = opts.columns;
    const rows = opts.rows;
    const exportable = columns.filter((c) => c.key);
    const exState = { rules: [], search: "" };
    const selected = new Set(exportable.filter((c) => !c.defaultOff).map((c) => c.key)); // all on by default, except defaultOff fields
    const showHistory = opts.saveHistory !== false;
    const historyApi = opts.historyApi || App.portalApi;   // App.api for master/admin scope
    const historyBase = opts.historyBase || "/api/exports"; // "/api/admin/exports" for master
    const dataType = opts.dataType || null; // type-scopes the history list + tags the saved row

    const savedBlock = opts.savedFilters
      ? `<label class="field-label">Start from a saved filter (optional)</label>
        <select id="ex-saved" class="input"><option value="">— none —</option></select>`
      : "";
    const historyBlock = showHistory
      ? `<div class="ex-history-head">Previous exports</div>
        <div id="ex-history" class="ex-history"><div class="cell-muted">Loading…</div></div>`
      : "";

    const inline = !!opts.inline;
    const root = inline ? opts.container : el("div");
    const exHead = inline ? "" : `<div class="modal-head"><h2>${esc(opts.title || "Export")}</h2><button class="icon-btn" id="ex-close">&times;</button></div>`;
    root.innerHTML = exHead + `
      <div class="${inline ? "ex-inline-body" : "modal-body"}">
        <label class="field-label">Export name *</label>
        <input id="ex-name" class="input" placeholder="${esc(opts.namePlaceholder || "")}" />
        ${savedBlock}
        <label class="field-label">${esc(opts.filterLabel || "Who to export")}</label>
        <div id="ex-rules"></div>
        <label class="field-label" style="margin-top:14px">Fields to include</label>
        <div id="ex-fields" class="ex-fields"></div>
        <p class="cell-muted" id="ex-count"></p>
        <label class="field-label">Format</label>
        <select id="ex-format" class="input"><option value="csv">CSV (.csv)</option><option value="xlsx">Excel (.xlsx)</option></select>
        <button id="ex-go" class="btn btn-primary btn-block">Export</button>
        ${opts.note ? `<p class="cell-muted" style="font-size:12px;margin:8px 0 0">${esc(opts.note)}</p>` : ""}
        ${historyBlock}
      </div>`;
    if (!inline) {
      const overlay = modal(root);
      root.querySelector("#ex-close").onclick = () => overlay.remove();
    }

    // saved filters dropdown to prefill criteria (contacts only)
    if (opts.savedFilters) {
      try {
        const saved = await App.portalApi(`/api/saved-filters?view=${encodeURIComponent(opts.savedFilterView || "contacts")}`);
        const sel = root.querySelector("#ex-saved");
        saved.forEach((f) => { const o = el("option", null, esc(f.name)); o.value = f.id; sel.appendChild(o); });
        sel.onchange = () => {
          const f = saved.find((x) => x.id === sel.value);
          exState.rules = f && f.definition && f.definition.rules ? f.definition.rules.map((r) => ({ ...r })) : [];
          exState.search = (f && f.definition && f.definition.search) || "";
          rulesHost.innerHTML = "";
          rulesHost.appendChild(App.table.ruleEditor(exportable, rows, exState.rules, updateCount));
          updateCount();
        };
      } catch (e) {}
    }

    const rulesHost = root.querySelector("#ex-rules");
    rulesHost.appendChild(App.table.ruleEditor(exportable, rows, exState.rules, () => updateCount()));

    const fieldsHost = root.querySelector("#ex-fields");
    exportable.forEach((c) => {
      const id = "exf-" + c.key;
      const lab = el("label", "ex-field");
      lab.innerHTML = `<input type="checkbox" id="${id}" ${c.defaultOff ? "" : "checked"} /> <span>${esc(c.label)}</span>`;
      lab.querySelector("input").onchange = (e) => { if (e.target.checked) selected.add(c.key); else selected.delete(c.key); };
      fieldsHost.appendChild(lab);
    });

    function matching() { return App.table.pipeline(rows, exportable, exState); }
    function updateCount() {
      const n = matching().length;
      root.querySelector("#ex-count").textContent = `${n} of ${opts.countText(rows.length)} match.`;
    }
    updateCount();

    async function loadHistory() {
      if (!showHistory) return;
      const host = root.querySelector("#ex-history");
      try {
        const list = await historyApi(historyBase + "?kind=export" + (dataType ? "&dataType=" + encodeURIComponent(dataType) : ""));
        host.innerHTML = "";
        if (!list.length) { host.appendChild(el("div", "cell-muted", "No exports yet.")); return; }
        list.forEach((ex) => {
          const row = el("div", "ex-hist-row");
          row.innerHTML = `<div class="ex-hist-main"><div class="ex-hist-name">${esc(ex.name)}</div>
            <div class="ex-hist-meta">${ex.rowCount} ${esc(opts.unitPlural.toLowerCase())} · ${fmtDate(ex.createdAt)}</div></div>`;
          const dl = el("button", "btn btn-ghost btn-sm", "Download");
          dl.onclick = async () => {
            try { const r = await historyApi(`${historyBase}/${ex.id}/download`); downloadCSV(`${(r.name || "export").replace(/[^a-z0-9]+/gi, "-")}.csv`, r.csv); }
            catch (err) { App.util.toast(err.message, true); }
          };
          row.appendChild(dl);
          host.appendChild(row);
        });
      } catch (err) { host.innerHTML = `<div class="cell-muted">${esc(err.message)}</div>`; }
    }
    loadHistory();

    root.querySelector("#ex-go").onclick = async () => {
      const name = root.querySelector("#ex-name").value.trim();
      if (!name) { App.util.toast("Please give this export a name", true); root.querySelector("#ex-name").focus(); return; }
      const cols = exportable.filter((c) => selected.has(c.key));
      if (!cols.length) { App.util.toast("Pick at least one field", true); return; }
      const out = matching();
      if (!out.length) { App.util.toast(("No " + opts.unitPlural.toLowerCase() + " match"), true); return; }
      const csv = buildCSV(cols, out);
      const fileBase = name.replace(/[^a-z0-9]+/gi, "-");
      const format = root.querySelector("#ex-format").value;
      if (format === "xlsx") {
        if (typeof XLSX === "undefined") { App.util.toast("Excel needs internet — exporting CSV instead", true); downloadCSV(`${fileBase}.csv`, csv); }
        else {
          const aoa = [cols.map((c) => c.label), ...out.map((row) => cols.map((c) => (c.text ? c.text(row) : c.get(row)) ?? ""))];
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, opts.sheetName || "Export");
          const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
          downloadBlob(`${fileBase}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        }
      } else {
        downloadCSV(`${fileBase}.csv`, csv);
      }
      if (opts.saveHistory === false) { App.util.toast(`Exported ${opts.countText(out.length)}`); return; }
      try {
        await historyApi(historyBase, { method: "POST", body: JSON.stringify({ name, rowCount: out.length, fields: cols.map((c) => c.label), csv, scope: opts.scope, dataType }) });
        App.util.toast(`Exported ${opts.countText(out.length)}`);
        loadHistory();
      } catch (err) { App.util.toast("Downloaded, but couldn't save to history: " + err.message, true); }
    };
  }
  // Open the shared export modal from anywhere (e.g. feedback.js).
  App.exportModal = openExport;

  // Per-type "Previous imports" list, mirroring the export modal's history. Read-only
  // (imports have nothing to download). Scoped to ONE dataType so each import modal
  // shows only its own type's imports.
  async function renderImportHistory(host, dataType) {
    if (!host) return;
    host.innerHTML = `<div class="cell-muted">Loading…</div>`;
    try {
      const list = await App.portalApi("/api/exports?kind=import" + (dataType ? "&dataType=" + encodeURIComponent(dataType) : ""));
      host.innerHTML = "";
      if (!list.length) { host.appendChild(el("div", "cell-muted", "No imports yet.")); return; }
      list.forEach((im) => {
        const ok = im.okCount != null ? im.okCount : im.rowCount;
        const fail = im.failCount != null ? im.failCount : 0;
        const row = el("div", "ex-hist-row");
        row.innerHTML = `<div class="ex-hist-main"><div class="ex-hist-name">${esc(im.name)}</div>
          <div class="ex-hist-meta">imported ${ok}${fail ? ", skipped " + fail : ""} &middot; ${fmtDate(im.createdAt)}</div></div>`;
        host.appendChild(row);
      });
    } catch (err) { host.innerHTML = `<div class="cell-muted">${esc(err.message)}</div>`; }
  }

  // Contacts descriptor — reproduces the previous contacts-export behavior exactly.
  function contactExportOpts(columns, rows) {
    return {
      title: "Export contacts",
      columns, rows,
      dataType: "contact",
      savedFilters: true,
      savedFilterView: "contacts",
      namePlaceholder: "e.g. June leads — HVAC",
      filterLabel: "Who to export",
      unitPlural: App.label("contact", "many"),
      sheetName: App.label("contact", "many"),
      countText: (n) => App.countLabel("contact", n).toLowerCase(),
      saveHistory: true,
    };
  }

  function emptyCalls() {
    const e = el("div", "card");
    e.innerHTML = `<div class="empty"><div class="empty-emoji">&#128222;</div><h3>No calls yet</h3>
      <p>Use the &ldquo;Simulate call&rdquo; button above to generate a sample lead, or take a real call.</p></div>`;
    return e;
  }

  // ---------------- Fields tab ----------------
  // When Fields is hosted inside Settings → Fields, renders AND the many internal
  // renderFields(true) refreshes must target the settings panel, not the main #view.
  // Stored once (set by secFields) and reused on every refresh; null = standalone.
  let fieldsMount = null;
  function fieldsView() { return fieldsMount || view(); }
  async function renderFields(refresh, mountEl) {
    if (mountEl) fieldsMount = mountEl; // set on first mount; persists across refresh(true)
    if (!refresh && !fieldsMount) loading(); // on refresh we hold the current view until the rebuilt one is ready — no blink
    const types = await App.portalApi("/api/record-types");
    if (!App.state.fieldsType || !types.some((t) => t.key === App.state.fieldsType)) App.state.fieldsType = "contact";
    const selectedKey = App.state.fieldsType;
    const selectedType = types.find((t) => t.key === selectedKey) || types[0];
    const [fields, sections] = await Promise.all([
      App.portalApi("/api/fields?recordType=" + encodeURIComponent(selectedKey)),
      App.portalApi("/api/field-sections?recordType=" + encodeURIComponent(selectedKey)).catch(() => []),
    ]);
    const canEdit = App.state.me.role !== "CLIENT_USER";
    const wrap = el("div", refresh ? "" : "fade-in"); // don't replay the fade-in animation on in-place refreshes

    // Object-type selector ("Editing fields for: [Contacts | Jobs]").
    const typeBar = el("div", "fields-typebar");
    typeBar.appendChild(el("span", "fields-typebar-label", "Editing fields for:"));
    const typeSel = el("select", "input fields-typebar-select");
    types.forEach((t) => {
      const o = el("option", null, esc(t.labelPlural || t.label));
      o.value = t.key;
      if (t.key === selectedKey) o.selected = true;
      typeSel.appendChild(o);
    });
    typeSel.onchange = () => { App.state.fieldsType = typeSel.value; renderFields(true); };
    typeBar.appendChild(typeSel);
    wrap.appendChild(typeBar);

    const bar = el("div", "page-actions");
    if (canEdit) {
      const add = el("button", "btn btn-primary btn-sm", "+ Add field");
      add.onclick = () => openFieldModal(null, selectedKey);
      bar.appendChild(add);
      const addSec = el("button", "btn btn-ghost btn-sm", "+ Add section");
      addSec.onclick = async () => {
        const name = await promptModal({ title: "Add a section", label: "Section name", placeholder: "e.g. Contact details, Pipeline", okText: "Add" });
        if (!name || !name.trim()) return;
        try { await App.portalApi("/api/field-sections", { method: "POST", body: JSON.stringify({ recordType: selectedKey, label: name.trim() }) }); App.util.toast("Section added"); renderFields(true); }
        catch (e) { App.util.toast(e.message, true); }
      };
      bar.appendChild(addSec);
    }
    wrap.appendChild(bar);

    const typeWord = (selectedType && (selectedType.label || "").toLowerCase()) || App.label("record","one").toLowerCase();
    const intro = el("p", "muted");
    intro.style.margin = "0 0 14px";
    intro.textContent = canEdit
      ? `These fields appear on every ${typeWord} in this portal. Add sections to group them; drag fields to reorder within a section; use “Move to” to reassign a field. Order and grouping are how they show on a ${typeWord}'s profile — field keys and saved data never change.`
      : `These are the fields on every ${typeWord} in this portal. Ask an admin to change them.`;
    wrap.appendChild(intro);

    if (!fields.length) {
      const card = el("div", "card");
      card.appendChild(el("div", "cell-muted", "No fields yet for this type. Click “+ Add field” to create one."));
      wrap.appendChild(card);
      if (canEdit && selectedType && selectedType.key !== "contact") { wrap.appendChild(subtypesCard()); wrap.appendChild(statusesCard()); }
      fieldsView().innerHTML = ""; fieldsView().appendChild(wrap); return;
    }

    const sorted = sections.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const bySection = {}; sorted.forEach((s) => (bySection[s.id] = []));
    const ungrouped = [];
    fields.forEach((f) => { if (f.sectionId && bySection[f.sectionId]) bySection[f.sectionId].push(f); else ungrouped.push(f); });
    const sortByOrder = (arr) => arr.slice().sort((a, b) => (a.order || 0) - (b.order || 0));

    // Make a section's field list a drop target: a field dragged from any section
    // (or Ungrouped) can be dropped here, which reassigns its section (display-only)
    // and persists order within this section. Works for locked/system fields too.
    function attachDropList(sectionId) {
      const list = el("div", "field-list");
      list.dataset.section = sectionId || "";
      if (!canEdit) return list;
      list.addEventListener("dragover", (e) => {
        const dragging = document.querySelector(".field-row.dragging");
        if (!dragging) return;
        e.preventDefault();
        const rows = Array.prototype.slice.call(list.querySelectorAll(".field-row:not(.dragging)"));
        let ref = null;
        for (let i = 0; i < rows.length; i++) { const rect = rows[i].getBoundingClientRect(); if (e.clientY < rect.top + rect.height / 2) { ref = rows[i]; break; } }
        if (ref) list.insertBefore(dragging, ref); else list.appendChild(dragging);
      });
      list.addEventListener("drop", async (e) => {
        const dragging = document.querySelector(".field-row.dragging");
        if (!dragging) return;
        e.preventDefault();
        fieldDropHandled = true;
        const fieldId = dragging.dataset.id;
        const targetSection = list.dataset.section || "";
        const orderedIds = Array.prototype.slice.call(list.querySelectorAll(".field-row")).map((r) => r.dataset.id);
        try {
          await App.portalApi("/api/fields/" + fieldId + "/section", { method: "PATCH", body: JSON.stringify({ sectionId: targetSection || null }) });
          await App.portalApi("/api/fields/reorder", { method: "PATCH", body: JSON.stringify({ orderedIds, recordType: selectedKey }) });
          App.util.toast("Field moved");
          renderFields(true);
        } catch (err) { App.util.toast(err.message, true); renderFields(true); }
      });
      return list;
    }

    async function moveSection(idx, dir) {
      const ids = sorted.map((s) => s.id);
      const j = idx + dir; if (j < 0 || j >= ids.length) return;
      const tmp = ids[idx]; ids[idx] = ids[j]; ids[j] = tmp;
      try { await App.portalApi("/api/field-sections/reorder", { method: "PATCH", body: JSON.stringify({ orderedIds: ids }) }); renderFields(true); }
      catch (e) { App.util.toast(e.message, true); }
    }

    function sectionCard(section, groupFields, idx) {
      const card = el("div", "fields-section-card");
      const head = el("div", "fields-section-head");
      head.appendChild(el("div", "fields-section-name", esc(section.label)));
      if (canEdit) {
        const tools = el("div", "fields-section-tools");
        const up = el("button", "btn btn-ghost btn-sm", "↑"); up.title = "Move section up"; up.disabled = idx === 0; up.onclick = () => moveSection(idx, -1);
        const down = el("button", "btn btn-ghost btn-sm", "↓"); down.title = "Move section down"; down.disabled = idx === sorted.length - 1; down.onclick = () => moveSection(idx, 1);
        const ren = el("button", "btn btn-ghost btn-sm", "Rename");
        ren.onclick = async () => { const name = await promptModal({ title: "Rename section", label: "Section name", value: section.label, okText: "Rename" }); if (!name || !name.trim()) return; try { await App.portalApi("/api/field-sections/" + section.id, { method: "PATCH", body: JSON.stringify({ label: name.trim() }) }); App.util.toast("Renamed"); renderFields(true); } catch (e) { App.util.toast(e.message, true); } };
        const del = el("button", "link-danger", "Delete");
        del.onclick = async () => { if (!(await confirmModal({ title: "Delete section", message: `Delete section “${section.label}”? Its fields move to Ungrouped — no fields are deleted.`, confirmText: "Delete section" }))) return; try { await App.portalApi("/api/field-sections/" + section.id, { method: "DELETE" }); App.util.toast("Section deleted"); renderFields(true); } catch (e) { App.util.toast(e.message, true); } };
        tools.appendChild(up); tools.appendChild(down); tools.appendChild(ren); tools.appendChild(del);
        head.appendChild(tools);
      }
      card.appendChild(head);
      const list = attachDropList(section.id);
      if (!groupFields.length) list.appendChild(el("div", "cell-muted", "No fields here yet — drag a field in, or use “Move to”."));
      sortByOrder(groupFields).forEach((f) => list.appendChild(fieldRow(f, canEdit, fields, selectedKey, sorted, f.sectionId || "")));
      card.appendChild(list);
      return card;
    }

    function ungroupedCard(groupFields) {
      const card = el("div", "fields-section-card");
      const head = el("div", "fields-section-head");
      head.appendChild(el("div", "fields-section-name", sorted.length ? "Ungrouped" : "All fields"));
      card.appendChild(head);
      const list = attachDropList("");
      sortByOrder(groupFields).forEach((f) => list.appendChild(fieldRow(f, canEdit, fields, selectedKey, sorted, "")));
      card.appendChild(list);
      return card;
    }

    // Pipeline-stage management for this record type (e.g. Jobs). Reuses the
    // object-type selector above. Labels are editable; keys stay stable so
    // existing candidate links never detach. Shown for non-contact types only.
    // Central management of this record type's job types and each one's pipeline.
    // Two levels: job types (add/rename/reorder/delete, delete blocked while jobs
    // use it), and the stages inside each type (delete blocked while candidates
    // occupy it). All edits are label/order only — keys stay stable.
    function subtypesCard() {
      const card = el("div", "fields-section-card");
      const head = el("div", "fields-section-head");
      head.appendChild(el("div", "fields-section-name", (esc((selectedType && selectedType.label) || App.label("job","one")) + " types & pipelines")));
      const addBtn = el("button", "btn btn-ghost btn-sm", ("+ Add " + (((selectedType && selectedType.label) || App.label("job","one")).toLowerCase()) + " type"));
      addBtn.onclick = async () => {
        const name = await promptModal({ title: "Add a type", label: "Name this " + (((selectedType && selectedType.label) || App.label("job","one")).toLowerCase()) + " type", placeholder: "e.g. Technical, Field, Sales", okText: "Add" });
        if (!name || !name.trim()) return;
        try { await App.portalApi("/api/record-subtypes/add", { method: "POST", body: JSON.stringify({ recordType: selectedKey, label: name.trim() }) }); App.util.toast((((selectedType && selectedType.label) || App.label("job","one"))) + " type added"); renderFields(true); }
        catch (e) { App.util.toast(e.message, true); }
      };
      head.appendChild(addBtn);
      card.appendChild(head);
      const note = el("p", "muted");
      note.style.cssText = "margin:2px 0 12px; font-size:13px;";
      note.textContent = `Each ${(((selectedType && selectedType.label) || App.label("job","one")).toLowerCase())} type has its own pipeline. A ${(((selectedType && selectedType.label) || App.label("job","one")).toLowerCase())}'s Type chooses which pipeline its ${App.label("contact","many").toLowerCase()} move through. Renaming changes labels only; a type with ${(((selectedType && selectedType.labelPlural) || App.label("job","many")).toLowerCase())} (or a ${App.label("stage","one").toLowerCase()} with ${App.label("contact","many").toLowerCase()}) can't be deleted until those are moved.`;
      card.appendChild(note);

      const subtypes = (((selectedType && selectedType.subtypes) || []).slice()).sort((a, b) => (a.order || 0) - (b.order || 0));
      if (!subtypes.length) card.appendChild(el("div", "cell-muted", ("No " + (((selectedType && selectedType.label) || App.label("job","one")).toLowerCase()) + " types yet — click “+ Add " + (((selectedType && selectedType.label) || App.label("job","one")).toLowerCase()) + " type”.")));

      subtypes.forEach((st, sIdx) => {
        const block = el("div", "subtype-block");
        const bhead = el("div", "fields-section-head");
        bhead.appendChild(el("div", "fields-section-name", esc(st.label)));
        const btools = el("div", "fields-section-tools");
        const sup = el("button", "btn btn-ghost btn-sm", "↑"); sup.title = "Move type up"; sup.disabled = sIdx === 0;
        const sdown = el("button", "btn btn-ghost btn-sm", "↓"); sdown.title = "Move type down"; sdown.disabled = sIdx === subtypes.length - 1;
        const reorderType = async (from, to) => {
          const keys = subtypes.map((x) => x.key); const m = keys.splice(from, 1)[0]; keys.splice(to, 0, m);
          try { await App.portalApi("/api/record-subtypes/reorder", { method: "POST", body: JSON.stringify({ recordType: selectedKey, orderedKeys: keys }) }); renderFields(true); }
          catch (e) { App.util.toast(e.message, true); }
        };
        sup.onclick = () => reorderType(sIdx, sIdx - 1);
        sdown.onclick = () => reorderType(sIdx, sIdx + 1);
        const sren = el("button", "btn btn-ghost btn-sm", "Rename");
        sren.onclick = async () => {
          const name = await promptModal({ title: "Rename type", label: "Type name", value: st.label, okText: "Rename" }); if (!name || !name.trim()) return;
          try { await App.portalApi("/api/record-subtypes/rename", { method: "POST", body: JSON.stringify({ recordType: selectedKey, key: st.key, label: name.trim() }) }); App.util.toast("Renamed"); renderFields(true); }
          catch (e) { App.util.toast(e.message, true); }
        };
        const saddStage = el("button", "btn btn-ghost btn-sm", ("+ Add " + App.label("stage","one").toLowerCase()));
        saddStage.onclick = async () => {
          const name = await promptModal({ title: "Add a " + App.label("stage","one").toLowerCase(), label: "Add to “" + st.label + "”", okText: "Add" }); if (!name || !name.trim()) return;
          try { await App.portalApi("/api/record-stages/add", { method: "POST", body: JSON.stringify({ recordType: selectedKey, subtypeKey: st.key, label: name.trim() }) }); App.util.toast(App.label("stage","one") + " added"); renderFields(true); }
          catch (e) { App.util.toast(e.message, true); }
        };
        const sdel = el("button", "link-danger", "Delete type");
        sdel.onclick = async () => {
          if (!(await confirmModal({ title: "Delete type", message: `Delete ${(((selectedType && selectedType.label) || App.label("job","one")).toLowerCase())} type “${st.label}”? Its pipeline is removed too.`, confirmText: "Delete type" }))) return;
          try { await App.portalApi("/api/record-subtypes/delete", { method: "POST", body: JSON.stringify({ recordType: selectedKey, key: st.key }) }); App.util.toast((((selectedType && selectedType.label) || App.label("job","one"))) + " type deleted"); renderFields(true); }
          catch (e) { App.util.toast(e.message, true); } // blocked while jobs use it
        };
        btools.appendChild(saddStage); btools.appendChild(sup); btools.appendChild(sdown); btools.appendChild(sren); btools.appendChild(sdel);
        bhead.appendChild(btools);
        block.appendChild(bhead);

        const stages = (st.stages || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        const list = el("div", "stage-list");
        if (!stages.length) list.appendChild(el("div", "cell-muted", ("No " + App.label("stage","many").toLowerCase() + " yet — click “+ Add " + App.label("stage","one").toLowerCase() + "”.")));
        stages.forEach((s, idx) => {
          const row = el("div", "stage-row");
          row.appendChild(el("div", "stage-name", esc(s.label)));
          const tools = el("div", "fields-section-tools");
          const up = el("button", "btn btn-ghost btn-sm", "↑"); up.title = "Move up"; up.disabled = idx === 0;
          const down = el("button", "btn btn-ghost btn-sm", "↓"); down.title = "Move down"; down.disabled = idx === stages.length - 1;
          const reorder = async (from, to) => {
            const keys = stages.map((x) => x.key); const m = keys.splice(from, 1)[0]; keys.splice(to, 0, m);
            try { await App.portalApi("/api/record-stages/reorder", { method: "POST", body: JSON.stringify({ recordType: selectedKey, subtypeKey: st.key, orderedKeys: keys }) }); renderFields(true); }
            catch (e) { App.util.toast(e.message, true); }
          };
          up.onclick = () => reorder(idx, idx - 1);
          down.onclick = () => reorder(idx, idx + 1);
          const ren = el("button", "btn btn-ghost btn-sm", "Rename");
          ren.onclick = async () => {
            const name = await promptModal({ title: "Rename " + App.label("stage","one").toLowerCase(), label: App.label("stage","one") + " name", value: s.label, okText: "Rename" }); if (!name || !name.trim()) return;
            try { await App.portalApi("/api/record-stages/rename", { method: "POST", body: JSON.stringify({ recordType: selectedKey, subtypeKey: st.key, key: s.key, label: name.trim() }) }); App.util.toast("Renamed"); renderFields(true); }
            catch (e) { App.util.toast(e.message, true); }
          };
          const del = el("button", "link-danger", "Delete");
          del.onclick = async () => {
            if (!(await confirmModal({ title: "Delete stage", message: `Delete ${App.label("stage","one").toLowerCase()} “${s.label}”?`, confirmText: "Delete" }))) return;
            try { await App.portalApi("/api/record-stages/delete", { method: "POST", body: JSON.stringify({ recordType: selectedKey, subtypeKey: st.key, key: s.key }) }); App.util.toast(App.label("stage","one") + " deleted"); renderFields(true); }
            catch (e) { App.util.toast(e.message, true); } // blocked while candidates occupy it
          };
          tools.appendChild(up); tools.appendChild(down); tools.appendChild(ren); tools.appendChild(del);
          row.appendChild(tools);
          list.appendChild(row);
        });
        block.appendChild(list);
        card.appendChild(block);
      });
      return card;
    }

    // Record-level STATUS editor (RecordType.recordStages) — the Status dropdown
    // on a record's own profile. Mirrors the pipeline editor's look. Keys are
    // immutable; rename = label only; reorder = cosmetic. Delete is guarded
    // server-side and, when blocked, opens statusBlockedModal with the list.
    function statusesCard() {
      const typeLabel = (selectedType && selectedType.label) || App.label("record","one");
      const card = el("div", "fields-section-card");
      const head = el("div", "fields-section-head");
      head.appendChild(el("div", "fields-section-name", "Statuses"));
      const addBtn = el("button", "btn btn-ghost btn-sm", "+ Add status");
      addBtn.onclick = async () => {
        const name = await promptModal({ title: "Add a status", label: "New status for " + typeLabel, placeholder: "e.g. On hold", okText: "Add" });
        if (!name || !name.trim()) return;
        try { await App.portalApi("/api/record-statuses/add", { method: "POST", body: JSON.stringify({ recordType: selectedKey, label: name.trim() }) }); App.util.toast("Status added"); renderFields(true); }
        catch (e) { App.util.toast(e.message, true); }
      };
      head.appendChild(addBtn);
      card.appendChild(head);
      const note = el("p", "muted");
      note.style.cssText = "margin:2px 0 12px; font-size:13px;";
      note.textContent = "These are the Status options on a " + typeLabel.toLowerCase() + "’s profile. Renaming changes the label only — the underlying key never changes. A status that records use, or that an automation references, can’t be deleted until those are changed.";
      card.appendChild(note);

      const statuses = (((selectedType && selectedType.recordStages) || []).slice()).sort((a, b) => (a.order || 0) - (b.order || 0));
      const list = el("div", "stage-list");
      if (!statuses.length) list.appendChild(el("div", "cell-muted", "No statuses yet — click “+ Add status”."));
      statuses.forEach((s, idx) => {
        const row = el("div", "stage-row");
        row.appendChild(el("div", "stage-name", esc(s.label)));
        const tools = el("div", "fields-section-tools");
        const up = el("button", "btn btn-ghost btn-sm", "↑"); up.title = "Move up"; up.disabled = idx === 0;
        const down = el("button", "btn btn-ghost btn-sm", "↓"); down.title = "Move down"; down.disabled = idx === statuses.length - 1;
        const reorder = async (from, to) => {
          const keys = statuses.map((x) => x.key); const m = keys.splice(from, 1)[0]; keys.splice(to, 0, m);
          try { await App.portalApi("/api/record-statuses/reorder", { method: "POST", body: JSON.stringify({ recordType: selectedKey, orderedKeys: keys }) }); renderFields(true); }
          catch (e) { App.util.toast(e.message, true); }
        };
        up.onclick = () => reorder(idx, idx - 1);
        down.onclick = () => reorder(idx, idx + 1);
        const ren = el("button", "btn btn-ghost btn-sm", "Rename");
        ren.onclick = async () => {
          const name = await promptModal({ title: "Rename status", label: "Status name", value: s.label, okText: "Rename" });
          if (!name || !name.trim()) return;
          try { await App.portalApi("/api/record-statuses/rename", { method: "POST", body: JSON.stringify({ recordType: selectedKey, key: s.key, label: name.trim() }) }); App.util.toast("Renamed"); renderFields(true); }
          catch (e) { App.util.toast(e.message, true); }
        };
        const del = el("button", "link-danger", "Delete");
        del.onclick = async () => {
          if (!(await confirmModal({ title: "Delete status", message: "Delete status “" + s.label + "”?", confirmText: "Delete status" }))) return;
          try { await App.portalApi("/api/record-statuses/delete", { method: "POST", body: JSON.stringify({ recordType: selectedKey, key: s.key }) }); App.util.toast("Status deleted"); renderFields(true); }
          catch (e) {
            if (e && e.data && e.data.error === "STATUS_IN_USE") statusBlockedModal(e.data.blockers);
            else App.util.toast(e.message, true);
          }
        };
        tools.appendChild(up); tools.appendChild(down); tools.appendChild(ren); tools.appendChild(del);
        row.appendChild(tools);
        list.appendChild(row);
      });
      card.appendChild(list);
      return card;
    }

    sorted.forEach((s, i) => wrap.appendChild(sectionCard(s, bySection[s.id], i)));
    if (ungrouped.length || !sorted.length) wrap.appendChild(ungroupedCard(ungrouped));
    if (canEdit && selectedType && selectedType.key !== "contact") { wrap.appendChild(subtypesCard()); wrap.appendChild(statusesCard()); }

    fieldsView().innerHTML = "";
    fieldsView().appendChild(wrap);
  }

  function fieldRow(f, canEdit, allFields, recordTypeKey, sections, currentSectionId) {
    const row = el("div", "field-row");
    row.dataset.id = f.id;
    if (canEdit) row.draggable = true;

    const left = el("div", "field-row-left");
    if (canEdit) left.appendChild(el("span", "drag-handle", "⠿"));
    const meta = el("div");
    meta.appendChild(el("div", "field-row-label", esc(f.label)));
    const typeLbl = (App.fields.TYPE_LABELS[f.type] || f.type) + (f.system ? " · system" : "");
    meta.appendChild(el("div", "field-row-type", esc(typeLbl)));
    left.appendChild(meta);
    row.appendChild(left);

    const right = el("div", "field-row-actions");
    if (canEdit) {
      if (sections && sections.length) {
        const moveSel = el("select", "input field-move-sel");
        moveSel.title = "Move to section";
        const ung = el("option", null, "Ungrouped"); ung.value = ""; moveSel.appendChild(ung);
        sections.forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.id; if (s.id === (currentSectionId || "")) o.selected = true; moveSel.appendChild(o); });
        moveSel.value = currentSectionId || "";
        moveSel.onchange = async () => { try { await App.portalApi("/api/fields/" + f.id + "/section", { method: "PATCH", body: JSON.stringify({ sectionId: moveSel.value || null }) }); App.util.toast("Moved"); renderFields(true); } catch (e) { App.util.toast(e.message, true); } };
        right.appendChild(moveSel);
      }
      const edit = el("button", "btn btn-ghost btn-sm", "Edit");
      edit.onclick = () => openFieldModal(f, recordTypeKey);
      right.appendChild(edit);
      if (!f.system) {
        const del = el("button", "link-danger", "Delete");
        del.onclick = async () => { if (!(await confirmModal({ title: "Delete field", message: `Delete field “${f.label}”? Existing values will be hidden.`, confirmText: "Delete field" }))) return; try { await App.portalApi(`/api/fields/${f.id}`, { method: "DELETE" }); App.util.toast("Field deleted"); renderFields(true); } catch (e) { App.util.toast(e.message, true); } };
        right.appendChild(del);
      } else {
        right.appendChild(el("span", "field-locked", "🔒"));
      }
    }
    row.appendChild(right);

    if (canEdit) {
      row.addEventListener("dragstart", (e) => { fieldDropHandled = false; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", f.id); });
      row.addEventListener("dragend", () => { row.classList.remove("dragging"); if (!fieldDropHandled) renderFields(true); });
    }
    return row;
  }

  async function persistOrder(list, recordTypeKey) {
    const ids = App.util.$$(".field-row", list).map((r) => r.dataset.id);
    try { await App.portalApi("/api/fields/reorder", { method: "PATCH", body: JSON.stringify({ orderedIds: ids, recordType: recordTypeKey || "contact" }) }); }
    catch (e) { App.util.toast("Couldn't save order: " + e.message, true); }
  }

  function openFieldModal(existing, recordTypeKey) {
    const isEdit = !!existing;
    const isSystem = existing && existing.system;
    const inner = el("div");
    const typeOpts = Object.keys(App.fields.TYPE_LABELS).map((t) => `<option value="${t}">${esc(App.fields.TYPE_LABELS[t])}</option>`).join("");
    inner.innerHTML = `<div class="modal-head"><h2>${isEdit ? "Edit field" : "Add field"}</h2><button class="icon-btn" id="fm-close">&times;</button></div>
      <div class="modal-body">
        <label class="field-label">Label *</label>
        <input id="fm-label" class="input" value="${existing ? esc(existing.label) : ""}" placeholder="e.g. Deal size" />
        <label class="field-label">Type</label>
        <select id="fm-type" class="input" ${isSystem ? "disabled" : ""}>${typeOpts}</select>
        <div id="fm-options-wrap" style="display:none">
          <label class="field-label">Options (one per line)</label>
          <textarea id="fm-options" class="input" rows="4" placeholder="Hot\nWarm\nCold"></textarea>
        </div>
        <div id="fm-formula-wrap" style="display:none">
          <label class="field-label">Formula</label>
          <input id="fm-formula" class="input" placeholder="e.g. {{Name}} — {{Deal size}}" />
          <p class="muted" style="margin:-6px 0 12px">Reference other fields by their label in double braces, like {{Name}}.</p>
        </div>
        <label class="form-check"><input type="checkbox" id="fm-required" ${existing && existing.required ? "checked" : ""} /> <span>Required</span></label>
        <button id="fm-save" class="btn btn-primary btn-block" style="margin-top:14px">${isEdit ? "Save field" : "Add field"}</button>
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#fm-close").onclick = () => overlay.remove();
    const typeSel = inner.querySelector("#fm-type");
    const optsWrap = inner.querySelector("#fm-options-wrap");
    const formulaWrap = inner.querySelector("#fm-formula-wrap");
    if (existing) typeSel.value = existing.type;
    if (existing && existing.options) inner.querySelector("#fm-options").value = (existing.options || []).join("\n");
    if (existing && existing.formula) inner.querySelector("#fm-formula").value = existing.formula;
    function syncType() {
      optsWrap.style.display = App.fields.TYPES_WITH_OPTIONS.includes(typeSel.value) ? "block" : "none";
      formulaWrap.style.display = typeSel.value === "formula" ? "block" : "none";
    }
    typeSel.onchange = syncType;
    syncType();

    inner.querySelector("#fm-save").onclick = async () => {
      const label = inner.querySelector("#fm-label").value.trim();
      if (!label) { App.util.toast("Label is required", true); return; }
      const type = typeSel.value;
      const options = App.fields.TYPES_WITH_OPTIONS.includes(type)
        ? inner.querySelector("#fm-options").value.split("\n").map((s) => s.trim()).filter(Boolean) : [];
      const formula = type === "formula" ? inner.querySelector("#fm-formula").value : null;
      const required = inner.querySelector("#fm-required").checked;
      const payload = { label, type, options, formula, required };
      if (!isEdit) payload.recordType = recordTypeKey || "contact";
      const body = JSON.stringify(payload);
      try {
        if (isEdit) await App.portalApi(`/api/fields/${existing.id}`, { method: "PATCH", body });
        else await App.portalApi("/api/fields", { method: "POST", body });
        App.util.toast(isEdit ? "Field saved" : "Field added");
        overlay.remove();
        renderFields(true);
      } catch (e) { App.util.toast(e.message, true); }
    };
  }

  // ---------------- Drawer ----------------
  function ensureDrawer() {
    if (App.util.$("#overlay")) return;
    const overlay = el("div", "overlay hidden"); overlay.id = "overlay";
    const drawer = el("aside", "drawer hidden"); drawer.id = "drawer";
    drawer.innerHTML = `<div class="drawer-head"><div><div id="drawer-eyebrow" class="drawer-eyebrow"></div><h2 id="drawer-title">Details</h2></div>
      <button id="drawer-close" class="icon-btn">&times;</button></div><div id="drawer-body" class="drawer-body"></div>`;
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    overlay.onclick = hideDrawer;
    drawer.querySelector("#drawer-close").onclick = hideDrawer;
  }
  function showDrawer() {
    ensureDrawer();
    App.util.$("#overlay").classList.remove("hidden");
    App.util.$("#drawer").classList.remove("hidden");
    requestAnimationFrame(() => { App.util.$("#overlay").classList.add("show"); App.util.$("#drawer").classList.add("show"); });
  }
  function hideDrawer() {
    const o = App.util.$("#overlay"), d = App.util.$("#drawer");
    if (!o) return;
    o.classList.remove("show"); d.classList.remove("show");
    setTimeout(() => { o.classList.add("hidden"); d.classList.add("hidden"); }, 220);
  }
  function field(label, val, mono) {
    return `<div class="field"><span class="field-label">${esc(label)}</span><span class="field-value ${mono ? "mono" : ""}">${esc(val || "—")}</span></div>`;
  }

  async function openCall(id) {
    ensureDrawer();
    App.util.$("#drawer-eyebrow").textContent = "Call detail";
    App.util.$("#drawer-title").textContent = "Loading…";
    App.util.$("#drawer-body").innerHTML = `<div class="skeleton">Loading…</div>`;
    showDrawer();
    try {
      const c = await App.portalApi(`/api/calls/${id}`);
      App.util.$("#drawer-title").textContent = c.name || "Unknown caller";
      const grid = `<div class="field-grid">
        ${field("Phone", c.phone || c.fromNumber, true)}
        ${field("Status", { COMPLETED: "Completed", FAILED: "Missed" }[c.status] || "In progress")}
        ${field("Email", c.email)}
        ${field("Turns", String(c.turnCount))}
        <div class="field field-full"><span class="field-label">Reason for calling</span><span class="field-value">${esc(c.intent || "—")}</span></div>
        ${field("Received", fmtDate(c.createdAt))}
        ${field("Notified", c.emailSentAt ? fmtDate(c.emailSentAt) : "—")}</div>`;
      const turns = Array.isArray(c.transcript) ? c.transcript : [];
      let tHtml = `<div class="drawer-section-title">Transcript</div>`;
      if (!turns.length) tHtml += `<p class="cell-muted">No transcript recorded.</p>`;
      else {
        tHtml += `<div class="transcript">`;
        turns.forEach((t) => {
          const who = t.role === "caller" ? "Caller" : t.role === "assistant" ? "Receptionist" : "System";
          tHtml += `<div class="bubble-row ${esc(t.role)}"><div class="bubble"><div class="bubble-who">${esc(who)}</div>${esc(t.text || "(silence)")}</div></div>`;
        });
        tHtml += `</div>`;
      }
      App.util.$("#drawer-body").innerHTML = grid + tHtml;
    } catch (err) { App.util.$("#drawer-body").innerHTML = `<p class="cell-muted">${esc(err.message)}</p>`; }
  }

  // ---------------- Contact profile page ----------------
  async function renderContact(id, opts) {
    opts = opts || {};
    const ro = !!opts.preview; // read-only Recycle Bin preview
    loading();
    let c, fields, sections;
    try { [c, fields, sections] = await Promise.all([App.portalApi(`/api/contacts/${id}`), App.portalApi("/api/fields"), App.portalApi("/api/field-sections?recordType=contact").catch(() => [])]); }
    catch (err) { if (ro) return recycleMissing(); view().innerHTML = `<div class="card"><p class="cell-muted">${esc(err.message)}</p></div>`; return; }
    if (ro && !c.deletedAt) return recycleMissing(); // restored/purged since the bin was opened

    const wrap = el("div", "fade-in contact-page");
    const back = el("a", "back-link", ro ? "← Back to Recycle Bin" : ("← " + App.label("contact","many")));
    back.href = ro ? "#/recycle" : "#/contacts";
    wrap.appendChild(back);

    const head = el("div", "contact-head");
    head.innerHTML = `<div class="contact-avatar">${esc((c.name || c.phone || "?").charAt(0).toUpperCase())}</div>
      <div><h1 class="contact-name">${esc(c.name || "Unknown")}</h1>
      <div class="contact-sub">${esc(c.phone || "")}${c.email ? " · " + esc(c.email) : ""}</div></div>`;
    if (!ro) {
      const runAuto = el("button", "btn btn-ghost btn-sm", "Run automation");
      runAuto.style.marginLeft = "auto";
      runAuto.onclick = () => openRunAutomation(id, c.name || c.phone || ("this " + App.label("contact","one").toLowerCase()));
      head.appendChild(runAuto);
    }
    wrap.appendChild(head);
    if (ro) wrap.appendChild(recyclePreviewChrome("contact", c, id));

    const tabsBar = el("div", "tabs");
    const tabBody = el("div", "tab-body");
    const tabs = ro ? [["fields", "All fields"], ["timeline", "Timeline"]] : [["fields", "All fields"], ["timeline", "Timeline"], ["email", "Email"]].concat(App.smsEnabled() ? [["text", "Text"]] : []);
    let active = "fields";
    function setTab(key) {
      active = key;
      App.util.$$(".tab", tabsBar).forEach((t) => t.classList.toggle("active", t.dataset.tab === key));
      if (key === "fields") tabFields();
      else if (key === "timeline") tabTimeline();
      else if (key === "text") tabText();
      else tabEmail();
    }
    tabs.forEach(([key, label]) => {
      const t = el("button", "tab" + (key === "fields" ? " active" : ""), esc(label));
      t.dataset.tab = key;
      t.onclick = () => setTab(key);
      tabsBar.appendChild(t);
    });
    wrap.appendChild(tabsBar);
    wrap.appendChild(tabBody);

    // ---- Linked Jobs section: list linked jobs, manage stage/unlink, and link a job ----
    const jobsCard = el("div", "card linked-jobs-card");
    const jobsHead = el("div", "cand-head");
    jobsHead.appendChild(el("div", "drawer-section-title", App.label("job","many")));
    const jobsToggle = el("div", "seg-toggle");
    const jobsListBtn = el("button", "seg-btn seg-on", "List");
    const jobsBoardBtn = el("button", "seg-btn", "Board");
    jobsToggle.appendChild(jobsListBtn); jobsToggle.appendChild(jobsBoardBtn);
    jobsHead.appendChild(jobsToggle);
    jobsCard.appendChild(jobsHead);
    const jobsBody = el("div"); // holds either the list or the swimlane board
    jobsCard.appendChild(jobsBody);
    const jobAddRow = el("div", "link-add");
    jobsCard.appendChild(jobAddRow);
    if (!ro) wrap.appendChild(jobsCard); // linked-jobs management is hidden in the read-only preview
    let jobLinks = [];
    let jobsView = "list"; // List is the default; Board is the toggle
    jobsListBtn.onclick = () => { if (jobsView === "list") return; jobsView = "list"; jobsListBtn.classList.add("seg-on"); jobsBoardBtn.classList.remove("seg-on"); renderJobs(); };
    jobsBoardBtn.onclick = () => { if (jobsView === "board") return; jobsView = "board"; jobsBoardBtn.classList.add("seg-on"); jobsListBtn.classList.remove("seg-on"); renderJobs(); };

    let jobType = null;
    async function ensureJobMeta() {
      if (jobType) return jobType;
      const types = await App.portalApi("/api/record-types").catch(() => []);
      jobType = (types || []).find((t) => t.key === "job") || { stages: [], recordStages: [] };
      return jobType;
    }
    const jobStatusLabel = (k) => { const s = ((jobType && jobType.recordStages) || []).find((x) => x.key === k); return s ? s.label : (k || ""); };
    const jobSubtypeLabel = (k) => { const s = ((jobType && jobType.subtypes) || []).find((x) => x.key === k); return s ? s.label : (k || ""); };
    const stagesForJob = (k) => { const st = ((jobType && jobType.subtypes) || []).find((x) => x.key === k); return st ? (st.stages || []) : ((jobType && jobType.stages) || []); };

    async function loadLinkedJobs() {
      jobsBody.innerHTML = `<div class="cell-muted">Loading…</div>`;
      await ensureJobMeta();
      try { jobLinks = await App.portalApi(`/api/contacts/${id}/links?type=job`); }
      catch (e) { jobsBody.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; return; }
      if (!Array.isArray(jobLinks)) jobLinks = [];
      renderJobs();
    }

    function renderJobs() { if (jobsView === "board") renderJobsBoard(); else renderJobsList(); }

    // List view — the original per-link rows (title + Stage dropdown + Unlink).
    // The dropdown writes the SAME RecordLink.stageKey and updates the in-memory
    // link so the Board view reflects it without a refetch.
    function renderJobsList() {
      jobsBody.innerHTML = "";
      const jobsList = el("div", "link-list");
      if (!jobLinks.length) { jobsList.appendChild(el("div", "cell-muted", ("Not linked to any " + App.label("job","many").toLowerCase() + " yet."))); jobsBody.appendChild(jobsList); return; }
      jobLinks.forEach((lk) => {
        const row = el("div", "link-row");
        const subKey = lk.record ? lk.record.subtypeKey : null;
        const title = lk.record ? (lk.record.title || ("Untitled " + App.label("job","one").toLowerCase())) : App.label("job","one");
        const nameEl = el("div", "link-name"); nameEl.innerHTML = `${esc(title)}${subKey ? ` <span class="cell-muted link-ptype">${esc(jobSubtypeLabel(subKey))}</span>` : ""}`;
        if (lk.record) { nameEl.style.cursor = "pointer"; nameEl.onclick = () => App.go("#/record/" + lk.record.id); }
        row.appendChild(nameEl);
        const stageSel = el("select", "input link-stage");
        stageSel.appendChild(el("option", null, ("— " + App.label("stage","one").toLowerCase() + " —")));
        let known = false;
        stagesForJob(subKey).forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === lk.stageKey) { o.selected = true; known = true; } stageSel.appendChild(o); });
        if (lk.stageKey && !known) { const o = el("option", null, esc(lk.stageKey) + " (not in this pipeline)"); o.value = lk.stageKey; o.selected = true; stageSel.appendChild(o); }
        stageSel.onchange = async () => { const v = stageSel.value || null; try { await App.portalApi("/api/record-links/" + lk.id, { method: "PATCH", body: JSON.stringify({ stageKey: v }) }); lk.stageKey = v; toast(App.label("stage","one") + " updated"); } catch (e) { toast(e.message, true); } };
        row.appendChild(stageSel);
        const unlink = el("button", "link-danger", "Unlink");
        unlink.onclick = async () => { if (!(await confirmModal({ title: "Unlink", message: `Unlink “${title}”?`, confirmText: "Unlink" }))) return; try { await App.portalApi("/api/record-links/" + lk.id, { method: "DELETE" }); toast("Unlinked"); loadLinkedJobs(); } catch (e) { toast(e.message, true); } };
        row.appendChild(unlink);
        jobsList.appendChild(row);
      });
      jobsBody.appendChild(jobsList);
    }

    // Board view — SWIMLANES. A contact can be on many policies, each with its
    // OWN pipeline, so there's no single set of columns. We render one lane per
    // linked policy; each lane shows THAT policy's stages as columns (in pipeline
    // order) with the contact as a single card in its current stage. Dragging the
    // card within its lane changes the contact's stage on that policy via the SAME
    // PATCH /api/record-links/:id the policy board and the list dropdown use.
    function renderJobsBoard() {
      jobsBody.innerHTML = "";
      if (!jobLinks.length) {
        const empty = el("div", "cell-muted"); empty.style.cssText = "padding:10px 2px;";
        empty.textContent = "Not linked to any " + App.label("job","many").toLowerCase() + " yet — link one below to start the board.";
        jobsBody.appendChild(empty);
        return;
      }
      const lanes = el("div", "swimlanes");
      jobLinks.forEach((lk) => lanes.appendChild(buildJobLane(lk)));
      jobsBody.appendChild(lanes);
    }

    function buildJobLane(lk) {
      const lane = el("div", "swimlane");
      const subKey = lk.record ? lk.record.subtypeKey : null;
      const title = lk.record ? (lk.record.title || ("Untitled " + App.label("job","one").toLowerCase())) : App.label("job","one");
      const head = el("div", "swimlane-head");
      const titleEl = el("span", "swimlane-title", esc(title));
      if (lk.record) { titleEl.style.cursor = "pointer"; titleEl.onclick = () => App.go("#/record/" + lk.record.id); }
      head.appendChild(titleEl);
      if (subKey) head.appendChild(el("span", "swimlane-type pill", esc(jobSubtypeLabel(subKey))));
      lane.appendChild(head);

      const stages = stagesForJob(subKey);
      const known = new Set(stages.map((s) => s.key));
      const board = el("div", "kanban");
      let laneDragHandled = false;

      function highlightCurrent() {
        board.querySelectorAll(".kanban-col").forEach((col) => col.classList.toggle("kanban-col--current", !!col.querySelector(".kanban-card")));
      }
      function makeCard() {
        const card = el("div", "kanban-card");
        card.draggable = true; card.dataset.linkId = lk.id;
        card.appendChild(el("div", "kanban-card-name", esc(c.name || c.phone || App.label("contact","one"))));
        const x = el("button", "kanban-card-x", "×"); x.title = "Unlink";
        x.onclick = async (e) => { e.stopPropagation(); if (!(await confirmModal({ title: "Unlink", message: `Unlink “${title}”?`, confirmText: "Unlink" }))) return; try { await App.portalApi("/api/record-links/" + lk.id, { method: "DELETE" }); toast("Unlinked"); loadLinkedJobs(); } catch (err) { toast(err.message, true); } };
        card.appendChild(x);
        card.addEventListener("dragstart", () => { laneDragHandled = false; card.classList.add("dragging"); });
        card.addEventListener("dragend", () => { card.classList.remove("dragging"); board.querySelectorAll(".kanban-col--over").forEach((cc) => cc.classList.remove("kanban-col--over")); if (!laneDragHandled) renderJobsBoard(); });
        return card;
      }
      const card = makeCard();

      function makeCol(key, label, isReview) {
        const col = el("div", "kanban-col" + (isReview ? " kanban-col--review" : ""));
        col.dataset.stage = key == null ? "" : key;
        const h = el("div", "kanban-col-head");
        h.appendChild(el("span", "kanban-col-name", label));
        col.appendChild(h);
        const cards = el("div", "kanban-cards"); col.appendChild(cards);
        // Scoped to THIS lane's board: another lane's card can't be dropped here.
        col.addEventListener("dragover", (e) => { const d = board.querySelector(".kanban-card.dragging"); if (!d) return; e.preventDefault(); col.classList.add("kanban-col--over"); cards.appendChild(d); });
        col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("kanban-col--over"); });
        col.addEventListener("drop", async (e) => {
          const d = board.querySelector(".kanban-card.dragging"); if (!d) return; e.preventDefault();
          col.classList.remove("kanban-col--over"); laneDragHandled = true;
          cards.appendChild(d); highlightCurrent();
          const newStage = isReview ? null : key;
          if (newStage === (lk.stageKey ?? null)) return; // dropped back where it was
          try { await App.portalApi("/api/record-links/" + lk.id, { method: "PATCH", body: JSON.stringify({ stageKey: newStage }) }); lk.stageKey = newStage; toast(App.label("stage","one") + " updated"); }
          catch (err) { toast(err.message, true); renderJobsBoard(); }
        });
        return { col, cards, key, isReview };
      }

      const cols = [];
      const inPipeline = !!(lk.stageKey && known.has(lk.stageKey));
      if (!inPipeline) cols.push(makeCol(null, "Needs review", true)); // unset or off-pipeline stage
      stages.forEach((s) => cols.push(makeCol(s.key, s.label, false)));
      cols.forEach((m) => board.appendChild(m.col));
      // Drop the single card into its current stage column (or Needs review).
      const target = inPipeline ? cols.find((m) => m.key === lk.stageKey) : cols.find((m) => m.isReview);
      (target || cols[0]).cards.appendChild(card);
      highlightCurrent();
      lane.appendChild(board);
      return lane;
    }

    // Link-a-job search box (in-flow results; reuses the SAME RecordLink endpoint,
    // initiated from the contact side: POST /api/records/:jobId/links with this contact).
    const jobInput = el("input", "input link-search"); jobInput.placeholder = ("Link a " + App.label("job","one").toLowerCase() + " — type a title…");
    jobAddRow.appendChild(jobInput);
    const jobResults = el("div"); jobResults.style.cssText = "margin-top:8px; display:none;";
    jobAddRow.appendChild(jobResults);
    let allJobs = null;
    async function ensureJobs() { if (allJobs) return allJobs; try { const raw = await App.portalApi("/api/records?type=job"); allJobs = Array.isArray(raw) ? raw : []; } catch (e) { allJobs = []; } return allJobs; }
    function showJobResults(nodes) { jobResults.innerHTML = ""; const box = el("div"); box.style.cssText = "border:1px solid var(--line-strong); border-radius:8px; overflow:hidden; max-height:260px; overflow-y:auto; background:var(--panel);"; nodes.forEach((n) => box.appendChild(n)); jobResults.appendChild(box); jobResults.style.display = "block"; }
    function hideJobResults() { jobResults.style.display = "none"; jobResults.innerHTML = ""; }
    function jobMsg(t) { const d = el("div", "cell-muted", esc(t)); d.style.cssText = "padding:9px 12px;"; return d; }
    function jobButton(j) {
      const b = el("button", "link-result"); b.style.cssText = "line-height:1.35;";
      const bits = [];
      if (j.subtypeKey) bits.push(jobSubtypeLabel(j.subtypeKey));
      if (j.stageKey) bits.push(jobStatusLabel(j.stageKey));
      b.innerHTML = `<div style="font-weight:600;">${esc(j.title || ("Untitled " + App.label("job","one").toLowerCase()))}</div>` + (bits.length ? `<div style="font-size:12px;color:var(--ink-faint);margin-top:1px;">${esc(bits.join(" · "))}</div>` : "");
      b.onclick = async () => {
        try {
          const firstStage = (stagesForJob(j.subtypeKey))[0];
          await App.portalApi("/api/records/" + j.id + "/links", { method: "POST", body: JSON.stringify({ parentType: "contact", parentId: id, stageKey: firstStage ? firstStage.key : null }) });
          toast("Linked"); jobInput.value = ""; hideJobResults(); loadLinkedJobs();
        } catch (e) { toast(e.message, true); }
      };
      return b;
    }
    async function runJobSearch() {
      await ensureJobMeta();
      const list = await ensureJobs();
      if (!list.length) { showJobResults([jobMsg(("No " + App.label("job","many").toLowerCase() + " yet — create one on the " + App.label("job","many") + " page first."))]); return; }
      const q = jobInput.value.trim().toLowerCase();
      const matches = !q ? list.slice(0, 8) : list.filter((j) => (j.title || "").toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) { showJobResults([jobMsg(`No ${App.label("job","many").toLowerCase()} match “${jobInput.value.trim()}”.`)]); return; }
      showJobResults(matches.map(jobButton));
    }
    jobInput.oninput = App.util.debounce(runJobSearch, 200);
    jobInput.onfocus = runJobSearch;
    jobInput.onblur = () => setTimeout(hideJobResults, 200);

    if (!ro) loadLinkedJobs();

    view().innerHTML = "";
    view().appendChild(wrap);

    // ---- All fields tab ----
    function tabFields() {
      tabBody.innerHTML = "";
      const values = { name: c.name || "", phone: c.phone || "", email: c.email || "", intent: c.intent || "", ...(c.customFields || {}) };
      const card = el("div", "card");
      const editorHost = el("div", "field-editor");
      card.appendChild(editorHost);
      App.fields.renderGroupedEditor(editorHost, fields, values, sections || [], { readOnly: ro });
      if (!ro) {
        const saveBar = el("div", "drawer-save-bar");
        const save = el("button", "btn btn-primary btn-sm", "Save changes");
        save.onclick = async () => {
          const custom = {};
          fields.forEach((f) => { if (!App.fields.SYSTEM_KEYS.includes(f.key) && f.type !== "formula") custom[f.key] = values[f.key]; });
          save.disabled = true; save.textContent = "Saving…";
          try {
            await App.portalApi(`/api/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ name: values.name, phone: values.phone, email: values.email, intent: values.intent, customFields: custom }) });
            App.util.toast((App.label("contact","one") + " saved"));
            c.name = values.name; c.email = values.email; c.phone = values.phone;
            App.util.$(".contact-name", wrap).textContent = values.name || "Unknown";
          } catch (e) { App.util.toast(e.message, true); }
          finally { save.disabled = false; save.textContent = "Save changes"; }
        };
        saveBar.appendChild(save);
        card.appendChild(saveBar);
      }
      tabBody.appendChild(card);
    }

    // ---- Timeline tab ----
    async function tabTimeline() {
      tabBody.innerHTML = `<div class="card"><div class="skeleton">Loading…</div></div>`;
      let items;
      try { items = await App.portalApi(`/api/contacts/${id}/timeline`); }
      catch (e) { tabBody.innerHTML = `<div class="card"><p class="cell-muted">${esc(e.message)}</p></div>`; return; }
      const card = el("div", "card");
      if (!items.length) { card.innerHTML = `<p class="cell-muted">No activity yet.</p>`; tabBody.innerHTML = ""; tabBody.appendChild(card); return; }
      const tl = el("div", "timeline");
      const icons = { created: "✨", field_update: "✏️", email_sent: "✉️", call: "📞" };
      items.forEach((ev) => {
        const row = el("div", "tl-item");
        const who = ev.actorType === "system" ? "System" : (ev.actorName || "A user");
        let extra = "";
        if (ev.type === "field_update" && ev.detail && ev.detail.changes) {
          extra = `<div class="tl-changes">` + ev.detail.changes.map((ch) =>
            `<div><span class="tl-field">${esc(ch.label)}:</span> <span class="tl-from">${esc(scalarStr(ch.from)) || "—"}</span> → <span class="tl-to">${esc(scalarStr(ch.to)) || "—"}</span></div>`).join("") + `</div>`;
        } else if (ev.type === "email_sent" && ev.detail) {
          extra = `<div class="tl-changes"><div class="cell-muted">To ${esc(ev.detail.to || "")}</div></div>`;
        } else if (ev.type === "call" && ev.detail && ev.detail.intent) {
          extra = `<div class="tl-changes"><div class="cell-muted">${esc(ev.detail.intent)}</div></div>`;
        }
        row.innerHTML = `<div class="tl-icon">${icons[ev.type] || "•"}</div>
          <div class="tl-main"><div class="tl-summary">${esc(ev.summary)}</div>
          <div class="tl-meta">${esc(who)} · ${fmtDate(ev.createdAt)}</div>${extra}</div>`;
        tl.appendChild(row);
      });
      card.appendChild(tl);
      tabBody.innerHTML = "";
      tabBody.appendChild(card);
    }

    // ---- Email tab ----
    function tabEmail() {
      tabBody.innerHTML = "";
      const card = el("div", "card");
      if (!c.email) {
        card.innerHTML = `<p class="cell-muted">This contact has no email address. Add one in the All fields tab to send email.</p>`;
        tabBody.appendChild(card);
        return;
      }
      card.appendChild(el("div", "email-meta", `To: <strong>${esc(c.email)}</strong> · From: ${esc(App.state.me.email)}`));
      const composerHost = el("div");
      card.appendChild(composerHost);
      const api = App.compose.mount(composerHost, { kind: "email" });
      const send = el("button", "btn btn-primary btn-sm", "Send email");
      send.style.marginTop = "14px";
      send.onclick = async () => {
        const subject = api.getSubject();
        if (!subject) { App.util.toast("Add a subject", true); return; }
        send.disabled = true; send.textContent = "Sending…";
        try {
          await App.portalApi(`/api/contacts/${id}/email`, { method: "POST", body: JSON.stringify({ subject, html: api.getHTML() }) });
          App.util.toast("Email sent");
          api.setSubject(""); api.setBody("");
        } catch (e) { App.util.toast(e.message, true); }
        finally { send.disabled = false; send.textContent = "Send email"; }
      };
      card.appendChild(send);
      tabBody.appendChild(card);
    }

    // ---- Text tab ----
    function tabText() {
      tabBody.innerHTML = "";
      const card = el("div", "card");
      if (!c.phone) {
        card.innerHTML = `<p class="cell-muted">This contact has no phone number.</p>`;
        tabBody.appendChild(card);
        return;
      }
      card.appendChild(el("div", "email-meta", `To: <strong>${esc(c.phone)}</strong>`));
      const composerHost = el("div");
      card.appendChild(composerHost);
      const api = App.compose.mount(composerHost, { kind: "sms" });
      const send = el("button", "btn btn-primary btn-sm", "Send text");
      send.style.marginTop = "14px";
      send.onclick = async () => {
        const body = api.getText().trim();
        if (!body) { App.util.toast("Type a message", true); return; }
        send.disabled = true; send.textContent = "Sending…";
        try {
          await App.portalApi(`/api/contacts/${id}/text`, { method: "POST", body: JSON.stringify({ body }) });
          App.util.toast("Text sent");
          api.setBody("");
        } catch (e) { App.util.toast(e.message, true); }
        finally { send.disabled = false; send.textContent = "Send text"; }
      };
      card.appendChild(send);
      tabBody.appendChild(card);
    }

    tabFields();
  }

  function scalarStr(v) { return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v); }

  // ---------------- Simulate ----------------
  async function simulate() {
    const btn = App.util.$("#simulate-btn");
    const original = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="btn-icon">&#8987;</span> Simulating…`; }
    try {
      const result = await App.portalApi("/api/simulate", { method: "POST" });
      App._highlightCallId = result.id;
      toast("Call simulated — lead captured");
      await refresh();
    } catch (err) { toast(err.message, true); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = original; } }
  }

  // ---------------- Settings ----------------

  // Labels editor — lifted to module scope so it can be mounted both in the
  // in-portal Settings > Labels pane (build: secLabels below) AND on the portal
  // setup screen via App.labelsEditor.mount(host). Same editor, one definition.

    async function secLabels(panel) {
      panel.innerHTML = `<h2 class="settings-h">Labels</h2>
        <p class="cell-muted" style="font-size:13px;margin-bottom:16px">Control what things are called in this portal and how the left-hand menu looks.</p>
        <div id="lbl-body"><div class="cell-muted" style="padding:6px">Loading…</div></div>`;
      const body = panel.querySelector("#lbl-body");
      let types, labelsData;
      try {
        const r = await Promise.all([App.portalApi("/api/record-types"), App.portalApi("/api/labels")]);
        types = r[0]; labelsData = r[1];
      } catch (e) { body.innerHTML = `<div class="cell-muted" style="padding:6px">Couldn’t load labels.</div>`; return; }

      const pluralize = App.pluralize;
      const generic = (labelsData && labelsData.generic) || {};
      const navCfg = (labelsData && labelsData.nav && typeof labelsData.nav === "object") ? labelsData.nav : { order: [], hidden: [], labels: {} };
      const GENERIC_WORDS = [
        { key: "record", dflt: { one: "Record", many: "Records" } },
        { key: "stage", dflt: { one: "Stage", many: "Stages" } },
        { key: "resource", dflt: { one: "Resource", many: "Resources" } },
      ];

      body.innerHTML = "";

      // ===================== Group 1: What things are called =====================
      body.appendChild(el("h3", "settings-sub", "What things are called"));
      const g1hint = el("p", "cell-muted"); g1hint.style.cssText = "font-size:12.5px;margin:0 0 10px"; g1hint.innerHTML = "Type the <strong>singular</strong> — the plural fills in for you, and you can edit it for irregulars.";
      body.appendChild(g1hint);
      const nounWrap = el("div", "lbl-group");
      const head = el("div", "lbl-row lbl-head");
      head.appendChild(el("div", null, "Singular"));
      head.appendChild(el("div", null, "Plural (auto — editable)"));
      nounWrap.appendChild(head);
      const rows = []; // { key, scope, oneEl, manyEl, touched }
      function addRow(scope, key, one, many) {
        const r = el("div", "lbl-row");
        const o = el("input", "input"); o.value = one || ""; o.placeholder = "Singular";
        const m = el("input", "input"); m.value = many || ""; m.placeholder = "Plural";
        m.title = "Auto-generated from the singular — edit for irregulars (e.g. Person → People)";
        r.appendChild(o); r.appendChild(m);
        nounWrap.appendChild(r);
        const row = { key: key, scope: scope, oneEl: o, manyEl: m, touched: !!(many && many !== pluralize(one)) };
        o.addEventListener("input", () => { if (!row.touched) m.value = pluralize(o.value); });
        m.addEventListener("input", () => { row.touched = true; });
        rows.push(row);
      }
      (types || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((t) => {
        addRow("type", t.key, t.label || "", t.labelPlural || pluralize(t.label || ""));
      });
      GENERIC_WORDS.forEach((w) => {
        const cur = generic[w.key] || {};
        addRow("generic", w.key, cur.one || w.dflt.one, cur.many || w.dflt.many);
      });
      body.appendChild(nounWrap);

      // ===================== Group 2: Pages & navigation =========================
      body.appendChild(el("h3", "settings-sub", "Pages & navigation"));
      const g2hint = el("p", "cell-muted"); g2hint.style.cssText = "font-size:12.5px;margin:0 0 10px"; g2hint.innerHTML = "Rename, drag to reorder, or hide the items in your left-hand menu. <strong>Home Dashboard</strong> always stays so there’s a landing page.";
      body.appendChild(g2hint);
      const navListEl = el("div", "nav-edit-list");
      body.appendChild(navListEl);

      let NAV = (App.PORTAL_NAV || []).slice();
      // When the AI Receptionist is off for this portal, the Calls page doesn't
      // exist for them — so don't list it in the relabel/reorder editor either.
      if (App.state.receptionistEnabled === false) {
        NAV = NAV.filter(function (it) { return it[0] !== "#/calls"; });
      }
      const navByHref = {}; NAV.forEach((it) => { navByHref[it[0]] = it; });
      // Initial display order: saved order first, then any default items not in it
      // (so a newly-shipped nav item still appears under an older saved order). We
      // show ALL items here — including hidden ones (greyed) — so hiding is always
      // recoverable.
      let navOrder = []; const seen = {};
      (navCfg.order || []).forEach((h) => { if (navByHref[h] && !seen[h]) { navOrder.push(h); seen[h] = true; } });
      NAV.forEach((it) => { if (!seen[it[0]]) { navOrder.push(it[0]); seen[it[0]] = true; } });
      const hiddenSet = new Set((navCfg.hidden || []).filter((h) => h !== "#/dashboard"));
      const labelInputs = {}; // href -> input (fixed items only)
      function navDisplay(it) { return it[2] ? App.label(it[2], "many") : (((navCfg.labels || {})[it[0]]) || it[1]); }

      function paintNav() {
        navListEl.innerHTML = "";
        navOrder.forEach((href) => {
          const it = navByHref[href]; if (!it) return;
          const kind = it[2]; const dflt = it[1];
          const isHome = href === "#/dashboard";
          const isHidden = hiddenSet.has(href);
          const row = el("div", "nav-edit-row" + (isHidden ? " nav-edit-hidden" : ""));
          row.draggable = true; row.dataset.href = href;
          row.appendChild(el("span", "mc-drag", "⠿"));
          if (kind) {
            const lab = el("div", "nav-edit-label-fixed");
            lab.appendChild(el("span", null, esc(App.label(kind, "many"))));
            lab.appendChild(el("span", "nav-edit-note", "set by the “" + esc(App.label(kind, "one")) + "” label above"));
            row.appendChild(lab);
          } else {
            const inp = el("input", "input nav-edit-input");
            inp.value = ((navCfg.labels || {})[href]) || dflt;
            inp.placeholder = dflt;
            row.appendChild(inp);
            labelInputs[href] = inp;
          }
          if (isHome) {
            row.appendChild(el("span", "nav-edit-pill", "Always shown"));
          } else {
            const btn = el("button", "btn btn-ghost btn-sm nav-edit-toggle", isHidden ? "Show" : "Hide");
            btn.onclick = async () => {
              if (!isHidden) {
                const ok = await confirmModal({ title: "Hide this page?", message: "“" + navDisplay(it) + "” will be removed from the left-hand menu. You can restore it any time from Settings → Labels → Pages & navigation.", confirmText: "Hide page" });
                if (!ok) return;
                hiddenSet.add(href);
              } else {
                hiddenSet.delete(href);
              }
              paintNav();
            };
            row.appendChild(btn);
          }
          row.addEventListener("dragstart", (e) => { row.classList.add("dragging"); e.dataTransfer.setData("text/plain", href); });
          row.addEventListener("dragend", () => row.classList.remove("dragging"));
          row.addEventListener("dragover", (e) => { e.preventDefault(); });
          row.addEventListener("drop", (e) => {
            e.preventDefault();
            const from = e.dataTransfer.getData("text/plain"); const to = href;
            if (from === to) return;
            navOrder = navOrder.filter((k) => k !== from);
            const idx = navOrder.indexOf(to);
            navOrder.splice(idx, 0, from);
            paintNav();
          });
          navListEl.appendChild(row);
        });
      }
      paintNav();

      // ===================== Save (both groups together) =========================
      const saveBtn = el("button", "btn btn-primary btn-sm", "Save");
      saveBtn.style.marginTop = "18px";
      saveBtn.onclick = async () => {
        const payload = { types: {}, generic: {}, nav: { order: [], hidden: [], labels: {} } };
        for (const row of rows) {
          const one = row.oneEl.value.trim();
          let many = row.manyEl.value.trim();
          if (!one) { toast("Each word needs a singular name", true); return; }
          if (!many) many = pluralize(one);
          payload[row.scope === "type" ? "types" : "generic"][row.key] = { one: one, many: many };
        }
        payload.nav.order = navOrder.slice();
        payload.nav.hidden = Array.from(hiddenSet);
        Object.keys(labelInputs).forEach((href) => { const v = labelInputs[href].value.trim(); if (v) payload.nav.labels[href] = v; });
        try {
          await App.portalApi("/api/labels", { method: "PATCH", body: JSON.stringify(payload) });
          await App.loadLabels();
          toast("Saved");
          if (App._route) App._route(); // repaint nav (order/labels/hidden) + this pane
        } catch (err) { toast(err.message, true); }
      };
      body.appendChild(saveBtn);
    }

  async function renderSettings(sub) {
    const me = App.state.me;
    const canEditPortal = me.role !== "CLIENT_USER";

    // Section registry. `admin` = needs portal-edit rights (CLIENT_USER sees only
    // "Your account"). Each builder relocates the EXISTING content + wiring
    // unchanged; "labels" and "fields" are reserved placeholders for later steps.
    const SECTIONS = [
      { key: "general", label: "Business Profile", admin: true, build: secGeneral },
      { key: "appearance", label: "Appearance", admin: true, build: secAppearance },
      { key: "team", label: "Team & Permissions", admin: true, build: secTeam },
      { key: "leadcapture", label: "Lead capture", admin: true, build: secLeadCapture },
      { key: "scheduling", label: "Scheduling & Resources", admin: true, build: secSchedulingResources },
      // Integrations is visible to EVERY role (admin:false) — Twilio/OpenAI edit
      // is gated inside the section, Google is editable by all. renderIntegrations
      // fills the panel directly (same build(panel) contract as the others).
      { key: "integrations", label: "Integrations", admin: false, build: renderIntegrations },
      { key: "data", label: "Data Administration", admin: false, build: renderDataAdmin },
      { key: "account", label: "Your account", admin: false, build: secAccount },
      { key: "labels", label: "Labels", admin: true, build: secLabels },
      { key: "fields", label: "Fields", admin: true, build: secFields },
    ].filter((s) => canEditPortal || !s.admin);

    const active = SECTIONS.some((s) => s.key === sub) ? sub : SECTIONS[0].key;

    // Two-pane shell: sub-sidebar (left) + content panel (right). The global app
    // nav is untouched; this layout lives entirely inside the settings view.
    const shell = el("div", "fade-in settings-shell");
    const subnav = el("aside", "settings-subnav");
    subnav.appendChild(el("div", "settings-subnav-title", "Settings"));
    SECTIONS.forEach((s) => {
      const a = el("a", "settings-subnav-item" + (s.key === active ? " active" : ""), esc(s.label));
      a.href = "#/settings/" + s.key; // hash drives selection -> refresh/back work
      subnav.appendChild(a);
    });
    const panel = el("div", "settings-panel");
    panel.innerHTML = `<div class="cell-muted" style="padding:8px">Loading…</div>`;
    shell.appendChild(subnav);
    shell.appendChild(panel);

    view().innerHTML = "";
    view().appendChild(shell);

    const def = SECTIONS.find((s) => s.key === active);
    try { await def.build(panel); }
    catch (e) { panel.innerHTML = `<div class="cell-muted" style="padding:8px">Couldn’t load this section.</div>`; }

    // ---- Section builders (existing content + behavior, relocated verbatim) ----
    async function secGeneral(panel) {
      const portal = await App.portalApi("/api/settings");
      panel.innerHTML = `<h2 class="settings-h">Business Profile</h2>
        <div class="settings-grid">
          <label class="field-label">Business name</label><input id="set-name" class="input" value="${esc(portal.name)}" />
          <label class="field-label">Notify email</label><input id="set-email" class="input" value="${esc(portal.notifyEmail)}" />
        </div>
        <p class="cell-muted" style="font-size:12.5px;margin:6px 0 14px">Where call summaries and business notifications are sent.</p>
        <button id="set-save" class="btn btn-primary btn-sm">Save changes</button>`;
      App.util.$("#set-save").onclick = async () => {
        try {
          await App.portalApi("/api/settings", { method: "PATCH", body: JSON.stringify({
            name: App.util.$("#set-name").value, notifyEmail: App.util.$("#set-email").value }) });
          toast("Settings saved");
        } catch (err) { toast(err.message, true); }
      };
    }

    async function secAppearance(panel) {
      panel.innerHTML = `<h2 class="settings-h">Appearance</h2>
        <p class="cell-muted" style="font-size:13px;margin-bottom:6px">Pick a theme for this portal, or design your own. Applies to everyone in this portal.</p>
        <div id="theme-host"></div>`;
      if (App.theme) { const h = App.util.$("#theme-host"); if (h) App.theme.mountSettings(h); }
    }

    async function secTeam(panel) {
      const users = await App.portalApi("/api/users");
      let customRoles = [];
      try { const pr = await App.portalApi("/api/portal-roles"); customRoles = pr.customRoles || []; } catch (e) {}
      const customOpts = customRoles.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
      panel.innerHTML = "";

      // ---- Team Members panel ----
      const membersCard = el("div", "settings-card card");
      membersCard.innerHTML = `<h2 class="settings-h">Team members</h2>
        <table class="mini-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody id="users-tbody"></tbody></table>
        <div class="add-user">
          <input id="nu-name" class="input" placeholder="Name" />
          <input id="nu-email" class="input" placeholder="email@company.com" />
          <select id="nu-role" class="input"><option value="CLIENT_USER">Client User</option><option value="PORTAL_ADMIN">Portal Admin</option>${customOpts ? `<optgroup label="Custom roles">${customOpts}</optgroup>` : ""}</select>
          <button id="nu-add" class="btn btn-primary btn-sm">Send invite</button>
        </div>
        <p class="cell-muted" style="font-size:12px;margin-top:8px">They'll get an email with a link to set their own password — no temporary password needed.</p>`;
      panel.appendChild(membersCard);

      // ---- Permissions panel (separate card) ----
      const permCard = el("div", "settings-card card");
      permCard.style.marginTop = "16px";
      permCard.innerHTML = `<div id="perm-panel"></div>`;
      panel.appendChild(permCard);

      fillUsers(users, customRoles);
      renderPermissionsPanel(permCard.querySelector("#perm-panel"));
      App.util.$("#nu-add").onclick = async () => {
        const name = App.util.$("#nu-name").value.trim();
        const email = App.util.$("#nu-email").value.trim();
        const role = App.util.$("#nu-role").value;
        if (!email) { toast("Email is required", true); return; }
        try {
          // Same shared invite endpoint the master hub uses: it creates an invite
          // token, builds the link from THIS request's origin, and emails it.
          // The server clamps the role and scopes to this portal.
          const result = await App.portalApi("/api/users", { method: "POST", body: JSON.stringify({ name, email, role }) });
          showTeamInviteResult(email, result && result.link, result && result.emailed);
          secTeam(panel); // refresh the list in place
        } catch (err) { toast(err.message, true); }
      };
    }

    // Success popup after an invite is sent — mirrors the master hub's result:
    // confirms the email (may land in spam) and always offers the activation link
    // as a copyable fallback.
    function showTeamInviteResult(email, link, emailed) {
      const overlay = el("div", "modal-overlay");
      const modal = el("div", "modal");
      const note = emailed
        ? "An invite email was sent to " + esc(email) + " (it may land in spam)."
        : "Email couldn't be delivered right now, so copy this link and send it to " + esc(email) + " yourself.";
      modal.innerHTML = `<div class="modal-head"><h2>Invite sent</h2><button class="icon-btn" id="tir-close">&times;</button></div>`;
      const body = el("div", "modal-body");
      body.innerHTML = `<p class="cell-muted" style="margin:0 0 12px">${note}</p>
        <label class="field-label">Activation link</label>
        <input id="tir-link" class="input" type="text" readonly value="${esc(link || "")}" style="font-family:monospace;font-size:12px" />`;
      const foot = el("div", "modal-foot");
      const copy = el("button", "btn btn-primary btn-sm", "Copy link");
      foot.appendChild(copy);
      modal.appendChild(body); modal.appendChild(foot); overlay.appendChild(modal);
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      modal.querySelector("#tir-close").onclick = close;
      copy.onclick = () => {
        const inp = modal.querySelector("#tir-link");
        try { inp.select(); } catch (e) {}
        const done = () => toast("Link copied");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link || "").then(done).catch(() => { try { document.execCommand("copy"); done(); } catch (e) {} });
        } else { try { document.execCommand("copy"); done(); } catch (e) {} }
      };
    }

    // ===== Permissions panel (Batch 4): two-pane role list + per-area rights grid. =====
    // Reuses settings-h / mini-table / btn / cell-muted styling. System roles are shown
    // read-only (reference); custom roles are created/edited/deleted here. N/A cells are
    // greyed per the rights catalog — and because the super-admin ceiling IS the full
    // catalog, those greyed cells are exactly what no role can ever be granted (Cap #1,
    // also enforced server-side). Assigning users to roles is Batch 5; this only edits
    // role definitions.
    async function renderPermissionsPanel(host) {
      if (!host) return;
      host.innerHTML = `<h2 class="settings-h">Permissions</h2><p class="cell-muted" style="font-size:13px;margin:0 0 14px">Loading…</p>`;
      let data;
      try { data = await App.portalApi("/api/portal-roles"); }
      catch (e) { host.innerHTML = `<h2 class="settings-h">Permissions</h2><p class="cell-muted">${esc(e.message)}</p>`; return; }

      // selection: { kind:"system", role } | { kind:"custom", id } | { kind:"new" }
      let sel = { kind: "system", role: data.systemRoles[0].role };

      function selectedRole() {
        if (sel.kind === "new") return { name: "", permissions: {}, editable: true, isNew: true };
        if (sel.kind === "custom") {
          const r = (data.customRoles || []).find((x) => x.id === sel.id);
          return r ? { name: r.name, permissions: r.permissions || {}, editable: true, id: r.id } : null;
        }
        const s = data.systemRoles.find((x) => x.role === sel.role);
        return { name: s.label, permissions: s.permissions || {}, editable: false, ceiling: s.ceiling, system: true };
      }

      function roleListHtml() {
        const item = (active, label, sub, attrs) =>
          `<div class="perm-role-item${active ? " active" : ""}" ${attrs} style="padding:8px 10px;border-radius:8px;cursor:pointer;${active ? "background:var(--accent-weak,#eef);font-weight:600" : ""}">${esc(label)}${sub ? `<span class="cell-muted" style="font-size:11px;display:block;font-weight:400">${esc(sub)}</span>` : ""}</div>`;
        let html = `<div class="cell-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:0 0 4px">System roles (reference)</div>`;
        html += data.systemRoles.map((s) => item(sel.kind === "system" && sel.role === s.role, s.label, "", `data-system="${s.role}"`)).join("");
        html += `<div class="cell-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:14px 0 4px">Custom roles</div>`;
        html += (data.customRoles || []).length
          ? data.customRoles.map((r) => item(sel.kind === "custom" && sel.id === r.id, r.name, r.assignedCount ? `${r.assignedCount} user${r.assignedCount === 1 ? "" : "s"}` : "no users assigned", `data-custom="${r.id}"`)).join("")
          : `<p class="cell-muted" style="font-size:12px;margin:2px 0 0">None yet.</p>`;
        html += `<button class="btn btn-sm" id="perm-new" style="margin-top:12px;width:100%">+ New role</button>`;
        return html;
      }

      function gridHtml(role) {
        const rights = ["view", "edit", "delete", "manage"];
        const my = data.myPermissions || {};
        const colLabel = { view: "View", edit: "Edit", delete: "Delete", manage: "Manage Settings" };
        const head = `<thead><tr><th style="text-align:left">Area</th>${rights.map((r) => `<th>${colLabel[r]}</th>`).join("")}</tr></thead>`;
        const cell = (area, right) => {
          // N/A: the area doesn't support this right.
          if (area.rights.indexOf(right) === -1) return `<td style="text-align:center;color:var(--muted);opacity:.3" title="Not applicable to this area">—</td>`;
          const granted = !!(role.permissions[area.key] && role.permissions[area.key][right]);
          if (!role.editable) {
            // Read-only reference (system roles): show a clear granted / not-granted mark
            // — NOT a faint disabled checkbox, so roles are visibly different.
            return granted
              ? `<td style="text-align:center;color:var(--accent,#2563eb);font-weight:700" title="Granted">\u2713</td>`
              : `<td style="text-align:center;color:var(--muted);opacity:.4" title="Not granted">\u00b7</td>`;
          }
          // Editable: only grantable up to the creator's OWN level (the ceiling).
          const withinLevel = !!(my[area.key] && my[area.key][right] === true);
          if (!withinLevel) return `<td style="text-align:center;color:var(--muted);opacity:.3" title="Beyond your own permission level — you can't grant this">\u00b7</td>`;
          return `<td style="text-align:center"><input type="checkbox" data-area="${area.key}" data-right="${right}" ${granted ? "checked" : ""}/></td>`;
        };
        return (data.sections || []).map((section) => {
          const areas = data.catalog.filter((a) => a.section === section);
          if (!areas.length) return "";
          const rows = areas.map((a) => `<tr><td>${esc(a.label)}</td>${rights.map((r) => cell(a, r)).join("")}</tr>`).join("");
          return `<details open style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600;padding:4px 0">${esc(section)}</summary>
            <table class="mini-table">${head}<tbody>${rows}</tbody></table></details>`;
        }).join("");
      }

      function render() {
        const role = selectedRole();
        if (!role) { sel = { kind: "system", role: data.systemRoles[0].role }; return render(); }
        const titleBar = role.editable
          ? `<input id="perm-name" class="input" placeholder="Role name" value="${esc(role.name)}" style="max-width:280px;font-weight:600" />`
          : `<h3 style="margin:0">${esc(role.name)}</h3>`;
        const actions = role.editable
          ? `<div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="perm-save">${role.isNew ? "Create role" : "Save changes"}</button>${role.id ? `<button class="btn btn-sm" id="perm-delete">Delete</button>` : ""}</div>`
          : `<span class="cell-muted" style="font-size:12px">Shown for reference — system roles aren't edited here.</span>`;
        host.innerHTML = `<h2 class="settings-h">Permissions</h2>
          <p class="cell-muted" style="font-size:13px;margin:0 0 14px">Each row is an area, and its columns are the rights that area supports — View / Edit / Delete for data, View for read-only areas, and Manage Settings for settings. Greyed cells are rights that area doesn't support. For your own custom roles, tick the rights to grant; you can grant up to your own level.</p>
          <div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
            <div style="width:210px;flex:0 0 auto">${roleListHtml()}</div>
            <div style="flex:1;min-width:320px">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">${titleBar}${actions}</div>
              ${gridHtml(role)}
            </div>
          </div>`;

        host.querySelectorAll("[data-system]").forEach((n) => n.onclick = () => { sel = { kind: "system", role: n.getAttribute("data-system") }; render(); });
        host.querySelectorAll("[data-custom]").forEach((n) => n.onclick = () => { sel = { kind: "custom", id: n.getAttribute("data-custom") }; render(); });
        const newBtn = host.querySelector("#perm-new"); if (newBtn) newBtn.onclick = () => { sel = { kind: "new" }; render(); };
        const saveBtn = host.querySelector("#perm-save"); if (saveBtn) saveBtn.onclick = onSave;
        const delBtn = host.querySelector("#perm-delete"); if (delBtn) delBtn.onclick = onDelete;
      }

      function collectPermissions() {
        const perms = {};
        host.querySelectorAll('input[type="checkbox"][data-area]').forEach((cb) => {
          if (cb.checked) { const a = cb.getAttribute("data-area"); (perms[a] = perms[a] || {})[cb.getAttribute("data-right")] = true; }
        });
        return perms;
      }

      async function onSave() {
        const name = (host.querySelector("#perm-name").value || "").trim();
        if (!name) { toast("Role name is required", true); return; }
        const permissions = collectPermissions();
        try {
          if (sel.kind === "new") {
            const created = await App.portalApi("/api/portal-roles", { method: "POST", body: JSON.stringify({ name, permissions }) });
            data = await App.portalApi("/api/portal-roles");
            sel = { kind: "custom", id: created.id };
            toast("Role created");
          } else {
            await App.portalApi(`/api/portal-roles/${sel.id}`, { method: "PATCH", body: JSON.stringify({ name, permissions }) });
            data = await App.portalApi("/api/portal-roles");
            toast("Role saved");
          }
          render();
        } catch (e) { toast(e.message, true); }
      }

      async function onDelete() {
        if (sel.kind !== "custom") return;
        const role = (data.customRoles || []).find((x) => x.id === sel.id);
        const n = role ? role.assignedCount || 0 : 0;
        const warn = n ? ` ${n} user${n === 1 ? "" : "s"} currently assigned will be reassigned to Client User (the most restricted role).` : "";
        if (!(await confirmModal({ title: "Delete role", message: `Delete the custom role "${role ? role.name : ""}"?${warn}`, confirmText: "Delete" }))) return;
        try {
          const r = await App.portalApi(`/api/portal-roles/${sel.id}`, { method: "DELETE" });
          data = await App.portalApi("/api/portal-roles");
          sel = { kind: "system", role: data.systemRoles[0].role };
          toast(r && r.unassigned ? `Role deleted · ${r.unassigned} user(s) reset to base role` : "Role deleted");
          render();
        } catch (e) { toast(e.message, true); }
      }

      render();
    }

    async function secLeadCapture(panel) {
      panel.innerHTML = `<h2 class="settings-h">Lead capture links</h2>
        <p class="cell-muted" style="font-size:13px;margin-bottom:10px">Create a secure link you can give to a website form, Zapier, or another tool so new leads land directly in this portal.</p>
        <div id="inbound-host"></div>`;
      if (App.inbound) { const h = App.util.$("#inbound-host"); if (h) App.inbound.render(h); }
    }

    // Scheduling: per-business open hours (up to two windows/day for split shifts),
    // per-service durations (keyed to the Booking services defined on Fields), and
    // a buffer. Writes to the same bookingConfig the slot-finder already reads.
    // Reusable weekly-hours editor (per-day Open toggle + up to two windows for
    // split shifts). Used by business Scheduling AND per-resource hours. Returns
    // { root, getHours() }.
    function buildHoursEditor(initialHours) {
      const DAYS = [["mon","Monday"],["tue","Tuesday"],["wed","Wednesday"],["thu","Thursday"],["fri","Friday"],["sat","Saturday"],["sun","Sunday"]];
      const hours = {};
      DAYS.forEach(([k]) => { hours[k] = Array.isArray(initialHours && initialHours[k]) ? initialHours[k].map((w) => ({ start: w.start, end: w.end })) : []; });
      const root = el("div");
      const dayList = el("div");
      root.appendChild(dayList);
      function timeInput(val) { const i = el("input", "input"); i.type = "time"; i.value = val || ""; i.style.cssText = "margin-bottom:0; width:130px;"; return i; }
      function renderDay(k, label) {
        const row = el("div");
        row.style.cssText = "display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--line);";
        const name = el("div"); name.textContent = label; name.style.cssText = "width:96px; font-weight:600;";
        row.appendChild(name);
        const openWrap = el("label", "form-check");
        const openCb = el("input"); openCb.type = "checkbox"; openCb.checked = hours[k].length > 0;
        openWrap.appendChild(openCb); openWrap.appendChild(el("span", null, "Open"));
        row.appendChild(openWrap);
        const windowsHost = el("div");
        windowsHost.style.cssText = "display:flex; flex-wrap:wrap; align-items:center; gap:10px;";
        row.appendChild(windowsHost);
        function paint() {
          windowsHost.innerHTML = "";
          if (!openCb.checked) { hours[k] = []; windowsHost.appendChild(el("span", "cell-muted", "Closed")); return; }
          if (hours[k].length === 0) hours[k] = [{ start: "09:00", end: "17:00" }];
          hours[k].forEach((w, idx) => {
            const s = timeInput(w.start); const e = timeInput(w.end);
            s.onchange = () => { hours[k][idx].start = s.value; };
            e.onchange = () => { hours[k][idx].end = e.value; };
            windowsHost.appendChild(s);
            windowsHost.appendChild(el("span", "cell-muted", "to"));
            windowsHost.appendChild(e);
            if (idx === 1) {
              const rm = el("button", "btn btn-ghost btn-sm", "Remove");
              rm.onclick = () => { hours[k].splice(1, 1); paint(); };
              windowsHost.appendChild(rm);
            }
          });
          if (hours[k].length < 2) {
            const add = el("button", "btn btn-ghost btn-sm", "+ Add split (lunch break)");
            add.onclick = () => { hours[k].push({ start: "13:00", end: "17:00" }); paint(); };
            windowsHost.appendChild(add);
          }
        }
        openCb.onchange = paint;
        paint();
        dayList.appendChild(row);
      }
      DAYS.forEach(([k, label]) => renderDay(k, label));
      return {
        root,
        getHours() { const out = {}; DAYS.forEach(([k]) => { out[k] = (hours[k] || []).map((w) => ({ start: w.start, end: w.end })); }); return out; },
      };
    }

    async function secResources(panel) {
      const wOne = App.label("resource", "one");
      const wMany = App.label("resource", "many");
      panel.innerHTML = `<h2 class="settings-h">${esc(wMany)}</h2>
        <p class="cell-muted" style="font-size:13px;margin-bottom:14px">Create the ${esc(wMany.toLowerCase())} a booking can be assigned to. Rename this word any time on the Labels page. Colors are saved now for upcoming calendar coloring.</p>
        <div id="res-host"><div class="cell-muted" style="padding:8px">Loading…</div></div>`;
      const host = App.util.$("#res-host");
      let items = [];
      let bizHours = {};
      let bizServices = [];     // [{ key, label }]
      let bizDur = {};          // business per-service durations { key: min }
      let bizDefaultDur = 30;   // business default duration
      let bizBuffer = 0;        // business buffer

      async function load() {
        try {
          const [res, bc] = await Promise.all([
            App.portalApi("/api/resources"),
            App.portalApi("/api/booking-config").catch(() => null),
          ]);
          items = res || [];
          bizHours = (bc && bc.config && bc.config.hours) || {};
          bizServices = (bc && bc.services) || [];
          bizDur = (bc && bc.config && bc.config.serviceDurations) || {};
          bizDefaultDur = (bc && bc.config && Number(bc.config.defaultDurationMin)) || 30;
          bizBuffer = (bc && bc.config && Number(bc.config.bufferMin)) || 0;
        } catch (e) { host.innerHTML = `<p class="cell-muted">${esc(e.message)}</p>`; return; }
        render();
      }

      function render() {
        host.innerHTML = "";
        const card = el("div", "card"); card.style.cssText = "padding:18px; max-width:560px;";

        // Add row: name + color + Add
        const addWrap = el("div"); addWrap.style.cssText = "display:flex; gap:8px; align-items:center; margin-bottom:8px;";
        const nameInp = el("input", "input"); nameInp.type = "text"; nameInp.placeholder = wOne + " name"; nameInp.style.cssText = "margin-bottom:0; flex:1;";
        const colorInp = el("input"); colorInp.type = "color"; colorInp.value = "#6366f1"; colorInp.title = "Color"; colorInp.style.cssText = "width:40px; height:34px; padding:2px; border:1px solid var(--line); border-radius:8px; cursor:pointer;";
        const addBtn = el("button", "btn btn-primary btn-sm", "Add");
        addBtn.onclick = async () => {
          const name = nameInp.value.trim();
          if (!name) { toast("Name is required", true); nameInp.focus(); return; }
          addBtn.disabled = true;
          try { await App.portalApi("/api/resources", { method: "POST", body: JSON.stringify({ name, color: colorInp.value }) }); toast(wOne + " added"); nameInp.value = ""; await load(); }
          catch (e) { toast(e.message, true); addBtn.disabled = false; }
        };
        nameInp.onkeydown = (e) => { if (e.key === "Enter") addBtn.click(); };
        addWrap.appendChild(nameInp); addWrap.appendChild(colorInp); addWrap.appendChild(addBtn);
        card.appendChild(addWrap);

        // Existing list
        if (!items.length) {
          card.appendChild(el("p", "cell-muted", "No " + wMany.toLowerCase() + " yet — add one above."));
        } else {
          items.forEach((r) => {
            const row = el("div"); row.style.cssText = "display:flex; gap:10px; align-items:center; padding:9px 0; border-top:1px solid var(--line);";
            const sw = el("input"); sw.type = "color"; sw.value = r.color || "#6366f1"; sw.title = "Color"; sw.style.cssText = "width:34px; height:30px; padding:2px; border:1px solid var(--line); border-radius:7px; cursor:pointer; flex:0 0 auto;";
            sw.onchange = async () => { try { await App.portalApi("/api/resources/" + r.id, { method: "PATCH", body: JSON.stringify({ color: sw.value }) }); r.color = sw.value; toast("Saved"); } catch (e) { toast(e.message, true); sw.value = r.color || "#6366f1"; } };
            const nm = el("div"); nm.style.cssText = "flex:1; font-weight:500;";
            nm.appendChild(document.createTextNode(r.name));
            if (r.hours) { const tag = el("span", "cell-muted"); tag.textContent = " · custom hours"; tag.style.fontWeight = "400"; nm.appendChild(tag); }
            const hrs = el("button", "btn btn-ghost btn-sm", "Hours");
            hrs.onclick = () => openResourceHours(r);
            const ren = el("button", "btn btn-ghost btn-sm", "Rename");
            ren.onclick = async () => {
              const v = await promptModal({ title: "Rename " + wOne, label: "Name", value: r.name, okText: "Rename" });
              if (v === null || !v.trim()) return;
              try { await App.portalApi("/api/resources/" + r.id, { method: "PATCH", body: JSON.stringify({ name: v.trim() }) }); toast("Renamed"); await load(); }
              catch (e) { toast(e.message, true); }
            };
            const del = el("button", "btn btn-ghost btn-sm", "Delete"); del.style.color = "var(--red)";
            del.onclick = async () => {
              if (!(await confirmModal({ title: "Delete " + wOne, message: `Delete “${r.name}”?`, confirmText: "Delete" }))) return;
              try { await App.portalApi("/api/resources/" + r.id, { method: "DELETE" }); toast("Deleted"); await load(); }
              catch (e) {
                // Blocked because bookings are still assigned — explain, don't delete.
                if (e && e.data && e.data.code === "resource_in_use") { await confirmModal({ title: "Can’t delete yet", message: e.message, confirmText: "OK" }); }
                else { toast(e.message, true); }
              }
            };
            row.appendChild(sw); row.appendChild(nm); row.appendChild(hrs); row.appendChild(ren); row.appendChild(del);
            card.appendChild(row);
          });
        }
        host.appendChild(card);
      }

      // Per-resource hours modal: "Use business hours" toggle + the shared weekly
      // editor. Saving with the box checked stores null (fallback); unchecked
      // stores the custom object (even if some days are closed).
      function openResourceHours(r) {
        const usingBiz = !r.hours;
        const inner = el("div");
        inner.innerHTML = `<div class="modal-head"><h2>Hours &amp; lengths · ${esc(r.name)}</h2><button class="icon-btn" id="rh-close">&times;</button></div>`;
        const body = el("div", "modal-body");

        const useWrap = el("label"); useWrap.style.cssText = "display:flex; gap:8px; align-items:center; cursor:pointer; margin-bottom:12px;";
        const useCb = el("input"); useCb.type = "checkbox"; useCb.checked = usingBiz;
        useWrap.appendChild(useCb); useWrap.appendChild(el("span", null, "Use business hours"));
        body.appendChild(useWrap);

        const help = el("p", "cell-muted", "When on, this " + wOne.toLowerCase() + " follows the business hours. Turn off to set their own weekly hours.");
        help.style.cssText = "font-size:12.5px; margin:-6px 0 12px;";
        body.appendChild(help);

        // Seed the editor with the resource's custom hours, or the business hours
        // as a starting point when they have none yet.
        const ed = buildHoursEditor(r.hours || bizHours);
        const edWrap = el("div"); edWrap.appendChild(ed.root); body.appendChild(edWrap);
        const syncVis = () => { edWrap.style.display = useCb.checked ? "none" : ""; };
        useCb.onchange = syncVis; syncVis();

        // ── Appointment lengths & buffer (optional; blank = use business value) ──
        const durHead = el("h3", null, "Appointment lengths & buffer");
        durHead.style.cssText = "font-size:13px; font-weight:600; margin:18px 0 4px; padding-top:14px; border-top:1px solid var(--line);";
        body.appendChild(durHead);
        const durHelp = el("p", "cell-muted", "Leave a box blank to use the business default (shown as the placeholder). Set a number to give this " + wOne.toLowerCase() + " their own length for that service.");
        durHelp.style.cssText = "font-size:12.5px; margin:0 0 12px;";
        body.appendChild(durHelp);

        const resDur = (r.durations && typeof r.durations === "object") ? r.durations : {};
        const durInputs = {}; // serviceKey → input
        const mkRow = (labelText, placeholder, value) => {
          const row = el("div"); row.style.cssText = "display:flex; align-items:center; gap:10px; margin-bottom:8px;";
          const lab = el("label", null, labelText); lab.style.cssText = "flex:1; font-size:13px;";
          const inp = el("input", "input"); inp.type = "number"; inp.min = "1"; inp.step = "1";
          inp.placeholder = String(placeholder); inp.style.cssText = "width:110px; margin-bottom:0;";
          if (value != null && value !== "") inp.value = String(value);
          const unit = el("span", "cell-muted", "min"); unit.style.cssText = "font-size:12px;";
          row.appendChild(lab); row.appendChild(inp); row.appendChild(unit);
          return { row, inp };
        };
        (bizServices || []).forEach((svc) => {
          const bizVal = Number(bizDur[svc.key]) > 0 ? Number(bizDur[svc.key]) : bizDefaultDur;
          const cur = Number(resDur[svc.key]) > 0 ? Number(resDur[svc.key]) : "";
          const { row, inp } = mkRow(svc.label || svc.key, bizVal, cur);
          durInputs[svc.key] = inp; body.appendChild(row);
        });
        if (!(bizServices || []).length) {
          const none = el("p", "cell-muted", "No services defined yet — add services on the Fields page to set custom lengths.");
          none.style.cssText = "font-size:12.5px; margin:0 0 8px;"; body.appendChild(none);
        }
        // Buffer row (separated a touch from the per-service rows).
        const bufWrap = el("div"); bufWrap.style.cssText = "margin-top:10px;";
        const bufCur = (typeof r.bufferMin === "number") ? r.bufferMin : "";
        const { row: bufRow, inp: bufInp } = mkRow("Buffer between appointments", bizBuffer, bufCur);
        bufInp.min = "0";
        bufWrap.appendChild(bufRow); body.appendChild(bufWrap);

        inner.appendChild(body);
        const foot = el("div", "modal-foot");
        const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
        const save = el("button", "btn btn-primary btn-sm", "Save");
        foot.appendChild(cancel); foot.appendChild(save);
        inner.appendChild(foot);
        const overlay = modal(inner);
        const close = () => overlay.remove();
        inner.querySelector("#rh-close").onclick = close;
        cancel.onclick = close;
        overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
        save.onclick = async () => {
          // Durations: collect only the boxes with a positive number; empty → omit
          // (that service falls back to business). No filled boxes → null.
          const durations = {};
          Object.keys(durInputs).forEach((k) => { const n = parseInt(durInputs[k].value, 10); if (Number.isFinite(n) && n > 0) durations[k] = n; });
          const durPayload = Object.keys(durations).length ? durations : null;
          // Buffer: blank → null (use business); a number ≥ 0 → that.
          const bufRaw = bufInp.value.trim();
          let bufferMin = null;
          if (bufRaw !== "") { const bn = parseInt(bufRaw, 10); bufferMin = (Number.isFinite(bn) && bn >= 0) ? bn : null; }
          const payload = { hours: useCb.checked ? null : ed.getHours(), durations: durPayload, bufferMin };
          save.disabled = true; save.textContent = "Saving…";
          try { await App.portalApi("/api/resources/" + r.id, { method: "PATCH", body: JSON.stringify(payload) }); toast("Saved"); close(); await load(); }
          catch (e) { toast(e.message, true); save.disabled = false; save.textContent = "Save"; }
        };
      }

      load();
    }

    async function secSchedulingResources(panel) {
      // Combined tab: render the two EXISTING panels stacked, each into its own
      // container so their innerHTML writes and #sched-host/#res-host lookups never
      // collide. Both builders keep their own Save wiring — no save logic is merged.
      panel.innerHTML = "";
      const schedWrap = el("div");
      const resWrap = el("div");
      resWrap.style.marginTop = "32px";
      panel.appendChild(schedWrap);
      panel.appendChild(resWrap);
      await secScheduling(schedWrap);
      await secResources(resWrap);
    }

    async function secScheduling(panel) {
      panel.innerHTML = `<h2 class="settings-h">Scheduling</h2>
        <p class="cell-muted" style="font-size:13px;margin-bottom:14px">Set your open hours, how long each service takes, and a buffer between appointments. These drive the Availability Preview on the Bookings page. Services themselves are managed on the Fields page.</p>
        <div id="sched-host"><div class="cell-muted" style="padding:8px">Loading…</div></div>`;
      const host = App.util.$("#sched-host");

      let data;
      try { data = await App.portalApi("/api/booking-config"); }
      catch (e) { host.innerHTML = `<p class="cell-muted">${esc(e.message)}</p>`; return; }
      const cfg = data.config || {};
      const services = data.services || [];

      host.innerHTML = "";

      // ---- Weekly hours (shared editor) ----
      const hoursCard = el("div", "settings-card card");
      hoursCard.appendChild(el("div", "settings-h", "Weekly hours"));
      const hoursEd = buildHoursEditor(cfg.hours);
      hoursCard.appendChild(hoursEd.root);

      // ---- Durations + buffer ----
      const durCard = el("div", "settings-card card");
      durCard.style.marginTop = "16px";
      durCard.appendChild(el("div", "settings-h", "Appointment lengths"));

      const defWrap = el("div"); defWrap.style.cssText = "display:flex; align-items:center; gap:10px; margin-bottom:12px;";
      defWrap.appendChild(el("label", "field-label", "Default length (min)"));
      const defInp = el("input", "input"); defInp.type = "number"; defInp.min = "1"; defInp.value = cfg.defaultDurationMin || 30; defInp.style.cssText = "margin-bottom:0; width:100px;";
      defWrap.appendChild(defInp);
      durCard.appendChild(defWrap);

      const bufWrap = el("div"); bufWrap.style.cssText = "display:flex; align-items:center; gap:10px; margin-bottom:14px;";
      bufWrap.appendChild(el("label", "field-label", "Buffer between appts (min)"));
      const bufInp = el("input", "input"); bufInp.type = "number"; bufInp.min = "0"; bufInp.value = cfg.bufferMin || 0; bufInp.style.cssText = "margin-bottom:0; width:100px;";
      bufWrap.appendChild(bufInp);
      durCard.appendChild(bufWrap);

      const svcDurInputs = {};
      if (services.length) {
        durCard.appendChild(el("label", "field-label", "Per-service length (min) — blank uses the default"));
        services.forEach((s) => {
          const r = el("div"); r.style.cssText = "display:flex; align-items:center; gap:10px; margin:6px 0;";
          const nm = el("div"); nm.textContent = s.label; nm.style.cssText = "width:200px;";
          const inp = el("input", "input"); inp.type = "number"; inp.min = "1";
          inp.placeholder = String(cfg.defaultDurationMin || 30);
          const cur = (cfg.serviceDurations || {})[s.key];
          inp.value = cur ? String(cur) : "";
          inp.style.cssText = "margin-bottom:0; width:100px;";
          svcDurInputs[s.key] = inp;
          r.appendChild(nm); r.appendChild(inp);
          durCard.appendChild(r);
        });
      } else {
        durCard.appendChild(el("p", "cell-muted", "No services defined yet — add them on the Fields page."));
      }

      // Policy: allow double-booking on/off (default off = block, with manual override).
      const dblWrap = el("div"); dblWrap.style.cssText = "margin-top:16px; padding-top:14px; border-top:1px solid var(--line);";
      const dblL = el("label"); dblL.style.cssText = "display:flex; gap:8px; align-items:flex-start; cursor:pointer;";
      const dblChk = el("input"); dblChk.type = "checkbox"; dblChk.checked = cfg.allowDoubleBooking === true; dblChk.style.marginTop = "2px";
      const dblTxt = el("div");
      dblTxt.appendChild(el("div", "field-label", "Allow double-booking"));
      dblTxt.appendChild(el("p", "cell-muted", "When off, overlapping bookings are blocked. You can still override a manual booking with a warning; the AI receptionist never double-books."));
      dblL.appendChild(dblChk); dblL.appendChild(dblTxt);
      dblWrap.appendChild(dblL);
      durCard.appendChild(dblWrap);

      const saveBtn = el("button", "btn btn-primary btn-sm", "Save scheduling");
      saveBtn.style.marginTop = "16px";
      saveBtn.onclick = async () => {
        // Build the hours payload: every day explicit ([] = closed).
        const hoursOut = hoursEd.getHours();
        const serviceDurations = {};
        Object.keys(svcDurInputs).forEach((key) => { const v = parseInt(svcDurInputs[key].value, 10); if (Number.isFinite(v) && v > 0) serviceDurations[key] = v; });
        const payload = {
          hours: hoursOut,
          defaultDurationMin: parseInt(defInp.value, 10) || 30,
          bufferMin: parseInt(bufInp.value, 10) || 0,
          serviceDurations,
          allowDoubleBooking: dblChk.checked,
        };
        saveBtn.disabled = true; saveBtn.textContent = "Saving…";
        try { await App.portalApi("/api/booking-config", { method: "PATCH", body: JSON.stringify(payload) }); toast("Scheduling saved"); }
        catch (e) { toast(e.message, true); }
        finally { saveBtn.disabled = false; saveBtn.textContent = "Save scheduling"; }
      };

      host.appendChild(hoursCard);
      host.appendChild(durCard);
      host.appendChild(saveBtn);
    }

    async function secAccount(panel) {
      panel.innerHTML = `<h2 class="settings-h">Your account</h2>
        <div class="field-grid">
          ${field("Name", me.name || "—")}
          ${field("Email", me.email)}
          ${field("Role", roleLabel(me.role))}
        </div>
        <label class="field-label">Change password</label>
        <div class="add-user"><input id="acct-pass" class="input" type="password" placeholder="New password (8+)" />
          <button id="acct-save" class="btn btn-ghost btn-sm">Update password</button></div>
        <label class="field-label" style="margin-top:8px">Email signature</label>
        <div id="sig-host"></div>
        <button id="sig-save" class="btn btn-ghost btn-sm" style="margin-top:10px">Save signature</button>`;
      App.util.$("#acct-save").onclick = async () => {
        const pass = App.util.$("#acct-pass").value;
        if (!pass || pass.length < 8) { toast("Password must be at least 8 characters", true); return; }
        try { await App.portalApi("/api/account/password", { method: "POST", body: JSON.stringify({ password: pass }) }); toast("Password updated"); App.util.$("#acct-pass").value = ""; }
        catch (err) { toast(err.message, true); }
      };
      const sigApi = App.compose.mount(App.util.$("#sig-host"), { kind: "richtext" });
      App.portalApi("/api/account/signature").then((r) => { sigApi.setBody((r && r.signature) || ""); }).catch(() => {});
      App.util.$("#sig-save").onclick = async () => {
        try { await App.portalApi("/api/account/signature", { method: "PATCH", body: JSON.stringify({ signature: sigApi.getHTML() }) }); toast("Signature saved"); }
        catch (err) { toast(err.message, true); }
      };
    }

    // Labels editor — TWO groups:
    //  1) "What things are called": the concept nouns (record types + record/stage)
    //     that ripple through the app. Type the SINGULAR; the plural auto-fills and
    //     stays editable. Record types write label/labelPlural; generic words go to
    //     Tenant.labels.
    //  2) "Pages & navigation": the left-nav items — rename the fixed ones, drag to
    //     reorder, and show/hide. All written to the ONE nav config (Tenant.labels.nav)
    //     that the sidebar and the later per-row menu both read. Items already named
    //     by group 1 (e.g. Contacts→Clients) keep that name here — not renamed twice.

    // RESERVED — links out to the existing Fields route (not moved in this step).
    async function secFields(panel) {
      // Host the full Fields editor inline here (relocated from the old #/fields page).
      // Reuse renderFields verbatim; only its mount target changes. refresh=true skips
      // loading() so the surrounding settings shell isn't wiped, and routes every
      // internal renderFields(true) refresh back into this panel.
      panel.innerHTML = "";
      const host = el("div");
      panel.appendChild(host);
      fieldsMount = host;
      await renderFields(true, host);
    }
  }

  function fillUsers(users, customRoles) {
    customRoles = customRoles || [];
    const tb = App.util.$("#users-tbody");
    if (!tb) return;
    const isAdminTier = (r) => r === "OWNER" || r === "SUPER_ADMIN" || r === "AUDITOR";
    tb.innerHTML = "";
    users.forEach((u) => {
      const tr = el("tr");
      // Role cell: an editable dropdown for ordinary portal members; a plain label for
      // pending invites, yourself, and super-admin-tier users (Cap #2 — can't reassign
      // them; the server also enforces this).
      const editable = !u.pending && u.id !== App.state.me.id && !isAdminTier(u.role);
      let roleCell;
      if (u.pending) {
        roleCell = esc(roleLabel(u.role)) + ' <span class="badge badge-progress">Pending</span>';
      } else if (editable) {
        const sysOpt = (val, label) => `<option value="${val}"${!u.customRoleId && u.role === val ? " selected" : ""}>${label}</option>`;
        const custOpts = customRoles.map((r) => `<option value="${r.id}"${u.customRoleId === r.id ? " selected" : ""}>${esc(r.name)}</option>`).join("");
        roleCell = `<select class="input role-sel" data-uid="${esc(u.id)}" style="padding:4px 6px;font-size:13px">${sysOpt("CLIENT_USER", "Client User")}${sysOpt("PORTAL_ADMIN", "Portal Admin")}${custOpts ? `<optgroup label="Custom roles">${custOpts}</optgroup>` : ""}</select>`;
      } else {
        const cr = u.customRoleId ? customRoles.find((r) => r.id === u.customRoleId) : null;
        roleCell = esc(cr ? cr.name : roleLabel(u.role));
      }
      tr.innerHTML = `<td>${esc(u.name || "—")}</td><td class="cell-muted">${esc(u.email)}</td><td>${roleCell}</td><td></td>`;
      const actions = tr.lastChild;
      if (u.pending) {
        const rev = el("button", "link-danger", "Revoke");
        rev.onclick = async () => { if (!(await confirmModal({ title: "Revoke invite", message: `Revoke the pending invite for ${u.email}?`, confirmText: "Revoke" }))) return; try { await App.portalApi(`/api/invites/${u.inviteId}/revoke`, { method: "POST" }); toast("Invite revoked"); renderSettings(); } catch (e) { toast(e.message, true); } };
        actions.appendChild(rev);
      } else if (u.id !== App.state.me.id) {
        const del = el("button", "link-danger", "Remove");
        del.onclick = async () => { if (!(await confirmModal({ title: "Remove user", message: `Remove ${u.email}?`, confirmText: "Remove" }))) return; try { await App.portalApi(`/api/users/${u.id}`, { method: "DELETE" }); toast("User removed"); renderSettings(); } catch (e) { toast(e.message, true); } };
        actions.appendChild(del);
      }
      tb.appendChild(tr);
    });
    // Wire role dropdowns: assigning a custom role sets the member's effective
    // permissions to that role (server sets base CLIENT_USER + customRoleId).
    tb.querySelectorAll(".role-sel").forEach((sel) => {
      const prev = sel.value;
      sel.onchange = async () => {
        try { await App.portalApi(`/api/users/${sel.getAttribute("data-uid")}/role`, { method: "PATCH", body: JSON.stringify({ role: sel.value }) }); toast("Role updated"); }
        catch (e) { toast(e.message, true); sel.value = prev; }
      };
    });
  }

  // ---------------- Import (with column mapping) ----------------
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (ch === "\r") { /* skip */ }
        else field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  function guessMap(headers) {
    const find = (...keys) => { const i = headers.findIndex((h) => keys.some((k) => h.toLowerCase().trim().includes(k))); return i; };
    return {
      name: find("name", "contact", "full"),
      phone: find("phone", "mobile", "cell", "number", "tel"),
      email: find("email", "e-mail"),
      intent: find("reason", "intent", "note", "subject", "message", "inquiry"),
    };
  }

  function modal(inner) {
    const overlay = el("div", "modal-overlay");
    const box = el("div", "modal");
    box.appendChild(inner);
    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    return overlay;
  }

  // Styled in-app replacement for the native prompt() box. Resolves the typed
  // string, or null on cancel/close/Escape. Enter submits.
  function promptModal(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const inner = el("div");
      inner.innerHTML = `<div class="modal-head"><h2>${esc(opts.title || "Enter a value")}</h2><button class="icon-btn" id="pm-close">&times;</button></div>`;
      const body = el("div", "modal-body");
      if (opts.label) body.appendChild(el("label", "field-label", esc(opts.label)));
      const input = el("input", "input");
      input.type = "text";
      input.value = opts.value || "";
      if (opts.placeholder) input.placeholder = opts.placeholder;
      body.appendChild(input);
      inner.appendChild(body);
      const foot = el("div", "modal-foot");
      const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
      const ok = el("button", "btn btn-primary btn-sm", opts.okText || "Save");
      foot.appendChild(cancel); foot.appendChild(ok);
      inner.appendChild(foot);
      const overlay = modal(inner);
      let done = false;
      const finish = (val) => { if (done) return; done = true; overlay.remove(); resolve(val); };
      inner.querySelector("#pm-close").onclick = () => finish(null);
      cancel.onclick = () => finish(null);
      ok.onclick = () => finish(input.value);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(input.value); } else if (e.key === "Escape") { finish(null); } });
      overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(null); });
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }
  // Expose the ONE styled prompt component so other modules (reports, compose,
  // theme) reuse it instead of native prompt() — no second component invented.
  App.ui = App.ui || {};
  App.ui.promptModal = promptModal;

  // Styled yes/cancel dialog for DESTRUCTIVE/irreversible actions. Safety-matched
  // to the native confirm() it replaces — and stricter:
  //  - NOT dismissable by clicking outside (overlay has no close handler).
  //  - Enter is swallowed (does nothing); Escape = cancel.
  //  - Default focus is the CANCEL button, never the confirm button.
  //  - The confirm button names the action ("Delete", "Merge", …), styled danger.
  // Resolves true only on an explicit click of the confirm button.
  function confirmModal(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const overlay = el("div", "modal-overlay");
      const box = el("div", "modal");
      const inner = el("div");
      inner.innerHTML = `<div class="modal-head"><h2>${esc(opts.title || "Please confirm")}</h2></div>`;
      const body = el("div", "modal-body");
      const p = el("p", "confirm-msg");
      p.textContent = opts.message || "Are you sure?";
      body.appendChild(p);
      inner.appendChild(body);
      const foot = el("div", "modal-foot");
      const cancelBtn = el("button", "btn btn-ghost btn-sm", opts.cancelText || "Cancel");
      const okBtn = el("button", "btn btn-sm " + (opts.danger === false ? "btn-primary" : "btn-danger"), opts.confirmText || "Confirm");
      foot.appendChild(cancelBtn); foot.appendChild(okBtn);
      inner.appendChild(foot);
      box.appendChild(inner);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      let done = false;
      const finish = (val) => { if (done) return; done = true; document.removeEventListener("keydown", onKey, true); overlay.remove(); resolve(val); };
      cancelBtn.onclick = () => finish(false);
      okBtn.onclick = () => finish(true);
      // Intentionally NO click-outside dismissal — clicking the overlay does nothing.
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
        else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); } // swallow stray Enter: no dismiss, no confirm
      }
      document.addEventListener("keydown", onKey, true);
      setTimeout(() => cancelBtn.focus(), 0); // default focus = Cancel
    });
  }
  App.ui.confirmModal = confirmModal;

  // Styled modal shown when a record-level Status delete is BLOCKED. Lists the
  // records holding it (linked to their profiles) and the automations that
  // reference it (linked to the Automations page, with a where-used note).
  // Read-only — no auto-fix. Blockers shape comes from the 409 response.
  function statusBlockedModal(blockers) {
    blockers = blockers || {};
    const st = blockers.status || {};
    const records = blockers.records || [];
    const autos = blockers.automations || [];
    const recordCount = blockers.recordCount || records.length;
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Can’t delete “${esc(st.label || st.key || "status")}”</h2><button class="icon-btn" id="sb-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    const intro = el("p", "muted");
    intro.style.cssText = "margin:0 0 12px; font-size:13px;";
    intro.textContent = "This status is still in use. Move these onto another status (or change the automations), then delete it.";
    body.appendChild(intro);
    const overlay = modal(inner);
    if (recordCount > 0) {
      body.appendChild(el("div", "fields-section-name", `${recordCount} record${recordCount === 1 ? "" : "s"} using this status`));
      const ul = el("div", "stage-list");
      records.forEach((r) => {
        const row = el("div", "stage-row");
        const a = el("a", "stage-name", esc(r.title || "(untitled)"));
        a.href = "#/record/" + r.id; a.style.cursor = "pointer";
        a.onclick = (e) => { e.preventDefault(); overlay.remove(); App.go("#/record/" + r.id); };
        row.appendChild(a);
        ul.appendChild(row);
      });
      if (recordCount > records.length) ul.appendChild(el("div", "cell-muted", `…and ${recordCount - records.length} more`));
      body.appendChild(ul);
    }
    if (autos.length) {
      const h = el("div", "fields-section-name", `${autos.length} automation${autos.length === 1 ? "" : "s"} referencing this status`);
      h.style.marginTop = "14px";
      body.appendChild(h);
      const ul = el("div", "stage-list");
      autos.forEach((a) => {
        const row = el("div", "stage-row");
        const link = el("a", "stage-name", esc(a.name || "(untitled automation)"));
        link.href = "#/automations"; link.style.cursor = "pointer";
        link.onclick = (e) => { e.preventDefault(); overlay.remove(); App.go("#/automations"); };
        row.appendChild(link);
        row.appendChild(el("div", "cell-muted", "used in " + ((a.where || []).join(", ") || "this automation")));
        ul.appendChild(row);
      });
      body.appendChild(ul);
    }
    inner.appendChild(body);
    const foot = el("div", "modal-foot");
    const ok = el("button", "btn btn-primary btn-sm", "Got it");
    foot.appendChild(ok);
    inner.appendChild(foot);
    inner.querySelector("#sb-close").onclick = () => overlay.remove();
    ok.onclick = () => overlay.remove();
  }

  // Manual trigger: pick an enabled Manual flow and run it on this contact now.
  // Conditions are still evaluated server-side; if they don't match, the flow is
  // reported as skipped and no actions run.
  async function openRunAutomation(contactId, contactName) {
    let flows;
    try { flows = await App.portalApi("/api/automations/manual"); }
    catch (e) { App.util.toast(e.message, true); return; }
    if (!flows || !flows.length) {
      App.util.toast("No manual automations yet. Create one in Automations with the “Manual” trigger.", true);
      return;
    }
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Run automation on ${esc(contactName)}</h2><button class="icon-btn" id="ra-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    inner.appendChild(body);
    const out = el("div");
    out.style.marginTop = "10px";
    flows.forEach((f) => {
      const rowEl = el("div", "action-row");
      rowEl.style.display = "flex";
      rowEl.style.alignItems = "center";
      rowEl.style.justifyContent = "space-between";
      rowEl.style.gap = "10px";
      const nm = el("div", null, `<strong>${esc(f.name)}</strong>`);
      const run = el("button", "btn btn-primary btn-sm", "Run");
      run.onclick = async () => {
        run.disabled = true; run.textContent = "Running…";
        out.innerHTML = `<div class="cell-muted">Running…</div>`;
        try {
          const res = await App.portalApi(`/api/automations/${f.id}/run`, { method: "POST", body: JSON.stringify({ contactId }) });
          out.innerHTML = "";
          out.appendChild(runResult(res));
          App.util.toast(res && res.matched ? "Automation ran" : "Automation skipped (conditions not met)");
        } catch (e) { out.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; }
        finally { run.disabled = false; run.textContent = "Run"; }
      };
      rowEl.appendChild(nm); rowEl.appendChild(run);
      body.appendChild(rowEl);
    });
    body.appendChild(out);
    const overlay = modal(inner);
    inner.querySelector("#ra-close").onclick = () => overlay.remove();
  }

  // Compact per-run result for the manual-run modal.
  function runResult(r) {
    if (!r) return el("div", "cell-muted", "No result returned.");
    const box = el("div", "card");
    box.style.marginTop = "8px";
    const head = el("div", null, r.matched
      ? `<strong>Ran.</strong> Conditions matched.`
      : `<strong>Skipped.</strong> Conditions did not match, so no actions ran.`);
    box.appendChild(head);
    (r.results || []).forEach((x) => {
      const line = el("div", "cell-muted");
      line.style.marginTop = "4px";
      line.textContent = `${x.type}: ${x.status}${x.detail ? " — " + x.detail : ""}${x.error ? " — " + x.error : ""}`;
      box.appendChild(line);
    });
    return box;
  }

  async function openImport() {
    const settings = await App.portalApi("/api/settings").catch(() => ({}));
    const requireEmail = settings && settings.requireEmail !== false;
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Import contacts</h2><button class="icon-btn" id="imp-close">&times;</button></div>
      <div class="modal-body">
        <p class="cell-muted">Upload a CSV or Excel file (.csv, .xlsx). You'll map its columns to the fields below before importing.${requireEmail ? (" This CRM requires a unique email on every " + App.label("contact","one").toLowerCase() + ", so the Email column must be mapped.") : ""}</p>
        <input type="file" id="imp-file" accept=".csv,.xlsx,.xls,text/csv" class="input" />
        <div id="imp-step2"></div>
        <div class="ex-history-head" style="margin-top:16px">Previous imports</div>
        <div id="imp-history" class="ex-history"><div class="cell-muted">Loading…</div></div>
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#imp-close").onclick = () => overlay.remove();
    renderImportHistory(inner.querySelector("#imp-history"), "contact");
    inner.querySelector("#imp-file").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      readFileRows(file, (rows) => {
        if (!rows || rows.length < 2) { toast("That file has no data rows", true); return; }
        const headers = rows[0].map((h) => String(h).trim());
        const dataRows = rows.slice(1);
        renderMapping(inner.querySelector("#imp-step2"), headers, dataRows, overlay, requireEmail);
      });
    };
  }

  function renderMapping(host, headers, dataRows, overlay, requireEmail) {
    const guess = guessMap(headers);
    const fields = [["name", "Name"], ["phone", "Phone"], ["email", requireEmail ? "Email (required)" : "Email"], ["intent", "Reason / notes"]];
    const optionsHtml = (sel) => `<option value="-1">— skip —</option>` + headers.map((h, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(h)}</option>`).join("");
    host.innerHTML = `<div class="map-grid">${fields.map(([k, lbl]) => `
      <label class="field-label">${esc(lbl)}</label>
      <select class="input map-sel" data-field="${k}">${optionsHtml(guess[k])}</select>`).join("")}</div>
      <p class="cell-muted" id="imp-count">${dataRows.length} rows detected.${requireEmail ? " Rows with no email, or a duplicate email, will be skipped." : " Rows need at least an email or a phone."}</p>
      <button class="btn btn-primary btn-block" id="imp-go">Import ${dataRows.length} contacts</button>`;
    host.querySelector("#imp-go").onclick = async () => {
      const map = {};
      App.util.$$(".map-sel", host).forEach((s) => { map[s.dataset.field] = parseInt(s.value, 10); });
      if (requireEmail && map.email < 0) { toast("This CRM requires email — map the Email column", true); return; }
      if (!requireEmail && map.email < 0 && map.phone < 0) { toast("Map at least a Phone or Email column", true); return; }
      const mapped = dataRows.map((r) => ({
        name: map.name >= 0 ? r[map.name] : null,
        phone: map.phone >= 0 ? r[map.phone] : null,
        email: map.email >= 0 ? r[map.email] : null,
        intent: map.intent >= 0 ? r[map.intent] : null,
      }));
      const btn = host.querySelector("#imp-go");
      btn.disabled = true; btn.textContent = "Importing…";
      try {
        const res = await App.portalApi("/api/contacts/import", { method: "POST", body: JSON.stringify({ rows: mapped }) });
        toast(`Imported ${App.countLabel("contact", res.imported).toLowerCase()}${res.skipped ? `, skipped ${res.skipped}` : ""}`);
        overlay.remove();
        if (current === "contacts") renderContacts();
      } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = "Import"; }
    };
  }

  // ================= Records (generic record types, e.g. Jobs) =================
  // Reuses the existing table component, saved filters, manage-columns popup, and
  // field editor. Column layout for record types is kept in the browser (no
  // migration); contacts keep their server-synced layout untouched.
  function recordLayoutKey(typeKey) { return "recordcols:" + (App.state.currentPortalId || "p") + ":" + typeKey; }
  function loadRecordLayout(typeKey) { try { return JSON.parse(localStorage.getItem(recordLayoutKey(typeKey)) || "{}") || {}; } catch (e) { return {}; } }
  function saveRecordLayout(typeKey, layout) { try { localStorage.setItem(recordLayoutKey(typeKey), JSON.stringify(layout || {})); } catch (e) {} }
  function applyRecordLayout(all, layout) {
    const byKey = {}; all.forEach((c) => (byKey[c.key] = c));
    const has = layout && ((layout.order || []).length || (layout.hidden || []).length);
    if (!has) return all.slice(); // default: show every column for record types
    const hidden = new Set(layout.hidden || []);
    const ordered = [];
    (layout.order || []).forEach((k) => { if (byKey[k]) ordered.push(byKey[k]); });
    all.forEach((c) => { if (ordered.indexOf(c) === -1) ordered.push(c); });
    return ordered.filter((c) => !hidden.has(c.key));
  }

  function recordStageLabel(type, key) {
    const s = ((type && type.recordStages) || []).find((x) => x.key === key);
    return s ? s.label : (key || "");
  }

  function subtypeLabel(type, key) {
    const s = ((type && type.subtypes) || []).find((x) => x.key === key);
    return s ? s.label : (key || "");
  }

  // appointmentAt is a WALL-CLOCK time (the exact digits the owner typed),
  // stored in the timestamp's UTC slot. We read and show it WITHOUT timezone
  // conversion — UTC getters / timeZone:"UTC" — so "5:00 PM" saved reads back as
  // "5:00 PM" on any server zone and any browser zone. (Real moments like
  // createdAt are different and still use fmtDate, which shows local time.)
  function fmtAppt(iso) {
    if (!iso) return "";
    const d = new Date(iso); if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  // Fill the <input type="datetime-local"> from the stored wall-clock, reading
  // the SAME digits back (UTC getters) — never converting to the browser's zone.
  function isoToLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso); if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }

  // Read-only week/day calendar of bookings. Renders existing bookings as blocks
  // positioned by their WALL-CLOCK time (UTC components, never local conversion),
  // with open hours shaded from bookingConfig. Click a booking to open it. No
  // create-from-empty-slot and no write-lock in this batch.
  function renderBookingCalendar(host, type, fields) {
    const HOUR_H = 44; // px per hour
    // Status styling reuses the app's theme tokens, plus a SECOND, color-independent
    // signal so status is readable when color is washed out or for colorblind users:
    // a distinct SHAPE glyph and the spelled-out status word. Keyed by stable stage
    // keys; unknown/custom statuses fall back to the accent token + a diamond.
    const STATUS_META = {
      requested: { bg: "var(--amber-soft)", fg: "var(--amber)", glyph: "○" },
      confirmed: { bg: "var(--green-soft)", fg: "var(--green)", glyph: "●" },
      completed: { bg: "var(--gray-soft)", fg: "var(--ink-soft)", glyph: "✓" },
      no_show: { bg: "var(--red-soft)", fg: "var(--red)", glyph: "✕" },
    };
    const metaFor = (k) => STATUS_META[k] || { bg: "var(--accent-soft)", fg: "var(--accent)", glyph: "◆" };
    const pad = (n) => String(n).padStart(2, "0");
    const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const parseYmd = (ymd) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    const addDays = (ymd, n) => { const m = parseYmd(ymd); const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
    const dowKey = (ymd) => { const m = parseYmd(ymd); return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()]; };
    const mondayOf = (ymd) => { const m = parseYmd(ymd); const off = (new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7; return addDays(ymd, -off); };
    const hm2min = (hm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm); return m ? (+m[1]) * 60 + (+m[2]) : NaN; };
    const startMin = (iso) => { const m = /T(\d{2}):(\d{2})/.exec(iso); return m ? (+m[1]) * 60 + (+m[2]) : 0; };
    const dpart = (iso) => iso.slice(0, 10);
    const label12 = (min) => { let h = Math.floor(min / 60); const ap = h >= 12 ? "PM" : "AM"; let hh = h % 12; if (hh === 0) hh = 12; const m = min % 60; return m ? `${hh}:${pad(m)} ${ap}` : `${hh} ${ap}`; };
    const fmtUTC = (ymd, opt) => { const m = parseYmd(ymd); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", Object.assign({ timeZone: "UTC" }, opt)); };

    const state = { view: "week", anchor: todayYmd(), resource: "all" };
    let lastResources = []; // refreshed each load so handlers know if resources exist
    // Header side-data, fetched ONCE (not per navigation) then cached: the business
    // timezone (relocated into the toolbar) and the Google sync status (Calendar
    // Sync block). lastRender lets us repaint the header once this data arrives.
    let tzConfig = null;   // { timezone, timezoneOptions, timezoneEditable }
    let gStatus = null;    // { configured, connected, syncEnabled }
    let lastRender = null; // { dates, data }

    // Resource view = "All" is selected AND the business has resources → columns
    // become one-per-resource for a SINGLE day. Otherwise it's the normal date grid.
    function inResourceView() { return state.resource === "all" && lastResources.length > 0; }

    function visibleDates() {
      if (inResourceView() || state.view === "day") return [state.anchor];
      const mon = mondayOf(state.anchor);
      return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i));
    }

    async function load() {
      // Only blank to "Loading…" on the FIRST load (nothing rendered yet). On later
      // navigations keep the current calendar on screen during the quick fetch and
      // let render() swap it in atomically — no flash.
      if (!host.querySelector(".cal-card")) {
        host.innerHTML = `<div class="card cal-card"><div class="cal-empty">Loading calendar…</div></div>`;
      }
      const dates = visibleDates();
      const from = dates[0];
      const to = addDays(dates[dates.length - 1], 1);
      let data;
      try { data = await App.portalApi(`/api/bookings/calendar?from=${from}&to=${to}`); }
      catch (e) { host.innerHTML = `<div class="card cal-card"><div class="cal-empty">${esc(e.message || "Could not load calendar.")}</div></div>`; return; }
      render(dates, data);
    }

    function render(dates, data) {
      lastRender = { dates, data };
      const hours = data.hours || {};
      const bookings = data.bookings || [];
      const resources = data.resources || [];
      lastResources = resources;
      // If the selected resource was deleted, fall back to All (avoid an empty view).
      if (state.resource !== "all" && !resources.some((r) => r.id === state.resource)) state.resource = "all";
      const today = todayYmd();
      const nowD = new Date();
      const nowMin = nowD.getHours() * 60 + nowD.getMinutes(); // browser-local wall-clock digits
      const nowLineEls = [];

      const resourceView = state.resource === "all" && resources.length > 0;
      const selResId = (!resourceView && state.resource !== "all") ? state.resource : null;

      // COLUMN descriptors. Resource view → one column per resource (+ Unassigned)
      // for the anchor day. Normal → one per visible date, optionally filtered to
      // the selected resource. Each column carries its resolved hours (the
      // resource's own hours, or the business hours as fallback) for shading.
      const resolveHours = (rh) => (rh && typeof rh === "object") ? rh : hours;
      const selResource = selResId ? resources.find((r) => r.id === selResId) : null;
      const columns = [];
      if (resourceView) {
        const day = state.anchor;
        resources.forEach((r) => columns.push({
          dayYmd: day, kind: "resource", headMain: r.name, color: r.color, slotResourceId: r.id,
          colHours: resolveHours(r.hours),
          items: bookings.filter((b) => dpart(b.start) === day && (b.resourceId || null) === r.id),
        }));
        columns.push({
          dayYmd: day, kind: "unassigned", headMain: "Unassigned", color: null, slotResourceId: null,
          colHours: hours,
          items: bookings.filter((b) => dpart(b.start) === day && !b.resourceId),
        });
      } else {
        const colHours = resolveHours(selResource && selResource.hours);
        dates.forEach((d) => columns.push({
          dayYmd: d, kind: "date", color: null, slotResourceId: selResId, colHours,
          items: bookings.filter((b) => dpart(b.start) === d && (state.resource === "all" || (b.resourceId || null) === selResId)),
        }));
      }

      const dayKeys = resourceView ? [state.anchor] : dates;
      const daySet = new Set(dayKeys);

      // Display range = open windows (per-column resolved hours) + booking spans.
      let minS = Infinity, maxE = -Infinity;
      columns.forEach((c) => (c.colHours[dowKey(c.dayYmd)] || []).forEach((w) => { const s = hm2min(w.start), e = hm2min(w.end); if (s < minS) minS = s; if (e > maxE) maxE = e; }));
      bookings.forEach((b) => { if (daySet.has(dpart(b.start))) { const s = startMin(b.start), e = s + b.durationMin; if (s < minS) minS = s; if (e > maxE) maxE = e; } });
      if (daySet.has(today)) { if (nowMin < minS) minS = nowMin; if (nowMin > maxE) maxE = nowMin; }
      if (!isFinite(minS)) { minS = 540; maxE = 1020; }
      const rangeStart = Math.max(0, Math.floor(minS / 60) * 60);
      let rangeEnd = Math.min(1440, Math.ceil(maxE / 60) * 60);
      if (rangeEnd - rangeStart < 120) rangeEnd = Math.min(1440, rangeStart + 120);
      const gridH = (rangeEnd - rangeStart) / 60 * HOUR_H;
      const cols = `64px repeat(${columns.length}, minmax(0, 1fr))`;

      const card = el("div", "card cal-card");

      // Toolbar: range label, then the status legend in the open middle area, then
      // the view/nav controls pushed to the right.
      const tb = el("div", "cal-toolbar");
      const rangeLbl = el("div", "cal-range");
      if (resourceView) {
        const allClosed = columns.every((c) => !((c.colHours[dowKey(c.dayYmd)] || []).length));
        rangeLbl.textContent = fmtUTC(state.anchor, { weekday: "long", month: "long", day: "numeric" }) + (allClosed ? " · Closed" : "");
      } else {
        rangeLbl.textContent = dates.length === 1
          ? fmtUTC(dates[0], { weekday: "long", month: "long", day: "numeric" })
          : `${fmtUTC(dates[0], { month: "short", day: "numeric" })} – ${fmtUTC(dates[dates.length - 1], { month: "short", day: "numeric" })}`;
      }
      tb.appendChild(rangeLbl);

      // Legend (built from the tenant's REAL statuses) — color swatch + shape glyph
      // + word, so status reads without relying on color alone.
      const stagesList = ((type && type.recordStages) || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      if (stagesList.length) {
        const legend = el("div", "cal-legend");
        stagesList.forEach((s) => {
          const m = metaFor(s.key);
          const item = el("span", "cal-legend-item");
          const sw = el("span", "cal-legend-sw"); sw.style.background = m.bg; sw.style.color = m.fg; sw.textContent = m.glyph;
          item.appendChild(sw);
          item.appendChild(el("span", "cal-legend-lbl", s.label));
          legend.appendChild(item);
        });
        tb.appendChild(legend);
      }

      // ---- Calendar Sync block (display-only) — sits in the space the 2×2 legend
      // frees on the left. One tile per synced calendar: its icon + a READ-ONLY
      // checkbox reflecting the existing Google sync flag (connected && syncEnabled).
      // Built from a list so Outlook/Cal.com tiles can be added later without
      // restructuring. The actual enable/disable lives in Settings › Integrations.
      const syncCalendars = [];
      if (gStatus && gStatus.configured) {
        syncCalendars.push({ name: "Google Calendar", icon: "/img/google-calendar.webp", enabled: !!(gStatus.connected && gStatus.syncEnabled) });
      }
      const calSync = el("div", "cal-sync");
      calSync.appendChild(el("div", "cal-sync-title", "Calendar Sync"));
      const syncTiles = el("div", "cal-sync-tiles");
      if (syncCalendars.length) {
        syncCalendars.forEach((c) => {
          const tile = el("div", "cal-sync-tile");
          tile.title = c.name + (c.enabled ? " — sync on" : " — sync off");
          const icon = el("img", "cal-sync-icon"); icon.src = c.icon; icon.alt = c.name;
          const cb = el("input"); cb.type = "checkbox"; cb.checked = c.enabled; cb.disabled = true; // display-only
          tile.appendChild(icon); tile.appendChild(cb);
          syncTiles.appendChild(tile);
        });
      } else {
        syncTiles.appendChild(el("span", "cell-muted cal-sync-none", "No calendars connected"));
      }
      calSync.appendChild(syncTiles);
      const syncBlurb = el("div", "cal-sync-blurb cell-muted");
      syncBlurb.innerHTML = `To enable or disable third-party calendars, go to <a href="#/settings/integrations">Settings &rsaquo; Integrations</a>.`;
      calSync.appendChild(syncBlurb);
      tb.appendChild(calSync);

      const controls = el("div", "cal-controls");

      // ---- Business time zone (relocated into the header row). SAME tenant.timezone
      // field and SAME PATCH /api/account/timezone write path — relocation only, one
      // source of truth. Styled like the "All" resource filter (cal-resource-sel) so
      // the font matches. Read-only for client users (timezoneEditable:false).
      if (tzConfig) {
        const tzSel = el("select", "input cal-resource-sel cal-tz-sel");
        tzSel.title = "Business time zone";
        ((tzConfig.timezoneOptions && tzConfig.timezoneOptions.length) ? tzConfig.timezoneOptions : []).forEach((o) => {
          const opt = el("option", null, esc(o.label)); opt.value = o.id;
          if (o.id === (tzConfig.timezone || "")) opt.selected = true;
          tzSel.appendChild(opt);
        });
        if (tzConfig.timezoneEditable === false) {
          tzSel.disabled = true;
        } else {
          tzSel.onchange = async () => {
            const prev = tzConfig.timezone;
            tzSel.disabled = true;
            try {
              await App.portalApi("/api/account/timezone", { method: "PATCH", body: JSON.stringify({ timezone: tzSel.value }) });
              tzConfig.timezone = tzSel.value;
              App.util.toast("Business time zone saved");
            } catch (e) {
              tzSel.value = prev || "";
              App.util.toast((e && e.message) || "Save failed", true);
            } finally { tzSel.disabled = false; }
          };
        }
        controls.appendChild(tzSel);
      }

      // Resource selector (view-only) — sits with the view controls. Shown only
      // when the business has resources; otherwise the calendar is unchanged.
      if (resources.length) {
        const rsel = el("select", "input cal-resource-sel");
        const optAll = el("option", null, "All"); optAll.value = "all"; rsel.appendChild(optAll);
        resources.forEach((r) => { const o = el("option", null, r.name); o.value = r.id; rsel.appendChild(o); });
        rsel.value = state.resource;
        rsel.onchange = () => { state.resource = rsel.value; load(); };
        controls.appendChild(rsel);
      }

      // Week/Day toggle — hidden in resource view (it's inherently one day).
      if (!resourceView) {
        const seg = el("div", "cal-seg");
        const wkBtn = el("button", state.view === "week" ? "active" : "", "Week");
        const dyBtn = el("button", state.view === "day" ? "active" : "", "Day");
        wkBtn.onclick = () => { if (state.view !== "week") { state.view = "week"; load(); } };
        dyBtn.onclick = () => { if (state.view !== "day") { state.view = "day"; load(); } };
        seg.appendChild(wkBtn); seg.appendChild(dyBtn);
        controls.appendChild(seg);
      }
      const onToday = state.anchor === todayYmd();
      const todayBtn = el("button", "btn btn-ghost btn-sm" + (onToday ? " cal-today-on" : ""), "Go to Today");
      const prev = el("button", "btn btn-ghost btn-sm", "‹");
      const next = el("button", "btn btn-ghost btn-sm", "›");
      const navStep = resourceView ? 1 : (state.view === "day" ? 1 : 7);
      todayBtn.onclick = () => { const t = todayYmd(); if (state.anchor !== t) { state.anchor = t; load(); } };
      prev.onclick = () => { state.anchor = addDays(state.anchor, -navStep); load(); };
      next.onclick = () => { state.anchor = addDays(state.anchor, navStep); load(); };
      controls.appendChild(todayBtn); controls.appendChild(prev); controls.appendChild(next);
      tb.appendChild(controls);
      card.appendChild(tb);

      const scroll = el("div", "cal-scroll");

      // Header row (closed days get a "Closed" tag here, in the STICKY header, so
      // it stays visible while scrolling instead of an in-grid label).
      const head = el("div", "cal-head");
      head.style.gridTemplateColumns = cols;
      head.appendChild(el("div", "cal-corner"));
      columns.forEach((c) => {
        const colClosed = !((c.colHours[dowKey(c.dayYmd)] || []).length);
        if (c.kind === "date") {
          const h = el("div", "cal-dayhead" + (c.dayYmd === today ? " is-today" : "") + (colClosed ? " is-closed" : ""));
          h.appendChild(el("div", "cal-dow", fmtUTC(c.dayYmd, { weekday: "short" })));
          h.appendChild(el("div", "cal-dom", String(parseInt(c.dayYmd.slice(8, 10), 10))));
          if (colClosed) h.appendChild(el("div", "cal-closed-tag", "Closed"));
          head.appendChild(h);
        } else {
          // Resource / Unassigned column header — name with a color accent underline.
          const h = el("div", "cal-dayhead cal-reshead" + (colClosed ? " is-closed" : ""));
          const nm = el("div", "cal-resname", c.headMain);
          nm.style.borderBottom = "3px solid " + (c.color || "var(--line)");
          if (!c.color) nm.classList.add("is-unassigned");
          h.appendChild(nm);
          if (colClosed) h.appendChild(el("div", "cal-closed-tag", "Closed"));
          head.appendChild(h);
        }
      });
      scroll.appendChild(head);

      // Body grid
      const body = el("div", "cal-body");
      body.style.gridTemplateColumns = cols;

      const gutter = el("div", "cal-gutter");
      gutter.style.height = gridH + "px";
      for (let mn = rangeStart; mn < rangeEnd; mn += 60) {
        const cell = el("div", "cal-hourcell", label12(mn));
        cell.style.height = HOUR_H + "px";
        gutter.appendChild(cell);
      }
      body.appendChild(gutter);

      // Build one grid column from a descriptor (date column OR resource column).
      // Resource name/color lookup for the subtle per-block dot (week/day view).
      const calResById = {}; (resources || []).forEach((r) => { calResById[r.id] = r; });

      // Two-step click-to-create: a single click on empty space highlights a slot;
      // a deliberate second action (the "+" on it, or a double-click) opens Create.
      // Only one slot is selected at a time, so a stray click never pops the modal.
      let selBlock = null;
      function openSel(at, resourceId) {
        openCreateRecord("booking", fields || [], type, { appointmentAt: at, resourceId: resourceId || null });
      }
      function placeSelection(col, mins, at, resourceId) {
        if (selBlock && selBlock.parentNode) selBlock.parentNode.removeChild(selBlock);
        const sel = el("div", "cal-sel");
        sel.style.top = ((mins - rangeStart) / 60 * HOUR_H) + "px";
        sel.style.height = Math.max(18, HOUR_H / 2 - 2) + "px"; // ~30-min visual cue
        sel.appendChild(el("div", "cal-sel-t", label12(mins)));
        const add = el("button", "cal-sel-add", "+"); add.title = "Create booking here";
        add.onclick = (e) => { e.stopPropagation(); openSel(at, resourceId); };
        sel.appendChild(add);
        sel.ondblclick = (e) => { e.stopPropagation(); openSel(at, resourceId); };
        sel.onclick = (e) => { e.stopPropagation(); }; // keep it selected; don't re-place
        col.appendChild(sel);
        selBlock = sel;
      }

      function buildColumn(c) {
        const d = c.dayYmd;
        const col = el("div", "cal-col");
        col.style.height = gridH + "px";
        (c.colHours[dowKey(d)] || []).forEach((w) => {
          const top = Math.max(0, (hm2min(w.start) - rangeStart) / 60 * HOUR_H);
          const bot = Math.min(gridH, (hm2min(w.end) - rangeStart) / 60 * HOUR_H);
          if (bot > top) { const o = el("div", "cal-open"); o.style.top = top + "px"; o.style.height = (bot - top) + "px"; col.appendChild(o); }
        });
        const lines = el("div", "cal-lines");
        lines.style.backgroundImage = `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_H - 1}px, var(--line) ${HOUR_H - 1}px, var(--line) ${HOUR_H}px)`;
        col.appendChild(lines);

        // Lane-pack overlapping bookings so they render side by side.
        const dayB = c.items
          .map((b) => ({ b, s: startMin(b.start), e: startMin(b.start) + b.durationMin }))
          .sort((a, b) => a.s - b.s);
        const laneEnd = [];
        dayB.forEach((it) => { let lane = laneEnd.findIndex((en) => en <= it.s); if (lane === -1) { lane = laneEnd.length; laneEnd.push(it.e); } else laneEnd[lane] = it.e; it.lane = lane; });
        const laneCount = Math.max(1, laneEnd.length);
        dayB.forEach((it) => {
          const blk = el("div", "cal-block");
          blk.style.top = ((it.s - rangeStart) / 60 * HOUR_H) + "px";
          const bh = Math.max(16, (it.e - it.s) / 60 * HOUR_H - 2);
          blk.style.height = bh + "px";
          const wPct = 100 / laneCount;
          blk.style.left = `calc(${it.lane * wPct}% + 3px)`;
          blk.style.width = `calc(${wPct}% - 6px)`;
          const m = metaFor(it.b.stageKey);
          const isExt = it.b.externalSource === "google";
          if (c.color) {
            // Resource view: tint the block with the resource's color; the status
            // glyph keeps its own color so status still reads.
            blk.style.background = c.color + "22"; blk.style.borderColor = c.color; blk.style.color = "var(--ink)"; blk.style.borderLeftWidth = "3px";
          } else {
            blk.style.background = m.bg; blk.style.borderColor = m.fg; blk.style.color = m.fg; blk.style.borderLeftWidth = "3px";
          }
          if (isExt) {
            // External/Blocked (from Google): distinct read-only look, dashed border.
            blk.classList.add("cal-block-ext");
            blk.style.background = "#f1f5f9"; blk.style.borderColor = "#64748b"; blk.style.color = "#475569";
            blk.style.borderStyle = "dashed"; blk.style.borderLeftWidth = "3px";
          }
          const tline = el("div", "cal-block-t");
          if (isExt) { tline.appendChild(el("span", "cal-ext-badge", "Google")); }
          const gl = el("span", "cal-glyph", m.glyph); if (c.color) gl.style.color = m.fg; tline.appendChild(gl);
          // Subtle resource indicator: only in the week/day view (no column color),
          // where the resource isn't already conveyed by the column tint. In the
          // resource-column ("All") view we skip it to avoid doubling up.
          let resForTip = null;
          if (!c.color && it.b.resourceId) {
            resForTip = calResById[it.b.resourceId] || null;
            if (resForTip) { const rd = el("span", "res-dot"); rd.style.background = resForTip.color || "#6366f1"; tline.appendChild(rd); }
          }
          tline.appendChild(document.createTextNode(it.b.contactName || it.b.title || "Booking"));
          blk.appendChild(tline);
          if (bh >= 30) {
            blk.appendChild(el("div", "cal-block-sub", `${label12(it.s)} · ${[it.b.serviceLabel, it.b.stageLabel].filter(Boolean).join(" · ")}`.replace(/ · $/, "")));
          }
          blk.title = `${it.b.title}${it.b.contactName ? " — " + it.b.contactName : ""}\n${label12(it.s)}–${label12(it.e)} · ${it.b.serviceLabel || ""} · ${it.b.stageLabel || ""}${resForTip ? " · " + resForTip.name : ""}`;
          blk.onclick = (e) => { e.stopPropagation(); App.go("#/record/" + it.b.id); };
          col.appendChild(blk);
        });

        // "Now" line — any column whose day is today, browser-local wall-clock.
        if (d === today && nowMin >= rangeStart && nowMin <= rangeEnd) {
          const nl = el("div", "cal-now");
          nl.style.top = ((nowMin - rangeStart) / 60 * HOUR_H) + "px";
          nl.appendChild(el("span", "cal-now-dot"));
          col.appendChild(nl);
          nowLineEls.push(nl);
        }
        // Single click on empty space → SELECT/highlight that slot (snapped to 15
        // min). Creating is a deliberate second action (the "+" or double-click on
        // the highlight). In a resource column, the slot carries that resource.
        col.style.cursor = "pointer";
        col.addEventListener("click", (e) => {
          const rect = col.getBoundingClientRect();
          const y = e.clientY - rect.top;
          let mins = rangeStart + Math.round((y / HOUR_H * 60) / 15) * 15;
          mins = Math.max(0, Math.min(1439, mins));
          const hh = Math.floor(mins / 60), mm = mins % 60;
          const at = `${d}T${pad(hh)}:${pad(mm)}`;
          placeSelection(col, mins, at, c.slotResourceId || null);
        });
        body.appendChild(col);
      }

      columns.forEach(buildColumn);

      scroll.appendChild(body);
      card.appendChild(scroll);
      host.innerHTML = "";
      host.appendChild(card);

      // Default scroll: open at business start (or ~now if today is visible) so we
      // don't land on empty early-morning space.
      let bizStart = Infinity;
      columns.forEach((c) => (c.colHours[dowKey(c.dayYmd)] || []).forEach((w) => { const s = hm2min(w.start); if (s < bizStart) bizStart = s; }));
      if (!isFinite(bizStart)) bizStart = rangeStart;
      const scrollTarget = (daySet.has(today) && nowMin > bizStart) ? nowMin - 30 : bizStart;
      scroll.scrollTop = Math.max(0, (scrollTarget - rangeStart) / 60 * HOUR_H - 8);

      // Keep the "now" line(s) current without re-fetching; self-cleans if the
      // calendar is removed from the page. Resource view can have several columns
      // sharing today, so update them all.
      if (host._calTimer) { clearInterval(host._calTimer); host._calTimer = null; }
      if (nowLineEls.length) {
        host._calTimer = setInterval(() => {
          if (!document.body.contains(host)) { clearInterval(host._calTimer); host._calTimer = null; return; }
          const n = new Date(); const nm = n.getHours() * 60 + n.getMinutes();
          nowLineEls.forEach((nl) => {
            if (nm < rangeStart || nm > rangeEnd) { nl.style.display = "none"; return; }
            nl.style.display = ""; nl.style.top = ((nm - rangeStart) / 60 * HOUR_H) + "px";
          });
        }, 60000);
      }
    }

    // Fetch header side-data ONCE (business timezone + Google sync status), then
    // repaint so the relocated timezone dropdown and Calendar Sync block appear.
    // Cached for later navigations (prev/next/today/week/day) — no refetch per move.
    load();
    Promise.all([
      App.portalApi("/api/booking-config").catch(() => null),
      App.portalApi("/api/google/status").catch(() => null),
    ]).then(([bc, gs]) => {
      tzConfig = bc; gStatus = gs;
      if (lastRender) render(lastRender.dates, lastRender.data);
    });
  }

  function recordColumnDefs(fields, type, resById) {
    resById = resById || {};
    const cols = [];
    cols.push({ key: "title", label: "Title", type: "text", get: (r) => r.title, text: (r) => r.title || "", cellClass: "cell-strong", render: (r) => esc(r.title || "Untitled") + (r.externalSource === "google" ? ` <span class="ext-badge">Google</span>` : "") });
    // Bookings: the typed appointment date+time as a first-class column (it is a
    // real DB field, not a custom field, so it's added here explicitly).
    if (type && type.key === "booking") {
      cols.push({ key: "appointmentAt", label: "Appointment", type: "date", get: (r) => r.appointmentAt, text: (r) => fmtAppt(r.appointmentAt), render: (r) => r.appointmentAt ? esc(fmtAppt(r.appointmentAt)) : `<span class="cell-muted">—</span>` });
      // Assigned resource (display-only surfacing of the existing resourceId).
      // Labeled with the configurable resource word; shows a color dot + name, or
      // a muted "Unassigned" when none. text() returns the name for sort/search.
      const resName = (r) => { const x = r.resourceId ? resById[r.resourceId] : null; return x ? x.name : ""; };
      cols.push({
        key: "resourceId", label: App.label("resource", "one"), type: "text",
        get: (r) => r.resourceId || null,
        text: (r) => resName(r),
        render: (r) => {
          const x = r.resourceId ? resById[r.resourceId] : null;
          if (!x) return `<span class="cell-muted">Unassigned</span>`;
          return `<span class="res-dot" style="background:${esc(x.color || "#6366f1")}"></span>${esc(x.name)}`;
        },
      });
    }
    if (((type && type.subtypes) || []).length) {
      cols.push({ key: "subtypeKey", label: "Type", type: "text", get: (r) => r.subtypeKey, text: (r) => subtypeLabel(type, r.subtypeKey), render: (r) => r.subtypeKey ? `<span class="pill">${esc(subtypeLabel(type, r.subtypeKey))}</span>` : `<span class="cell-muted">—</span>` });
    }
    if (((type && type.recordStages) || []).length) {
      cols.push({ key: "stageKey", label: "Status", type: "text", get: (r) => r.stageKey, text: (r) => recordStageLabel(type, r.stageKey), render: (r) => r.stageKey ? `<span class="pill">${esc(recordStageLabel(type, r.stageKey))}</span>` : `<span class="cell-muted">—</span>` });
    }
    (fields || []).forEach((f) => {
      const get = (r) => (r.customFields || {})[f.key];
      const disp = (r) => { const v = get(r); return Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v); };
      cols.push({ key: f.key, label: f.label, type: (f.type === "number" ? "number" : f.type === "date" ? "date" : "text"), get, text: disp, render: (r) => esc(disp(r) || "—") });
    });
    cols.push({ key: "createdAt", label: "Created", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` });
    return cols;
  }

  async function renderRecordList(typeKey) {
    loading();
    let records, fields, types, resources;
    try {
      [records, fields, types, resources] = await Promise.all([
        App.portalApi("/api/records?type=" + encodeURIComponent(typeKey)),
        App.portalApi("/api/fields?recordType=" + encodeURIComponent(typeKey)).catch(() => []),
        App.portalApi("/api/record-types").catch(() => []),
        // Resource names/colors for the bookings list column (display-only).
        typeKey === "booking" ? App.portalApi("/api/resources").catch(() => []) : Promise.resolve([]),
      ]);
    } catch (e) { view().innerHTML = `<div class="card"><p class="cell-muted">${esc(e.message)}</p></div>`; return; }
    const type = (types || []).find((t) => t.key === typeKey) || { key: typeKey, label: App.label("record","one"), labelPlural: "Records", stages: [], recordStages: [] };
    const titleEl = document.querySelector(".page-title"); if (titleEl) titleEl.textContent = type.labelPlural || type.label;

    const resById = {}; (resources || []).forEach((r) => { resById[r.id] = r; });
    const allColumns = recordColumnDefs(fields, type, resById);
    let layout = loadRecordLayout(typeKey);
    let columns = applyRecordLayout(allColumns, layout);

    view().innerHTML = "";
    const container = el("div", "fade-in");
    const bar = el("div", "page-actions");
    const dummyBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#129302;</span> Create Dummy ${esc(type.label)}`);
    dummyBtn.onclick = async () => {
      dummyBtn.disabled = true;
      try { await App.portalApi("/api/records/dummy", { method: "POST", body: JSON.stringify({ type: typeKey }) }); toast(`Dummy ${(type.label || App.label("record","one").toLowerCase()).toLowerCase()} created`); renderRecordList(typeKey); }
      catch (e) { toast(e.message, true); dummyBtn.disabled = false; }
    };
    const createBtn = el("button", "btn btn-primary btn-sm", `<span class="btn-icon">&#43;</span> Create ${esc(type.label)}`);
    createBtn.onclick = () => openCreateRecord(typeKey, fields, type);
    const importBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8681;</span> Import ${esc(type.labelPlural || App.label("record","many").toLowerCase())}`);
    importBtn.onclick = () => openRecordImport(typeKey, fields, type);
    const exportBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8679;</span> Export`);
    exportBtn.onclick = () => openRecordExport(handle ? handle.getColumns() : columns, records, type.labelPlural || type.label, typeKey);
    bar.appendChild(dummyBtn);
    bar.appendChild(createBtn);
    bar.appendChild(importBtn);
    bar.appendChild(exportBtn);
    container.appendChild(bar);

    // ---- Bookings calendar (replaces the old read-only preview). Week/day grid
    // of existing bookings + open-hours shading. Wrapped in the table's own layout
    // wrapper so its edges line up with the list below. Read-only in this batch:
    // click a booking to open it; creating from an empty slot + the double-booking
    // lock come in the next batch. ----
    if (type.key === "booking") {
      const calLayout = el("div", "table-layout");
      calLayout.appendChild(el("aside", "filter-rail")); // collapsed, like the table's
      const calArea = el("div", "table-area");
      calLayout.appendChild(calArea);
      container.appendChild(calLayout);
      renderBookingCalendar(calArea, type, fields);
    }

    const tableHost = el("div");
    container.appendChild(tableHost);
    view().appendChild(container);

    const selCount = el("span", "bulk-count", "");
    let handle;
    handle = App.table.mount({
      container: tableHost, columns, rows: records, selectable: true, rowId: (r) => r.id,
      onRowClick: (r) => App.go("#/record/" + r.id),
      onSelectionChange: (ids) => { selCount.textContent = ids.length ? `${ids.length} selected` : ""; },
      defaultSort: "createdAt", defaultSortDir: "desc",
      emptyHtml: `<div class="empty"><div class="empty-emoji">&#128188;</div><h3>No ${esc((type.labelPlural || App.label("record","many").toLowerCase()).toLowerCase())} yet</h3><p>Create your first ${esc((type.label || App.label("record","one").toLowerCase()).toLowerCase())} to get started.</p></div>`,
    });
    if (handle && handle.toolbarLeft) mountSavedFilters(handle, typeKey);

    const bulkWrap = el("div", "bulk-wrap");
    const bulkBtn = el("button", "btn btn-ghost btn-sm", "Bulk Actions &#9662;");
    const bulkMenu = el("div", "bulk-menu hidden");
    bulkWrap.appendChild(bulkBtn); bulkWrap.appendChild(bulkMenu); bulkWrap.appendChild(selCount);
    handle.toolbarLeft.appendChild(bulkWrap);
    function selectedRows() { const set = new Set(handle.getSelected()); return records.filter((r) => set.has(r.id)); }
    const bulkMsg = el("div", "bulk-empty hidden", `Select a ${(type.label || App.label("record","one").toLowerCase()).toLowerCase()} first.`);
    bulkMenu.appendChild(bulkMsg);
    let msgTimer = null;
    function needSelection(text) { bulkMsg.textContent = text || `Select a ${(type.label || App.label("record","one").toLowerCase()).toLowerCase()} first.`; bulkMsg.classList.remove("hidden"); clearTimeout(msgTimer); msgTimer = setTimeout(() => bulkMsg.classList.add("hidden"), 1800); }
    function bulkItem(label, fn) { const b = el("button", "bulk-item", label); b.onclick = () => fn(); return b; }
    bulkMenu.appendChild(bulkItem("Export selected", () => { const rows = selectedRows(); if (!rows.length) return needSelection(); bulkMenu.classList.add("hidden"); openRecordExport(handle.getColumns(), rows, type.labelPlural || type.label, typeKey); }));
    bulkMenu.appendChild(bulkItem("Update a field…", () => { const ids = handle.getSelected(); if (!ids.length) return needSelection(); bulkMenu.classList.add("hidden"); openRecordMassUpdate(ids, fields, type, typeKey); }));
    bulkMenu.appendChild(el("div", "pop-sep"));
    bulkMenu.appendChild(bulkItem("Delete selected", async () => {
      const ids = handle.getSelected(); if (!ids.length) return needSelection();
      bulkMenu.classList.add("hidden");
      if (!(await confirmModal({ title: "Move to Recycle Bin", message: `Move ${ids.length} ${(ids.length > 1 ? (type.labelPlural || App.label("record","many").toLowerCase()) : (type.label || App.label("record","one").toLowerCase())).toLowerCase()} to the Recycle Bin?`, confirmText: "Move to Recycle Bin" }))) return;
      try { await App.portalApi("/api/records/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }); toast("Deleted"); renderRecordList(typeKey); }
      catch (e) { toast(e.message, true); }
    }));
    bulkBtn.onclick = (e) => { e.stopPropagation(); bulkMenu.classList.toggle("hidden"); if (!bulkMenu.classList.contains("hidden")) setTimeout(() => document.addEventListener("click", () => bulkMenu.classList.add("hidden"), { once: true }), 0); };
    bulkMenu.addEventListener("click", (e) => e.stopPropagation());

    const mc = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#9776;</span> Manage columns`);
    mc.onclick = () => openManageColumns(allColumns, layout, (newLayout) => {
      layout = newLayout; saveRecordLayout(typeKey, layout);
      handle.setColumns(applyRecordLayout(allColumns, layout));
    });
    if (handle.toolbarRight) handle.toolbarRight.insertBefore(mc, handle.toolbarRight.firstChild);
  }

  function openCreateRecord(typeKey, fields, type, opts) {
    opts = opts || {};
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Create ${esc(type.label || App.label("record","one").toLowerCase())}</h2><button class="icon-btn" id="cr-close">&times;</button></div><div class="modal-body" id="cr-body"></div>`;
    const overlay = modal(inner);
    inner.querySelector("#cr-close").onclick = () => overlay.remove();
    const body = inner.querySelector("#cr-body");

    body.appendChild(el("label", "field-label", "Title *"));
    const titleInp = el("input", "input"); titleInp.placeholder = `e.g. ${esc(type.label || App.label("record","one"))} name`;
    body.appendChild(titleInp);

    // Type (subtype) is required for record types that define job types.
    const subtypes = (type && type.subtypes) || [];
    let subtypeSel = null;
    if (subtypes.length) {
      body.appendChild(el("label", "field-label", "Type *"));
      subtypeSel = el("select", "input");
      subtypeSel.appendChild(el("option", null, "— select a type —"));
      subtypes.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((st) => { const o = el("option", null, esc(st.label)); o.value = st.key; subtypeSel.appendChild(o); });
      body.appendChild(subtypeSel);
    }

    const recStages = (type && type.recordStages) || [];
    let stageSel = null;
    if (recStages.length) {
      body.appendChild(el("label", "field-label", "Status"));
      stageSel = el("select", "input");
      stageSel.appendChild(el("option", null, "— none —"));
      recStages.forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; stageSel.appendChild(o); });
      body.appendChild(stageSel);
    }

    // Bookings: the typed appointment date AND time. A real field (not a custom
    // field), so it's a first-class input here. Required for bookings.
    const isBooking = type && type.key === "booking";
    let apptInp = null;
    let contactSel = null;
    let resourceSel = null;
    if (isBooking) {
      body.appendChild(el("label", "field-label", "Appointment date & time *"));
      apptInp = el("input", "input"); apptInp.type = "datetime-local";
      apptInp.min = "2000-01-01T00:00"; apptInp.max = "2100-12-31T23:59"; // guard impossible years
      if (opts.appointmentAt) apptInp.value = opts.appointmentAt; // prefill from a clicked calendar slot
      body.appendChild(apptInp);

      // Optional contact assignment at create (reuses the same record↔contact link
      // the detail page uses). Populated from the contacts list.
      body.appendChild(el("label", "field-label", "Contact"));
      contactSel = el("select", "input");
      contactSel.appendChild(el("option", null, "— none —"));
      body.appendChild(contactSel);
      App.portalApi("/api/contacts").then((cs) => {
        (cs || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))).forEach((c) => {
          const o = el("option", null, esc(c.name || c.email || c.phone || "Unnamed")); o.value = c.id; contactSel.appendChild(o);
        });
      }).catch(() => {});

      // Optional resource assignment at create (saved as resourceId).
      body.appendChild(el("label", "field-label", "Assigned " + App.label("resource", "one")));
      resourceSel = el("select", "input");
      const resNone = el("option", null, "— None —"); resNone.value = ""; resourceSel.appendChild(resNone);
      body.appendChild(resourceSel);
      App.portalApi("/api/resources").then((list) => {
        (list || []).forEach((r) => { const o = el("option", null, esc(r.name)); o.value = r.id; resourceSel.appendChild(o); });
        if (opts.resourceId) resourceSel.value = opts.resourceId; // pre-assign from a resource-column click
      }).catch(() => {});
    }

    const values = {};
    const editorHost = el("div", "field-editor");
    body.appendChild(editorHost);
    App.fields.renderEditor(editorHost, fields || [], values, {});

    const save = el("button", "btn btn-primary btn-block", "Create");
    save.style.marginTop = "14px";
    save.onclick = async () => {
      const title = titleInp.value.trim();
      if (!title) { toast("Title is required", true); titleInp.focus(); return; }
      if (subtypeSel && !subtypeSel.value) { toast("Type is required", true); subtypeSel.focus(); return; }
      if (apptInp && !apptInp.value) { toast("Appointment date & time is required", true); apptInp.focus(); return; }
      if (apptInp && apptInp.value) { const y = parseInt(apptInp.value.slice(0, 4), 10); if (!(y >= 2000 && y <= 2100)) { toast("Please enter a valid appointment year", true); apptInp.focus(); return; } }
      const custom = {};
      (fields || []).forEach((f) => { if (f.type !== "formula") custom[f.key] = values[f.key]; });
      save.disabled = true; save.textContent = "Creating…";
      const basePayload = { type: typeKey, title, subtypeKey: subtypeSel ? (subtypeSel.value || null) : null, stageKey: stageSel ? (stageSel.value || null) : null, appointmentAt: apptInp ? (apptInp.value || null) : undefined, resourceId: resourceSel ? (resourceSel.value || null) : undefined, customFields: custom };
      const ov = { allowOverlap: false, allowClosed: false };
      const doCreate = () => App.portalApi("/api/records", { method: "POST", body: JSON.stringify({ ...basePayload, ...ov }) });
      try {
        let rec;
        for (;;) {
          try { rec = await doCreate(); break; }
          catch (e) {
            const code = e && e.data && e.data.code;
            if (code === "overlap" && !ov.allowOverlap) {
              const ok = await confirmModal({ title: "Overlapping booking", message: "This overlaps an existing booking. Book anyway?", confirmText: "Book anyway" });
              if (!ok) { save.disabled = false; save.textContent = "Create"; return; }
              ov.allowOverlap = true; continue;
            }
            if (code === "closed" && !ov.allowClosed) {
              const ok = await confirmModal({ title: "Outside open hours", message: (e.message || "This is outside the open hours.") + " Book anyway?", confirmText: "Book anyway" });
              if (!ok) { save.disabled = false; save.textContent = "Create"; return; }
              ov.allowClosed = true; continue;
            }
            throw e;
          }
        }
        // Optional: link the chosen contact (reuses the detail-page link path).
        if (contactSel && contactSel.value) {
          try { await App.portalApi("/api/records/" + rec.id + "/links", { method: "POST", body: JSON.stringify({ parentType: "contact", parentId: contactSel.value, stageKey: null }) }); }
          catch (e) { /* booking is created; a failed link shouldn't block it */ }
        }
        toast(`${type.label || App.label("record","one")} created`);
        overlay.remove();
        // Bookings: stay on the Bookings page (re-render calendar + list in place)
        // instead of redirecting to the detail page. Other types keep the redirect.
        if (typeKey === "booking") { renderRecordList("booking"); }
        else { App.go("#/record/" + rec.id); }
      } catch (e) { toast(e.message, true); save.disabled = false; save.textContent = "Create"; }
    };
    body.appendChild(save);
  }

  function openRecordImport(typeKey, fields, type) {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Import ${esc(type.labelPlural || App.label("record","many").toLowerCase())}</h2><button class="icon-btn" id="imp-close">&times;</button></div>
      <div class="modal-body">
        <p class="cell-muted">Upload a CSV or Excel file (.csv, .xlsx). You'll map its columns to the fields below before importing. Each row needs a Title.</p>
        <input type="file" id="imp-file" accept=".csv,.xlsx,.xls,text/csv" class="input" />
        <div id="imp-step2"></div>
        <div class="ex-history-head" style="margin-top:16px">Previous imports</div>
        <div id="imp-history" class="ex-history"><div class="cell-muted">Loading…</div></div>
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#imp-close").onclick = () => overlay.remove();
    renderImportHistory(inner.querySelector("#imp-history"), typeKey);
    // Mapping targets: Title, then Status + Type (when this type has them, since the
    // server already stores stageKey/subtypeKey), then each non-formula custom field.
    const stageList = (type && type.recordStages) || [];
    const subtypeList = (type && type.subtypes) || [];
    const targets = [{ key: "__title__", label: "Title", required: true }];
    const isBooking = !!(type && type.key === "booking");
    if (isBooking) {
      targets.push({ key: "__appointment__", label: "Appointment" });
      targets.push({ key: "__resource__", label: App.label("resource", "one") });
    }
    if (stageList.length) targets.push({ key: "__stage__", label: "Status" });
    if (subtypeList.length) targets.push({ key: "__subtype__", label: "Type" });
    (fields || []).filter((f) => f.type !== "formula").forEach((f) => targets.push({ key: f.key, label: f.label }));
    // WALL-CLOCK: normalize a file's appointment cell to the zoneless YYYY-MM-DDTHH:MM
    // string by reading its DIGITS only (never new Date() on a local string). The
    // server's parseAppointmentAt then parks those exact digits in the UTC slot, so
    // "5:00 PM" in the file stays 5:00 PM in the booking regardless of timezone.
    const pad2 = (n) => String(n).padStart(2, "0");
    function normalizeApptInput(val) {
      const s = String(val == null ? "" : val).trim();
      if (!s) return "";
      // Already zoneless ISO-like: YYYY-MM-DD, separated by T or space, optional secs.
      let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
      if (m) return `${m[1]}-${m[2]}-${m[3]}T${pad2(m[4])}:${m[5]}`;
      m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00`;
      // M/D/YYYY (or - / .) with optional h:mm[:ss] and optional AM/PM.
      m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/.exec(s);
      if (m) {
        let mo = m[1], da = m[2], yr = m[3];
        if (yr.length === 2) yr = (Number(yr) >= 70 ? "19" : "20") + yr;
        let H = m[4] != null ? parseInt(m[4], 10) : 0;
        const M = m[5] != null ? m[5] : "00";
        if (m[6]) { const pm = /p/i.test(m[6]); if (pm && H < 12) H += 12; if (!pm && H === 12) H = 0; }
        return `${yr}-${pad2(mo)}-${pad2(da)}T${pad2(H)}:${M}`;
      }
      // Pure number => Excel serial date (days since 1899-12-30; fraction = time of
      // day). Positioned via UTC so the wall-clock digits are read back unchanged.
      if (/^\d+(\.\d+)?$/.test(s)) {
        const serial = parseFloat(s);
        if (serial >= 20000 && serial <= 90000) {
          const totalMin = Math.round(serial * 1440);
          const d = new Date(Date.UTC(1899, 11, 30) + totalMin * 60000);
          return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
        }
      }
      return ""; // unrecognized -> leave blank (server skips/leaves it off; nothing crashes)
    }
    // Map a file value to a canonical key by matching key OR label (case-insensitive),
    // so an exported "Status"/"Type" column (which holds labels) re-imports correctly.
    // Unmatched values are passed through as-is: the server validates subtype (falling
    // back to the default) and stores stageKey as given.
    function resolveChoice(list, val) {
      const s = String(val == null ? "" : val).trim();
      if (!s) return "";
      const low = s.toLowerCase();
      const hit = (list || []).find((o) => String(o.key).toLowerCase() === low || String(o.label).toLowerCase() === low);
      return hit ? hit.key : s;
    }
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    function guessMapping(headers) {
      const map = {};
      targets.forEach((t) => {
        const nt = norm(t.label), nk = norm(t.key);
        let idx = headers.findIndex((h) => { const nh = norm(h); return nh === nt || nh === nk; });
        if (idx < 0) idx = headers.findIndex((h) => { const nh = norm(h); return nt && (nh.includes(nt) || nt.includes(nh)); });
        map[t.key] = idx;
      });
      return map;
    }

    // Post-import summary shown in place of the mapping grid: counts + the clear
    // reasons rows were skipped / values dropped / resources unmatched / columns
    // ignored. Reuses the modal's existing muted-text + button styling.
    function renderImportSummary(host, res, ignoredCols) {
      const cap = (arr, n) => (arr.length > n ? arr.slice(0, n) : arr);
      const listOf = (label, items, fmt) => {
        if (!items.length) return "";
        const shown = cap(items, 50).map((x) => `<li>${fmt(x)}</li>`).join("");
        const more = items.length > 50 ? `<li>…and ${items.length - 50} more</li>` : "";
        return `<p class="cell-muted" style="margin-top:8px">${esc(label)}</p><ul class="cell-muted" style="margin:4px 0 0 18px">${shown}${more}</ul>`;
      };
      const skippedRows = res.skippedRows || [];
      const valueWarnings = res.valueWarnings || [];
      const resourceWarnings = res.resourceWarnings || [];
      let html = `<p><strong>Imported ${res.imported}</strong>${res.skipped ? ` · skipped ${res.skipped}` : ""}.</p>`;
      html += listOf("Skipped rows:", skippedRows, (s) => `Row ${s.row}${s.title ? ` (${esc(s.title)})` : ""}: ${esc(s.reason)}`);
      html += listOf("Values skipped (row kept, field left empty):", valueWarnings, (w) => `Row ${w.row}, ${esc(w.field)}: ${esc(w.reason)}`);
      if (resourceWarnings.length) html += `<p class="cell-muted" style="margin-top:8px">${esc(App.label("resource", "many"))} not matched (left blank): ${esc(resourceWarnings.join(", "))}</p>`;
      if (ignoredCols.length) html += `<p class="cell-muted" style="margin-top:8px">Columns ignored (not mapped): ${esc(ignoredCols.join(", "))}</p>`;
      host.innerHTML = html + `<button class="btn btn-primary btn-block" id="imp-done" style="margin-top:14px">Done</button>`;
      host.querySelector("#imp-done").onclick = () => { overlay.remove(); renderRecordList(typeKey); };
      toast(`Imported ${res.imported}${res.skipped ? `, skipped ${res.skipped}` : ""}`);
    }

    inner.querySelector("#imp-file").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      readFileRows(file, (rows) => {
        if (!rows || rows.length < 2) { toast("That file has no data rows", true); return; }
        const headers = rows[0].map((h) => String(h).trim());
        const dataRows = rows.slice(1);
        const guess = guessMapping(headers);
        const host = inner.querySelector("#imp-step2");
        const optionsHtml = (sel) => `<option value="-1">— skip —</option>` + headers.map((h, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(h)}</option>`).join("");
        host.innerHTML = `<div class="map-grid">${targets.map((t) => `
          <label class="field-label">${esc(t.label)}${t.required ? " (required)" : ""}</label>
          <select class="input map-sel" data-key="${esc(t.key)}">${optionsHtml(guess[t.key])}</select>`).join("")}</div>
          <p class="cell-muted">${dataRows.length} rows detected. Rows with no Title will be skipped.</p>
          <p class="cell-muted" id="imp-ignored"></p>
          <button class="btn btn-primary btn-block" id="imp-go">Import ${dataRows.length} ${esc((type.labelPlural || App.label("record","many").toLowerCase()).toLowerCase())}</button>`;
        // Which file columns aren't mapped to any field — surfaced live + after import,
        // so it's clear those columns are ignored (they used to drop silently).
        const selects = App.util.$$(".map-sel", host);
        function ignoredColumns() {
          const used = new Set();
          selects.forEach((s) => { const i = parseInt(s.value, 10); if (i >= 0) used.add(i); });
          return headers.filter((h, i) => !used.has(i) && h !== "");
        }
        function updateIgnoredNote() {
          const ig = ignoredColumns();
          host.querySelector("#imp-ignored").textContent = ig.length ? ("Columns not mapped (ignored on import): " + ig.join(", ")) : "";
        }
        selects.forEach((s) => s.addEventListener("change", updateIgnoredNote));
        updateIgnoredNote();
        host.querySelector("#imp-go").onclick = async () => {
          const map = {};
          selects.forEach((s) => { map[s.dataset.key] = parseInt(s.value, 10); });
          if (map["__title__"] == null || map["__title__"] < 0) { toast("Map the Title column", true); return; }
          const mappedRows = dataRows.map((r) => {
            const out = { title: r[map["__title__"]] };
            if (map["__stage__"] != null && map["__stage__"] >= 0) { const k = resolveChoice(stageList, r[map["__stage__"]]); if (k) out.stageKey = k; }
            if (map["__subtype__"] != null && map["__subtype__"] >= 0) { const k = resolveChoice(subtypeList, r[map["__subtype__"]]); if (k) out.subtypeKey = k; }
            if (isBooking && map["__appointment__"] != null && map["__appointment__"] >= 0) { const norm = normalizeApptInput(r[map["__appointment__"]]); if (norm) out.appointmentAt = norm; }
            if (isBooking && map["__resource__"] != null && map["__resource__"] >= 0) { const rn = r[map["__resource__"]]; if (rn != null && String(rn).trim() !== "") out.resourceName = String(rn).trim(); }
            const customFields = {};
            targets.forEach((t) => { if (t.key === "__title__" || t.key === "__stage__" || t.key === "__subtype__" || t.key === "__appointment__" || t.key === "__resource__") return; const idx = map[t.key]; if (idx != null && idx >= 0) { const v = r[idx]; if (v !== undefined && String(v).trim() !== "") customFields[t.key] = v; } });
            out.customFields = customFields;
            return out;
          });
          const ignoredNow = ignoredColumns();
          const btn = host.querySelector("#imp-go");
          btn.disabled = true; btn.textContent = "Importing…";
          try {
            const res = await App.portalApi("/api/records/import", { method: "POST", body: JSON.stringify({ type: typeKey, rows: mappedRows }) });
            renderImportSummary(host, res, ignoredNow);
          } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = "Import"; }
        };
      });
    };
  }

  function openRecordMassUpdate(ids, fields, type, typeKey) {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Update a field</h2><button class="icon-btn" id="mu-close">&times;</button></div>
      <div class="modal-body">
        <p class="cell-muted">Set one field on ${ids.length} ${(ids.length > 1 ? (type.labelPlural || App.label("record","many").toLowerCase()) : (type.label || App.label("record","one").toLowerCase())).toLowerCase()}.</p>
        <label class="field-label">Field</label>
        <select id="mu-field" class="input"></select>
        <div id="mu-valwrap"></div>
        <button id="mu-go" class="btn btn-primary btn-block" style="margin-top:14px">Apply</button>
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#mu-close").onclick = () => overlay.remove();
    const fieldSel = inner.querySelector("#mu-field");
    const pickable = [{ key: "title", label: "Title", type: "text" }];
    if (((type && type.subtypes) || []).length) pickable.push({ key: "subtypeKey", label: "Type", type: "subtype", _subtypes: type.subtypes });
    if (((type && type.recordStages) || []).length) pickable.push({ key: "stageKey", label: "Status", type: "stage", _stages: type.recordStages });
    (fields || []).forEach((f) => { if (f.type !== "formula") pickable.push(f); });
    pickable.forEach((f) => { const o = el("option", null, esc(f.label)); o.value = f.key; fieldSel.appendChild(o); });
    const valWrap = inner.querySelector("#mu-valwrap");
    let getVal = () => null;
    function renderVal() {
      valWrap.innerHTML = "";
      const f = pickable.find((x) => x.key === fieldSel.value) || pickable[0];
      valWrap.appendChild(el("label", "field-label", "New value"));
      if (f.type === "subtype") {
        const s = el("select", "input"); // Type is required, so no blank option
        (f._subtypes || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((st) => { const o = el("option", null, esc(st.label)); o.value = st.key; s.appendChild(o); });
        valWrap.appendChild(s); getVal = () => s.value || null;
        const warn = el("p", "muted"); warn.style.cssText = "margin:8px 0 0; font-size:12.5px;";
        warn.textContent = (`Changing Type switches a ${App.label("job","one").toLowerCase()}'s pipeline. ${App.label("contact","many")} keep their current ${App.label("stage","one").toLowerCase()} value, even if the new type's pipeline doesn't include it — re-${App.label("stage","one").toLowerCase()} them afterward.`);
        valWrap.appendChild(warn);
      } else if (f.type === "stage") {
        const s = el("select", "input"); s.appendChild(el("option", null, "— none —"));
        (f._stages || []).forEach((st) => { const o = el("option", null, esc(st.label)); o.value = st.key; s.appendChild(o); });
        valWrap.appendChild(s); getVal = () => s.value || null;
      } else {
        const fi = fieldInput(f, undefined);
        valWrap.appendChild(fi.wrap); getVal = fi.get;
      }
    }
    fieldSel.onchange = renderVal; renderVal();
    inner.querySelector("#mu-go").onclick = async () => {
      const field = fieldSel.value; const value = getVal();
      try { const r = await App.portalApi("/api/records/bulk-update", { method: "POST", body: JSON.stringify({ ids, field, value }) }); toast(`Updated ${r.count}`); overlay.remove(); renderRecordList(typeKey); }
      catch (e) { toast(e.message, true); }
    };
  }

  // Builds the export options for a record type — shared by the per-page modal
  // (openRecordExport) and the inline Data Administration export form.
  function recordExportOpts(columns, rows, typeLabel, dataType) {
    const label = typeLabel || App.label("record", "many");
    return {
      columns, rows,
      title: "Export " + label,
      namePlaceholder: "e.g. Open " + String(label).toLowerCase(),
      filterLabel: "Who to export",
      unitPlural: label,
      sheetName: label,
      countText: (n) => n + " " + String(label).toLowerCase(),
      dataType: dataType || null,
      saveHistory: true,
    };
  }

  function openRecordExport(columns, rows, typeLabel, dataType) {
    // Unified onto the shared export modal so record exports gain export history.
    App.exportModal(recordExportOpts(columns, rows, typeLabel, dataType));
  }

  // ---------------- Single record (e.g. Job) detail ----------------
  async function renderRecord(id, opts) {
    opts = opts || {};
    const ro = !!opts.preview; // read-only Recycle Bin preview
    loading();
    let rec, types;
    try { [rec, types] = await Promise.all([App.portalApi("/api/records/" + id + (ro ? "?includeDeleted=1" : "")), App.portalApi("/api/record-types").catch(() => [])]); }
    catch (e) { if (ro) return recycleMissing(); view().innerHTML = `<div class="card"><p class="cell-muted">${esc(e.message)}</p></div>`; return; }
    if (ro && !rec.deletedAt) return recycleMissing(); // restored/purged since the bin was opened
    const type = (types || []).find((t) => t.id === rec.recordTypeId) || { key: "record", label: App.label("record","one"), labelPlural: "Records", stages: [], recordStages: [] };
    let fields = [];
    let fieldSections = [];
    try { [fields, fieldSections] = await Promise.all([App.portalApi("/api/fields?recordType=" + encodeURIComponent(type.key)), App.portalApi("/api/field-sections?recordType=" + encodeURIComponent(type.key)).catch(() => [])]); } catch (e) { fields = []; }

    const wrap = el("div", "fade-in contact-page");
    const back = el("a", "back-link", ro ? "← Back to Recycle Bin" : ("← " + esc(type.labelPlural || App.label("record","many"))));
    back.href = ro ? "#/recycle" : (type.key === "booking" ? "#/bookings" : "#/jobs");
    // The /record/:id route highlights "Jobs" by default; now that we know the
    // record's real type, re-mark the correct sidebar item so a Booking shows
    // Bookings active (not Jobs). In the read-only preview we DON'T re-mark —
    // Recycle Bin stays highlighted.
    if (!ro) {
      const navHref = type.key === "booking" ? "#/bookings" : type.key === "contact" ? "#/contacts" : "#/jobs";
      document.querySelectorAll(".sidebar-nav .nav-item").forEach((a) => a.classList.toggle("active", a.dataset.href === navHref));
    }
    wrap.appendChild(back);

    const head = el("div", "contact-head");
    head.innerHTML = `<div class="contact-avatar">${esc((rec.title || type.label || "?").charAt(0).toUpperCase())}</div>
      <div><h1 class="contact-name">${esc(rec.title || "Untitled " + (type.label || App.label("record","one").toLowerCase()))}</h1>
      <div class="contact-sub">${esc(type.label || App.label("record","one"))}${rec.stageKey ? " · " + esc(recordStageLabel(type, rec.stageKey)) : ""}</div></div>`;
    wrap.appendChild(head);
    if (ro) wrap.appendChild(recyclePreviewChrome("record", rec, id));

    // ---- Details card (editable fields) ----
    const card = el("div", "card");
    card.appendChild(el("div", "drawer-section-title", "Details"));
    card.appendChild(el("label", "field-label", "Title"));
    const titleInp = el("input", "input"); titleInp.value = rec.title || "";
    card.appendChild(titleInp);

    // Type (required) — chooses which pipeline this job's candidates use.
    const subtypes = (type && type.subtypes) || [];
    let currentSubtypeKey = rec.subtypeKey || null;
    let subtypeSel = null;
    if (subtypes.length) {
      card.appendChild(el("label", "field-label", "Type *"));
      subtypeSel = el("select", "input");
      subtypeSel.appendChild(el("option", null, "— select a type —"));
      subtypes.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((st) => { const o = el("option", null, esc(st.label)); o.value = st.key; if (st.key === currentSubtypeKey) o.selected = true; subtypeSel.appendChild(o); });
      subtypeSel.onchange = () => { currentSubtypeKey = subtypeSel.value || null; loadLinks(); }; // refresh candidate stage options for the new pipeline
      card.appendChild(subtypeSel);
    }
    function currentStages() { const st = subtypes.find((s) => s.key === currentSubtypeKey); return st ? (st.stages || []) : ((type && type.stages) || []); }

    const recStages = (type && type.recordStages) || [];
    let stageSel = null;
    if (recStages.length) {
      card.appendChild(el("label", "field-label", "Status"));
      stageSel = el("select", "input");
      stageSel.appendChild(el("option", null, "— none —"));
      recStages.forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === rec.stageKey) o.selected = true; stageSel.appendChild(o); });
      card.appendChild(stageSel);
    }

    // Bookings: the typed appointment date AND time (a real field, not a custom
    // field). Required for bookings; the picker shows the stored time of day.
    const isBooking = type && type.key === "booking";
    let apptInp = null;
    if (isBooking) {
      card.appendChild(el("label", "field-label", "Appointment date & time *"));
      apptInp = el("input", "input"); apptInp.type = "datetime-local";
      apptInp.min = "2000-01-01T00:00"; apptInp.max = "2100-12-31T23:59"; // guard impossible years
      apptInp.value = isoToLocalInput(rec.appointmentAt);
      card.appendChild(apptInp);
    }

    // Bookings: the assigned RESOURCE (staff/stylist/...). Single typed attribute,
    // saved as resourceId. Options load async; the current assignment is preserved
    // even if the user saves before the list arrives.
    let resourceSel = null;
    if (isBooking) {
      card.appendChild(el("label", "field-label", "Assigned " + App.label("resource", "one")));
      resourceSel = el("select", "input");
      const none0 = document.createElement("option"); none0.value = ""; none0.textContent = "— None —"; resourceSel.appendChild(none0);
      if (rec.resourceId) { const cur = document.createElement("option"); cur.value = rec.resourceId; cur.textContent = "…"; resourceSel.appendChild(cur); resourceSel.value = rec.resourceId; }
      card.appendChild(resourceSel);
      App.portalApi("/api/resources").then((list) => {
        const keep = resourceSel.value;
        resourceSel.innerHTML = "";
        const n = document.createElement("option"); n.value = ""; n.textContent = "— None —"; resourceSel.appendChild(n);
        (list || []).forEach((r) => { const o = document.createElement("option"); o.value = r.id; o.textContent = r.name; resourceSel.appendChild(o); });
        resourceSel.value = keep;
      }).catch(() => { /* leave just None on failure */ });
    }

    const values = { ...(rec.customFields || {}) };
    const editorHost = el("div", "field-editor");
    card.appendChild(editorHost);
    App.fields.renderGroupedEditor(editorHost, fields || [], values, fieldSections || [], { readOnly: ro });

    const saveBar = el("div", "drawer-save-bar");
    const save = el("button", "btn btn-primary btn-sm", "Save changes");
    save.onclick = async () => {
      if (subtypeSel && !subtypeSel.value) { toast("Type is required", true); subtypeSel.focus(); return; }
      if (apptInp && !apptInp.value) { toast("Appointment date & time is required", true); apptInp.focus(); return; }
      if (apptInp && apptInp.value) { const y = parseInt(apptInp.value.slice(0, 4), 10); if (!(y >= 2000 && y <= 2100)) { toast("Please enter a valid appointment year", true); apptInp.focus(); return; } }
      const custom = {};
      (fields || []).forEach((f) => { if (f.type !== "formula") custom[f.key] = values[f.key]; });
      save.disabled = true; save.textContent = "Saving…";
      const patchBody = { title: titleInp.value, subtypeKey: subtypeSel ? (subtypeSel.value || null) : undefined, stageKey: stageSel ? (stageSel.value || null) : undefined, appointmentAt: apptInp ? (apptInp.value || null) : undefined, resourceId: resourceSel ? (resourceSel.value || null) : undefined, customFields: custom };
      const ov = { allowOverlap: false, allowClosed: false };
      const doPatch = () => App.portalApi("/api/records/" + id, { method: "PATCH", body: JSON.stringify({ ...patchBody, ...ov }) });
      try {
        for (;;) {
          try { await doPatch(); break; }
          catch (e) {
            const code = e && e.data && e.data.code;
            if (code === "overlap" && !ov.allowOverlap) {
              const ok = await confirmModal({ title: "Overlapping booking", message: "This overlaps an existing booking. Save anyway?", confirmText: "Save anyway" });
              if (!ok) { save.disabled = false; save.textContent = "Save changes"; return; }
              ov.allowOverlap = true; continue;
            }
            if (code === "closed" && !ov.allowClosed) {
              const ok = await confirmModal({ title: "Outside open hours", message: (e.message || "This is outside the open hours.") + " Save anyway?", confirmText: "Save anyway" });
              if (!ok) { save.disabled = false; save.textContent = "Save changes"; return; }
              ov.allowClosed = true; continue;
            }
            throw e;
          }
        }
        toast("Saved");
        rec.title = titleInp.value.trim();
        App.util.$(".contact-name", wrap).textContent = rec.title || ("Untitled " + (type.label || App.label("record","one").toLowerCase()));
        // A status/field save may have fired an automation that moves candidates
        // server-side; refresh the board shortly after so it reflects the change
        // without navigating away. (Async automations run just after the save.)
        scheduleCandRefresh();
      } catch (e) { toast(e.message, true); }
      finally { save.disabled = false; save.textContent = "Save changes"; }
    };
    saveBar.appendChild(save);
    card.appendChild(saveBar);
    wrap.appendChild(card);

    // Read-only preview: disable every Details input and hide Save — the SAME
    // technique used below for Google-synced bookings.
    if (ro) {
      card.querySelectorAll("input, select, textarea").forEach((e) => { e.disabled = true; });
      saveBar.style.display = "none";
    }

    // External/Blocked bookings (synced from Google) are read-only here — the server
    // rejects edits/deletes too (ownership guard). Show a clear banner, disable the
    // Details inputs, and hide Save. Internal notes below stay allowed.
    if (rec.externalSource === "google") {
      const banner = el("div", "ext-readonly-banner");
      banner.innerHTML = `<span aria-hidden="true">🔒</span><span>This booking is synced from <strong>Google Calendar</strong> and is read-only here. Edit or delete it in Google — your changes flow back automatically.</span>`;
      card.insertBefore(banner, card.firstChild.nextSibling);
      card.querySelectorAll("input, select, textarea").forEach((e) => { e.disabled = true; });
      saveBar.style.display = "none";
    }

    // ---- Linked candidates card: List | Board (kanban) — two views of the SAME links ----
    const linkCard = el("div", "card");
    const candHead = el("div", "cand-head");
    candHead.appendChild(el("div", "drawer-section-title", App.label("contact","many")));
    const candToggle = el("div", "seg-toggle");
    const tabListBtn = el("button", "seg-btn seg-on", "List");
    const tabBoardBtn = el("button", "seg-btn", "Board");
    candToggle.appendChild(tabListBtn); candToggle.appendChild(tabBoardBtn);
    candHead.appendChild(candToggle);
    linkCard.appendChild(candHead);
    const candBody = el("div");
    linkCard.appendChild(candBody);
    const addRow = el("div", "link-add");
    linkCard.appendChild(addRow);
    if (!ro) wrap.appendChild(linkCard); // linking/candidate management hidden in the read-only preview

    // ---- Activity card (Stage 2a): internal notes on this record. Notes live in
    // the record's customFields.__activity; automations and the box below write here.
    const actCard = el("div", "card");
    actCard.appendChild(el("div", "drawer-section-title", "Activity"));
    const actList = el("div");
    actCard.appendChild(actList);
    function renderActivity() {
      const items = ((rec.customFields || {}).__activity) || [];
      actList.innerHTML = "";
      if (!items.length) { actList.appendChild(el("p", "cell-muted", "No activity yet.")); return; }
      items.forEach((it) => {
        const row = el("div"); row.style.cssText = "padding:8px 0; border-bottom:1px solid var(--border);";
        const when = it.at ? new Date(it.at).toLocaleString() : "";
        const who = it.actorName ? it.actorName : (it.actorType === "automation" ? "Automation" : "System");
        const top = el("div"); top.textContent = it.text || "";
        const sub = el("div", "cell-muted"); sub.style.fontSize = "12px"; sub.textContent = who + " · " + when;
        row.appendChild(top); row.appendChild(sub);
        actList.appendChild(row);
      });
    }
    renderActivity();
    const addNoteRow = el("div"); addNoteRow.style.cssText = "display:flex; gap:6px; margin-top:10px;";
    const noteInp = el("input", "input"); noteInp.placeholder = "Add an internal note…"; noteInp.style.marginBottom = "0";
    const noteBtn = el("button", "btn btn-sm", "Add note");
    noteBtn.onclick = async () => {
      const text = noteInp.value.trim(); if (!text) return;
      noteBtn.disabled = true;
      try {
        const updated = await App.portalApi("/api/records/" + id + "/notes", { method: "POST", body: JSON.stringify({ text }) });
        rec.customFields = (updated && updated.customFields) || rec.customFields;
        noteInp.value = ""; renderActivity(); toast("Note added");
      } catch (e) { toast(e.message, true); }
      finally { noteBtn.disabled = false; }
    };
    addNoteRow.appendChild(noteInp); addNoteRow.appendChild(noteBtn);
    if (!ro) actCard.appendChild(addNoteRow); // notes are read-only in the preview
    wrap.appendChild(actCard);

    let candView = "list";
    let links = [];
    let kanbanDropHandled = false;
    function setCandView(v) { candView = v; tabListBtn.classList.toggle("seg-on", v === "list"); tabBoardBtn.classList.toggle("seg-on", v === "board"); renderCandidates(); }
    tabListBtn.onclick = () => setCandView("list");
    tabBoardBtn.onclick = () => setCandView("board");

    view().innerHTML = "";
    view().appendChild(wrap);

    function candWho(lk) { return lk.parent ? (lk.parent.name || lk.parent.email || lk.parent.phone || App.label("contact","one")) : (lk.parentType + " " + lk.parentId); }
    function candSub(lk) { if (!lk.parent) return ""; const nm = candWho(lk); const s = []; if (lk.parent.email && lk.parent.email !== nm) s.push(lk.parent.email); if (lk.parent.phone && lk.parent.phone !== nm) s.push(lk.parent.phone); return s.join(" · "); }

    async function loadLinks() {
      candBody.innerHTML = `<div class="cell-muted">Loading…</div>`;
      try { links = await App.portalApi("/api/records/" + id + "/links"); }
      catch (e) { candBody.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; return; }
      renderCandidates();
    }
    function renderCandidates() { if (candView === "board") renderCandBoard(); else renderCandList(); }

    // Part 2 (Batch A step 3): reflect server-side stage changes (e.g. the
    // automation "move" action) without the user navigating away and back.
    // Lightweight: refetch the links and re-render in place — no polling loop,
    // no realtime machinery. Skips while a drag is in progress and stops itself
    // once this record view is gone.
    async function refreshCandidatesQuietly() {
      if (!document.body.contains(wrap)) { document.removeEventListener("visibilitychange", onCandVisible); return; }
      if (document.querySelector(".kanban-card.dragging")) return; // don't fight an active drag
      try { const fresh = await App.portalApi("/api/records/" + id + "/links"); links = fresh; renderCandidates(); } catch (e) { /* leave current view on error */ }
    }
    function scheduleCandRefresh() { setTimeout(refreshCandidatesQuietly, 1200); setTimeout(refreshCandidatesQuietly, 3000); }
    function onCandVisible() { if (document.visibilityState === "visible") refreshCandidatesQuietly(); }
    document.addEventListener("visibilitychange", onCandVisible);

    // List view — the original table-ish list; its dropdown writes the SAME
    // RecordLink.stageKey and updates the in-memory link so the board matches.
    function renderCandList() {
      candBody.innerHTML = "";
      const listEl = el("div", "link-list");
      if (!links.length) listEl.appendChild(el("div", "cell-muted", ("No " + App.label("contact","many").toLowerCase() + " linked yet.")));
      links.forEach((lk) => {
        const row = el("div", "link-row");
        const who = candWho(lk);
        const nameEl = el("div", "link-name");
        nameEl.innerHTML = `${esc(who)} <span class="cell-muted link-ptype">${esc(lk.parentType)}</span>`;
        if (lk.parentType === "contact" && lk.parent) { nameEl.style.cursor = "pointer"; nameEl.onclick = () => App.go("#/contact/" + lk.parent.id); }
        row.appendChild(nameEl);
        const stageSelL = el("select", "input link-stage");
        stageSelL.appendChild(el("option", null, ("— " + App.label("stage","one").toLowerCase() + " —")));
        const stages = currentStages();
        let known = false;
        stages.forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === lk.stageKey) { o.selected = true; known = true; } stageSelL.appendChild(o); });
        if (lk.stageKey && !known) { const o = el("option", null, esc(lk.stageKey) + " (not in this pipeline)"); o.value = lk.stageKey; o.selected = true; stageSelL.appendChild(o); }
        stageSelL.onchange = async () => { const v = stageSelL.value || null; try { await App.portalApi("/api/record-links/" + lk.id, { method: "PATCH", body: JSON.stringify({ stageKey: v }) }); lk.stageKey = v; toast(App.label("stage","one") + " updated"); } catch (e) { toast(e.message, true); } };
        row.appendChild(stageSelL);
        const unlink = el("button", "link-danger", "Unlink");
        unlink.onclick = async () => { if (!(await confirmModal({ title: "Unlink", message: `Unlink ${who}?`, confirmText: "Unlink" }))) return; try { await App.portalApi("/api/record-links/" + lk.id, { method: "DELETE" }); toast("Unlinked"); loadLinks(); } catch (e) { toast(e.message, true); } };
        row.appendChild(unlink);
        listEl.appendChild(row);
      });
      candBody.appendChild(listEl);
    }

    // A draggable candidate card for the board.
    function candCard(lk) {
      const card = el("div", "kanban-card");
      card.draggable = true; card.dataset.linkId = lk.id;
      const who = candWho(lk); const sub = candSub(lk);
      const nameEl = el("div", "kanban-card-name", esc(who));
      if (lk.parentType === "contact" && lk.parent) { nameEl.style.cursor = "pointer"; nameEl.onclick = (e) => { e.stopPropagation(); App.go("#/contact/" + lk.parent.id); }; }
      card.appendChild(nameEl);
      if (sub) card.appendChild(el("div", "kanban-card-sub", esc(sub)));
      const x = el("button", "kanban-card-x", "×"); x.title = "Unlink";
      x.onclick = async (e) => { e.stopPropagation(); if (!(await confirmModal({ title: "Unlink", message: `Unlink ${who}?`, confirmText: "Unlink" }))) return; try { await App.portalApi("/api/record-links/" + lk.id, { method: "DELETE" }); toast("Unlinked"); loadLinks(); } catch (err) { toast(err.message, true); } };
      card.appendChild(x);
      card.addEventListener("dragstart", () => { kanbanDropHandled = false; card.classList.add("dragging"); });
      card.addEventListener("dragend", () => { card.classList.remove("dragging"); document.querySelectorAll(".kanban-col--over").forEach((c) => c.classList.remove("kanban-col--over")); if (!kanbanDropHandled) renderCandBoard(); });
      return card;
    }

    // Board view — one column per stage in THIS JOB'S TYPE pipeline (read live),
    // plus a "Needs review" lane for candidates whose stage isn't in the pipeline
    // (or is unset). Dropping persists RecordLink.stageKey and updates in place.
    function renderCandBoard() {
      candBody.innerHTML = "";
      if (!links.length) { candBody.appendChild(el("div", "cell-muted", ("No " + App.label("contact","many").toLowerCase() + " linked yet — link one below to start the board."))); return; }
      const stages = currentStages();
      const known = new Set(stages.map((s) => s.key));
      const board = el("div", "kanban");
      const lanes = [];
      const colByStage = {};
      function updateCounts() {
        lanes.forEach((m) => {
          const n = m.cards.querySelectorAll(".kanban-card").length;
          m.count.textContent = String(n);
          let ph = m.cards.querySelector(".kanban-empty");
          if (n === 0) { if (!ph) m.cards.appendChild(el("div", "kanban-empty", ("No " + App.label("contact","many").toLowerCase()))); }
          else if (ph) ph.remove();
        });
      }
      function makeColumn(key, label, isReview) {
        const col = el("div", "kanban-col" + (isReview ? " kanban-col--review" : ""));
        col.dataset.stage = key == null ? "" : key;
        const head = el("div", "kanban-col-head");
        head.appendChild(el("span", "kanban-col-name", label));
        head.appendChild(el("span", "kanban-dot", "·"));
        const count = el("span", "kanban-count", "0"); head.appendChild(count);
        col.appendChild(head);
        const cards = el("div", "kanban-cards"); col.appendChild(cards);
        col.addEventListener("dragover", (e) => { const d = document.querySelector(".kanban-card.dragging"); if (!d) return; e.preventDefault(); col.classList.add("kanban-col--over"); const ph = cards.querySelector(".kanban-empty"); if (ph) ph.remove(); cards.appendChild(d); });
        col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("kanban-col--over"); });
        col.addEventListener("drop", async (e) => {
          const d = document.querySelector(".kanban-card.dragging"); if (!d) return; e.preventDefault();
          col.classList.remove("kanban-col--over"); kanbanDropHandled = true;
          const linkId = d.dataset.linkId; const lk = links.find((x) => x.id === linkId);
          const newStage = isReview ? null : key;
          cards.appendChild(d);
          updateCounts();
          try { await App.portalApi("/api/record-links/" + linkId, { method: "PATCH", body: JSON.stringify({ stageKey: newStage }) }); if (lk) lk.stageKey = newStage; }
          catch (err) { toast(err.message, true); renderCandBoard(); }
        });
        const m = { col, cards, count }; lanes.push(m); return m;
      }
      const needsReview = links.filter((lk) => !lk.stageKey || !known.has(lk.stageKey));
      let reviewLane = null;
      if (needsReview.length) reviewLane = makeColumn(null, "Needs review", true);
      stages.forEach((s) => { colByStage[s.key] = makeColumn(s.key, s.label, false); });
      links.forEach((lk) => { const card = candCard(lk); if ((!lk.stageKey || !known.has(lk.stageKey)) && reviewLane) reviewLane.cards.appendChild(card); else if (colByStage[lk.stageKey]) colByStage[lk.stageKey].cards.appendChild(card); else if (reviewLane) reviewLane.cards.appendChild(card); });
      lanes.forEach((m) => board.appendChild(m.col));
      updateCounts();
      candBody.appendChild(board);
    }

    // Link-a-contact control: search this portal's contacts (GET /api/contacts,
    // portal-scoped) and link the chosen one. Results render IN-FLOW (not an
    // absolutely-positioned dropdown) because the enclosing .card has
    // overflow:hidden, which clipped the old absolute dropdown so it never showed.
    const addInput = el("input", "input link-search"); addInput.placeholder = ("Link a " + App.label("contact","one").toLowerCase() + " — type a name…");
    addRow.appendChild(addInput);
    const results = el("div");
    results.style.cssText = "margin-top:8px; display:none;";
    addRow.appendChild(results);

    let allContacts = null;
    async function ensureContacts() {
      if (allContacts) return allContacts;
      try { const raw = await App.portalApi("/api/contacts"); allContacts = Array.isArray(raw) ? raw : []; }
      catch (e) { allContacts = []; }
      return allContacts;
    }
    function showResults(nodes) {
      results.innerHTML = "";
      const box = el("div");
      box.style.cssText = "border:1px solid var(--line-strong); border-radius:8px; overflow:hidden; max-height:260px; overflow-y:auto; background:var(--panel);";
      nodes.forEach((n) => box.appendChild(n));
      results.appendChild(box);
      results.style.display = "block";
    }
    function hideResults() { results.style.display = "none"; results.innerHTML = ""; }
    function msgNode(text) { const d = el("div", "cell-muted", esc(text)); d.style.cssText = "padding:9px 12px;"; return d; }
    function resultButton(c) {
      const r = el("button", "link-result");
      r.style.cssText = "line-height:1.35;";
      const name = c.name || c.email || c.phone || App.label("contact","one");
      const sub = [];
      if (c.email && c.email !== name) sub.push(c.email);
      if (c.phone && c.phone !== name) sub.push(c.phone);
      r.innerHTML = `<div style="font-weight:600;">${esc(name)}</div>` +
        (sub.length ? `<div style="font-size:12px;color:var(--ink-faint);margin-top:1px;">${esc(sub.join(" · "))}</div>` : "");
      r.onclick = async () => {
        try {
          const firstStage = (currentStages())[0];
          await App.portalApi("/api/records/" + id + "/links", { method: "POST", body: JSON.stringify({ parentType: "contact", parentId: c.id, stageKey: firstStage ? firstStage.key : null }) });
          toast("Linked"); addInput.value = ""; hideResults(); loadLinks();
        } catch (e) { toast(e.message, true); }
      };
      return r;
    }
    async function runSearch() {
      const list = await ensureContacts();
      if (!list.length) { showResults([msgNode((`This portal has no ${App.label("contact","many").toLowerCase()} yet — add one on the ${App.label("contact","many")} page first.`))]); return; }
      const q = addInput.value.trim().toLowerCase();
      const matches = !q ? list.slice(0, 8) : list.filter((c) => ((c.name || "") + " " + (c.email || "") + " " + (c.phone || "")).toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) { showResults([msgNode(`No ${App.label("contact","many").toLowerCase()} match “${addInput.value.trim()}”.`)]); return; }
      showResults(matches.map(resultButton));
    }
    addInput.oninput = App.util.debounce(runSearch, 200);
    addInput.onfocus = runSearch;
    addInput.onblur = () => setTimeout(hideResults, 200); // let a result click register first

    if (!ro) loadLinks();
  }

  App.portal = { render, refresh, simulate, renderContact, renderRecord, renderRecycledPreview, current: () => current, contactColumnDefs };
  // Mountable labels editor (the SAME secLabels used by Settings > Labels), so the
  // portal setup screen can render it for a just-created portal. It targets whatever
  // App.state.currentPortalId is set to (via App.portalApi), like the in-portal pane.
  App.labelsEditor = { mount: (host) => secLabels(host) };
})(typeof window !== "undefined" ? window : globalThis);
