(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, fmtDate, statusBadge, roleLabel, toast } = App.util;

  let current = "dashboard";

  function view() { return App.util.$("#view"); }
  function setView(v) { current = v; }

  async function render(v) {
    setView(v);
    if (v === "calls") return renderCalls();
    if (v === "contacts") return renderContacts();
    if (v === "recycle") return renderRecycleBin();
    if (v === "fields") return renderFields();
    if (v === "reports") return App.reports.render(view());
    if (v === "automations") return App.automations.render(view());
    if (v === "settings") return renderSettings();
    return renderDashboard();
  }
  function refresh() { return render(current); }

  function loading() { view().innerHTML = `<div class="card"><div class="skeleton">Loading…</div></div>`; }

  // ---------------- Dashboard ----------------
  async function renderDashboard() {
    loading();
    const calls = await App.portalApi("/api/calls");
    const wrap = el("div", "fade-in");

    // Top section: a full dashboard (same widgets/grid/buttons as Reports).
    const dashHead = el("div", "section-head");
    dashHead.appendChild(el("h2", null, "Overview"));
    const reportsLink = el("a", "muted-link", "Open Reports →");
    reportsLink.href = "#/reports";
    dashHead.appendChild(reportsLink);
    wrap.appendChild(dashHead);
    const homeHost = el("div", "home-dashboard");
    homeHost.style.maxHeight = "40vh";
    homeHost.style.overflowY = "auto";
    homeHost.style.overflowX = "hidden";
    wrap.appendChild(homeHost);

    const divider = el("div", "section-divider");
    wrap.appendChild(divider);

    const head = el("div", "section-head");
    head.appendChild(el("h2", null, "Recent calls"));
    const link = el("a", "muted-link", "View all →");
    link.href = "#/calls";
    head.appendChild(link);
    wrap.appendChild(head);

    if (!calls.length) {
      wrap.appendChild(emptyCalls());
    } else {
      const card = el("div", "card");
      const table = el("table");
      table.innerHTML = `<thead><tr><th>Caller</th><th>Phone</th><th>Reason</th><th>Status</th><th>When</th></tr></thead>`;
      const tb = el("tbody");
      calls.slice(0, 8).forEach((c) => {
        const tr = el("tr");
        tr.innerHTML = `<td class="cell-strong">${esc(c.name || "Unknown caller")}</td>
          <td class="cell-mono">${esc(c.phone || c.fromNumber)}</td>
          <td class="cell-muted cell-truncate">${esc(c.intent || "—")}</td>
          <td>${statusBadge(c.status)}</td>
          <td class="cell-muted">${fmtDate(c.createdAt)}</td>`;
        tr.onclick = () => openCall(c.id);
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      card.appendChild(table);
      wrap.appendChild(card);
    }
    view().innerHTML = "";
    view().appendChild(wrap);
    App.reports.mountHome(homeHost);
  }

  // ---------------- Calls ----------------
  async function renderCalls() {
    loading();
    const calls = await App.portalApi("/api/calls");
    const columns = [
      { key: "name", label: "Caller", type: "text", get: (r) => r.name, text: (r) => r.name || "Unknown caller", cellClass: "cell-strong", render: (r) => esc(r.name || "Unknown caller") },
      { key: "phone", label: "Phone", type: "text", get: (r) => r.phone || r.fromNumber, cellClass: "cell-mono" },
      { key: "intent", label: "Reason", type: "text", get: (r) => r.intent, cellClass: "cell-muted cell-truncate", render: (r) => esc(r.intent || "—") },
      { key: "status", label: "Status", type: "status", get: (r) => r.status, text: (r) => ({ COMPLETED: "Completed", FAILED: "Missed", COLLECTING_INFO: "In progress", GREETING: "In progress", INIT: "New" }[r.status] || r.status), render: (r) => statusBadge(r.status) },
      { key: "createdAt", label: "When", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` },
    ];
    view().innerHTML = "";
    const container = el("div", "fade-in");
    view().appendChild(container);
    App.table.mount({
      container, columns, rows: calls, onRowClick: (r) => openCall(r.id),
      defaultSort: "createdAt", defaultSortDir: "desc", highlightId: App._highlightCallId,
      emptyHtml: emptyCalls().outerHTML, onEmptyMount: (w) => { const b = w.querySelector("#empty-sim"); if (b) b.onclick = simulate; },
    });
    App._highlightCallId = null;
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
    const importBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8681;</span> Import contacts`);
    importBtn.onclick = openImport;
    const exportBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8679;</span> Export contacts`);
    exportBtn.onclick = () => openExport(handle ? handle.getColumns() : columns, contacts);
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
    const bulkMsg = el("div", "bulk-empty hidden", "Select a contact first.");
    bulkMenu.appendChild(bulkMsg);
    let msgTimer = null;
    function needSelection() { bulkMsg.classList.remove("hidden"); clearTimeout(msgTimer); msgTimer = setTimeout(() => bulkMsg.classList.add("hidden"), 1800); }
    function bulkItem(label, fn) { const b = el("button", "bulk-item", label); b.onclick = () => fn(); return b; }
    bulkMenu.appendChild(bulkItem("Email selected", () => { if (!handle.getSelected().length) return needSelection(); bulkMenu.classList.add("hidden"); bulkCompose("email", selectedRows()); }));
    bulkMenu.appendChild(bulkItem("Text selected", () => { if (!handle.getSelected().length) return needSelection(); bulkMenu.classList.add("hidden"); bulkCompose("sms", selectedRows()); }));
    bulkMenu.appendChild(bulkItem("Export selected", () => { const rows = selectedRows(); if (!rows.length) return needSelection(); bulkMenu.classList.add("hidden"); openExport(handle.getColumns(), rows); }));
    bulkMenu.appendChild(el("div", "pop-sep"));
    bulkMenu.appendChild(bulkItem("Delete selected", async () => {
      const ids = handle.getSelected(); if (!ids.length) return needSelection();
      bulkMenu.classList.add("hidden");
      if (!confirm(`Move ${ids.length} contact${ids.length > 1 ? "s" : ""} to the Recycle Bin?`)) return;
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
    const title = kind === "email" ? "Email selected contacts" : "Text selected contacts";
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
    const backBtn = el("a", "btn btn-ghost btn-sm", "← Back to Contacts");
    backBtn.href = "#/contacts";
    head.appendChild(backBtn);
    container.appendChild(head);
    const tableHost = el("div");
    container.appendChild(tableHost);
    view().appendChild(container);

    let handle;
    handle = App.table.mount({
      container: tableHost, columns, rows: deleted, selectable: true, rowId: (r) => r.id,
      onSelectionChange: (ids) => { rc.textContent = ids.length ? `${ids.length} selected` : ""; },
      defaultSort: "createdAt", defaultSortDir: "desc",
      emptyHtml: `<div class="empty"><div class="empty-emoji">&#128465;</div><h3>Recycle Bin is empty</h3><p>Deleted contacts will appear here for 30 days.</p></div>`,
    });
    const restoreBtn = el("button", "btn btn-primary btn-sm", "Restore selected");
    const rc = el("span", "bulk-count", "");
    restoreBtn.onclick = async () => {
      const ids = handle.getSelected();
      if (!ids.length) { App.util.toast("Select a contact first.", true); return; }
      try { await App.portalApi("/api/contacts/restore", { method: "POST", body: JSON.stringify({ ids }) }); App.util.toast("Restored to Contacts"); renderRecycleBin(); }
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
        del.onclick = async (e) => { e.stopPropagation(); if (!confirm(`Delete saved filter “${f.name}”?`)) return; try { await App.portalApi(`/api/saved-filters/${f.id}`, { method: "DELETE" }); App.util.toast("Filter deleted"); load(); } catch (err) { App.util.toast(err.message, true); } };
        row.appendChild(name);
        row.appendChild(del);
        menu.appendChild(row);
      });
      menu.appendChild(el("div", "pop-sep"));
      const save = el("button", "saved-save", "+ Save current filter…");
      save.onclick = async () => {
        const def = handle.getState();
        if (!def.rules.length && !Object.keys(def.colFilters).length && !def.search) { App.util.toast("Set some filters first", true); return; }
        const name = prompt("Name this filter:");
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
      inner.querySelector("#ex-count").textContent = `${n} of ${rows.length} contacts match.`;
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
      if (!out.length) { App.util.toast("No contacts match", true); return; }
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
          XLSX.utils.book_append_sheet(wb, ws, "Contacts");
          const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
          downloadBlob(`${fileBase}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        }
      } else {
        downloadCSV(`${fileBase}.csv`, csv);
      }
      try {
        await App.portalApi("/api/exports", { method: "POST", body: JSON.stringify({ name, rowCount: out.length, fields: cols.map((c) => c.label), csv }) });
        App.util.toast(`Exported ${out.length} contacts`);
        loadHistory();
      } catch (err) { App.util.toast("Downloaded, but couldn't save to history: " + err.message, true); }
    };
  }

  function emptyCalls() {
    const e = el("div", "card");
    e.innerHTML = `<div class="empty"><div class="empty-emoji">&#128222;</div><h3>No calls yet</h3>
      <p>Use “Simulate call” to generate a sample lead, or take a real call.</p>
      <button class="btn btn-primary" id="empty-sim"><span class="btn-icon">&#9654;</span> Simulate call</button></div>`;
    const b = e.querySelector("#empty-sim");
    if (b) b.onclick = simulate;
    return e;
  }

  // ---------------- Fields tab ----------------
  async function renderFields() {
    loading();
    const fields = await App.portalApi("/api/fields");
    const canEdit = App.state.me.role !== "CLIENT_USER";
    const wrap = el("div", "fade-in");

    const bar = el("div", "page-actions");
    if (canEdit) {
      const add = el("button", "btn btn-primary btn-sm", "+ Add field");
      add.onclick = () => openFieldModal(null);
      bar.appendChild(add);
    }
    wrap.appendChild(bar);

    const intro = el("p", "muted");
    intro.style.margin = "0 0 14px";
    intro.textContent = canEdit
      ? "These fields appear on every contact in this portal. Drag to reorder — that order is how they show on a contact's profile."
      : "These are the fields on every contact in this portal. Ask an admin to change them.";
    wrap.appendChild(intro);

    const card = el("div", "card");
    const list = el("div", "field-list");
    fields.forEach((f) => list.appendChild(fieldRow(f, canEdit, fields)));
    card.appendChild(list);
    wrap.appendChild(card);

    view().innerHTML = "";
    view().appendChild(wrap);
  }

  function fieldRow(f, canEdit, allFields) {
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
      const edit = el("button", "btn btn-ghost btn-sm", "Edit");
      edit.onclick = () => openFieldModal(f);
      right.appendChild(edit);
      if (!f.system) {
        const del = el("button", "link-danger", "Delete");
        del.onclick = async () => { if (!confirm(`Delete field “${f.label}”? Existing values will be hidden.`)) return; try { await App.portalApi(`/api/fields/${f.id}`, { method: "DELETE" }); App.util.toast("Field deleted"); renderFields(); } catch (e) { App.util.toast(e.message, true); } };
        right.appendChild(del);
      } else {
        right.appendChild(el("span", "field-locked", "🔒"));
      }
    }
    row.appendChild(right);

    if (canEdit) {
      row.addEventListener("dragstart", (e) => { row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", f.id); });
      row.addEventListener("dragend", () => { row.classList.remove("dragging"); persistOrder(row.parentElement); });
      row.addEventListener("dragover", (e) => { e.preventDefault(); const dragging = row.parentElement.querySelector(".dragging"); if (!dragging || dragging === row) return; const rect = row.getBoundingClientRect(); const after = e.clientY > rect.top + rect.height / 2; row.parentElement.insertBefore(dragging, after ? row.nextSibling : row); });
    }
    return row;
  }

  async function persistOrder(list) {
    const ids = App.util.$$(".field-row", list).map((r) => r.dataset.id);
    try { await App.portalApi("/api/fields/reorder", { method: "PATCH", body: JSON.stringify({ orderedIds: ids }) }); }
    catch (e) { App.util.toast("Couldn't save order: " + e.message, true); }
  }

  function openFieldModal(existing) {
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
      const body = JSON.stringify({ label, type, options, formula, required });
      try {
        if (isEdit) await App.portalApi(`/api/fields/${existing.id}`, { method: "PATCH", body });
        else await App.portalApi("/api/fields", { method: "POST", body });
        App.util.toast(isEdit ? "Field saved" : "Field added");
        overlay.remove();
        renderFields();
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
    let c, fields;
    try { [c, fields] = await Promise.all([App.portalApi(`/api/contacts/${id}`), App.portalApi("/api/fields")]); }
    catch (err) { view().innerHTML = `<div class="card"><p class="cell-muted">${esc(err.message)}</p></div>`; return; }

    const wrap = el("div", "fade-in contact-page");
    const back = el("a", "back-link", "← Contacts");
    back.href = "#/contacts";
    wrap.appendChild(back);

    const head = el("div", "contact-head");
    head.innerHTML = `<div class="contact-avatar">${esc((c.name || c.phone || "?").charAt(0).toUpperCase())}</div>
      <div><h1 class="contact-name">${esc(c.name || "Unknown")}</h1>
      <div class="contact-sub">${esc(c.phone || "")}${c.email ? " · " + esc(c.email) : ""}</div></div>`;
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
    view().innerHTML = "";
    view().appendChild(wrap);

    // ---- All fields tab ----
    function tabFields() {
      tabBody.innerHTML = "";
      const values = { name: c.name || "", phone: c.phone || "", email: c.email || "", intent: c.intent || "", ...(c.customFields || {}) };
      const card = el("div", "card");
      const editorHost = el("div", "field-editor");
      card.appendChild(editorHost);
      App.fields.renderEditor(editorHost, fields, values, {});
      const saveBar = el("div", "drawer-save-bar");
      const save = el("button", "btn btn-primary btn-sm", "Save changes");
      save.onclick = async () => {
        const custom = {};
        fields.forEach((f) => { if (!App.fields.SYSTEM_KEYS.includes(f.key) && f.type !== "formula") custom[f.key] = values[f.key]; });
        save.disabled = true; save.textContent = "Saving…";
        try {
          await App.portalApi(`/api/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ name: values.name, phone: values.phone, email: values.email, intent: values.intent, customFields: custom }) });
          App.util.toast("Contact saved");
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
  async function renderSettings() {
    loading();
    const me = App.state.me;
    const canEditPortal = me.role !== "CLIENT_USER";
    const sections = el("div", "fade-in settings-page");

    // Portal settings
    if (canEditPortal) {
      const portal = await App.portalApi("/api/settings");
      const card = el("div", "card settings-card");
      card.innerHTML = `<h2 class="settings-h">Portal settings</h2>
        <div class="settings-grid">
          <label class="field-label">Business name</label><input id="set-name" class="input" value="${esc(portal.name)}" />
          <label class="field-label">Business type</label><input id="set-type" class="input" value="${esc(portal.businessType)}" />
          <label class="field-label">Phone number</label><input id="set-phone" class="input" value="${esc(portal.phoneNumber || "")}" />
          <label class="field-label">Notify email</label><input id="set-email" class="input" value="${esc(portal.notifyEmail)}" />
          <label class="field-label">Greeting</label><textarea id="set-greet" class="input" rows="2">${esc(portal.greeting)}</textarea>
        </div>
        <button id="set-save" class="btn btn-primary btn-sm">Save changes</button>`;
      sections.appendChild(card);

      // Appearance / theme (per-portal)
      const themeCard = el("div", "card settings-card");
      themeCard.innerHTML = `<h2 class="settings-h">Appearance</h2>
        <p class="cell-muted" style="font-size:13px;margin-bottom:6px">Pick a theme for this portal, or design your own. Applies to everyone in this portal.</p>
        <div id="theme-host"></div>`;
      sections.appendChild(themeCard);
    }

    // User management (admins only)
    if (canEditPortal) {
      const users = await App.portalApi("/api/users");
      const card = el("div", "card settings-card");
      card.innerHTML = `<h2 class="settings-h">Team members</h2>
        <table class="mini-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody id="users-tbody"></tbody></table>
        <div class="add-user">
          <input id="nu-name" class="input" placeholder="Name" />
          <input id="nu-email" class="input" placeholder="email@company.com" />
          <input id="nu-pass" class="input" type="text" placeholder="Temp password (8+)" />
          <select id="nu-role" class="input"><option value="CLIENT_USER">Client User</option><option value="PORTAL_ADMIN">Portal Admin</option></select>
          <button id="nu-add" class="btn btn-primary btn-sm">Add user</button>
        </div>`;
      sections.appendChild(card);
      setTimeout(() => fillUsers(users), 0);
    }

    // Account (everyone)
    const acct = el("div", "card settings-card");
    acct.innerHTML = `<h2 class="settings-h">Your account</h2>
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
    sections.appendChild(acct);

    view().innerHTML = "";
    view().appendChild(sections);

    if (canEditPortal && App.theme) {
      const themeHost = App.util.$("#theme-host");
      if (themeHost) App.theme.mountSettings(themeHost);
    }

    if (canEditPortal) {
      App.util.$("#set-save").onclick = async () => {
        try {
          await App.portalApi("/api/settings", { method: "PATCH", body: JSON.stringify({
            name: App.util.$("#set-name").value, businessType: App.util.$("#set-type").value,
            phoneNumber: App.util.$("#set-phone").value, notifyEmail: App.util.$("#set-email").value,
            greeting: App.util.$("#set-greet").value }) });
          toast("Settings saved");
        } catch (err) { toast(err.message, true); }
      };
      App.util.$("#nu-add").onclick = async () => {
        try {
          await App.portalApi("/api/users", { method: "POST", body: JSON.stringify({
            name: App.util.$("#nu-name").value, email: App.util.$("#nu-email").value,
            password: App.util.$("#nu-pass").value, role: App.util.$("#nu-role").value }) });
          toast("User added");
          renderSettings();
        } catch (err) { toast(err.message, true); }
      };
    }
    App.util.$("#acct-save").onclick = async () => {
      const pass = App.util.$("#acct-pass").value;
      if (!pass || pass.length < 8) { toast("Password must be at least 8 characters", true); return; }
      try { await App.portalApi("/api/account/password", { method: "POST", body: JSON.stringify({ password: pass }) }); toast("Password updated"); App.util.$("#acct-pass").value = ""; }
      catch (err) { toast(err.message, true); }
    };

    // Signature editor (same composer as emails)
    const sigApi = App.compose.mount(App.util.$("#sig-host"), { kind: "richtext" });
    App.portalApi("/api/account/signature").then((r) => { sigApi.setBody((r && r.signature) || ""); }).catch(() => {});
    App.util.$("#sig-save").onclick = async () => {
      try { await App.portalApi("/api/account/signature", { method: "PATCH", body: JSON.stringify({ signature: sigApi.getHTML() }) }); toast("Signature saved"); }
      catch (err) { toast(err.message, true); }
    };
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
        del.onclick = async () => { if (!confirm(`Remove ${u.email}?`)) return; try { await App.portalApi(`/api/users/${u.id}`, { method: "DELETE" }); toast("User removed"); renderSettings(); } catch (e) { toast(e.message, true); } };
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

  function openImport() {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Import contacts</h2><button class="icon-btn" id="imp-close">&times;</button></div>
      <div class="modal-body">
        <p class="cell-muted">Upload a CSV or Excel file (.csv, .xlsx). You'll map its columns to the fields below before importing.</p>
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
        renderMapping(inner.querySelector("#imp-step2"), headers, dataRows, overlay);
      });
    };
  }

  function renderMapping(host, headers, dataRows, overlay) {
    const guess = guessMap(headers);
    const fields = [["name", "Name"], ["phone", "Phone (required)"], ["email", "Email"], ["intent", "Reason / notes"]];
    const optionsHtml = (sel) => `<option value="-1">— skip —</option>` + headers.map((h, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(h)}</option>`).join("");
    host.innerHTML = `<div class="map-grid">${fields.map(([k, lbl]) => `
      <label class="field-label">${esc(lbl)}</label>
      <select class="input map-sel" data-field="${k}">${optionsHtml(guess[k])}</select>`).join("")}</div>
      <p class="cell-muted" id="imp-count">${dataRows.length} rows detected.</p>
      <button class="btn btn-primary btn-block" id="imp-go">Import ${dataRows.length} contacts</button>`;
    host.querySelector("#imp-go").onclick = async () => {
      const map = {};
      App.util.$$(".map-sel", host).forEach((s) => { map[s.dataset.field] = parseInt(s.value, 10); });
      if (map.phone < 0) { toast("You must map the Phone column", true); return; }
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
        toast(`Imported ${res.imported} contacts${res.skipped ? `, skipped ${res.skipped}` : ""}`);
        overlay.remove();
        if (current === "contacts") renderContacts();
      } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = "Import"; }
    };
  }

  App.portal = { render, refresh, simulate, renderContact, current: () => current };
})(typeof window !== "undefined" ? window : globalThis);
