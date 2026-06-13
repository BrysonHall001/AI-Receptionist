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
    return (rows || []).map((r) => r.id + ":" + r.status).join("|");
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
    if (v === "recycle") return renderRecycleBin();
    if (v === "fields") return renderFields();
    if (v === "reports") return App.reports.render(view());
    if (v === "automations") return App.automations.render(view());
    if (v === "learn") return App.learn.render(view());
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

  // Build (or rebuild) ONLY the Calls table into `container`, returning the table
  // handle. Shared by the initial render and the live refresh so the two paint
  // identically. Does not touch the AI Instructions editor.
  function buildCallsTable(container, calls) {
    container.innerHTML = "";
    const columns = [
      { key: "name", label: "Caller", type: "text", get: (r) => r.name, text: (r) => r.name || "Unknown caller", cellClass: "cell-strong", render: (r) => esc(r.name || "Unknown caller") },
      { key: "phone", label: "Phone", type: "text", get: (r) => r.phone || r.fromNumber, cellClass: "cell-mono" },
      { key: "intent", label: "Reason", type: "text", get: (r) => r.intent, cellClass: "cell-muted cell-truncate", render: (r) => esc(r.intent || "—") },
      { key: "status", label: "Status", type: "status", get: (r) => r.status, text: (r) => ({ COMPLETED: "Completed", FAILED: "Missed", COLLECTING_INFO: "In progress", GREETING: "In progress", INIT: "New" }[r.status] || r.status), render: (r) => statusBadge(r.status) },
      { key: "createdAt", label: "When", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` },
    ];
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
    const head = el("div");
    head.innerHTML =
      `<h3 style="margin:0 0 6px;">AI Instructions</h3>` +
      `<p class="cell-muted" style="margin:0 0 4px;">Tell your AI receptionist about your business — services, hours, pricing, anything it should know — and how you'd like it to behave on calls. This guidance is added on top of the receptionist's built-in helpfulness. (The receptionist will still capture caller details for you.)</p>` +
      `<p class="cell-muted" style="margin:0 0 10px;font-size:12px;">Tip: add information, don't remove the receptionist's core behavior — it's designed to stay helpful and log calls automatically.</p>`;
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
        render: f.key === "name" ? (r) => esc(disp(r) || "Unknown") : (r) => esc(disp(r) || "—"),
      };
    });
    cols.push({ key: "callCount", label: "Calls", type: "number", get: (r) => r.callCount, text: (r) => String(r.callCount || 0) });
    cols.push({ key: "createdAt", label: "Time Created", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` });
    return cols;
  }

  const DEFAULT_COLS = ["name", "phone", "email", "intent", "callCount", "createdAt"];
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
    exportBtn.onclick = () => openExport(handle ? handle.getColumns() : columns, contacts);
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
    bulkMenu.appendChild(bulkItem("Email selected", () => { if (!handle.getSelected().length) return needSelection(); bulkMenu.classList.add("hidden"); bulkCompose("email", selectedRows()); }));
    bulkMenu.appendChild(bulkItem("Text selected", () => { if (!handle.getSelected().length) return needSelection(); bulkMenu.classList.add("hidden"); bulkCompose("sms", selectedRows()); }));
    bulkMenu.appendChild(bulkItem("Export selected", () => { const rows = selectedRows(); if (!rows.length) return needSelection(); bulkMenu.classList.add("hidden"); openExport(handle.getColumns(), rows); }));
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

  // ---------------- Bulk email/text (reuses the single-contact send endpoints) ----------------
  function bulkCompose(kind, rows) {
    const reachable = rows.filter((r) => (kind === "email" ? r.email : r.phone));
    const overlay = el("div", "modal-overlay");
    const modal = el("div", "modal");
    const title = kind === "email" ? ("Email selected " + App.label("contact","many").toLowerCase()) : ("Text selected " + App.label("contact","many").toLowerCase());
    modal.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="icon-btn" id="bc-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    const note = el("p", "cell-muted");
    note.textContent = `${reachable.length} of ${rows.length} selected ${kind === "email" ? "have an email address" : "have a phone number"} and will receive this.`;
    note.style.marginBottom = "10px";
    body.appendChild(note);
    const composerHost = el("div");
    body.appendChild(composerHost);
    const api = App.compose.mount(composerHost, { kind: kind === "email" ? "email" : "sms" });
    const foot = el("div", "modal-foot");
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    const send = el("button", "btn btn-primary btn-sm", kind === "email" ? "Send emails" : "Send texts");
    foot.appendChild(cancel); foot.appendChild(send);
    modal.appendChild(body); modal.appendChild(foot); overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    modal.querySelector("#bc-close").onclick = close;
    cancel.onclick = close;
    send.onclick = async () => {
      if (kind === "email" && !api.getSubject()) { App.util.toast("Add a subject", true); return; }
      if (!reachable.length) { App.util.toast("No reachable recipients", true); return; }
      send.disabled = true; send.textContent = "Sending…";
      let ok = 0, fail = 0;
      for (const r of reachable) {
        try {
          if (kind === "email") await App.portalApi(`/api/contacts/${r.id}/email`, { method: "POST", body: JSON.stringify({ subject: api.getSubject(), html: api.getHTML() }) });
          else await App.portalApi(`/api/contacts/${r.id}/text`, { method: "POST", body: JSON.stringify({ body: api.getHTML ? (api.getText ? api.getText() : api.getHTML()) : "" }) });
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
    const [deleted, fields, colResp] = await Promise.all([
      App.portalApi("/api/contacts/deleted"),
      App.portalApi("/api/fields").catch(() => []),
      App.portalApi("/api/account/contact-columns").catch(() => ({ layout: {} })),
    ]);
    const allColumns = contactColumnDefs(fields);
    const layout = (colResp && colResp.layout) || {};
    let columns = applyColumnLayout(allColumns, layout).slice();
    // Override the name column to show the countdown beneath the name.
    columns = columns.map((c) => c.key === "name"
      ? { ...c, render: (r) => `${esc((r.name) || "Unknown")}<div class="rb-countdown">${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} until permanent deletion</div>` }
      : c);

    view().innerHTML = "";
    const container = el("div", "fade-in");
    const head = el("div", "rb-head");
    head.innerHTML = `<div><h1 class="rb-title">&#128465; Recycle Bin</h1><p class="cell-muted">Deleted contacts are kept for 30 days, then permanently removed. They don't appear anywhere else.</p></div>`;
    const backBtn = el("a", "btn btn-ghost btn-sm", ("← Back to " + App.label("contact","many")));
    backBtn.href = "#/contacts";
    head.appendChild(backBtn);
    container.appendChild(head);
    const tableHost = el("div");
    container.appendChild(tableHost);
    view().appendChild(container);

    let handle;
    handle = App.table.mount({
      container: tableHost, columns, rows: deleted, selectable: true, rowId: (r) => r.id,
      onRowClick: (r) => App.go("#/contact/" + r.id),
      onSelectionChange: (ids) => { rc.textContent = ids.length ? `${ids.length} selected` : ""; },
      defaultSort: "createdAt", defaultSortDir: "desc",
      emptyHtml: `<div class="empty"><div class="empty-emoji">&#128465;</div><h3>Recycle Bin is empty</h3><p>Deleted contacts will appear here for 30 days.</p></div>`,
    });
    const restoreBtn = el("button", "btn btn-primary btn-sm", "Restore selected");
    const rc = el("span", "bulk-count", "");
    restoreBtn.onclick = async () => {
      const ids = handle.getSelected();
      if (!ids.length) { App.util.toast(("Select a " + App.label("contact","one").toLowerCase() + " first."), true); return; }
      try { await App.portalApi("/api/contacts/restore", { method: "POST", body: JSON.stringify({ ids }) }); App.util.toast("Restored to " + App.label("contact","many")); renderRecycleBin(); }
      catch (e) { App.util.toast(e.message, true); }
    };
    if (handle.toolbarLeft) { handle.toolbarLeft.appendChild(restoreBtn); handle.toolbarLeft.appendChild(rc); }
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

  async function openExport(columns, rows) {
    const exportable = columns.filter((c) => c.key);
    const exState = { rules: [], search: "" };
    const selected = new Set(exportable.map((c) => c.key)); // all on by default

    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Export contacts</h2><button class="icon-btn" id="ex-close">&times;</button></div>
      <div class="modal-body">
        <label class="field-label">Export name *</label>
        <input id="ex-name" class="input" placeholder="e.g. June leads — HVAC" />
        <label class="field-label">Start from a saved filter (optional)</label>
        <select id="ex-saved" class="input"><option value="">— none —</option></select>
        <label class="field-label">Who to export</label>
        <div id="ex-rules"></div>
        <label class="field-label" style="margin-top:14px">Fields to include</label>
        <div id="ex-fields" class="ex-fields"></div>
        <p class="cell-muted" id="ex-count"></p>
        <label class="field-label">Format</label>
        <select id="ex-format" class="input"><option value="csv">CSV (.csv)</option><option value="xlsx">Excel (.xlsx)</option></select>
        <button id="ex-go" class="btn btn-primary btn-block">Export</button>
        <div class="ex-history-head">Previous exports</div>
        <div id="ex-history" class="ex-history"><div class="cell-muted">Loading…</div></div>
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#ex-close").onclick = () => overlay.remove();

    // saved filters dropdown to prefill criteria
    try {
      const saved = await App.portalApi("/api/saved-filters?view=contacts");
      const sel = inner.querySelector("#ex-saved");
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

    const rulesHost = inner.querySelector("#ex-rules");
    rulesHost.appendChild(App.table.ruleEditor(exportable, rows, exState.rules, () => updateCount()));

    const fieldsHost = inner.querySelector("#ex-fields");
    exportable.forEach((c) => {
      const id = "exf-" + c.key;
      const lab = el("label", "ex-field");
      lab.innerHTML = `<input type="checkbox" id="${id}" checked /> <span>${esc(c.label)}</span>`;
      lab.querySelector("input").onchange = (e) => { if (e.target.checked) selected.add(c.key); else selected.delete(c.key); };
      fieldsHost.appendChild(lab);
    });

    function matching() { return App.table.pipeline(rows, exportable, exState); }
    function updateCount() {
      const n = matching().length;
      inner.querySelector("#ex-count").textContent = `${n} of ${App.countLabel("contact", rows.length).toLowerCase()} match.`;
    }
    updateCount();

    async function loadHistory() {
      const host = inner.querySelector("#ex-history");
      try {
        const list = await App.portalApi("/api/exports");
        host.innerHTML = "";
        if (!list.length) { host.appendChild(el("div", "cell-muted", "No exports yet.")); return; }
        list.forEach((ex) => {
          const row = el("div", "ex-hist-row");
          row.innerHTML = `<div class="ex-hist-main"><div class="ex-hist-name">${esc(ex.name)}</div>
            <div class="ex-hist-meta">${ex.rowCount} contacts · ${fmtDate(ex.createdAt)}</div></div>`;
          const dl = el("button", "btn btn-ghost btn-sm", "Download");
          dl.onclick = async () => {
            try { const r = await App.portalApi(`/api/exports/${ex.id}/download`); downloadCSV(`${(r.name || "export").replace(/[^a-z0-9]+/gi, "-")}.csv`, r.csv); }
            catch (err) { App.util.toast(err.message, true); }
          };
          row.appendChild(dl);
          host.appendChild(row);
        });
      } catch (err) { host.innerHTML = `<div class="cell-muted">${esc(err.message)}</div>`; }
    }
    loadHistory();

    inner.querySelector("#ex-go").onclick = async () => {
      const name = inner.querySelector("#ex-name").value.trim();
      if (!name) { App.util.toast("Please give this export a name", true); inner.querySelector("#ex-name").focus(); return; }
      const cols = exportable.filter((c) => selected.has(c.key));
      if (!cols.length) { App.util.toast("Pick at least one field", true); return; }
      const out = matching();
      if (!out.length) { App.util.toast(("No " + App.label("contact","many").toLowerCase() + " match"), true); return; }
      const header = cols.map((c) => csvCell(c.label)).join(",");
      const lines = out.map((row) => cols.map((c) => csvCell(c.text ? c.text(row) : c.get(row))).join(","));
      const csv = [header, ...lines].join("\n");
      const fileBase = name.replace(/[^a-z0-9]+/gi, "-");
      const format = inner.querySelector("#ex-format").value;
      if (format === "xlsx") {
        if (typeof XLSX === "undefined") { App.util.toast("Excel needs internet — exporting CSV instead", true); downloadCSV(`${fileBase}.csv`, csv); }
        else {
          const aoa = [cols.map((c) => c.label), ...out.map((row) => cols.map((c) => (c.text ? c.text(row) : c.get(row)) ?? ""))];
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, App.label("contact", "many"));
          const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
          downloadBlob(`${fileBase}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        }
      } else {
        downloadCSV(`${fileBase}.csv`, csv);
      }
      try {
        await App.portalApi("/api/exports", { method: "POST", body: JSON.stringify({ name, rowCount: out.length, fields: cols.map((c) => c.label), csv }) });
        App.util.toast(`Exported ${App.countLabel("contact", out.length).toLowerCase()}`);
        loadHistory();
      } catch (err) { App.util.toast("Downloaded, but couldn't save to history: " + err.message, true); }
    };
  }

  function emptyCalls() {
    const e = el("div", "card");
    e.innerHTML = `<div class="empty"><div class="empty-emoji">&#128222;</div><h3>No calls yet</h3>
      <p>Use the &ldquo;Simulate call&rdquo; button above to generate a sample lead, or take a real call.</p></div>`;
    return e;
  }

  // ---------------- Fields tab ----------------
  async function renderFields(refresh) {
    if (!refresh) loading(); // on refresh we hold the current view until the rebuilt one is ready — no blink
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
      view().innerHTML = ""; view().appendChild(wrap); return;
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

    view().innerHTML = "";
    view().appendChild(wrap);
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
  async function renderContact(id) {
    loading();
    let c, fields, sections;
    try { [c, fields, sections] = await Promise.all([App.portalApi(`/api/contacts/${id}`), App.portalApi("/api/fields"), App.portalApi("/api/field-sections?recordType=contact").catch(() => [])]); }
    catch (err) { view().innerHTML = `<div class="card"><p class="cell-muted">${esc(err.message)}</p></div>`; return; }

    const wrap = el("div", "fade-in contact-page");
    const back = el("a", "back-link", ("← " + App.label("contact","many")));
    back.href = "#/contacts";
    wrap.appendChild(back);

    const head = el("div", "contact-head");
    head.innerHTML = `<div class="contact-avatar">${esc((c.name || c.phone || "?").charAt(0).toUpperCase())}</div>
      <div><h1 class="contact-name">${esc(c.name || "Unknown")}</h1>
      <div class="contact-sub">${esc(c.phone || "")}${c.email ? " · " + esc(c.email) : ""}</div></div>`;
    const runAuto = el("button", "btn btn-ghost btn-sm", "Run automation");
    runAuto.style.marginLeft = "auto";
    runAuto.onclick = () => openRunAutomation(id, c.name || c.phone || ("this " + App.label("contact","one").toLowerCase()));
    head.appendChild(runAuto);
    wrap.appendChild(head);

    const tabsBar = el("div", "tabs");
    const tabBody = el("div", "tab-body");
    const tabs = [["fields", "All fields"], ["timeline", "Timeline"], ["email", "Email"], ["text", "Text"]];
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
    wrap.appendChild(jobsCard);
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

    loadLinkedJobs();

    view().innerHTML = "";
    view().appendChild(wrap);

    // ---- All fields tab ----
    function tabFields() {
      tabBody.innerHTML = "";
      const values = { name: c.name || "", phone: c.phone || "", email: c.email || "", intent: c.intent || "", ...(c.customFields || {}) };
      const card = el("div", "card");
      const editorHost = el("div", "field-editor");
      card.appendChild(editorHost);
      App.fields.renderGroupedEditor(editorHost, fields, values, sections || [], {});
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
      { key: "general", label: "General", admin: true, build: secGeneral },
      { key: "appearance", label: "Appearance", admin: true, build: secAppearance },
      { key: "team", label: "Team", admin: true, build: secTeam },
      { key: "leadcapture", label: "Lead capture", admin: true, build: secLeadCapture },
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
      panel.innerHTML = `<h2 class="settings-h">General</h2>
        <div class="settings-grid">
          <label class="field-label">Business name</label><input id="set-name" class="input" value="${esc(portal.name)}" />
          <label class="field-label">Business type</label><input id="set-type" class="input" value="${esc(portal.businessType)}" />
          <label class="field-label">Phone number</label><input id="set-phone" class="input" value="${esc(portal.phoneNumber || "")}" />
          <label class="field-label">Notify email</label><input id="set-email" class="input" value="${esc(portal.notifyEmail)}" />
          <label class="field-label">Greeting</label><textarea id="set-greet" class="input" rows="2">${esc(portal.greeting)}</textarea>
        </div>
        <button id="set-save" class="btn btn-primary btn-sm">Save changes</button>`;
      App.util.$("#set-save").onclick = async () => {
        try {
          await App.portalApi("/api/settings", { method: "PATCH", body: JSON.stringify({
            name: App.util.$("#set-name").value, businessType: App.util.$("#set-type").value,
            phoneNumber: App.util.$("#set-phone").value, notifyEmail: App.util.$("#set-email").value,
            greeting: App.util.$("#set-greet").value }) });
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
      panel.innerHTML = `<h2 class="settings-h">Team members</h2>
        <table class="mini-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody id="users-tbody"></tbody></table>
        <div class="add-user">
          <input id="nu-name" class="input" placeholder="Name" />
          <input id="nu-email" class="input" placeholder="email@company.com" />
          <input id="nu-pass" class="input" type="text" placeholder="Temp password (8+)" />
          <select id="nu-role" class="input"><option value="CLIENT_USER">Client User</option><option value="PORTAL_ADMIN">Portal Admin</option></select>
          <button id="nu-add" class="btn btn-primary btn-sm">Add user</button>
        </div>`;
      fillUsers(users);
      App.util.$("#nu-add").onclick = async () => {
        try {
          await App.portalApi("/api/users", { method: "POST", body: JSON.stringify({
            name: App.util.$("#nu-name").value, email: App.util.$("#nu-email").value,
            password: App.util.$("#nu-pass").value, role: App.util.$("#nu-role").value }) });
          toast("User added");
          secTeam(panel); // refresh the list in place (same as before)
        } catch (err) { toast(err.message, true); }
      };
    }

    async function secLeadCapture(panel) {
      panel.innerHTML = `<h2 class="settings-h">Lead capture links</h2>
        <p class="cell-muted" style="font-size:13px;margin-bottom:10px">Create a secure link you can give to a website form, Zapier, or another tool so new leads land directly in this portal.</p>
        <div id="inbound-host"></div>`;
      if (App.inbound) { const h = App.util.$("#inbound-host"); if (h) App.inbound.render(h); }
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
      panel.innerHTML = `<h2 class="settings-h">Fields</h2>
        <p class="cell-muted" style="font-size:13.5px;margin-bottom:14px">Add and organize the fields and pipelines for your ${esc(App.label("contact", "many").toLowerCase())} and ${esc(App.label("job", "many").toLowerCase())}. Field settings open on their own page for now.</p>
        <a class="btn btn-primary btn-sm" href="#/fields">Open field settings &rarr;</a>`;
    }
  }

  function fillUsers(users) {
    const tb = App.util.$("#users-tbody");
    if (!tb) return;
    tb.innerHTML = "";
    users.forEach((u) => {
      const tr = el("tr");
      tr.innerHTML = `<td>${esc(u.name || "—")}</td><td class="cell-muted">${esc(u.email)}</td><td>${esc(roleLabel(u.role))}</td><td></td>`;
      const actions = tr.lastChild;
      if (u.id !== App.state.me.id) {
        const del = el("button", "link-danger", "Remove");
        del.onclick = async () => { if (!(await confirmModal({ title: "Remove user", message: `Remove ${u.email}?`, confirmText: "Remove" }))) return; try { await App.portalApi(`/api/users/${u.id}`, { method: "DELETE" }); toast("User removed"); renderSettings(); } catch (e) { toast(e.message, true); } };
        actions.appendChild(del);
      }
      tb.appendChild(tr);
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
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#imp-close").onclick = () => overlay.remove();
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

  function recordColumnDefs(fields, type) {
    const cols = [];
    cols.push({ key: "title", label: "Title", type: "text", get: (r) => r.title, text: (r) => r.title || "", cellClass: "cell-strong", render: (r) => esc(r.title || "Untitled") });
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
    let records, fields, types;
    try {
      [records, fields, types] = await Promise.all([
        App.portalApi("/api/records?type=" + encodeURIComponent(typeKey)),
        App.portalApi("/api/fields?recordType=" + encodeURIComponent(typeKey)).catch(() => []),
        App.portalApi("/api/record-types").catch(() => []),
      ]);
    } catch (e) { view().innerHTML = `<div class="card"><p class="cell-muted">${esc(e.message)}</p></div>`; return; }
    const type = (types || []).find((t) => t.key === typeKey) || { key: typeKey, label: App.label("record","one"), labelPlural: "Records", stages: [], recordStages: [] };
    const titleEl = document.querySelector(".page-title"); if (titleEl) titleEl.textContent = type.labelPlural || type.label;

    const allColumns = recordColumnDefs(fields, type);
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
    exportBtn.onclick = () => openRecordExport(handle ? handle.getColumns() : columns, records, type.labelPlural || type.label);
    bar.appendChild(dummyBtn);
    bar.appendChild(createBtn);
    bar.appendChild(importBtn);
    bar.appendChild(exportBtn);
    container.appendChild(bar);
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
    bulkMenu.appendChild(bulkItem("Export selected", () => { const rows = selectedRows(); if (!rows.length) return needSelection(); bulkMenu.classList.add("hidden"); openRecordExport(handle.getColumns(), rows, type.labelPlural || type.label); }));
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

  function openCreateRecord(typeKey, fields, type) {
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
      const custom = {};
      (fields || []).forEach((f) => { if (f.type !== "formula") custom[f.key] = values[f.key]; });
      save.disabled = true; save.textContent = "Creating…";
      try {
        const rec = await App.portalApi("/api/records", { method: "POST", body: JSON.stringify({ type: typeKey, title, subtypeKey: subtypeSel ? (subtypeSel.value || null) : null, stageKey: stageSel ? (stageSel.value || null) : null, customFields: custom }) });
        toast(`${type.label || App.label("record","one")} created`);
        overlay.remove();
        App.go("#/record/" + rec.id);
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
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#imp-close").onclick = () => overlay.remove();

    // Mapping targets: the record's Title plus each non-formula field of this type.
    const targets = [{ key: "__title__", label: "Title", required: true }].concat(
      (fields || []).filter((f) => f.type !== "formula").map((f) => ({ key: f.key, label: f.label }))
    );
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
          <button class="btn btn-primary btn-block" id="imp-go">Import ${dataRows.length} ${esc((type.labelPlural || App.label("record","many").toLowerCase()).toLowerCase())}</button>`;
        host.querySelector("#imp-go").onclick = async () => {
          const map = {};
          App.util.$$(".map-sel", host).forEach((s) => { map[s.dataset.key] = parseInt(s.value, 10); });
          if (map["__title__"] == null || map["__title__"] < 0) { toast("Map the Title column", true); return; }
          const mappedRows = dataRows.map((r) => {
            const title = r[map["__title__"]];
            const customFields = {};
            targets.forEach((t) => { if (t.key === "__title__") return; const idx = map[t.key]; if (idx != null && idx >= 0) { const v = r[idx]; if (v !== undefined && String(v).trim() !== "") customFields[t.key] = v; } });
            return { title, customFields };
          });
          const btn = host.querySelector("#imp-go");
          btn.disabled = true; btn.textContent = "Importing…";
          try {
            const res = await App.portalApi("/api/records/import", { method: "POST", body: JSON.stringify({ type: typeKey, rows: mappedRows }) });
            toast(`Imported ${res.imported}${res.skipped ? `, skipped ${res.skipped}` : ""}`);
            overlay.remove();
            renderRecordList(typeKey);
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

  function openRecordExport(columns, rows, typeLabel) {
    const exportable = columns.filter((c) => c.key);
    const exState = { rules: [], search: "" };
    const selected = new Set(exportable.map((c) => c.key));
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Export ${esc(typeLabel || App.label("record","many").toLowerCase())}</h2><button class="icon-btn" id="ex-close">&times;</button></div>
      <div class="modal-body">
        <label class="field-label">Export name *</label>
        <input id="ex-name" class="input" placeholder="e.g. Open roles" />
        <label class="field-label">Who to export</label>
        <div id="ex-rules"></div>
        <label class="field-label" style="margin-top:14px">Fields to include</label>
        <div id="ex-fields" class="ex-fields"></div>
        <p class="cell-muted" id="ex-count"></p>
        <label class="field-label">Format</label>
        <select id="ex-format" class="input"><option value="csv">CSV (.csv)</option><option value="xlsx">Excel (.xlsx)</option></select>
        <button id="ex-go" class="btn btn-primary btn-block">Export</button>
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#ex-close").onclick = () => overlay.remove();
    const rulesHost = inner.querySelector("#ex-rules");
    rulesHost.appendChild(App.table.ruleEditor(exportable, rows, exState.rules, () => updateCount()));
    const fieldsHost = inner.querySelector("#ex-fields");
    exportable.forEach((c) => {
      const lab = el("label", "ex-field");
      lab.innerHTML = `<input type="checkbox" checked /> <span>${esc(c.label)}</span>`;
      lab.querySelector("input").onchange = (e) => { if (e.target.checked) selected.add(c.key); else selected.delete(c.key); };
      fieldsHost.appendChild(lab);
    });
    function matching() { return App.table.pipeline(rows, exportable, exState); }
    function updateCount() { inner.querySelector("#ex-count").textContent = `${matching().length} of ${rows.length} match.`; }
    updateCount();
    inner.querySelector("#ex-go").onclick = () => {
      const name = inner.querySelector("#ex-name").value.trim();
      if (!name) { toast("Please give this export a name", true); return; }
      const cols = exportable.filter((c) => selected.has(c.key));
      if (!cols.length) { toast("Pick at least one field", true); return; }
      const out = matching();
      if (!out.length) { toast("Nothing matches", true); return; }
      const header = cols.map((c) => csvCell(c.label)).join(",");
      const lines = out.map((row) => cols.map((c) => csvCell(c.text ? c.text(row) : c.get(row))).join(","));
      const csv = [header, ...lines].join("\n");
      const fileBase = name.replace(/[^a-z0-9]+/gi, "-");
      const format = inner.querySelector("#ex-format").value;
      if (format === "xlsx" && typeof XLSX !== "undefined") {
        const aoa = [cols.map((c) => c.label), ...out.map((row) => cols.map((c) => (c.text ? c.text(row) : c.get(row)) ?? ""))];
        const ws = XLSX.utils.aoa_to_sheet(aoa); const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, (type.labelPlural || App.label("record","many")));
        const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
        downloadBlob(`${fileBase}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      } else {
        downloadCSV(`${fileBase}.csv`, csv);
      }
      toast(`Exported ${out.length}`);
      overlay.remove();
    };
  }

  // ---------------- Single record (e.g. Job) detail ----------------
  async function renderRecord(id) {
    loading();
    let rec, types;
    try { [rec, types] = await Promise.all([App.portalApi("/api/records/" + id), App.portalApi("/api/record-types").catch(() => [])]); }
    catch (e) { view().innerHTML = `<div class="card"><p class="cell-muted">${esc(e.message)}</p></div>`; return; }
    const type = (types || []).find((t) => t.id === rec.recordTypeId) || { key: "record", label: App.label("record","one"), labelPlural: "Records", stages: [], recordStages: [] };
    let fields = [];
    let fieldSections = [];
    try { [fields, fieldSections] = await Promise.all([App.portalApi("/api/fields?recordType=" + encodeURIComponent(type.key)), App.portalApi("/api/field-sections?recordType=" + encodeURIComponent(type.key)).catch(() => [])]); } catch (e) { fields = []; }

    const wrap = el("div", "fade-in contact-page");
    const back = el("a", "back-link", "← " + esc(type.labelPlural || App.label("record","many")));
    back.href = "#/jobs";
    wrap.appendChild(back);

    const head = el("div", "contact-head");
    head.innerHTML = `<div class="contact-avatar">${esc((rec.title || type.label || "?").charAt(0).toUpperCase())}</div>
      <div><h1 class="contact-name">${esc(rec.title || "Untitled " + (type.label || App.label("record","one").toLowerCase()))}</h1>
      <div class="contact-sub">${esc(type.label || App.label("record","one"))}${rec.stageKey ? " · " + esc(recordStageLabel(type, rec.stageKey)) : ""}</div></div>`;
    wrap.appendChild(head);

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

    const values = { ...(rec.customFields || {}) };
    const editorHost = el("div", "field-editor");
    card.appendChild(editorHost);
    App.fields.renderGroupedEditor(editorHost, fields || [], values, fieldSections || [], {});

    const saveBar = el("div", "drawer-save-bar");
    const save = el("button", "btn btn-primary btn-sm", "Save changes");
    save.onclick = async () => {
      if (subtypeSel && !subtypeSel.value) { toast("Type is required", true); subtypeSel.focus(); return; }
      const custom = {};
      (fields || []).forEach((f) => { if (f.type !== "formula") custom[f.key] = values[f.key]; });
      save.disabled = true; save.textContent = "Saving…";
      try {
        await App.portalApi("/api/records/" + id, { method: "PATCH", body: JSON.stringify({ title: titleInp.value, subtypeKey: subtypeSel ? (subtypeSel.value || null) : undefined, stageKey: stageSel ? (stageSel.value || null) : undefined, customFields: custom }) });
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
    wrap.appendChild(linkCard);

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
    actCard.appendChild(addNoteRow);
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

    loadLinks();
  }

  App.portal = { render, refresh, simulate, renderContact, renderRecord, current: () => current };
  // Mountable labels editor (the SAME secLabels used by Settings > Labels), so the
  // portal setup screen can render it for a just-created portal. It targets whatever
  // App.state.currentPortalId is set to (via App.portalApi), like the in-portal pane.
  App.labelsEditor = { mount: (host) => secLabels(host) };
})(typeof window !== "undefined" ? window : globalThis);
