(function (global) {
  const App = global.App || (global.App = {});

  // ======================================================================
  // Reusable Audience Picker — COUNT-FIRST (not a contacts-table clone).
  //   App.audiencePicker.mount(host, opts) -> api
  //   opts:
  //     preloadIds : string[]  (optional) fix the audience to these contact ids
  //                            (for the future Contacts-bulk deep-link); hides the
  //                            saved-filter + criteria controls and just shows the
  //                            count/preview/exclude UI over that set.
  //     onChange   : fn()      (optional) called whenever the resolved set changes.
  //   api:
  //     getRecipients()   -> [{id,email,name}]  (matching − excluded, emailable only)
  //     getRecipientIds() -> string[]
  //     getCounts()       -> { match, emailable, recipients }
  //
  // Filtering REUSES the existing machinery: App.portal.contactColumnDefs for the
  // contact columns, App.table.ruleEditor as the criteria control, and
  // App.table.pipeline for the live client-side match — nothing is rebuilt here.
  // ======================================================================
  function mountAudiencePicker(host, opts) {
    opts = opts || {};
    const { el, esc, toast } = App.util;
    host.innerHTML = "";
    host.classList.add("audience-picker");

    const state = {
      contacts: [],
      columns: [],
      rules: [],
      excluded: new Set(),
      preload: Array.isArray(opts.preloadIds) ? new Set(opts.preloadIds) : null,
      ready: false,
    };

    const summary = el("div", "audience-summary");
    summary.style.cssText = "font-size:15px;font-weight:600;margin:10px 0 6px";
    const previewToggle = el("button", "btn btn-ghost btn-sm");
    const previewBox = el("div", "audience-preview");
    previewBox.style.cssText = "display:none;margin-top:8px;border:1px solid var(--line);border-radius:8px;max-height:260px;overflow:auto";
    let previewOpen = false;

    function matched() {
      if (!state.ready) return [];
      if (state.preload) return state.contacts.filter((c) => state.preload.has(c.id));
      return App.table.pipeline(state.contacts, state.columns, { rules: state.rules });
    }
    function emailable(rows) { return rows.filter((c) => c.email && String(c.email).trim()); }
    function recipients() { return emailable(matched()).filter((c) => !state.excluded.has(c.id)); }

    function counts() {
      const m = matched();
      const e = emailable(m);
      const r = e.filter((c) => !state.excluded.has(c.id));
      return { match: m.length, emailable: e.length, recipients: r.length };
    }

    function renderSummary() {
      const c = counts();
      const noun = (n) => `${n} ${App.label ? App.label("contact", n === 1 ? "one" : "many").toLowerCase() : (n === 1 ? "contact" : "contacts")}`;
      let txt = `${noun(c.match)} match · ${c.emailable} have an email`;
      if (state.excluded.size) txt += ` · ${c.recipients} recipients`;
      summary.textContent = txt;
      previewToggle.textContent = `${c.recipients} recipients ${previewOpen ? "▴" : "▾"}`;
      if (previewOpen) renderPreview();
      if (opts.onChange) opts.onChange();
    }

    function renderPreview() {
      previewBox.innerHTML = "";
      const list = recipients();
      if (!list.length) { previewBox.appendChild(el("div", "cell-muted", "No emailable recipients.")); return; }
      list.forEach((c) => {
        const row = el("div", "audience-row");
        row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 10px;border-bottom:1px solid var(--line)";
        const who = el("div");
        who.innerHTML = `<span class="cell-strong">${esc(c.name || "Unknown")}</span> <span class="cell-muted">${esc(c.email)}</span>`;
        const rm = el("button", "btn btn-ghost btn-sm", "Remove");
        rm.title = "Don't send to this person";
        rm.onclick = () => { state.excluded.add(c.id); renderSummary(); };
        row.appendChild(who); row.appendChild(rm);
        previewBox.appendChild(row);
      });
      // Offer to restore excluded ones, so the manual exclude is reversible while editing.
      if (state.excluded.size) {
        const restore = el("div");
        restore.style.cssText = "padding:8px 10px";
        const b = el("button", "btn btn-ghost btn-sm", `Restore ${state.excluded.size} removed`);
        b.onclick = () => { state.excluded.clear(); renderSummary(); };
        restore.appendChild(b);
        previewBox.appendChild(restore);
      }
    }

    previewToggle.onclick = () => {
      previewOpen = !previewOpen;
      previewBox.style.display = previewOpen ? "" : "none";
      renderSummary();
    };

    async function build() {
      const [contacts, fields, saved] = await Promise.all([
        App.portalApi("/api/contacts").catch(() => []),
        App.portalApi("/api/fields").catch(() => []),
        state.preload ? Promise.resolve([]) : App.portalApi("/api/saved-filters?view=contacts").catch(() => []),
      ]);
      state.contacts = Array.isArray(contacts) ? contacts : [];
      state.columns = App.portal.contactColumnDefs(fields || []);
      state.ready = true;

      if (!state.preload) {
        // Start-from-a-saved-filter dropdown (reuses the same saved filters as Contacts).
        if ((saved || []).length) {
          const sfWrap = el("label", "field");
          sfWrap.innerHTML = `<span class="field-label">Start from a saved filter (optional)</span>`;
          const sel = el("select", "input");
          sel.innerHTML = `<option value="">— none —</option>` + (saved || []).map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("");
          sel.onchange = () => {
            const f = (saved || []).find((x) => x.id === sel.value);
            const def = (f && f.definition) || {};
            state.rules.length = 0;
            (Array.isArray(def.rules) ? def.rules : []).forEach((r) => state.rules.push(r));
            state.excluded.clear();
            mountRules();
            renderSummary();
          };
          sfWrap.appendChild(sel);
          host.appendChild(sfWrap);
        }
        // The criteria editor (the primary control) — REUSE App.table.ruleEditor.
        host.appendChild(el("div", "field-label", "Who to include (criteria)"));
        rulesHost = el("div");
        host.appendChild(rulesHost);
        mountRules();
      } else {
        host.appendChild(el("div", "cell-muted", "Sending to the contacts you selected."));
      }

      host.appendChild(summary);
      host.appendChild(previewToggle);
      host.appendChild(previewBox);
      renderSummary();
    }

    let rulesHost = null;
    function mountRules() {
      if (!rulesHost) return;
      rulesHost.innerHTML = "";
      rulesHost.appendChild(App.table.ruleEditor(state.columns, state.contacts, state.rules, () => { state.excluded.clear(); renderSummary(); }));
    }

    build().catch((e) => { host.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; });

    return {
      getRecipients: () => recipients().map((c) => ({ id: c.id, email: c.email, name: c.name || null })),
      getRecipientIds: () => recipients().map((c) => c.id),
      getCounts: counts,
    };
  }

  App.audiencePicker = { mount: mountAudiencePicker };

  // ======================================================================
  // Communication page — tab strip (Email only for now; Texts/Surveys/Templates
  // are future tabs, intentionally not built). The Email tab is audience-first
  // manual send, reusing the composer + the same outbound path/role-gate as
  // bulk-emailing from Contacts.
  // ======================================================================
  function renderCommunication(host) {
    const { el, esc } = App.util;
    host.innerHTML = "";
    const wrap = el("div", "fade-in");

    // Tab strip (same .tabs component Data Administration uses). One tab for now.
    const tabsBar = el("div", "tabs");
    const tabBody = el("div", "tab-body");
    const TABS = [["email", "Email"]]; // future: ["texts","Texts"], ["surveys","Surveys"], ["templates","Templates"]
    let active = "email";
    function setTab(key) {
      active = key;
      App.util.$$(".tab", tabsBar).forEach((t) => t.classList.toggle("active", t.dataset.tab === key));
      tabBody.innerHTML = "";
      if (key === "email") emailTab(tabBody);
    }
    TABS.forEach(([key, label]) => {
      const t = el("button", "tab" + (key === active ? " active" : ""), esc(label));
      t.dataset.tab = key;
      t.onclick = () => setTab(key);
      tabsBar.appendChild(t);
    });
    wrap.appendChild(tabsBar);
    wrap.appendChild(tabBody);
    host.appendChild(wrap);
    setTab("email");
  }

  // The Email tab: a Compose / Sent sub-switch. Compose is the audience-first send
  // screen; Sent is the log of past blasts. Default to Compose (or Compose with a
  // preloaded audience when deep-linked from Contacts).
  function emailTab(host) {
    const { el, esc } = App.util;
    host.innerHTML = "";
    const preload = pendingPreload; pendingPreload = null; // consume the deep-link once

    const sub = el("div", "tabs");
    const subBody = el("div");
    subBody.style.marginTop = "12px";
    let view = "compose";
    function setSub(key) {
      view = key;
      App.util.$$(".tab", sub).forEach((t) => t.classList.toggle("active", t.dataset.s === key));
      subBody.innerHTML = "";
      if (key === "compose") emailCompose(subBody, key === "compose" ? preload : null);
      else emailSent(subBody);
    }
    [["compose", "Compose"], ["sent", "Sent"]].forEach(([key, label]) => {
      const t = el("button", "tab" + (key === "compose" ? " active" : ""), esc(label));
      t.dataset.s = key;
      t.onclick = () => setSub(key);
      sub.appendChild(t);
    });
    host.appendChild(sub);
    host.appendChild(subBody);
    setSub("compose");
  }

  function emailCompose(host, preloadIds) {
    const { el, esc, toast } = App.util;
    host.innerHTML = "";
    const card = el("div", "card");
    card.style.cssText = "padding:18px";
    card.appendChild(el("h3", "settings-sub", "New email"));
    const intro = preloadIds && preloadIds.length
      ? `Sending to the ${preloadIds.length} ${App.label("contact", preloadIds.length === 1 ? "one" : "many").toLowerCase()} you selected. Only those with an email address receive it.`
      : "Write your message, choose who it goes to, and send. Only people with an email address receive it.";
    card.appendChild(el("div", "cell-muted", intro));

    // Subject + body — REUSE the rich-text composer. Its built-in Templates menu is
    // the "start from / save as template" affordance (no duplicate template UI here).
    const composerHost = el("div");
    composerHost.style.marginTop = "12px";
    card.appendChild(composerHost);
    const composer = App.compose.mount(composerHost, { kind: "email" });

    card.appendChild(el("div", "field-label", "Audience"));
    const audienceHost = el("div");
    card.appendChild(audienceHost);
    const audience = App.audiencePicker.mount(audienceHost, (preloadIds && preloadIds.length) ? { preloadIds } : {});

    const actions = el("div");
    actions.style.cssText = "margin-top:16px";
    const sendBtn = el("button", "btn btn-primary", "Send email");
    actions.appendChild(sendBtn);
    card.appendChild(actions);
    host.appendChild(card);

    sendBtn.onclick = async () => {
      const subject = composer.getSubject();
      if (!subject || !subject.trim()) { toast("Add a subject.", true); return; }
      const recipientIds = audience.getRecipientIds();
      if (!recipientIds.length) { toast("No emailable recipients in this audience.", true); return; }

      const ok = await App.ui.confirmModal({
        title: "Send this email?",
        message: `You're about to email ${recipientIds.length} ${recipientIds.length === 1 ? "person" : "people"}. This sends to real contacts. Send?`,
        confirmText: "Send",
      });
      if (!ok) return;

      sendBtn.disabled = true; sendBtn.textContent = "Sending…";
      try {
        const res = await App.portalApi("/api/communication/email", {
          method: "POST",
          body: JSON.stringify({ subject: subject.trim(), html: composer.getHTML(), contactIds: recipientIds }),
        });
        if (res.failCount) toast(`Sent to ${res.sentCount} of ${res.recipientCount} — ${res.failCount} failed.`);
        else toast(`Sent to ${res.sentCount} ${res.sentCount === 1 ? "person" : "people"}.`);
        sendBtn.disabled = false; sendBtn.textContent = "Send email";
      } catch (e) {
        toast(e.message, true);
        sendBtn.disabled = false; sendBtn.textContent = "Send email";
      }
    };
  }

  function emailSent(host) {
    const { el, esc, fmtDate, toast } = App.util;
    host.innerHTML = `<div class="cell-muted" style="padding:8px">Loading…</div>`;
    App.portalApi("/api/communication/sends").then((rows) => {
      rows = Array.isArray(rows) ? rows : [];
      host.innerHTML = "";
      const tableHost = el("div");
      const columns = [
        { key: "createdAt", label: "Date", type: "date", get: (r) => r.createdAt, text: (r) => fmtDate(r.createdAt), render: (r) => `<span class="cell-muted">${fmtDate(r.createdAt)}</span>` },
        { key: "subject", label: "Subject", type: "text", get: (r) => r.subject, render: (r) => esc(r.subject || "—") },
        { key: "recipientCount", label: "Recipients", type: "text", get: (r) => String(r.recipientCount), render: (r) => `<span class="cell-muted">${r.recipientCount}</span>` },
        { key: "sentCount", label: "Sent", type: "text", get: (r) => String(r.sentCount), render: (r) => `<span class="cell-muted">${r.sentCount}</span>` },
        { key: "failCount", label: "Failed", type: "text", get: (r) => String(r.failCount), render: (r) => `<span class="${r.failCount ? "pill failed" : "cell-muted"}">${r.failCount}</span>` },
        { key: "user", label: "Sent by", type: "text", get: (r) => r.createdByName || "", render: (r) => `<span class="cell-muted">${esc(r.createdByName || "—")}</span>` },
      ];
      host.appendChild(tableHost);
      App.table.mount({
        container: tableHost, columns, rows,
        defaultSort: "createdAt", defaultSortDir: "desc",
        onRowClick: (r) => openSendDetail(r),
        emptyHtml: `<div class="card cell-muted" style="padding:18px">No emails sent yet.</div>`,
        pageSize: 50,
      });
    }).catch((e) => { host.innerHTML = `<div class="cell-muted" style="padding:8px">${esc(e.message)}</div>`; });
  }

  // Read-only detail for one past send.
  function openSendDetail(r) {
    const { el, esc, fmtDate } = App.util;
    const overlay = el("div", "modal-overlay");
    const modal = el("div", "modal");
    modal.innerHTML = `<div class="modal-head"><h2>${esc(r.subject || "(no subject)")}</h2><button class="icon-btn" id="sd-close">&times;</button></div>`;
    const body = el("div", "modal-body");
    const meta = el("div", "cell-muted");
    meta.style.marginBottom = "10px";
    meta.innerHTML = `Sent ${esc(fmtDate(r.createdAt))} by ${esc(r.createdByName || "—")} · ${r.recipientCount} recipient${r.recipientCount === 1 ? "" : "s"} · ${r.sentCount} sent${r.failCount ? ` · ${r.failCount} failed` : ""}`;
    body.appendChild(meta);
    const bodyBox = el("div", "card");
    bodyBox.style.cssText = "padding:14px;max-height:50vh;overflow:auto";
    bodyBox.innerHTML = r.body && r.body.trim() ? r.body : `<span class="cell-muted">(no message body)</span>`;
    body.appendChild(bodyBox);
    const foot = el("div", "modal-foot");
    const close = el("button", "btn btn-ghost btn-sm", "Close");
    foot.appendChild(close);
    modal.appendChild(body); modal.appendChild(foot); overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const dismiss = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
    modal.querySelector("#sd-close").onclick = dismiss;
    close.onclick = dismiss;
  }

  // Deep-link entry point used by the Contacts "Email selected" bulk action: preload
  // the chosen contact ids as the audience and open Communication → Email → Compose.
  let pendingPreload = null;
  function composeTo(ids) {
    pendingPreload = Array.isArray(ids) ? ids.slice() : [];
    App.go("#/communication");
  }

  App.communication = { render: renderCommunication, composeTo };
})(typeof window !== "undefined" ? window : globalThis);
