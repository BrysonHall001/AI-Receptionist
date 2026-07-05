// Drips builder — SLICE 1: a drag-and-drop canvas. A left palette of node types you drop onto a
// canvas and position freely; each node is configurable; the whole graph saves to /api/drips and
// reopens exactly. NO drawn connectors, NO compile-to-automation yet (later slices).
(function (global) {
  const App = global.App || (global.App = {});

  // Node types shown in the palette, grouped. `meta` drives the node card + which config panel
  // opens. Keys line up with the automation actions a later slice will compile to.
  const NODE_META = {
    enroll_audience:  { label: "Enroll audience",     group: "Triggers", accent: "#7c3aed", icon: "\u{1F465}", hint: "Start people from an audience" },
    enroll_condition: { label: "Enroll on condition", group: "Triggers", accent: "#7c3aed", icon: "\u{1F50E}", hint: "Start people who match a filter" },
    wait:             { label: "Wait",                group: "Actions",  accent: "#0891b2", icon: "\u{23F1}",  hint: "Pause before the next step" },
    send_email:       { label: "Send email",          group: "Actions",  accent: "#2563eb", icon: "\u2709",     hint: "Email the contact" },
    send_survey:      { label: "Send survey",         group: "Actions",  accent: "#16a34a", icon: "\u{1F4CB}", hint: "Send a survey (personal link)" },
    enroll:           { label: "Enroll",              group: "Actions",  accent: "#d97706", icon: "\u2795",     hint: "Add to an audience/flow" },
    unenroll:         { label: "Unenroll",            group: "Actions",  accent: "#dc2626", icon: "\u{1F6AA}", hint: "Stop people who match a filter" },
  };
  const PALETTE_GROUPS = [
    { group: "Triggers", types: ["enroll_audience", "enroll_condition"] },
    { group: "Actions", types: ["wait", "send_email", "send_survey", "enroll", "unenroll"] },
  ];
  let nodeSeq = 1;
  const newNodeId = () => "n" + Date.now().toString(36) + (nodeSeq++);

  // ------------------------------------------------------------------ Library
  async function renderLibrary(host) {
    const { el, esc, toast } = App.util;
    host.innerHTML = `<div class="cell-muted" style="padding:8px">Loading…</div>`;
    let drips = [];
    try { drips = await App.portalApi("/api/drips"); } catch (e) { host.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; return; }
    drips = Array.isArray(drips) ? drips : [];
    host.innerHTML = "";
    const head = el("div"); head.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px";
    const hl = el("div");
    hl.appendChild(el("h3", "settings-sub", "Drips"));
    hl.appendChild(el("div", "cell-muted", "Visual drip campaigns — drop steps on a canvas and position them. Connectors and running come in the next updates.")).style.cssText = "font-size:12.5px;margin-top:2px";
    const newBtn = el("button", "btn btn-primary btn-sm", "+ New drip");
    newBtn.onclick = async () => {
      const name = await App.ui.promptModal({ title: "New drip", label: "Drip name", placeholder: "e.g. New-lead nurture", okText: "Create" });
      if (!name || !name.trim()) return;
      try { const d = await App.portalApi("/api/drips", { method: "POST", body: JSON.stringify({ name: name.trim(), graph: { nodes: [] } }) }); openEditor(host, d); }
      catch (e) { toast(e.message, true); }
    };
    head.appendChild(hl); head.appendChild(newBtn);
    host.appendChild(head);

    if (!drips.length) { host.appendChild(el("div", "card cell-muted", "No drips yet. Create one to start building.")); return; }
    const list = el("div"); list.style.cssText = "display:flex;flex-direction:column;gap:8px";
    drips.forEach((d) => {
      const nodeCount = (d.graph && Array.isArray(d.graph.nodes)) ? d.graph.nodes.length : 0;
      const row = el("div", "card"); row.style.cssText = "padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap";
      const left = el("div");
      left.innerHTML = `<div style="font-weight:600">${esc(d.name)}</div><div class="cell-muted" style="font-size:12.5px">${nodeCount} step${nodeCount === 1 ? "" : "s"} · updated ${App.util.fmtDate ? App.util.fmtDate(d.updatedAt) : ""}</div>`;
      const btns = el("div"); btns.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
      const open = el("button", "btn btn-primary btn-sm", "Open");
      open.onclick = async () => { try { const full = await App.portalApi("/api/drips/" + d.id); openEditor(host, full); } catch (e) { toast(e.message, true); } };
      const ren = el("button", "btn btn-ghost btn-sm", "Rename");
      ren.onclick = async () => { const name = await App.ui.promptModal({ title: "Rename drip", label: "Drip name", value: d.name, okText: "Rename" }); if (!name || !name.trim()) return; try { await App.portalApi("/api/drips/" + d.id, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) }); toast("Renamed"); renderLibrary(host); } catch (e) { toast(e.message, true); } };
      const del = el("button", "btn btn-ghost btn-sm", "Delete"); del.style.color = "#dc2626";
      del.onclick = async () => { if (!(await App.ui.confirmModal({ title: "Delete drip", message: `Delete the drip \u201c${d.name}\u201d? This can't be undone.`, confirmText: "Delete" }))) return; try { await App.portalApi("/api/drips/" + d.id, { method: "DELETE" }); toast("Deleted"); renderLibrary(host); } catch (e) { toast(e.message, true); } };
      btns.appendChild(open); btns.appendChild(ren); btns.appendChild(del);
      row.appendChild(left); row.appendChild(btns);
      list.appendChild(row);
    });
    host.appendChild(list);
  }

  // ------------------------------------------------------------------ Editor
  function openEditor(host, drip) {
    const { el, esc, toast } = App.util;
    host.innerHTML = "";
    // Working copy of the graph. Nodes: { id, type, x, y, config }.
    const state = {
      nodes: ((drip.graph && Array.isArray(drip.graph.nodes)) ? drip.graph.nodes : []).map((n) => ({ id: n.id, type: n.type, x: Number(n.x) || 0, y: Number(n.y) || 0, config: n.config || {} })),
      selectedId: null,
      flush: null, // set by the open config panel to write its edits back into the node
      dirty: false,
    };

    // Top bar: back + name + save
    const bar = el("div"); bar.style.cssText = "display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px";
    const back = el("button", "btn btn-ghost btn-sm", "\u2190 Drips"); back.onclick = () => renderLibrary(host);
    const title = el("div", "settings-sub"); title.style.cssText = "font-weight:700;font-size:16px;flex:1"; title.textContent = drip.name;
    const status = el("span", "cell-muted"); status.style.cssText = "font-size:12.5px";
    const saveBtn = el("button", "btn btn-primary btn-sm", "Save drip");
    bar.appendChild(back); bar.appendChild(title); bar.appendChild(status); bar.appendChild(saveBtn);
    host.appendChild(bar);

    // Layout: palette | canvas | config
    const layout = el("div", "drip-layout"); layout.style.cssText = "display:flex;gap:12px;align-items:stretch;min-height:520px";
    const palette = el("div", "drip-palette"); palette.style.cssText = "flex:0 0 190px;display:flex;flex-direction:column;gap:12px;overflow:auto;max-height:640px";
    const canvasWrap = el("div"); canvasWrap.style.cssText = "flex:1 1 auto;min-width:320px;position:relative";
    const canvas = el("div", "drip-canvas"); canvas.style.cssText = "position:relative;width:100%;height:640px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:10px;background:linear-gradient(0deg,transparent 23px,rgba(0,0,0,.035) 24px),linear-gradient(90deg,transparent 23px,rgba(0,0,0,.035) 24px);background-size:24px 24px";
    canvas.setAttribute("data-drip-canvas", "1");
    const surface = el("div", "drip-surface"); surface.style.cssText = "position:relative;width:1600px;height:1200px";
    canvas.appendChild(surface);
    canvasWrap.appendChild(canvas);
    const configPanel = el("div", "drip-config"); configPanel.style.cssText = "flex:0 0 320px;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:14px;overflow:auto;max-height:640px;background:var(--panel,#fff)";
    layout.appendChild(palette); layout.appendChild(canvasWrap); layout.appendChild(configPanel);
    host.appendChild(layout);

    // ---- Palette (draggable items) ----
    PALETTE_GROUPS.forEach((grp) => {
      const box = el("div");
      box.appendChild(el("div", "cell-muted", grp.group)).style.cssText = "font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin:0 0 4px";
      grp.types.forEach((type) => {
        const m = NODE_META[type];
        const item = el("div", "drip-pal-item");
        item.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line,#e5e7eb);border-left:4px solid " + m.accent + ";border-radius:8px;cursor:grab;margin-bottom:6px;background:var(--panel,#fff);font-size:13px";
        item.setAttribute("draggable", "true");
        item.dataset.type = type;
        item.innerHTML = `<span style="font-size:15px">${m.icon}</span><span>${esc(m.label)}</span>`;
        item.addEventListener("dragstart", (e) => { try { e.dataTransfer.setData("text/drip-node", type); e.dataTransfer.effectAllowed = "copy"; } catch (er) {} });
        box.appendChild(item);
      });
      palette.appendChild(box);
    });

    // ---- Canvas drop (palette -> new node at drop position) ----
    canvas.addEventListener("dragover", (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = "copy"; } catch (er) {} });
    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      const type = (() => { try { return e.dataTransfer.getData("text/drip-node"); } catch (er) { return ""; } })();
      if (!type || !NODE_META[type]) return;
      const pos = canvasPoint(e.clientX, e.clientY);
      addNode(type, pos.x, pos.y);
    });

    function canvasPoint(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const x = Math.max(0, clientX - r.left + canvas.scrollLeft - 70); // center the card under the cursor
      const y = Math.max(0, clientY - r.top + canvas.scrollTop - 24);
      return { x: Math.round(x), y: Math.round(y) };
    }

    function addNode(type, x, y) {
      const node = { id: newNodeId(), type, x: Math.max(0, x), y: Math.max(0, y), config: defaultConfig(type) };
      state.nodes.push(node);
      renderNode(node);
      selectNode(node.id);
      markDirty();
    }

    function markDirty() { state.dirty = true; status.textContent = "Unsaved changes"; }

    // ---- Render a node card ----
    function renderNode(node) {
      const m = NODE_META[node.type] || { label: node.type, accent: "#64748b", icon: "\u25A0" };
      let card = surface.querySelector(`[data-node-id="${node.id}"]`);
      if (!card) { card = el("div", "drip-node"); card.dataset.nodeId = node.id; surface.appendChild(card); }
      card.style.cssText = "position:absolute;left:" + node.x + "px;top:" + node.y + "px;width:150px;background:var(--panel,#fff);border:1px solid var(--line,#e5e7eb);border-left:4px solid " + m.accent + ";border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:10px 12px;cursor:grab;user-select:none" + (state.selectedId === node.id ? ";outline:2px solid " + m.accent + ";outline-offset:1px" : "");
      card.innerHTML = `<div style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600"><span>${m.icon}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.label)}</span></div><div class="cell-muted drip-node-sub" style="font-size:11px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nodeSummary(node))}</div>`;
      attachNodeDrag(card, node);
    }
    function refreshNodeSummary(node) { const card = surface.querySelector(`[data-node-id="${node.id}"] .drip-node-sub`); if (card) card.textContent = nodeSummary(node); }

    // ---- Drag a node to reposition (mouse) ----
    function attachNodeDrag(card, node) {
      card.onmousedown = (e) => {
        if (e.button !== 0) return;
        if (e.target.closest && e.target.closest(".drip-node-del")) return;
        e.preventDefault();
        selectNode(node.id);
        const startX = e.clientX, startY = e.clientY, ox = node.x, oy = node.y;
        let moved = false;
        const move = (ev) => {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
          node.x = Math.max(0, Math.round(ox + dx)); node.y = Math.max(0, Math.round(oy + dy));
          card.style.left = node.x + "px"; card.style.top = node.y + "px";
        };
        const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); if (moved) markDirty(); };
        document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
      };
      // expose for tests: programmatic move
      card._moveTo = (x, y) => { node.x = Math.max(0, Math.round(x)); node.y = Math.max(0, Math.round(y)); card.style.left = node.x + "px"; card.style.top = node.y + "px"; markDirty(); };
    }

    function selectNode(id) {
      if (state.flush) { try { state.flush(); } catch (e) {} state.flush = null; }
      state.selectedId = id;
      state.nodes.forEach((n) => renderNode(n)); // re-render to update selection outline
      renderConfig();
    }
    function deselect() { if (state.flush) { try { state.flush(); } catch (e) {} state.flush = null; } state.selectedId = null; renderConfig(); state.nodes.forEach((n) => renderNode(n)); }

    canvas.addEventListener("mousedown", (e) => { if (e.target === canvas || e.target === surface) deselect(); });

    // ---- Config panel per node type ----
    function renderConfig() {
      configPanel.innerHTML = "";
      const node = state.nodes.find((n) => n.id === state.selectedId);
      if (!node) { configPanel.appendChild(el("div", "cell-muted", "Select a step to configure it, or drag a new one from the palette.")); return; }
      const m = NODE_META[node.type];
      const head = el("div"); head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px";
      head.innerHTML = `<div style="font-weight:700;font-size:14px">${m.icon} ${esc(m.label)}</div>`;
      const delBtn = el("button", "btn btn-ghost btn-sm drip-node-del", "Delete"); delBtn.style.color = "#dc2626";
      delBtn.onclick = () => { state.flush = null; state.nodes = state.nodes.filter((n) => n.id !== node.id); const card = surface.querySelector(`[data-node-id="${node.id}"]`); if (card) card.remove(); state.selectedId = null; renderConfig(); markDirty(); };
      head.appendChild(delBtn);
      configPanel.appendChild(head);
      const body = el("div"); configPanel.appendChild(body);
      buildConfig(node, body);
    }

    function buildConfig(node, body) {
      const cfg = node.config || (node.config = {});
      const done = () => { refreshNodeSummary(node); };
      if (node.type === "wait") return cfgWait(node, body, done);
      if (node.type === "enroll_audience" || node.type === "enroll") return cfgAudience(node, body, done);
      if (node.type === "enroll_condition" || node.type === "unenroll") return cfgCondition(node, body, done);
      if (node.type === "send_email") return cfgEmail(node, body, done);
      if (node.type === "send_survey") return cfgSurvey(node, body, done);
      body.appendChild(el("div", "cell-muted", "No settings."));
    }

    // wait: amount + unit (mirrors automation wait config)
    function cfgWait(node, body, done) {
      const cfg = node.config;
      const row = el("div"); row.style.cssText = "display:flex;gap:8px;align-items:flex-end";
      const amtWrap = el("label", "field"); amtWrap.style.flex = "1"; amtWrap.innerHTML = `<span class="field-label">Wait</span>`;
      const amt = el("input", "input"); amt.type = "number"; amt.min = "0"; amt.value = cfg.amount != null ? cfg.amount : 1; amtWrap.appendChild(amt);
      const unitWrap = el("label", "field"); unitWrap.style.flex = "1"; unitWrap.innerHTML = `<span class="field-label">Unit</span>`;
      const unit = el("select", "input"); ["minutes", "hours", "days"].forEach((u) => { const o = el("option"); o.value = u; o.textContent = u; if ((cfg.unit || "days") === u) o.selected = true; unit.appendChild(o); }); unitWrap.appendChild(unit);
      row.appendChild(amtWrap); row.appendChild(unitWrap); body.appendChild(row);
      const flush = () => { node.config = { amount: Number(amt.value) || 0, unit: unit.value }; done(); };
      amt.oninput = flush; unit.onchange = flush;
      state.flush = flush;
    }

    // enroll audience / enroll: reuse the shared audience picker
    function cfgAudience(node, body, done) {
      const cfg = node.config;
      body.appendChild(el("div", "field-label", "Audience"));
      const host2 = el("div"); body.appendChild(host2);
      const picker = App.audienceSelect.mount(host2, { emailableOnly: false, selectedIds: Array.isArray(cfg.audienceIds) ? cfg.audienceIds : [], onChange: () => { node.config = { audienceIds: picker.getSelectedIds() }; done(); } });
      state.flush = () => { node.config = { audienceIds: picker.getSelectedIds() }; done(); };
    }

    // enroll_condition / unenroll: reuse App.table.ruleEditor
    async function cfgCondition(node, body, done) {
      const cfg = node.config;
      body.appendChild(el("div", "field-label", node.type === "unenroll" ? "Unenroll people who match" : "Enroll people who match"));
      const holder = el("div"); body.appendChild(holder);
      holder.appendChild(el("div", "cell-muted", "Loading…"));
      let contacts = [], fields = [];
      try { [contacts, fields] = await Promise.all([App.portalApi("/api/contacts").catch(() => []), App.portalApi("/api/fields").catch(() => [])]); } catch (e) {}
      const columns = App.portal.contactColumnDefs(fields || []);
      const rules = Array.isArray(cfg.rules) ? cfg.rules.map((r) => ({ ...r })) : [];
      holder.innerHTML = "";
      holder.appendChild(App.table.ruleEditor(columns, contacts, rules, () => { node.config = { rules }; done(); }));
      state.flush = () => { node.config = { rules }; done(); };
    }

    // send_email: from scratch (compose editor) OR pick an Email Template
    function cfgEmail(node, body, done) {
      const cfg = node.config;
      const mode = el("select", "input"); ["scratch", "template"].forEach((mv) => { const o = el("option"); o.value = mv; o.textContent = mv === "scratch" ? "Create from scratch" : "Use an email template"; if ((cfg.mode || "scratch") === mv) o.selected = true; mode.appendChild(o); });
      body.appendChild(el("div", "field-label", "Email")); body.appendChild(mode);
      const area = el("div"); area.style.marginTop = "10px"; body.appendChild(area);
      let composer = null, tmplSel = null;
      function paint() {
        area.innerHTML = ""; composer = null; tmplSel = null;
        if (mode.value === "template") {
          tmplSel = el("select", "input"); tmplSel.innerHTML = `<option value="">— pick a template —</option>`;
          App.portalApi("/api/templates?kind=email").then((rows) => { (rows || []).forEach((t) => { const o = el("option"); o.value = t.id; o.textContent = t.name; if (t.id === cfg.templateId) o.selected = true; tmplSel.appendChild(o); }); }).catch(() => {});
          tmplSel.onchange = () => { node.config = { mode: "template", templateId: tmplSel.value }; done(); };
          area.appendChild(el("div", "field-label", "Template")); area.appendChild(tmplSel);
        } else {
          const subj = el("input", "input"); subj.placeholder = "Subject"; subj.value = cfg.subject || "";
          area.appendChild(el("div", "field-label", "Subject")); area.appendChild(subj);
          const cHost = el("div"); cHost.style.marginTop = "8px"; area.appendChild(cHost);
          try {
            composer = App.compose.mount(cHost, { kind: "email" });
            if (cfg.html && composer.setHTML) composer.setHTML(cfg.html);
          } catch (e) { const ta = el("textarea", "input"); ta.rows = 6; ta.value = cfg.html || ""; ta.placeholder = "Email body (HTML)"; cHost.appendChild(ta); composer = { getHTML: () => ta.value, getSubject: () => subj.value }; }
          node._readEmail = () => ({ subject: subj.value, html: composer && composer.getHTML ? composer.getHTML() : (cfg.html || "") });
        }
      }
      mode.onchange = () => { paint(); node.config = { mode: mode.value }; done(); };
      paint();
      state.flush = () => {
        if (mode.value === "template") node.config = { mode: "template", templateId: tmplSel ? tmplSel.value : (cfg.templateId || "") };
        else { const r = node._readEmail ? node._readEmail() : { subject: cfg.subject || "", html: cfg.html || "" }; node.config = { mode: "scratch", subject: r.subject, html: r.html }; }
        done();
      };
    }

    // send_survey: pick an existing survey OR compose the invite from scratch
    function cfgSurvey(node, body, done) {
      const cfg = node.config;
      const mode = el("select", "input"); ["existing", "scratch"].forEach((mv) => { const o = el("option"); o.value = mv; o.textContent = mv === "existing" ? "Use an existing survey" : "Compose invite from scratch"; if ((cfg.mode || "existing") === mv) o.selected = true; mode.appendChild(o); });
      body.appendChild(el("div", "field-label", "Survey")); body.appendChild(mode);
      const area = el("div"); area.style.marginTop = "10px"; body.appendChild(area);
      let surveySel = null, composer = null, subj = null;
      function paint() {
        area.innerHTML = ""; surveySel = null; composer = null; subj = null;
        surveySel = el("select", "input"); surveySel.innerHTML = `<option value="">— pick a survey —</option>`;
        App.portalApi("/api/surveys").then((rows) => { (rows || []).forEach((s) => { const o = el("option"); o.value = s.id; o.textContent = s.name; if (s.id === cfg.surveyId) o.selected = true; surveySel.appendChild(o); }); }).catch(() => {});
        surveySel.onchange = () => done();
        area.appendChild(el("div", "field-label", mode.value === "existing" ? "Which survey" : "Attach to survey")); area.appendChild(surveySel);
        subj = el("input", "input"); subj.placeholder = "Email subject"; subj.value = cfg.subject || ""; area.appendChild(el("div", "field-label", "Invite subject")); area.appendChild(subj);
        const cHost = el("div"); cHost.style.marginTop = "8px"; area.appendChild(cHost);
        try { composer = App.compose.mount(cHost, { kind: "email", surveyLinkMode: "token" }); if (cfg.html && composer.setHTML) composer.setHTML(cfg.html); }
        catch (e) { const ta = el("textarea", "input"); ta.rows = 5; ta.value = cfg.html || ""; ta.placeholder = "Invite body — include {{survey_link}}"; cHost.appendChild(ta); composer = { getHTML: () => ta.value }; }
      }
      mode.onchange = () => { const keep = surveySel ? surveySel.value : cfg.surveyId; paint(); if (keep && surveySel) surveySel.value = keep; done(); };
      paint();
      state.flush = () => {
        node.config = { mode: mode.value, surveyId: surveySel ? surveySel.value : (cfg.surveyId || ""), subject: subj ? subj.value : (cfg.subject || ""), html: composer && composer.getHTML ? composer.getHTML() : (cfg.html || "") };
        done();
      };
    }

    // ---- Save ----
    saveBtn.onclick = async () => {
      if (state.flush) { try { state.flush(); } catch (e) {} }
      saveBtn.disabled = true; status.textContent = "Saving…";
      try {
        const graph = { nodes: state.nodes.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, config: n.config || {} })) };
        const updated = await App.portalApi("/api/drips/" + drip.id, { method: "PATCH", body: JSON.stringify({ graph }) });
        drip.graph = updated.graph; state.dirty = false;
        status.textContent = "Saved."; toast("Drip saved");
        setTimeout(() => { if (status.textContent === "Saved.") status.textContent = ""; }, 2500);
      } catch (e) { status.textContent = ""; toast(e.message, true); }
      finally { saveBtn.disabled = false; }
    };

    // Initial paint of existing nodes + empty config.
    state.nodes.forEach((n) => renderNode(n));
    renderConfig();

    // Expose a tiny test hook (no effect on UX) so headless checks can drive the canvas.
    canvas.__dripTest = { addNode, state, moveNode: (id, x, y) => { const c = surface.querySelector(`[data-node-id="${id}"]`); if (c && c._moveTo) c._moveTo(x, y); }, selectNode, save: () => saveBtn.onclick() };
  }

  function defaultConfig(type) {
    if (type === "wait") return { amount: 1, unit: "days" };
    if (type === "enroll_audience" || type === "enroll") return { audienceIds: [] };
    if (type === "enroll_condition" || type === "unenroll") return { rules: [] };
    if (type === "send_email") return { mode: "scratch", subject: "", html: "" };
    if (type === "send_survey") return { mode: "existing", surveyId: "", subject: "", html: "" };
    return {};
  }

  function nodeSummary(node) {
    const c = node.config || {};
    switch (node.type) {
      case "wait": return `${c.amount != null ? c.amount : 1} ${c.unit || "days"}`;
      case "enroll_audience": case "enroll": return (c.audienceIds && c.audienceIds.length) ? `${c.audienceIds.length} audience${c.audienceIds.length === 1 ? "" : "s"}` : "no audience yet";
      case "enroll_condition": case "unenroll": return (c.rules && c.rules.length) ? `${c.rules.length} rule${c.rules.length === 1 ? "" : "s"}` : "no rules yet";
      case "send_email": return c.mode === "template" ? (c.templateId ? "template" : "pick a template") : (c.subject ? c.subject : "from scratch");
      case "send_survey": return c.surveyId ? "survey chosen" : (c.mode === "scratch" ? "compose invite" : "pick a survey");
      default: return "";
    }
  }

  App.drips = { renderLibrary, openEditor, NODE_META, _defaultConfig: defaultConfig, _nodeSummary: nodeSummary };
})(window);
