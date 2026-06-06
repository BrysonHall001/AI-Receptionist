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
            <button class="btn btn-ghost btn-sm portal-toggle">${p.status === "ACTIVE" ? "Suspend" : "Activate"}</button></div>`;
        card.querySelector(".portal-enter").onclick = () => enterPortal(p);
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
      try { await App.api("/api/admin/portals", { method: "POST", body: JSON.stringify(body) }); toast("Portal created"); overlay.remove(); renderPortals(); }
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
        del.onclick = async () => { if (!confirm(`Remove ${u.email}?`)) return; try { await App.api(`/api/admin/users/${u.id}`, { method: "DELETE" }); toast("User removed"); renderUsers(); } catch (e) { toast(e.message, true); } };
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
