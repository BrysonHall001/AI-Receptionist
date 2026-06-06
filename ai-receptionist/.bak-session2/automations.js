// Automations tab: manage event-driven workflows (trigger -> conditions ->
// actions), toggle them on/off, test them, and inspect execution + event logs.
//
// This screen was rebuilt into a vertical "workflow-builder" layout: a single
// trigger at the top, optional conditions, then one or more actions, shown as a
// connected flow with plain-English labels. It is wired ONLY to the triggers and
// actions that already exist in the system (see /api/automations/meta) — no new
// trigger types or action types were added, and no database changes were made.
//
// Conditions reuse App.table.ruleEditor so they behave exactly like the filters
// users already know from Contacts/Reports.
(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, toast } = App.util;

  let meta = null;
  let contacts = [];
  let automations = [];
  let host = null;
  let tab = "workflows";

  // Inject the builder's styles once. Kept in this file so the whole rebuild is
  // one self-contained change (nothing to edit in the global stylesheet). Uses
  // the app's existing CSS variables, so it follows the active theme.
  function ensureStyles() {
    if (document.getElementById("wf-builder-styles")) return;
    const css = `
.modal-builder { max-width: 720px; }
.wf-name-row { margin-bottom: 18px; }
.wf-builder { display: block; }
.wf-step { display: block; }
.wf-step-head { display: flex; align-items: baseline; gap: 9px; margin-bottom: 8px; flex-wrap: wrap; }
.wf-badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 9px; border-radius: 999px; background: var(--gray-soft); color: var(--ink-soft); flex: 0 0 auto; }
.wf-badge.trigger { background: var(--accent-soft); color: var(--accent); }
.wf-badge.conditions { background: var(--amber-soft); color: var(--amber); }
.wf-badge.actions { background: var(--green-soft); color: var(--green); }
.wf-step-title { font-size: 14px; font-weight: 700; color: var(--ink); }
.wf-step-opt { font-size: 11.5px; font-weight: 600; color: var(--ink-faint); }
.wf-hint { font-size: 12px; color: var(--ink-faint); margin: 0 0 9px; }
.wf-node { border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); padding: 14px; }
.wf-node.trigger-node { background: var(--accent-soft); border-color: transparent; }
.wf-node .input { margin-bottom: 0; }
.wf-connector { height: 22px; margin: 3px 0 3px 14px; border-left: 2px solid var(--line-strong); }
.wf-actions-list { display: block; }
.wf-action { border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--panel-2); padding: 12px; }
.wf-action-head { display: flex; gap: 8px; align-items: center; }
.wf-action-num { width: 22px; height: 22px; flex: 0 0 auto; border-radius: 50%; background: var(--green-soft); color: var(--green); font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.wf-action-head .input { margin-bottom: 0; }
.wf-action-cfg { margin-top: 10px; }
.wf-action-cfg .input { margin-bottom: 8px; }
.wf-action-cfg textarea.input { min-height: 70px; resize: vertical; }
.wf-empty-actions { font-size: 12.5px; color: var(--ink-faint); padding: 4px 0 2px; }
`;
    const style = el("style");
    style.id = "wf-builder-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function render(target) {
    ensureStyles();
    host = target;
    host.innerHTML = "";
    const head = el("div", "page-head");
    head.innerHTML = `<div><h1 class="page-title">Automations</h1>
      <p class="page-sub">Run actions automatically when things happen in your CRM.</p></div>`;
    const newBtn = el("button", "btn btn-primary", "+ New automation");
    newBtn.onclick = () => openEditor(null);
    head.appendChild(newBtn);
    host.appendChild(head);

    const nav = el("div", "subnav");
    [["workflows", "Workflows"], ["runs", "Execution log"], ["events", "Event log"]].forEach(([key, label]) => {
      const b = el("button", "subnav-item" + (tab === key ? " active" : ""), label);
      b.onclick = () => { tab = key; render(host); };
      nav.appendChild(b);
    });
    host.appendChild(nav);

    const body = el("div", "automations-body");
    body.innerHTML = `<div class="cell-muted" style="padding:24px">Loading…</div>`;
    host.appendChild(body);

    try {
      if (!meta) meta = await App.portalApi("/api/automations/meta");
      if (tab === "workflows") {
        [automations, contacts] = await Promise.all([
          App.portalApi("/api/automations"),
          contacts.length ? Promise.resolve(contacts) : App.portalApi("/api/contacts"),
        ]);
        renderWorkflows(body);
      } else if (tab === "runs") {
        renderRuns(body);
      } else {
        renderEvents(body);
      }
    } catch (e) {
      body.innerHTML = `<div class="cell-muted" style="padding:24px">${esc(e.message)}</div>`;
    }
  }

  function triggerLabel(type) {
    const t = (meta.triggers || []).find((x) => x.type === type);
    return t ? t.label : type;
  }
  function actionLabel(type) {
    const a = (meta.actions || []).find((x) => x.type === type);
    return a ? a.label : type;
  }

  // ---------------- Workflows list ----------------
  function renderWorkflows(body) {
    body.innerHTML = "";
    if (!automations.length) {
      body.innerHTML = `<div class="empty-state"><p>No automations yet.</p>
        <p class="cell-muted">Create one to send a welcome email, tag leads, assign owners, and more.</p></div>`;
      return;
    }
    automations.forEach((a) => body.appendChild(workflowCard(a)));
  }

  function workflowCard(a) {
    const card = el("div", "card auto-card");
    const top = el("div", "auto-card-head");

    const left = el("div", "auto-card-main");
    left.innerHTML = `<div class="auto-name">${esc(a.name)}</div>
      <div class="auto-meta">When <strong>${esc(triggerLabel(a.triggerType))}</strong>
      · ${(a.conditions || []).filter(rc).length} condition(s)
      · ${(a.actions || []).length} action(s)</div>
      <div class="auto-actions-list">${(a.actions || []).map((x) => `<span class="pill">${esc(actionLabel(x.type))}</span>`).join("") || '<span class="cell-muted">No actions</span>'}</div>`;
    top.appendChild(left);

    const toggle = el("label", "switch");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!a.enabled;
    cb.onchange = async () => {
      try {
        await App.portalApi(`/api/automations/${a.id}`, { method: "PATCH", body: JSON.stringify({ enabled: cb.checked }) });
        a.enabled = cb.checked;
        toast(cb.checked ? "Automation enabled" : "Automation disabled");
      } catch (e) { cb.checked = !cb.checked; toast(e.message, true); }
    };
    toggle.appendChild(cb);
    toggle.appendChild(el("span", "switch-track"));
    top.appendChild(toggle);
    card.appendChild(top);

    const actions = el("div", "auto-card-foot");
    const edit = el("button", "btn btn-ghost btn-sm", "Edit");
    edit.onclick = () => openEditor(a);
    const test = el("button", "btn btn-ghost btn-sm", "Test");
    test.onclick = () => openTest(a);
    const logs = el("button", "btn btn-ghost btn-sm", "Logs");
    logs.onclick = () => { tab = "runs"; render(host).then(() => filterRuns(a.id)); };
    const del = el("button", "link-danger", "Delete");
    del.onclick = async () => {
      if (!confirm(`Delete automation “${a.name}”?`)) return;
      try { await App.portalApi(`/api/automations/${a.id}`, { method: "DELETE" }); toast("Deleted"); render(host); }
      catch (e) { toast(e.message, true); }
    };
    [edit, test, logs, del].forEach((b) => actions.appendChild(b));
    card.appendChild(actions);
    return card;
  }

  function rc(rule) { return App.table.ruleComplete(rule); }

  // ---------------- Condition columns (for ruleEditor) ----------------
  function buildColumns() {
    return (meta.fields || []).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type === "percent" ? "number" : (f.type === "date" ? "date" : (f.type === "number" ? "number" : "text")),
      get: (row) => valueOf(row, f.key),
      text: (row) => scalar(valueOf(row, f.key)),
    }));
  }
  function valueOf(row, key) {
    if (key === "createdAt") return row.createdAt;
    if (["name", "phone", "email", "intent"].includes(key)) return row[key];
    return (row.customFields || {})[key];
  }
  function scalar(v) { return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v); }

  // ---------------- Editor: vertical workflow builder ----------------
  // Layout: [Name] then a top-to-bottom flow — TRIGGER -> CONDITIONS (optional)
  // -> ACTIONS — connected by simple connector lines. Same data, same save
  // payload, same API as before; only the presentation changed.
  function openEditor(existing) {
    const draft = existing
      ? { id: existing.id, name: existing.name, triggerType: existing.triggerType, conditions: (existing.conditions || []).map((r) => ({ ...r })), actions: (existing.actions || []).map((a) => ({ type: a.type, config: { ...(a.config || {}) } })) }
      : { name: "", triggerType: (meta.triggers[0] && meta.triggers[0].type) || "ContactCreated", conditions: [], actions: [] };

    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>${existing ? "Edit automation" : "New automation"}</h2><button class="icon-btn" id="a-close">&times;</button></div>`;
    const bodyEl = el("div", "modal-body");
    inner.appendChild(bodyEl);

    // --- Name ---
    const nameRow = el("div", "wf-name-row");
    nameRow.appendChild(label("Automation name"));
    const nameInp = el("input", "input");
    nameInp.value = draft.name;
    nameInp.placeholder = "e.g. Welcome new leads";
    nameInp.oninput = () => { draft.name = nameInp.value; };
    nameRow.appendChild(nameInp);
    bodyEl.appendChild(nameRow);

    // --- The flow ---
    const flow = el("div", "wf-builder");
    bodyEl.appendChild(flow);

    // STEP 1: Trigger
    flow.appendChild(stepHead("trigger", "TRIGGER", "When this happens", null));
    flow.appendChild(hint("Choose the event that starts this workflow."));
    const trigNode = el("div", "wf-node trigger-node");
    const trig = el("select", "input");
    (meta.triggers || []).forEach((t) => { const o = el("option", null, esc(t.label)); o.value = t.type; if (t.type === draft.triggerType) o.selected = true; trig.appendChild(o); });
    trig.onchange = () => { draft.triggerType = trig.value; };
    trigNode.appendChild(trig);
    flow.appendChild(trigNode);

    flow.appendChild(connector());

    // STEP 2: Conditions (optional)
    flow.appendChild(stepHead("conditions", "CONDITIONS", "Only continue if…", "optional"));
    flow.appendChild(hint("All conditions must match. Use OR to start a new group. Leave empty to always run."));
    const condNode = el("div", "wf-node");
    condNode.appendChild(App.table.ruleEditor(buildColumns(), contacts, draft.conditions, () => {}));
    flow.appendChild(condNode);

    flow.appendChild(connector());

    // STEP 3: Actions
    flow.appendChild(stepHead("actions", "ACTIONS", "Then do this", null));
    flow.appendChild(hint("These run in order, top to bottom, when the trigger fires and the conditions match."));
    const actionsWrap = el("div", "wf-actions-list");
    flow.appendChild(actionsWrap);

    function redrawActions() {
      actionsWrap.innerHTML = "";
      if (!draft.actions.length) {
        actionsWrap.appendChild(el("div", "wf-empty-actions", "No actions yet — add at least one below."));
      }
      draft.actions.forEach((act, i) => {
        if (i > 0) actionsWrap.appendChild(connector());
        actionsWrap.appendChild(actionRow(act, i, draft, redrawActions));
      });
      actionsWrap.appendChild(connector());
      const add = el("button", "rail-add", "+ Add action");
      add.onclick = () => { draft.actions.push({ type: meta.actions[0].type, config: {} }); redrawActions(); };
      actionsWrap.appendChild(add);
    }
    redrawActions();

    // --- Save bar ---
    const bar = el("div", "modal-savebar");
    const cancel = el("button", "btn btn-ghost", "Cancel");
    const save = el("button", "btn btn-primary", existing ? "Save changes" : "Create automation");
    bar.appendChild(cancel); bar.appendChild(save);
    bodyEl.appendChild(bar);

    const overlay = modal(inner, "modal-builder");
    inner.querySelector("#a-close").onclick = () => overlay.remove();
    cancel.onclick = () => overlay.remove();
    save.onclick = async () => {
      if (!draft.name.trim()) { toast("Give it a name", true); return; }
      const payload = { name: draft.name.trim(), triggerType: draft.triggerType, conditions: draft.conditions.filter(rc), actions: draft.actions };
      try {
        if (existing) await App.portalApi(`/api/automations/${existing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        else await App.portalApi("/api/automations", { method: "POST", body: JSON.stringify(payload) });
        toast("Saved");
        overlay.remove();
        render(host);
      } catch (e) { toast(e.message, true); }
    };
  }

  // A step header: colored badge + plain-English title (+ optional "optional" tag)
  function stepHead(kind, badgeText, title, optional) {
    const head = el("div", "wf-step-head");
    head.appendChild(el("span", "wf-badge " + kind, esc(badgeText)));
    head.appendChild(el("span", "wf-step-title", esc(title)));
    if (optional) head.appendChild(el("span", "wf-step-opt", esc(optional)));
    return head;
  }
  function connector() { return el("div", "wf-connector"); }

  // One action row with type-specific config, shown as a numbered flow node.
  function actionRow(act, idx, draft, redraw) {
    const row = el("div", "wf-action");
    const head = el("div", "wf-action-head");
    head.appendChild(el("span", "wf-action-num", String(idx + 1)));
    const sel = el("select", "input");
    (meta.actions || []).forEach((a) => { const o = el("option", null, esc(a.label)); o.value = a.type; if (a.type === act.type) o.selected = true; sel.appendChild(o); });
    sel.onchange = () => { act.type = sel.value; act.config = {}; redraw(); };
    head.appendChild(sel);
    const rm = el("button", "rule-remove", "&times;");
    rm.onclick = () => { draft.actions.splice(idx, 1); redraw(); };
    head.appendChild(rm);
    row.appendChild(head);

    const cfg = el("div", "wf-action-cfg");
    buildActionConfig(act, cfg);
    row.appendChild(cfg);
    return row;
  }

  function buildActionConfig(act, cfg) {
    const c = act.config || (act.config = {});
    const text = (key, ph, big) => {
      const i = el(big ? "textarea" : "input", "input");
      if (ph) i.placeholder = ph;
      i.value = c[key] || "";
      i.oninput = () => { c[key] = i.value; };
      return i;
    };
    const selectOf = (key, options, ph) => {
      const s = el("select", "input");
      const blank = el("option", null, ph || "— choose —"); blank.value = ""; s.appendChild(blank);
      options.forEach((o) => { const op = el("option", null, esc(o.label)); op.value = o.value; if (c[key] === o.value) op.selected = true; s.appendChild(op); });
      s.onchange = () => { c[key] = s.value; };
      return s;
    };

    if (act.type === "send_email") {
      const tpls = (meta.templates || []).filter((t) => t.kind === "email").map((t) => ({ value: t.id, label: t.name }));
      if (tpls.length) { cfg.appendChild(small("Template (optional — fills subject/body)")); cfg.appendChild(selectOf("templateId", tpls)); }
      cfg.appendChild(small("Subject")); cfg.appendChild(text("subject", "Welcome, {{name}}!"));
      cfg.appendChild(small("Body (HTML, supports {{field}})")); cfg.appendChild(text("html", "Hi {{name}}, thanks for reaching out.", true));
    } else if (act.type === "send_sms") {
      const tpls = (meta.templates || []).filter((t) => t.kind === "sms").map((t) => ({ value: t.id, label: t.name }));
      if (tpls.length) { cfg.appendChild(small("Template (optional)")); cfg.appendChild(selectOf("templateId", tpls)); }
      cfg.appendChild(small("Message (supports {{field}})")); cfg.appendChild(text("body", "Hi {{name}}!", true));
    } else if (act.type === "update_field") {
      const writable = (meta.fields || []).filter((f) => f.key !== "createdAt" && f.type !== "formula" && f.type !== "image").map((f) => ({ value: f.key, label: f.label }));
      cfg.appendChild(small("Field")); cfg.appendChild(selectOf("field", writable));
      cfg.appendChild(small("Set to (supports {{field}})")); cfg.appendChild(text("value", "value"));
    } else if (act.type === "add_tag" || act.type === "remove_tag") {
      const tagFields = (meta.tagFields || []).map((f) => ({ value: f.key, label: f.label }));
      if (!tagFields.length) { cfg.appendChild(small("No multi-select (tag) fields exist. Create one under Fields first.")); return; }
      cfg.appendChild(small("Tag field")); cfg.appendChild(selectOf("field", tagFields));
      cfg.appendChild(small("Tag value")); cfg.appendChild(text("value", "VIP"));
    } else if (act.type === "create_note") {
      cfg.appendChild(small("Note (supports {{field}})")); cfg.appendChild(text("text", "Lead came in via automation", true));
    } else if (act.type === "assign_owner") {
      const users = (meta.users || []).map((u) => ({ value: u.id, label: u.name }));
      cfg.appendChild(small("Owner")); cfg.appendChild(selectOf("userId", users));
    }
  }

  // ---------------- Test run ----------------
  function openTest(a) {
    if (!contacts.length) { toast("No contacts to test against", true); return; }
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Test “${esc(a.name)}”</h2><button class="icon-btn" id="t-close">&times;</button></div>`;
    const b = el("div", "modal-body");
    b.appendChild(small("Run this automation against a contact now. Conditions are still evaluated; actions will really run (emails/SMS respect mock mode)."));
    const sel = el("select", "input");
    contacts.slice(0, 500).forEach((c) => { const o = el("option", null, esc(c.name || c.phone || c.id)); o.value = c.id; sel.appendChild(o); });
    b.appendChild(label("Contact"));
    b.appendChild(sel);
    const out = el("div", "test-out");
    b.appendChild(out);
    const bar = el("div", "modal-savebar");
    const run = el("button", "btn btn-primary", "Run test");
    bar.appendChild(run);
    b.appendChild(bar);
    inner.appendChild(b);
    const overlay = modal(inner);
    inner.querySelector("#t-close").onclick = () => overlay.remove();
    run.onclick = async () => {
      out.innerHTML = `<div class="cell-muted">Running…</div>`;
      try {
        const res = await App.portalApi(`/api/automations/${a.id}/test`, { method: "POST", body: JSON.stringify({ contactId: sel.value }) });
        out.innerHTML = "";
        out.appendChild(runDetail(res));
      } catch (e) { out.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; }
    };
  }

  // ---------------- Execution log ----------------
  let runFilter = null;
  async function renderRuns(body) {
    body.innerHTML = `<div class="cell-muted" style="padding:24px">Loading…</div>`;
    const path = runFilter ? `/api/automations/runs?automationId=${encodeURIComponent(runFilter)}` : "/api/automations/runs";
    const runs = await App.portalApi(path);
    body.innerHTML = "";
    if (runFilter) {
      const clear = el("button", "btn btn-ghost btn-sm", "← All runs");
      clear.onclick = () => { runFilter = null; renderRuns(body); };
      body.appendChild(clear);
    }
    if (!runs.length) { body.appendChild(el("div", "cell-muted", "No runs yet.")); return; }
    const list = el("div", "log-list");
    runs.forEach((r) => list.appendChild(runDetail(r)));
    body.appendChild(list);
  }
  function filterRuns(id) { runFilter = id; const body = host.querySelector(".automations-body"); if (body) renderRuns(body); }

  function runDetail(r) {
    const auto = automations.find((a) => a.id === r.automationId);
    const row = el("div", "log-item");
    const badge = `<span class="status-dot ${r.status}"></span>`;
    const results = (r.results || []).map((x) => `<span class="pill ${x.status}">${esc(actionLabel(x.type))}: ${esc(x.status)}${x.detail ? " — " + esc(x.detail) : ""}${x.error ? " — " + esc(x.error) : ""}</span>`).join(" ");
    row.innerHTML = `<div class="log-line">${badge}<strong>${esc(auto ? auto.name : r.automationId)}</strong>
      <span class="cell-muted">· ${esc(r.eventType || "")} · ${r.matched ? "matched" : "skipped (conditions not met)"}</span>
      <span class="log-time">${fmt(r.createdAt)}</span></div>
      ${results ? `<div class="log-results">${results}</div>` : ""}
      ${r.error ? `<div class="log-err">${esc(r.error)}</div>` : ""}`;
    return row;
  }

  // ---------------- Event log ----------------
  async function renderEvents(body) {
    body.innerHTML = `<div class="cell-muted" style="padding:24px">Loading…</div>`;
    const events = await App.portalApi("/api/automations/events");
    body.innerHTML = "";
    if (!events.length) { body.appendChild(el("div", "cell-muted", "No events yet.")); return; }
    const list = el("div", "log-list");
    events.forEach((e) => {
      const row = el("div", "log-item");
      row.innerHTML = `<div class="log-line"><span class="pill">${esc(e.type)}</span>
        <span class="cell-muted">by ${esc(e.actorName || e.actorType)}</span>
        <span class="log-time">${fmt(e.occurredAt)}</span></div>`;
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  // ---------------- helpers ----------------
  function label(t) { return el("label", "field-label", esc(t)); }
  function small(t) { const s = el("div", "cfg-label"); s.textContent = t; return s; }
  function hint(t) { const d = el("div", "wf-hint"); d.textContent = t; return d; }
  function fmt(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso; } }
  function modal(inner, extraClass) {
    const overlay = el("div", "modal-overlay");
    const box = el("div", "modal modal-wide" + (extraClass ? " " + extraClass : ""));
    box.appendChild(inner);
    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    return overlay;
  }

  App.automations = { render };
})(typeof window !== "undefined" ? window : globalThis);
