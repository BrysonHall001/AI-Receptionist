(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, fmtDate, statusBadge, roleLabel, toast } = App.util;

  let current = "portals";
  let portalsCache = [];

  function view() { return App.util.$("#view"); }
  function loading() { view().innerHTML = `<div class="card"><div class="skeleton">Loading…</div></div>`; }

  async function render(v) {
    current = v;
    if (v === "users") return renderUsers();
    return renderPortals();
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

  // ---------------- Portals ----------------
  async function renderPortals() {
    loading();
    const portals = await App.api("/api/admin/portals");
    portalsCache = portals;
    const wrap = el("div", "fade-in");
    const bar = el("div", "page-actions");
    const create = el("button", "btn btn-primary btn-sm", "+ Create portal");
    create.onclick = openCreatePortal;
    bar.appendChild(create);
    wrap.appendChild(bar);

    if (!portals.length) {
      const e = el("div", "card");
      e.innerHTML = `<div class="empty"><div class="empty-emoji">&#127970;</div><h3>No portals yet</h3><p>Create your first client portal to get started.</p></div>`;
      wrap.appendChild(e);
    } else {
      const grid = el("div", "portal-grid stagger");
      portals.forEach((p) => {
        const card = el("div", "portal-card");
        card.innerHTML = `<div class="portal-card-head"><div class="portal-mark">${esc((p.name || "?").charAt(0).toUpperCase())}</div>
            <div class="portal-status">${statusBadge(p.status)}</div></div>
          <div class="portal-name">${esc(p.name)}</div>
          <div class="portal-type">${esc(p.businessType)}</div>
          <div class="portal-metrics"><span><strong>${p.calls}</strong> calls</span><span><strong>${p.contacts}</strong> contacts</span><span><strong>${p.users}</strong> users</span></div>
          <div class="portal-rule">
            <label class="field-label" style="margin:0 0 4px">Contact identity rule</label>
            <select class="input portal-rule-sel">
              <option value="email" ${p.requireEmail !== false ? "selected" : ""}>Require unique email</option>
              <option value="either" ${p.requireEmail === false ? "selected" : ""}>Phone or email</option>
            </select>
          </div>
          <div class="portal-actions"><button class="btn btn-primary btn-sm portal-enter">Open portal →</button>
            <button class="btn btn-ghost btn-sm portal-setup">Set up</button>
            <button class="btn btn-ghost btn-sm portal-toggle">${p.status === "ACTIVE" ? "Suspend" : "Activate"}</button></div>`;
        card.querySelector(".portal-enter").onclick = () => enterPortal(p);
        card.querySelector(".portal-setup").onclick = () => renderSetup(p);
        const ruleSel = card.querySelector(".portal-rule-sel");
        ruleSel.onclick = (e) => e.stopPropagation();
        ruleSel.onchange = async () => {
          const requireEmail = ruleSel.value === "email";
          try { await App.api(`/api/admin/portals/${p.id}`, { method: "PATCH", body: JSON.stringify({ requireEmail }) }); p.requireEmail = requireEmail; toast(requireEmail ? "Now requires a unique email" : "Now accepts phone or email"); }
          catch (err) { toast(err.message, true); ruleSel.value = p.requireEmail !== false ? "email" : "either"; }
        };
        card.querySelector(".portal-toggle").onclick = async () => {
          try { await App.api(`/api/admin/portals/${p.id}`, { method: "PATCH", body: JSON.stringify({ status: p.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }) }); toast("Portal updated"); renderPortals(); }
          catch (err) { toast(err.message, true); }
        };
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
    }
    view().innerHTML = "";
    view().appendChild(wrap);
  }

  function enterPortal(p) {
    App.state.currentPortalId = p.id;
    App.state.currentPortalName = p.name;
    App.go("#/dashboard");
  }

  // ---------------- Portal setup flow (scaffold) ----------------
  // After "+ Create Portal" we land here. A checklist of setup steps; for this
  // batch the live step is "Add users" (invite flow). Labels & theme and Import
  // are placeholders that later batches fill in.
  const SETUP_STEPS = [
    { key: "users", title: "Add users", desc: "Invite teammates and set their roles.", live: true },
    { key: "brand", title: "Labels & theme", desc: "Rename things and set the portal\u2019s look.", live: false },
    { key: "import", title: "Import data", desc: "Bring in an existing contact list.", live: false },
  ];

  function renderSetup(portal) {
    const wrap = el("div", "fade-in setup-flow");

    const head = el("div", "setup-head");
    head.innerHTML = `<h1 class="page-title">Set up ${esc(portal.name)}</h1>
      <p class="cell-muted">Get this portal ready. You can do these now or come back any time from the portal list.</p>`;
    const headActions = el("div", "page-actions");
    const enterBtn = el("button", "btn btn-ghost btn-sm", "Enter portal");
    enterBtn.onclick = () => enterPortal(portal);
    const backBtn = el("button", "btn btn-ghost btn-sm", "Back to portals");
    backBtn.onclick = () => render("portals");
    headActions.appendChild(enterBtn); headActions.appendChild(backBtn);
    head.appendChild(headActions);
    wrap.appendChild(head);

    const list = el("div", "setup-steps");
    SETUP_STEPS.forEach((step, i) => {
      const card = el("div", "card setup-step" + (step.live ? "" : " setup-step-soon"));
      card.style.cssText = "margin-bottom:14px;padding:18px 20px;";
      const top = el("div");
      top.style.cssText = "display:flex;align-items:center;gap:12px;";
      const num = el("div", null, String(i + 1));
      num.style.cssText = "flex:0 0 28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;background:" + (step.live ? "var(--accent,#3257d6);color:#fff" : "var(--surface,#eef1f6);color:var(--ink-soft,#5b6678)") + ";";
      const tt = el("div");
      tt.innerHTML = `<div style="font-weight:600">${esc(step.title)}</div><div class="cell-muted" style="font-size:13px">${esc(step.desc)}</div>`;
      top.appendChild(num); top.appendChild(tt);
      if (!step.live) {
        const soon = el("span", "pill", "Coming soon");
        soon.style.cssText = "margin-left:auto;font-size:12px;opacity:.7;";
        top.appendChild(soon);
      }
      card.appendChild(top);
      if (step.live && step.key === "users") {
        const body = el("div");
        body.style.cssText = "margin-top:14px;border-top:1px solid var(--border,#e3e8ef);padding-top:14px;";
        renderUsersStep(body, portal);
        card.appendChild(body);
      }
      list.appendChild(card);
    });
    wrap.appendChild(list);

    view().innerHTML = "";
    view().appendChild(wrap);
  }

  // The "Add users" step: invite by email + role. Real plumbing; email is mocked,
  // so on success we show the invite LINK for the super-admin to copy and test.
  function renderUsersStep(host, portal) {
    host.innerHTML = "";

    // Invite form
    const form = el("div");
    form.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;";
    const emailWrap = el("div"); emailWrap.style.cssText = "flex:1 1 220px;";
    emailWrap.innerHTML = `<label class="field-label">Email</label>`;
    const email = el("input", "input"); email.type = "email"; email.placeholder = "teammate@company.com"; email.style.marginBottom = "0";
    emailWrap.appendChild(email);
    const roleWrap = el("div"); roleWrap.style.cssText = "flex:0 0 170px;";
    roleWrap.innerHTML = `<label class="field-label">Role</label>`;
    const role = el("select", "input"); role.style.marginBottom = "0";
    role.innerHTML = `<option value="CLIENT_USER">Client user</option><option value="PORTAL_ADMIN">Portal admin</option>`;
    roleWrap.appendChild(role);
    const sendBtn = el("button", "btn btn-primary btn-sm", "Create invite link");
    form.appendChild(emailWrap); form.appendChild(roleWrap); form.appendChild(sendBtn);
    host.appendChild(form);

    // Where the most-recent invite link is shown (mock stand-in for emailing it).
    const linkBox = el("div"); linkBox.style.marginTop = "12px"; host.appendChild(linkBox);

    // Pending invites list
    const listHost = el("div"); listHost.style.marginTop = "16px"; host.appendChild(listHost);

    function showLink(inviteEmail, link) {
      linkBox.innerHTML = "";
      const box = el("div", "card");
      box.style.cssText = "padding:12px 14px;background:var(--surface,#f5f7fa);";
      box.innerHTML = `<div style="font-size:13px;font-weight:600;margin-bottom:6px">Invite link for ${esc(inviteEmail)}</div>
        <div class="cell-muted" style="font-size:12px;margin-bottom:8px">Email is mocked in this build, so copy this link and open it yourself to test. (Later, this gets emailed automatically.)</div>`;
      const row = el("div"); row.style.cssText = "display:flex;gap:8px;align-items:center;";
      const inp = el("input", "input"); inp.value = link; inp.readOnly = true; inp.style.cssText = "margin-bottom:0;font-family:monospace;font-size:12px;";
      inp.onclick = () => inp.select();
      const copy = el("button", "btn btn-ghost btn-sm", "Copy");
      copy.onclick = () => { inp.select(); try { document.execCommand("copy"); } catch (e) {} toast("Link copied"); };
      row.appendChild(inp); row.appendChild(copy);
      box.appendChild(row);
      linkBox.appendChild(box);
    }

    async function refreshList() {
      listHost.innerHTML = `<div class="cell-muted" style="font-size:13px">Loading invites…</div>`;
      let pending = [];
      try { pending = await App.api(`/api/admin/portals/${portal.id}/invites`); } catch (e) { listHost.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; return; }
      listHost.innerHTML = "";
      const title = el("div"); title.style.cssText = "font-size:12.5px;font-weight:600;color:var(--ink-soft,#5b6678);text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;";
      title.textContent = pending.length ? "Pending invites" : "No pending invites yet";
      listHost.appendChild(title);
      pending.forEach((inv) => {
        const r = el("div");
        r.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,#eef1f6);";
        r.innerHTML = `<div style="flex:1 1 auto"><span class="cell-mono">${esc(inv.email)}</span> <span class="pill" style="font-size:11px">${esc(roleLabel(inv.role))}</span></div>`;
        const resend = el("button", "btn btn-ghost btn-sm", "Get link");
        resend.onclick = () => createInvite(inv.email, inv.role, true);
        const revoke = el("button", "link-danger", "Revoke");
        revoke.onclick = async () => {
          if (!(await App.ui.confirmModal({ title: "Revoke invite", message: `Revoke the invite for ${inv.email}?`, confirmText: "Revoke" }))) return;
          try { await App.api(`/api/admin/portals/${portal.id}/invites/${inv.id}/revoke`, { method: "POST" }); toast("Invite revoked"); refreshList(); }
          catch (e) { toast(e.message, true); }
        };
        r.appendChild(resend); r.appendChild(revoke);
        listHost.appendChild(r);
      });
    }

    async function createInvite(addr, theRole, isResend) {
      const value = String(addr || "").trim();
      if (!value) { toast("Enter an email address", true); return; }
      sendBtn.disabled = true;
      try {
        const res = await App.api(`/api/admin/portals/${portal.id}/invites`, { method: "POST", body: JSON.stringify({ email: value, role: theRole }) });
        toast(isResend ? "New link created" : "Invite created");
        showLink(res.invite.email, res.link);
        if (!isResend) email.value = "";
        refreshList();
      } catch (e) { toast(e.message, true); }
      finally { sendBtn.disabled = false; }
    }

    sendBtn.onclick = () => createInvite(email.value, role.value, false);
    refreshList();
  }

  function openCreatePortal() {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Create portal</h2><button class="icon-btn" id="cp-close">&times;</button></div>
      <div class="modal-body">
        <label class="field-label">Business name *</label><input id="cp-name" class="input" placeholder="Acme Plumbing" />
        <label class="field-label">Business type</label><input id="cp-type" class="input" placeholder="home services company" />
        <label class="field-label">Phone number</label><input id="cp-phone" class="input" placeholder="+19195551234" />
        <label class="field-label">Notify email *</label><input id="cp-email" class="input" placeholder="owner@acme.com" />
        <label class="field-label">Greeting</label><textarea id="cp-greet" class="input" rows="2" placeholder="Thanks for calling Acme. How can I help?"></textarea>
        <label class="field-label">Contact identity rule</label>
        <select id="cp-rule" class="input">
          <option value="email">Require unique email (default)</option>
          <option value="either">Phone or email</option>
        </select>
        <button id="cp-go" class="btn btn-primary btn-block" style="margin-top:14px">Create portal</button>
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#cp-close").onclick = () => overlay.remove();
    inner.querySelector("#cp-go").onclick = async () => {
      const body = {
        name: inner.querySelector("#cp-name").value.trim(),
        businessType: inner.querySelector("#cp-type").value.trim(),
        phoneNumber: inner.querySelector("#cp-phone").value.trim(),
        notifyEmail: inner.querySelector("#cp-email").value.trim(),
        greeting: inner.querySelector("#cp-greet").value.trim(),
        requireEmail: inner.querySelector("#cp-rule").value === "email",
      };
      if (!body.name || !body.notifyEmail) { toast("Name and notify email are required", true); return; }
      try {
        const portal = await App.api("/api/admin/portals", { method: "POST", body: JSON.stringify(body) });
        toast("Portal created");
        overlay.remove();
        renderSetup(portal); // drop into the guided setup checklist for the new portal
      }
      catch (err) { toast(err.message, true); }
    };
  }

  // ---------------- Users ----------------
  async function renderUsers() {
    loading();
    const [users] = await Promise.all([App.api("/api/admin/users")]);
    if (!portalsCache.length) { try { portalsCache = await App.api("/api/admin/portals"); } catch (e) {} }
    const wrap = el("div", "fade-in");
    const bar = el("div", "page-actions");
    const create = el("button", "btn btn-primary btn-sm", "+ Create user");
    create.onclick = openCreateUser;
    bar.appendChild(create);
    wrap.appendChild(bar);

    const card = el("div", "card");
    const table = el("table");
    table.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Portal</th><th>Last login</th><th></th></tr></thead>`;
    const tb = el("tbody");
    users.forEach((u) => {
      const tr = el("tr");
      tr.innerHTML = `<td class="cell-strong">${esc(u.name || "—")}</td><td class="cell-mono">${esc(u.email)}</td>
        <td>${esc(roleLabel(u.role))}</td><td class="cell-muted">${esc(u.tenantName || "—")}</td>
        <td class="cell-muted">${u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never"}</td><td></td>`;
      if (u.id !== App.state.me.id) {
        const del = el("button", "link-danger", "Remove");
        del.onclick = async () => { if (!(await App.ui.confirmModal({ title: "Remove user", message: `Remove ${u.email}?`, confirmText: "Remove" }))) return; try { await App.api(`/api/admin/users/${u.id}`, { method: "DELETE" }); toast("User removed"); renderUsers(); } catch (e) { toast(e.message, true); } };
        tr.lastChild.appendChild(del);
      }
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    card.appendChild(table);
    wrap.appendChild(card);
    view().innerHTML = "";
    view().appendChild(wrap);
  }

  function openCreateUser() {
    const inner = el("div");
    const portalOpts = portalsCache.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    inner.innerHTML = `<div class="modal-head"><h2>Create user</h2><button class="icon-btn" id="cu-close">&times;</button></div>
      <div class="modal-body">
        <label class="field-label">Name</label><input id="cu-name" class="input" placeholder="Jane Doe" />
        <label class="field-label">Email *</label><input id="cu-email" class="input" placeholder="jane@acme.com" />
        <label class="field-label">Temporary password *</label><input id="cu-pass" class="input" type="text" placeholder="8+ characters" />
        <label class="field-label">Role *</label>
        <select id="cu-role" class="input"><option value="CLIENT_USER">Client User</option><option value="PORTAL_ADMIN">Portal Admin</option><option value="SUPER_ADMIN">Super Admin</option></select>
        <div id="cu-portal-wrap"><label class="field-label">Assign to portal *</label><select id="cu-portal" class="input">${portalOpts}</select></div>
        <button id="cu-go" class="btn btn-primary btn-block">Create user</button>
      </div>`;
    const overlay = modal(inner);
    const roleSel = inner.querySelector("#cu-role");
    const portalWrap = inner.querySelector("#cu-portal-wrap");
    roleSel.onchange = () => { portalWrap.style.display = roleSel.value === "SUPER_ADMIN" ? "none" : "block"; };
    inner.querySelector("#cu-close").onclick = () => overlay.remove();
    inner.querySelector("#cu-go").onclick = async () => {
      const role = roleSel.value;
      const body = {
        name: inner.querySelector("#cu-name").value.trim(),
        email: inner.querySelector("#cu-email").value.trim(),
        password: inner.querySelector("#cu-pass").value,
        role,
        tenantId: role === "SUPER_ADMIN" ? null : inner.querySelector("#cu-portal").value,
      };
      if (!body.email || !body.password) { toast("Email and password are required", true); return; }
      if (body.password.length < 8) { toast("Password must be at least 8 characters", true); return; }
      try { await App.api("/api/admin/users", { method: "POST", body: JSON.stringify(body) }); toast("User created"); overlay.remove(); renderUsers(); }
      catch (err) { toast(err.message, true); }
    };
  }

  App.admin = { render };
})(typeof window !== "undefined" ? window : globalThis);
