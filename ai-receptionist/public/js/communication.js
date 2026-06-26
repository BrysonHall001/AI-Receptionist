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
    const { el, esc, toast } = App.util;
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

  function emailTab(host) {
    const { el, esc, toast } = App.util;
    host.innerHTML = "";
    const card = el("div", "card");
    card.style.cssText = "padding:18px";
    card.appendChild(el("h3", "settings-sub", "New email"));
    card.appendChild(el("div", "cell-muted", "Write your message, choose who it goes to, and send. Only people with an email address receive it."));

    // Subject + body — REUSE the rich-text composer (same kind:"email" contract the
    // Contacts bulk email uses: it provides the Subject field + the Quill body).
    const composerHost = el("div");
    composerHost.style.marginTop = "12px";
    card.appendChild(composerHost);
    const composer = App.compose.mount(composerHost, { kind: "email" });

    // Audience
    card.appendChild(el("div", "field-label", "Audience"));
    const audienceHost = el("div");
    card.appendChild(audienceHost);
    const audience = App.audiencePicker.mount(audienceHost, {});

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

  App.communication = { render: renderCommunication };
})(typeof window !== "undefined" ? window : globalThis);
