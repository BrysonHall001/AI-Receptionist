// Automations tab: manage event-driven workflows (trigger -> conditions ->
// actions), toggle them on/off, test them, and inspect execution + event logs.
//
// This screen was rebuilt into a vertical "workflow-builder" layout: a single
// trigger at the top, optional conditions, then one or more actions, shown as a
// connected flow with plain-English labels. It is wired to the triggers and
// actions that exist in the system (see /api/automations/meta); this batch adds
// one trigger (enroll an audience) and surfaces the Send-survey / Unenroll actions,
// all backed by the existing engine (no separate execution path).
//
// Conditions reuse App.table.ruleEditor so they behave exactly like the filters
// users already know from Contacts/Reports.
//
// DRIPS <-> AUTOMATIONS BOUNDARY (one system, one engine): the wizard here builds
// LINEAR automations and is now audience-aware — you can enroll an audience as a
// trigger ("EnrollAudience:<id>") and condition on audience membership ("contact
// is in Audience X"). Drips are the VISUAL superset: the same triggers, conditions,
// and actions on a canvas that can also BRANCH; a branched drip compiles to a
// pairId-linked automation pair. Both produce ordinary Automation rows and run
// through the SAME engine (handleEvent / runManualAutomation / enrollAudience-
// InAutomation) — there is no second engine. Drip-generated automations are
// labeled "From drip" here with a link back to the drip editor (the drip is their
// source of truth); a wizard-authored automation is just a plain automation.
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
.subnav-caption { font-size: 12.5px; color: var(--ink-faint); margin: -10px 0 16px; }
.wf-process-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.wf-process-note { font-size: 12px; color: var(--ink-faint); }
.job-item { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px 12px; background: var(--panel); display: flex; align-items: center; gap: 10px; }
.job-main { min-width: 0; flex: 1; }
.job-desc { font-size: 13px; color: var(--ink); }
.job-sub { font-size: 12px; color: var(--ink-faint); margin-top: 2px; }
.job-err { font-size: 12px; color: var(--red); margin-top: 3px; }
.status-dot.pending { background: var(--ink-faint); }
.status-dot.done { background: var(--green); }
.status-dot.canceled { background: var(--amber); }

/* ----- "Start from a template" entry row (two-up) ----- */
.tpl-entry-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
.tpl-entry-card { display: flex; align-items: center; gap: 13px; padding: 15px 16px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--panel); cursor: pointer; transition: border-color .12s ease, box-shadow .12s ease, transform .04s ease; }
.tpl-entry-card:hover { border-color: var(--accent); box-shadow: var(--shadow); }
.tpl-entry-card:active { transform: translateY(1px); }
.tpl-entry-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tpl-entry-card.disabled { cursor: default; opacity: 0.72; background: var(--panel-2); border-style: dashed; }
.tpl-entry-card.disabled:hover { border-color: var(--line-strong); box-shadow: none; }
.tpl-entry-icon { flex: 0 0 auto; width: 38px; height: 38px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; }
.tpl-entry-card.disabled .tpl-entry-icon { background: var(--gray-soft); color: var(--ink-faint); }
.tpl-entry-main { min-width: 0; flex: 1; }
.tpl-entry-title { font-size: 14px; font-weight: 700; color: var(--ink); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tpl-entry-sub { font-size: 12.5px; color: var(--ink-faint); margin-top: 2px; }
.tpl-entry-cta { flex: 0 0 auto; font-size: 12.5px; font-weight: 700; color: var(--accent); }
.tpl-soon { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 7px; border-radius: 999px; background: var(--gray-soft); color: var(--ink-faint); }

/* ----- Presets library ----- */
.preset-cat-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); margin: 18px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.preset-cat-head:first-of-type { margin-top: 8px; }
.preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(238px, 1fr)); gap: 12px; }
.preset-card { display: flex; flex-direction: column; gap: 11px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--panel); padding: 14px; cursor: pointer; transition: border-color .12s ease, box-shadow .12s ease; }
.preset-card:hover { border-color: var(--accent); box-shadow: var(--shadow); }
.preset-name { font-size: 14px; font-weight: 700; color: var(--ink); }
.preset-desc { font-size: 12.5px; color: var(--ink-soft); margin-top: 3px; line-height: 1.45; }
.preset-shape { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.shape-chip { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.shape-chip.trigger { background: var(--accent-soft); color: var(--accent); }
.shape-chip.action { background: var(--green-soft); color: var(--green); }
.shape-arrow { display: inline-flex; color: var(--ink-faint); }
.preset-missing { font-size: 11.5px; font-weight: 600; color: var(--amber); background: var(--amber-soft); border-radius: var(--radius-sm); padding: 5px 9px; }
.preset-card-foot { display: flex; gap: 7px; margin-top: auto; }
.preset-card-foot .btn { flex: 1; justify-content: center; }

/* ----- Preset preview (inside the same library modal) ----- */
.preset-pv-head { margin: 12px 0 14px; }
.preset-pv-title { font-size: 17px; font-weight: 700; color: var(--ink); }
.preset-pv-desc { font-size: 13px; color: var(--ink-soft); margin-top: 4px; line-height: 1.5; }
.preset-pv-section { border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel-2); padding: 13px 14px; margin-top: 13px; }
.pv-block { display: flex; gap: 12px; padding: 5px 0; }
.pv-block + .pv-block { border-top: 1px solid var(--line); }
.pv-k { flex: 0 0 54px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); padding-top: 2px; }
.pv-v { font-size: 13px; color: var(--ink); min-width: 0; }
.pv-v ul { margin: 0; padding-left: 18px; }
.pv-v li { margin: 2px 0; }
.field-flags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.field-flag { font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; }
.field-flag.ok { background: var(--green-soft); color: var(--green); }
.field-flag.missing { background: var(--amber-soft); color: var(--amber); }
.pv-warn { font-size: 12.5px; color: var(--amber); margin: 10px 0 0; line-height: 1.5; }

/* ----- Editor warning banner (applied preset that needs a field) ----- */
.wf-warnbar { font-size: 12.5px; color: var(--ink); line-height: 1.5; background: var(--amber-soft); border: 1px solid var(--amber); border-radius: var(--radius-sm); padding: 11px 13px; margin-bottom: 16px; }
.wf-warnbar strong { color: var(--amber); }

@media (max-width: 640px) {
  .tpl-entry-row { grid-template-columns: 1fr; }
  .preset-grid { grid-template-columns: 1fr; }
}

/* ----- Branching wizard ----- */
.wiz-steps { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
.wiz-step-pill { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: var(--gray-soft); color: var(--ink-faint); white-space: nowrap; }
.wiz-step-pill.active { background: var(--accent-soft); color: var(--accent); }
.wiz-step-pill.done { background: var(--green-soft); color: var(--green); }
.wiz-q { font-size: 15px; font-weight: 700; color: var(--ink); margin: 0 0 4px; }
.wiz-sub { font-size: 12.5px; color: var(--ink-faint); margin: 0 0 14px; line-height: 1.5; }
.wiz-cond-row { display: flex; gap: 6px; margin-bottom: 8px; align-items: center; flex-wrap: wrap; }
.wiz-cond-row .input { margin-bottom: 0; }
.wiz-cond-row select.input, .wiz-cond-row input.input { flex: 1 1 110px; min-width: 0; }
.wiz-choice { display: flex; gap: 10px; }
.wiz-choice-card { flex: 1; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 16px 14px; cursor: pointer; text-align: center; font-weight: 700; font-size: 13.5px; color: var(--ink-soft); transition: border-color .12s ease, background .12s ease; }
.wiz-choice-card:hover { border-color: var(--accent); }
.wiz-choice-card.sel { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.wiz-choice-sub { display: block; font-size: 11.5px; font-weight: 500; color: var(--ink-faint); margin-top: 4px; }
.wiz-choice-card.sel .wiz-choice-sub { color: var(--accent); }
.wiz-path { border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel-2); padding: 13px; margin-bottom: 12px; }
.wiz-path-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-faint); margin-bottom: 9px; }
.wiz-path-title .b { color: var(--accent); text-transform: none; letter-spacing: 0; }
.wiz-action-list .wf-action { margin-bottom: 8px; }
.wiz-review-block { border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel-2); padding: 12px 14px; margin-bottom: 12px; }
.wiz-review-block ul { margin: 4px 0 0; padding-left: 18px; }
.wiz-review-block li { margin: 2px 0; font-size: 13px; color: var(--ink); }
.wiz-note { font-size: 12.5px; color: var(--amber); background: var(--amber-soft); border-radius: var(--radius-sm); padding: 9px 12px; line-height: 1.5; }
.wiz-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 18px; }
.wiz-foot .wiz-foot-right { display: flex; gap: 8px; margin-left: auto; }

/* ----- Wizard branch pair linking (list) ----- */
.pair-group { border: 1px solid var(--accent); border-radius: var(--radius); padding: 10px 10px 2px; margin-bottom: 12px; background: var(--accent-soft); }
.pair-group.soft { border-color: var(--line-strong); border-style: dashed; background: var(--panel-2); }
.pair-group-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 2px 4px 8px; }
.pair-badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--accent); display: inline-flex; align-items: center; gap: 5px; }
.pair-badge.soft { color: var(--ink-faint); }
.pair-group-note { font-size: 12px; color: var(--ink-faint); }
.pair-group .auto-card { margin-bottom: 8px; }
.pair-pill { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); vertical-align: 1px; margin-left: 6px; }
.pair-pill.soft { background: var(--gray-soft); color: var(--ink-faint); }
.pair-warn { font-size: 12.5px; color: var(--ink); line-height: 1.5; background: var(--amber-soft); border: 1px solid var(--amber); border-radius: var(--radius-sm); padding: 9px 12px; margin: 0 0 12px; }
.pair-orphan-note { font-size: 12px; color: var(--ink-faint); margin: 0 0 12px; }

/* ----- Automations list toolbar (read-only view controls) ----- */
.auto-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.auto-toolbar .input { margin-bottom: 0; width: auto; font-size: 13px; padding: 8px 11px; }
.auto-toolbar .auto-search { flex: 1 1 200px; min-width: 140px; }
.auto-toolbar select.input { cursor: pointer; }
.auto-toolbar .btn { flex: 0 0 auto; }
.auto-count { font-size: 12.5px; color: var(--ink-faint); margin-bottom: 12px; }
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
    head.innerHTML = `<div><p class="page-sub">Run actions automatically when things happen in your CRM.</p></div>`;
    const newBtn = el("button", "btn btn-primary", "+ New automation");
    newBtn.onclick = () => openEditor(null);
    head.appendChild(newBtn);
    host.appendChild(head);

    const nav = el("div", "subnav");
    [["workflows", "Workflows"], ["runs", "Execution log"], ["events", "Event log"], ["scheduled", "Scheduled"]].forEach(([key, label]) => {
      const b = el("button", "subnav-item" + (tab === key ? " active" : ""), label);
      b.onclick = () => { tab = key; render(host); };
      nav.appendChild(b);
    });
    host.appendChild(nav);

    // Single caption line beneath the tab row; updates to match the active tab.
    // On-screen text (not a hover tooltip), so it works on touch devices.
    const captions = {
      workflows: "The automations you've set up.",
      runs: "What your automations have already done.",
      events: "Raw record of things that happened in your CRM.",
      scheduled: "Automations set to run later — you can cancel them before they do.",
    };
    const caption = el("div", "subnav-caption");
    caption.textContent = captions[tab] || "";
    host.appendChild(caption);

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
      } else if (tab === "scheduled") {
        renderScheduled(body);
      } else {
        renderEvents(body);
      }
    } catch (e) {
      body.innerHTML = `<div class="cell-muted" style="padding:24px">${esc(e.message)}</div>`;
    }
  }

  function triggerLabel(type) { return App.relabelText(triggerLabelRaw(type), { all: true }); }
  function triggerLabelRaw(type) {
    // "FieldChanged:<key>" is a field-scoped variant stored in triggerType.
    if (type && type.indexOf("FieldChanged:") === 0) {
      const key = type.slice("FieldChanged:".length);
      const f = (meta.fields || []).find((x) => x.key === key);
      return "Field changed: " + (f ? f.label : key);
    }
    // "StageChanged:<stageKey>" fires only when the new stage matches.
    if (type && type.indexOf("StageChanged:") === 0) {
      const key = type.slice("StageChanged:".length);
      const s = (meta.stages || []).find((x) => x.key === key);
      return "Stage changed → to " + (s ? s.label : key);
    }
    if (type && type.indexOf("EnrollAudience:") === 0) {
      const id = type.slice("EnrollAudience:".length);
      const a = (meta.audiences || []).find((x) => x.id === id);
      return "Enroll audience: " + (a ? a.name : id);
    }
    // "RecordUpdated:<field>" or "RecordUpdated:<field>=<value>" — record/status scope.
    if (type && type.indexOf("RecordUpdated:") === 0) {
      const rest = type.slice("RecordUpdated:".length);
      const eq = rest.indexOf("=");
      const fkey = eq >= 0 ? rest.slice(0, eq) : rest;
      const fval = eq >= 0 ? rest.slice(eq + 1) : "";
      const f = (meta.recordFields || []).find((x) => x.key === fkey);
      const flabel = f ? f.label : fkey;
      if (fval) {
        const s = (meta.recordStatuses || []).find((x) => x.key === fval);
        return "Record updated: " + flabel + " → " + (s ? s.label : fval);
      }
      return "Record updated: " + flabel;
    }
    // "Scheduled:<field>:<amount>:<unit>:<dir>" date-relative trigger.
    if (type && type.indexOf("Scheduled:") === 0) {
      const p = type.slice("Scheduled:".length).split(":");
      const f = (meta.fields || []).find((x) => x.key === p[0]);
      return `${p[1] || "0"} ${p[2] || "days"} ${p[3] || "before"} ${f ? f.label : (p[0] || "a date field")}`;
    }
    // "RecordDateReached:<recordTypeKey>:<field>:<amount>:<unit>:<dir>" — record date due.
    if (type && type.indexOf("RecordDateReached:") === 0) {
      const p = type.slice("RecordDateReached:".length).split(":");
      const rt = (meta.recordTypes || []).find((x) => x.key === p[0]);
      const f = (meta.recordConditionFields || []).find((x) => x.key === p[1]);
      const rtLabel = rt ? (rt.label || p[0]) : (p[0] || "a record");
      const fLabel = f ? f.label : (p[1] || "a date field");
      return `${p[2] || "0"} ${p[3] || "days"} ${p[4] || "before"} ${rtLabel} “${fLabel}”`;
    }
    // "Stalled:<days>" or "Stalled:<days>:<stageKey>" — time-in-stage trigger.
    if (type && type.indexOf("Stalled:") === 0) {
      const p = type.slice("Stalled:".length).split(":");
      const n = p[0] || "?";
      if (p[1]) {
        const s = (meta.stages || []).find((x) => x.key === p[1]);
        return `Stalled ${n}+ days in ${s ? s.label : p[1]}`;
      }
      return `Stalled ${n}+ days (any stage)`;
    }
    const t = (meta.triggers || []).find((x) => x.type === type);
    return t ? t.label : type;
  }
  function actionLabel(type) {
    const a = (meta.actions || []).find((x) => x.type === type);
    return a ? App.relabelText(a.label, { all: true }) : type;
  }
  // Batch C1 Pass 2: the "When" line for the live preview AND the wizard review,
  // so both read identically. For complete triggers this is exactly
  // triggerLabel(); the one special case is a Scheduled trigger whose date field
  // isn't chosen yet — triggerLabel() would otherwise read like a real value
  // ("0 days before a date field"), so we show a clear blank slot instead.
  function whenText(type) {
    if (!type) return "";
    if (type.indexOf("Scheduled:") === 0) {
      const p = type.slice("Scheduled:".length).split(":");
      if (!p[0]) return `${p[1] || "0"} ${p[2] || "days"} ${p[3] || "before"} — choose a date field`;
    }
    if (type.indexOf("RecordDateReached:") === 0) {
      const p = type.slice("RecordDateReached:".length).split(":");
      if (!p[0] || !p[1]) return `${p[2] || "0"} ${p[3] || "days"} ${p[4] || "before"} — choose a record type and date field`;
    }
    return triggerLabel(type);
  }
  function isWhenIncomplete(type) {
    if (!type) return true;
    if (type.indexOf("Scheduled:") === 0) return !type.slice("Scheduled:".length).split(":")[0];
    if (type.indexOf("RecordDateReached:") === 0) { const p = type.slice("RecordDateReached:".length).split(":"); return !p[0] || !p[1]; }
    return false;
  }

  // ---------------- Workflows list ----------------
  // View-state for the read-only list toolbar (search / status / trigger / sort).
  // Module-level so it survives the in-place re-renders (e.g. toggling a switch),
  // and is reset only by the Clear control. It NEVER changes scoping or data —
  // it only shows/hides and reorders the already-loaded, portal-scoped cards.
  function defaultListView() { return { q: "", status: "all", trigger: "all", sort: "default" }; }
  let listView = defaultListView();
  function resetListView() { listView = defaultListView(); }

  // Base trigger of an automation, collapsing the field-scoped / scheduled
  // variants ("FieldChanged:status", "Scheduled:...:...") to their base so the
  // trigger filter groups them as one ("Field changed", "On a date").
  function triggerBase(tt) {
    if (!tt) return tt || "";
    if (tt.indexOf("FieldChanged:") === 0) return "FieldChanged";
    if (tt.indexOf("StageChanged:") === 0) return "StageChanged";
    if (tt.indexOf("RecordUpdated:") === 0) return "RecordUpdated";
    if (tt.indexOf("Scheduled:") === 0) return "Scheduled";
    if (tt.indexOf("RecordDateReached:") === 0) return "RecordDateReached";
    if (tt.indexOf("AppointmentReminder:") === 0) return "AppointmentReminder";
    if (tt.indexOf("Stalled:") === 0) return "Stalled";
    if (tt.indexOf("EnrollAudience:") === 0) return "EnrollAudience";
    return tt;
  }
  function triggerBaseLabel(base) {
    const t = (meta.triggers || []).find((x) => x.type === base);
    return t ? t.label : base;
  }

  // Batch C1: present the trigger list under a few neutral group headings
  // (display-only). The registry array is NOT reordered (its order still drives
  // the list-page filter chips); we just bucket by each entry's `group` at
  // render time. Within a group, options keep their registry order.
  const TRIGGER_GROUP_ORDER = ["When something changes", "Messaging & tags", "Time-based", "Audiences", "Manual"];
  function fillTriggerSelect(sel, selectedType) {
    sel.innerHTML = "";
    const trigs = meta.triggers || [];
    const seen = [];
    trigs.forEach((t) => { const g = t.group || "Other"; if (seen.indexOf(g) === -1) seen.push(g); });
    // Known groups first (in our chosen order), then any unexpected group last
    // so a newly-added trigger never disappears from the dropdown.
    const ordered = TRIGGER_GROUP_ORDER.filter((g) => seen.indexOf(g) !== -1).concat(seen.filter((g) => TRIGGER_GROUP_ORDER.indexOf(g) === -1));
    ordered.forEach((g) => {
      const og = el("optgroup"); og.label = g;
      trigs.filter((t) => (t.group || "Other") === g).forEach((t) => {
        const o = el("option", null, esc(App.relabelText(t.label, { all: true }))); o.value = t.type; if (t.type === selectedType) o.selected = true; og.appendChild(o);
      });
      sel.appendChild(og);
    });
  }
  // One-line help text for the base trigger / action (from the registry via /meta).
  function triggerDescription(type) { const t = (meta.triggers || []).find((x) => x.type === triggerBase(type)); return App.relabelText((t && t.description) || "", { all: true }); }
  function actionDescription(type) { const a = (meta.actions || []).find((x) => x.type === type); return App.relabelText((a && a.description) || "", { all: true }); }
  // A record-subject trigger acts on the record (e.g. a job), not a contact.
  function isRecordTrigger(tt) { return tt === "RecordUpdated" || (tt && tt.indexOf("RecordUpdated:") === 0); }
  // The record date-reached trigger is evaluated against a RECORD's fields (so its
  // CONDITIONS use record fields), but its ACTIONS run against the record's linked
  // CONTACT (so Send email/SMS/Add note are allowed) — hence it is NOT an
  // isRecordTrigger (which would restrict actions to record-only ones).
  function isRecordDateTrigger(tt) { return tt === "RecordDateReached" || (tt && tt.indexOf("RecordDateReached:") === 0); }
  // The condition field list depends on the subject: a record trigger offers the
  // record's own fields; otherwise contact fields. _condTrigger is set to the
  // active trigger right before the wizard / list condition rows render, so
  // fieldType/fieldLabel/condRow show the right fields. (The editor passes the
  // trigger explicitly via buildColumns(); this covers the wizard + previews.)
  let _condTrigger = null;
  function condFieldList() { return (isRecordTrigger(_condTrigger) || isRecordDateTrigger(_condTrigger)) ? (meta.recordConditionFields || []) : (meta.fields || []); }
  // Which actions the builder offers for a given trigger. Record-subject
  // automations support only record-safe actions ("Create internal note" on the
  // record, "Act on linked contacts"); everything else is contact-only, and
  // "act_on_linked" never appears there. Mirrors the engine's allow-list.
  function allowedActions(triggerType) {
    let all = meta.actions || [];
    // SMS master switch off → don't offer "Send SMS" as a new action (the SMS option
    // inside notify_business / act_on_linked is hidden in their config UIs below).
    if (!meta.smsEnabled) all = all.filter((a) => a.type !== "send_sms");
    // New honest record-acting actions (Option 3 Pass 2) — record subjects only.
    const recordOnly = ["create_record_item", "update_record_item", "find_record_items", "delete_record_items"];
    if (isRecordTrigger(triggerType)) return all.filter((a) => a.type === "create_note" || a.type === "act_on_linked" || a.type === "move_to_stage" || a.type === "set_record_field" || recordOnly.indexOf(a.type) !== -1);
    return all.filter((a) => a.type !== "act_on_linked" && recordOnly.indexOf(a.type) === -1);
  }
  // Distinct base triggers actually present in this portal's automations, ordered
  // to match the builder's trigger list. Derived from data — never hardcoded.
  function presentTriggers() {
    const seen = new Set();
    automations.forEach((a) => seen.add(triggerBase(a.triggerType)));
    const order = (meta.triggers || []).map((t) => t.type);
    return [...seen]
      .sort((a, b) => (order.indexOf(a) < 0 ? 999 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 999 : order.indexOf(b)))
      .map((b) => [b, triggerBaseLabel(b)]);
  }

  // Apply the toolbar's search/filter/sort to a COPY of the loaded list. Pure;
  // never mutates `automations`. Default sort preserves the existing order.
  function applyListView(autos) {
    let out = autos.slice();
    const q = (listView.q || "").trim().toLowerCase();
    if (q) out = out.filter((a) => (a.name || "").toLowerCase().includes(q));
    if (listView.status === "enabled") out = out.filter((a) => !!a.enabled);
    else if (listView.status === "disabled") out = out.filter((a) => !a.enabled);
    if (listView.trigger && listView.trigger !== "all") out = out.filter((a) => triggerBase(a.triggerType) === listView.trigger);
    if (listView.sort === "name") out.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));
    else if (listView.sort === "recent") out.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return out;
  }

  function makeSelect(options, value, onChange) {
    const s = el("select", "input");
    options.forEach(([v, l]) => { const o = el("option", null, esc(l)); o.value = v; if (v === value) o.selected = true; s.appendChild(o); });
    s.onchange = () => onChange(s.value);
    return s;
  }

  function renderWorkflows(body) {
    body.innerHTML = "";
    // Entry-point row: "Start from a template" + "Build with a wizard".
    body.appendChild(entryRow());

    if (!automations.length) {
      const empty = el("div", "empty-state");
      empty.innerHTML = `<p>No automations yet.</p>
        <p class="cell-muted">Start from a template above, or build one from scratch to send a welcome email, tag leads, assign owners, and more.</p>`;
      body.appendChild(empty);
      return;
    }

    // If a previously-chosen trigger filter is no longer present (its automations
    // were deleted/edited), fall back to "All" so nothing silently hides.
    if (listView.trigger !== "all" && !presentTriggers().some(([v]) => v === listView.trigger)) listView.trigger = "all";

    // --- Toolbar (read-only view controls) ---
    const bar = el("div", "auto-toolbar");
    const search = el("input", "input auto-search");
    search.type = "text";
    search.placeholder = "Search by name…";
    search.value = listView.q;
    search.setAttribute("aria-label", "Search automations by name");
    search.oninput = () => { listView.q = search.value; refreshList(); };
    const statusSel = makeSelect([["all", "All statuses"], ["enabled", "Enabled"], ["disabled", "Disabled"]], listView.status, (v) => { listView.status = v; refreshList(); });
    const triggerSel = makeSelect([["all", "All triggers"], ...presentTriggers()], listView.trigger, (v) => { listView.trigger = v; refreshList(); });
    const sortSel = makeSelect([["default", "Sort: Default"], ["name", "Sort: Name (A–Z)"], ["recent", "Sort: Recently edited"]], listView.sort, (v) => { listView.sort = v; refreshList(); });
    const clear = el("button", "btn btn-ghost btn-sm", "Clear");
    clear.onclick = () => {
      resetListView();
      search.value = ""; statusSel.value = "all"; triggerSel.value = "all"; sortSel.value = "default";
      refreshList();
    };
    [search, statusSel, triggerSel, sortSel, clear].forEach((c) => bar.appendChild(c));
    body.appendChild(bar);

    // Count line + the list region. Only these are rebuilt on filter changes, so
    // the search box keeps focus while typing.
    const countLine = el("div", "auto-count");
    body.appendChild(countLine);
    const listWrap = el("div");
    body.appendChild(listWrap);

    function refreshList() {
      const visible = applyListView(automations);
      countLine.textContent = `${visible.length} of ${automations.length} shown`;
      listWrap.innerHTML = "";
      if (!visible.length) {
        const empty = el("div", "empty-state");
        empty.innerHTML = `<p>No automations match.</p><p class="cell-muted">Try a different search, status, or trigger.</p>`;
        const c = el("button", "btn btn-ghost btn-sm", "Clear filters");
        c.onclick = () => {
          resetListView();
          search.value = ""; statusSel.value = "all"; triggerSel.value = "all"; sortSel.value = "default";
          refreshList();
        };
        empty.appendChild(c);
        listWrap.appendChild(empty);
        return;
      }
      renderCards(listWrap, visible);
    }
    refreshList();
  }

  // Render the visible cards with branch-pair grouping. Pair grouping runs over
  // the VISIBLE subset, so a filter that hides one half simply shows the other
  // as a normal card. The "partner deleted" note is judged against the FULL
  // loaded list, so a filtered-out (not deleted) partner is never mislabeled.
  function renderCards(container, visible) {
    const groups = computePairGroups(visible);
    const rendered = new Set();
    visible.forEach((a) => {
      if (rendered.has(a.id)) return;
      const pair = groups.pairOf.get(a.id);
      if (pair && pair.length === 2) {
        const [x, y] = pair;
        rendered.add(x.id);
        rendered.add(y.id);
        container.appendChild(pairGroupEl(x, y, groups.kindOf.get(a.id)));
      } else {
        rendered.add(a.id);
        const partnerDeleted = !!a.pairId && !automations.some((o) => o.id !== a.id && o.pairId === a.pairId);
        container.appendChild(workflowCard(a, partnerDeleted ? { orphan: true } : null));
      }
    });
  }

  // Build pair groupings. Returns maps from an automation id to its [a,b] pair
  // and to the pairing kind ('id' = durable pairId, 'name' = cosmetic fallback).
  function computePairGroups(autos) {
    const pairOf = new Map();
    const kindOf = new Map();

    // 1) Robust: exact shared pairId (only true 2-member groups are linked).
    const byPair = new Map();
    autos.forEach((a) => {
      if (!a.pairId) return;
      if (!byPair.has(a.pairId)) byPair.set(a.pairId, []);
      byPair.get(a.pairId).push(a);
    });
    byPair.forEach((arr) => {
      if (arr.length === 2) arr.forEach((a) => { pairOf.set(a.id, arr); kindOf.set(a.id, "id"); });
    });

    // 2) Fallback (cosmetic only): match "Base (if)" with "Base (otherwise)" on
    //    the same trigger, for automations WITHOUT a pairId and not already
    //    linked. Used solely for visual grouping — never drives the warning.
    const ifs = {}, others = {};
    autos.forEach((a) => {
      if (a.pairId || pairOf.has(a.id)) return;
      const m = /^(.*) \((if|otherwise)\)$/.exec(a.name || "");
      if (!m) return;
      const key = a.triggerType + "||" + m[1];
      (m[2] === "if" ? ifs : others)[key] = a;
    });
    Object.keys(ifs).forEach((key) => {
      if (others[key]) {
        const arr = [ifs[key], others[key]];
        arr.forEach((a) => { pairOf.set(a.id, arr); kindOf.set(a.id, "name"); });
      }
    });

    return { pairOf, kindOf };
  }

  // Wrap two paired cards in a labelled group. For a durable ('id') pair, each
  // card also gets a gentle half-enabled warning when its partner is off.
  function pairGroupEl(x, y, kind) {
    const wrap = el("div", "pair-group" + (kind === "name" ? " soft" : ""));
    const head = el("div", "pair-group-head");
    if (kind === "id") {
      head.innerHTML = `<span class="pair-badge">${branchGlyph()} Branch pair</span><span class="pair-group-note">Two halves of one branch — turn on both for full coverage.</span>`;
    } else {
      head.innerHTML = `<span class="pair-badge soft">${branchGlyph()} Looks like a branch pair</span><span class="pair-group-note">Grouped by name; this guess isn't tracked.</span>`;
    }
    wrap.appendChild(head);
    wrap.appendChild(workflowCard(x, { partner: y, kind }));
    wrap.appendChild(workflowCard(y, { partner: x, kind }));
    return wrap;
  }

  function branchGlyph() {
    return `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:-1px"><path d="M3 1v3.5C3 6 4 6.5 5.2 6.5H9M3 11V7.5C3 6 4 5.5 5.2 5.5H9M9 4.5L11 6 9 7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // Two-up entry row: "Start from a template" opens the preset library; "Build
  // with a wizard" opens the guided builder. Both are fully functional.
  function entryRow() {
    const row = el("div", "tpl-entry-row");

    const tpl = el("div", "tpl-entry-card");
    tpl.setAttribute("role", "button");
    tpl.tabIndex = 0;
    tpl.innerHTML = `<span class="tpl-entry-icon">${gridGlyph()}</span>
      <span class="tpl-entry-main">
        <span class="tpl-entry-title">Start from a template</span>
        <span class="tpl-entry-sub">Browse ready-made automations and apply one as a draft.</span>
      </span>
      <span class="tpl-entry-cta">Browse →</span>`;
    tpl.onclick = () => openPresetsLibrary();
    tpl.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPresetsLibrary(); } };
    row.appendChild(tpl);

    const wiz = el("div", "tpl-entry-card");
    wiz.setAttribute("role", "button");
    wiz.tabIndex = 0;
    wiz.innerHTML = `<span class="tpl-entry-icon">${sparkGlyph()}</span>
      <span class="tpl-entry-main">
        <span class="tpl-entry-title">Build with a wizard</span>
        <span class="tpl-entry-sub">Answer a few questions and we'll assemble the flow for you.</span>
      </span>
      <span class="tpl-entry-cta">Start →</span>`;
    wiz.onclick = () => openWizard();
    wiz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openWizard(); } };
    row.appendChild(wiz);

    return row;
  }

  function gridGlyph() {
    return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="1" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="1" y="10" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="10" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>`;
  }
  function sparkGlyph() {
    return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1.5l1.7 4.3 4.3 1.7-4.3 1.7L9 13.5 7.3 9.2 3 7.5l4.3-1.7L9 1.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  }

  // ---------------- Presets library (modal) ----------------
  // A browsable gallery of built-in presets. Selecting one swaps the SAME modal
  // body to a full plain-English preview before any apply happens. Apply lands
  // a draft and opens it in the existing builder for review.
  async function openPresetsLibrary() {
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Automation templates</h2><button class="icon-btn" id="pl-close">&times;</button></div>`;
    const pbody = el("div", "modal-body");
    pbody.innerHTML = `<div class="cell-muted" style="padding:24px">Loading templates…</div>`;
    inner.appendChild(pbody);
    const overlay = modal(inner, "modal-builder");
    inner.querySelector("#pl-close").onclick = () => overlay.remove();
    try {
      const data = await App.portalApi("/api/automations/presets");
      showGallery(pbody, data, overlay);
    } catch (e) {
      pbody.innerHTML = `<div class="cell-muted" style="padding:24px">${esc(e.message)}</div>`;
    }
  }

  // Render the gallery grouped into the function-based categories returned by
  // the API (order/labels come from the server's PRESET_CATEGORIES). Each card,
  // its preview, and the apply path are unchanged.
  function showGallery(pbody, data, overlay) {
    pbody.innerHTML = "";
    pbody.appendChild(hint("Pick a template to preview it in plain English, then apply it as an inactive draft you can review and switch on yourself."));
    const categories = (data && data.categories) || [];
    const presets = (data && data.presets) || [];
    if (!presets.length) {
      pbody.appendChild(el("div", "cell-muted", "No templates available."));
      return;
    }
    const renderSection = (label, items) => {
      if (!items.length) return;
      pbody.appendChild(el("div", "preset-cat-head", esc(label)));
      const grid = el("div", "preset-grid");
      items.forEach((p) => grid.appendChild(presetCard(p, pbody, data, overlay)));
      pbody.appendChild(grid);
    };
    const known = new Set();
    categories.forEach((cat) => {
      known.add(cat.key);
      renderSection(cat.label, presets.filter((p) => p.category === cat.key));
    });
    // Safety net: any template whose category isn't in the list still shows up.
    const orphans = presets.filter((p) => !known.has(p.category));
    renderSection("Other", orphans);
  }

  function presetCard(p, pbody, data, overlay) {
    const card = el("div", "preset-card");
    const head = el("div");
    head.innerHTML = `<div class="preset-name">${esc(App.relabelText(p.name, { all: true }))}</div><div class="preset-desc">${esc(App.relabelText(p.description, { all: true }))}</div>`;
    card.appendChild(head);
    card.appendChild(shapeEl(p.shape));
    if (p.missing && p.missing.length) {
      card.appendChild(el("div", "preset-missing", "Expects a field: " + p.missing.map((m) => esc(m.label || m.key)).join(", ")));
    }
    if (data && !data.smsEnabled && p.hasSms) {
      const n = el("div", "preset-missing", "Includes a text step — hidden while texting is off.");
      n.style.cssText = "background:var(--panel-2);color:var(--ink-soft)";
      card.appendChild(n);
    }
    const foot = el("div", "preset-card-foot");
    const prev = el("button", "btn btn-ghost btn-sm", "Preview");
    prev.onclick = (e) => { e.stopPropagation(); showPreview(pbody, p, data, overlay); };
    const apply = el("button", "btn btn-primary btn-sm", "Apply");
    apply.onclick = (e) => { e.stopPropagation(); applyPreset(p, overlay); };
    foot.appendChild(prev); foot.appendChild(apply);
    card.appendChild(foot);
    card.onclick = (e) => { if (e.target.closest("button")) return; showPreview(pbody, p, data, overlay); };
    return card;
  }

  // Visual cue of the trigger -> action shape (chips joined by arrows).
  function shapeEl(shape) {
    const wrap = el("div", "preset-shape");
    wrap.appendChild(el("span", "shape-chip trigger", esc(App.relabelText((shape && shape.trigger) || "Trigger"))));
    ((shape && shape.actions) || []).forEach((a) => {
      const arrow = el("span", "shape-arrow");
      arrow.innerHTML = `<svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M0 5h13M9 1l5 4-5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      wrap.appendChild(arrow);
      wrap.appendChild(el("span", "shape-chip action", esc(App.relabelText(a))));
    });
    return wrap;
  }

  // Full plain-English preview, rendered into the same modal body.
  function showPreview(pbody, p, data, overlay) {
    pbody.innerHTML = "";
    const back = el("button", "btn btn-ghost btn-sm", "← All templates");
    back.onclick = () => showGallery(pbody, data, overlay);
    pbody.appendChild(back);

    const head = el("div", "preset-pv-head");
    head.innerHTML = `<div class="preset-pv-title">${esc(App.relabelText(p.name, { all: true }))}</div><div class="preset-pv-desc">${esc(App.relabelText(p.description, { all: true }))}</div>`;
    pbody.appendChild(head);

    pbody.appendChild(shapeEl(p.shape));

    if (data && !data.smsEnabled && p.hasSms) {
      const n = el("div", "preset-missing", "This template includes a text (SMS) step. Texting is currently off, so that step stays hidden and won't send; the rest applies normally.");
      n.style.cssText = "background:var(--panel-2);color:var(--ink-soft);margin-top:12px";
      pbody.appendChild(n);
    }

    const sm = p.summary || {};
    const conds = (sm.conditions || []).map((c) => `<li>${esc(App.relabelText(c))}</li>`).join("") || "<li>Always runs</li>";
    const acts = (sm.actions || []).map((a) => `<li>${esc(App.relabelText(a))}</li>`).join("") || "<li>—</li>";
    const sec = el("div", "preset-pv-section");
    sec.innerHTML = `
      <div class="pv-block"><div class="pv-k">When</div><div class="pv-v">${esc(App.relabelText(sm.trigger || ""))}</div></div>
      <div class="pv-block"><div class="pv-k">If</div><div class="pv-v"><ul>${conds}</ul></div></div>
      <div class="pv-block"><div class="pv-k">Then</div><div class="pv-v"><ul>${acts}</ul></div></div>`;
    pbody.appendChild(sec);

    // Which fields it expects, and whether they exist in this portal.
    if (p.expected && p.expected.length) {
      const fsec = el("div", "preset-pv-section");
      const chips = p.expected
        .map((f) => `<span class="field-flag ${f.present ? "ok" : "missing"}">${esc(f.label || f.key)}${f.present ? "" : " — missing"}</span>`)
        .join("");
      fsec.innerHTML = `<div class="pv-k">Fields it expects</div><div class="field-flags">${chips}</div>`;
      if (p.missing && p.missing.length) {
        const names = p.missing.map((m) => "“" + (m.label || m.key) + "”").join(", ");
        const verb = p.missing.length > 1 ? "don't" : "doesn't";
        fsec.appendChild(el("div", "pv-warn", `This template expects ${names}, which ${verb} exist in this portal yet. You can still apply it — it's saved as an inactive draft and clearly flagged so you can create or map the field under Fields before turning it on.`));
      }
      pbody.appendChild(fsec);
    }

    if (p.note) pbody.appendChild(hint(App.relabelText(p.note)));

    const bar = el("div", "modal-savebar");
    const cancel = el("button", "btn btn-ghost", "Back");
    cancel.onclick = () => showGallery(pbody, data, overlay);
    const apply = el("button", "btn btn-primary", "Apply as draft");
    apply.onclick = () => applyPreset(p, overlay);
    bar.appendChild(cancel); bar.appendChild(apply);
    pbody.appendChild(bar);
  }

  // Apply a preset -> draft, then open it in the builder for review. The draft
  // is inactive; nothing runs until the user turns it on.
  async function applyPreset(p, overlay) {
    try {
      const r = await App.portalApi("/api/automations/presets/apply", { method: "POST", body: JSON.stringify({ key: p.key }) });
      overlay.remove();
      toast(r.nameChanged ? `Added “${r.automation.name}” (a copy) as a draft` : "Draft automation added");
      await render(host);
      openEditor(r.automation, { missing: r.missing || [] });
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ---------------- Branching wizard (modal) ----------------
  // A finite, rules-based (NO AI) wizard: Trigger -> Filter -> Branch -> Actions
  // -> Review. It only offers REAL triggers/fields/actions from /meta, assembles
  // a flow definition (or two, for a branch), and hands them to the EXISTING
  // apply step (/api/automations/apply-flow -> applyFlowDefinition). It never
  // activates anything and never touches the engine.

  const WIZ_STEPS = ["Trigger", "Filter", "Branch", "Actions", "Review"];
  // Operators with EXACT complements, so a branch's "otherwise" path is provably
  // the negation of its "if" path.
  const NEGATE = { is: "is_not", is_not: "is", contains: "not_contains", not_contains: "contains", empty: "not_empty", not_empty: "empty" };

  function opsForType(type) {
    if (type === "date") return [["before", "is before"], ["after", "is after"], ["today", "is today"], ["empty", "is empty"], ["not_empty", "is not empty"]];
    if (type === "number") return [["gt", "greater than"], ["lt", "less than"], ["is", "equals"], ["is_not", "does not equal"], ["empty", "is empty"], ["not_empty", "is not empty"]];
    return [["is", "is"], ["is_not", "is not"], ["contains", "contains"], ["not_contains", "does not contain"], ["empty", "is empty"], ["not_empty", "is not empty"]];
  }
  // Branch pivot: only exactly-negatable ops (yes/no style), any field type.
  function branchOps() {
    return [["is", "is"], ["is_not", "is not"], ["contains", "contains"], ["not_contains", "does not contain"], ["empty", "is empty"], ["not_empty", "is not empty"]];
  }
  function fieldType(key) {
    const f = condFieldList().find((x) => x.key === key);
    const t = f ? f.type : "text";
    return t === "percent" ? "number" : (t === "date" || t === "number") ? t : "text";
  }
  function fieldLabel(key) {
    const f = condFieldList().find((x) => x.key === key);
    return f ? f.label : key;
  }
  function opLabel(op) {
    const all = [["is", "is"], ["is_not", "is not"], ["contains", "contains"], ["not_contains", "does not contain"], ["empty", "is empty"], ["not_empty", "is not empty"], ["before", "is before"], ["after", "is after"], ["today", "is today"], ["gt", "greater than"], ["lt", "less than"]];
    const m = all.find(([v]) => v === op);
    return m ? m[1] : op;
  }
  function noValueOp(op) { return op === "empty" || op === "not_empty" || op === "today"; }
  function condComplete(c) { return !!(c && c.field && c.op && (noValueOp(c.op) || (c.value != null && c.value !== ""))); }
  function condText(c) {
    if (!c || !c.field) return "—";
    return `${fieldLabel(c.field)} ${opLabel(c.op)}${noValueOp(c.op) ? "" : " “" + (c.value || "") + "”"}`;
  }
  function negate(c) { return { field: c.field, op: NEGATE[c.op] || c.op, value: c.value }; }

  // Opaque, unique grouping token for a wizard branch pair. crypto.randomUUID
  // when available, with a harmless fallback. It is only ever used to match the
  // two drafts within one portal — no security meaning.
  function newPairId() {
    try { if (window.crypto && crypto.randomUUID) return "pair_" + crypto.randomUUID(); } catch (e) {}
    return "pair_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  function wizTriggerType(w) {
    if (w.baseTrigger === "FieldChanged") return w.triggerField ? "FieldChanged:" + w.triggerField : "FieldChanged";
    if (w.baseTrigger === "StageChanged") return w.triggerStage ? "StageChanged:" + w.triggerStage : "StageChanged";
    if (w.baseTrigger === "RecordUpdated") return w.recField ? (w.recValue ? "RecordUpdated:" + w.recField + "=" + w.recValue : "RecordUpdated:" + w.recField) : "RecordUpdated";
    if (w.baseTrigger === "Scheduled") return `Scheduled:${w.sched.field}:${w.sched.amount || 0}:${w.sched.unit}:${w.sched.dir}`;
    if (w.baseTrigger === "RecordDateReached") return `RecordDateReached:${w.recDate.recordType}:${w.recDate.field}:${w.recDate.amount || 0}:${w.recDate.unit}:${w.recDate.dir}`;
    if (w.baseTrigger === "AppointmentReminder") return `AppointmentReminder:${w.remind.amount || 2}:${w.remind.unit}:before`;
    if (w.baseTrigger === "Stalled") return "Stalled:" + (w.stall.days || 7) + (w.stall.stageKey ? ":" + w.stall.stageKey : "");
    if (w.baseTrigger === "EnrollAudience") return w.enrollAudienceId ? "EnrollAudience:" + w.enrollAudienceId : "EnrollAudience";
    return w.baseTrigger;
  }
  function suggestName(w) {
    const base = "When " + triggerLabel(wizTriggerType(w));
    return base.length > 60 ? "New automation" : base;
  }

  // One simple AND-condition row (field + operator + value). Used by the Filter
  // step (full op set) and the Branch step (negatable op set).
  function condRow(cond, opsFn, onRemove, onChange) {
    const row = el("div", "wiz-cond-row");
    const fsel = el("select", "input");
    const blank = el("option", null, "— field —"); blank.value = ""; fsel.appendChild(blank);
    condFieldList().forEach((f) => { const o = el("option", null, esc(f.label)); o.value = f.key; if (cond.field === f.key) o.selected = true; fsel.appendChild(o); });
    const osel = el("select", "input");
    const valInp = el("input", "input"); valInp.placeholder = "value"; valInp.value = cond.value || "";
    function rebuildOps() {
      const list = opsFn(fieldType(cond.field));
      osel.innerHTML = "";
      list.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (cond.op === v) o.selected = true; osel.appendChild(o); });
      if (!list.some(([v]) => v === cond.op)) { cond.op = list[0][0]; osel.value = cond.op; }
      toggleVal();
    }
    function toggleVal() { valInp.style.display = noValueOp(cond.op) ? "none" : ""; }
    fsel.onchange = () => { cond.field = fsel.value; rebuildOps(); onChange && onChange(); };
    osel.onchange = () => { cond.op = osel.value; toggleVal(); onChange && onChange(); };
    valInp.oninput = () => { cond.value = valInp.value; onChange && onChange(); };
    rebuildOps();
    row.appendChild(fsel); row.appendChild(osel); row.appendChild(valInp);
    if (onRemove) { const rm = el("button", "rule-remove", "&times;"); rm.onclick = onRemove; row.appendChild(rm); }
    return row;
  }

  // Render an editable action list into a container, reusing the builder's
  // actionRow/buildActionConfig so wizard-built actions are identical to
  // hand-built ones (and only ever offer fields/actions that exist here).
  function renderActionList(container, arr, triggerType) {
    container.innerHTML = "";
    const list = el("div", "wiz-action-list");
    const redraw = () => renderActionList(container, arr, triggerType);
    arr.forEach((act, i) => list.appendChild(actionRow(act, i, { actions: arr, triggerType }, redraw)));
    container.appendChild(list);
    const add = el("button", "rail-add", "+ Add action");
    add.onclick = () => { const opts = allowedActions(triggerType); arr.push({ type: (opts[0] && opts[0].type) || "create_note", config: {} }); redraw(); };
    container.appendChild(add);
  }

  function openWizard() {
    const w = {
      step: 1,
      baseTrigger: (meta.triggers[0] && meta.triggers[0].type) || "ContactCreated",
      triggerField: "",
      triggerStage: "",
      recField: "",
      recValue: "",
      sched: { field: "", amount: "", unit: "days", dir: "before" },
      recDate: { recordType: "", field: "", amount: "", unit: "days", dir: "before", fields: null, loading: false },
      remind: { amount: "2", unit: "hours" },
      stall: { days: "", stageKey: "" },
      enrollAudienceId: "",
      filters: [],
      branch: false,
      branchCond: { field: "", op: "is", value: "" },
      actionsIf: [],
      actionsElse: [],
      name: "",
      nameTouched: false,
    };

    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Build with a wizard</h2><button class="icon-btn" id="wz-close">&times;</button></div>`;
    const pbody = el("div", "modal-body");
    inner.appendChild(pbody);
    const overlay = modal(inner, "modal-builder");
    inner.querySelector("#wz-close").onclick = () => overlay.remove();
    renderWizard(pbody, w, overlay);
  }

  function renderWizard(pbody, w, overlay) {
    pbody.innerHTML = "";
    // Conditions in this wizard pass should reflect the chosen subject (record
    // trigger -> record fields; otherwise contact fields).
    _condTrigger = wizTriggerType(w);

    // Progress indicator
    const steps = el("div", "wiz-steps");
    WIZ_STEPS.forEach((label, i) => {
      const n = i + 1;
      const cls = n === w.step ? " active" : n < w.step ? " done" : "";
      steps.appendChild(el("span", "wiz-step-pill" + cls, `${n}. ${label}`));
    });
    pbody.appendChild(steps);

    const stepBox = el("div");
    pbody.appendChild(stepBox);
    if (w.step === 1) stepTrigger(stepBox, w);
    else if (w.step === 2) stepFilter(stepBox, w);
    else if (w.step === 3) stepBranch(stepBox, w);
    else if (w.step === 4) stepActions(stepBox, w);
    else stepReview(stepBox, w, overlay);

    // Footer (Back / Next / Create)
    const foot = el("div", "wiz-foot");
    const back = el("button", "btn btn-ghost", "← Back");
    back.disabled = w.step === 1;
    back.onclick = () => { w.step--; renderWizard(pbody, w, overlay); };
    foot.appendChild(back);

    const rightWrap = el("div", "wiz-foot-right");
    const cancel = el("button", "btn btn-ghost", "Cancel");
    cancel.onclick = () => overlay.remove();
    rightWrap.appendChild(cancel);

    if (w.step < 5) {
      const next = el("button", "btn btn-primary", "Next →");
      next.onclick = () => { if (validateStep(w)) { w.step++; renderWizard(pbody, w, overlay); } };
      rightWrap.appendChild(next);
    } else {
      const create = el("button", "btn btn-primary", w.branch ? "Create 2 drafts" : "Create draft");
      create.onclick = () => createWizardDrafts(w, overlay);
      rightWrap.appendChild(create);
    }
    foot.appendChild(rightWrap);
    pbody.appendChild(foot);
  }

  function validateStep(w) {
    if (w.step === 1 && w.baseTrigger === "Scheduled" && !w.sched.field) { toast("Pick a date field for the schedule", true); return false; }
    if (w.step === 1 && w.baseTrigger === "RecordDateReached" && !w.recDate.recordType) { toast("Pick a record type", true); return false; }
    if (w.step === 1 && w.baseTrigger === "RecordDateReached" && !w.recDate.field) { toast("Pick a date field on that record type", true); return false; }
    if (w.step === 1 && w.baseTrigger === "EnrollAudience" && !w.enrollAudienceId) { toast("Pick an audience to enroll", true); return false; }
    if (w.step === 1 && w.baseTrigger === "AppointmentReminder" && !(Number(w.remind.amount) > 0)) { toast("Enter how long before the appointment to remind", true); return false; }
    if (w.step === 3 && w.branch && !condComplete(w.branchCond)) { toast("Finish the branch condition first", true); return false; }
    if (w.step === 4) {
      if (!w.actionsIf.length) { toast(w.branch ? "Add at least one action to the “If” path" : "Add at least one action", true); return false; }
      if (w.branch && !w.actionsElse.length) { toast("Add at least one action to the “Otherwise” path", true); return false; }
    }
    return true;
  }

  // --- Step 1: Trigger ---
  function stepTrigger(box, w) {
    box.appendChild(el("p", "wiz-q", "What should start this automation?"));
    box.appendChild(el("p", "wiz-sub", "Pick the event that kicks things off. These are the same triggers the builder offers."));
    const sel = el("select", "input");
    fillTriggerSelect(sel, w.baseTrigger);
    box.appendChild(sel);
    const desc = el("div", "wf-help-desc");
    desc.style.cssText = "margin-top:6px;font-size:12.5px;color:var(--ink-soft);";
    box.appendChild(desc);
    const extra = el("div"); extra.style.marginTop = "10px"; box.appendChild(extra);
    function renderExtra() {
      desc.textContent = triggerDescription(w.baseTrigger);
      extra.innerHTML = "";
      if (w.baseTrigger === "FieldChanged") {
        extra.appendChild(small("Which field? (choose “Any field” to run on every change)"));
        const fs = el("select", "input");
        const any = el("option", null, "Any field"); any.value = ""; fs.appendChild(any);
        (meta.fields || []).filter((f) => f.key !== "createdAt").forEach((f) => { const o = el("option", null, esc(f.label)); o.value = f.key; if (f.key === w.triggerField) o.selected = true; fs.appendChild(o); });
        fs.onchange = () => { w.triggerField = fs.value; };
        extra.appendChild(fs);
      } else if (w.baseTrigger === "StageChanged") {
        extra.appendChild(small("Which stage? (choose “Any stage” to run on every stage change)"));
        const ss = el("select", "input");
        const any = el("option", null, App.relabelText("Any stage", { all: true })); any.value = ""; ss.appendChild(any);
        (meta.stages || []).forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === w.triggerStage) o.selected = true; ss.appendChild(o); });
        ss.onchange = () => { w.triggerStage = ss.value; };
        extra.appendChild(ss);
        extra.appendChild(small("Runs when a linked contact moves to a different stage on a record. The contact is the subject."));
      } else if (w.baseTrigger === "RecordUpdated") {
        extra.appendChild(small("Which field changed? (choose “Any field” for any change)"));
        const rfs = el("select", "input");
        const anyF = el("option", null, "Any field"); anyF.value = ""; rfs.appendChild(anyF);
        (meta.recordFields || []).forEach((f) => { const o = el("option", null, esc(f.label)); o.value = f.key; if (f.key === w.recField) o.selected = true; rfs.appendChild(o); });
        extra.appendChild(rfs);
        const vHost = el("div"); vHost.style.marginTop = "8px"; extra.appendChild(vHost);
        function renderWRecValue() {
          vHost.innerHTML = "";
          if (!w.recField) return;
          vHost.appendChild(small("Only when it changes to (optional):"));
          if (w.recField === "status" && (meta.recordStatuses || []).length) {
            const vs = el("select", "input");
            const anyV = el("option", null, "Any value"); anyV.value = ""; vs.appendChild(anyV);
            (meta.recordStatuses || []).forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === w.recValue) o.selected = true; vs.appendChild(o); });
            vs.onchange = () => { w.recValue = vs.value; };
            vHost.appendChild(vs);
          } else {
            const vi = el("input", "input"); vi.placeholder = "any value"; vi.value = w.recValue; vi.oninput = () => { w.recValue = vi.value.trim(); };
            vHost.appendChild(vi);
          }
        }
        rfs.onchange = () => { w.recField = rfs.value; w.recValue = ""; renderWRecValue(); };
        renderWRecValue();
        extra.appendChild(small("Acts on the record. Only “Create internal note” works for records in this stage; email/SMS to a record is blocked."));
      } else if (w.baseTrigger === "Manual") {
        extra.appendChild(small("Runs only when someone clicks “Run automation” on a contact."));
      } else if (w.baseTrigger === "EnrollAudience") {
        extra.appendChild(small("Which audience? Its current members are enrolled when you click “Enroll audience” on the automation."));
        const as = el("select", "input");
        const any = el("option", null, "— pick an audience —"); any.value = ""; as.appendChild(any);
        (meta.audiences || []).forEach((a) => { const o = el("option", null, esc(a.name)); o.value = a.id; if (a.id === w.enrollAudienceId) o.selected = true; as.appendChild(o); });
        as.onchange = () => { w.enrollAudienceId = as.value; };
        extra.appendChild(as);
        if (!(meta.audiences || []).length) extra.appendChild(small("No audiences yet — create one under Communication → Audiences first."));
        extra.appendChild(small("Conditions you add still apply, so you can enroll an audience and narrow it further."));
      } else if (w.baseTrigger === "Scheduled") {
        const dateFields = (meta.fields || []).filter((f) => f.type === "date");
        if (!dateFields.length) extra.appendChild(small("No Date fields exist yet. Create one under Fields first (e.g. a renewal date)."));
        extra.appendChild(small("Run this many, before/after, which date field:"));
        const rowEl = el("div", "wiz-cond-row");
        const amt = el("input", "input"); amt.type = "number"; amt.placeholder = "6"; amt.style.flex = "0 0 70px"; amt.value = w.sched.amount; amt.oninput = () => { w.sched.amount = amt.value; };
        const unit = el("select", "input"); [["days", "days"], ["weeks", "weeks"], ["months", "months"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (w.sched.unit === v) o.selected = true; unit.appendChild(o); }); unit.onchange = () => { w.sched.unit = unit.value; };
        const dir = el("select", "input"); [["before", "before"], ["after", "after"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (w.sched.dir === v) o.selected = true; dir.appendChild(o); }); dir.onchange = () => { w.sched.dir = dir.value; };
        const fs = el("select", "input"); const b = el("option", null, "— date field —"); b.value = ""; fs.appendChild(b);
        dateFields.forEach((f) => { const o = el("option", null, esc(f.label)); o.value = f.key; if (f.key === w.sched.field) o.selected = true; fs.appendChild(o); }); fs.onchange = () => { w.sched.field = fs.value; };
        rowEl.appendChild(amt); rowEl.appendChild(unit); rowEl.appendChild(dir); rowEl.appendChild(fs);
        extra.appendChild(rowEl);
        extra.appendChild(hint("Evaluated by the daily sweep / “Process due jobs now”, not instantly."));
      } else if (w.baseTrigger === "RecordDateReached") {
        // Record type (locking-respected) → its date field → offset. The date
        // field list is fetched for the chosen type so only real fields appear.
        const types = (meta.recordTypes || []).filter((rt) => !(App.isRecordTypeLocked && App.isRecordTypeLocked(rt.key)));
        if (!types.length) { extra.appendChild(small("No record types are available to you. (A locked type won't appear here.)")); }
        extra.appendChild(small("Which record type, which date field, and how far before/after:"));
        const rowType = el("div", "wiz-cond-row");
        const ts = el("select", "input"); const tb = el("option", null, "— record type —"); tb.value = ""; ts.appendChild(tb);
        types.forEach((rt) => { const o = el("option", null, esc(App.relabelText(rt.label || rt.key, { all: true }))); o.value = rt.key; if (rt.key === w.recDate.recordType) o.selected = true; ts.appendChild(o); });
        function loadRecDateFields() {
          if (!w.recDate.recordType) { w.recDate.fields = null; return; }
          w.recDate.loading = true;
          App.portalApi("/api/fields?recordType=" + encodeURIComponent(w.recDate.recordType))
            .then((fs) => { w.recDate.fields = (Array.isArray(fs) ? fs : []).filter((f) => f.type === "date"); })
            .catch(() => { w.recDate.fields = []; })
            .finally(() => { w.recDate.loading = false; renderExtra(); });
        }
        ts.onchange = () => { w.recDate.recordType = ts.value; w.recDate.field = ""; w.recDate.fields = null; loadRecDateFields(); renderExtra(); };
        rowType.appendChild(ts); extra.appendChild(rowType);

        const rowEl = el("div", "wiz-cond-row");
        const amt = el("input", "input"); amt.type = "number"; amt.min = "0"; amt.placeholder = "7"; amt.style.flex = "0 0 70px"; amt.value = w.recDate.amount; amt.oninput = () => { w.recDate.amount = amt.value; };
        const unit = el("select", "input"); [["days", "days"], ["weeks", "weeks"], ["months", "months"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (w.recDate.unit === v) o.selected = true; unit.appendChild(o); }); unit.onchange = () => { w.recDate.unit = unit.value; };
        const dir = el("select", "input"); [["before", "before"], ["after", "after"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (w.recDate.dir === v) o.selected = true; dir.appendChild(o); }); dir.onchange = () => { w.recDate.dir = dir.value; };
        const fs = el("select", "input");
        if (!w.recDate.recordType) { const o = el("option", null, "— pick a record type first —"); o.value = ""; fs.appendChild(o); fs.disabled = true; }
        else if (w.recDate.loading) { const o = el("option", null, "Loading…"); o.value = ""; fs.appendChild(o); fs.disabled = true; }
        else {
          const b = el("option", null, "— date field —"); b.value = ""; fs.appendChild(b);
          (w.recDate.fields || []).forEach((f) => { const o = el("option", null, esc(f.label)); o.value = f.key; if (f.key === w.recDate.field) o.selected = true; fs.appendChild(o); });
          fs.onchange = () => { w.recDate.field = fs.value; };
          if (!(w.recDate.fields || []).length) extra.appendChild(small("This record type has no Date fields yet. Add one under Settings → Modules & Fields (e.g. a service or renewal date)."));
        }
        rowEl.appendChild(amt); rowEl.appendChild(unit); rowEl.appendChild(dir); rowEl.appendChild(fs);
        extra.appendChild(rowEl);
        // Lazy-load the field list the first time we land on this trigger with a type already set (edit flow).
        if (w.recDate.recordType && w.recDate.fields === null && !w.recDate.loading) loadRecDateFields();
        extra.appendChild(hint("Evaluated by the daily sweep / “Process due jobs now”. Messages the record's linked contact, so Send email/SMS and Add note all work; use {{record_title}} and the date field in your message."));
      } else if (w.baseTrigger === "AppointmentReminder") {
        extra.appendChild(small("Send this long before a booking's appointment:"));
        const rowEl = el("div", "wiz-cond-row");
        const amt = el("input", "input"); amt.type = "number"; amt.min = "1"; amt.placeholder = "2"; amt.style.flex = "0 0 70px"; amt.value = w.remind.amount; amt.oninput = () => { w.remind.amount = amt.value; };
        const unit = el("select", "input"); [["minutes", "minutes"], ["hours", "hours"], ["days", "days"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (w.remind.unit === v) o.selected = true; unit.appendChild(o); }); unit.onchange = () => { w.remind.unit = unit.value; };
        const beforeLbl = el("span", "cell-muted", "before the appointment"); beforeLbl.style.cssText = "font-size:12.5px; align-self:center;";
        rowEl.appendChild(amt); rowEl.appendChild(unit); rowEl.appendChild(beforeLbl);
        extra.appendChild(rowEl);
        extra.appendChild(hint("Texts/emails the booking's linked contact. Based on the appointment's clock time; if your business isn't on UTC the send time shifts by your timezone offset."));
      } else if (w.baseTrigger === "Stalled") {
        extra.appendChild(small("Run when something has sat in its current stage, no movement, for at least this many days:"));
        const rowEl = el("div", "wiz-cond-row");
        const days = el("input", "input"); days.type = "number"; days.min = "1"; days.placeholder = "7"; days.style.flex = "0 0 80px"; days.value = w.stall.days || "7"; days.oninput = () => { w.stall.days = days.value; };
        const stageSel = el("select", "input"); const any = el("option", null, App.relabelText("Any stage", { all: true })); any.value = ""; stageSel.appendChild(any);
        (meta.stages || []).forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === w.stall.stageKey) o.selected = true; stageSel.appendChild(o); });
        stageSel.onchange = () => { w.stall.stageKey = stageSel.value; };
        rowEl.appendChild(days); rowEl.appendChild(stageSel);
        extra.appendChild(rowEl);
        extra.appendChild(hint("Evaluated by the daily sweep / “Process due jobs now”. The stalled contact is the subject — moving them resets the clock."));
      }
    }
    sel.onchange = () => { w.baseTrigger = sel.value; if (w.baseTrigger !== "FieldChanged") w.triggerField = ""; if (w.baseTrigger !== "StageChanged") w.triggerStage = ""; if (w.baseTrigger !== "RecordUpdated") { w.recField = ""; w.recValue = ""; } if (w.baseTrigger !== "Stalled") { w.stall.days = ""; w.stall.stageKey = ""; } if (w.baseTrigger !== "RecordDateReached") { w.recDate.recordType = ""; w.recDate.field = ""; w.recDate.fields = null; } renderExtra(); };
    renderExtra();
  }

  // --- Step 2: Filter (optional) ---
  function stepFilter(box, w) {
    box.appendChild(el("p", "wiz-q", "Only run when…? (optional)"));
    box.appendChild(el("p", "wiz-sub", "Add conditions that must ALL be true for the automation to run. Leave empty to run every time. You can skip this step."));
    const list = el("div");
    box.appendChild(list);
    function redraw() {
      list.innerHTML = "";
      w.filters.forEach((c, i) => list.appendChild(condRow(c, opsForType, () => { w.filters.splice(i, 1); redraw(); })));
      if (!w.filters.length) list.appendChild(hint("No conditions yet — it'll run on every matching trigger."));
    }
    redraw();
    const add = el("button", "rail-add", "+ Add condition");
    add.onclick = () => { w.filters.push({ field: "", op: "is", value: "" }); redraw(); };
    box.appendChild(add);
  }

  // --- Step 3: Branch (optional) ---
  function stepBranch(box, w) {
    box.appendChild(el("p", "wiz-q", "Do you want different actions depending on a condition?"));
    box.appendChild(el("p", "wiz-sub", "Choose “No” for one set of actions. Choose “Yes” to split into an “if this is true” path and an “otherwise” path."));
    const choice = el("div", "wiz-choice");
    const no = el("div", "wiz-choice-card" + (!w.branch ? " sel" : ""), `No, one set of actions<span class="wiz-choice-sub">Simplest — creates one draft</span>`);
    const yes = el("div", "wiz-choice-card" + (w.branch ? " sel" : ""), `Yes, split into two paths<span class="wiz-choice-sub">Creates two drafts (if / otherwise)</span>`);
    no.onclick = () => { w.branch = false; stepBranch((box.innerHTML = "", box), w); };
    yes.onclick = () => { w.branch = true; stepBranch((box.innerHTML = "", box), w); };
    choice.appendChild(no); choice.appendChild(yes);
    box.appendChild(choice);

    if (w.branch) {
      const cWrap = el("div"); cWrap.style.marginTop = "14px";
      cWrap.appendChild(small("Split on this condition (yes/no style):"));
      cWrap.appendChild(condRow(w.branchCond, branchOps, null));
      cWrap.appendChild(hint("The wizard will create one draft that runs when this is true, and a second draft (the exact opposite) for everything else."));
      box.appendChild(cWrap);
    }
  }

  // --- Step 4: Actions ---
  function stepActions(box, w) {
    box.appendChild(el("p", "wiz-q", "What should happen?"));
    box.appendChild(el("p", "wiz-sub", "Pick one or more actions. These are the same actions the builder offers; only options that exist in this portal are shown."));
    if (!w.branch) {
      const c = el("div"); box.appendChild(c); renderActionList(c, w.actionsIf, wizTriggerType(w));
    } else {
      const ifPath = el("div", "wiz-path");
      ifPath.appendChild(el("div", "wiz-path-title", `If <span class="b">${esc(condText(w.branchCond))}</span>`));
      const c1 = el("div"); ifPath.appendChild(c1); renderActionList(c1, w.actionsIf, wizTriggerType(w));
      box.appendChild(ifPath);
      const elsePath = el("div", "wiz-path");
      elsePath.appendChild(el("div", "wiz-path-title", "Otherwise"));
      const c2 = el("div"); elsePath.appendChild(c2); renderActionList(c2, w.actionsElse, wizTriggerType(w));
      box.appendChild(elsePath);
    }
  }

  // --- Step 5: Review ---
  function stepReview(box, w, overlay) {
    box.appendChild(el("p", "wiz-q", "Review and create"));
    box.appendChild(el("p", "wiz-sub", "Here's the automation you've assembled. Creating it saves an inactive DRAFT (or two, for a branch) you can review and switch on yourself — nothing runs automatically."));

    const nameWrap = el("div"); nameWrap.style.marginBottom = "14px";
    nameWrap.appendChild(label("Name"));
    const nameInp = el("input", "input");
    nameInp.value = w.name || (w.name = suggestName(w));
    nameInp.oninput = () => { w.name = nameInp.value; w.nameTouched = true; };
    nameWrap.appendChild(nameInp);
    box.appendChild(nameWrap);

    const filters = w.filters.filter(condComplete);
    const trg = el("div", "wiz-review-block");
    trg.innerHTML = `<div class="pv-k">When</div><div>${esc(whenText(wizTriggerType(w)))}</div>`;
    box.appendChild(trg);

    const fblock = el("div", "wiz-review-block");
    fblock.innerHTML = `<div class="pv-k">Only if</div>` + (filters.length ? `<ul>${filters.map((c) => `<li>${esc(condText(c))}</li>`).join("")}</ul>` : `<div class="cell-muted">Runs every time</div>`);
    box.appendChild(fblock);

    const actText = (arr) => arr.length ? `<ul>${arr.map((a) => `<li>${esc(actionSummary(a))}</li>`).join("")}</ul>` : `<div class="cell-muted">No actions</div>`;
    if (!w.branch) {
      const ab = el("div", "wiz-review-block");
      ab.innerHTML = `<div class="pv-k">Then</div>${actText(w.actionsIf)}`;
      box.appendChild(ab);
    } else {
      const ib = el("div", "wiz-review-block");
      ib.innerHTML = `<div class="pv-k">If ${esc(condText(w.branchCond))}</div>${actText(w.actionsIf)}`;
      box.appendChild(ib);
      const eb = el("div", "wiz-review-block");
      eb.innerHTML = `<div class="pv-k">Otherwise</div>${actText(w.actionsElse)}`;
      box.appendChild(eb);
      box.appendChild(el("div", "wiz-note", "This branch creates TWO draft automations — one for the “if” case and one for everything else — because each automation in the builder has a single condition set. Both are inactive until you turn them on."));
    }
  }

  // Plain-English one-liner for an assembled action (best-effort; falls back to
  // the action's label from /meta).
  function actionSummary(a) { return App.relabelText(actionSummaryRaw(a), { all: true }); }
  function actionSummaryRaw(a) {
    const c = a.config || {};
    if (a.type === "send_email") return "Send an email" + (c.subject ? ` (“${c.subject}”)` : "");
    if (a.type === "send_survey") { const s = (meta.surveys || []).find((x) => x.id === c.surveyId); return "Send survey" + (s ? ` (“${s.name}”)` : ""); }
    if (a.type === "unenroll") return c.scope === "all" ? "Unenroll from all flows" : "Unenroll from this flow";
    if (a.type === "send_sms") return "Send an SMS";
    if (a.type === "notify_business") { const ch = c.channel || "email"; const chl = ch === "both" ? "email + SMS" : ch === "sms" ? "SMS" : "email"; return `Notify the business (${chl})`; }
    if (a.type === "update_field") return `Set ${fieldLabel(c.field) || "a field"}` + (c.value ? ` to “${c.value}”` : "");
    if (a.type === "add_tag") return `Add tag “${c.value || ""}”` + (c.field ? ` on ${fieldLabel(c.field)}` : "");
    if (a.type === "remove_tag") return `Remove tag “${c.value || ""}”`;
    if (a.type === "create_note") return "Add an internal note";
    if (a.type === "assign_owner") return "Assign an owner";
    if (a.type === "wait") return `Wait ${c.amount || "?"} ${c.unit || "minutes"}, then continue`;
    if (a.type === "create_record") return "Create a new contact";
    if (a.type === "update_record") return "Update contact(s)";
    if (a.type === "search_records") return "Find contacts";
    if (a.type === "delete_record") return "Delete contact(s) to recycle bin";
    if (a.type === "create_record_item") return "Create a new record" + (c.recordType ? ` (${c.recordType})` : "");
    if (a.type === "update_record_item") return "Update field(s) on this record";
    if (a.type === "find_record_items") return "Find records" + (c.recordType ? ` (${c.recordType})` : "");
    if (a.type === "delete_record_items") return "Delete the found record(s) to recycle bin";
    if (a.type === "compute_field") return "Compute a value into a field";
    if (a.type === "send_webhook") return "Send a webhook";
    if (a.type === "act_on_linked") { const s = c.subAction || "note"; return s === "email" ? "Email each linked contact (mock)" : s === "sms" ? "Message each linked contact (mock)" : "Note each linked contact"; }
    return actionLabel(a.type);
  }

  async function createWizardDrafts(w, overlay) {
    const tt = wizTriggerType(w);
    const filters = w.filters.filter(condComplete);
    const baseName = (w.name || suggestName(w)).trim() || "Wizard automation";
    const apply = (definition) => App.portalApi("/api/automations/apply-flow", { method: "POST", body: JSON.stringify({ definition }) });
    try {
      const results = [];
      if (!w.branch) {
        results.push(await apply({ name: baseName, triggerType: tt, conditions: filters, actions: w.actionsIf }));
      } else {
        const bc = { ...w.branchCond };
        // Shared token that durably links the two drafts on the list, so a
        // half-enabled pair is obvious later. Survives renaming; same-portal only.
        const pairId = newPairId();
        results.push(await apply({ name: baseName + " (if)", triggerType: tt, conditions: [...filters, bc], actions: w.actionsIf, pairId }));
        results.push(await apply({ name: baseName + " (otherwise)", triggerType: tt, conditions: [...filters, negate(bc)], actions: w.actionsElse, pairId }));
      }
      overlay.remove();
      const names = results.map((r) => r.automation.name);
      toast(results.length > 1 ? `Created 2 drafts: ${names.join("  +  ")}` : "Draft automation created");
      await render(host);
      openEditor(results[0].automation, { missing: results[0].missing || [] });
    } catch (e) {
      toast(e.message, true);
    }
  }

  function workflowCard(a, pairInfo) {
    const card = el("div", "card auto-card");
    const top = el("div", "auto-card-head");

    // Small "Branch pair" tag on the name line when this card is part of a pair.
    let pairTag = "";
    if (pairInfo && pairInfo.kind === "id") pairTag = ` <span class="pair-pill">Branch pair</span>`;
    else if (pairInfo && pairInfo.kind === "name") pairTag = ` <span class="pair-pill soft">Possible pair</span>`;
    // "From drip" badge for drip-generated automations (the drip is the source of truth).
    let dripTag = "";
    if (a.dripId) dripTag = ` <span class="pair-pill" style="background:#e0e7ff;color:#3730a3">⚡ From drip${a.dripName ? ": " + esc(a.dripName) : ""}</span>`;

    const left = el("div", "auto-card-main");
    left.innerHTML = `<div class="auto-name">${esc(a.name)}${pairTag}${dripTag}</div>
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
        // If this card is part of a durable pair, re-render so the half-enabled
        // warning appears/clears against the partner's current state.
        if (pairInfo && pairInfo.kind === "id" && pairInfo.partner) render(host);
      } catch (e) { cb.checked = !cb.checked; toast(e.message, true); }
    };
    toggle.appendChild(cb);
    toggle.appendChild(el("span", "switch-track"));
    // A drip-generated automation's on/off state is owned by the drip; don't offer a toggle here
    // that a recompile would overwrite. Show a static state chip instead.
    if (a.dripId) {
      const chip = el("span", "pair-pill", a.enabled ? "On (via drip)" : "Off (via drip)");
      chip.style.cssText = "background:" + (a.enabled ? "#dcfce7;color:#166534" : "#f1f5f9;color:#6b7280");
      top.appendChild(chip);
    } else {
      top.appendChild(toggle);
    }
    card.appendChild(top);

    // Half-enabled warning: durable pair only. Gentle, plain-English, and driven
    // purely by the two enabled states — never by name-matching.
    if (pairInfo && pairInfo.kind === "id" && pairInfo.partner && a.enabled && !pairInfo.partner.enabled) {
      card.appendChild(el("div", "pair-warn",
        App.relabelText(`This is on, but its paired automation “${esc(pairInfo.partner.name)}” is turned off — contacts on that branch will get nothing. Turn both on for full coverage.`, { all: true })));
    }
    // Quiet note if the partner of a durable pair was deleted.
    if (pairInfo && pairInfo.orphan) {
      card.appendChild(el("div", "pair-orphan-note", "Its branch partner was deleted — this now runs on its own."));
    }

    const actions = el("div", "auto-card-foot");
    const test = el("button", "btn btn-ghost btn-sm", "Test");
    test.onclick = () => openTest(a);
    const logs = el("button", "btn btn-ghost btn-sm", "Logs");
    logs.onclick = () => { tab = "runs"; render(host).then(() => filterRuns(a.id)); };
    if (a.dripId) {
      // Drip is the source of truth: send the user there to edit or delete. We don't offer a direct
      // Edit/Delete here so a recompile can't silently overwrite their changes.
      const openDrip = el("button", "btn btn-ghost btn-sm", "Open drip →");
      openDrip.onclick = () => { if (App.communication && App.communication.openDrip) App.communication.openDrip(a.dripId); else App.go("#/communication"); };
      [openDrip, test, logs].forEach((b) => actions.appendChild(b));
      card.appendChild(actions);
      card.appendChild(el("div", "pair-orphan-note", "Managed by a drip — edit or remove it from the Drips tab."));
      return card;
    }
    const edit = el("button", "btn btn-ghost btn-sm", "Edit");
    edit.onclick = () => openEditor(a);
    const del = el("button", "link-danger", "Delete");
    del.onclick = async () => {
      if (!(await App.ui.confirmModal({ title: "Delete automation", message: `Delete automation “${a.name}”?`, confirmText: "Delete" }))) return;
      try { await App.portalApi(`/api/automations/${a.id}`, { method: "DELETE" }); toast("Deleted"); render(host); }
      catch (e) { toast(e.message, true); }
    };
    // Audience-enrollment automations get an "Enroll audience" button that resolves the audience's
    // current members and runs them through this automation (via the engine).
    if (triggerBase(a.triggerType) === "EnrollAudience") {
      const enroll = el("button", "btn btn-ghost btn-sm", "Enroll audience");
      enroll.onclick = async () => {
        if (!a.enabled) { toast("Turn the automation on first, then enroll.", true); return; }
        enroll.disabled = true; enroll.textContent = "Enrolling…";
        try { const r = await App.portalApi(`/api/automations/${a.id}/enroll`, { method: "POST", body: JSON.stringify({}) }); toast(`Enrolled ${r.enrolled} contact${r.enrolled === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} skipped)` : ""}.`); }
        catch (e) { toast(e.message, true); }
        finally { enroll.disabled = false; enroll.textContent = "Enroll audience"; }
      };
      [enroll, edit, test, logs, del].forEach((b) => actions.appendChild(b));
      card.appendChild(actions);
      return card;
    }
    [edit, test, logs, del].forEach((b) => actions.appendChild(b));
    card.appendChild(actions);
    return card;
  }

  function rc(rule) { return App.table.ruleComplete(rule); }

  // ---------------- Condition columns (for ruleEditor) ----------------
  // For a record-subject trigger, the condition picker/evaluator uses the
  // record's OWN fields (Status, Title, Type, record custom fields); otherwise
  // the contact fields, exactly as before. The two never mix.
  function buildColumns(triggerType) {
    if (isRecordTrigger(triggerType)) {
      return (meta.recordConditionFields || []).map((f) => ({
        key: f.key, label: f.label,
        type: f.type === "percent" ? "number" : (f.type === "date" ? "date" : (f.type === "number" ? "number" : "text")),
        get: (row) => recordValueOf(row, f.key),
        text: (row) => scalar(recordValueOf(row, f.key)),
      }));
    }
    return (meta.fields || []).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type === "percent" ? "number" : (f.type === "date" ? "date" : (f.type === "number" ? "number" : "text")),
      get: (row) => valueOf(row, f.key),
      text: (row) => scalar(valueOf(row, f.key)),
    })).concat([{
      // Audience membership condition: "contact is in Audience X". Value picker uses meta.audiences;
      // the server resolves the audience's current members at run time (same evalRules mechanism).
      key: "__audience", label: "Audience membership", type: "audience", options: meta.audiences || [],
      get: (row) => (Array.isArray(row.__audienceIds) ? row.__audienceIds : []),
      text: () => "",
    }]);
  }
  function valueOf(row, key) {
    if (key === "createdAt") return row.createdAt;
    if (["name", "phone", "email", "intent"].includes(key)) return row[key];
    return (row.customFields || {})[key];
  }
  function recordValueOf(row, key) {
    if (key === "status") return row.stageKey;
    if (key === "title") return row.title;
    if (key === "subtypeKey") return row.subtypeKey;
    if (key === "createdAt") return row.createdAt;
    if (key === "appointmentAt") return row.appointmentAt;
    if (key === "resource") return row.resourceName != null ? row.resourceName : (row.resource && row.resource.name);
    return (row.customFields || {})[key];
  }
  function scalar(v) { return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v); }

  // ---------------- Editor: vertical workflow builder ----------------
  // Layout: [Name] then a top-to-bottom flow — TRIGGER -> CONDITIONS (optional)
  // -> ACTIONS — connected by simple connector lines. Same data, same save
  // payload, same API as before; only the presentation changed.
  function openEditor(existing, opts) {
    _emailEditorFlushers = []; // fresh editor session — drop any stale capture handlers
    const draft = existing
      ? { id: existing.id, name: existing.name, triggerType: existing.triggerType, conditions: (existing.conditions || []).map((r) => ({ ...r })), actions: (existing.actions || []).map((a) => ({ type: a.type, config: { ...(a.config || {}) } })) }
      : { name: "", triggerType: (meta.triggers[0] && meta.triggers[0].type) || "ContactCreated", conditions: [], actions: [] };

    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>${existing ? "Edit automation" : "New automation"}</h2><button class="icon-btn" id="a-close">&times;</button></div>`;
    const bodyEl = el("div", "modal-body");
    inner.appendChild(bodyEl);

    // If this draft was just applied from a template and references fields that
    // don't exist in this portal, flag it right where the user reviews it. The
    // draft stays inactive; this explains what to fix before turning it on.
    const warnMissing = (opts && opts.missing) || [];
    if (warnMissing.length) {
      const names = warnMissing.map((m) => "“" + esc(m.label || m.key) + "”").join(", ");
      const verb = warnMissing.length > 1 ? "don't" : "doesn't";
      const them = warnMissing.length > 1 ? "them" : "it";
      const wb = el("div", "wf-warnbar");
      wb.innerHTML = `<strong>Needs attention before you turn it on.</strong> This draft uses ${names}, which ${verb} exist in this portal yet. Create or map ${them} under <em>Fields</em>, then switch this automation on. It stays an inactive draft until you do.`;
      bodyEl.appendChild(wb);
    }

    // --- Name ---
    const nameRow = el("div", "wf-name-row");
    nameRow.appendChild(label("Automation name"));
    const nameInp = el("input", "input");
    nameInp.value = draft.name;
    nameInp.placeholder = "e.g. Welcome new leads";
    nameInp.oninput = () => { draft.name = nameInp.value; };
    nameRow.appendChild(nameInp);
    bodyEl.appendChild(nameRow);

    // --- Live plain-English preview (Batch C1 Pass 2) ---
    // Reads the in-progress `draft` and assembles a "When / Only if / Then"
    // readout using the SAME functions the wizard review uses (whenText,
    // condText, actionSummary) plus the shared FlowPreview assembler, so the two
    // can't drift. Re-rendered on every trigger/condition/action change.
    const previewNode = el("div", "wf-preview");
    previewNode.style.cssText = "margin:12px 0 4px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);font-size:13px;line-height:1.55;";
    bodyEl.appendChild(previewNode);
    const PV_LAB = 'style="color:var(--ink-soft);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-right:7px;"';
    const PV_MUTED = 'style="color:var(--ink-soft);"';
    const PV_TODO = 'style="color:var(--amber);"';
    function previewLine(lab, bodyHtml) {
      const d = el("div"); d.style.marginTop = "4px";
      d.innerHTML = `<span ${PV_LAB}>${lab}</span>${bodyHtml}`;
      return d;
    }
    function renderPreview() {
      const tt = draft.triggerType;
      // Resolve condition labels against THIS trigger's field set (record vs
      // contact), then restore — same approach the wizard uses.
      const prevCT = _condTrigger; _condTrigger = tt;
      const complete = (draft.conditions || []).filter(rc);
      const condLines = complete.map(condText);
      const incompleteConds = (draft.conditions || []).filter((c) => c && c.field && !rc(c)).length;
      _condTrigger = prevCT;
      const actLines = (draft.actions || []).map(actionSummary);
      const FP = (typeof FlowPreview !== "undefined") ? FlowPreview : null;
      previewNode.innerHTML = "";
      if (!FP) { previewNode.style.display = "none"; return; }
      previewNode.style.display = "";
      const model = FP.flowModel({ when: whenText(tt), whenIncomplete: isWhenIncomplete(tt), conditions: condLines, incompleteConditions: incompleteConds, actions: actLines });
      previewNode.appendChild(el("div", null, `<span ${PV_LAB}>Preview</span>`));
      previewNode.lastChild.style.marginBottom = "6px";
      if (model.placeholder) {
        previewNode.appendChild(el("div", null, `<span ${PV_MUTED}>Pick a trigger to see a preview.</span>`));
        return;
      }
      previewNode.appendChild(previewLine("When", esc(model.whenLine) + (model.triggerIncomplete ? ` <span ${PV_TODO}>(incomplete)</span>` : "")));
      let condHtml = model.runsEveryTime
        ? `<span ${PV_MUTED}>runs every time</span>`
        : model.conditionLines.map(esc).join(` <span ${PV_MUTED}>and</span> `);
      if (model.incompleteConditions > 0) condHtml += ` <span ${PV_TODO}>(${model.incompleteConditions} still being filled in)</span>`;
      previewNode.appendChild(previewLine("Only if", condHtml));
      const actHtml = model.noActions
        ? `<span ${PV_TODO}>no actions yet — it won't do anything</span>`
        : model.actionLines.map(esc).join(` <span ${PV_MUTED}>→</span> `);
      previewNode.appendChild(previewLine("Then", actHtml));
    }

    // --- The flow ---
    const flow = el("div", "wf-builder");
    bodyEl.appendChild(flow);

    // STEP 1: Trigger
    // Field-scoped change -> "FieldChanged:<key>". Date-relative schedule ->
    // "Scheduled:<field>:<amount>:<unit>:<dir>". Split the stored value so the
    // right sub-controls show.
    let baseTrigger = draft.triggerType || "ContactCreated";
    let triggerField = "";
    let triggerStage = "";
    let recField = "";
    let recValue = "";
    const sched = { field: "", amount: "", unit: "days", dir: "before" };
    const recDate = { recordType: "", field: "", amount: "", unit: "days", dir: "before", fields: null, loading: false };
    const remind = { amount: "2", unit: "hours" };
    const stall = { days: "", stageKey: "" };
    if (baseTrigger.indexOf("FieldChanged:") === 0) {
      triggerField = baseTrigger.slice("FieldChanged:".length); baseTrigger = "FieldChanged";
    } else if (baseTrigger.indexOf("StageChanged:") === 0) {
      triggerStage = baseTrigger.slice("StageChanged:".length); baseTrigger = "StageChanged";
    } else if (baseTrigger.indexOf("RecordUpdated:") === 0) {
      const rest = baseTrigger.slice("RecordUpdated:".length);
      const eq = rest.indexOf("=");
      if (eq >= 0) { recField = rest.slice(0, eq); recValue = rest.slice(eq + 1); }
      else { recField = rest; recValue = ""; }
      baseTrigger = "RecordUpdated";
    } else if (baseTrigger.indexOf("Scheduled:") === 0) {
      const p = baseTrigger.slice("Scheduled:".length).split(":");
      sched.field = p[0] || ""; sched.amount = p[1] || ""; sched.unit = p[2] || "days"; sched.dir = p[3] || "before";
      baseTrigger = "Scheduled";
    } else if (baseTrigger.indexOf("RecordDateReached:") === 0) {
      const p = baseTrigger.slice("RecordDateReached:".length).split(":");
      recDate.recordType = p[0] || ""; recDate.field = p[1] || ""; recDate.amount = p[2] || ""; recDate.unit = p[3] || "days"; recDate.dir = p[4] || "before";
      baseTrigger = "RecordDateReached";
    } else if (baseTrigger.indexOf("AppointmentReminder:") === 0) {
      const p = baseTrigger.slice("AppointmentReminder:".length).split(":");
      remind.amount = p[0] || "2"; remind.unit = p[1] || "hours";
      baseTrigger = "AppointmentReminder";
    } else if (baseTrigger.indexOf("Stalled:") === 0) {
      const p = baseTrigger.slice("Stalled:".length).split(":");
      stall.days = p[0] || ""; stall.stageKey = p[1] || "";
      baseTrigger = "Stalled";
    }
    function syncTrigger() {
      if (baseTrigger === "FieldChanged" && triggerField) draft.triggerType = "FieldChanged:" + triggerField;
      else if (baseTrigger === "StageChanged" && triggerStage) draft.triggerType = "StageChanged:" + triggerStage;
      else if (baseTrigger === "RecordUpdated" && recField) draft.triggerType = recValue ? ("RecordUpdated:" + recField + "=" + recValue) : ("RecordUpdated:" + recField);
      else if (baseTrigger === "Scheduled") draft.triggerType = `Scheduled:${sched.field}:${sched.amount || 0}:${sched.unit}:${sched.dir}`;
      else if (baseTrigger === "RecordDateReached") draft.triggerType = `RecordDateReached:${recDate.recordType}:${recDate.field}:${recDate.amount || 0}:${recDate.unit}:${recDate.dir}`;
      else if (baseTrigger === "AppointmentReminder") draft.triggerType = `AppointmentReminder:${remind.amount || 2}:${remind.unit}:before`;
      else if (baseTrigger === "Stalled") draft.triggerType = "Stalled:" + (stall.days || 7) + (stall.stageKey ? ":" + stall.stageKey : "");
      else draft.triggerType = baseTrigger;
    }
    syncTrigger();

    flow.appendChild(stepHead("trigger", "TRIGGER", "When this happens", null));
    flow.appendChild(hint("Choose the event that starts this workflow."));
    const trigNode = el("div", "wf-node trigger-node");
    const trig = el("select", "input");
    fillTriggerSelect(trig, baseTrigger);
    trigNode.appendChild(trig);
    // One-line description of the chosen trigger (display-only; theme tokens only).
    const trigDesc = el("div", "wf-help-desc");
    trigDesc.style.cssText = "margin-top:6px;font-size:12.5px;color:var(--ink-soft);";
    trigNode.appendChild(trigDesc);
    // Sub-controls area (field picker for FieldChanged, hint for Manual)
    const trigExtra = el("div");
    trigExtra.addEventListener("input", () => renderPreview());
    trigExtra.addEventListener("change", () => renderPreview());
    trigExtra.style.marginTop = "10px";
    trigNode.appendChild(trigExtra);
    function renderTrigExtra() {
      trigDesc.textContent = triggerDescription(baseTrigger);
      trigExtra.innerHTML = "";
      if (baseTrigger === "FieldChanged") {
        trigExtra.appendChild(small("Which field? (choose “Any field” to run on every change)"));
        const fieldSel = el("select", "input");
        const any = el("option", null, "Any field"); any.value = ""; fieldSel.appendChild(any);
        (meta.fields || []).filter((f) => f.key !== "createdAt").forEach((f) => {
          const o = el("option", null, esc(f.label)); o.value = f.key; if (f.key === triggerField) o.selected = true; fieldSel.appendChild(o);
        });
        fieldSel.onchange = () => { triggerField = fieldSel.value; syncTrigger(); };
        trigExtra.appendChild(fieldSel);
      } else if (baseTrigger === "StageChanged") {
        trigExtra.appendChild(small("Which stage? (choose “Any stage” to run on every stage change)"));
        const stageSel = el("select", "input");
        const any = el("option", null, App.relabelText("Any stage", { all: true })); any.value = ""; stageSel.appendChild(any);
        (meta.stages || []).forEach((s) => {
          const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === triggerStage) o.selected = true; stageSel.appendChild(o);
        });
        stageSel.onchange = () => { triggerStage = stageSel.value; syncTrigger(); };
        trigExtra.appendChild(stageSel);
        if (!(meta.stages || []).length) {
          trigExtra.appendChild(small("No pipeline stages found yet. You can still choose “Any stage”."));
        }
        const note = el("div", "wf-hint", ""); note.style.margin = "6px 0 0";
        note.textContent = App.relabelText("Runs when a linked contact moves to a different stage on a record. The contact is the subject.", { all: true });
        trigExtra.appendChild(note);
      } else if (baseTrigger === "RecordUpdated") {
        trigExtra.appendChild(small("Which field changed? (choose “Any field” for any change)"));
        const fieldSel = el("select", "input");
        const anyF = el("option", null, "Any field"); anyF.value = ""; fieldSel.appendChild(anyF);
        (meta.recordFields || []).forEach((f) => { const o = el("option", null, esc(f.label)); o.value = f.key; if (f.key === recField) o.selected = true; fieldSel.appendChild(o); });
        trigExtra.appendChild(fieldSel);
        const valueHost = el("div"); valueHost.style.marginTop = "8px"; trigExtra.appendChild(valueHost);
        function renderRecValue() {
          valueHost.innerHTML = "";
          if (!recField) return; // "Any field" -> no value scoping
          valueHost.appendChild(small("Only when it changes to (optional):"));
          if (recField === "status" && (meta.recordStatuses || []).length) {
            const vs = el("select", "input");
            const anyV = el("option", null, "Any value"); anyV.value = ""; vs.appendChild(anyV);
            (meta.recordStatuses || []).forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === recValue) o.selected = true; vs.appendChild(o); });
            vs.onchange = () => { recValue = vs.value; syncTrigger(); };
            valueHost.appendChild(vs);
          } else {
            const vi = el("input", "input"); vi.placeholder = "any value"; vi.value = recValue; vi.oninput = () => { recValue = vi.value.trim(); syncTrigger(); };
            valueHost.appendChild(vi);
          }
        }
        fieldSel.onchange = () => { recField = fieldSel.value; recValue = ""; renderRecValue(); syncTrigger(); };
        renderRecValue();
        const rnote = el("div", "wf-hint", ""); rnote.style.margin = "6px 0 0";
        rnote.textContent = "Acts on the record itself. Only “Create internal note” works for records in this stage — email/SMS to a record will be blocked, not sent.";
        trigExtra.appendChild(rnote);
      } else if (baseTrigger === "Manual") {
        const note = el("div", "wf-hint", "");
        note.textContent = App.relabelText("This flow does not fire on its own. It runs when you open a contact and click “Run automation.”", { all: true });
        note.style.margin = "0";
        trigExtra.appendChild(note);
      } else if (baseTrigger === "Scheduled") {
        const dateFields = (meta.fields || []).filter((f) => f.type === "date");
        if (!dateFields.length) {
          trigExtra.appendChild(small("No Date fields exist yet. Create one under Fields first (e.g. “18th Birthday Date”)."));
        }
        const rowEl = el("div"); rowEl.style.display = "flex"; rowEl.style.gap = "6px"; rowEl.style.flexWrap = "wrap";
        const amt = el("input", "input"); amt.type = "number"; amt.style.cssText = "margin-bottom:0;flex:0 0 70px"; amt.placeholder = "6"; amt.value = sched.amount; amt.oninput = () => { sched.amount = amt.value; syncTrigger(); };
        const unitSel = el("select", "input"); unitSel.style.marginBottom = "0";
        [["days", "days"], ["weeks", "weeks"], ["months", "months"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (sched.unit === v) o.selected = true; unitSel.appendChild(o); });
        unitSel.onchange = () => { sched.unit = unitSel.value; syncTrigger(); };
        const dirSel = el("select", "input"); dirSel.style.marginBottom = "0";
        [["before", "before"], ["after", "after"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (sched.dir === v) o.selected = true; dirSel.appendChild(o); });
        dirSel.onchange = () => { sched.dir = dirSel.value; syncTrigger(); };
        const fieldSel = el("select", "input"); fieldSel.style.marginBottom = "0";
        const blank = el("option", null, "— date field —"); blank.value = ""; fieldSel.appendChild(blank);
        dateFields.forEach((f) => { const o = el("option", null, esc(f.label)); o.value = f.key; if (f.key === sched.field) o.selected = true; fieldSel.appendChild(o); });
        fieldSel.onchange = () => { sched.field = fieldSel.value; syncTrigger(); };
        trigExtra.appendChild(small("Run this many, before/after, which date field:"));
        rowEl.appendChild(amt); rowEl.appendChild(unitSel); rowEl.appendChild(dirSel); rowEl.appendChild(fieldSel);
        trigExtra.appendChild(rowEl);
        const note2 = el("div", "wf-hint", ""); note2.style.margin = "6px 0 0";
        note2.textContent = "Evaluated by the daily sweep / “Process due jobs now”, not instantly.";
        trigExtra.appendChild(note2);
      } else if (baseTrigger === "RecordDateReached") {
        const types = (meta.recordTypes || []).filter((rt) => !(App.isRecordTypeLocked && App.isRecordTypeLocked(rt.key)));
        if (!types.length) trigExtra.appendChild(small("No record types are available to you. (A locked type won't appear here.)"));
        trigExtra.appendChild(small("Which record type, which date field, and how far before/after:"));
        const typeRow = el("div"); typeRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px";
        const typeSel = el("select", "input"); typeSel.style.marginBottom = "0";
        const tb = el("option", null, "— record type —"); tb.value = ""; typeSel.appendChild(tb);
        types.forEach((rt) => { const o = el("option", null, esc(App.relabelText(rt.label || rt.key, { all: true }))); o.value = rt.key; if (rt.key === recDate.recordType) o.selected = true; typeSel.appendChild(o); });
        function loadRecDateFields() {
          if (!recDate.recordType) { recDate.fields = null; return; }
          recDate.loading = true;
          App.portalApi("/api/fields?recordType=" + encodeURIComponent(recDate.recordType))
            .then((fs) => { recDate.fields = (Array.isArray(fs) ? fs : []).filter((f) => f.type === "date"); })
            .catch(() => { recDate.fields = []; })
            .finally(() => { recDate.loading = false; renderTrigExtra(); });
        }
        typeSel.onchange = () => { recDate.recordType = typeSel.value; recDate.field = ""; recDate.fields = null; syncTrigger(); loadRecDateFields(); renderTrigExtra(); };
        typeRow.appendChild(typeSel); trigExtra.appendChild(typeRow);

        const rowEl = el("div"); rowEl.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
        const amt = el("input", "input"); amt.type = "number"; amt.min = "0"; amt.style.cssText = "margin-bottom:0;flex:0 0 70px"; amt.placeholder = "7"; amt.value = recDate.amount; amt.oninput = () => { recDate.amount = amt.value; syncTrigger(); };
        const unitSel = el("select", "input"); unitSel.style.marginBottom = "0";
        [["days", "days"], ["weeks", "weeks"], ["months", "months"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (recDate.unit === v) o.selected = true; unitSel.appendChild(o); });
        unitSel.onchange = () => { recDate.unit = unitSel.value; syncTrigger(); };
        const dirSel = el("select", "input"); dirSel.style.marginBottom = "0";
        [["before", "before"], ["after", "after"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (recDate.dir === v) o.selected = true; dirSel.appendChild(o); });
        dirSel.onchange = () => { recDate.dir = dirSel.value; syncTrigger(); };
        const fieldSel = el("select", "input"); fieldSel.style.marginBottom = "0";
        if (!recDate.recordType) { const o = el("option", null, "— pick a record type first —"); o.value = ""; fieldSel.appendChild(o); fieldSel.disabled = true; }
        else if (recDate.loading) { const o = el("option", null, "Loading…"); o.value = ""; fieldSel.appendChild(o); fieldSel.disabled = true; }
        else {
          const blank = el("option", null, "— date field —"); blank.value = ""; fieldSel.appendChild(blank);
          (recDate.fields || []).forEach((f) => { const o = el("option", null, esc(f.label)); o.value = f.key; if (f.key === recDate.field) o.selected = true; fieldSel.appendChild(o); });
          fieldSel.onchange = () => { recDate.field = fieldSel.value; syncTrigger(); };
          if (!(recDate.fields || []).length) trigExtra.appendChild(small("This record type has no Date fields yet. Add one under Settings → Modules & Fields."));
        }
        rowEl.appendChild(amt); rowEl.appendChild(unitSel); rowEl.appendChild(dirSel); rowEl.appendChild(fieldSel);
        trigExtra.appendChild(rowEl);
        if (recDate.recordType && recDate.fields === null && !recDate.loading) loadRecDateFields();
        const note4 = el("div", "wf-hint", ""); note4.style.margin = "6px 0 0";
        note4.textContent = "Evaluated by the daily sweep / “Process due jobs now”. Messages the record's linked contact — use {{record_title}} and the date field in your message.";
        trigExtra.appendChild(note4);
      } else if (baseTrigger === "AppointmentReminder") {
        trigExtra.appendChild(small("Send this long before a booking's appointment:"));
        const rowEl = el("div"); rowEl.style.display = "flex"; rowEl.style.gap = "6px"; rowEl.style.flexWrap = "wrap"; rowEl.style.alignItems = "center";
        const amt = el("input", "input"); amt.type = "number"; amt.min = "1"; amt.style.cssText = "margin-bottom:0;flex:0 0 70px"; amt.placeholder = "2"; amt.value = remind.amount; amt.oninput = () => { remind.amount = amt.value; syncTrigger(); };
        const unitSel = el("select", "input"); unitSel.style.marginBottom = "0";
        [["minutes", "minutes"], ["hours", "hours"], ["days", "days"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (remind.unit === v) o.selected = true; unitSel.appendChild(o); });
        unitSel.onchange = () => { remind.unit = unitSel.value; syncTrigger(); };
        const lbl = el("span", "cell-muted", "before the appointment"); lbl.style.fontSize = "12.5px";
        rowEl.appendChild(amt); rowEl.appendChild(unitSel); rowEl.appendChild(lbl);
        trigExtra.appendChild(rowEl);
        const note3 = el("div", "wf-hint", ""); note3.style.margin = "6px 0 0";
        note3.textContent = "Texts/emails the booking's linked contact. Based on the appointment's clock time; if your business isn't on UTC the send time shifts by your timezone offset.";
        trigExtra.appendChild(note3);
      } else if (baseTrigger === "Stalled") {
        trigExtra.appendChild(small("Run when something has sat in its current stage, with no movement, for at least this many days:"));
        const rowEl = el("div"); rowEl.style.display = "flex"; rowEl.style.gap = "6px"; rowEl.style.flexWrap = "wrap"; rowEl.style.alignItems = "center";
        const days = el("input", "input"); days.type = "number"; days.min = "1"; days.style.cssText = "margin-bottom:0;flex:0 0 80px"; days.placeholder = "7"; days.value = stall.days || "7";
        days.oninput = () => { stall.days = days.value; syncTrigger(); };
        const lbl = el("span", "wf-hint", "days"); lbl.style.margin = "0";
        rowEl.appendChild(days); rowEl.appendChild(lbl);
        trigExtra.appendChild(rowEl);
        trigExtra.appendChild(small("In which stage? (choose “Any stage” to watch every stage)"));
        const stageSel = el("select", "input"); stageSel.style.marginBottom = "0";
        const any = el("option", null, App.relabelText("Any stage", { all: true })); any.value = ""; stageSel.appendChild(any);
        (meta.stages || []).forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === stall.stageKey) o.selected = true; stageSel.appendChild(o); });
        stageSel.onchange = () => { stall.stageKey = stageSel.value; syncTrigger(); };
        trigExtra.appendChild(stageSel);
        if (!(meta.stages || []).length) trigExtra.appendChild(small("No pipeline stages found yet. You can still choose “Any stage”."));
        const snote = el("div", "wf-hint", ""); snote.style.margin = "6px 0 0";
        snote.textContent = "Evaluated by the daily sweep / “Process due jobs now”, not instantly. The stalled contact is the subject — moving them resets the clock.";
        trigExtra.appendChild(snote);
      }
    }
    trig.onchange = () => { baseTrigger = trig.value; if (baseTrigger !== "FieldChanged") triggerField = ""; if (baseTrigger !== "StageChanged") triggerStage = ""; if (baseTrigger !== "RecordUpdated") { recField = ""; recValue = ""; } if (baseTrigger !== "Stalled") { stall.days = ""; stall.stageKey = ""; } if (baseTrigger !== "RecordDateReached") { recDate.recordType = ""; recDate.field = ""; recDate.fields = null; } syncTrigger(); renderTrigExtra(); renderConditions(); redrawActions(); renderPreview(); };
    renderTrigExtra();
    flow.appendChild(trigNode);

    flow.appendChild(connector());

    // STEP 2: Conditions (optional)
    flow.appendChild(stepHead("conditions", "CONDITIONS", "Only continue if…", "optional"));
    flow.appendChild(hint("All conditions must match. Use OR to start a new group. Leave empty to always run."));
    const condNode = el("div", "wf-node");
    condNode.addEventListener("input", () => renderPreview());
    condNode.addEventListener("change", () => renderPreview());
    flow.appendChild(condNode);
    // Re-rendered when the trigger changes so the field picker reflects the
    // subject: record fields for a record trigger, contact fields otherwise.
    function renderConditions() {
      condNode.innerHTML = "";
      condNode.appendChild(App.table.ruleEditor(buildColumns(draft.triggerType), [], draft.conditions, () => renderPreview()));
    }
    renderConditions();

    flow.appendChild(connector());

    // STEP 3: Actions
    flow.appendChild(stepHead("actions", "ACTIONS", "Then do this", null));
    flow.appendChild(hint("These run in order, top to bottom, when the trigger fires and the conditions match."));
    const actionsWrap = el("div", "wf-actions-list");
    actionsWrap.addEventListener("input", () => renderPreview());
    actionsWrap.addEventListener("change", () => renderPreview());
    flow.appendChild(actionsWrap);

    function redrawActions() {
      flushEmailEditors(); // capture any open email editor before its DOM is torn down
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
      add.onclick = () => { const opts = allowedActions(draft.triggerType); draft.actions.push({ type: (opts[0] && opts[0].type) || "create_note", config: {} }); redrawActions(); };
      actionsWrap.appendChild(add);
      renderPreview();
    }
    redrawActions();
    renderPreview();

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
      flushEmailEditors(); // make sure the rich-text editor's content is captured first
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
    const opts = allowedActions(draft && draft.triggerType).slice();
    // Keep a previously-saved action visible even if it's not in the current
    // allowed set (e.g. after switching trigger), so nothing is silently changed.
    if (act.type && !opts.some((a) => a.type === act.type)) opts.unshift({ type: act.type, label: actionLabel(act.type) });
    opts.forEach((a) => { const o = el("option", null, esc(App.relabelText(a.label, { all: true }))); o.value = a.type; if (a.type === act.type) o.selected = true; sel.appendChild(o); });
    sel.onchange = () => { act.type = sel.value; act.config = {}; redraw(); };
    head.appendChild(sel);
    const rm = el("button", "rule-remove", "&times;");
    rm.onclick = () => { draft.actions.splice(idx, 1); redraw(); };
    head.appendChild(rm);
    row.appendChild(head);
    // One-line description of the chosen action (display-only; rebuilt on change
    // because changing the select calls redraw()). Theme tokens only.
    const adesc = el("div", "wf-help-desc");
    adesc.style.cssText = "margin:2px 0 8px 30px;font-size:12.5px;color:var(--ink-soft);";
    adesc.textContent = actionDescription(act.type);
    if (adesc.textContent) row.appendChild(adesc);

    const cfg = el("div", "wf-action-cfg");
    buildActionConfig(act, cfg, draft && draft.triggerType);
    row.appendChild(cfg);
    return row;
  }

  // --- Rich-text email action: capture + template resolution helpers -----------
  // The "Send email" action now uses the shared compose editor (App.compose.mount,
  // kind:"email"). Quill doesn't write through to the action config on every change
  // the way a <textarea>'s oninput did, so we register a "flush" per mounted editor
  // that copies the editor's subject + body back into the action config. We call
  // flushEmailEditors() before the action list is rebuilt (redrawActions) and before
  // saving, so changing the action type or saving can never lose what was typed.
  // (Editors also flush live on input and on focus-out as a belt-and-suspenders.)
  let _emailEditorFlushers = [];
  function flushEmailEditors() {
    const list = _emailEditorFlushers.slice();
    _emailEditorFlushers = [];
    list.forEach(function (fn) { try { fn(); } catch (e) { /* detached editor — ignore */ } });
  }
  // meta.templates carries only id/name (no body), so to pre-fill the editor for an
  // OLDER automation that referenced a template by id we fetch the full templates
  // once (same source compose uses) and resolve the body/subject from it.
  let _emailTplCache = null;
  async function resolveEmailTemplate(id) {
    if (!id) return null;
    try {
      if (!_emailTplCache) _emailTplCache = await App.portalApi("/api/templates?kind=email");
      return (_emailTplCache || []).find(function (t) { return t.id === id; }) || null;
    } catch (e) { return null; }
  }

  function buildActionConfig(act, cfg, triggerType) {
    const c = act.config || (act.config = {});
    const isStalled = triggerType === "Stalled" || (typeof triggerType === "string" && triggerType.indexOf("Stalled:") === 0);
    // Stage 3c: the stalled-stage sweep can match many candidates, so a direct
    // email/SMS action becomes fan-out. Mirror 2b's gate: require an explicit ack
    // to message more than the threshold. Only shown for the Stalled trigger.
    const appendBulkGate = () => {
      if (!isStalled) return;
      const cbWrap = el("div"); cbWrap.style.marginTop = "8px"; cbWrap.style.display = "flex"; cbWrap.style.alignItems = "center"; cbWrap.style.gap = "7px";
      const cb = el("input"); cb.type = "checkbox"; cb.checked = !!c.allowBulk; cb.onchange = () => { c.allowBulk = cb.checked; };
      const lbl = el("label", null, App.relabelText("Allow sending to more than 25 stalled contacts in one sweep", { all: true }));
      lbl.style.fontSize = "12.5px"; lbl.style.color = "var(--ink-soft)"; lbl.style.cursor = "pointer";
      lbl.onclick = () => { cb.checked = !cb.checked; c.allowBulk = cb.checked; };
      cbWrap.appendChild(cb); cbWrap.appendChild(lbl); cfg.appendChild(cbWrap);
      cfg.appendChild(small("Comms are mocked, so nothing actually sends yet — this gate is here for when real keys are added."));
    };
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
      options.forEach((o) => { const op = el("option", null, esc(App.relabelText(o.label, { all: true }))); op.value = o.value; if (c[key] === o.value) op.selected = true; s.appendChild(op); });
      s.onchange = () => { c[key] = s.value; };
      return s;
    };
    // Field/value rows for RECORD actions: settable record fields (Status, Title,
    // record custom fields) from meta.recordConditionFields. Stored as c.values.
    const recordValueRows = (cc) => {
      if (!Array.isArray(cc.values)) cc.values = [];
      const opts = (meta.recordConditionFields || []).filter((f) => f.key !== "createdAt" && f.key !== "subtypeKey").map((f) => ({ value: f.key, label: f.label }));
      const list = el("div");
      function redraw() {
        list.innerHTML = "";
        cc.values.forEach((row, i) => {
          const r = el("div"); r.style.display = "flex"; r.style.gap = "6px"; r.style.marginBottom = "6px";
          const fs = el("select", "input"); fs.style.flex = "0 0 42%"; fs.style.marginBottom = "0";
          const b = el("option", null, "— field —"); b.value = ""; fs.appendChild(b);
          opts.forEach((o) => { const op = el("option", null, esc(o.label)); op.value = o.value; if (row.field === o.value) op.selected = true; fs.appendChild(op); });
          fs.onchange = () => { row.field = fs.value; };
          const vi = el("input", "input"); vi.style.marginBottom = "0"; vi.placeholder = "value (supports {{field}})"; vi.value = row.value || ""; vi.oninput = () => { row.value = vi.value; };
          const rm = el("button", "rule-remove", "&times;"); rm.onclick = () => { cc.values.splice(i, 1); redraw(); };
          r.appendChild(fs); r.appendChild(vi); r.appendChild(rm); list.appendChild(r);
        });
        const add = el("button", "rail-add", "+ Add field"); add.onclick = () => { cc.values.push({ field: "", value: "" }); redraw(); };
        list.appendChild(add);
      }
      redraw();
      return list;
    };

    if (act.type === "send_email") {
      // Full parity with bulk email: the compose editor (kind:"email") owns the
      // Subject, the rich-text toolbar, AND Templates / Insert signature / Header
      // image — so the action's old separate subject + template controls are gone.
      // It reads/writes the SAME config keys the engine already uses (c.subject,
      // c.html), so storage/replay/merge-tags are unchanged (UI-only swap).
      const host = el("div", "wf-compose-host");
      host.style.marginTop = "4px";
      cfg.appendChild(host);
      const api = App.compose.mount(host, { kind: "email" });
      // Load existing content. New / inline-HTML automations use c.subject + c.html.
      // Older automations that referenced a template by id (c.templateId, blank body)
      // resolve that template's saved HTML into the editor so it opens showing the
      // real content (and still sends the same thing).
      api.setSubject(c.subject || "");
      if (c.html) {
        api.setBody(c.html);
      } else if (c.templateId) {
        resolveEmailTemplate(c.templateId).then(function (t) {
          if (t) { api.setSubject(c.subject || t.subject || ""); api.setBody(t.body || ""); }
        });
      }
      // Capture the editor back into the action config. Once edited, the body lives
      // inline in c.html, so the old templateId reference is retired (the engine
      // sends c.html as HTML and substitutes {{tags}} — both already work).
      const flush = function () {
        c.subject = api.getSubject();
        c.html = api.getHTML();
        if (c.templateId) delete c.templateId;
      };
      host.addEventListener("input", flush);    // live capture while typing
      host.addEventListener("focusout", flush);  // capture when focus leaves (e.g. clicking Save / changing action type)
      _emailEditorFlushers.push(flush);          // guaranteed capture before any rebuild/save
      appendBulkGate();
    } else if (act.type === "send_sms") {
      const tpls = (meta.templates || []).filter((t) => t.kind === "sms").map((t) => ({ value: t.id, label: t.name }));
      if (tpls.length) { cfg.appendChild(small("Template (optional)")); cfg.appendChild(selectOf("templateId", tpls)); }
      cfg.appendChild(small("Message (supports {{field}})")); cfg.appendChild(text("body", "Hi {{name}}!", true));
      appendBulkGate();
    } else if (act.type === "notify_business") {
      if (!c.channel) c.channel = "email";
      // SMS off → OFFER email only and DISPLAY as email, but don't overwrite a stored
      // sms/both channel (so it restores when SMS_ENABLED is flipped back on).
      const effChannel = () => (meta.smsEnabled ? (c.channel || "email") : "email");
      cfg.appendChild(small("Send to the business via"));
      const chSel = el("select", "input");
      const chOpts = meta.smsEnabled ? [["email", "Email"], ["sms", "SMS (text)"], ["both", "Email + SMS"]] : [["email", "Email"]];
      chOpts.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (effChannel() === v) o.selected = true; chSel.appendChild(o); });
      chSel.onchange = () => { c.channel = chSel.value; rebuildNotify(); };
      cfg.appendChild(chSel);
      const sub = el("div"); sub.style.marginTop = "8px"; cfg.appendChild(sub);
      function rebuildNotify() {
        sub.innerHTML = "";
        const ch = effChannel();
        if (ch === "email" || ch === "both") {
          sub.appendChild(small("Email to (leave blank to use your Notify email from Settings → General)"));
          sub.appendChild(text("toEmail", "optional override e.g. you@yourbusiness.com"));
          sub.appendChild(small("Subject (supports {{field}})"));
          sub.appendChild(text("subject", "New lead: {{name}}"));
        }
        if (ch === "sms" || ch === "both") {
          sub.appendChild(small("Text to (required for SMS — your mobile number)"));
          sub.appendChild(text("toPhone", "+1 555 123 4567"));
        }
        sub.appendChild(small("Message (supports {{name}}, {{phone}}, {{intent}}, {{email}}, {{source}})"));
        sub.appendChild(text("body", "New lead: {{name}} — {{phone}} — {{intent}}", true));
      }
      rebuildNotify();
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
    } else if (act.type === "act_on_linked") {
      if (!c.subAction) c.subAction = "note";
      // SMS off → OFFER note/email only and DISPLAY a stored "sms" as note, without
      // overwriting it (restores when SMS_ENABLED is flipped back on).
      const effSub = () => ((!meta.smsEnabled && c.subAction === "sms") ? "note" : (c.subAction || "note"));
      cfg.appendChild(small("Do this to each linked contact:"));
      const subSel = el("select", "input");
      const subOpts = [["note", "Add internal note (on each contact's timeline)"], ["email", "Send mock email to each"]];
      if (meta.smsEnabled) subOpts.push(["sms", "Send mock SMS to each"]);
      subOpts.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (effSub() === v) o.selected = true; subSel.appendChild(o); });
      subSel.onchange = () => { c.subAction = subSel.value; rebuildLinked(); };
      cfg.appendChild(subSel);
      const sub = el("div"); sub.style.marginTop = "8px"; cfg.appendChild(sub);
      function rebuildLinked() {
        sub.innerHTML = "";
        const subAction = effSub();
        if (subAction === "email") {
          sub.appendChild(small("Subject (supports {{name}}, {{record_title}})")); sub.appendChild(text("subject", "Update on {{record_title}}"));
          sub.appendChild(small("Body (HTML, supports {{field}})")); sub.appendChild(text("html", "Hi {{name}}, there's an update on {{record_title}}.", true));
        } else if (subAction === "sms") {
          sub.appendChild(small("Message (supports {{name}}, {{record_title}})")); sub.appendChild(text("body", "Hi {{name}} — update on {{record_title}}.", true));
        } else {
          sub.appendChild(small("Note (supports {{name}}, {{record_title}})")); sub.appendChild(text("text", "Update on {{record_title}} — please review.", true));
        }
        if (subAction === "email" || subAction === "sms") {
          const cbWrap = el("div"); cbWrap.style.marginTop = "8px"; cbWrap.style.display = "flex"; cbWrap.style.alignItems = "center"; cbWrap.style.gap = "7px";
          const cb = el("input"); cb.type = "checkbox"; cb.checked = !!c.allowBulk; cb.onchange = () => { c.allowBulk = cb.checked; };
          const lbl = el("label", null, App.relabelText("Allow sending to more than 25 linked contacts in one run", { all: true }));
          lbl.style.fontSize = "12.5px"; lbl.style.color = "var(--ink-soft)"; lbl.style.cursor = "pointer";
          lbl.onclick = () => { cb.checked = !cb.checked; c.allowBulk = cb.checked; };
          cbWrap.appendChild(cb); cbWrap.appendChild(lbl); sub.appendChild(cbWrap);
          sub.appendChild(small("Comms are mocked, so nothing actually sends yet — this gate is here for when real keys are added."));
        }
      }
      rebuildLinked();
    } else if (act.type === "move_to_stage") {
      cfg.appendChild(small("Move the linked contacts to which stage?"));
      cfg.appendChild(selectOf("stageKey", (meta.stages || []).map((s) => ({ value: s.key, label: s.label }))));
      cfg.appendChild(small("Only move those currently in (optional):"));
      cfg.appendChild(selectOf("fromStage", (meta.stages || []).map((s) => ({ value: s.key, label: s.label })), "Any stage"));
      if (!(meta.stages || []).length) cfg.appendChild(small("No pipeline stages found yet."));
      const cbWrap = el("div"); cbWrap.style.marginTop = "8px"; cbWrap.style.display = "flex"; cbWrap.style.alignItems = "center"; cbWrap.style.gap = "7px";
      const cb = el("input"); cb.type = "checkbox"; cb.checked = !!c.allowBulk; cb.onchange = () => { c.allowBulk = cb.checked; };
      const lbl = el("label", null, App.relabelText("Allow moving more than 25 contacts in one run", { all: true })); lbl.style.fontSize = "12.5px"; lbl.style.color = "var(--ink-soft)"; lbl.style.cursor = "pointer"; lbl.onclick = () => { cb.checked = !cb.checked; c.allowBulk = cb.checked; };
      cbWrap.appendChild(cb); cbWrap.appendChild(lbl); cfg.appendChild(cbWrap);
      cfg.appendChild(small("An automated move does not set off other automations (loop-safe), and is recorded in the contact's stage history."));
    } else if (act.type === "set_record_field") {
      cfg.appendChild(small("Which field on the record?"));
      const fieldSel = selectOf("field", (meta.recordFields || []).map((f) => ({ value: f.key, label: f.label })));
      cfg.appendChild(fieldSel);
      const valueHost = el("div"); valueHost.style.marginTop = "8px"; cfg.appendChild(valueHost);
      function renderRecVal() {
        valueHost.innerHTML = "";
        valueHost.appendChild(small("Set to:"));
        if (c.field === "status" && (meta.recordStatuses || []).length) {
          valueHost.appendChild(selectOf("value", (meta.recordStatuses || []).map((s) => ({ value: s.key, label: s.label }))));
        } else {
          valueHost.appendChild(text("value", "value (supports {{field}})"));
        }
      }
      fieldSel.onchange = () => { c.field = fieldSel.value; c.value = ""; renderRecVal(); };
      renderRecVal();
      cfg.appendChild(small("An automated change does not set off other automations (loop-safe)."));
    } else if (act.type === "assign_owner") {
      const users = (meta.users || []).map((u) => ({ value: u.id, label: u.name }));
      cfg.appendChild(small("Owner")); cfg.appendChild(selectOf("userId", users));
    } else if (act.type === "send_survey") {
      cfg.appendChild(small("Which survey to send? Each recipient gets their own personal link."));
      const ss = el("select", "input"); ss.style.marginBottom = "8px";
      const blank = el("option", null, "— pick a survey —"); blank.value = ""; ss.appendChild(blank);
      (meta.surveys || []).forEach((s) => { const o = el("option", null, esc(s.name)); o.value = s.id; if (s.id === c.surveyId) o.selected = true; ss.appendChild(o); });
      ss.onchange = () => { c.surveyId = ss.value; };
      cfg.appendChild(ss);
      if (!(meta.surveys || []).length) cfg.appendChild(small("No surveys yet — create one under Communication → Surveys first."));
      cfg.appendChild(small("Email subject:"));
      const subj = el("input", "input"); subj.placeholder = "We'd love your feedback"; subj.value = c.subject || ""; subj.oninput = () => { c.subject = subj.value; }; cfg.appendChild(subj);
      cfg.appendChild(small("Invite message (optional — the personal survey link is added automatically):"));
      const body = el("textarea", "input"); body.rows = 4; body.placeholder = "Hi {{name}}, please take a moment to…"; body.value = c.html || ""; body.oninput = () => { c.html = body.value; }; cfg.appendChild(body);
    } else if (act.type === "unenroll") {
      cfg.appendChild(small("Stop this contact's in-progress run(s) — cancels their remaining scheduled (waited) steps:"));
      if (!c.scope) c.scope = "this";
      const sel = el("select", "input");
      [["this", "This flow only"], ["all", "All flows"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (c.scope === v) o.selected = true; sel.appendChild(o); });
      sel.onchange = () => { c.scope = sel.value; };
      cfg.appendChild(sel);
      cfg.appendChild(small("Use this to end a nurture early (e.g. once someone replies or converts)."));
    } else if (act.type === "wait") {
      cfg.appendChild(small("Wait this long, then run the actions listed below this step:"));
      if (!c.unit) c.unit = "minutes";
      const rowEl = el("div"); rowEl.style.display = "flex"; rowEl.style.gap = "6px";
      const amt = el("input", "input"); amt.type = "number"; amt.style.cssText = "margin-bottom:0;flex:0 0 90px"; amt.placeholder = "2"; amt.value = c.amount != null ? c.amount : ""; amt.oninput = () => { c.amount = amt.value; };
      const unitSel = el("select", "input"); unitSel.style.marginBottom = "0";
      [["minutes", "minutes"], ["hours", "hours"], ["days", "days"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (c.unit === v) o.selected = true; unitSel.appendChild(o); });
      unitSel.onchange = () => { c.unit = unitSel.value; };
      rowEl.appendChild(amt); rowEl.appendChild(unitSel); cfg.appendChild(rowEl);
      cfg.appendChild(small("Actions above this step run immediately; everything below runs after the wait."));
    } else if (act.type === "create_record") {
      cfg.appendChild(small("New contact's field values (must include at least an email or phone, per this CRM's rules; required fields apply):"));
      cfg.appendChild(valueRowsEditor(c));
    } else if (act.type === "update_record") {
      cfg.appendChild(small("Which contacts to update?"));
      cfg.appendChild(targetSelect(c, "contact"));
      cfg.appendChild(small("Set these fields (supports {{field}}):"));
      cfg.appendChild(valueRowsEditor(c));
    } else if (act.type === "search_records") {
      cfg.appendChild(small("Find contacts where… (leave empty to match all active contacts). A later Update/Delete action set to “Contacts found by a Find action” will act on these."));
      if (!Array.isArray(c.conditions)) c.conditions = [];
      const w = el("div", "cond-wrap");
      w.appendChild(App.table.ruleEditor(buildColumns(), contacts, c.conditions, () => {}));
      cfg.appendChild(w);
    } else if (act.type === "delete_record") {
      cfg.appendChild(small("Which contacts to delete? Deleted contacts go to the Recycle Bin and can be restored."));
      cfg.appendChild(targetSelect(c, "contact"));
      const cbWrap = el("div"); cbWrap.style.marginTop = "8px"; cbWrap.style.display = "flex"; cbWrap.style.alignItems = "center"; cbWrap.style.gap = "7px";
      const cb = el("input"); cb.type = "checkbox"; cb.checked = !!c.allowBulk; cb.onchange = () => { c.allowBulk = cb.checked; };
      const lbl = el("label", null, App.relabelText("Allow deleting more than 10 contacts in one run", { all: true }));
      lbl.style.fontSize = "12.5px"; lbl.style.color = "var(--ink-soft)"; lbl.style.cursor = "pointer";
      lbl.onclick = () => { cb.checked = !cb.checked; c.allowBulk = cb.checked; };
      cbWrap.appendChild(cb); cbWrap.appendChild(lbl); cfg.appendChild(cbWrap);
    } else if (act.type === "create_record_item") {
      cfg.appendChild(small("Record type to create:"));
      const typeSel = el("select", "input");
      const tb = el("option", null, "— choose —"); tb.value = ""; typeSel.appendChild(tb);
      (meta.recordTypes || []).filter((t) => !App.isRecordTypeLocked(t.key)).forEach((t) => { const o = el("option", null, esc(t.label)); o.value = t.key; if (c.recordType === t.key) o.selected = true; typeSel.appendChild(o); });
      cfg.appendChild(typeSel);
      cfg.appendChild(small("Title (supports {{field}}):"));
      cfg.appendChild(text("title", App.relabelText("New record title", { all: true })));
      const depHost = el("div"); depHost.style.marginTop = "8px"; cfg.appendChild(depHost);
      function renderCreateDeps() {
        depHost.innerHTML = "";
        const t = (meta.recordTypes || []).find((x) => x.key === c.recordType);
        if (!t) { depHost.appendChild(small("Choose a record type to set its Type/Status and fields.")); return; }
        if ((t.subtypes || []).length) { depHost.appendChild(small("Type / subtype (required for this record type):")); depHost.appendChild(selectOf("subtypeKey", t.subtypes.map((s) => ({ value: s.key, label: s.label })))); }
        if ((t.statuses || []).length) { depHost.appendChild(small("Initial status (optional):")); depHost.appendChild(selectOf("stageKey", t.statuses.map((s) => ({ value: s.key, label: s.label })), "— none —")); }
        depHost.appendChild(small("Other field values (optional):"));
        depHost.appendChild(recordValueRows(c));
      }
      typeSel.onchange = () => { c.recordType = typeSel.value; c.subtypeKey = ""; c.stageKey = ""; renderCreateDeps(); };
      renderCreateDeps();
    } else if (act.type === "update_record_item") {
      cfg.appendChild(small("Set these fields on this record (the trigger record), supports {{field}}:"));
      cfg.appendChild(recordValueRows(c));
      cfg.appendChild(small("An automated change does not set off other automations (loop-safe)."));
    } else if (act.type === "find_record_items") {
      cfg.appendChild(small("Find records of this type:"));
      cfg.appendChild(selectOf("recordType", (meta.recordTypes || []).filter((t) => !App.isRecordTypeLocked(t.key)).map((t) => ({ value: t.key, label: t.label }))));
      cfg.appendChild(small("…matching these conditions (leave empty to match all of that type). A later Delete records action will act on the matches:"));
      if (!Array.isArray(c.conditions)) c.conditions = [];
      const w = el("div", "cond-wrap");
      w.appendChild(App.table.ruleEditor(buildColumns(triggerType), [], c.conditions, () => {}));
      cfg.appendChild(w);
    } else if (act.type === "delete_record_items") {
      cfg.appendChild(small("Deletes the records found by a Find records action above. Deleted records go to the Recycle Bin and can be restored."));
      const cbWrap = el("div"); cbWrap.style.marginTop = "8px"; cbWrap.style.display = "flex"; cbWrap.style.alignItems = "center"; cbWrap.style.gap = "7px";
      const cb = el("input"); cb.type = "checkbox"; cb.checked = !!c.allowBulk; cb.onchange = () => { c.allowBulk = cb.checked; };
      const lbl = el("label", null, App.relabelText("Allow deleting more than 10 records in one run", { all: true }));
      lbl.style.fontSize = "12.5px"; lbl.style.color = "var(--ink-soft)"; lbl.style.cursor = "pointer";
      lbl.onclick = () => { cb.checked = !cb.checked; c.allowBulk = cb.checked; };
      cbWrap.appendChild(cb); cbWrap.appendChild(lbl); cfg.appendChild(cbWrap);
    } else if (act.type === "compute_field") {
      cfg.appendChild(small("Which records?"));
      cfg.appendChild(targetSelect(c));
      if (!c.op) c.op = "date_add";
      if (!c.unit) c.unit = "years";
      const inner = el("div");
      cfg.appendChild(inner);
      const renderCompute = () => {
        inner.innerHTML = "";
        inner.appendChild(small("Operation"));
        const opSel = el("select", "input");
        [["date_add", "Add to a date"], ["date_subtract", "Subtract from a date"], ["copy", "Copy a value (no math)"]].forEach(([v, l]) => {
          const o = el("option", null, l); o.value = v; if (c.op === v) o.selected = true; opSel.appendChild(o);
        });
        opSel.onchange = () => { c.op = opSel.value; renderCompute(); };
        inner.appendChild(opSel);

        const isDate = c.op === "date_add" || c.op === "date_subtract";
        const dateFields = (meta.fields || []).filter((f) => f.type === "date").map((f) => ({ value: f.key, label: f.label }));
        const writable = (meta.fields || []).filter((f) => f.key !== "createdAt" && f.type !== "formula" && f.type !== "image").map((f) => ({ value: f.key, label: f.label }));
        const srcOptions = isDate ? dateFields : writable;
        const destOptions = isDate ? dateFields.filter((o) => o.value !== "createdAt") : writable;

        inner.appendChild(small(isDate ? "Source date field" : "Copy from field"));
        inner.appendChild(selectOf("source", srcOptions));

        if (isDate) {
          inner.appendChild(small("Amount"));
          const rowEl = el("div"); rowEl.style.display = "flex"; rowEl.style.gap = "6px";
          const amt = el("input", "input"); amt.type = "number"; amt.style.marginBottom = "0"; amt.placeholder = "18"; amt.value = c.amount != null ? c.amount : ""; amt.oninput = () => { c.amount = amt.value; };
          const unitSel = el("select", "input"); unitSel.style.marginBottom = "0";
          [["years", "years"], ["months", "months"], ["days", "days"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (c.unit === v) o.selected = true; unitSel.appendChild(o); });
          unitSel.onchange = () => { c.unit = unitSel.value; };
          rowEl.appendChild(amt); rowEl.appendChild(unitSel); inner.appendChild(rowEl);
        }

        inner.appendChild(small("Write result to (destination field)"));
        inner.appendChild(selectOf("dest", destOptions));
        if (isDate && !destOptions.length) inner.appendChild(small("No Date fields exist yet. Create one under Fields first (e.g. “18th Birthday Date”)."));
      };
      renderCompute();
    } else if (act.type === "send_webhook") {
      cfg.appendChild(small("URL to POST to (must be https or http; internal/private addresses are blocked)"));
      const urlInp = text("url", "https://webhook.site/your-unique-id");
      cfg.appendChild(urlInp);
      const warn = el("div", "wf-hint", ""); warn.style.margin = "0 0 8px"; warn.style.color = "var(--amber)";
      const refreshWarn = () => { warn.textContent = /^http:\/\//i.test(c.url || "") ? "Heads up: http:// sends data unencrypted. https is recommended." : ""; };
      refreshWarn(); urlInp.addEventListener("input", refreshWarn); cfg.appendChild(warn);
      cfg.appendChild(small("Optional header name (e.g. Authorization)"));
      cfg.appendChild(text("headerName", "Authorization"));
      cfg.appendChild(small("Optional header value / secret (stored with the flow; sent as a header; never shown in logs)"));
      const secret = text("headerValue", "Bearer …"); secret.type = "password"; cfg.appendChild(secret);
      cfg.appendChild(small("What gets sent (shape):"));
      const pre = el("pre"); pre.style.cssText = "background:var(--gray-soft);border-radius:var(--radius-sm);padding:8px;font-size:11px;overflow:auto;margin:0 0 8px";
      pre.textContent = '{\n  "source": "ClarityCRM",\n  "event": { "tenantId", "automationName", "trigger", "occurredAt" },\n  "contact": { "id", "fields": { ...your fields... } }\n}';
      cfg.appendChild(pre);
      const testBar = el("div"); testBar.style.cssText = "display:flex;align-items:center;gap:10px";
      const testBtn = el("button", "btn btn-ghost btn-sm", "Send test");
      const testOut = el("span", "wf-hint"); testOut.style.margin = "0";
      testBtn.onclick = async () => {
        if (!c.url) { testOut.textContent = "Enter a URL first."; return; }
        testBtn.disabled = true; testOut.textContent = "Sending test…";
        try {
          const r = await App.portalApi("/api/automations/webhook-test", { method: "POST", body: JSON.stringify({ url: c.url, headerName: c.headerName, headerValue: c.headerValue }) });
          if (r.blocked) testOut.textContent = "Blocked: " + r.reason;
          else if (r.ok) testOut.textContent = `Sent ✓ (HTTP ${r.status})`;
          else if (r.outcome === "timeout") testOut.textContent = "Timed out (no response in 5s)";
          else testOut.textContent = r.status ? `Sent, but got HTTP ${r.status}` : "Request failed";
        } catch (e) { testOut.textContent = e.message; }
        finally { testBtn.disabled = false; }
      };
      testBar.appendChild(testBtn); testBar.appendChild(testOut); cfg.appendChild(testBar);
    }
  }

  // Target chooser for update/delete record actions: the triggering record, or
  // the set produced by an earlier "Find records" action in the same flow.
  function targetSelect(c, noun) {
    const n = noun || "record";
    const plural = n.charAt(0).toUpperCase() + n.slice(1) + "s";
    if (!c.target) c.target = "trigger";
    const s = el("select", "input");
    [["trigger", `This ${n} (the trigger)`], ["search", `${plural} found by a Find action above`]].forEach(([v, l]) => {
      const o = el("option", null, l); o.value = v; if (c.target === v) o.selected = true; s.appendChild(o);
    });
    s.onchange = () => { c.target = s.value; };
    return s;
  }

  // Repeating field=value editor for create/update record actions. Stores into
  // c.values = [{ field, value }]. System keys map to top-level; others to
  // custom fields (handled server-side).
  function valueRowsEditor(c) {
    if (!Array.isArray(c.values)) c.values = [];
    const writable = (meta.fields || []).filter((f) => f.key !== "createdAt" && f.type !== "formula" && f.type !== "image").map((f) => ({ value: f.key, label: f.label }));
    const list = el("div");
    function redraw() {
      list.innerHTML = "";
      c.values.forEach((row, i) => {
        const r = el("div"); r.style.display = "flex"; r.style.gap = "6px"; r.style.marginBottom = "6px";
        const fs = el("select", "input"); fs.style.flex = "0 0 42%"; fs.style.marginBottom = "0";
        const blank = el("option", null, "— field —"); blank.value = ""; fs.appendChild(blank);
        writable.forEach((o) => { const op = el("option", null, esc(o.label)); op.value = o.value; if (row.field === o.value) op.selected = true; fs.appendChild(op); });
        fs.onchange = () => { row.field = fs.value; };
        const vi = el("input", "input"); vi.style.marginBottom = "0"; vi.placeholder = "value (supports {{field}})"; vi.value = row.value || ""; vi.oninput = () => { row.value = vi.value; };
        const rm = el("button", "rule-remove", "&times;");
        rm.onclick = () => { c.values.splice(i, 1); redraw(); };
        r.appendChild(fs); r.appendChild(vi); r.appendChild(rm); list.appendChild(r);
      });
      const add = el("button", "rail-add", "+ Add field");
      add.onclick = () => { c.values.push({ field: "", value: "" }); redraw(); };
      list.appendChild(add);
    }
    redraw();
    return list;
  }

  // ---------------- Test run ----------------
  function openTest(a) {
    if (!contacts.length) { toast(App.relabelText("No contacts to test against", { all: true }), true); return; }
    const inner = el("div");
    inner.innerHTML = `<div class="modal-head"><h2>Test “${esc(a.name)}”</h2><button class="icon-btn" id="t-close">&times;</button></div>`;
    const b = el("div", "modal-body");
    b.appendChild(small("Run this automation against a contact now. Conditions are still evaluated; actions will really run (emails/SMS respect mock mode)."));
    const sel = el("select", "input");
    contacts.slice(0, 500).forEach((c) => { const o = el("option", null, esc(c.name || c.phone || c.id)); o.value = c.id; sel.appendChild(o); });
    b.appendChild(label(App.relabelText("Contact", { all: true })));
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
    let events;
    try { events = await App.portalApi("/api/automations/events"); }
    catch (e) { body.innerHTML = `<div class="cell-muted" style="padding:24px">${esc(e.message)}</div>`; return; }
    body.innerHTML = "";
    const host = el("div", "fade-in");
    body.appendChild(host);

    // Same columns the log always showed — event type, who/what triggered it, and
    // when — but now rendered through the shared table so the Events tab filters,
    // sorts, and exports exactly like Contacts, Calls, Feedback and the Recycle Bin.
    const columns = [
      { key: "type", label: "Event", type: "text", get: (r) => r.type, cellClass: "cell-strong", render: (r) => `<span class="pill">${esc(r.type)}</span>` },
      { key: "actor", label: "By", type: "text", get: (r) => r.actorName || r.actorType || "", render: (r) => `<span class="cell-muted">${esc(r.actorName || r.actorType || "—")}</span>` },
      { key: "occurredAt", label: "When", type: "date", get: (r) => r.occurredAt, text: (r) => fmt(r.occurredAt), render: (r) => `<span class="log-time">${esc(fmt(r.occurredAt))}</span>` },
    ];
    const handle = App.table.mount({
      container: host, columns, rows: events,
      defaultSort: "occurredAt", defaultSortDir: "desc",
      emptyHtml: `<div class="card cell-muted" style="padding:18px">No events yet.</div>`,
      pageSize: 50,
    });

    // Export — the shared CSV/Excel export + export-history, identical to the other
    // tables. The dialog re-filters over the full set with the same rule engine, then
    // saves to this portal's export history (POST /api/exports).
    if (handle && handle.toolbarRight) {
      const exportBtn = el("button", "btn btn-ghost btn-sm", `<span class="btn-icon">&#8679;</span> Export`);
      exportBtn.onclick = () => App.exportModal({
        columns, rows: events,
        title: "Export events",
        namePlaceholder: "e.g. June automation events",
        filterLabel: "Which events to export",
        unitPlural: "events",
        sheetName: "Events",
        dataType: "event",
        countText: (n) => `${n} event${n === 1 ? "" : "s"}`,
      });
      handle.toolbarRight.insertBefore(exportBtn, handle.toolbarRight.firstChild);
    }
  }

  // ---------------- Scheduled tab ----------------
  async function renderScheduled(body) {
    body.innerHTML = `<div class="cell-muted" style="padding:24px">Loading…</div>`;
    let jobs;
    try { jobs = await App.portalApi("/api/automations/jobs"); }
    catch (e) { body.innerHTML = `<div class="cell-muted" style="padding:24px">${esc(e.message)}</div>`; return; }
    body.innerHTML = "";

    // Plain-English explainer so a non-technical user understands what this tab is.
    const explain = el("div");
    explain.style.cssText = "font-size:13px;color:var(--ink-soft);line-height:1.55;margin:2px 0 14px";
    explain.textContent = "When an automation has a “wait” step, the delayed part is queued here until it's due. You can see what's scheduled and cancel a job before it runs.";
    body.appendChild(explain);

    // Super-admin-only manual processor (stand-in for the deployed host heartbeat).
    const isSuper = App.state && App.state.me && App.isAdminTier(App.state.me.role);
    if (isSuper) {
      const bar = el("div", "wf-process-bar");
      const btn = el("button", "btn btn-primary btn-sm", "Process due jobs now");
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = "Processing…";
        try {
          const r = await App.portalApi("/api/automations/jobs/process", { method: "POST" });
          toast(`Swept ${r.swept}, ran ${r.ran}, failed ${r.failed}` + (r.stalledMatched != null ? ` · stalled: matched ${r.stalledMatched}, acted ${r.stalledActed}${r.stalledBlocked ? `, blocked ${r.stalledBlocked}` : ""}` : ""));
          renderScheduled(body);
        } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = "Process due jobs now"; }
      };
      bar.appendChild(btn);
      bar.appendChild(el("span", "wf-process-note", "Runs the daily sweep and any jobs now due. Respects mock mode (sends are logged, not transmitted)."));
      body.appendChild(bar);
    }

    if (!jobs.length) { body.appendChild(el("div", "cell-muted", "No scheduled jobs yet.")); return; }
    const list = el("div", "log-list");
    jobs.forEach((j) => list.appendChild(jobRow(j, body)));
    body.appendChild(list);
  }

  function jobRow(j, body) {
    const row = el("div", "job-item");
    const dot = el("span", "status-dot " + esc(j.status));
    row.appendChild(dot);
    const main = el("div", "job-main");
    const when = j.status === "pending"
      ? "scheduled for " + fmt(j.dueAt)
      : (j.status === "done" ? "ran" : j.status === "canceled" ? "canceled" : "failed") + " · was due " + fmt(j.dueAt);
    main.innerHTML = `<div class="job-desc">${esc(j.description || (j.automationName || "Job"))}</div>
      <div class="job-sub">${esc(when)}${j.automationName ? " · " + esc(j.automationName) : ""}</div>
      ${j.error ? `<div class="job-err">${esc(j.error)}</div>` : ""}`;
    row.appendChild(main);
    if (j.status === "pending") {
      const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
      cancel.onclick = async () => {
        if (!(await App.ui.confirmModal({ title: "Cancel scheduled job", message: "Cancel this scheduled job?", confirmText: "Cancel job", cancelText: "Keep job" }))) return;
        try { await App.portalApi(`/api/automations/jobs/${j.id}/cancel`, { method: "POST" }); toast("Canceled"); renderScheduled(body); }
        catch (e) { toast(e.message, true); }
      };
      row.appendChild(cancel);
    }
    return row;
  }

  function label(t) { return el("label", "field-label", esc(t)); }
  function small(t) { const s = el("div", "cfg-label"); s.textContent = App.relabelText(t, { all: true }); return s; }
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
