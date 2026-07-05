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

    // PICK-MODE: nobody is a recipient until added. Sources = typed pills ∪ checked
    // rows. Criteria is a bulk ADD (checks matching rows), not a standing filter.
    const state = {
      contacts: [],
      columns: [],
      rules: [],
      checked: new Set(Array.isArray(opts.preloadIds) ? opts.preloadIds : []), // the selection (source of truth)
      typed: [],                                                                // typed-email pills
      ready: false,
    };
    const useTyped = !!opts.allowTypedEmails;
    const nounLower = (n) => (App.label ? App.label("contact", n === 1 ? "one" : "many").toLowerCase() : (n === 1 ? "contact" : "contacts"));

    // Count line (primary) + context (secondary) + pick-mode description.
    const summary = el("div", "audience-summary cell-strong"); summary.style.cssText = "font-size:14px;margin:0 0 2px";
    const subLine = el("div", "cell-muted"); subLine.style.cssText = "font-size:12.5px;margin:0 0 6px";
    const desc = el("div", "cell-muted"); desc.style.cssText = "font-size:12.5px;margin:0 0 12px";
    desc.textContent = (Array.isArray(opts.preloadIds) && opts.preloadIds.length)
      ? "Your selected contacts are checked below — uncheck anyone, or add more by typing an address, checking people, or applying a filter."
      : "No one is added until you pick them — type an address, check people below, or apply a filter to select the matches.";

    // ----- typed-email pills -----
    let chipInput = null;
    const typedWrap = el("div", "field");
    const chipBox = el("div", "chip-box");
    if (useTyped) {
      typedWrap.style.cssText = "margin:0 0 14px";
      typedWrap.innerHTML = `<span class="field-label">Add individual email addresses</span>`;
      chipBox.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid var(--line-strong);border-radius:8px;padding:6px 8px;background:var(--panel)";
      chipInput = el("input"); chipInput.type = "text"; chipInput.placeholder = "name@example.com"; chipInput.style.cssText = "flex:1;min-width:160px;border:0;outline:none;background:transparent;font:inherit;color:inherit;padding:4px";
      chipBox.appendChild(chipInput);
      typedWrap.appendChild(chipBox);
    }
    const typedNote = el("div", "cell-muted"); typedNote.style.cssText = "font-size:12px;margin-top:4px";

    // Criteria → bulk-add control.
    let rulesHost = null;
    const addMatchRow = el("div"); addMatchRow.style.cssText = "margin:8px 0 4px";
    const addMatchBtn = el("button", "btn btn-ghost btn-sm", "+ Check matching"); addMatchBtn.style.display = "none";
    addMatchRow.appendChild(addMatchBtn);

    // Table (always shown — pick-mode needs the checkboxes).
    const tableTools = el("div"); tableTools.style.cssText = "display:flex;gap:8px;align-items:center;margin:10px 0 6px;flex-wrap:wrap";
    const tableHost = el("div");

    function emailable(rows) { return rows.filter((c) => c.email && String(c.email).trim()); }
    function emailableAll() { return state.ready ? emailable(state.contacts) : []; }
    function ruleMatched() { return App.table.pipeline(state.contacts, state.columns, { rules: state.rules }); }
    // Resolved CONTACT recipients = checked ∩ emailable. Nobody unless added.
    function contactRecipients() { return emailableAll().filter((c) => state.checked.has(c.id)); }
    // Valid typed pills, de-duplicated against the resolved contact emails.
    function typedEmails() {
      const contactEmails = new Set(contactRecipients().map((c) => String(c.email || "").toLowerCase()));
      const out = [], seen = new Set();
      state.typed.forEach((e) => { const lo = e.toLowerCase(); if (EMAIL_RE.test(e) && !contactEmails.has(lo) && !seen.has(lo)) { seen.add(lo); out.push(e); } });
      return out;
    }

    function counts() {
      const selected = contactRecipients().length;
      const typed = typedEmails().length;
      return { contacts: state.contacts.length, emailable: emailableAll().length, selected, typed, total: selected + typed };
    }

    function renderSummary() {
      const c = counts();
      summary.textContent = `${c.total} recipient${c.total === 1 ? "" : "s"} selected`;
      subLine.textContent = `${c.contacts} ${nounLower(c.contacts)} · ${c.emailable} have an email${c.typed ? ` · ${c.typed} typed` : ""}`;
      if (opts.onChange) opts.onChange();
    }

    // ----- typed pills -----
    function renderChips() {
      Array.prototype.slice.call(chipBox.querySelectorAll(".chip")).forEach((n) => n.remove());
      state.typed.forEach((addr) => {
        const chip = el("span", "chip");
        chip.style.cssText = "display:inline-flex;align-items:center;gap:6px;background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:3px 8px;font-size:12.5px";
        chip.innerHTML = `<span>${esc(addr)}</span>`;
        const x = el("button", "chip-x", "&times;"); x.type = "button"; x.style.cssText = "border:0;background:none;color:inherit;cursor:pointer;font-size:15px;line-height:1;padding:0";
        x.onclick = () => { state.typed = state.typed.filter((a) => a !== addr); renderChips(); renderSummary(); };
        chip.appendChild(x);
        chipBox.insertBefore(chip, chipInput);
      });
    }
    function commitTyped() {
      const raw = (chipInput.value || "").trim();
      if (!raw) return;
      const tokens = raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
      const bad = [];
      tokens.forEach((t) => {
        if (!EMAIL_RE.test(t)) { bad.push(t); return; }
        if (!state.typed.some((a) => a.toLowerCase() === t.toLowerCase())) state.typed.push(t);
      });
      chipInput.value = "";
      typedNote.textContent = bad.length ? `Not a valid email: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? "…" : ""}` : "";
      typedNote.style.color = bad.length ? "var(--danger, #c0392b)" : "";
      renderChips(); renderSummary();
    }

    // ----- table with checkboxes (pick-mode: unchecking removes; no separate exclude) -----
    function previewColumns() {
      const ck = {
        key: "__ck", label: "", type: "text", get: () => "",
        render: (c) => `<input type="checkbox" class="aud-ck" data-id="${esc(c.id)}" ${state.checked.has(c.id) ? "checked" : ""} aria-label="Select" />`,
        cellClass: "cell-check",
      };
      return [ck].concat(state.columns.slice());
    }
    function renderTablePreview() {
      tableTools.innerHTML = "";
      const all = emailableAll();
      const allChecked = all.length > 0 && all.every((c) => state.checked.has(c.id));
      const selAll = el("button", "btn btn-ghost btn-sm", allChecked ? "Clear all" : `Select all ${all.length}`);
      selAll.onclick = () => {
        if (allChecked) all.forEach((c) => state.checked.delete(c.id));
        else all.forEach((c) => state.checked.add(c.id));
        renderTablePreview(); renderSummary();
      };
      tableTools.appendChild(selAll);
      tableHost.innerHTML = "";
      App.table.mount({
        container: tableHost, columns: previewColumns(), rows: all,
        defaultSort: "name", defaultSortDir: "asc", pageSize: 10,
        emptyHtml: `<div class="card cell-muted" style="padding:14px">No emailable contacts to choose from.</div>`,
      });
    }
    // Checkbox toggle — add/remove from the selection (no full re-render, keeps page).
    tableHost.addEventListener("change", (e) => {
      const ck = e.target.closest && e.target.closest(".aud-ck");
      if (!ck) return;
      if (ck.checked) state.checked.add(ck.dataset.id); else state.checked.delete(ck.dataset.id);
      renderSummary();
    });

    // ----- criteria as bulk-add -----
    function updateAddBtn() {
      const has = state.rules.length > 0;
      addMatchBtn.style.display = has ? "" : "none";
      if (!has) return;
      const n = emailable(ruleMatched()).length;
      addMatchBtn.textContent = `+ Check the ${n} matching ${nounLower(n)}`;
      addMatchBtn.disabled = n === 0;
    }
    addMatchBtn.onclick = () => {
      // Apply: CHECK every emailable match (adds to selection). Discrete action — a
      // manual uncheck afterwards sticks until the user applies again.
      const matches = emailable(ruleMatched());
      matches.forEach((c) => state.checked.add(c.id));
      renderTablePreview(); renderSummary();
      toast(`Added ${matches.length} matching ${nounLower(matches.length)}.`);
    };
    function mountRules() {
      if (!rulesHost) return;
      rulesHost.innerHTML = "";
      rulesHost.appendChild(App.table.ruleEditor(state.columns, state.contacts, state.rules, () => { updateAddBtn(); }));
    }

    async function build() {
      const [contacts, fields, saved, audiences] = await Promise.all([
        App.portalApi("/api/contacts").catch(() => []),
        App.portalApi("/api/fields").catch(() => []),
        App.portalApi("/api/saved-filters?view=contacts").catch(() => []),
        App.portalApi("/api/audiences").catch(() => []),
      ]);
      state.contacts = Array.isArray(contacts) ? contacts : [];
      state.columns = App.portal.contactColumnDefs(fields || []);
      state.ready = true;

      host.appendChild(summary);
      host.appendChild(subLine);
      host.appendChild(desc);

      if (useTyped) {
        chipInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitTyped(); } });
        chipInput.addEventListener("blur", commitTyped);
        host.appendChild(typedWrap); host.appendChild(typedNote);
        renderChips();
      }

      if ((saved || []).length || (audiences || []).length) {
        const sfWrap = el("label", "field"); sfWrap.style.marginTop = "4px";
        sfWrap.innerHTML = `<span class="field-label">Start from an audience or saved filter (optional)</span>`;
        const sel = el("select", "input");
        const audOpts = (audiences || []).map((f) => `<option value="aud:${esc(f.id)}">${esc(f.name)}</option>`).join("");
        const savedOpts = (saved || []).map((f) => `<option value="sf:${esc(f.id)}">${esc(f.name)}</option>`).join("");
        sel.innerHTML = `<option value="">— none —</option>` +
          (audOpts ? `<optgroup label="Audiences">${audOpts}</optgroup>` : "") +
          (savedOpts ? `<optgroup label="Saved filters">${savedOpts}</optgroup>` : "");
        sel.onchange = () => {
          let def = {};
          if (sel.value.indexOf("aud:") === 0) { const f = (audiences || []).find((x) => x.id === sel.value.slice(4)); def = (f && f.definition) || {}; }
          else if (sel.value.indexOf("sf:") === 0) { const f = (saved || []).find((x) => x.id === sel.value.slice(3)); def = (f && f.definition) || {}; }
          state.rules.length = 0;
          (Array.isArray(def.rules) ? def.rules : []).forEach((r) => state.rules.push(r));
          mountRules(); updateAddBtn();
        };
        sfWrap.appendChild(sel); host.appendChild(sfWrap);
      }
      host.appendChild(el("div", "field-label", "Filter to select people (optional)"));
      rulesHost = el("div"); host.appendChild(rulesHost); mountRules();
      host.appendChild(addMatchRow); updateAddBtn();

      host.appendChild(tableTools); host.appendChild(tableHost);
      renderTablePreview();
      renderSummary();
    }

    build().catch((e) => { host.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; });

    return {
      getRecipients: () => contactRecipients().map((c) => ({ id: c.id, email: c.email, name: c.name || null })),
      getRecipientIds: () => contactRecipients().map((c) => c.id),
      getTypedEmails: () => typedEmails(),
      getCounts: counts,
    };
  }

  App.audiencePicker = { mount: mountAudiencePicker };

  // ======================================================================
  // Shared Audience SELECT (multi-select saved audiences as a recipient source).
  //   App.audienceSelect.mount(host, opts) -> api
  //   opts: { emailableOnly (default true), onChange() }
  //   api:
  //     getSelectedIds()        -> audienceId[]       (what to send server-side; resolved fresh there)
  //     getResolvedContactIds() -> string[]           (client PREVIEW union/de-dupe of current matches)
  //     getCounts()             -> { audiences, recipients }
  // Used by BOTH the email composer and the survey-send modal (and Drips later). Resolving here is
  // only a live preview; the authoritative resolve happens server-side at send time (dynamic).
  // REUSES App.portal.contactColumnDefs + App.table.pipeline — no new filter logic.
  // ======================================================================
  function mountAudienceSelect(host, opts) {
    opts = opts || {};
    const { el, esc } = App.util;
    const emailableOnly = opts.emailableOnly !== false;
    host.innerHTML = "";
    host.classList.add("audience-select");
    const nounLower = (n) => (App.label ? App.label("contact", n === 1 ? "one" : "many").toLowerCase() : (n === 1 ? "contact" : "contacts"));

    const state = { audiences: [], contacts: [], columns: [], selected: new Set(Array.isArray(opts.selectedIds) ? opts.selectedIds : []), ready: false };
    const summary = el("div", "cell-strong"); summary.style.cssText = "font-size:14px;margin:0 0 8px";
    const listWrap = el("div"); listWrap.style.cssText = "display:flex;flex-direction:column;gap:6px";
    host.appendChild(summary); host.appendChild(listWrap);

    function rulesOf(a) { return (a && a.definition && Array.isArray(a.definition.rules)) ? a.definition.rules : []; }
    function matchesOf(a) {
      const rows = App.table.pipeline(state.contacts, state.columns, { rules: rulesOf(a) });
      return emailableOnly ? rows.filter((c) => c.email && String(c.email).trim()) : rows;
    }
    function resolvedIds() {
      const set = new Set();
      state.audiences.forEach((a) => { if (state.selected.has(a.id)) matchesOf(a).forEach((c) => set.add(c.id)); });
      return Array.from(set);
    }
    function counts() { return { audiences: state.selected.size, recipients: resolvedIds().length }; }

    function renderSummary() {
      const c = counts();
      summary.textContent = state.selected.size
        ? `${c.recipients} recipient${c.recipients === 1 ? "" : "s"} from ${c.audiences} audience${c.audiences === 1 ? "" : "s"}`
        : "No audience selected yet";
      if (opts.onChange) opts.onChange();
    }

    function renderList() {
      listWrap.innerHTML = "";
      if (!state.audiences.length) { listWrap.appendChild(el("div", "cell-muted", "No saved audiences yet. Create one in Communication → Audiences.")); return; }
      state.audiences.forEach((a) => {
        const n = matchesOf(a).length;
        const row = el("label", "audience-select-row");
        row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line,#e5e7eb);border-radius:8px;cursor:pointer";
        const ck = el("input"); ck.type = "checkbox"; ck.checked = state.selected.has(a.id);
        ck.onchange = () => { if (ck.checked) state.selected.add(a.id); else state.selected.delete(a.id); renderSummary(); };
        const mid = el("div"); mid.style.cssText = "flex:1;min-width:0";
        mid.innerHTML = `<div style="font-weight:600">${esc(a.name)}</div>`;
        const cnt = el("div"); cnt.style.cssText = "font-size:12.5px;" + (n === 0 ? "color:#b45309" : "color:var(--muted,#6b7280)");
        cnt.textContent = n === 0 ? "0 — matches nobody right now" : `${n} ${nounLower(n)} match now`;
        mid.appendChild(cnt);
        row.appendChild(ck); row.appendChild(mid);
        listWrap.appendChild(row);
      });
    }

    async function build() {
      const [audiences, contacts, fields] = await Promise.all([
        App.portalApi("/api/audiences").catch(() => []),
        App.portalApi("/api/contacts").catch(() => []),
        App.portalApi("/api/fields").catch(() => []),
      ]);
      state.audiences = Array.isArray(audiences) ? audiences : [];
      state.contacts = Array.isArray(contacts) ? contacts : [];
      state.columns = App.portal.contactColumnDefs(fields || []);
      state.ready = true;
      renderList(); renderSummary();
    }
    build().catch((e) => { host.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; });

    return {
      getSelectedIds: () => Array.from(state.selected),
      getResolvedContactIds: () => resolvedIds(),
      getCounts: counts,
      // Selected audiences that currently match nobody (for a pre-send warning).
      getEmptySelected: () => state.audiences.filter((a) => state.selected.has(a.id) && matchesOf(a).length === 0).map((a) => a.name),
    };
  }
  App.audienceSelect = { mount: mountAudienceSelect };

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
    const TABS = [["email", "Email"], ["templates", "Email Templates"], ["surveys", "Surveys"], ["drips", "Drips"], ["audiences", "Audiences"]];
    let active = "email";
    function setTab(key) {
      active = key;
      App.util.$$(".tab", tabsBar).forEach((t) => t.classList.toggle("active", t.dataset.tab === key));
      tabBody.innerHTML = "";
      if (key === "email") emailTab(tabBody);
      else if (key === "audiences") audiencesTab(tabBody);
      else if (key === "drips") App.drips.renderLibrary(tabBody);
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

    // --- Panel 1: New email (Send up top, then subject + body) ---
    const card = el("div", "card");
    card.style.cssText = "padding:22px";
    const headRow = el("div"); headRow.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap";
    const headLeft = el("div");
    headLeft.appendChild(el("h3", "settings-sub", "New email"));
    headLeft.appendChild(el("div", "cell-muted", "Write the subject and message your recipients will see.")).style.margin = "2px 0 0";
    const sendWrap = el("div"); sendWrap.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:4px";
    const sendBtn = el("button", "btn btn-primary", "Send email");
    const sendCount = el("div", "cell-muted"); sendCount.style.cssText = "font-size:12px";
    sendWrap.appendChild(sendBtn); sendWrap.appendChild(sendCount);
    headRow.appendChild(headLeft); headRow.appendChild(sendWrap);
    card.appendChild(headRow);
    const composerHost = el("div"); composerHost.style.marginTop = "14px";
    card.appendChild(composerHost);
    const composer = App.compose.mount(composerHost, { kind: "email" });
    host.appendChild(card);

    // --- Panel 2: Audience ---
    const audCard = el("div", "card");
    audCard.style.cssText = "padding:22px;margin-top:16px";
    audCard.appendChild(el("h3", "settings-sub", "Audience"));
    const audIntro = hasPreload
      ? `Starting from the ${preloadIds.length} ${App.label("contact", preloadIds.length === 1 ? "one" : "many").toLowerCase()} you selected (already checked) — uncheck anyone, or add more below.`
      : "No one is emailed until you add them — type an address, check people below, or apply a filter to select matches. Only people with an email address are sent to.";
    audCard.appendChild(el("div", "cell-muted", audIntro)).style.margin = "2px 0 14px";
    const audienceHost = el("div");
    // Primary path: pick one or more saved Audiences (resolved to their CURRENT matches at send
    // time, server-side). Shown above the manual picker; typed on-the-fly entry stays below.
    audCard.appendChild(el("div", "field-label", "Send to saved audiences"));
    const audSelHost = el("div"); audCard.appendChild(audSelHost);
    const audSelect = App.audienceSelect.mount(audSelHost, { emailableOnly: true, onChange: () => refreshCount() });
    const orLabel = el("div", "field-label", "Or add people manually"); orLabel.style.marginTop = "16px"; audCard.appendChild(orLabel);
    audCard.appendChild(audienceHost);
    const audOpts = { tablePreview: true, allowTypedEmails: true };
    if (hasPreload) audOpts.preloadIds = preloadIds;
    function refreshCount() {
      const manual = (audience && audience.getRecipientIds) ? audience.getRecipientIds() : [];
      const fromAud = audSelect ? audSelect.getResolvedContactIds() : [];
      const typed = (audience && audience.getTypedEmails) ? audience.getTypedEmails().length : 0;
      const audCount = audSelect ? audSelect.getCounts().audiences : 0;
      const total = new Set([...manual, ...fromAud]).size + typed;
      sendCount.textContent = audCount
        ? `${total} recipient${total === 1 ? "" : "s"} from ${audCount} audience${audCount === 1 ? "" : "s"}${typed ? ` (+${typed} typed)` : ""}`
        : (total ? `${total} recipient${total === 1 ? "" : "s"} selected` : "Add at least one recipient");
      sendBtn.disabled = total === 0;
    }
    const audience = App.audiencePicker.mount(audienceHost, Object.assign(audOpts, { onChange: () => refreshCount() }));
    host.appendChild(audCard);
    refreshCount();

    sendBtn.onclick = async () => {
      const subject = composer.getSubject();
      if (!subject || !subject.trim()) { toast("Add a subject.", true); return; }
      const recipientIds = audience.getRecipientIds();
      const typedEmails = audience.getTypedEmails ? audience.getTypedEmails() : [];
      const audienceIds = audSelect.getSelectedIds();
      const fromAud = audSelect.getResolvedContactIds();
      const contactTotal = new Set([...recipientIds, ...fromAud]).size;
      const total = contactTotal + typedEmails.length;
      if (!total) { toast("No recipients — pick an audience, add an email address, or check people.", true); return; }

      const empties = audSelect.getEmptySelected();
      const emptyNote = empties.length ? ` Note: ${empties.map((n) => `“${n}”`).join(", ")} match${empties.length === 1 ? "es" : ""} nobody right now.` : "";
      const audCount = audienceIds.length;
      const fromLine = audCount ? `${contactTotal} contact${contactTotal === 1 ? "" : "s"} from ${audCount} audience${audCount === 1 ? "" : "s"}${typedEmails.length ? ` + ${typedEmails.length} typed` : ""}` : `${total} ${total === 1 ? "person" : "people"}${typedEmails.length ? ` (${recipientIds.length} contacts + ${typedEmails.length} typed)` : ""}`;
      const ok = await App.ui.confirmModal({
        title: "Send this email?",
        message: `You're about to email ${fromLine}. Recipients are resolved now, so it reflects who currently matches.${emptyNote} Send?`,
        confirmText: "Send",
      });
      if (!ok) return;

      sendBtn.disabled = true; sendBtn.textContent = "Sending…";
      try {
        const res = await App.portalApi("/api/communication/email", {
          method: "POST",
          body: JSON.stringify({ subject: subject.trim(), html: composer.getHTML(), contactIds: recipientIds, audienceIds, extraEmails: typedEmails }),
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

    // Recipients section: WHO the blast went to, with per-address status. Sourced from
    // the EmailLog table (one row per address, real delivery status incl. "mock") via a
    // tenant-scoped endpoint, loaded on demand once the modal is open.
    const rcpSection = el("div");
    rcpSection.style.marginTop = "14px";
    const rcpHead = el("div", "", "Recipients");
    rcpHead.style.cssText = "font-weight:600;margin-bottom:6px";
    rcpSection.appendChild(rcpHead);
    const rcpBody = el("div", "cell-muted", "Loading…");
    rcpBody.style.fontSize = "12.5px";
    rcpSection.appendChild(rcpBody);
    body.appendChild(rcpSection);

    App.portalApi("/api/communication/sends/" + encodeURIComponent(r.id) + "/recipients").then((rcps) => {
      rcps = Array.isArray(rcps) ? rcps : [];
      if (!rcps.length) {
        // No linked EmailLog rows. If the send had recipients, it predates this update.
        rcpBody.textContent = r.recipientCount > 0
          ? "Recipient list wasn't recorded for sends before this update."
          : "No recipients recorded for this send.";
        return;
      }
      rcpHead.textContent = `Recipients (${rcps.length})`;
      rcpBody.remove();
      const listBox = el("div", "card");
      listBox.style.cssText = "padding:4px 0;max-height:34vh;overflow:auto";
      rcps.forEach((p) => {
        const hasName = !!(p && p.toName && String(p.toName).trim());
        const primary = hasName ? p.toName : (p && p.toEmail ? p.toEmail : "—");
        const row = el("div");
        row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 14px";
        const who = el("div");
        who.style.minWidth = "0";
        who.innerHTML = `<div style="font-size:13.5px;overflow:hidden;text-overflow:ellipsis">${esc(primary)}</div>` +
          (hasName ? `<div class="cell-muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${esc(p.toEmail || "")}</div>` : "");
        const badge = el("div");
        // sent -> green, failed -> red, mock (dev/test, not actually delivered) -> muted.
        const cls = p && p.status === "failed" ? "pill failed" : (p && p.status === "mock" ? "pill report" : "pill success");
        const label = p && (p.status === "failed" || p.status === "mock") ? p.status : "sent";
        badge.innerHTML = `<span class="${cls}">${esc(label)}</span>`;
        row.appendChild(who); row.appendChild(badge);
        listBox.appendChild(row);
      });
      rcpSection.appendChild(listBox);
    }).catch((e) => {
      rcpBody.textContent = (e && e.message) ? e.message : "Couldn't load the recipient list.";
    });
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
  // ======================================================================
  // Audiences tab: a library of NAMED, DYNAMIC contact filters. Reuses the SAME
  // primitives as Contacts + the recipient picker — App.portal.contactColumnDefs
  // (columns), App.table.ruleEditor (criteria rows / AND-OR), App.table.pipeline
  // (live match count). No second filter UI is forked. CRUD hits /api/audiences.
  // ======================================================================
  async function audiencesTab(host) {
    const { el, esc, toast } = App.util;
    const nounLower = (n) => (App.label ? App.label("contact", n === 1 ? "one" : "many").toLowerCase() : (n === 1 ? "contact" : "contacts"));
    host.innerHTML = `<div class="cell-muted" style="padding:8px">Loading…</div>`;
    let contacts = [], fields = [], audiences = [], columns = [];
    try {
      [contacts, fields, audiences] = await Promise.all([
        App.portalApi("/api/contacts").catch(() => []),
        App.portalApi("/api/fields").catch(() => []),
        App.portalApi("/api/audiences").catch(() => []),
      ]);
    } catch (e) { host.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; return; }
    contacts = Array.isArray(contacts) ? contacts : [];
    audiences = Array.isArray(audiences) ? audiences : [];
    columns = App.portal.contactColumnDefs(fields || []);
    const rulesOf = (a) => (a && a.definition && Array.isArray(a.definition.rules)) ? a.definition.rules : [];
    const countFor = (a) => App.table.pipeline(contacts, columns, { rules: rulesOf(a) }).length;

    async function reload() { audiences = (await App.portalApi("/api/audiences").catch(() => audiences)) || audiences; renderList(); }

    function renderList() {
      host.innerHTML = "";
      const head = el("div"); head.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px";
      const hl = el("div");
      hl.appendChild(el("h3", "settings-sub", "Audiences"));
      hl.appendChild(el("div", "cell-muted", "Named, saved contact filters — each one always reflects the contacts that match right now.")).style.cssText = "font-size:12.5px;margin-top:2px";
      const newBtn = el("button", "btn btn-primary btn-sm", "+ New audience");
      newBtn.onclick = () => renderEditor(null);
      head.appendChild(hl); head.appendChild(newBtn);
      host.appendChild(head);

      if (!audiences.length) { host.appendChild(el("div", "card cell-muted", "No audiences yet. Create one to reuse a contact filter across emails.")); return; }
      const list = el("div"); list.style.cssText = "display:flex;flex-direction:column;gap:8px";
      audiences.forEach((a) => {
        const n = countFor(a);
        const row = el("div", "card"); row.style.cssText = "padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap";
        const left = el("div");
        left.innerHTML = `<div style="font-weight:600">${esc(a.name)}</div><div class="cell-muted" style="font-size:12.5px">${n} ${esc(nounLower(n))} match now</div>`;
        const btns = el("div"); btns.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
        const use = el("button", "btn btn-primary btn-sm", "Use in email");
        use.onclick = () => { const ids = App.table.pipeline(contacts, columns, { rules: rulesOf(a) }).filter((c) => c.email).map((c) => c.id); App.communication.composeTo(ids); };
        const edit = el("button", "btn btn-ghost btn-sm", "Edit"); edit.onclick = () => renderEditor(a);
        const ren = el("button", "btn btn-ghost btn-sm", "Rename");
        ren.onclick = async () => { const name = await App.ui.promptModal({ title: "Rename audience", label: "Audience name", value: a.name, okText: "Rename" }); if (!name || !name.trim()) return; try { await App.portalApi("/api/audiences/" + a.id, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) }); toast("Renamed"); reload(); } catch (e) { toast(e.message, true); } };
        const del = el("button", "btn btn-ghost btn-sm", "Delete"); del.style.color = "#dc2626";
        del.onclick = async () => { if (!(await App.ui.confirmModal({ title: "Delete audience", message: `Delete the audience \u201c${a.name}\u201d? This only deletes the saved filter — no contacts are affected.`, confirmText: "Delete" }))) return; try { await App.portalApi("/api/audiences/" + a.id, { method: "DELETE" }); toast("Audience deleted"); reload(); } catch (e) { toast(e.message, true); } };
        btns.appendChild(use); btns.appendChild(edit); btns.appendChild(ren); btns.appendChild(del);
        row.appendChild(left); row.appendChild(btns);
        list.appendChild(row);
      });
      host.appendChild(list);
    }

    function renderEditor(aud) {
      host.innerHTML = "";
      const card = el("div", "card"); card.style.cssText = "padding:18px";
      card.appendChild(el("h3", "settings-sub", aud ? "Edit audience" : "New audience"));
      const nameWrap = el("label", "field"); nameWrap.style.display = "block"; nameWrap.innerHTML = `<span class="field-label">Audience name *</span>`;
      const nameInp = el("input", "input"); nameInp.value = aud ? aud.name : ""; nameInp.placeholder = "e.g. HVAC leads, VIP customers";
      nameWrap.appendChild(nameInp); card.appendChild(nameWrap);
      card.appendChild(el("div", "field-label", "Who's in this audience"));
      const rules = rulesOf(aud).map((r) => ({ ...r }));
      const countLine = el("div", "cell-muted"); countLine.style.cssText = "font-size:12.5px;margin:6px 0 0";
      const updateCount = () => { const n = App.table.pipeline(contacts, columns, { rules }).length; countLine.textContent = `${n} ${nounLower(n)} match right now.`; };
      const rulesHost = el("div"); rulesHost.appendChild(App.table.ruleEditor(columns, contacts, rules, updateCount)); card.appendChild(rulesHost);
      card.appendChild(countLine); updateCount();
      const bar = el("div"); bar.style.cssText = "display:flex;gap:10px;margin-top:14px";
      const save = el("button", "btn btn-primary", "Save audience");
      const cancel = el("button", "btn btn-ghost", "Cancel"); cancel.onclick = () => renderList();
      save.onclick = async () => {
        const name = nameInp.value.trim(); if (!name) { toast("Please name this audience", true); nameInp.focus(); return; }
        const definition = { rules };
        save.disabled = true;
        try {
          if (aud) await App.portalApi("/api/audiences/" + aud.id, { method: "PATCH", body: JSON.stringify({ name, definition }) });
          else await App.portalApi("/api/audiences", { method: "POST", body: JSON.stringify({ name, definition }) });
          toast("Audience saved"); reload();
        } catch (e) { toast(e.message, true); save.disabled = false; }
      };
      bar.appendChild(save); bar.appendChild(cancel); card.appendChild(bar);
      host.appendChild(card);
    }

    renderList();
  }

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
    // (form `card` is mounted into the right pane below)

    // ----- Template Library (LEFT pane) — SAME card+survey-master treatment as the
    // Surveys library so both panels share identical outer width, top alignment, and
    // height treatment via the shared .survey-split container -----
    const leftPane = el("div", "card survey-master");
    const libHeadRow = el("div"); libHeadRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px";
    const libHead = el("h3", "settings-sub", "Template Library"); libHead.style.margin = "0";
    const libNewBtn = el("button", "btn btn-primary btn-sm", "+ New template");
    libHeadRow.appendChild(libHead); libHeadRow.appendChild(libNewBtn);
    leftPane.appendChild(libHeadRow);
    const libNote = el("div", "cell-muted", "Click a template to edit it. Filter or search — including by tag — to find one.");
    libNote.style.cssText = "font-size:12.5px;margin-bottom:10px"; leftPane.appendChild(libNote);
    const listHost = el("div"); leftPane.appendChild(listHost);

    // ----- Master-detail: library left (~1/3), editor right (~2/3) — mirrors Surveys -----
    const rightPane = el("div", "survey-detail"); rightPane.appendChild(card);
    const split = el("div", "survey-split");
    split.appendChild(leftPane); split.appendChild(rightPane);
    host.appendChild(split);
    libNewBtn.onclick = () => { setEdit(null); card.scrollIntoView({ behavior: "smooth", block: "start" }); };

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
        // Clicking a row opens that template into the right pane (bound to its id);
        // the Edit/Delete buttons still work (onRowClick ignores button clicks).
        onRowClick: (r) => { setEdit(r); card.scrollIntoView({ behavior: "smooth", block: "start" }); },
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
    const fieldCache = {};   // recordType -> field defs (fetched lazily, cached)
    function rtLabel(k) { const d = { contact: "Contact", job: "Job", booking: "Booking" }; return (App.label ? App.label(k, "one") : null) || d[k]; }
    const MAP_TYPES = [["contact", rtLabel("contact")], ["job", rtLabel("job")], ["booking", rtLabel("booking")]];
    async function ensureFields(rt) {
      if (fieldCache[rt]) return fieldCache[rt];
      let list = [];
      try { list = await App.portalApi("/api/fields?recordType=" + encodeURIComponent(rt)); } catch (e) { list = []; }
      fieldCache[rt] = Array.isArray(list) ? list : [];
      return fieldCache[rt];
    }
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

    // ---- Master-detail layout: Surveys Library (left) + workspace (right) ----
    const resultsCard = el("div", "card"); resultsCard.style.cssText = "padding:18px;display:none";

    // Right-pane tab strip — ONLY Build/Results, and only while a survey is open.
    // In create mode it's hidden entirely (never a dead/disabled tab).
    const tabStrip = el("div", "tabs"); tabStrip.style.cssText = "margin-bottom:12px;display:none";
    function setView(v) {
      if (v === "new") setEdit(null); // start clean — no stale id / carried-over questions
      App.util.$$(".tab", tabStrip).forEach((t) => t.classList.toggle("active", t.dataset.v === v));
      const open = !!state.id; // a saved survey is loaded
      tabStrip.style.display = open ? "" : "none";
      card.style.display = v === "results" ? "none" : "";
      resultsCard.style.display = v === "results" ? "" : "none";
      if (v === "results" && state.survey) renderResults(resultsCard, state.survey);
    }
    [["build", "Build"], ["results", "Results"]].forEach(([v, label]) => {
      const t = el("button", "tab" + (v === "build" ? " active" : ""), label); t.dataset.v = v;
      t.onclick = () => setView(v);
      tabStrip.appendChild(t);
    });

    // Left pane — the library list with a clear "+ New survey" affordance.
    const leftPane = el("div", "card survey-master");
    const leftHead = el("div"); leftHead.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px";
    leftHead.appendChild(el("h3", "settings-sub", "Surveys Library")).style.margin = "0";
    const newSurveyBtn = el("button", "btn btn-primary btn-sm", "+ New survey");
    newSurveyBtn.onclick = () => setView("new");
    leftHead.appendChild(newSurveyBtn);
    leftPane.appendChild(leftHead);
    const libNote = el("div", "cell-muted", "Click a survey to edit it, view results, or send. Duplicate one to start from it.");
    libNote.style.cssText = "font-size:12.5px;margin-bottom:10px"; leftPane.appendChild(libNote);
    leftPane.appendChild(listHost);

    // Right pane — the context-driven workspace.
    const rightPane = el("div", "survey-detail");
    rightPane.appendChild(tabStrip);
    rightPane.appendChild(card);
    rightPane.appendChild(resultsCard);

    const split = el("div", "survey-split");
    split.appendChild(leftPane); split.appendChild(rightPane);
    host.appendChild(split);

    function blankQuestion() { return { lid: lidSeq++, type: "short_text", label: "", helpText: "", required: false, config: {}, mapFieldKey: null, mapRecordType: null }; }
    function defaultConfigFor(type, prev) {
      if (type === "single_select" || type === "multi_select") return { options: (prev && Array.isArray(prev.options) && prev.options.length) ? prev.options.slice() : ["Option 1", "Option 2"] };
      if (type === "rating") return { min: (prev && prev.min) || 1, max: (prev && prev.max) || 5, step: (prev && prev.step) || 1 };
      return {};
    }
    function compatFieldsFor(type, rt) { const allow = MAP_COMPAT[type] || []; return (fieldCache[rt] || []).filter((f) => allow.includes(f.type)); }
    function anyMapped() { return state.qs.some((q) => q.mapFieldKey); }

    function updateWarn() {
      if (!mapWarn) return;
      if (anyMapped()) { mapWarn.style.display = ""; mapWarn.textContent = "This survey maps answers to fields. Mapped answers are written only when you send it as an email blast (each recipient gets a personal link). An anonymous/public link still collects answers but won't write them to any record."; }
      else mapWarn.style.display = "none";
    }
    function paintQuestions() {
      qListHost.innerHTML = "";
      updateWarn();
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
        const rtSel = el("select", "input"); rtSel.style.cssText = "flex:0 0 160px";
        const noMap = el("option", null, "— don't map (collect only) —"); noMap.value = ""; rtSel.appendChild(noMap);
        MAP_TYPES.forEach(([key, label]) => { const o = el("option", null, label); o.value = key; rtSel.appendChild(o); });
        rtSel.value = q.mapRecordType || (q.mapFieldKey ? "contact" : "");
        const fieldSel = el("select", "input"); fieldSel.style.cssText = "flex:1;min-width:170px";
        const jbNote = el("div", "cell-muted"); jbNote.style.cssText = "font-size:12px;margin-top:6px;display:none";
        jbNote.textContent = "Job/booking answers are saved with the response and will write to the record when a survey is sent from a specific job or booking (coming soon).";
        // Selecting a record type fetches THAT type's fields (lazily, cached) and fills
        // the field dropdown in place — no full repaint, so the choice sticks.
        async function fillFields() {
          const rt = rtSel.value;
          jbNote.style.display = (rt === "job" || rt === "booking") ? "" : "none";
          if (!rt) { fieldSel.innerHTML = ""; const o = el("option", null, "Collect only (not saved to a field)"); o.value = ""; fieldSel.appendChild(o); fieldSel.disabled = true; return; }
          fieldSel.disabled = true; fieldSel.innerHTML = `<option>Loading…</option>`;
          await ensureFields(rt);
          fieldSel.innerHTML = ""; fieldSel.disabled = false;
          const none2 = el("option", null, "— choose a field —"); none2.value = ""; fieldSel.appendChild(none2);
          const compat = compatFieldsFor(q.type, rt);
          compat.forEach((f) => { const o = el("option", null, `${f.label} (${f.type})`); o.value = f.key; fieldSel.appendChild(o); });
          if (!compat.length) { const o = el("option", null, "No compatible fields for this question type"); o.value = ""; o.disabled = true; fieldSel.appendChild(o); }
          fieldSel.value = (q.mapFieldKey && (q.mapRecordType || "contact") === rt) ? q.mapFieldKey : "";
        }
        rtSel.onchange = () => { q.mapRecordType = rtSel.value || null; q.mapFieldKey = null; fillFields(); updateWarn(); };
        fieldSel.onchange = () => { q.mapFieldKey = fieldSel.value || null; q.mapRecordType = fieldSel.value ? (rtSel.value || "contact") : (rtSel.value || null); updateWarn(); };
        mapRow.appendChild(rtSel); mapRow.appendChild(fieldSel);
        mapWrap.appendChild(mapRow); mapWrap.appendChild(jbNote);
        fillFields();
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
      } else {
        shareWrap.style.display = "none";
        responsesHost.innerHTML = "";
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
    newBtn.onclick = () => setView("new");
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
        if (wasCreate) setView("new");
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

      // audience — pick one or more saved Audiences (resolved to current contacts at send time,
      // each gets their own personal link). Shared selector, same one the Email tab uses.
      body.appendChild(el("div", "field-label", "Audience"));
      const audienceHost = el("div"); body.appendChild(audienceHost);
      const audSelect = App.audienceSelect.mount(audienceHost, { emailableOnly: true });

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
        const audienceIds = audSelect.getSelectedIds();
        const previewIds = audSelect.getResolvedContactIds();
        if (!audienceIds.length) { toast("Pick at least one audience to send to.", true); return; }
        if (!previewIds.length) { toast("The selected audience(s) match nobody with an email right now.", true); return; }
        const empties = audSelect.getEmptySelected();
        const emptyNote = empties.length ? ` Note: ${empties.map((n) => `“${n}”`).join(", ")} match${empties.length === 1 ? "es" : ""} nobody right now.` : "";
        const ok = await App.ui.confirmModal({
          title: "Send this survey?",
          message: `You're about to send “${survey.name}” to ${previewIds.length} ${previewIds.length === 1 ? "person" : "people"} from ${audienceIds.length} audience${audienceIds.length === 1 ? "" : "s"}. Recipients are resolved now, and each gets their own link.${emptyNote} Send?`,
          confirmText: "Send",
        });
        if (!ok) return;
        send.disabled = true; send.textContent = "Sending…";
        try {
          const res = await App.portalApi("/api/surveys/" + encodeURIComponent(survey.id) + "/send", { method: "POST", body: JSON.stringify({ subject: c.subject, html: c.html, audienceIds }) });
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
      try { const full = await App.portalApi("/api/surveys/" + encodeURIComponent(id)); setEdit(full); setView("build"); card.scrollIntoView({ behavior: "smooth", block: "start" }); }
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
        // Prime the field cache so the builder's mapping dropdowns populate instantly.
        fieldCache.contact = Array.isArray(fContact) ? fContact : [];
        fieldCache.job = Array.isArray(fJob) ? fJob : [];
        fieldCache.booking = Array.isArray(fBooking) ? fBooking : [];
        void rTypes;
      } catch (e) { listHost.innerHTML = `<div class="cell-muted" style="padding:8px">${esc(e.message)}</div>`; return; }
      listHost.innerHTML = "";
      const statusPill = (s) => `<span class="pill ${s === "active" ? "success" : s === "closed" ? "skipped" : ""}">${esc(s.charAt(0).toUpperCase() + s.slice(1))}</span>`;
      const columns = [
        { key: "name", label: "Name", type: "text", get: (r) => r.name, render: (r) => `<span class="cell-strong">${esc(r.name || "—")}</span>` },
        { key: "status", label: "Status", type: "text", get: (r) => r.status, render: (r) => statusPill(r.status) },
        { key: "responseCount", label: "Responses", type: "text", get: (r) => String(r.responseCount || 0), render: (r) => `<span class="cell-muted">${r.responseCount || 0}</span>` },
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

    setView("new");
    load();
  }

  App.communication = { render: renderCommunication, composeTo };
})(typeof window !== "undefined" ? window : globalThis);
