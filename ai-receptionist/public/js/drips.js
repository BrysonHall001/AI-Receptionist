// Drips builder — SLICE 2: connectors + compile-to-automation + activate. Nodes are dropped and
// positioned (slice 1); now you draw LINEAR connectors (one outgoing per node), the drip compiles
// into a real Automation on activate, and runs through the existing engine. Branching is next.
(function (global) {
  const App = global.App || (global.App = {});
  const SVGNS = "http://www.w3.org/2000/svg";
  const NODE_W = 154, NODE_H = 56;

  const NODE_META = {
    enroll_audience:  { label: "Enroll audience",     group: "Triggers", accent: "#7c3aed", icon: "\u{1F465}", trigger: true },
    enroll_condition: { label: "Enroll on condition", group: "Triggers", accent: "#7c3aed", icon: "\u{1F50E}", trigger: true },
    wait:             { label: "Wait",                group: "Actions",  accent: "#0891b2", icon: "\u{23F1}" },
    send_email:       { label: "Send email",          group: "Actions",  accent: "#2563eb", icon: "\u2709" },
    send_survey:      { label: "Send survey",         group: "Actions",  accent: "#16a34a", icon: "\u{1F4CB}" },
    enroll:           { label: "Enroll",              group: "Actions",  accent: "#d97706", icon: "\u2795" },
    unenroll:         { label: "Unenroll",            group: "Actions",  accent: "#dc2626", icon: "\u{1F6AA}" },
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
    hl.appendChild(el("div", "cell-muted", "Visual drip campaigns — wire steps together and turn them on to run through your automations.")).style.cssText = "font-size:12.5px;margin-top:2px";
    const newBtn = el("button", "btn btn-primary btn-sm", "+ New drip");
    newBtn.onclick = async () => {
      const name = await App.ui.promptModal({ title: "New drip", label: "Drip name", placeholder: "e.g. New-lead nurture", okText: "Create" });
      if (!name || !name.trim()) return;
      try { const d = await App.portalApi("/api/drips", { method: "POST", body: JSON.stringify({ name: name.trim(), graph: { nodes: [], edges: [] } }) }); openEditor(host, d); }
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
      const pill = d.enabled
        ? `<span style="display:inline-block;font-size:11px;font-weight:700;color:#166534;background:#dcfce7;border-radius:999px;padding:1px 8px;margin-left:8px">On</span>`
        : `<span style="display:inline-block;font-size:11px;font-weight:700;color:#6b7280;background:#f1f5f9;border-radius:999px;padding:1px 8px;margin-left:8px">Off</span>`;
      left.innerHTML = `<div style="font-weight:600">${esc(d.name)}${pill}</div><div class="cell-muted" style="font-size:12.5px">${nodeCount} step${nodeCount === 1 ? "" : "s"} · updated ${App.util.fmtDate ? App.util.fmtDate(d.updatedAt) : ""}</div>`;
      const btns = el("div"); btns.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
      const open = el("button", "btn btn-primary btn-sm", "Open");
      open.onclick = async () => { try { const full = await App.portalApi("/api/drips/" + d.id); openEditor(host, full); } catch (e) { toast(e.message, true); } };
      const ren = el("button", "btn btn-ghost btn-sm", "Rename");
      ren.onclick = async () => { const name = await App.ui.promptModal({ title: "Rename drip", label: "Drip name", value: d.name, okText: "Rename" }); if (!name || !name.trim()) return; try { await App.portalApi("/api/drips/" + d.id, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) }); toast("Renamed"); renderLibrary(host); } catch (e) { toast(e.message, true); } };
      const del = el("button", "btn btn-ghost btn-sm", "Delete"); del.style.color = "#dc2626";
      del.onclick = async () => { if (!(await App.ui.confirmModal({ title: "Delete drip", message: `Delete the drip \u201c${d.name}\u201d? Its automation will be removed too.`, confirmText: "Delete" }))) return; try { await App.portalApi("/api/drips/" + d.id, { method: "DELETE" }); toast("Deleted"); renderLibrary(host); } catch (e) { toast(e.message, true); } };
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
    const g = drip.graph || {};
    const state = {
      nodes: ((g && Array.isArray(g.nodes)) ? g.nodes : []).map((n) => ({ id: n.id, type: n.type, x: Number(n.x) || 0, y: Number(n.y) || 0, config: n.config || {} })),
      edges: ((g && Array.isArray(g.edges)) ? g.edges : []).map((e) => ({ source: e.source, target: e.target })),
      selectedId: null,
      flush: null,
      enabled: !!drip.enabled,
      errorsByNode: {},
    };

    // Top bar
    const bar = el("div"); bar.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px";
    const back = el("button", "btn btn-ghost btn-sm", "\u2190 Drips"); back.onclick = () => renderLibrary(host);
    const title = el("div", "settings-sub"); title.style.cssText = "font-weight:700;font-size:16px;flex:1"; title.textContent = drip.name;
    const statusPill = el("span"); statusPill.style.cssText = "font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px";
    const note = el("span", "cell-muted"); note.style.cssText = "font-size:12.5px";
    const saveBtn = el("button", "btn btn-ghost btn-sm", "Save");
    const toggleBtn = el("button", "btn btn-primary btn-sm", "Turn on");
    bar.appendChild(back); bar.appendChild(title); bar.appendChild(statusPill); bar.appendChild(note); bar.appendChild(saveBtn); bar.appendChild(toggleBtn);
    host.appendChild(bar);

    // Error banner (validation)
    const banner = el("div"); banner.style.cssText = "display:none;border:1px solid #fca5a5;background:#fef2f2;color:#991b1b;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:13px"; host.appendChild(banner);

    // Layout: palette | canvas | config
    const layout = el("div", "drip-layout"); layout.style.cssText = "display:flex;gap:12px;align-items:stretch;min-height:520px";
    const palette = el("div", "drip-palette"); palette.style.cssText = "flex:0 0 190px;display:flex;flex-direction:column;gap:12px;overflow:auto;max-height:660px";
    const canvasWrap = el("div"); canvasWrap.style.cssText = "flex:1 1 auto;min-width:320px;position:relative";
    const canvas = el("div", "drip-canvas"); canvas.style.cssText = "position:relative;width:100%;height:660px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:10px;background:linear-gradient(0deg,transparent 23px,rgba(0,0,0,.035) 24px),linear-gradient(90deg,transparent 23px,rgba(0,0,0,.035) 24px);background-size:24px 24px";
    canvas.setAttribute("data-drip-canvas", "1");
    const surface = el("div", "drip-surface"); surface.style.cssText = "position:relative;width:1600px;height:1200px";
    const svg = document.createElementNS(SVGNS, "svg"); svg.setAttribute("width", "1600"); svg.setAttribute("height", "1200"); svg.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;overflow:visible";
    surface.appendChild(svg);
    canvas.appendChild(surface); canvasWrap.appendChild(canvas);
    const configPanel = el("div", "drip-config"); configPanel.style.cssText = "flex:0 0 320px;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:14px;overflow:auto;max-height:660px;background:var(--panel,#fff)";
    layout.appendChild(palette); layout.appendChild(canvasWrap); layout.appendChild(configPanel);
    host.appendChild(layout);

    // ---- Palette ----
    PALETTE_GROUPS.forEach((grp) => {
      const box = el("div");
      box.appendChild(el("div", "cell-muted", grp.group)).style.cssText = "font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin:0 0 4px";
      grp.types.forEach((type) => {
        const m = NODE_META[type];
        const item = el("div", "drip-pal-item");
        item.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line,#e5e7eb);border-left:4px solid " + m.accent + ";border-radius:8px;cursor:grab;margin-bottom:6px;background:var(--panel,#fff);font-size:13px";
        item.setAttribute("draggable", "true"); item.dataset.type = type;
        item.innerHTML = `<span style="font-size:15px">${m.icon}</span><span>${esc(m.label)}</span>`;
        item.addEventListener("dragstart", (e) => { try { e.dataTransfer.setData("text/drip-node", type); e.dataTransfer.effectAllowed = "copy"; } catch (er) {} });
        box.appendChild(item);
      });
      palette.appendChild(box);
    });

    // ---- Drop to create ----
    canvas.addEventListener("dragover", (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = "copy"; } catch (er) {} });
    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      const type = (() => { try { return e.dataTransfer.getData("text/drip-node"); } catch (er) { return ""; } })();
      if (!type || !NODE_META[type]) return;
      const pos = canvasPoint(e.clientX, e.clientY); addNode(type, pos.x, pos.y);
    });
    function canvasPoint(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      return { x: Math.max(0, Math.round(clientX - r.left + canvas.scrollLeft - NODE_W / 2)), y: Math.max(0, Math.round(clientY - r.top + canvas.scrollTop - NODE_H / 2)) };
    }

    function addNode(type, x, y) {
      const node = { id: newNodeId(), type, x: Math.max(0, x), y: Math.max(0, y), config: defaultConfig(type) };
      state.nodes.push(node); renderNode(node); selectNode(node.id); markDirty();
      return node;
    }

    function markDirty() { note.textContent = "Unsaved changes"; }
    function markClean(txt) { note.textContent = txt || ""; }

    function paintStatus() {
      if (state.enabled) { statusPill.textContent = "On"; statusPill.style.cssText = "font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;color:#166534;background:#dcfce7"; toggleBtn.textContent = "Turn off"; }
      else { statusPill.textContent = "Off"; statusPill.style.cssText = "font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;color:#6b7280;background:#f1f5f9"; toggleBtn.textContent = "Turn on"; }
    }

    // ---- Anchors + edges ----
    function outAnchor(n) { return { x: n.x + NODE_W, y: n.y + NODE_H / 2 }; }
    function inAnchor(n) { return { x: n.x, y: n.y + NODE_H / 2 }; }
    function edgePath(a, b) { const dx = Math.max(40, Math.abs(b.x - a.x) / 2); return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`; }

    function renderEdges() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      state.edges.forEach((e, idx) => {
        const s = state.nodes.find((n) => n.id === e.source), t = state.nodes.find((n) => n.id === e.target);
        if (!s || !t) return;
        const a = outAnchor(s), b = inAnchor(t);
        const path = document.createElementNS(SVGNS, "path");
        path.setAttribute("d", edgePath(a, b));
        path.setAttribute("fill", "none"); path.setAttribute("stroke", "#f97316"); path.setAttribute("stroke-width", "2.5");
        path.setAttribute("data-edge", e.source + ">" + e.target); path.style.pointerEvents = "stroke"; path.style.cursor = "pointer";
        svg.appendChild(path);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const del = document.createElementNS(SVGNS, "circle");
        del.setAttribute("cx", mx); del.setAttribute("cy", my); del.setAttribute("r", "8"); del.setAttribute("fill", "#f97316");
        del.setAttribute("data-edge-del", String(idx)); del.style.pointerEvents = "all"; del.style.cursor = "pointer";
        const x = document.createElementNS(SVGNS, "text"); x.setAttribute("x", mx); x.setAttribute("y", my + 3.5); x.setAttribute("text-anchor", "middle"); x.setAttribute("font-size", "11"); x.setAttribute("fill", "#fff"); x.style.pointerEvents = "none"; x.textContent = "\u00d7";
        del.addEventListener("click", () => { const i = state.edges.findIndex((ed) => ed.source === e.source && ed.target === e.target); if (i >= 0) state.edges.splice(i, 1); renderEdges(); markDirty(); });
        svg.appendChild(del); svg.appendChild(x);
      });
    }

    function addEdge(source, target) {
      if (!source || !target || source === target) return false;
      const tnode = state.nodes.find((n) => n.id === target);
      if (!state.nodes.find((n) => n.id === source) || !tnode) return false;
      if (NODE_META[tnode.type] && NODE_META[tnode.type].trigger) { toast("A trigger can't have anything connected into it.", true); return false; }
      if (state.edges.some((e) => e.source === source)) { toast("Only one outgoing connector per step (branching comes later).", true); return false; }
      if (state.edges.some((e) => e.target === target)) { toast("This step already has an incoming connector.", true); return false; }
      if (state.edges.some((e) => e.source === source && e.target === target)) return false;
      state.edges.push({ source, target }); renderEdges(); markDirty(); return true;
    }

    // ---- Node card + connect handles ----
    function renderNode(node) {
      const m = NODE_META[node.type] || { label: node.type, accent: "#64748b", icon: "\u25A0" };
      let card = surface.querySelector(`[data-node-id="${node.id}"]`);
      if (!card) { card = el("div", "drip-node"); card.dataset.nodeId = node.id; surface.appendChild(card); }
      const err = state.errorsByNode[node.id];
      card.style.cssText = "position:absolute;left:" + node.x + "px;top:" + node.y + "px;width:" + NODE_W + "px;min-height:" + NODE_H + "px;background:var(--panel,#fff);border:1px solid " + (err ? "#ef4444" : "var(--line,#e5e7eb)") + ";border-left:4px solid " + m.accent + ";border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:9px 12px;cursor:grab;user-select:none" + (state.selectedId === node.id ? ";outline:2px solid " + m.accent + ";outline-offset:1px" : "");
      const inH = (m.trigger ? "" : `<div class="drip-h drip-h-in" data-h="in" data-node-id="${node.id}" style="position:absolute;left:-7px;top:${NODE_H / 2 - 6}px;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid #f97316;cursor:crosshair"></div>`);
      const outH = `<div class="drip-h drip-h-out" data-h="out" data-node-id="${node.id}" style="position:absolute;right:-7px;top:${NODE_H / 2 - 6}px;width:12px;height:12px;border-radius:50%;background:#f97316;border:2px solid #fff;cursor:crosshair"></div>`;
      card.innerHTML = `<div style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600"><span>${m.icon}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.label)}</span></div><div class="cell-muted drip-node-sub" style="font-size:11px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nodeSummary(node))}</div>${inH}${outH}` + (err ? `<div style="color:#dc2626;font-size:10.5px;margin-top:3px">${esc(err)}</div>` : "");
      attachNodeDrag(card, node);
      attachConnect(card, node);
    }
    function refreshNodeSummary(node) { const sub = surface.querySelector(`[data-node-id="${node.id}"] .drip-node-sub`); if (sub) sub.textContent = nodeSummary(node); }

    // ---- Drag a node ----
    function attachNodeDrag(card, node) {
      card.onmousedown = (e) => {
        if (e.button !== 0) return;
        if (e.target.closest && (e.target.closest(".drip-h") || e.target.closest(".drip-node-del"))) return;
        e.preventDefault(); selectNode(node.id);
        const sx = e.clientX, sy = e.clientY, ox = node.x, oy = node.y; let moved = false;
        const move = (ev) => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true; node.x = Math.max(0, Math.round(ox + dx)); node.y = Math.max(0, Math.round(oy + dy)); card.style.left = node.x + "px"; card.style.top = node.y + "px"; renderEdges(); };
        const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); if (moved) markDirty(); };
        document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
      };
      card._moveTo = (x, y) => { node.x = Math.max(0, Math.round(x)); node.y = Math.max(0, Math.round(y)); card.style.left = node.x + "px"; card.style.top = node.y + "px"; renderEdges(); markDirty(); };
    }

    // ---- Draw a connector from an OUTPUT handle to an INPUT handle ----
    function attachConnect(card, node) {
      const out = card.querySelector('.drip-h-out');
      if (!out) return;
      out.onmousedown = (e) => {
        e.preventDefault(); e.stopPropagation();
        const start = outAnchor(node);
        const temp = document.createElementNS(SVGNS, "path"); temp.setAttribute("fill", "none"); temp.setAttribute("stroke", "#f97316"); temp.setAttribute("stroke-width", "2.5"); temp.setAttribute("stroke-dasharray", "5 4"); svg.appendChild(temp);
        const move = (ev) => { const r = canvas.getBoundingClientRect(); const p = { x: ev.clientX - r.left + canvas.scrollLeft, y: ev.clientY - r.top + canvas.scrollTop }; temp.setAttribute("d", edgePath(start, p)); };
        const up = (ev) => {
          document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); temp.remove();
          const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
          const inH = tgt && tgt.closest && tgt.closest('.drip-h-in');
          if (inH) addEdge(node.id, inH.dataset.nodeId);
        };
        document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
      };
    }

    function selectNode(id) { if (state.flush) { try { state.flush(); } catch (e) {} state.flush = null; } state.selectedId = id; state.nodes.forEach(renderNode); renderConfig(); }
    function deselect() { if (state.flush) { try { state.flush(); } catch (e) {} state.flush = null; } state.selectedId = null; renderConfig(); state.nodes.forEach(renderNode); }
    canvas.addEventListener("mousedown", (e) => { if (e.target === canvas || e.target === surface || e.target === svg) deselect(); });

    // ---- Config panel ----
    function renderConfig() {
      configPanel.innerHTML = "";
      const node = state.nodes.find((n) => n.id === state.selectedId);
      if (!node) { configPanel.appendChild(el("div", "cell-muted", "Select a step to configure it, or drag a new one from the palette.")); return; }
      const m = NODE_META[node.type];
      const head = el("div"); head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px";
      head.innerHTML = `<div style="font-weight:700;font-size:14px">${m.icon} ${esc(m.label)}</div>`;
      const delBtn = el("button", "btn btn-ghost btn-sm drip-node-del", "Delete"); delBtn.style.color = "#dc2626";
      delBtn.onclick = () => {
        state.flush = null;
        state.edges = state.edges.filter((ed) => ed.source !== node.id && ed.target !== node.id);
        state.nodes = state.nodes.filter((n) => n.id !== node.id);
        const c = surface.querySelector(`[data-node-id="${node.id}"]`); if (c) c.remove();
        state.selectedId = null; renderEdges(); renderConfig(); markDirty();
      };
      head.appendChild(delBtn); configPanel.appendChild(head);
      const body = el("div"); configPanel.appendChild(body);
      buildConfig(node, body);
    }

    function buildConfig(node, body) {
      node.config = node.config || {};
      const done = () => { refreshNodeSummary(node); };
      if (node.type === "wait") return cfgWait(node, body, done);
      if (node.type === "enroll_audience" || node.type === "enroll") return cfgAudience(node, body, done);
      if (node.type === "enroll_condition" || node.type === "unenroll") return cfgCondition(node, body, done);
      if (node.type === "send_email") return cfgEmail(node, body, done);
      if (node.type === "send_survey") return cfgSurvey(node, body, done);
      body.appendChild(el("div", "cell-muted", "No settings."));
    }

    function cfgWait(node, body, done) {
      const cfg = node.config;
      const row = el("div"); row.style.cssText = "display:flex;gap:8px;align-items:flex-end";
      const amtWrap = el("label", "field"); amtWrap.style.flex = "1"; amtWrap.innerHTML = `<span class="field-label">Wait</span>`;
      const amt = el("input", "input"); amt.type = "number"; amt.min = "0"; amt.value = cfg.amount != null ? cfg.amount : 1; amtWrap.appendChild(amt);
      const unitWrap = el("label", "field"); unitWrap.style.flex = "1"; unitWrap.innerHTML = `<span class="field-label">Unit</span>`;
      const unit = el("select", "input"); ["minutes", "hours", "days"].forEach((u) => { const o = el("option"); o.value = u; o.textContent = u; if ((cfg.unit || "days") === u) o.selected = true; unit.appendChild(o); }); unitWrap.appendChild(unit);
      row.appendChild(amtWrap); row.appendChild(unitWrap); body.appendChild(row);
      const flush = () => { node.config = { amount: Number(amt.value) || 0, unit: unit.value }; done(); };
      amt.oninput = flush; unit.onchange = flush; state.flush = flush;
    }
    function cfgAudience(node, body, done) {
      const cfg = node.config;
      body.appendChild(el("div", "field-label", "Audience"));
      const host2 = el("div"); body.appendChild(host2);
      const picker = App.audienceSelect.mount(host2, { emailableOnly: false, selectedIds: Array.isArray(cfg.audienceIds) ? cfg.audienceIds : [], onChange: () => { node.config = { audienceIds: picker.getSelectedIds() }; done(); } });
      state.flush = () => { node.config = { audienceIds: picker.getSelectedIds() }; done(); };
    }
    async function cfgCondition(node, body, done) {
      const cfg = node.config;
      body.appendChild(el("div", "field-label", node.type === "unenroll" ? "Unenroll people who match (optional)" : "Enroll people who match"));
      const holder = el("div"); body.appendChild(holder); holder.appendChild(el("div", "cell-muted", "Loading…"));
      let contacts = [], fields = [];
      try { [contacts, fields] = await Promise.all([App.portalApi("/api/contacts").catch(() => []), App.portalApi("/api/fields").catch(() => [])]); } catch (e) {}
      const columns = App.portal.contactColumnDefs(fields || []);
      const rules = Array.isArray(cfg.rules) ? cfg.rules.map((r) => ({ ...r })) : [];
      holder.innerHTML = ""; holder.appendChild(App.table.ruleEditor(columns, contacts, rules, () => { node.config = { rules }; done(); }));
      state.flush = () => { node.config = { rules }; done(); };
    }
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
          try { composer = App.compose.mount(cHost, { kind: "email" }); if (cfg.html && composer.setHTML) composer.setHTML(cfg.html); }
          catch (e) { const ta = el("textarea", "input"); ta.rows = 6; ta.value = cfg.html || ""; ta.placeholder = "Email body (HTML)"; cHost.appendChild(ta); composer = { getHTML: () => ta.value, getSubject: () => subj.value }; }
          node._readEmail = () => ({ subject: subj.value, html: composer && composer.getHTML ? composer.getHTML() : (cfg.html || "") });
        }
      }
      mode.onchange = () => { paint(); node.config = { mode: mode.value }; done(); };
      paint();
      state.flush = () => { if (mode.value === "template") node.config = { mode: "template", templateId: tmplSel ? tmplSel.value : (cfg.templateId || "") }; else { const r = node._readEmail ? node._readEmail() : { subject: cfg.subject || "", html: cfg.html || "" }; node.config = { mode: "scratch", subject: r.subject, html: r.html }; } done(); };
    }
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
      state.flush = () => { node.config = { mode: mode.value, surveyId: surveySel ? surveySel.value : (cfg.surveyId || ""), subject: subj ? subj.value : (cfg.subject || ""), html: composer && composer.getHTML ? composer.getHTML() : (cfg.html || "") }; done(); };
    }

    // ---- Validation display ----
    function showErrors(errors) {
      state.errorsByNode = {};
      (errors || []).forEach((e) => { if (e.nodeId) state.errorsByNode[e.nodeId] = e.message; });
      state.nodes.forEach(renderNode);
      if (errors && errors.length) {
        banner.style.display = "";
        banner.innerHTML = `<div style="font-weight:700;margin-bottom:4px">This drip can't run yet:</div><ul style="margin:0;padding-left:18px">` + (errors.map((e) => `<li>${esc(e.message)}</li>`).join("")) + `</ul>`;
      } else { banner.style.display = "none"; banner.innerHTML = ""; }
    }
    function clearErrors() { state.errorsByNode = {}; banner.style.display = "none"; banner.innerHTML = ""; state.nodes.forEach(renderNode); }

    // ---- Save / toggle ----
    function serialize() { return { nodes: state.nodes.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, config: n.config || {} })), edges: state.edges.map((e) => ({ source: e.source, target: e.target })) }; }
    async function doSave() {
      if (state.flush) { try { state.flush(); } catch (e) {} }
      saveBtn.disabled = true; note.textContent = "Saving…";
      try {
        const updated = await App.portalApi("/api/drips/" + drip.id, { method: "PATCH", body: JSON.stringify({ graph: serialize() }) });
        drip.graph = updated.graph;
        if (updated.warning) { state.enabled = !!updated.enabled; paintStatus(); toast(updated.warning, true); markClean(""); }
        else { markClean("Saved."); toast("Drip saved"); }
        setTimeout(() => { if (note.textContent === "Saved.") markClean(""); }, 2500);
        return true;
      } catch (e) { markClean(""); toast(e.message, true); return false; }
      finally { saveBtn.disabled = false; }
    }
    saveBtn.onclick = doSave;

    toggleBtn.onclick = async () => {
      if (state.flush) { try { state.flush(); } catch (e) {} }
      toggleBtn.disabled = true;
      try {
        if (state.enabled) {
          const d = await App.portalApi("/api/drips/" + drip.id + "/deactivate", { method: "POST" });
          state.enabled = !!d.enabled; clearErrors(); paintStatus(); toast("Drip turned off");
        } else {
          await doSave();
          const d = await App.portalApi("/api/drips/" + drip.id + "/activate", { method: "POST" });
          state.enabled = !!d.enabled; clearErrors(); paintStatus(); toast("Drip is on — it now runs through your automations.");
        }
      } catch (e) {
        const errs = (e && e.data && e.data.errors) || (e && e.errors) || null;
        if (errs) showErrors(errs); else toast(e.message || "Couldn't change status", true);
      } finally { toggleBtn.disabled = false; }
    };

    // Initial paint
    state.nodes.forEach(renderNode); renderEdges(); renderConfig(); paintStatus();

    // Test hook
    canvas.__dripTest = {
      addNode, addEdge, state, serialize, showErrors,
      moveNode: (id, x, y) => { const c = surface.querySelector(`[data-node-id="${id}"]`); if (c && c._moveTo) c._moveTo(x, y); },
      selectNode, save: doSave, toggle: () => toggleBtn.onclick(), edgeCount: () => svg.querySelectorAll("path[data-edge]").length,
    };
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
      case "enroll_condition": case "unenroll": return (c.rules && c.rules.length) ? `${c.rules.length} rule${c.rules.length === 1 ? "" : "s"}` : (node.type === "unenroll" ? "exit the flow" : "no rules yet");
      case "send_email": return c.mode === "template" ? (c.templateId ? "template" : "pick a template") : (c.subject ? c.subject : "from scratch");
      case "send_survey": return c.surveyId ? "survey chosen" : (c.mode === "scratch" ? "compose invite" : "pick a survey");
      default: return "";
    }
  }

  App.drips = { renderLibrary, openEditor, NODE_META, _defaultConfig: defaultConfig, _nodeSummary: nodeSummary };
})(window);
