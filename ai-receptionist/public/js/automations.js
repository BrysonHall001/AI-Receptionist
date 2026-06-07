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
    head.innerHTML = `<div><h1 class="page-title">Automations</h1>
      <p class="page-sub">Run actions automatically when things happen in your CRM.</p></div>`;
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

  function triggerLabel(type) {
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
    return a ? a.label : type;
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
    return triggerLabel(type);
  }
  function isWhenIncomplete(type) {
    if (!type) return true;
    if (type.indexOf("Scheduled:") === 0) return !type.slice("Scheduled:".length).split(":")[0];
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
    if (tt.indexOf("Stalled:") === 0) return "Stalled";
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
  const TRIGGER_GROUP_ORDER = ["When something changes", "Messaging & tags", "Time-based", "Manual"];
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
        const o = el("option", null, esc(t.label)); o.value = t.type; if (t.type === selectedType) o.selected = true; og.appendChild(o);
      });
      sel.appendChild(og);
    });
  }
  // One-line help text for the base trigger / action (from the registry via /meta).
  function triggerDescription(type) { const t = (meta.triggers || []).find((x) => x.type === triggerBase(type)); return (t && t.description) || ""; }
  function actionDescription(type) { const a = (meta.actions || []).find((x) => x.type === type); return (a && a.description) || ""; }
  // A record-subject trigger acts on the record (e.g. a job), not a contact.
  function isRecordTrigger(tt) { return tt === "RecordUpdated" || (tt && tt.indexOf("RecordUpdated:") === 0); }
  // The condition field list depends on the subject: a record trigger offers the
  // record's own fields; otherwise contact fields. _condTrigger is set to the
  // active trigger right before the wizard / list condition rows render, so
  // fieldType/fieldLabel/condRow show the right fields. (The editor passes the
  // trigger explicitly via buildColumns(); this covers the wizard + previews.)
  let _condTrigger = null;
  function condFieldList() { return isRecordTrigger(_condTrigger) ? (meta.recordConditionFields || []) : (meta.fields || []); }
  // Which actions the builder offers for a given trigger. Record-subject
  // automations support only record-safe actions ("Create internal note" on the
  // record, "Act on linked contacts"); everything else is contact-only, and
  // "act_on_linked" never appears there. Mirrors the engine's allow-list.
  function allowedActions(triggerType) {
    const all = meta.actions || [];
    if (isRecordTrigger(triggerType)) return all.filter((a) => a.type === "create_note" || a.type === "act_on_linked" || a.type === "move_to_stage" || a.type === "set_record_field");
    return all.filter((a) => a.type !== "act_on_linked");
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

  // Two-up entry row. Only the template card is functional; the wizard slot is
  // a clearly-disabled "coming soon" placeholder (no wizard is built here).
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
    head.innerHTML = `<div class="preset-name">${esc(p.name)}</div><div class="preset-desc">${esc(p.description)}</div>`;
    card.appendChild(head);
    card.appendChild(shapeEl(p.shape));
    if (p.missing && p.missing.length) {
      card.appendChild(el("div", "preset-missing", "Expects a field: " + p.missing.map((m) => esc(m.label || m.key)).join(", ")));
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
    wrap.appendChild(el("span", "shape-chip trigger", esc((shape && shape.trigger) || "Trigger")));
    ((shape && shape.actions) || []).forEach((a) => {
      const arrow = el("span", "shape-arrow");
      arrow.innerHTML = `<svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M0 5h13M9 1l5 4-5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      wrap.appendChild(arrow);
      wrap.appendChild(el("span", "shape-chip action", esc(a)));
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
    head.innerHTML = `<div class="preset-pv-title">${esc(p.name)}</div><div class="preset-pv-desc">${esc(p.description)}</div>`;
    pbody.appendChild(head);

    pbody.appendChild(shapeEl(p.shape));

    const sm = p.summary || {};
    const conds = (sm.conditions || []).map((c) => `<li>${esc(c)}</li>`).join("") || "<li>Always runs</li>";
    const acts = (sm.actions || []).map((a) => `<li>${esc(a)}</li>`).join("") || "<li>—</li>";
    const sec = el("div", "preset-pv-section");
    sec.innerHTML = `
      <div class="pv-block"><div class="pv-k">When</div><div class="pv-v">${esc(sm.trigger || "")}</div></div>
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

    if (p.note) pbody.appendChild(hint(p.note));

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
    if (w.baseTrigger === "Stalled") return "Stalled:" + (w.stall.days || 7) + (w.stall.stageKey ? ":" + w.stall.stageKey : "");
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
      stall: { days: "", stageKey: "" },
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
        const any = el("option", null, "Any stage"); any.value = ""; ss.appendChild(any);
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
      } else if (w.baseTrigger === "Stalled") {
        extra.appendChild(small("Run when something has sat in its current stage, no movement, for at least this many days:"));
        const rowEl = el("div", "wiz-cond-row");
        const days = el("input", "input"); days.type = "number"; days.min = "1"; days.placeholder = "7"; days.style.flex = "0 0 80px"; days.value = w.stall.days || "7"; days.oninput = () => { w.stall.days = days.value; };
        const stageSel = el("select", "input"); const any = el("option", null, "Any stage"); any.value = ""; stageSel.appendChild(any);
        (meta.stages || []).forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === w.stall.stageKey) o.selected = true; stageSel.appendChild(o); });
        stageSel.onchange = () => { w.stall.stageKey = stageSel.value; };
        rowEl.appendChild(days); rowEl.appendChild(stageSel);
        extra.appendChild(rowEl);
        extra.appendChild(hint("Evaluated by the daily sweep / “Process due jobs now”. The stalled contact is the subject — moving them resets the clock."));
      }
    }
    sel.onchange = () => { w.baseTrigger = sel.value; if (w.baseTrigger !== "FieldChanged") w.triggerField = ""; if (w.baseTrigger !== "StageChanged") w.triggerStage = ""; if (w.baseTrigger !== "RecordUpdated") { w.recField = ""; w.recValue = ""; } if (w.baseTrigger !== "Stalled") { w.stall.days = ""; w.stall.stageKey = ""; } renderExtra(); };
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
  function actionSummary(a) {
    const c = a.config || {};
    if (a.type === "send_email") return "Send an email" + (c.subject ? ` (“${c.subject}”)` : "");
    if (a.type === "send_sms") return "Send an SMS";
    if (a.type === "update_field") return `Set ${fieldLabel(c.field) || "a field"}` + (c.value ? ` to “${c.value}”` : "");
    if (a.type === "add_tag") return `Add tag “${c.value || ""}”` + (c.field ? ` on ${fieldLabel(c.field)}` : "");
    if (a.type === "remove_tag") return `Remove tag “${c.value || ""}”`;
    if (a.type === "create_note") return "Add an internal note";
    if (a.type === "assign_owner") return "Assign an owner";
    if (a.type === "wait") return `Wait ${c.amount || "?"} ${c.unit || "minutes"}, then continue`;
    if (a.type === "create_record") return "Create a new record";
    if (a.type === "update_record") return "Update record(s)";
    if (a.type === "search_records") return "Find records";
    if (a.type === "delete_record") return "Delete record(s) to recycle bin";
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

    const left = el("div", "auto-card-main");
    left.innerHTML = `<div class="auto-name">${esc(a.name)}${pairTag}</div>
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
    top.appendChild(toggle);
    card.appendChild(top);

    // Half-enabled warning: durable pair only. Gentle, plain-English, and driven
    // purely by the two enabled states — never by name-matching.
    if (pairInfo && pairInfo.kind === "id" && pairInfo.partner && a.enabled && !pairInfo.partner.enabled) {
      card.appendChild(el("div", "pair-warn",
        `This is on, but its paired automation “${esc(pairInfo.partner.name)}” is turned off — contacts on that branch will get nothing. Turn both on for full coverage.`));
    }
    // Quiet note if the partner of a durable pair was deleted.
    if (pairInfo && pairInfo.orphan) {
      card.appendChild(el("div", "pair-orphan-note", "Its branch partner was deleted — this now runs on its own."));
    }

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
    }));
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
    return (row.customFields || {})[key];
  }
  function scalar(v) { return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v); }

  // ---------------- Editor: vertical workflow builder ----------------
  // Layout: [Name] then a top-to-bottom flow — TRIGGER -> CONDITIONS (optional)
  // -> ACTIONS — connected by simple connector lines. Same data, same save
  // payload, same API as before; only the presentation changed.
  function openEditor(existing, opts) {
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
    previewNode.style.cssText = "margin:12px 0 4px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);font-size:13px;line-height:1.55;";
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
        const any = el("option", null, "Any stage"); any.value = ""; stageSel.appendChild(any);
        (meta.stages || []).forEach((s) => {
          const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === triggerStage) o.selected = true; stageSel.appendChild(o);
        });
        stageSel.onchange = () => { triggerStage = stageSel.value; syncTrigger(); };
        trigExtra.appendChild(stageSel);
        if (!(meta.stages || []).length) {
          trigExtra.appendChild(small("No pipeline stages found yet. You can still choose “Any stage”."));
        }
        const note = el("div", "wf-hint", ""); note.style.margin = "6px 0 0";
        note.textContent = "Runs when a linked contact moves to a different stage on a record. The contact is the subject.";
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
        note.textContent = "This flow does not fire on its own. It runs when you open a contact and click “Run automation.”";
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
        const any = el("option", null, "Any stage"); any.value = ""; stageSel.appendChild(any);
        (meta.stages || []).forEach((s) => { const o = el("option", null, esc(s.label)); o.value = s.key; if (s.key === stall.stageKey) o.selected = true; stageSel.appendChild(o); });
        stageSel.onchange = () => { stall.stageKey = stageSel.value; syncTrigger(); };
        trigExtra.appendChild(stageSel);
        if (!(meta.stages || []).length) trigExtra.appendChild(small("No pipeline stages found yet. You can still choose “Any stage”."));
        const snote = el("div", "wf-hint", ""); snote.style.margin = "6px 0 0";
        snote.textContent = "Evaluated by the daily sweep / “Process due jobs now”, not instantly. The stalled contact is the subject — moving them resets the clock.";
        trigExtra.appendChild(snote);
      }
    }
    trig.onchange = () => { baseTrigger = trig.value; if (baseTrigger !== "FieldChanged") triggerField = ""; if (baseTrigger !== "StageChanged") triggerStage = ""; if (baseTrigger !== "RecordUpdated") { recField = ""; recValue = ""; } if (baseTrigger !== "Stalled") { stall.days = ""; stall.stageKey = ""; } syncTrigger(); renderTrigExtra(); renderConditions(); redrawActions(); renderPreview(); };
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
    opts.forEach((a) => { const o = el("option", null, esc(a.label)); o.value = a.type; if (a.type === act.type) o.selected = true; sel.appendChild(o); });
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
      const lbl = el("label", null, "Allow sending to more than 25 stalled contacts in one sweep");
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
      options.forEach((o) => { const op = el("option", null, esc(o.label)); op.value = o.value; if (c[key] === o.value) op.selected = true; s.appendChild(op); });
      s.onchange = () => { c[key] = s.value; };
      return s;
    };

    if (act.type === "send_email") {
      const tpls = (meta.templates || []).filter((t) => t.kind === "email").map((t) => ({ value: t.id, label: t.name }));
      if (tpls.length) { cfg.appendChild(small("Template (optional — fills subject/body)")); cfg.appendChild(selectOf("templateId", tpls)); }
      cfg.appendChild(small("Subject")); cfg.appendChild(text("subject", "Welcome, {{name}}!"));
      cfg.appendChild(small("Body (HTML, supports {{field}})")); cfg.appendChild(text("html", "Hi {{name}}, thanks for reaching out.", true));
      appendBulkGate();
    } else if (act.type === "send_sms") {
      const tpls = (meta.templates || []).filter((t) => t.kind === "sms").map((t) => ({ value: t.id, label: t.name }));
      if (tpls.length) { cfg.appendChild(small("Template (optional)")); cfg.appendChild(selectOf("templateId", tpls)); }
      cfg.appendChild(small("Message (supports {{field}})")); cfg.appendChild(text("body", "Hi {{name}}!", true));
      appendBulkGate();
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
      cfg.appendChild(small("Do this to each linked contact:"));
      const subSel = el("select", "input");
      [["note", "Add internal note (on each contact's timeline)"], ["email", "Send mock email to each"], ["sms", "Send mock SMS to each"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (c.subAction === v) o.selected = true; subSel.appendChild(o); });
      subSel.onchange = () => { c.subAction = subSel.value; rebuildLinked(); };
      cfg.appendChild(subSel);
      const sub = el("div"); sub.style.marginTop = "8px"; cfg.appendChild(sub);
      function rebuildLinked() {
        sub.innerHTML = "";
        if (c.subAction === "email") {
          sub.appendChild(small("Subject (supports {{name}}, {{record_title}})")); sub.appendChild(text("subject", "Update on {{record_title}}"));
          sub.appendChild(small("Body (HTML, supports {{field}})")); sub.appendChild(text("html", "Hi {{name}}, there's an update on {{record_title}}.", true));
        } else if (c.subAction === "sms") {
          sub.appendChild(small("Message (supports {{name}}, {{record_title}})")); sub.appendChild(text("body", "Hi {{name}} — update on {{record_title}}.", true));
        } else {
          sub.appendChild(small("Note (supports {{name}}, {{record_title}})")); sub.appendChild(text("text", "Update on {{record_title}} — please review.", true));
        }
        if (c.subAction === "email" || c.subAction === "sms") {
          const cbWrap = el("div"); cbWrap.style.marginTop = "8px"; cbWrap.style.display = "flex"; cbWrap.style.alignItems = "center"; cbWrap.style.gap = "7px";
          const cb = el("input"); cb.type = "checkbox"; cb.checked = !!c.allowBulk; cb.onchange = () => { c.allowBulk = cb.checked; };
          const lbl = el("label", null, "Allow sending to more than 25 linked contacts in one run");
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
      const lbl = el("label", null, "Allow moving more than 25 contacts in one run"); lbl.style.fontSize = "12.5px"; lbl.style.color = "var(--ink-soft)"; lbl.style.cursor = "pointer"; lbl.onclick = () => { cb.checked = !cb.checked; c.allowBulk = cb.checked; };
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
      cfg.appendChild(small("New record's field values (must include at least an email or phone, per this CRM's rules; required fields apply):"));
      cfg.appendChild(valueRowsEditor(c));
    } else if (act.type === "update_record") {
      cfg.appendChild(small("Which records to update?"));
      cfg.appendChild(targetSelect(c));
      cfg.appendChild(small("Set these fields (supports {{field}}):"));
      cfg.appendChild(valueRowsEditor(c));
    } else if (act.type === "search_records") {
      cfg.appendChild(small("Find contacts where… (leave empty to match all active contacts). A later Update/Delete action set to “Records found by a Find action” will act on these."));
      if (!Array.isArray(c.conditions)) c.conditions = [];
      const w = el("div", "cond-wrap");
      w.appendChild(App.table.ruleEditor(buildColumns(), contacts, c.conditions, () => {}));
      cfg.appendChild(w);
    } else if (act.type === "delete_record") {
      cfg.appendChild(small("Which records to delete? Deleted records go to the Recycle Bin and can be restored."));
      cfg.appendChild(targetSelect(c));
      const cbWrap = el("div"); cbWrap.style.marginTop = "8px"; cbWrap.style.display = "flex"; cbWrap.style.alignItems = "center"; cbWrap.style.gap = "7px";
      const cb = el("input"); cb.type = "checkbox"; cb.checked = !!c.allowBulk; cb.onchange = () => { c.allowBulk = cb.checked; };
      const lbl = el("label", null, "Allow deleting more than 10 records in one run");
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
  function targetSelect(c) {
    if (!c.target) c.target = "trigger";
    const s = el("select", "input");
    [["trigger", "This record (the trigger)"], ["search", "Records found by a Find action above"]].forEach(([v, l]) => {
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

  // ---------------- Scheduled tab ----------------
  async function renderScheduled(body) {
    body.innerHTML = `<div class="cell-muted" style="padding:24px">Loading…</div>`;
    let jobs;
    try { jobs = await App.portalApi("/api/automations/jobs"); }
    catch (e) { body.innerHTML = `<div class="cell-muted" style="padding:24px">${esc(e.message)}</div>`; return; }
    body.innerHTML = "";

    // Super-admin-only manual processor (stand-in for the deployed host heartbeat).
    const isSuper = App.state && App.state.me && App.state.me.role === "SUPER_ADMIN";
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
        if (!confirm("Cancel this scheduled job?")) return;
        try { await App.portalApi(`/api/automations/jobs/${j.id}/cancel`, { method: "POST" }); toast("Canceled"); renderScheduled(body); }
        catch (e) { toast(e.message, true); }
      };
      row.appendChild(cancel);
    }
    return row;
  }

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
