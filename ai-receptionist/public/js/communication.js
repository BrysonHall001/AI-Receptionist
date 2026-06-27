(function (global) {
  const App = global.App || (global.App = {});

  // ======================================================================
  // Reusable Audience Picker.
  //   App.audiencePicker.mount(host, opts) -> api
  //   opts:
  //     preloadIds       : string[]  fix the audience to these contact ids (compact).
  //     onChange         : fn()      called whenever the resolved set changes.
  //     tablePreview     : bool      show a full Contacts-style preview table (paginated)
  //                                  instead of the compact collapsible list.
  //     allowTypedEmails : bool      show a free-text field to add individual emails.
  //   api:
  //     getRecipients()    -> [{id,email,name}]  (contacts: matching − excluded, emailable)
  //     getRecipientIds()  -> string[]           (contact ids)
  //     getTypedEmails()   -> string[]           (valid typed emails, deduped vs contacts)
  //     getCounts()        -> { match, emailable, recipients, typed, total }
  //
  // REUSES: App.portal.contactColumnDefs (columns), App.table.ruleEditor (criteria),
  // App.table.pipeline (live match), App.table.mount (the preview table). Nothing rebuilt.
  // ======================================================================
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const useTable = !!opts.tablePreview && !state.preload;
    const useTyped = !!opts.allowTypedEmails && !state.preload;

    // Count line — lives at the TOP of the panel (right under the heading/description).
    const summary = el("div", "audience-summary cell-muted");
    summary.style.cssText = "font-size:13px;margin:0 0 12px";

    // Typed-emails field.
    let typedInput = null;
    const typedWrap = el("div", "field");
    if (useTyped) {
      typedWrap.style.cssText = "margin:0 0 14px";
      typedWrap.innerHTML = `<span class="field-label">Add individual email addresses</span>`;
      typedInput = el("textarea", "input"); typedInput.rows = 2; typedInput.placeholder = "name@example.com, another@example.com";
      typedWrap.appendChild(typedInput);
    }
    const typedNote = el("div", "cell-muted"); typedNote.style.cssText = "font-size:12px;margin-top:4px";

    // Compact preview (used when tablePreview is off).
    const previewToggle = el("button", "btn btn-ghost btn-sm");
    const previewBox = el("div", "audience-preview");
    previewBox.style.cssText = "display:none;margin-top:8px;border:1px solid var(--line);border-radius:8px;max-height:260px;overflow:auto";
    let previewOpen = false;
    // Full table preview (used when tablePreview is on).
    const tableHost = el("div"); tableHost.style.cssText = "margin-top:10px";

    function matched() {
      if (!state.ready) return [];
      if (state.preload) return state.contacts.filter((c) => state.preload.has(c.id));
      return App.table.pipeline(state.contacts, state.columns, { rules: state.rules });
    }
    function emailable(rows) { return rows.filter((c) => c.email && String(c.email).trim()); }
    function recipients() { return emailable(matched()).filter((c) => !state.excluded.has(c.id)); }

    function parseTyped() {
      if (!typedInput) return { valid: [], invalid: [] };
      const tokens = (typedInput.value || "").split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
      const valid = [], invalid = [], seen = new Set();
      tokens.forEach((t) => { const lo = t.toLowerCase(); if (EMAIL_RE.test(t)) { if (!seen.has(lo)) { seen.add(lo); valid.push(t); } } else invalid.push(t); });
      return { valid, invalid };
    }
    // Valid typed emails, de-duplicated against the contact-resolved recipients (so a
    // typed address that also matches the criteria isn't emailed twice).
    function typedEmails() {
      const { valid } = parseTyped();
      const contactEmails = new Set(recipients().map((c) => String(c.email || "").toLowerCase()));
      const out = [], seen = new Set();
      valid.forEach((e) => { const lo = e.toLowerCase(); if (!contactEmails.has(lo) && !seen.has(lo)) { seen.add(lo); out.push(e); } });
      return out;
    }

    function counts() {
      const m = matched();
      const e = emailable(m);
      const r = e.filter((c) => !state.excluded.has(c.id));
      const typed = typedEmails().length;
      return { match: m.length, emailable: e.length, recipients: r.length, typed, total: r.length + typed };
    }

    function renderSummary() {
      const c = counts();
      const noun = (n) => `${n} ${App.label ? App.label("contact", n === 1 ? "one" : "many").toLowerCase() : (n === 1 ? "contact" : "contacts")}`;
      let txt = `${noun(c.match)} match · ${c.emailable} have an email`;
      if (c.typed) txt += ` · ${c.typed} typed`;
      txt += ` · ${c.total} recipient${c.total === 1 ? "" : "s"}`;
      summary.textContent = txt;
      previewToggle.textContent = `${c.recipients} from criteria ${previewOpen ? "▴" : "▾"}`;
      if (useTable) renderTablePreview();
      else if (previewOpen) renderPreview();
      if (typedInput) {
        const inv = parseTyped().invalid;
        typedNote.textContent = inv.length ? `Ignoring ${inv.length} invalid address${inv.length === 1 ? "" : "es"}: ${inv.slice(0, 3).join(", ")}${inv.length > 3 ? "…" : ""}` : "";
        typedNote.style.color = inv.length ? "var(--danger, #c0392b)" : "";
      }
      if (opts.onChange) opts.onChange();
    }

    function previewColumns() {
      const cols = state.columns.slice();
      cols.push({
        key: "__rm", label: "", type: "text", get: () => "",
        render: (c) => `<button class="btn btn-ghost btn-sm aud-rm" data-id="${esc(c.id)}">Remove</button>`,
      });
      return cols;
    }

    function renderTablePreview() {
      tableHost.innerHTML = "";
      const rows = recipients();
      App.table.mount({
        container: tableHost, columns: previewColumns(), rows,
        defaultSort: "name", defaultSortDir: "asc", pageSize: 10,
        emptyHtml: `<div class="card cell-muted" style="padding:14px">No emailable contacts match yet.</div>`,
      });
      if (state.excluded.size) {
        const restore = el("div"); restore.style.cssText = "padding:8px 2px";
        const b = el("button", "btn btn-ghost btn-sm", `Restore ${state.excluded.size} removed`);
        b.onclick = () => { state.excluded.clear(); renderSummary(); };
        restore.appendChild(b); tableHost.appendChild(restore);
      }
    }
    // Exclude via the table's Remove buttons (delegated).
    tableHost.addEventListener("click", (e) => {
      const rm = e.target.closest && e.target.closest(".aud-rm");
      if (!rm) return;
      e.stopPropagation();
      state.excluded.add(rm.dataset.id);
      renderSummary();
    });

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
        rm.onclick = () => { state.excluded.add(c.id); renderSummary(); };
        row.appendChild(who); row.appendChild(rm);
        previewBox.appendChild(row);
      });
      if (state.excluded.size) {
        const restore = el("div"); restore.style.cssText = "padding:8px 10px";
        const b = el("button", "btn btn-ghost btn-sm", `Restore ${state.excluded.size} removed`);
        b.onclick = () => { state.excluded.clear(); renderSummary(); };
        restore.appendChild(b); previewBox.appendChild(restore);
      }
    }

    previewToggle.onclick = () => { previewOpen = !previewOpen; previewBox.style.display = previewOpen ? "" : "none"; renderSummary(); };

    let rulesHost = null;
    function mountRules() {
      if (!rulesHost) return;
      rulesHost.innerHTML = "";
      rulesHost.appendChild(App.table.ruleEditor(state.columns, state.contacts, state.rules, () => { state.excluded.clear(); renderSummary(); }));
    }

    async function build() {
      const [contacts, fields, saved] = await Promise.all([
        App.portalApi("/api/contacts").catch(() => []),
        App.portalApi("/api/fields").catch(() => []),
        state.preload ? Promise.resolve([]) : App.portalApi("/api/saved-filters?view=contacts").catch(() => []),
      ]);
      state.contacts = Array.isArray(contacts) ? contacts : [];
      state.columns = App.portal.contactColumnDefs(fields || []);
      state.ready = true;

      // Count line first — sits directly under the panel heading/description.
      host.appendChild(summary);

      // Typed emails next (top of the panel, above criteria/table).
      if (useTyped) {
        typedInput.addEventListener("input", renderSummary);
        host.appendChild(typedWrap);
        host.appendChild(typedNote);
      }

      if (!state.preload) {
        if ((saved || []).length) {
          const sfWrap = el("label", "field"); sfWrap.style.marginTop = "4px";
          sfWrap.innerHTML = `<span class="field-label">Start from a saved filter (optional)</span>`;
          const sel = el("select", "input");
          sel.innerHTML = `<option value="">— none —</option>` + (saved || []).map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("");
          sel.onchange = () => {
            const f = (saved || []).find((x) => x.id === sel.value);
            const def = (f && f.definition) || {};
            state.rules.length = 0;
            (Array.isArray(def.rules) ? def.rules : []).forEach((r) => state.rules.push(r));
            state.excluded.clear(); mountRules(); renderSummary();
          };
          sfWrap.appendChild(sel); host.appendChild(sfWrap);
        }
        host.appendChild(el("div", "field-label", "Who to include (criteria)"));
        rulesHost = el("div"); host.appendChild(rulesHost); mountRules();
      } else {
        host.appendChild(el("div", "cell-muted", "Sending to the contacts you selected."));
      }

      if (useTable) {
        host.appendChild(tableHost);
      } else {
        host.appendChild(previewToggle); host.appendChild(previewBox);
      }
      renderSummary();
    }

    build().catch((e) => { host.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; });

    return {
      getRecipients: () => recipients().map((c) => ({ id: c.id, email: c.email, name: c.name || null })),
      getRecipientIds: () => recipients().map((c) => c.id),
      getTypedEmails: () => typedEmails(),
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
    const TABS = [["email", "Email"], ["templates", "Templates"], ["surveys", "Surveys"]]; // future: ["texts","Texts"]
    let active = "email";
    function setTab(key) {
      active = key;
      App.util.$$(".tab", tabsBar).forEach((t) => t.classList.toggle("active", t.dataset.tab === key));
      tabBody.innerHTML = "";
      if (key === "email") emailTab(tabBody);
      else if (key === "templates") templatesTab(tabBody);
      else if (key === "surveys") surveysTab(tabBody);
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
    const hasPreload = !!(preloadIds && preloadIds.length);

    // --- Panel 1: New email (subject + body) ---
    const card = el("div", "card");
    card.style.cssText = "padding:22px";
    card.appendChild(el("h3", "settings-sub", "New email"));
    card.appendChild(el("div", "cell-muted", "Write the subject and message your recipients will see.")).style.margin = "2px 0 14px";
    const composerHost = el("div");
    card.appendChild(composerHost);
    const composer = App.compose.mount(composerHost, { kind: "email" });
    host.appendChild(card);

    // --- Panel 2: Audience (its own well-spaced panel) ---
    const audCard = el("div", "card");
    audCard.style.cssText = "padding:22px;margin-top:16px";
    audCard.appendChild(el("h3", "settings-sub", "Audience"));
    const audIntro = hasPreload
      ? `Sending to the ${preloadIds.length} ${App.label("contact", preloadIds.length === 1 ? "one" : "many").toLowerCase()} you selected — add more addresses or remove people below.`
      : "Choose who receives this email — type individual addresses, build criteria, or both. Only people with an email address are sent to.";
    audCard.appendChild(el("div", "cell-muted", audIntro)).style.margin = "2px 0 14px";
    const audienceHost = el("div");
    audCard.appendChild(audienceHost);
    const audience = App.audiencePicker.mount(audienceHost, hasPreload ? { preloadIds } : { tablePreview: true, allowTypedEmails: true });

    const actions = el("div");
    actions.style.cssText = "margin-top:18px";
    const sendBtn = el("button", "btn btn-primary", "Send email");
    actions.appendChild(sendBtn);
    audCard.appendChild(actions);
    host.appendChild(audCard);

    sendBtn.onclick = async () => {
      const subject = composer.getSubject();
      if (!subject || !subject.trim()) { toast("Add a subject.", true); return; }
      const recipientIds = audience.getRecipientIds();
      const typedEmails = audience.getTypedEmails ? audience.getTypedEmails() : [];
      const total = recipientIds.length + typedEmails.length;
      if (!total) { toast("No recipients — add an email address or criteria.", true); return; }

      const ok = await App.ui.confirmModal({
        title: "Send this email?",
        message: `You're about to email ${total} ${total === 1 ? "person" : "people"}${typedEmails.length ? ` (${recipientIds.length} from criteria + ${typedEmails.length} typed)` : ""}. Send?`,
        confirmText: "Send",
      });
      if (!ok) return;

      sendBtn.disabled = true; sendBtn.textContent = "Sending…";
      try {
        const res = await App.portalApi("/api/communication/email", {
          method: "POST",
          body: JSON.stringify({ subject: subject.trim(), html: composer.getHTML(), contactIds: recipientIds, extraEmails: typedEmails }),
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

  // The Templates tab — manage the SAME EmailTemplate library the composer's
  // start-from / save-as-template actions use (one shared store, via templateService).
  function templatesTab(host) {
    const { el, esc, fmtDate, toast } = App.util;
    host.innerHTML = "";
    let rows = [];
    const state = { id: null };

    // ----- create / edit form ON TOP (reuses the rich-text composer for the body) -----
    const card = el("div", "card");
    card.style.cssText = "padding:18px";
    const headRow = el("div"); headRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px";
    const heading = el("h3", "settings-sub", "New template"); heading.style.margin = "0";
    const newBtn = el("button", "btn btn-ghost btn-sm", "New template"); newBtn.style.display = "none";
    headRow.appendChild(heading); headRow.appendChild(newBtn);
    card.appendChild(headRow);

    const nameRow = el("div"); nameRow.style.cssText = "display:flex;gap:12px;flex-wrap:wrap";
    const nameWrap = el("label", "field"); nameWrap.style.cssText = "flex:1;min-width:200px;margin:0";
    nameWrap.innerHTML = `<span class="field-label">Template name</span>`;
    const nameInput = el("input", "input"); nameInput.type = "text"; nameInput.placeholder = "e.g. Monthly newsletter";
    nameWrap.appendChild(nameInput);
    const tagWrap = el("label", "field"); tagWrap.style.cssText = "flex:1;min-width:200px;margin:0";
    tagWrap.innerHTML = `<span class="field-label">Tag (optional)</span>`;
    const tagInput = el("input", "input"); tagInput.type = "text"; tagInput.placeholder = "e.g. Newsletters";
    tagWrap.appendChild(tagInput);
    nameRow.appendChild(nameWrap); nameRow.appendChild(tagWrap); card.appendChild(nameRow);

    const subjWrap = el("label", "field"); subjWrap.style.marginTop = "10px";
    subjWrap.innerHTML = `<span class="field-label">Subject</span>`;
    const subjInput = el("input", "input"); subjInput.type = "text"; subjInput.placeholder = "Email subject";
    subjWrap.appendChild(subjInput); card.appendChild(subjWrap);

    const bodyWrap = el("div", "field"); bodyWrap.style.marginTop = "10px";
    bodyWrap.appendChild(el("span", "field-label", "Body"));
    const bodyHost = el("div"); bodyWrap.appendChild(bodyHost);
    card.appendChild(bodyWrap);
    const bodyApi = App.compose.mount(bodyHost, { kind: "richtext" });

    const actions = el("div"); actions.style.cssText = "margin-top:14px";
    const saveBtn = el("button", "btn btn-primary", "Save template");
    actions.appendChild(saveBtn); card.appendChild(actions);
    host.appendChild(card);

    // ----- Template Library (list) BELOW the create panel -----
    const libCard = el("div", "card"); libCard.style.cssText = "margin-top:16px;padding:18px";
    const libHead = el("h3", "settings-sub", "Template Library"); libHead.style.margin = "0 0 4px";
    libCard.appendChild(libHead);
    const libNote = el("div", "cell-muted", "Every email template in this portal. Filter or search — including by tag — to find one.");
    libNote.style.cssText = "font-size:13px;margin-bottom:10px"; libCard.appendChild(libNote);
    const listHost = el("div"); libCard.appendChild(listHost);
    host.appendChild(libCard);

    function setEdit(t) {
      state.id = t ? t.id : null;
      heading.textContent = t ? "Edit template" : "New template";
      newBtn.style.display = t ? "" : "none";
      nameInput.value = t ? (t.name || "") : "";
      tagInput.value = t ? (t.tag || "") : "";
      subjInput.value = t ? (t.subject || "") : "";
      bodyApi.setBody(t ? (t.body || "") : "");
    }
    newBtn.onclick = () => setEdit(null);

    saveBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { toast("Give the template a name.", true); return; }
      const payload = { name, subject: subjInput.value, body: bodyApi.getHTML(), tag: tagInput.value.trim() || null };
      saveBtn.disabled = true; saveBtn.textContent = "Saving…";
      try {
        if (state.id) await App.portalApi("/api/templates/" + encodeURIComponent(state.id), { method: "PATCH", body: JSON.stringify(payload) });
        else await App.portalApi("/api/templates", { method: "POST", body: JSON.stringify(Object.assign({ kind: "email" }, payload)) });
        toast(state.id ? "Template updated." : "Template created.");
        setEdit(null);
        await load();
      } catch (e) { toast(e.message, true); }
      finally { saveBtn.disabled = false; saveBtn.textContent = "Save template"; }
    };

    // ----- list -----
    listHost.addEventListener("click", async (e) => {
      const ed = e.target.closest ? e.target.closest(".tpl-edit") : null;
      const dl = e.target.closest ? e.target.closest(".tpl-del") : null;
      if (ed) { e.stopPropagation(); const t = rows.find((r) => r.id === ed.dataset.id); if (t) { setEdit(t); card.scrollIntoView({ behavior: "smooth", block: "start" }); } return; }
      if (dl) {
        e.stopPropagation();
        const t = rows.find((r) => r.id === dl.dataset.id);
        if (!(await App.ui.confirmModal({ title: "Delete template", message: `Delete this template${t ? ` “${t.name}”` : ""}?`, confirmText: "Delete template" }))) return;
        try { await App.portalApi("/api/templates/" + encodeURIComponent(dl.dataset.id), { method: "DELETE" }); toast("Template deleted."); if (state.id === dl.dataset.id) setEdit(null); await load(); }
        catch (err) { toast(err.message, true); }
      }
    });

    async function load() {
      listHost.innerHTML = `<div class="cell-muted" style="padding:8px">Loading…</div>`;
      try { rows = await App.portalApi("/api/templates?kind=email"); } catch (e) { listHost.innerHTML = `<div class="cell-muted" style="padding:8px">${esc(e.message)}</div>`; return; }
      rows = Array.isArray(rows) ? rows : [];
      listHost.innerHTML = "";
      const columns = [
        { key: "name", label: "Name", type: "text", get: (r) => r.name, render: (r) => `<span class="cell-strong">${esc(r.name || "—")}</span>` },
        { key: "subject", label: "Subject", type: "text", get: (r) => r.subject || "", render: (r) => `<span class="cell-muted">${esc(r.subject || "—")}</span>` },
        { key: "tag", label: "Tag", type: "text", get: (r) => r.tag || "", text: (r) => r.tag || "", render: (r) => r.tag ? `<span class="pill">${esc(r.tag)}</span>` : `<span class="cell-muted">—</span>` },
        { key: "updatedAt", label: "Last updated", type: "date", get: (r) => r.updatedAt, text: (r) => (r.updatedAt ? fmtDate(r.updatedAt) : ""), render: (r) => `<span class="cell-muted">${r.updatedAt ? fmtDate(r.updatedAt) : "—"}</span>` },
        { key: "by", label: "Updated by", type: "text", get: (r) => r.createdByName || "", render: (r) => `<span class="cell-muted">${esc(r.createdByName || "—")}</span>` },
        { key: "actions", label: "", type: "text", get: () => "", render: (r) => `<button class="btn btn-ghost btn-sm tpl-edit" data-id="${esc(r.id)}">Edit</button> <button class="btn btn-ghost btn-sm tpl-del" data-id="${esc(r.id)}">Delete</button>` },
      ];
      App.table.mount({
        container: listHost, columns, rows,
        defaultSort: "name", defaultSortDir: "asc",
        emptyHtml: `<div class="card cell-muted" style="padding:18px">No templates yet — create one below or save one from a draft in the Email tab.</div>`,
        pageSize: 50,
      });
    }

    load();
  }

  // ======================================================================
  // Surveys tab — builder (model + question types + field mapping). No public
  // response page / sending in this batch.
  // ======================================================================
  // Mirror of src/services/surveyBlastService.SURVEY_LINK_TOKEN.
  const SURVEY_LINK_TOKEN = "{{survey_link}}";
  const Q_TYPES = [
    ["short_text", "Short text"], ["long_text", "Long text"],
    ["single_select", "Single choice"], ["multi_select", "Multiple choice"],
    ["rating", "Rating"], ["nps", "NPS (0–10)"], ["yes_no", "Yes / No"], ["date", "Date"],
  ];
  // Mirror of src/services/surveyTypes.MAP_COMPAT (question type -> mappable field types).
  const MAP_COMPAT = {
    short_text: ["text", "textarea", "phone", "url", "email"],
    long_text: ["textarea", "text"],
    single_select: ["single_select", "text", "textarea"],
    multi_select: ["multi_select", "text"],
    rating: ["number", "percent", "text"],
    nps: ["number", "text"],
    yes_no: ["checkbox", "text"],
    date: ["date"],
  };

  function surveysTab(host) {
    const { el, esc, fmtDate, toast } = App.util;
    host.innerHTML = "";
    let surveys = [];
    let mapFields = { contact: [], job: [], booking: [] };
    let mapTypes = [["contact", "Contact"]];
    let lidSeq = 1;
    const state = { id: null, qs: [] };

    const listHost = el("div");

    // ---- builder card (ON TOP) ----
    const card = el("div", "card");
    card.style.cssText = "padding:18px";
    const headRow = el("div"); headRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px";
    const heading = el("h3", "settings-sub", "New survey"); heading.style.margin = "0";
    const newBtn = el("button", "btn btn-ghost btn-sm", "New survey"); newBtn.style.display = "none";
    headRow.appendChild(heading); headRow.appendChild(newBtn);
    card.appendChild(headRow);

    const top = el("div"); top.style.cssText = "display:grid;gap:12px;grid-template-columns:1fr 160px;align-items:end";
    const nameWrap = el("label", "field"); nameWrap.innerHTML = `<span class="field-label">Survey name</span>`;
    const nameInput = el("input", "input"); nameInput.type = "text"; nameInput.placeholder = "e.g. Post-visit feedback"; nameWrap.appendChild(nameInput);
    const statusWrap = el("label", "field"); statusWrap.innerHTML = `<span class="field-label">Status</span>`;
    const statusSel = el("select", "input"); statusSel.innerHTML = `<option value="draft">Draft</option><option value="active">Active</option><option value="closed">Closed</option>`; statusWrap.appendChild(statusSel);
    top.appendChild(nameWrap); top.appendChild(statusWrap); card.appendChild(top);

    const descWrap = el("label", "field"); descWrap.style.marginTop = "10px"; descWrap.innerHTML = `<span class="field-label">Description (optional)</span>`;
    const descInput = el("input", "input"); descInput.type = "text"; descInput.placeholder = "Shown to recipients on the survey"; descWrap.appendChild(descInput);
    card.appendChild(descWrap);

    // Start from an existing survey (prefill only — saving still creates a NEW row).
    const startWrap = el("label", "field"); startWrap.style.marginTop = "10px";
    startWrap.innerHTML = `<span class="field-label">Start from an existing survey (optional)</span>`;
    const startSel = el("select", "input"); startSel.innerHTML = `<option value="">— blank —</option>`;
    startWrap.appendChild(startSel); card.appendChild(startWrap);

    card.appendChild(el("div", "field-label", "Questions")).style.marginTop = "14px";
    // Shown when any question is mapped: mapping only writes for per-recipient email sends.
    const mapWarn = el("div", "audience-summary cell-muted");
    mapWarn.style.cssText = "display:none;font-size:12.5px;margin:0 0 8px;padding:8px 10px;border:1px solid var(--line);border-radius:8px";
    card.appendChild(mapWarn);
    const qListHost = el("div"); qListHost.style.cssText = "display:flex;flex-direction:column;gap:10px"; card.appendChild(qListHost);
    const addBtn = el("button", "btn btn-ghost btn-sm", "+ Add question"); addBtn.style.marginTop = "10px"; card.appendChild(addBtn);

    const saveRow = el("div"); saveRow.style.cssText = "margin-top:16px";
    const saveBtn = el("button", "btn btn-primary", "Save survey"); saveRow.appendChild(saveBtn); card.appendChild(saveRow);

    // Share + responses (shown when editing an existing survey).
    const shareWrap = el("div"); shareWrap.style.cssText = "margin-top:18px;display:none";
    shareWrap.appendChild(el("div", "field-label", "Share")).style.marginTop = "0";
    const shareNote = el("div", "cell-muted"); shareNote.style.cssText = "font-size:13px;margin-bottom:6px"; shareWrap.appendChild(shareNote);
    const linkRow = el("div"); linkRow.style.cssText = "display:flex;gap:8px;align-items:center";
    const linkInput = el("input", "input"); linkInput.type = "text"; linkInput.readOnly = true; linkInput.style.flex = "1";
    const copyBtn = el("button", "btn btn-ghost btn-sm", "Copy");
    copyBtn.onclick = () => { linkInput.select(); try { document.execCommand("copy"); App.util.toast("Link copied."); } catch (e) { /* noop */ } };
    linkRow.appendChild(linkInput); linkRow.appendChild(copyBtn); shareWrap.appendChild(linkRow);
    const sendRowWrap = el("div"); sendRowWrap.style.cssText = "margin-top:10px";
    const sendSurveyBtn = el("button", "btn btn-primary btn-sm", "Send survey");
    const activateHint = el("span", "cell-muted"); activateHint.style.cssText = "font-size:13px";
    sendRowWrap.appendChild(sendSurveyBtn); sendRowWrap.appendChild(activateHint);
    shareWrap.appendChild(sendRowWrap);
    const respHead = el("div", "field-label", "Responses"); respHead.style.marginTop = "16px"; shareWrap.appendChild(respHead);
    const responsesHost = el("div"); shareWrap.appendChild(responsesHost);
    card.appendChild(shareWrap);

    host.appendChild(card);

    // Build / Results switch (shown when a saved survey is open).
    const viewToggle = el("div", "tabs"); viewToggle.style.cssText = "margin-top:14px;display:none";
    const resultsCard = el("div", "card"); resultsCard.style.cssText = "margin-top:14px;padding:18px;display:none";
    function setView(v) {
      App.util.$$(".tab", viewToggle).forEach((t) => t.classList.toggle("active", t.dataset.v === v));
      card.style.display = v === "build" ? "" : "none";
      resultsCard.style.display = v === "results" ? "" : "none";
      if (v === "results" && state.survey) renderResults(resultsCard, state.survey);
    }
    [["build", "Build"], ["results", "Results"]].forEach(([v, label]) => {
      const t = el("button", "tab" + (v === "build" ? " active" : ""), label); t.dataset.v = v; t.onclick = () => setView(v); viewToggle.appendChild(t);
    });
    host.insertBefore(viewToggle, card);
    host.appendChild(resultsCard);

    // ---- Surveys Library (list) BELOW the builder ----
    const libCard = el("div", "card"); libCard.style.cssText = "margin-top:16px;padding:18px";
    const libHead = el("h3", "settings-sub", "Surveys Library"); libHead.style.margin = "0 0 4px";
    libCard.appendChild(libHead);
    const libNote = el("div", "cell-muted", "Every survey in this portal. Duplicate one to start from it, or open it to edit, view results, or send.");
    libNote.style.cssText = "font-size:13px;margin-bottom:10px"; libCard.appendChild(libNote);
    libCard.appendChild(listHost);
    host.appendChild(libCard);

    function blankQuestion() { return { lid: lidSeq++, type: "short_text", label: "", helpText: "", required: false, config: {}, mapFieldKey: null, mapRecordType: null }; }
    function defaultConfigFor(type, prev) {
      if (type === "single_select" || type === "multi_select") return { options: (prev && Array.isArray(prev.options) && prev.options.length) ? prev.options.slice() : ["Option 1", "Option 2"] };
      if (type === "rating") return { min: (prev && prev.min) || 1, max: (prev && prev.max) || 5, step: (prev && prev.step) || 1 };
      return {};
    }
    function compatFieldsFor(type, rt) { const allow = MAP_COMPAT[type] || []; return (mapFields[rt] || []).filter((f) => allow.includes(f.type)); }
    function anyMapped() { return state.qs.some((q) => q.mapFieldKey); }

    function paintQuestions() {
      qListHost.innerHTML = "";
      if (mapWarn) {
        if (anyMapped()) { mapWarn.style.display = ""; mapWarn.textContent = "This survey maps answers to fields. Mapped answers are written only when you send it as an email blast (each recipient gets a personal link). An anonymous/public link still collects answers but won't write them to any record."; }
        else mapWarn.style.display = "none";
      }
      if (!state.qs.length) { qListHost.appendChild(el("div", "cell-muted", "No questions yet — add one below.")); return; }
      state.qs.forEach((q, idx) => {
        const row = el("div", "card"); row.style.cssText = "padding:12px;background:var(--panel-2)"; row.draggable = true; row.dataset.lid = String(q.lid);
        row.addEventListener("dragstart", (e) => { row.classList.add("dragging"); e.dataTransfer.setData("text/plain", String(q.lid)); });
        row.addEventListener("dragend", () => row.classList.remove("dragging"));
        row.addEventListener("dragover", (e) => e.preventDefault());
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer.getData("text/plain")); const to = q.lid;
          if (from === to) return;
          const fromIdx = state.qs.findIndex((x) => x.lid === from);
          const moved = state.qs.splice(fromIdx, 1)[0];
          const toIdx = state.qs.findIndex((x) => x.lid === to);
          state.qs.splice(toIdx, 0, moved);
          paintQuestions();
        });

        const hdr = el("div"); hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px";
        const left = el("div"); left.style.cssText = "display:flex;align-items:center;gap:8px";
        left.appendChild(el("span", "mc-drag", "⠿"));
        left.appendChild(el("span", "cell-strong", `Question ${idx + 1}`));
        const rm = el("button", "btn btn-ghost btn-sm", "Remove");
        rm.onclick = () => { state.qs = state.qs.filter((x) => x.lid !== q.lid); paintQuestions(); };
        hdr.appendChild(left); hdr.appendChild(rm); row.appendChild(hdr);

        const grid = el("div"); grid.style.cssText = "display:grid;gap:10px;grid-template-columns:200px 1fr";
        // type
        const typeWrap = el("label", "field"); typeWrap.innerHTML = `<span class="field-label">Type</span>`;
        const typeSel = el("select", "input");
        Q_TYPES.forEach(([v, lab]) => { const o = el("option", null, lab); o.value = v; if (v === q.type) o.selected = true; typeSel.appendChild(o); });
        typeSel.onchange = () => { q.type = typeSel.value; q.config = defaultConfigFor(q.type, q.config); if (q.mapFieldKey && !compatFieldsFor(q.type, q.mapRecordType || "contact").some((f) => f.key === q.mapFieldKey)) { q.mapFieldKey = null; q.mapRecordType = null; } paintQuestions(); };
        typeWrap.appendChild(typeSel);
        // label
        const labWrap = el("label", "field"); labWrap.innerHTML = `<span class="field-label">Question label</span>`;
        const labInput = el("input", "input"); labInput.type = "text"; labInput.value = q.label || ""; labInput.placeholder = "What would you like to ask?";
        labInput.oninput = () => { q.label = labInput.value; };
        labWrap.appendChild(labInput);
        grid.appendChild(typeWrap); grid.appendChild(labWrap);
        row.appendChild(grid);

        // help + required
        const hr = el("div"); hr.style.cssText = "display:grid;gap:10px;grid-template-columns:1fr 140px;align-items:end;margin-top:8px";
        const helpWrap = el("label", "field"); helpWrap.innerHTML = `<span class="field-label">Help text (optional)</span>`;
        const helpInput = el("input", "input"); helpInput.type = "text"; helpInput.value = q.helpText || ""; helpInput.oninput = () => { q.helpText = helpInput.value; };
        helpWrap.appendChild(helpInput);
        const reqWrap = el("label", "ex-field"); reqWrap.style.cssText = "display:flex;align-items:center;gap:7px";
        const reqCb = el("input"); reqCb.type = "checkbox"; reqCb.checked = !!q.required; reqCb.onchange = () => { q.required = reqCb.checked; };
        reqWrap.appendChild(reqCb); reqWrap.appendChild(el("span", null, "Required"));
        hr.appendChild(helpWrap); hr.appendChild(reqWrap); row.appendChild(hr);

        // type-specific config
        if (q.type === "single_select" || q.type === "multi_select") {
          row.appendChild(optionsEditor(q));
        } else if (q.type === "rating") {
          const rg = el("div"); rg.style.cssText = "display:grid;gap:10px;grid-template-columns:repeat(3,1fr);margin-top:8px";
          ["min", "max", "step"].forEach((k) => {
            const w = el("label", "field"); w.innerHTML = `<span class="field-label">${k[0].toUpperCase() + k.slice(1)}</span>`;
            const inp = el("input", "input"); inp.type = "number"; inp.value = (q.config && q.config[k] != null) ? q.config[k] : (k === "min" ? 1 : k === "max" ? 5 : 1);
            inp.onchange = () => { q.config = q.config || {}; q.config[k] = Number(inp.value); };
            w.appendChild(inp); rg.appendChild(w);
          });
          row.appendChild(rg);
        } else if (q.type === "nps") {
          row.appendChild(el("div", "cell-muted", "Scored 0–10 (Net Promoter Score).")).style.marginTop = "8px";
        } else if (q.type === "yes_no") {
          row.appendChild(el("div", "cell-muted", "Answer is Yes or No.")).style.marginTop = "8px";
        }

        // field mapping — granular: record type + field, grouped so it's unambiguous.
        const mapWrap = el("div", "field"); mapWrap.style.marginTop = "8px";
        mapWrap.appendChild(el("span", "field-label", "Saves answer to"));
        const mapRow = el("div"); mapRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
        const rtSel = el("select", "input"); rtSel.style.cssText = "flex:0 0 150px";
        const noMap = el("option", null, "— don't map —"); noMap.value = ""; rtSel.appendChild(noMap);
        mapTypes.forEach(([key, label]) => { const o = el("option", null, label); o.value = key; if ((q.mapFieldKey ? (q.mapRecordType || "contact") : "") === key) o.selected = true; rtSel.appendChild(o); });
        const fieldSel = el("select", "input"); fieldSel.style.cssText = "flex:1;min-width:160px";
        function paintFieldSel() {
          const rt = rtSel.value;
          fieldSel.innerHTML = "";
          if (!rt) { const o = el("option", null, "Collect only (not saved to a field)"); o.value = ""; fieldSel.appendChild(o); fieldSel.disabled = true; return; }
          fieldSel.disabled = false;
          const none2 = el("option", null, "— choose a field —"); none2.value = ""; fieldSel.appendChild(none2);
          const compat = compatFieldsFor(q.type, rt);
          compat.forEach((f) => { const o = el("option", null, `${f.label} (${f.type})`); o.value = f.key; if (q.mapFieldKey === f.key && (q.mapRecordType || "contact") === rt) o.selected = true; fieldSel.appendChild(o); });
          if (!compat.length) { const o = el("option", null, "No compatible fields"); o.value = ""; o.disabled = true; fieldSel.appendChild(o); }
        }
        paintFieldSel();
        rtSel.onchange = () => { q.mapRecordType = rtSel.value || null; q.mapFieldKey = null; paintFieldSel(); paintQuestions(); };
        fieldSel.onchange = () => { q.mapFieldKey = fieldSel.value || null; q.mapRecordType = fieldSel.value ? (rtSel.value || "contact") : null; paintQuestions(); };
        mapRow.appendChild(rtSel); mapRow.appendChild(fieldSel); mapWrap.appendChild(mapRow);
        if (q.mapFieldKey && (q.mapRecordType === "job" || q.mapRecordType === "booking")) {
          const jb = el("div", "cell-muted"); jb.style.cssText = "font-size:12px;margin-top:6px";
          jb.textContent = "Job/booking answers are saved with the response and will write to the record when a survey is sent from a specific job or booking (coming soon).";
          mapWrap.appendChild(jb);
        }
        row.appendChild(mapWrap);

        qListHost.appendChild(row);
      });
    }

    function optionsEditor(q) {
      q.config = q.config || {}; if (!Array.isArray(q.config.options)) q.config.options = ["Option 1", "Option 2"];
      const box = el("div"); box.style.marginTop = "8px";
      box.appendChild(el("div", "field-label", "Choices"));
      const listEl = el("div"); listEl.style.cssText = "display:flex;flex-direction:column;gap:6px"; box.appendChild(listEl);
      function repaint() {
        listEl.innerHTML = "";
        q.config.options.forEach((opt, i) => {
          const r = el("div"); r.style.cssText = "display:flex;gap:8px;align-items:center";
          const inp = el("input", "input"); inp.type = "text"; inp.value = opt; inp.oninput = () => { q.config.options[i] = inp.value; };
          const del = el("button", "btn btn-ghost btn-sm", "✕"); del.title = "Remove choice";
          del.onclick = () => { q.config.options.splice(i, 1); repaint(); };
          r.appendChild(inp); r.appendChild(del); listEl.appendChild(r);
        });
        const add = el("button", "btn btn-ghost btn-sm", "+ Add choice");
        add.onclick = () => { q.config.options.push("Option " + (q.config.options.length + 1)); repaint(); };
        listEl.appendChild(add);
      }
      repaint();
      return box;
    }

    function setEdit(survey) {
      state.id = survey ? survey.id : null;
      state.survey = survey || null;
      heading.textContent = survey ? "Edit survey" : "New survey";
      newBtn.style.display = survey ? "" : "none";
      nameInput.value = survey ? (survey.name || "") : "";
      descInput.value = survey ? (survey.description || "") : "";
      statusSel.value = (survey && survey.status) || "draft";
      state.qs = (survey && Array.isArray(survey.questions) ? survey.questions : []).map((q) => ({
        lid: lidSeq++, type: q.type, label: q.label || "", helpText: q.helpText || "", required: !!q.required,
        config: q.config && typeof q.config === "object" ? JSON.parse(JSON.stringify(q.config)) : {}, mapFieldKey: q.mapFieldKey || null, mapRecordType: q.mapRecordType || (q.mapFieldKey ? "contact" : null),
      }));
      paintQuestions();

      // Share + responses only make sense for a saved survey.
      if (survey && survey.id) {
        qLabelById = {};
        (survey.questions || []).forEach((q) => { qLabelById[q.id] = q.label; });
        shareWrap.style.display = "";
        if (survey.publicId) {
          linkInput.value = location.origin + "/survey.html?s=" + encodeURIComponent(survey.publicId);
          shareNote.textContent = survey.status === "active"
            ? "Anyone with this link can respond anonymously. Per-recipient links (which tie answers to a contact) come with the send step."
            : "This survey is " + survey.status + " — the link won't accept responses until it's Active.";
        }
        // Send is only available on an active survey (server re-checks too).
        if (survey.status === "active") {
          sendSurveyBtn.style.display = ""; activateHint.textContent = "";
          sendSurveyBtn.onclick = () => openSendFlow(survey);
        } else {
          sendSurveyBtn.style.display = "none";
          activateHint.textContent = "Set the survey to Active and save to send it to contacts.";
        }
        loadResponses(survey.id);
        viewToggle.style.display = "";
        setView("build");
      } else {
        shareWrap.style.display = "none";
        responsesHost.innerHTML = "";
        viewToggle.style.display = "none";
        resultsCard.style.display = "none";
        card.style.display = "";
      }
    }
    let qLabelById = {};
    async function loadResponses(id) {
      responsesHost.innerHTML = `<div class="cell-muted" style="padding:6px 0">Loading responses…</div>`;
      let rows;
      try { rows = await App.portalApi("/api/surveys/" + encodeURIComponent(id) + "/responses"); }
      catch (e) { responsesHost.innerHTML = `<div class="cell-muted" style="padding:6px 0">${esc(e.message)}</div>`; return; }
      rows = Array.isArray(rows) ? rows : [];
      responsesHost.innerHTML = "";
      if (!rows.length) { responsesHost.appendChild(el("div", "cell-muted", "No responses yet.")); return; }
      const fmtVal = (v) => Array.isArray(v) ? v.join(", ") : (v === true ? "Yes" : v === false ? "No" : String(v));
      const columns = [
        { key: "submittedAt", label: "When", type: "date", get: (r) => r.submittedAt, text: (r) => fmtDate(r.submittedAt), render: (r) => `<span class="cell-muted">${fmtDate(r.submittedAt)}</span>` },
        { key: "who", label: "From", type: "text", get: (r) => r.contactName, render: (r) => `<span class="${r.contactId ? "cell-strong" : "cell-muted"}">${esc(r.contactName)}</span>` },
        { key: "answers", label: "Answers", type: "text", get: () => "", render: (r) => `<span class="cell-muted">${esc((r.answers || []).map((a) => (qLabelById[a.questionId] || "?") + ": " + fmtVal(a.value)).join(" · ")) || "—"}</span>` },
      ];
      App.table.mount({ container: responsesHost, columns, rows, defaultSort: "submittedAt", defaultSortDir: "desc", pageSize: 25 });
    }
    newBtn.onclick = () => setEdit(null);
    addBtn.onclick = () => { state.qs.push(blankQuestion()); paintQuestions(); };

    // Start-from: prefill the builder from an existing survey (saving creates a NEW row).
    async function prefillFrom(id) {
      try {
        const full = await App.portalApi("/api/surveys/" + encodeURIComponent(id));
        setEdit(null);
        nameInput.value = "Copy of " + (full.name || "");
        descInput.value = full.description || "";
        statusSel.value = "draft";
        state.qs = (Array.isArray(full.questions) ? full.questions : []).map((q) => ({
          lid: lidSeq++, type: q.type, label: q.label || "", helpText: q.helpText || "", required: !!q.required,
          config: q.config && typeof q.config === "object" ? JSON.parse(JSON.stringify(q.config)) : {}, mapFieldKey: q.mapFieldKey || null, mapRecordType: q.mapRecordType || (q.mapFieldKey ? "contact" : null),
        }));
        paintQuestions();
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) { toast(e.message, true); }
    }
    startSel.onchange = () => { const id = startSel.value; startSel.value = ""; if (id) prefillFrom(id); };

    saveBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { toast("Give the survey a name.", true); return; }
      if (!state.qs.length) { toast("Add at least one question.", true); return; }
      if (state.qs.some((q) => !String(q.label || "").trim())) { toast("Every question needs a label.", true); return; }
      const questions = state.qs.map((q) => ({ type: q.type, label: q.label.trim(), helpText: q.helpText || "", required: !!q.required, config: q.config || {}, mapFieldKey: q.mapFieldKey || null, mapRecordType: q.mapFieldKey ? (q.mapRecordType || "contact") : null }));
      saveBtn.disabled = true; saveBtn.textContent = "Saving…";
      try {
        const wasCreate = !state.id;
        const res = await App.portalApi("/api/surveys", { method: "POST", body: JSON.stringify({ id: state.id || null, name, description: descInput.value, status: statusSel.value, mapTargetType: "contact", questions }) });
        toast(wasCreate ? "Survey created." : "Survey updated.");
        // After a CREATE, fully reset the builder so the bound id is cleared and the NEXT
        // save inserts a brand-new survey instead of overwriting the one we just made.
        // After a real EDIT, stay on that survey (its id stays bound; only that row updates).
        if (wasCreate) setEdit(null);
        else state.id = res.id;
        await load();
      } catch (e) { toast(e.message, true); }
      finally { saveBtn.disabled = false; saveBtn.textContent = "Save survey"; }
    };

    // ---- results view ----
    function bar(pct) {
      return `<div style="background:var(--panel-2,#eef1f6);border-radius:6px;height:10px;overflow:hidden;flex:1"><div style="background:var(--accent,#3257d6);height:10px;width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
    }
    function optionBars(opts) {
      return `<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">` + (opts || []).map((o) =>
        `<div style="display:flex;align-items:center;gap:10px"><div style="width:160px" class="cell-muted">${esc(String(o.value))}</div>${bar(o.pct)}<div style="width:90px;text-align:right" class="cell-muted">${o.count} · ${o.pct}%</div></div>`
      ).join("") + `</div>`;
    }
    function renderResults(host, survey) {
      host.innerHTML = `<div class="cell-muted">Loading results…</div>`;
      Promise.all([
        App.portalApi("/api/surveys/" + encodeURIComponent(survey.id) + "/results"),
        App.portalApi("/api/surveys/" + encodeURIComponent(survey.id) + "/responses").catch(() => []),
      ]).then(([r, responses]) => {
        host.innerHTML = "";
        responses = Array.isArray(responses) ? responses : [];

        // header summary
        const head = el("div"); head.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap";
        const stat = (label, val) => `<div style="min-width:120px"><div class="cell-muted" style="font-size:12px">${esc(label)}</div><div class="cell-strong" style="font-size:18px">${esc(String(val))}</div></div>`;
        const summary = el("div"); summary.style.cssText = "display:flex;gap:18px;flex-wrap:wrap";
        let summaryHtml = stat("Responses", r.total) + stat("Tied to a contact", r.tied) + stat("Anonymous", r.anonymous);
        if (r.sent > 0) summaryHtml += stat("Sent", r.sent) + stat("Response rate", r.responseRate != null ? r.responseRate + "%" : "—");
        if (r.firstAt) summaryHtml += stat("First / last", fmtDate(r.firstAt) + " → " + fmtDate(r.lastAt));
        summary.innerHTML = summaryHtml;
        head.appendChild(summary);

        // lifecycle controls
        const life = el("div"); life.style.cssText = "display:flex;gap:8px;align-items:center";
        const pill = el("span", "pill " + (r.status === "active" ? "success" : r.status === "closed" ? "skipped" : ""), r.status.charAt(0).toUpperCase() + r.status.slice(1));
        life.appendChild(pill);
        const lifeBtn = (label, to) => { const b = el("button", "btn btn-ghost btn-sm", label); b.onclick = () => changeStatus(survey, to); return b; };
        if (r.status === "draft") life.appendChild(lifeBtn("Activate", "active"));
        else if (r.status === "active") life.appendChild(lifeBtn("Close", "closed"));
        else if (r.status === "closed") life.appendChild(lifeBtn("Reopen", "active"));
        head.appendChild(life);
        host.appendChild(head);

        // export
        const exportRow = el("div"); exportRow.style.cssText = "margin-top:12px";
        const exportBtn = el("button", "btn btn-ghost btn-sm", "Export responses");
        exportBtn.onclick = () => exportResponses(survey);
        exportRow.appendChild(exportBtn); host.appendChild(exportRow);

        if (!r.total) { host.appendChild(el("div", "cell-muted", "No responses yet.")).style.marginTop = "16px"; return; }

        // per-question breakdown
        const qWrap = el("div"); qWrap.style.cssText = "margin-top:18px;display:flex;flex-direction:column;gap:18px";
        (r.questions || []).forEach((q) => {
          const block = el("div", "card"); block.style.cssText = "padding:14px;background:var(--panel-2)";
          const qh = el("div"); qh.style.cssText = "display:flex;justify-content:space-between;align-items:baseline";
          qh.innerHTML = `<div class="cell-strong">${esc(q.label)}</div><div class="cell-muted" style="font-size:12px">${q.answered} answered</div>`;
          block.appendChild(qh);
          if (q.type === "single_select" || q.type === "yes_no" || q.type === "multi_select") {
            block.insertAdjacentHTML("beforeend", optionBars(q.options));
          } else if (q.type === "rating") {
            block.insertAdjacentHTML("beforeend", `<div class="cell-muted" style="margin:6px 0">Average: <span class="cell-strong">${q.average}</span></div>` + optionBars((q.distribution || []).map((d) => ({ value: d.value, count: d.count, pct: q.answered ? Math.round((d.count / q.answered) * 100) : 0 }))));
          } else if (q.type === "nps") {
            block.insertAdjacentHTML("beforeend",
              `<div style="display:flex;gap:18px;margin:8px 0"><div><div class="cell-muted" style="font-size:12px">NPS score</div><div class="cell-strong" style="font-size:22px">${q.score}</div></div>` +
              `<div class="cell-muted" style="align-self:center">Promoters ${q.promoters} · Passives ${q.passives} · Detractors ${q.detractors} · Avg ${q.average}</div></div>` +
              optionBars((q.distribution || []).map((d) => ({ value: d.value, count: d.count, pct: q.answered ? Math.round((d.count / q.answered) * 100) : 0 }))));
          } else if (q.type === "short_text" || q.type === "long_text") {
            const list = el("div"); list.style.cssText = "margin-top:8px;max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:6px";
            (q.texts || []).forEach((t) => { const row = el("div"); row.style.cssText = "border-left:2px solid var(--border,#e3e8ef);padding:2px 0 2px 10px"; row.innerHTML = `<div>${esc(t.value)}</div><div class="cell-muted" style="font-size:11.5px">${esc(t.contactName)}</div>`; list.appendChild(row); });
            if (!(q.texts || []).length) list.appendChild(el("div", "cell-muted", "No text answers."));
            block.appendChild(list);
          } else if (q.type === "date") {
            const list = el("div"); list.style.cssText = "margin-top:8px;max-height:180px;overflow:auto";
            (q.dates || []).forEach((t) => { const row = el("div", "cell-muted"); row.textContent = t.value + " — " + t.contactName; list.appendChild(row); });
            if (!(q.dates || []).length) list.appendChild(el("div", "cell-muted", "No dates."));
            block.appendChild(list);
          }
          qWrap.appendChild(block);
        });
        host.appendChild(qWrap);

        // individual responses table
        host.appendChild(el("div", "field-label", "Individual responses")).style.marginTop = "18px";
        const tableHost = el("div", "card"); tableHost.style.cssText = "padding:14px;background:var(--panel-2)"; host.appendChild(tableHost);
        const cols = [
          { key: "submittedAt", label: "Submitted", type: "date", get: (x) => x.submittedAt, text: (x) => fmtDate(x.submittedAt), render: (x) => `<span class="cell-muted">${fmtDate(x.submittedAt)}</span>` },
          { key: "who", label: "Respondent", type: "text", get: (x) => x.contactName, render: (x) => `<span class="${x.contactId ? "cell-strong" : "cell-muted"}">${esc(x.contactName)}</span>` },
          { key: "n", label: "Answered", type: "text", get: (x) => String((x.answers || []).length), render: (x) => `<span class="cell-muted">${(x.answers || []).length}</span>` },
        ];
        App.table.mount({ container: tableHost, columns: cols, rows: responses, defaultSort: "submittedAt", defaultSortDir: "desc", onRowClick: (x) => openRespDetail(x), pageSize: 25, emptyHtml: `<div class="cell-muted" style="padding:10px">No responses yet.</div>` });
      }).catch((e) => { host.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; });
    }

    async function changeStatus(survey, to) {
      try {
        await App.portalApi("/api/surveys/" + encodeURIComponent(survey.id) + "/status", { method: "PATCH", body: JSON.stringify({ status: to }) });
        toast("Survey " + (to === "active" ? "is now active" : to === "closed" ? "closed" : "updated") + ".");
        survey.status = to; state.survey.status = to; statusSel.value = to;
        renderResults(resultsCard, survey);
        load();
      } catch (e) { toast(e.message, true); }
    }

    function openRespDetail(resp) {
      const overlay = el("div", "modal-overlay");
      const modal = el("div", "modal");
      modal.innerHTML = `<div class="modal-head"><h2>Response</h2><button class="icon-btn" id="rd-close">&times;</button></div>`;
      const body = el("div", "modal-body");
      const meta = el("div", "cell-muted"); meta.style.marginBottom = "10px";
      meta.innerHTML = `${esc(fmtDate(resp.submittedAt))} · ${resp.contactId ? esc(resp.contactName) : "Anonymous"}`;
      if (resp.contactId) { const a = el("a", "link"); a.href = "#/contact/" + encodeURIComponent(resp.contactId); a.textContent = " — view contact"; a.onclick = () => overlay.remove(); meta.appendChild(a); }
      body.appendChild(meta);
      const fmtVal = (v) => Array.isArray(v) ? v.join(", ") : (v === true ? "Yes" : v === false ? "No" : String(v));
      (resp.answers || []).forEach((a) => {
        const row = el("div"); row.style.cssText = "padding:8px 0;border-top:1px solid var(--border,#e3e8ef)";
        row.innerHTML = `<div class="cell-muted" style="font-size:12px">${esc(qLabelById[a.questionId] || "Question")}</div><div>${esc(fmtVal(a.value))}</div>`;
        body.appendChild(row);
      });
      if (!(resp.answers || []).length) body.appendChild(el("div", "cell-muted", "No answers recorded."));
      const foot = el("div", "modal-foot"); const close = el("button", "btn btn-ghost btn-sm", "Close"); foot.appendChild(close);
      modal.appendChild(body); modal.appendChild(foot); overlay.appendChild(modal); document.body.appendChild(overlay);
      const dismiss = () => overlay.remove();
      overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
      modal.querySelector("#rd-close").onclick = dismiss; close.onclick = dismiss;
    }

    async function exportResponses(survey) {
      let ex;
      try { ex = await App.portalApi("/api/surveys/" + encodeURIComponent(survey.id) + "/response-export"); }
      catch (e) { toast(e.message, true); return; }
      if (!ex.rows || !ex.rows.length) { toast("No responses to export yet.", true); return; }
      App.exportModal({
        title: "Export responses",
        columns: (ex.columns || []).map((c) => ({ key: c.key, label: c.label, get: (row) => row[c.key] != null ? row[c.key] : "" })),
        rows: ex.rows,
        countText: (n) => `${n} response${n === 1 ? "" : "s"}`,
        unitPlural: "Responses",
        dataType: "survey",
        sheetName: "Responses",
        namePlaceholder: ex.name + " responses",
        filterLabel: "Which responses",
      });
    }

    // ---- send flow (audience -> email with per-recipient link -> confirm) ----
    function openSendFlow(survey) {
      const overlay = el("div", "modal-overlay");
      const modal = el("div", "modal"); modal.style.maxWidth = "640px";
      modal.innerHTML = `<div class="modal-head"><h2>Send “${esc(survey.name)}”</h2><button class="icon-btn" id="sf-close">&times;</button></div>`;
      const body = el("div", "modal-body");

      body.appendChild(el("div", "cell-muted", "Each recipient gets their own personal link, so their answers tie back to them and fill their fields. Pick who to send to, write the email, and include the survey link.")).style.marginBottom = "12px";

      // audience (reuse the same picker the Email tab uses)
      body.appendChild(el("div", "field-label", "Audience"));
      const audienceHost = el("div"); body.appendChild(audienceHost);
      const audience = App.audiencePicker.mount(audienceHost, {});

      // email composer (reuse App.compose; its Templates menu = start-from / save-as)
      const composerHost = el("div"); composerHost.style.marginTop = "12px"; body.appendChild(composerHost);
      const composer = App.compose.mount(composerHost, { kind: "email", surveyLinkMode: "token" });

      // insert {{survey_link}} merge token
      const linkBar = el("div"); linkBar.style.cssText = "margin-top:8px;display:flex;gap:8px;align-items:center";
      const insertBtn = el("button", "btn btn-ghost btn-sm", "Insert survey link");
      insertBtn.onclick = () => { composer.appendHtml("<p>" + SURVEY_LINK_TOKEN + "</p>"); composer.focus(); };
      linkBar.appendChild(insertBtn);
      linkBar.appendChild(el("span", "cell-muted", "Adds " + SURVEY_LINK_TOKEN + " — replaced with each person's unique link at send time.")).style.fontSize = "12.5px";
      body.appendChild(linkBar);

      const foot = el("div", "modal-foot"); foot.style.cssText = "display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap";
      const leftFoot = el("div");
      const testBtn = el("button", "btn btn-ghost btn-sm", "Send test to myself");
      leftFoot.appendChild(testBtn);
      const rightFoot = el("div"); rightFoot.style.cssText = "display:flex;gap:8px";
      const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
      const send = el("button", "btn btn-primary btn-sm", "Send survey");
      rightFoot.appendChild(cancel); rightFoot.appendChild(send);
      foot.appendChild(leftFoot); foot.appendChild(rightFoot);

      modal.appendChild(body); modal.appendChild(foot); overlay.appendChild(modal);
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      modal.querySelector("#sf-close").onclick = close;
      cancel.onclick = close;

      function checks() {
        const subject = composer.getSubject();
        if (!subject || !subject.trim()) { toast("Add a subject.", true); return null; }
        const html = composer.getHTML();
        if (html.indexOf(SURVEY_LINK_TOKEN) === -1) { toast("Your email doesn't include the survey link — add it before sending.", true); return null; }
        return { subject: subject.trim(), html };
      }

      testBtn.onclick = async () => {
        const c = checks(); if (!c) return;
        testBtn.disabled = true; testBtn.textContent = "Sending…";
        try { await App.portalApi("/api/surveys/" + encodeURIComponent(survey.id) + "/send-test", { method: "POST", body: JSON.stringify(c) }); toast("Test sent to your email."); }
        catch (e) { toast(e.message, true); }
        finally { testBtn.disabled = false; testBtn.textContent = "Send test to myself"; }
      };

      send.onclick = async () => {
        const c = checks(); if (!c) return;
        const recipientIds = audience.getRecipientIds();
        if (!recipientIds.length) { toast("No emailable recipients in this audience.", true); return; }
        const ok = await App.ui.confirmModal({
          title: "Send this survey?",
          message: `You're about to send “${survey.name}” to ${recipientIds.length} ${recipientIds.length === 1 ? "person" : "people"}. Each gets their own link. Send?`,
          confirmText: "Send",
        });
        if (!ok) return;
        send.disabled = true; send.textContent = "Sending…";
        try {
          const res = await App.portalApi("/api/surveys/" + encodeURIComponent(survey.id) + "/send", { method: "POST", body: JSON.stringify({ subject: c.subject, html: c.html, contactIds: recipientIds }) });
          if (res.failCount) toast(`Sent to ${res.sentCount} of ${res.recipientCount} — ${res.failCount} failed.`);
          else toast(`Sent to ${res.sentCount} ${res.sentCount === 1 ? "person" : "people"}.`);
          close();
          loadResponses(survey.id);
        } catch (e) { toast(e.message, true); send.disabled = false; send.textContent = "Send survey"; }
      };
    }

    // ---- list ----
    listHost.addEventListener("click", async (e) => {
      const dup = e.target.closest ? e.target.closest(".sv-dup") : null;
      if (dup) {
        e.stopPropagation();
        try { const r = await App.portalApi("/api/surveys/" + encodeURIComponent(dup.dataset.id) + "/duplicate", { method: "POST" }); toast("Survey duplicated."); await load(); if (r && r.id) openEdit(r.id); }
        catch (err) { toast(err.message, true); }
        return;
      }
      const del = e.target.closest ? e.target.closest(".sv-del") : null;
      if (!del) return;
      e.stopPropagation();
      const s = surveys.find((x) => x.id === del.dataset.id);
      if (!(await App.ui.confirmModal({ title: "Delete survey", message: `Delete survey${s ? ` “${s.name}”` : ""}? This removes its questions too.`, confirmText: "Delete survey" }))) return;
      try { await App.portalApi("/api/surveys/" + encodeURIComponent(del.dataset.id), { method: "DELETE" }); toast("Survey deleted."); if (state.id === del.dataset.id) setEdit(null); await load(); }
      catch (err) { toast(err.message, true); }
    });

    async function openEdit(id) {
      try { const full = await App.portalApi("/api/surveys/" + encodeURIComponent(id)); setEdit(full); card.scrollIntoView({ behavior: "smooth", block: "start" }); }
      catch (e) { toast(e.message, true); }
    }

    async function load() {
      listHost.innerHTML = `<div class="cell-muted" style="padding:8px">Loading…</div>`;
      try {
        const [sv, fContact, fJob, fBooking, rTypes] = await Promise.all([
          App.portalApi("/api/surveys"),
          App.portalApi("/api/fields?recordType=contact").catch(() => []),
          App.portalApi("/api/fields?recordType=job").catch(() => []),
          App.portalApi("/api/fields?recordType=booking").catch(() => []),
          App.portalApi("/api/record-types").catch(() => []),
        ]);
        surveys = Array.isArray(sv) ? sv : [];
        mapFields = { contact: Array.isArray(fContact) ? fContact : [], job: Array.isArray(fJob) ? fJob : [], booking: Array.isArray(fBooking) ? fBooking : [] };
        const rtByKey = {}; (Array.isArray(rTypes) ? rTypes : []).forEach((t) => { rtByKey[t.key] = t.label || t.labelPlural || t.key; });
        const lbl = (k, d) => rtByKey[k] || (App.label ? App.label(k, "one") : d) || d;
        mapTypes = [["contact", lbl("contact", "Contact")]];
        if ((mapFields.job || []).length) mapTypes.push(["job", lbl("job", "Job")]);
        if ((mapFields.booking || []).length) mapTypes.push(["booking", lbl("booking", "Booking")]);
      } catch (e) { listHost.innerHTML = `<div class="cell-muted" style="padding:8px">${esc(e.message)}</div>`; return; }
      listHost.innerHTML = "";
      const statusPill = (s) => `<span class="pill ${s === "active" ? "success" : s === "closed" ? "skipped" : ""}">${esc(s.charAt(0).toUpperCase() + s.slice(1))}</span>`;
      const columns = [
        { key: "name", label: "Name", type: "text", get: (r) => r.name, render: (r) => `<span class="cell-strong">${esc(r.name || "—")}</span>` },
        { key: "status", label: "Status", type: "text", get: (r) => r.status, render: (r) => statusPill(r.status) },
        { key: "questionCount", label: "Questions", type: "text", get: (r) => String(r.questionCount), render: (r) => `<span class="cell-muted">${r.questionCount}</span>` },
        { key: "responseCount", label: "Responses", type: "text", get: (r) => String(r.responseCount || 0), render: (r) => `<span class="cell-muted">${r.responseCount || 0}</span>` },
        { key: "by", label: "Created by", type: "text", get: (r) => r.createdByName || "", render: (r) => `<span class="cell-muted">${esc(r.createdByName || "—")}</span>` },
        { key: "updatedAt", label: "Updated", type: "date", get: (r) => r.updatedAt, text: (r) => fmtDate(r.updatedAt), render: (r) => `<span class="cell-muted">${fmtDate(r.updatedAt)}</span>` },
        { key: "actions", label: "", type: "text", get: () => "", render: (r) => `<button class="btn btn-ghost btn-sm sv-dup" data-id="${esc(r.id)}">Duplicate</button> <button class="btn btn-ghost btn-sm sv-del" data-id="${esc(r.id)}">Delete</button>` },
      ];
      startSel.innerHTML = `<option value="">— blank —</option>` + surveys.map((sv) => `<option value="${esc(sv.id)}">${esc(sv.name)}</option>`).join("");
      App.table.mount({
        container: listHost, columns, rows: surveys,
        defaultSort: "updatedAt", defaultSortDir: "desc",
        onRowClick: (r) => openEdit(r.id),
        emptyHtml: `<div class="card cell-muted" style="padding:18px">No surveys yet.</div>`,
        pageSize: 50,
      });
    }

    setEdit(null);
    load();
  }

  App.communication = { render: renderCommunication, composeTo };
})(typeof window !== "undefined" ? window : globalThis);
