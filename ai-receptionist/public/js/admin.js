(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, fmtDate, fmtDateOnly, statusBadge, roleLabel, toast } = App.util;

  let current = "portals";
  let portalsCache = [];

  function view() { return App.util.$("#view"); }
  function loading() { view().innerHTML = `<div class="card"><div class="skeleton">Loading…</div></div>`; }

  // ---- Voice mode (AI Receptionist 3-way choice) ----
  // OFF = decline calls; WALKIE = Standard voice (cheap Say/Gather); SMOOTH =
  // Premium voice (ElevenLabs ConversationRelay). The server keeps the legacy
  // receptionistEnabled boolean in sync, so older data still reads correctly.
  const VOICE_LABELS = { OFF: "Off", WALKIE: "Standard voice", SMOOTH: "Premium voice" };
  function voiceModeOf(p) {
    return (p && p.voiceMode) || (p && p.receptionistEnabled === true ? "WALKIE" : "OFF");
  }
  function voiceOptionsHtml(selected) {
    return ["OFF", "WALKIE", "SMOOTH"]
      .map((m) => `<option value="${m}" ${m === selected ? "selected" : ""}>${VOICE_LABELS[m]}</option>`)
      .join("");
  }
  function voiceToast(mode) {
    return mode === "OFF"
      ? "AI Receptionist turned off"
      : `AI Receptionist set to ${VOICE_LABELS[mode]}`;
  }

  async function render(v) {
    current = v;
    if (v === "users") return renderUsers();
    if (v === "feedback") return App.feedback.renderMaster(view());
    if (v === "changelog") return renderChangelog();
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
    const create = el("button", "btn btn-primary btn-sm", "+ Create tenant");
    create.onclick = () => renderSetupScreen();
    bar.appendChild(create);
    wrap.appendChild(bar);

    // Tenants list — the reusable App.table (same component as Contacts/Records),
    // so we get search, sort, column filters, and the filter rail for free. The
    // interactive cells (AI Receptionist control + row actions) are rendered as HTML
    // and wired via delegation below, since App.table sets cells with innerHTML.
    const tableHost = el("div");
    wrap.appendChild(tableHost);

    const mark = (name) => `<span style="flex:0 0 24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;background:var(--surface,#eef1f6);color:var(--ink-soft,#5b6678)">${esc((name || "?").charAt(0).toUpperCase())}</span>`;
    const columns = [
      { key: "name", label: "Tenant Name", get: (p) => p.name,
        render: (p) => `<div style="display:flex;align-items:center;gap:8px">${mark(p.name)}<span style="font-weight:600">${esc(p.name)}</span></div>` },
      { key: "status", label: "Status", get: (p) => (p.status === "ACTIVE" ? "Active" : "Suspended"),
        render: (p) => statusBadge(p.status) },
      { key: "created", label: "Created", type: "date", get: (p) => p.createdAt, text: (p) => fmtDate(p.createdAt),
        render: (p) => esc(fmtDate(p.createdAt)) },
      { key: "ai", label: "AI Receptionist", get: (p) => VOICE_LABELS[voiceModeOf(p)],
        render: (p) => `<select class="input portal-recep-sel t-voice" data-id="${esc(p.id)}">${voiceOptionsHtml(voiceModeOf(p))}</select>` },
      { key: "calls", label: "Calls", type: "number", get: (p) => p.calls },
      { key: "contacts", label: "Contacts", type: "number", get: (p) => p.contacts },
      { key: "users", label: "Users", type: "number", get: (p) => p.users },
      // "Users" opens the tenant's user list — its own column so it can be hidden.
      { key: "manage", label: "Manage", filterable: false, get: () => "",
        render: (p) => `<button class="btn btn-ghost btn-sm" data-act="users" data-id="${esc(p.id)}">Users</button>` },
      // Real row actions, side by side (no vertical stacking -> single-line rows).
      { key: "actions", label: "Actions", filterable: false, get: () => "",
        render: (p) => `<span style="display:inline-flex;gap:6px;white-space:nowrap;align-items:center">
            <button class="btn btn-primary btn-sm" data-act="open" data-id="${esc(p.id)}">Open tenant →</button>
            <button class="btn btn-ghost btn-sm" data-act="toggle" data-id="${esc(p.id)}">${p.status === "ACTIVE" ? "Suspend" : "Activate"}</button>
          </span>` },
    ];

    const handle = App.table.mount({
      container: tableHost,
      rows: portals,
      columns: columns,
      rowId: (p) => p.id,
      scrollX: true,
      defaultSort: "created",
      defaultSortDir: "desc",
      emptyHtml: `<div class="empty"><div class="empty-emoji">&#127970;</div><h3>No tenants yet</h3><p>Create your first client tenant to get started.</p></div>`,
    });
    // Same manage-columns control as Contacts/Records (shared App.table helper).
    App.table.manageColumns(handle, columns, { defaultKeys: columns.map((c) => c.key) });

    // Delegated handlers live on the stable host so they survive App.table's internal
    // re-renders (sort/filter/search rebuild the rows). Same endpoints as before.
    const findP = (id) => portalsCache.find((x) => x.id === id);
    tableHost.addEventListener("change", async (e) => {
      const sel = e.target.closest && e.target.closest(".t-voice");
      if (!sel) return;
      const p = findP(sel.getAttribute("data-id"));
      if (!p) return;
      const voiceMode = sel.value;
      try {
        await App.api(`/api/admin/portals/${p.id}`, { method: "PATCH", body: JSON.stringify({ voiceMode }) });
        p.voiceMode = voiceMode; p.receptionistEnabled = voiceMode !== "OFF";
        toast(voiceToast(voiceMode));
      } catch (err) { toast(err.message, true); sel.value = voiceModeOf(p); }
    });
    tableHost.addEventListener("click", async (e) => {
      const btn = e.target.closest && e.target.closest("[data-act]");
      if (!btn) return;
      const p = findP(btn.getAttribute("data-id"));
      if (!p) return;
      const act = btn.getAttribute("data-act");
      if (act === "users") return renderPortalUsers(p);
      if (act === "open") return enterPortal(p);
      if (act === "toggle") {
        try {
          await App.api(`/api/admin/portals/${p.id}`, { method: "PATCH", body: JSON.stringify({ status: p.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }) });
          toast("Tenant updated");
          renderPortals();
        } catch (err) { toast(err.message, true); }
      }
    });

    view().innerHTML = "";
    view().appendChild(wrap);
  }

  // ---------------- Per-portal Users (from a portal card's "Users" button) ----
  // Lists and creates users for ONE portal, scoped by ?tenantId. Creation uses the
  // per-portal endpoint POST /api/users, which clamps the role to portal-admin/
  // client-user server-side, so only those two roles are offered here.
  async function renderPortalUsers(portal) {
    loading();
    let users = [];
    try { users = await App.api("/api/users?tenantId=" + encodeURIComponent(portal.id)); } catch (e) { toast(e.message, true); }

    const wrap = el("div", "fade-in");
    const bar = el("div", "page-actions");
    const back = el("button", "btn btn-ghost btn-sm", "← Tenants");
    back.onclick = () => renderPortals();
    const title = el("div", "page-title", "Users · " + esc(portal.name));
    title.style.flex = "1";
    title.style.fontWeight = "600";
    const create = el("button", "btn btn-primary btn-sm", "+ Create user");
    create.onclick = () => openCreateUser(portal);
    bar.appendChild(back);
    bar.appendChild(title);
    bar.appendChild(create);
    wrap.appendChild(bar);

    const card = el("div", "card");
    const table = el("table");
    table.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th></th></tr></thead>`;
    const tb = el("tbody");
    if (!users.length) {
      const tr = el("tr");
      tr.innerHTML = `<td colspan="5" class="cell-muted">No users in this tenant yet.</td>`;
      tb.appendChild(tr);
    } else {
      users.forEach((u) => {
        const tr = el("tr");
        const lastCell = u.pending
          ? '<span class="badge badge-progress">Pending</span>'
          : (u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never");
        tr.innerHTML = `<td class="cell-strong">${esc(u.name || "—")}</td><td class="cell-mono">${esc(u.email)}</td>
          <td>${esc(roleLabel(u.role))}</td><td class="cell-muted">${lastCell}</td><td></td>`;
        if (u.pending) {
          const rev = el("button", "link-danger", "Revoke");
          rev.onclick = async () => {
            if (!(await App.ui.confirmModal({ title: "Revoke invite", message: `Revoke the pending invite for ${u.email}?`, confirmText: "Revoke" }))) return;
            try { await App.api("/api/invites/" + u.inviteId + "/revoke?tenantId=" + encodeURIComponent(portal.id), { method: "POST" }); toast("Invite revoked"); renderPortalUsers(portal); }
            catch (e) { toast(e.message, true); }
          };
          tr.lastChild.appendChild(rev);
        } else if (u.id !== App.state.me.id) {
          const del = el("button", "link-danger", "Remove");
          del.onclick = async () => {
            if (!(await App.ui.confirmModal({ title: "Remove user", message: `Remove ${u.email}?`, confirmText: "Remove" }))) return;
            try { await App.api("/api/users/" + u.id + "?tenantId=" + encodeURIComponent(portal.id), { method: "DELETE" }); toast("User removed"); renderPortalUsers(portal); }
            catch (e) { toast(e.message, true); }
          };
          tr.lastChild.appendChild(del);
        }
        tb.appendChild(tr);
      });
    }
    table.appendChild(tb);
    card.appendChild(table);
    wrap.appendChild(card);
    view().innerHTML = "";
    view().appendChild(wrap);
  }

  function enterPortal(p) {
    App.state.currentPortalId = p.id;
    App.state.currentPortalName = p.name;
    // Read the AI Receptionist flag from the just-loaded card data so the left nav
    // is correct on the FIRST paint of this entry (no stale cached value, no flash),
    // and clear the cache key so it's re-confirmed fresh from the server on entry.
    App.state.receptionistEnabled = !!(p && p.receptionistEnabled === true);
    App.state._recepFor = null;
    App.go("#/dashboard");
  }

  // ===================== Create-tenant wizard (client-side DRAFT) =====================
  // ATOMIC: nothing is written until the user clicks "Finish". All four steps collect
  // into `draft` (name/email, queued user invites, theme preset, receptionist mode).
  // On Finish we create the tenant, then apply the queued config in sequence, then enter
  // it. Abandoning (Back / nav-away / tab-close) persists NOTHING — no tenant, no users,
  // no theme. Every step is active from the start; there is no "create tenant first" gate.
  function renderSetupScreen() {
    const prior = { id: App.state.currentPortalId, name: App.state.currentPortalName };
    const draft = { users: [], themePreset: "", voiceMode: "OFF" };

    // Built-in theme preset ids (match src/theme/themes.ts). "" = leave the default.
    const THEME_PRESETS = [
      ["", "Default (Clean Light)"], ["warm", "Warm Light"], ["slate", "Slate"],
      ["steel", "Steel Blue"], ["contrast", "High Contrast"], ["dark", "Dark"], ["midnight", "Midnight"],
    ];

    function elNote(text) { const d = el("div", "cell-muted"); d.style.cssText = "margin-top:8px;font-size:13px;"; d.textContent = text; return d; }
    function leave(toList) {
      App.state.currentPortalId = prior.id;
      App.state.currentPortalName = prior.name;
      if (toList) render("portals");
    }
    function sectionCard(n, title, desc) {
      const card = el("div", "card");
      card.style.cssText = "margin-bottom:16px;padding:20px;";
      const head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:12px;";
      const num = el("div", null, String(n));
      num.style.cssText = "flex:0 0 28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;background:var(--accent,#3257d6);color:#fff;";
      const tt = el("div"); tt.innerHTML = `<div style="font-weight:600">${esc(title)}</div><div class="cell-muted" style="font-size:13px">${esc(desc)}</div>`;
      head.appendChild(num); head.appendChild(tt);
      card.appendChild(head);
      return card;
    }

    const wrap = el("div", "fade-in");
    const head = el("div");
    head.innerHTML = `<h1 class="page-title">Create a tenant</h1>
      <p class="cell-muted">Fill in the steps below, then click Finish to create the tenant with everything set up at once. Nothing is saved until you click Finish — back out any time before then and nothing is created.</p>`;
    wrap.appendChild(head);

    // ---- Step 1: basic details ----
    const s1 = sectionCard(1, "Basic details", "The tenant's name, and optionally where call summaries go.");
    const f1 = el("div");
    f1.innerHTML = `
      <label class="field-label">Business name *</label><input id="sp-name" class="input" placeholder="Acme Plumbing" />
      <label class="field-label">Notify email</label><input id="sp-email" class="input" placeholder="owner@acme.com" />
      <p class="cell-muted" style="font-size:12.5px;margin:8px 0 0">Notify email is optional — it's where call summaries and notifications go.</p>`;
    s1.appendChild(f1);
    wrap.appendChild(s1);

    // ---- Step 2: add users (queued into the draft; invited on Finish) ----
    const s2 = sectionCard(2, "Add users", "Queue teammates to invite. Each gets an invite link when you finish. You can add none, one, or several.");
    const uForm = el("div"); uForm.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;";
    uForm.innerHTML = `
      <div style="flex:1 1 220px"><label class="field-label">Email</label><input id="sp-user-email" class="input" type="email" placeholder="teammate@company.com" style="margin-bottom:0" /></div>
      <div style="flex:0 0 170px"><label class="field-label">Role</label><select id="sp-user-role" class="input" style="margin-bottom:0"><option value="CLIENT_USER">Client user</option><option value="PORTAL_ADMIN">Portal admin</option></select></div>`;
    const addUserBtn = el("button", "btn btn-ghost btn-sm", "+ Add to list");
    uForm.appendChild(addUserBtn);
    s2.appendChild(uForm);
    const uList = el("div"); uList.style.marginTop = "10px";
    s2.appendChild(uList);
    function paintUsers() {
      uList.innerHTML = "";
      if (!draft.users.length) { uList.appendChild(elNote("No users queued yet — that's fine, you can invite people later too.")); return; }
      draft.users.forEach((u, i) => {
        const row = el("div"); row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line,#eee)";
        row.innerHTML = `<span style="flex:1">${esc(u.email)}</span><span class="pill" style="font-size:11px">${u.role === "PORTAL_ADMIN" ? "Portal admin" : "Client user"}</span>`;
        const rm = el("button", "btn btn-ghost btn-sm", "Remove");
        rm.onclick = () => { draft.users.splice(i, 1); paintUsers(); };
        row.appendChild(rm); uList.appendChild(row);
      });
    }
    addUserBtn.onclick = () => {
      const em = document.querySelector("#sp-user-email");
      const rl = document.querySelector("#sp-user-role");
      const email = (em.value || "").trim();
      if (!email || email.indexOf("@") === -1) { toast("Enter a valid email to queue", true); return; }
      draft.users.push({ email: email, role: rl.value });
      em.value = ""; paintUsers();
    };
    paintUsers();
    wrap.appendChild(s2);

    // ---- Step 3: appearance (theme preset into the draft; applied on Finish) ----
    const s3 = sectionCard(3, "Appearance", "Pick a starting theme for the tenant.");
    const tWrap = el("div");
    tWrap.innerHTML = `<label class="field-label">Theme</label>`;
    const tSel = el("select", "input");
    tSel.innerHTML = THEME_PRESETS.map((p) => `<option value="${p[0]}">${esc(p[1])}</option>`).join("");
    tSel.onchange = () => { draft.themePreset = tSel.value; };
    tWrap.appendChild(tSel);
    s3.appendChild(tWrap);
    wrap.appendChild(s3);

    // ---- Step 4: features (receptionist mode into the draft; applied on Finish) ----
    const s4 = sectionCard(4, "Features", "Turn on the AI Receptionist. New tenants start with it off.");
    const vWrap = el("div");
    vWrap.innerHTML = `<label class="field-label">AI Receptionist</label>`;
    const vSel = el("select", "input");
    vSel.innerHTML = voiceOptionsHtml("OFF"); vSel.value = "OFF";
    vSel.onchange = () => { draft.voiceMode = vSel.value; };
    vWrap.appendChild(vSel);
    const vCap = el("p", "cell-muted"); vCap.style.cssText = "margin:8px 0 0;font-size:13px;";
    vCap.textContent = "Off declines inbound calls. Standard voice is the basic back-and-forth receptionist. Premium voice uses the smooth ElevenLabs voice.";
    s4.appendChild(vWrap); s4.appendChild(vCap);
    wrap.appendChild(s4);

    // ---- Footer: Finish creates the tenant, then applies the draft, then enters it ----
    const footer = el("div", "page-actions");
    footer.style.cssText = "margin-top:8px;display:flex;gap:8px;";
    const finish = el("button", "btn btn-primary btn-sm", "Finish — go to tenant");
    finish.onclick = async () => {
      const nameEl = document.querySelector("#sp-name");
      const emailEl = document.querySelector("#sp-email");
      const name = nameEl ? nameEl.value.trim() : "";
      const notifyEmail = emailEl ? emailEl.value.trim() : "";
      if (!name) { toast("Business name is required", true); if (nameEl) nameEl.focus(); return; }
      finish.disabled = true;

      // 1) Create the tenant. If THIS fails, nothing was persisted — stay on the screen.
      let portal;
      try {
        portal = await App.api("/api/admin/portals", { method: "POST", body: JSON.stringify({ name, notifyEmail }) });
      } catch (err) { toast(err.message || "Could not create the tenant", true); finish.disabled = false; return; }

      // 2) Apply the queued draft in sequence. Collect failures instead of throwing, so
      //    one bad step never hides the others or leaves a silent partial setup.
      App.state.currentPortalId = portal.id;
      App.state.currentPortalName = portal.name;
      const problems = [];
      if (draft.themePreset) {
        try { await App.portalApi("/api/theme", { method: "PATCH", body: JSON.stringify({ theme: { active: { mode: "preset", preset: draft.themePreset }, customs: [] } }) }); }
        catch (e) { problems.push("theme"); }
      }
      if (draft.voiceMode && draft.voiceMode !== "OFF") {
        try { await App.api(`/api/admin/portals/${portal.id}`, { method: "PATCH", body: JSON.stringify({ voiceMode: draft.voiceMode }) }); }
        catch (e) { problems.push("receptionist"); }
      }
      let invited = 0;
      for (const u of draft.users) {
        try { await App.api(`/api/admin/portals/${portal.id}/invites`, { method: "POST", body: JSON.stringify({ email: u.email, role: u.role }) }); invited++; }
        catch (e) { problems.push("invite " + u.email); }
      }

      // 3) Report + enter the tenant (never leave an orphan silently).
      const okMsg = `Tenant created${draft.users.length ? `, ${invited}/${draft.users.length} invite(s) sent` : ""}`;
      if (problems.length) toast(`${okMsg}. Couldn't apply: ${problems.join(", ")} — you can finish those inside the tenant.`, true);
      else toast(okMsg);
      enterPortal(portal); // sets currentPortalId + navigates into the new tenant
    };
    const back = el("button", "btn btn-ghost btn-sm", "Back to tenants");
    back.onclick = () => leave(true);
    footer.appendChild(finish); footer.appendChild(back);
    wrap.appendChild(footer);

    view().innerHTML = "";
    view().appendChild(wrap);
  }
  // ---------------- Users ----------------
  async function renderUsers() {
    loading();
    const users = await App.api("/api/admin/users");
    if (!portalsCache.length) { try { portalsCache = await App.api("/api/admin/portals"); } catch (e) {} }
    const wrap = el("div", "fade-in");
    const bar = el("div", "page-actions");
    const create = el("button", "btn btn-primary btn-sm", "+ Create user");
    create.onclick = () => openCreateUser();
    bar.appendChild(create);
    wrap.appendChild(bar);

    const card = el("div", "card");
    const table = el("table");
    table.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Tenant</th><th>Last login</th><th></th></tr></thead>`;
    const tb = el("tbody");
    users.forEach((u) => {
      const tr = el("tr");
      const expired = u.expiresAt && new Date(u.expiresAt).getTime() < Date.now();
      const statusNote = u.pending ? ""
        : u.disabled ? ' <span class="cell-muted">(disabled)</span>'
        : expired ? ' <span class="cell-muted">(expired)</span>'
        : (u.expiresAt ? ` <span class="cell-muted">(expires ${esc(fmtDate(u.expiresAt))})</span>` : "");
      const lastCell = u.pending
        ? '<span class="badge badge-progress">Pending</span>'
        : (u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never");
      tr.innerHTML = `<td class="cell-strong cu-name"></td><td class="cell-mono">${esc(u.email)}</td>
        <td>${esc(roleLabel(u.role))}${statusNote}</td><td class="cell-muted">${esc(u.tenantName || "—")}</td>
        <td class="cell-muted">${lastCell}</td><td></td>`;
      const meRole = App.state.me.role;
      // Item 2: an OWNER can edit any name; everyone else only their own row.
      // Pending invitees have no editable account yet, so never show the pencil.
      const canEditName = !u.pending && ((meRole === "OWNER") || (u.id === App.state.me.id));
      renderNameCell(tr.querySelector(".cu-name"), u, canEditName);
      if (u.pending) {
        const rev = el("button", "link-danger", "Revoke");
        rev.onclick = async () => { if (!(await App.ui.confirmModal({ title: "Revoke invite", message: `Revoke the pending invite for ${u.email}?`, confirmText: "Revoke" }))) return; try { await App.api(`/api/admin/invites/${u.inviteId}/revoke`, { method: "POST" }); toast("Invite revoked"); renderUsers(); } catch (e) { toast(e.message, true); } };
        tr.lastChild.appendChild(rev);
      } else {
        const canRemove = u.id !== App.state.me.id            // never yourself
          && u.role !== "OWNER"                                // no one can delete an owner
          && !(u.role === "SUPER_ADMIN" && meRole !== "OWNER"); // super-admins: owner only
        if (canRemove) {
          const del = el("button", "link-danger", "Remove");
          del.onclick = async () => { if (!(await App.ui.confirmModal({ title: "Remove user", message: `Remove ${u.email}?`, confirmText: "Remove" }))) return; try { await App.api(`/api/admin/users/${u.id}`, { method: "DELETE" }); toast("User removed"); renderUsers(); } catch (e) { toast(e.message, true); } };
          tr.lastChild.appendChild(del);
        }
      }
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    card.appendChild(table);
    wrap.appendChild(card);
    view().innerHTML = "";
    view().appendChild(wrap);
  }

  // Item 2 helpers: render a name cell, with an edit pencil when allowed.
  function renderNameCell(cell, u, canEdit) {
    cell.innerHTML = "";
    cell.appendChild(el("span", null, u.name || "—"));
    if (canEdit) {
      const pencil = el("button", null, "\u270E"); // pencil glyph
      pencil.title = "Edit name";
      pencil.setAttribute("aria-label", "Edit name");
      pencil.style.cssText = "margin-left:6px;background:none;border:none;cursor:pointer;color:var(--ink-soft);font-size:13px;padding:0";
      pencil.onclick = () => startNameEdit(cell, u, canEdit);
      cell.appendChild(pencil);
    }
  }

  function startNameEdit(cell, u, canEdit) {
    cell.innerHTML = "";
    const input = el("input", "input");
    input.value = u.name || "";
    input.style.cssText = "display:inline-block;max-width:170px;padding:4px 8px";
    const save = el("button", "btn btn-primary btn-sm", "Save");
    save.style.marginLeft = "6px";
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    cancel.style.marginLeft = "4px";
    cell.appendChild(input); cell.appendChild(save); cell.appendChild(cancel);
    input.focus();
    cancel.onclick = () => renderNameCell(cell, u, canEdit);
    save.onclick = async () => {
      try {
        const updated = await App.api(`/api/admin/users/${u.id}/name`, { method: "PATCH", body: JSON.stringify({ name: input.value.trim() }) });
        u.name = updated.name;
        // If I renamed myself, refresh the cached identity AND the sidebar chip,
        // which reads App.state.me (otherwise it keeps showing the old name).
        if (u.id === App.state.me.id) {
          App.state.me.name = updated.name;
          const display = updated.name || App.state.me.email;
          const nm = document.querySelector(".user-name"); if (nm) nm.textContent = display;
          const av = document.querySelector(".user-avatar"); if (av) av.textContent = display.charAt(0).toUpperCase();
        }
        toast("Name updated");
        renderNameCell(cell, u, canEdit);
      } catch (e) { toast(e.message, true); }
    };
  }

  function openCreateUser(portal) {
    const perPortal = !!portal; // per-portal mode: only portal-admin/client-user, no portal picker
    const inner = el("div");
    // Master form creates only top-tier, portal-less accounts (Super Admin / Auditor);
    // per-portal form creates only portal-admin / client-user for the chosen portal.
    const roleOptions = perPortal
      ? `<option value="CLIENT_USER">Client User</option><option value="PORTAL_ADMIN">Portal Admin</option>`
      : `<option value="SUPER_ADMIN">Super Admin</option><option value="AUDITOR">Auditor (3-day tester)</option>`;
    inner.innerHTML = `<div class="modal-head"><h2>${perPortal ? "Invite user · " + esc(portal.name) : "Invite user"}</h2><button class="icon-btn" id="cu-close">&times;</button></div>
      <div class="modal-body">
        <label class="field-label">Name</label><input id="cu-name" class="input" placeholder="Jane Doe" />
        <label class="field-label">Email *</label><input id="cu-email" class="input" placeholder="jane@acme.com" />
        <label class="field-label">Role *</label>
        <select id="cu-role" class="input">${roleOptions}</select>
        <p class="sub" style="margin:10px 0 0">We'll email them an invite link automatically — or write a custom email and place the link yourself.</p>
        <button id="cu-go" class="btn btn-primary btn-block" style="margin-top:14px">Send invite</button>
        <button id="cu-custom" class="btn btn-ghost btn-block" style="margin-top:8px">Write custom email</button>
      </div>`;
    const overlay = modal(inner);
    const roleSel = inner.querySelector("#cu-role");
    inner.querySelector("#cu-close").onclick = () => overlay.remove();
    inner.querySelector("#cu-go").onclick = async () => {
      const role = roleSel.value;
      const body = {
        name: inner.querySelector("#cu-name").value.trim(),
        email: inner.querySelector("#cu-email").value.trim(),
        role,
      };
      if (!body.email) { toast("Email is required", true); return; }
      try {
        let result;
        if (perPortal) {
          result = await App.api("/api/users?tenantId=" + encodeURIComponent(portal.id), { method: "POST", body: JSON.stringify(body) });
          overlay.remove(); renderPortalUsers(portal);
        } else {
          result = await App.api("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
          overlay.remove(); renderUsers();
        }
        showInviteResult(body.email, result && result.link, result && result.emailed);
      } catch (err) { toast(err.message, true); }
    };
    inner.querySelector("#cu-custom").onclick = () => {
      const role = roleSel.value;
      const name = inner.querySelector("#cu-name").value.trim();
      const email = inner.querySelector("#cu-email").value.trim();
      if (!email) { toast("Email is required", true); return; }
      // Same endpoints + invite token as the default send; only the body differs.
      App.inviteComposer.open({
        email,
        send: (customHtml, customSubject) => {
          const payload = JSON.stringify({ name, email, role, customHtml, customSubject });
          return perPortal
            ? App.api("/api/users?tenantId=" + encodeURIComponent(portal.id), { method: "POST", body: payload })
            : App.api("/api/admin/users", { method: "POST", body: payload });
        },
        onSent: (result) => {
          overlay.remove();
          if (perPortal) renderPortalUsers(portal); else renderUsers();
          showInviteResult(email, result && result.link, result && result.emailed);
        },
      });
    };
  }

  // Success popup after an invite is created. Always shows the activation link so it
  // can be copied while email delivery is limited (no verified sending domain yet).
  function showInviteResult(email, link, emailed) {
    const inner = el("div");
    const note = emailed
      ? "An invite email was sent to " + esc(email) + " (it may land in spam)."
      : "Email couldn't be delivered right now, so copy this link and send it to " + esc(email) + " yourself.";
    inner.innerHTML = `<div class="modal-head"><h2>Invite sent</h2><button class="icon-btn" id="ir-close">&times;</button></div>
      <div class="modal-body">
        <p class="sub" style="margin:0 0 12px">${note}</p>
        <label class="field-label">Activation link</label>
        <input id="ir-link" class="input" type="text" readonly value="${esc(link || "")}" />
        <button id="ir-copy" class="btn btn-primary btn-block" style="margin-top:12px">Copy link</button>
      </div>`;
    const overlay = modal(inner);
    inner.querySelector("#ir-close").onclick = () => overlay.remove();
    const linkInput = inner.querySelector("#ir-link");
    inner.querySelector("#ir-copy").onclick = () => {
      try { linkInput.select(); } catch (e) {}
      const done = () => toast("Link copied");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link || "").then(done).catch(() => { try { document.execCommand("copy"); done(); } catch (e) {} });
      } else { try { document.execCommand("copy"); done(); } catch (e) {} }
    };
  }

  // ---------------- Change Log ----------------
  // Product-level log of every change shipped, read from the DB (never git).
  // Reuses App.table.mount — same sort/filter/pagination as the other hub tables.
  async function renderChangelog() {
    loading();
    let rows;
    try { rows = await App.api("/api/admin/changelog"); }
    catch (e) { view().innerHTML = `<div class="card cell-muted">${esc(e.message)}</div>`; return; }
    if (!Array.isArray(rows)) rows = [];

    view().innerHTML = "";
    const host = el("div", "fade-in");
    view().appendChild(host);

    const columns = [
      { key: "date", label: "Date", type: "date", get: (r) => r.date, text: (r) => fmtDateOnly(r.date), render: (r) => `<span class="cell-muted">${fmtDateOnly(r.date)}</span>` },
      { key: "type", label: "Type", type: "text", get: (r) => r.type, cellClass: "cell-strong", render: (r) => esc(r.type || "—") },
      { key: "description", label: "Description", type: "text", get: (r) => r.description, render: (r) => esc(r.description || "—") },
    ];
    const empty = `<div class="card cell-muted" style="padding:18px">No changes logged yet.</div>`;
    App.table.mount({
      container: host, columns, rows,
      defaultSort: "date", defaultSortDir: "desc",
      emptyHtml: empty, pageSize: 25,
    });
  }

  App.admin = { render };
})(typeof window !== "undefined" ? window : globalThis);
