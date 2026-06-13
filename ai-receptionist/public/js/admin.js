(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, fmtDate, statusBadge, roleLabel, toast } = App.util;

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
    create.onclick = () => renderSetupScreen();
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
          <div class="portal-rule">
            <label class="field-label" style="margin:0 0 4px">AI Receptionist</label>
            <select class="input portal-recep-sel">
              ${voiceOptionsHtml(voiceModeOf(p))}
            </select>
          </div>
          <div class="portal-actions"><button class="btn btn-ghost btn-sm portal-users">Users</button></div>
          <div class="portal-actions"><button class="btn btn-primary btn-sm portal-enter">Open portal →</button>
            <button class="btn btn-ghost btn-sm portal-toggle">${p.status === "ACTIVE" ? "Suspend" : "Activate"}</button></div>`;
        card.querySelector(".portal-enter").onclick = () => enterPortal(p);
        card.querySelector(".portal-users").onclick = () => renderPortalUsers(p);
        const ruleSel = card.querySelector(".portal-rule-sel");
        ruleSel.onclick = (e) => e.stopPropagation();
        ruleSel.onchange = async () => {
          const requireEmail = ruleSel.value === "email";
          try { await App.api(`/api/admin/portals/${p.id}`, { method: "PATCH", body: JSON.stringify({ requireEmail }) }); p.requireEmail = requireEmail; toast(requireEmail ? "Now requires a unique email" : "Now accepts phone or email"); }
          catch (err) { toast(err.message, true); ruleSel.value = p.requireEmail !== false ? "email" : "either"; }
        };
        const recepSel = card.querySelector(".portal-recep-sel");
        recepSel.onclick = (e) => e.stopPropagation();
        recepSel.onchange = async () => {
          const voiceMode = recepSel.value;
          try { await App.api(`/api/admin/portals/${p.id}`, { method: "PATCH", body: JSON.stringify({ voiceMode }) }); p.voiceMode = voiceMode; p.receptionistEnabled = voiceMode !== "OFF"; toast(voiceToast(voiceMode)); }
          catch (err) { toast(err.message, true); recepSel.value = voiceModeOf(p); }
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
    const back = el("button", "btn btn-ghost btn-sm", "← Portals");
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
      tr.innerHTML = `<td colspan="5" class="cell-muted">No users in this portal yet.</td>`;
      tb.appendChild(tr);
    } else {
      users.forEach((u) => {
        const tr = el("tr");
        tr.innerHTML = `<td class="cell-strong">${esc(u.name || "—")}</td><td class="cell-mono">${esc(u.email)}</td>
          <td>${esc(roleLabel(u.role))}</td><td class="cell-muted">${u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never"}</td><td></td>`;
        if (u.id !== App.state.me.id) {
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

  // ===================== Unified portal setup screen =====================
  // One screen, three sections. Section 1 (basic details) CREATES the portal via
  // the existing POST /api/admin/portals. Once created, we set
  // App.state.currentPortalId to the new id — the hinge that makes the reused
  // users + theme + labels editors target this portal — and unlock sections 2 & 3.
  // Pass an existing portal to resume setup (section 1 is already done).
  function renderSetupScreen(existingPortal) {
    let portal = existingPortal || null;
    let created = !!existingPortal;
    // Remember where the app was pointed so backing out doesn't strand the
    // super-admin inside a half-set-up portal. (In the admin area this is null.)
    const prior = { id: App.state.currentPortalId, name: App.state.currentPortalName };
    if (created) { App.state.currentPortalId = portal.id; App.state.currentPortalName = portal.name; }

    // The labels editor calls App._route() after saving to repaint the in-portal
    // nav. On this directly-rendered screen that would bounce us to the portal list,
    // so while the setup screen is open we make that repaint a no-op (the save still
    // succeeds and the editor already shows what was typed). Real navigation is
    // unaffected — the app's own hashchange handler uses a separate route fn — and
    // we restore App._route the moment the admin navigates away or leaves.
    const realRoute = App._route;
    let routeShimmed = true;
    function restoreRoute() {
      if (!routeShimmed) return;
      routeShimmed = false;
      App._route = realRoute;
      window.removeEventListener("hashchange", restoreRoute);
    }
    window.addEventListener("hashchange", restoreRoute);
    App._route = function () {};

    function leave(toList) {
      restoreRoute();
      // Restore the prior portal context (don't leave the app scoped to this portal
      // unless the admin explicitly "enters" it via Finish).
      App.state.currentPortalId = prior.id;
      App.state.currentPortalName = prior.name;
      if (toList) render("portals");
    }

    function sectionCard(n, title, desc, enabled) {
      const card = el("div", "card");
      card.style.cssText = "margin-bottom:16px;padding:20px;" + (enabled ? "" : "opacity:.55;");
      const head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:4px;";
      const num = el("div", null, String(n));
      num.style.cssText = "flex:0 0 28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;background:" + (enabled ? "var(--accent,#3257d6);color:#fff" : "var(--surface,#eef1f6);color:var(--ink-soft,#5b6678)") + ";";
      const tt = el("div"); tt.innerHTML = `<div style="font-weight:600">${esc(title)}</div><div class="cell-muted" style="font-size:13px">${esc(desc)}</div>`;
      head.appendChild(num); head.appendChild(tt);
      if (!enabled) { const lock = el("span", "pill", "Create portal first"); lock.style.cssText = "margin-left:auto;font-size:12px;opacity:.8;"; head.appendChild(lock); }
      card.appendChild(head);
      return card;
    }

    function draw() {
      const wrap = el("div", "fade-in");
      const head = el("div");
      head.innerHTML = `<h1 class="page-title">${created ? "Set up " + esc(portal.name) : "Create a portal"}</h1>
        <p class="cell-muted">Enter the basics to create the portal, then add users and set its look — all on this screen. Each section saves as you go.</p>`;
      wrap.appendChild(head);

      // ---- Section 1: basic details (creates the portal) ----
      const s1 = sectionCard(1, "Basic details", "Name, contact rule, and how the receptionist greets callers.", true);
      if (!created) {
        const f = el("div");
        f.innerHTML = `
          <label class="field-label">Business name *</label><input id="sp-name" class="input" placeholder="Acme Plumbing" />
          <label class="field-label">Business type</label><input id="sp-type" class="input" placeholder="home services company" />
          <label class="field-label">Phone number</label><input id="sp-phone" class="input" placeholder="+19195551234" />
          <label class="field-label">Notify email *</label><input id="sp-email" class="input" placeholder="owner@acme.com" />
          <label class="field-label">Greeting</label><textarea id="sp-greet" class="input" rows="2" placeholder="Thanks for calling Acme. How can I help?"></textarea>
          <label class="field-label">Contact identity rule</label>
          <select id="sp-rule" class="input">
            <option value="email">Require unique email (default)</option>
            <option value="either">Phone or email</option>
          </select>`;
        const go = el("button", "btn btn-primary btn-sm", "Create portal");
        go.style.marginTop = "14px";
        go.onclick = async () => {
          const body = {
            name: f.querySelector("#sp-name").value.trim(),
            businessType: f.querySelector("#sp-type").value.trim(),
            phoneNumber: f.querySelector("#sp-phone").value.trim(),
            notifyEmail: f.querySelector("#sp-email").value.trim(),
            greeting: f.querySelector("#sp-greet").value.trim(),
            requireEmail: f.querySelector("#sp-rule").value === "email",
          };
          if (!body.name || !body.notifyEmail) { toast("Name and notify email are required", true); return; }
          go.disabled = true;
          try {
            portal = await App.api("/api/admin/portals", { method: "POST", body: JSON.stringify(body) });
            created = true;
            // The hinge: point the reused editors at the brand-new portal.
            App.state.currentPortalId = portal.id;
            App.state.currentPortalName = portal.name;
            toast("Portal created");
            draw(); // re-render: lock section 1, unlock sections 2 & 3
          } catch (err) { toast(err.message, true); go.disabled = false; }
        };
        f.appendChild(go);
        s1.appendChild(f);
      } else {
        const done = el("div");
        done.style.cssText = "margin-top:6px;display:flex;align-items:center;gap:8px;color:var(--ink,#1a2230);";
        done.innerHTML = `<span class="pill" style="background:var(--ok,#e6f4ea);color:#1c7a3f">Created</span>
          <span><strong>${esc(portal.name)}</strong> is ready. Configure it below, or open it any time later.</span>`;
        s1.appendChild(done);
      }
      wrap.appendChild(s1);

      // ---- Section 2: add users (reuse renderUsersStep verbatim) ----
      const s2 = sectionCard(2, "Add users", "Invite teammates and set their roles. They get a link to set their own password.", created);
      if (created) {
        const host = el("div"); host.style.marginTop = "8px";
        renderUsersStep(host, portal);
        s2.appendChild(host);
      } else {
        s2.appendChild(elNote("You can invite users once the portal is created."));
      }
      wrap.appendChild(s2);

      // ---- Section 3: labels & theme (reuse the existing editors) ----
      const s3 = sectionCard(3, "Labels & theme", "Rename things and choose the portal's colors. Optional — you can do this later.", created);
      if (created) {
        const themeWrap = el("div"); themeWrap.style.marginTop = "8px";
        themeWrap.appendChild(el("h3", "settings-sub", "Theme"));
        const themeHost = el("div"); themeWrap.appendChild(themeHost);
        s3.appendChild(themeWrap);
        const labelsWrap = el("div"); labelsWrap.style.marginTop = "20px";
        const labelsHost = el("div"); labelsWrap.appendChild(labelsHost);
        s3.appendChild(labelsWrap);
        // Mount AFTER the hosts are in the DOM. Both editors read App.portalApi,
        // which scopes to currentPortalId (set above) for a super-admin.
        if (App.theme && App.theme.mountSettings) App.theme.mountSettings(themeHost);
        if (App.labelsEditor && App.labelsEditor.mount) App.labelsEditor.mount(labelsHost);
        else labelsHost.appendChild(elNote("Labels editor unavailable."));
      } else {
        s3.appendChild(elNote("You can set labels and theme once the portal is created."));
      }
      wrap.appendChild(s3);

      // ---- Section 4: features (AI Receptionist on/off) ----
      const s4 = sectionCard(4, "Features", "Turn portal features on or off. New portals start with the AI Receptionist off.", created);
      if (created) {
        const fhost = el("div"); fhost.style.marginTop = "8px";
        const lab = el("label", "field-label", "AI Receptionist"); lab.style.cssText = "margin:0 0 4px";
        const sel = el("select", "input");
        sel.innerHTML = voiceOptionsHtml(voiceModeOf(portal));
        sel.value = voiceModeOf(portal);
        const cap = el("p", "cell-muted"); cap.style.cssText = "margin:8px 0 0;font-size:13px;";
        cap.textContent = "Off declines inbound calls. Standard voice is the basic back-and-forth receptionist. Premium voice uses the smooth ElevenLabs voice. Standard and Premium both show the Calls page; Off hides it.";
        sel.onchange = async () => {
          const voiceMode = sel.value;
          try { await App.api(`/api/admin/portals/${portal.id}`, { method: "PATCH", body: JSON.stringify({ voiceMode }) }); portal.voiceMode = voiceMode; portal.receptionistEnabled = voiceMode !== "OFF"; toast(voiceToast(voiceMode)); }
          catch (err) { toast(err.message, true); sel.value = voiceModeOf(portal); }
        };
        fhost.appendChild(lab); fhost.appendChild(sel); fhost.appendChild(cap);
        s4.appendChild(fhost);
      } else {
        s4.appendChild(elNote("You can turn features on once the portal is created."));
      }
      wrap.appendChild(s4);

      // ---- Footer ----
      const footer = el("div", "page-actions");
      footer.style.cssText = "margin-top:8px;display:flex;gap:8px;";
      const finish = el("button", "btn btn-primary btn-sm", "Finish — go to portal");
      finish.disabled = !created;
      finish.onclick = () => { if (portal) { restoreRoute(); enterPortal(portal); } }; // enterPortal sets currentPortalId + navigates
      const back = el("button", "btn btn-ghost btn-sm", "Back to portals");
      back.onclick = () => leave(true);
      footer.appendChild(finish); footer.appendChild(back);
      wrap.appendChild(footer);

      view().innerHTML = "";
      view().appendChild(wrap);
    }

    function elNote(text) {
      const d = el("div", "cell-muted"); d.style.cssText = "margin-top:8px;font-size:13px;"; d.textContent = text; return d;
    }

    draw();
  }
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

  // ---------------- Users ----------------
  async function renderUsers() {
    loading();
    const [users, senderRes] = await Promise.all([
      App.api("/api/admin/users"),
      App.api("/api/admin/settings/invite-sender").catch(() => ({ email: "" })),
    ]);
    if (!portalsCache.length) { try { portalsCache = await App.api("/api/admin/portals"); } catch (e) {} }
    const isOwner = App.state.me.role === "OWNER";
    const senderEmail = (senderRes && senderRes.email) || "";
    const wrap = el("div", "fade-in");
    const bar = el("div", "page-actions");
    const create = el("button", "btn btn-primary btn-sm", "+ Create user");
    create.onclick = () => openCreateUser();
    bar.appendChild(create);
    wrap.appendChild(bar);

    // Item 1: master "invite sender email". Read-only for non-owners; OWNER can save.
    // The server also rejects a save from a non-owner (greying is only the UI half).
    const senderCard = el("div", "card");
    senderCard.style.cssText = "padding:14px 18px;margin-bottom:12px";
    senderCard.innerHTML = `
      <label class="field-label" style="display:block;margin-bottom:6px">Invite sender email</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="sender-email" class="input" type="email" style="flex:1" value="${esc(senderEmail)}" placeholder="Not set" ${isOwner ? "" : "disabled"} />
        ${isOwner ? '<button id="sender-save" class="btn btn-primary btn-sm">Save</button>' : ""}
      </div>
      <p class="sub" style="margin:8px 0 0">The from-address used for invite emails.${isOwner ? "" : " Only an owner can change this."}</p>`;
    if (isOwner) {
      senderCard.querySelector("#sender-save").onclick = async () => {
        const email = senderCard.querySelector("#sender-email").value.trim();
        try {
          const r = await App.api("/api/admin/settings/invite-sender", { method: "PUT", body: JSON.stringify({ email }) });
          senderCard.querySelector("#sender-email").value = r.email || "";
          toast("Sender email saved");
        } catch (e) { toast(e.message, true); }
      };
    }
    wrap.appendChild(senderCard);

    const card = el("div", "card");
    const table = el("table");
    table.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Portal</th><th>Last login</th><th></th></tr></thead>`;
    const tb = el("tbody");
    users.forEach((u) => {
      const tr = el("tr");
      const expired = u.expiresAt && new Date(u.expiresAt).getTime() < Date.now();
      const statusNote = u.disabled ? ' <span class="cell-muted">(disabled)</span>'
        : expired ? ' <span class="cell-muted">(expired)</span>'
        : (u.expiresAt ? ` <span class="cell-muted">(expires ${esc(fmtDate(u.expiresAt))})</span>` : "");
      tr.innerHTML = `<td class="cell-strong cu-name"></td><td class="cell-mono">${esc(u.email)}</td>
        <td>${esc(roleLabel(u.role))}${statusNote}</td><td class="cell-muted">${esc(u.tenantName || "—")}</td>
        <td class="cell-muted">${u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never"}</td><td></td>`;
      const meRole = App.state.me.role;
      // Item 2: an OWNER can edit any name; everyone else only their own row.
      const canEditName = (meRole === "OWNER") || (u.id === App.state.me.id);
      renderNameCell(tr.querySelector(".cu-name"), u, canEditName);
      const canRemove = u.id !== App.state.me.id            // never yourself
        && u.role !== "OWNER"                                // no one can delete an owner
        && !(u.role === "SUPER_ADMIN" && meRole !== "OWNER"); // super-admins: owner only
      if (canRemove) {
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
        <p class="sub" style="margin:10px 0 0">They'll get an email with a link to set their own password — no temporary password needed.</p>
        <button id="cu-go" class="btn btn-primary btn-block" style="margin-top:14px">Send invite</button>
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

  App.admin = { render };
})(typeof window !== "undefined" ? window : globalThis);
