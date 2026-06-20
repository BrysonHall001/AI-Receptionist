// Feedback / ticketing UI — ONE module drives both instances:
//   App.feedback.renderPortal(host)  -> tenant-facing (uses /api/feedback)
//   App.feedback.renderMaster(host)  -> master-hub    (uses /api/admin/feedback)
// The server enforces every permission; the UI just hides controls the current
// user isn't allowed to use. Tables reuse App.table.mount (same corrected
// "Showing X–X of Y" pagination footer as the Calls page).
(function (window) {
  const App = window.App;
  const { el, esc, fmtDate, toast } = App.util;

  const PAGE_SIZE = 10;

  function me() { return App.state.me || {}; }
  function isPortalMod(role) { return role === "OWNER" || role === "SUPER_ADMIN"; }
  function isMasterRole(role) { return role === "OWNER" || role === "SUPER_ADMIN" || role === "AUDITOR"; }

  // mode-specific plumbing
  function cfg(mode) {
    if (mode === "master") {
      return { base: "/api/admin/feedback", call: (p, o) => App.api(p, o) };
    }
    return { base: "/api/feedback", call: (p, o) => App.portalApi(p, o) };
  }

  function canSubmit(mode) {
    const role = me().role;
    if (mode === "master") return isMasterRole(role);
    return role === "PORTAL_ADMIN" || role === "CLIENT_USER";
  }
  function canModerate(mode) {
    const role = me().role;
    if (mode === "master") return role === "OWNER";        // master: owner only
    return isPortalMod(role);                                // portal: owner/super-admin
  }
  // Delete is stricter + separate from resolve/restore: OWNER/SUPER_ADMIN only,
  // in BOTH modes (a super-admin can delete a master ticket they can't resolve).
  function canDelete() {
    const role = me().role;
    return role === "OWNER" || role === "SUPER_ADMIN";
  }
  function canReplyTo(mode, ticket) {
    const role = me().role;
    if (mode === "master") return isMasterRole(role);
    if (isPortalMod(role)) return true;
    return ticket.submitter && ticket.submitter.id === me().id;
  }

  function statusBadge(kind) {
    return kind === "RESOLVED"
      ? `<span class="badge badge-completed">Resolved</span>`
      : `<span class="badge badge-progress">Needs Reply</span>`;
  }

  // ---- list view ----------------------------------------------------------
  async function mount(host, mode) {
    const c = cfg(mode);
    host.innerHTML = "";
    const wrap = el("div", "fade-in fb-page");

    const intro = el("div", "fb-intro");
    intro.innerHTML =
      `<h1 class="page-title" style="font-size:22px">Feedback</h1>` +
      `<p class="cell-muted" style="font-size:13px;margin-top:2px">` +
      (mode === "master"
        ? "Raise issues for the team. Auditors, super-admins and the owner can see and reply to all tickets here."
        : "Tell us about a problem and we'll follow up. You'll see your own tickets and replies below.") +
      `</p>`;
    wrap.appendChild(intro);

    // Submit form (only for roles allowed to submit)
    if (canSubmit(mode)) {
      wrap.appendChild(submitForm(mode, () => load()));
    }

    const activeHead = el("h2", "fb-section-title", "Open tickets");
    wrap.appendChild(activeHead);
    const activeHost = el("div");
    wrap.appendChild(activeHost);

    const resolvedHead = el("h2", "fb-section-title", "Resolved");
    wrap.appendChild(resolvedHead);
    const resolvedHost = el("div");
    wrap.appendChild(resolvedHost);

    host.innerHTML = "";
    host.appendChild(wrap);

    async function load() {
      let data;
      try { data = await c.call(c.base); }
      catch (e) { activeHost.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
      buildTable(activeHost, data.active || [], mode, "OPEN");
      buildTable(resolvedHost, data.resolved || [], mode, "RESOLVED");
    }
    load();
  }

  function submitForm(mode, onDone) {
    const c = cfg(mode);
    const card = el("div", "card fb-form-card");
    card.innerHTML =
      `<div class="form-row form-row--wide"><label class="form-label">Problem</label>` +
      `<input class="input" id="fb-problem" maxlength="200" placeholder="A short summary of the problem" /></div>` +
      `<div class="form-row form-row--wide"><label class="form-label">Description</label>` +
      `<textarea class="input" id="fb-desc" rows="4" placeholder="Describe what's happening in as much detail as you can"></textarea></div>`;
    const bar = el("div", "fb-form-actions");
    const btn = el("button", "btn btn-primary btn-sm", "Submit");
    bar.appendChild(btn);
    card.appendChild(bar);

    btn.onclick = async () => {
      const problem = card.querySelector("#fb-problem").value.trim();
      const description = card.querySelector("#fb-desc").value.trim();
      if (!problem || !description) { toast("Please fill in both Problem and Description", true); return; }
      btn.disabled = true;
      try {
        await c.call(c.base, { method: "POST", body: JSON.stringify({ problem, description }) });
        card.querySelector("#fb-problem").value = "";
        card.querySelector("#fb-desc").value = "";
        toast("Feedback submitted");
        onDone();
      } catch (e) { toast(e.message, true); }
      finally { btn.disabled = false; }
    };
    return card;
  }

  function buildTable(host, rows, mode, kind) {
    host.innerHTML = "";
    const columns = [
      { key: "problem", label: "Problem", type: "text", get: (r) => r.problem, cellClass: "cell-strong", render: (r) => esc(r.problem || "—") },
      { key: "description", label: "Description", type: "text", get: (r) => r.description, cellClass: "cell-muted cell-truncate", render: (r) => esc(r.description || "—") },
      { key: "createdAt", label: "Date posted", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` },
      { key: "status", label: "Status", type: "status", get: () => kind, render: () => statusBadge(kind) },
    ];
    const empty = `<div class="card cell-muted" style="padding:18px">${kind === "RESOLVED" ? "No resolved tickets." : "No tickets yet."}</div>`;
    App.table.mount({
      container: host, columns, rows,
      onRowClick: (r) => openThread(r.id, mode),
      defaultSort: "createdAt", defaultSortDir: "desc",
      emptyHtml: empty, pageSize: PAGE_SIZE,
    });
  }

  // ---- thread view --------------------------------------------------------
  async function openThread(id, mode) {
    const c = cfg(mode);
    const host = App.util.$("#view");
    host.innerHTML = `<div class="card"><div class="skeleton">Loading…</div></div>`;
    let t;
    try { t = await c.call(`${c.base}/${id}`); }
    catch (e) { host.innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }

    host.innerHTML = "";
    const wrap = el("div", "fade-in fb-page");

    const back = el("button", "btn btn-ghost btn-sm", "\u2190 Back to Feedback");
    back.onclick = () => backToList(mode);
    wrap.appendChild(back);

    const head = el("div", "card fb-thread-wrap");
    head.style.marginTop = "12px";
    const resolved = t.status === "RESOLVED";
    head.innerHTML =
      `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">` +
      `<h2 style="margin:0;font-size:18px">${esc(t.problem)}</h2>${statusBadge(t.status)}</div>` +
      `<p class="cell-muted" style="font-size:12.5px;margin:6px 0 0">` +
      `From ${esc(t.submitter ? (t.submitter.name || t.submitter.email) : "Unknown")} · ${fmtDate(t.createdAt)}</p>` +
      `<p style="white-space:pre-wrap;margin:12px 0 0">${esc(t.description)}</p>`;
    wrap.appendChild(head);

    // conversation
    const thread = el("div", "fb-thread");
    (t.messages || []).forEach((m) => thread.appendChild(messageBubble(m)));
    if (!(t.messages || []).length) {
      const none = el("p", "cell-muted"); none.style.cssText = "font-size:13px;margin:14px 2px";
      none.textContent = "No replies yet.";
      thread.appendChild(none);
    }
    wrap.appendChild(thread);

    // reply box
    if (!resolved && canReplyTo(mode, t)) {
      const rc = el("div", "card fb-thread-wrap");
      rc.style.marginTop = "8px";
      const ta = el("textarea", "input"); ta.rows = 3; ta.placeholder = "Write a reply…";
      rc.appendChild(ta);
      const bar = el("div"); bar.style.marginTop = "8px";
      const send = el("button", "btn btn-primary btn-sm", "Send reply");
      bar.appendChild(send);
      rc.appendChild(bar);
      send.onclick = async () => {
        const body = ta.value.trim();
        if (!body) { toast("Reply cannot be empty", true); return; }
        send.disabled = true;
        try {
          await c.call(`${c.base}/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
          ta.value = "";
          openThread(id, mode); // reload thread
        } catch (e) { toast(e.message, true); send.disabled = false; }
      };
      wrap.appendChild(rc);
    } else if (resolved) {
      const note = el("p", "cell-muted"); note.style.cssText = "font-size:13px;margin:10px 2px";
      note.textContent = "This ticket is resolved.";
      wrap.appendChild(note);
    }

    // moderate (resolve / restore)
    if (canModerate(mode)) {
      const modBar = el("div"); modBar.style.marginTop = "12px";
      if (!resolved) {
        const rb = el("button", "btn btn-ghost btn-sm", "Mark resolved");
        rb.onclick = async () => {
          rb.disabled = true;
          try { await c.call(`${c.base}/${id}/resolve`, { method: "POST" }); toast("Ticket resolved"); backToList(mode); }
          catch (e) { toast(e.message, true); rb.disabled = false; }
        };
        modBar.appendChild(rb);
      } else {
        const rb = el("button", "btn btn-ghost btn-sm", "Restore ticket");
        rb.onclick = async () => {
          rb.disabled = true;
          try { await c.call(`${c.base}/${id}/restore`, { method: "POST" }); toast("Ticket restored"); backToList(mode); }
          catch (e) { toast(e.message, true); rb.disabled = false; }
        };
        modBar.appendChild(rb);
      }
      wrap.appendChild(modBar);
    }

    // Delete (resolved only) — separate, stricter gate so it shows for super-admins
    // in the master view even though they can't resolve there.
    if (resolved && canDelete()) {
      const delBar = el("div"); delBar.style.marginTop = "8px";
      const db = el("button", "btn btn-danger btn-sm", "Delete ticket");
      db.onclick = async () => {
        if (!(await App.ui.confirmModal({ title: "Delete ticket", message: "Permanently delete this resolved ticket and its replies? This can't be undone.", confirmText: "Delete" }))) return;
        db.disabled = true;
        try { await c.call(`${c.base}/${id}`, { method: "DELETE" }); toast("Ticket deleted"); backToList(mode); }
        catch (e) { toast(e.message, true); db.disabled = false; }
      };
      delBar.appendChild(db);
      wrap.appendChild(delBar);
    }

    host.appendChild(wrap);
  }

  function messageBubble(m) {
    const mine = m.author && m.author.id === me().id;
    const b = el("div", "fb-msg" + (mine ? " fb-msg--mine" : ""));
    const who = m.author ? (m.author.name || m.author.email) : "Unknown";
    b.innerHTML =
      `<div class="fb-msg-meta">${esc(who)} · ${fmtDate(m.createdAt)}</div>` +
      `<div class="fb-msg-body">${esc(m.body)}</div>`;
    return b;
  }

  function backToList(mode) {
    if (mode === "master") App.go("#/admin/feedback");
    else App.go("#/feedback");
  }

  App.feedback = {
    renderPortal: (host) => mount(host, "portal"),
    renderMaster: (host) => mount(host, "master"),
  };
})(typeof window !== "undefined" ? window : globalThis);
