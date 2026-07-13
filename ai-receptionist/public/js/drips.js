// Drips builder — SLICE 3 (final): if/else branching, Zoho-style visual canvas, and pan/zoom.
// A drip is a graph of nodes + edges. Linear drips compile to one automation; a drip with a Branch
// node compiles to a pairId-linked automation pair via the engine's applyFlowDefinition. Triggers
// render as circles, actions as colored cards, connectors as curved arrowed paths (branch edges
// labeled If/Otherwise).
(function (global) {
  const App = global.App || (global.App = {});
  const SVGNS = "http://www.w3.org/2000/svg";
  const NODE_W = 168, NODE_H = 62, TRIG_R = 40;

  // accent = left/ring color, bg = card fill (Zoho spirit; still theme-friendly).
  const NODE_META = {
    enroll_audience:  { label: "Enroll audience",     group: "Triggers", accent: "#7c3aed", bg: "#f5f3ff", icon: "\u{1F465}", trigger: true },
    enroll_condition: { label: "Enroll on condition", group: "Triggers", accent: "#7c3aed", bg: "#f5f3ff", icon: "\u{1F50E}", trigger: true },
    wait:             { label: "Wait",                group: "Actions",  accent: "#0284c7", bg: "#e0f2fe", icon: "\u{23F1}" },
    send_email:       { label: "Send email",          group: "Actions",  accent: "#ea580c", bg: "#fff7ed", icon: "\u2709" },
    send_survey:      { label: "Send survey",         group: "Actions",  accent: "#d97706", bg: "#fffbeb", icon: "\u{1F4CB}" },
    enroll:           { label: "Enroll",              group: "Actions",  accent: "#0d9488", bg: "#f0fdfa", icon: "\u2795" },
    unenroll:         { label: "Unenroll",            group: "Actions",  accent: "#dc2626", bg: "#fef2f2", icon: "\u{1F6AA}" },
    branch:           { label: "Branch (if / else)",  group: "Logic",    accent: "#4f46e5", bg: "#eef2ff", icon: "\u{2442}", branch: true },
  };
  const PALETTE_GROUPS = [
    { group: "Triggers", types: ["enroll_audience", "enroll_condition"] },
    { group: "Logic", types: ["branch"] },
    { group: "Actions", types: ["wait", "send_email", "send_survey", "enroll", "unenroll"] },
  ];
  const NEGATABLE = ["is", "is_not", "contains", "not_contains", "empty", "not_empty"];
  let nodeSeq = 1;
  const newNodeId = () => "n" + Date.now().toString(36) + (nodeSeq++);

  // ------------------------------------------------------------------ Library
  async function renderLibrary(host) {
    const { el, esc, toast } = App.util;
    host.innerHTML = `<div class="cell-muted u-pad-8">Loading…</div>`;
    let drips = [];
    try { drips = await App.portalApi("/api/drips"); } catch (e) { host.innerHTML = `<div class="cell-muted">${esc(e.message)}</div>`; return; }
    drips = Array.isArray(drips) ? drips : [];
    host.innerHTML = "";
    const head = el("div"); head.classList.add("dr-lib-head");;
    const hl = el("div");
    hl.appendChild(el("h3", "settings-sub", "Drips"));
    hl.appendChild(el("div", "cell-muted", "Visual drip campaigns — wire steps together, branch on conditions, and turn them on to run through your automations.")).classList.add("u-meta", "u-mt-2");
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
    const list = el("div"); list.classList.add("dr-lib-list");;
    drips.forEach((d) => {
      const nodeCount = (d.graph && Array.isArray(d.graph.nodes)) ? d.graph.nodes.length : 0;
      const branched = (d.graph && Array.isArray(d.graph.nodes)) ? d.graph.nodes.some((n) => n.type === "branch") : false;
      const row = el("div", "card"); row.classList.add("dr-lib-row");;
      const left = el("div");
      const pill = d.enabled
        ? `<span class="pill success u-ml-8">On</span>`
        : `<span class="pill pill-muted u-ml-8">Off</span>`;
      const brPill = branched ? `<span class="pill u-ml-8">Branch</span>` : "";
      left.innerHTML = `<div class="dr-row-name">${esc(d.name)}${pill}${brPill}</div><div class="cell-muted u-meta">${nodeCount} step${nodeCount === 1 ? "" : "s"} · updated ${App.util.fmtDate ? App.util.fmtDate(d.updatedAt) : ""}</div>`;
      const btns = el("div"); btns.classList.add("dr-btns");;
      const open = el("button", "btn btn-primary btn-sm", "Open");
      open.onclick = async () => { try { const full = await App.portalApi("/api/drips/" + d.id); openEditor(host, full); } catch (e) { toast(e.message, true); } };
      const ren = el("button", "btn btn-ghost btn-sm", "Rename");
      ren.onclick = async () => { const name = await App.ui.promptModal({ title: "Rename drip", label: "Drip name", value: d.name, okText: "Rename" }); if (!name || !name.trim()) return; try { await App.portalApi("/api/drips/" + d.id, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) }); toast("Renamed"); renderLibrary(host); } catch (e) { toast(e.message, true); } };
      const del = el("button", "btn btn-ghost btn-sm txt-danger", "Delete");
      del.onclick = async () => { if (!(await App.ui.confirmModal({ title: "Delete drip", message: `Delete the drip \u201c${d.name}\u201d? Its automation will be removed too.`, confirmText: "Delete" }))) return; try { await App.portalApi("/api/drips/" + d.id, { method: "DELETE" }); toast("Deleted"); renderLibrary(host); } catch (e) { toast(e.message, true); } };
      btns.appendChild(open); btns.appendChild(ren); btns.appendChild(del);
      row.appendChild(left); row.appendChild(btns);
      list.appendChild(row);
    });
    host.appendChild(list);
  }

  // Allow other tabs (e.g. Automations) to deep-link into a drip editor by id.
  async function openDripById(host, dripId) {
    try { const full = await App.portalApi("/api/drips/" + dripId); openEditor(host, full); }
    catch (e) { App.util.toast(e.message, true); renderLibrary(host); }
  }

  // ------------------------------------------------------------------ Editor
  function openEditor(host, drip) {
    const { el, esc, toast } = App.util;
    host.innerHTML = "";
    const g = drip.graph || {};
    const state = {
      nodes: ((g && Array.isArray(g.nodes)) ? g.nodes : []).map((n) => ({ id: n.id, type: n.type, x: Number(n.x) || 0, y: Number(n.y) || 0, config: n.config || {} })),
      edges: ((g && Array.isArray(g.edges)) ? g.edges : []).map((e) => ({ source: e.source, target: e.target, branch: (e.branch === "if" || e.branch === "otherwise") ? e.branch : undefined })),
      selectedId: null, flush: null, enabled: !!drip.enabled, errorsByNode: {},
      view: { scale: 1, tx: 20, ty: 20 },
    };

    // Top bar
    const bar = el("div"); bar.classList.add("dr-bar");;
    const back = el("button", "btn btn-ghost btn-sm", "\u2190 Drips"); back.onclick = () => renderLibrary(host);
    const title = el("div", "settings-sub"); title.classList.add("dr-title");; title.textContent = drip.name;
    const statusPill = el("span", "pill");
    const note = el("span", "cell-muted u-meta");
    const saveBtn = el("button", "btn btn-ghost btn-sm", "Save");
    const toggleBtn = el("button", "btn btn-primary btn-sm", "Turn on");
    bar.appendChild(back); bar.appendChild(title); bar.appendChild(statusPill); bar.appendChild(note); bar.appendChild(saveBtn); bar.appendChild(toggleBtn);
    host.appendChild(bar);

    const banner = el("div"); banner.classList.add("dr-banner"); banner.classList.add("u-hidden");; host.appendChild(banner);

    // Layout
    const layout = el("div", "drip-layout"); layout.classList.add("dr-layout");;
    const palette = el("div", "drip-palette"); palette.classList.add("dr-palette-col");;
    const canvasWrap = el("div"); canvasWrap.classList.add("dr-canvas-wrap");;
    const canvas = el("div", "drip-canvas"); canvas.classList.add("dr-canvas-box");;
    canvas.setAttribute("data-drip-canvas", "1");
    const surface = el("div", "drip-surface"); surface.classList.add("dr-surface-box");;
    const svg = document.createElementNS(SVGNS, "svg"); svg.setAttribute("width", "2600"); svg.setAttribute("height", "1700"); svg.classList.add("dr-svg");;
    // arrowhead marker
    const defs = document.createElementNS(SVGNS, "defs");
    const marker = document.createElementNS(SVGNS, "marker");
    marker.setAttribute("id", "drip-arrow"); marker.setAttribute("viewBox", "0 0 10 10"); marker.setAttribute("refX", "9"); marker.setAttribute("refY", "5"); marker.setAttribute("markerWidth", "7"); marker.setAttribute("markerHeight", "7"); marker.setAttribute("orient", "auto-start-reverse");
    const mpath = document.createElementNS(SVGNS, "path"); mpath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z"); mpath.setAttribute("fill", "#fb923c"); marker.appendChild(mpath); defs.appendChild(marker); svg.appendChild(defs);
    const edgeLayer = document.createElementNS(SVGNS, "g"); svg.appendChild(edgeLayer);
    surface.appendChild(svg);
    canvas.appendChild(surface); canvasWrap.appendChild(canvas);

    // Zoom controls (overlay)
    const zoomBar = el("div"); zoomBar.classList.add("dr-zoombar");;
    const zOut = el("button", "btn btn-ghost btn-sm", "\u2212"); const zIn = el("button", "btn btn-ghost btn-sm", "+"); const zFit = el("button", "btn btn-ghost btn-sm", "Fit");
    [zOut, zIn, zFit].forEach((b) => { b.classList.add("dr-zbtn"); zoomBar.appendChild(b); });
    canvasWrap.appendChild(zoomBar);

    const configPanel = el("div", "drip-config"); configPanel.classList.add("dr-config-col");;
    layout.appendChild(palette); layout.appendChild(canvasWrap); layout.appendChild(configPanel);
    host.appendChild(layout);

    // ---- Palette ----
    PALETTE_GROUPS.forEach((grp) => {
      const box = el("div");
      box.appendChild(el("div", "cell-muted dr-grp-label", grp.group));
      grp.types.forEach((type) => {
        const m = NODE_META[type];
        const item = el("div", "drip-pal-item");
        item.classList.add("dr-palette-item"); item.style.setProperty("--node-accent", m.accent);
        item.setAttribute("draggable", "true"); item.dataset.type = type;
        item.innerHTML = `<span class="dr-item-icon">${m.icon}</span><span>${esc(m.label)}</span>`;
        item.addEventListener("dragstart", (e) => { try { e.dataTransfer.setData("text/drip-node", type); e.dataTransfer.effectAllowed = "copy"; } catch (er) {} });
        box.appendChild(item);
      });
      palette.appendChild(box);
    });

    // ---- View (pan/zoom) ----
    function applyView() { surface.style.transform = `translate(${state.view.tx}px, ${state.view.ty}px) scale(${state.view.scale})`; }
    function clientToSurface(clientX, clientY) { const r = canvas.getBoundingClientRect(); return { x: (clientX - r.left - state.view.tx) / state.view.scale, y: (clientY - r.top - state.view.ty) / state.view.scale }; }
    function zoomAt(clientX, clientY, factor) {
      const r = canvas.getBoundingClientRect(); const cx = clientX - r.left, cy = clientY - r.top;
      const sx = (cx - state.view.tx) / state.view.scale, sy = (cy - state.view.ty) / state.view.scale;
      state.view.scale = Math.min(2, Math.max(0.35, state.view.scale * factor));
      state.view.tx = cx - sx * state.view.scale; state.view.ty = cy - sy * state.view.scale; applyView();
    }
    function fitView() {
      if (!state.nodes.length) { state.view = { scale: 1, tx: 20, ty: 20 }; applyView(); return; }
      const xs = state.nodes.map((n) => n.x), ys = state.nodes.map((n) => n.y);
      const minX = Math.min(...xs) - 40, minY = Math.min(...ys) - 40, maxX = Math.max(...xs) + NODE_W + 40, maxY = Math.max(...ys) + NODE_H + 40;
      const cw = canvas.clientWidth || 640, ch = canvas.clientHeight || 660;
      const scale = Math.min(2, Math.max(0.35, Math.min(cw / (maxX - minX), ch / (maxY - minY))));
      state.view.scale = scale; state.view.tx = (cw - (maxX - minX) * scale) / 2 - minX * scale; state.view.ty = 20 - minY * scale; applyView();
    }
    zIn.onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(r.left + canvas.clientWidth / 2, r.top + canvas.clientHeight / 2, 1.2); };
    zOut.onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(r.left + canvas.clientWidth / 2, r.top + canvas.clientHeight / 2, 1 / 1.2); };
    zFit.onclick = fitView;
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
    // Pan on empty-canvas drag.
    canvas.addEventListener("mousedown", (e) => {
      if (e.target !== canvas && e.target !== surface && e.target !== svg && e.target !== edgeLayer) return;
      deselect(); canvas.classList.add("grabbing");
      const sx = e.clientX, sy = e.clientY, otx = state.view.tx, oty = state.view.ty;
      const move = (ev) => { state.view.tx = otx + (ev.clientX - sx); state.view.ty = oty + (ev.clientY - sy); applyView(); };
      const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); canvas.classList.remove("grabbing"); };
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    });

    // ---- Drop to create ----
    canvas.addEventListener("dragover", (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = "copy"; } catch (er) {} });
    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      const type = (() => { try { return e.dataTransfer.getData("text/drip-node"); } catch (er) { return ""; } })();
      if (!type || !NODE_META[type]) return;
      const p = clientToSurface(e.clientX, e.clientY); addNode(type, p.x - NODE_W / 2, p.y - NODE_H / 2);
    });

    function addNode(type, x, y) { const node = { id: newNodeId(), type, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), config: defaultConfig(type) }; state.nodes.push(node); renderNode(node); selectNode(node.id); markDirty(); return node; }
    function markDirty() { note.textContent = "Unsaved changes"; }
    function markClean(txt) { note.textContent = txt || ""; }
    function paintStatus() {
      if (state.enabled) { statusPill.textContent = "On"; statusPill.className = "pill success"; toggleBtn.textContent = "Turn off"; }
      else { statusPill.textContent = "Off"; statusPill.className = "pill pill-muted"; toggleBtn.textContent = "Turn on"; }
    }

    // ---- Anchors ----
    function nodeH(n) { return NODE_META[n.type] && NODE_META[n.type].trigger ? TRIG_R * 2 : NODE_H; }
    function nodeW(n) { return NODE_META[n.type] && NODE_META[n.type].trigger ? TRIG_R * 2 : NODE_W; }
    function outAnchor(n, branch) {
      if (NODE_META[n.type] && NODE_META[n.type].branch) {
        // two outputs on the bottom, if=left, otherwise=right
        const y = n.y + NODE_H; return { x: n.x + (branch === "otherwise" ? NODE_W * 0.75 : NODE_W * 0.25), y };
      }
      return { x: n.x + nodeW(n), y: n.y + nodeH(n) / 2 };
    }
    function inAnchor(n) { return { x: n.x, y: n.y + nodeH(n) / 2 }; }
    function edgePath(a, b) { const dx = Math.max(40, Math.abs(b.x - a.x) / 2); return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`; }

    function renderEdges() {
      while (edgeLayer.firstChild) edgeLayer.removeChild(edgeLayer.firstChild);
      state.edges.forEach((e) => {
        const s = state.nodes.find((n) => n.id === e.source), t = state.nodes.find((n) => n.id === e.target);
        if (!s || !t) return;
        const a = outAnchor(s, e.branch), b = inAnchor(t);
        const path = document.createElementNS(SVGNS, "path");
        path.setAttribute("d", edgePath(a, b)); path.setAttribute("fill", "none");
        path.setAttribute("stroke", e.branch === "otherwise" ? "#9ca3af" : "#fb923c"); path.setAttribute("stroke-width", "2.5");
        path.setAttribute("marker-end", "url(#drip-arrow)");
        path.setAttribute("data-edge", e.source + ">" + e.target); path.setAttribute("class", "dr-edge");
        edgeLayer.appendChild(path);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (e.branch) {
          const lbl = document.createElementNS(SVGNS, "text"); lbl.setAttribute("x", mx); lbl.setAttribute("y", my - 6); lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("font-size", "11"); lbl.setAttribute("font-weight", "700"); lbl.setAttribute("class", "dr-edge-x"); lbl.setAttribute("fill", e.branch === "otherwise" ? "var(--ink-faint)" : "var(--flow-yes)"); lbl.textContent = e.branch === "otherwise" ? "Otherwise" : "If"; edgeLayer.appendChild(lbl);
        }
        const del = document.createElementNS(SVGNS, "circle"); del.setAttribute("cx", mx); del.setAttribute("cy", my); del.setAttribute("r", "8"); del.setAttribute("fill", e.branch === "otherwise" ? "#9ca3af" : "#fb923c"); del.setAttribute("class", "dr-edge-del");
        const x = document.createElementNS(SVGNS, "text"); x.setAttribute("x", mx); x.setAttribute("y", my + 3.5); x.setAttribute("text-anchor", "middle"); x.setAttribute("font-size", "11"); x.setAttribute("fill", "#fff"); x.setAttribute("class", "dr-edge-x"); x.textContent = "\u00d7";
        del.addEventListener("click", (ev) => { ev.stopPropagation(); const i = state.edges.findIndex((ed) => ed.source === e.source && ed.target === e.target && ed.branch === e.branch); if (i >= 0) state.edges.splice(i, 1); renderEdges(); markDirty(); });
        edgeLayer.appendChild(del); edgeLayer.appendChild(x);
      });
    }

    function addEdge(source, target, branch) {
      if (!source || !target || source === target) return false;
      const snode = state.nodes.find((n) => n.id === source), tnode = state.nodes.find((n) => n.id === target);
      if (!snode || !tnode) return false;
      if (NODE_META[tnode.type] && NODE_META[tnode.type].trigger) { toast("A trigger can't have anything connected into it.", true); return false; }
      const isBranch = NODE_META[snode.type] && NODE_META[snode.type].branch;
      if (isBranch) {
        if (branch !== "if" && branch !== "otherwise") { toast("Drag from the If or Otherwise handle.", true); return false; }
        if (state.edges.some((e) => e.source === source && e.branch === branch)) { toast(`This branch already has an “${branch === "if" ? "If" : "Otherwise"}” path.`, true); return false; }
      } else {
        if (state.edges.some((e) => e.source === source)) { toast("Only one outgoing connector per step (use a Branch to split).", true); return false; }
        branch = undefined;
      }
      if (state.edges.some((e) => e.target === target)) { toast("This step already has an incoming connector.", true); return false; }
      state.edges.push({ source, target, branch }); renderEdges(); markDirty(); return true;
    }

    // ---- Node rendering ----
    function renderNode(node) {
      const m = NODE_META[node.type] || { label: node.type, accent: "#64748b", bg: "#f8fafc", icon: "\u25A0" };
      let card = surface.querySelector(`[data-node-id="${node.id}"]`);
      if (!card) { card = el("div", "drip-node"); card.dataset.nodeId = node.id; surface.appendChild(card); }
      const err = state.errorsByNode[node.id];
      const selected = state.selectedId === node.id;
      if (m.trigger) {
        const d = TRIG_R * 2;
        card.className = "dr-node-trig" + (selected ? " sel" : ""); card.style.left = node.x + "px"; card.style.top = node.y + "px"; card.style.width = d + "px"; card.style.height = d + "px"; card.style.setProperty("--node-accent", err ? "var(--red)" : m.accent);
        const outH = `<div class="drip-h drip-h-out dr-h-out-t" data-h="out" data-node-id="${node.id}" style="--node-accent:${m.accent}"></div>`;
        card.innerHTML = `<div class="dr-t-icon">${m.icon}</div><div class="dr-t-label">${esc(m.label)}</div><div class="drip-node-sub dr-t-sub">${esc(nodeSummary(node))}</div>${outH}`;
      } else if (m.branch) {
        card.className = "dr-node" + (selected ? " sel" : ""); card.style.left = node.x + "px"; card.style.top = node.y + "px"; card.style.setProperty("--node-accent", err ? "var(--red)" : m.accent);
        const inH = `<div class="drip-h drip-h-in dr-h-in" data-h="in" data-node-id="${node.id}" style="--node-accent:${m.accent}"></div>`;
        const ifH = `<div class="drip-h drip-h-out dr-h-if" data-h="out" data-branch="if" data-node-id="${node.id}" title="If (match)"></div>`;
        const elseH = `<div class="drip-h drip-h-out dr-h-else" data-h="out" data-branch="otherwise" data-node-id="${node.id}" title="Otherwise"></div>`;
        card.innerHTML = `<div class="dr-n-head"><span>${m.icon}</span><span>${esc(m.label)}</span></div><div class="cell-muted drip-node-sub dr-n-sub">${esc(nodeSummary(node))}</div><div class="dr-br-lbl dr-br-if">If</div><div class="dr-br-lbl dr-br-else">Otherwise</div>${inH}${ifH}${elseH}` + (err ? `<div class="dr-n-err">${esc(err)}</div>` : "");
      } else {
        card.className = "dr-node-branch" + (selected ? " sel" : ""); card.style.left = node.x + "px"; card.style.top = node.y + "px"; card.style.setProperty("--edge-line", err ? "var(--red)" : "var(--line)"); card.style.setProperty("--node-accent", m.accent);
        const inH = `<div class="drip-h drip-h-in dr-h-in" data-h="in" data-node-id="${node.id}" style="--node-accent:${m.accent}"></div>`;
        const outH = `<div class="drip-h drip-h-out dr-h-out" data-h="out" data-node-id="${node.id}" style="--node-accent:${m.accent}"></div>`;
        card.innerHTML = `<div class="dr-n-head7"><span class="dr-n-ico">${m.icon}</span><span class="dr-n-title">${esc(m.label)}</span></div><div class="cell-muted drip-node-sub dr-n-sub">${esc(nodeSummary(node))}</div>${inH}${outH}` + (err ? `<div class="dr-n-err">${esc(err)}</div>` : "");
      }
      attachNodeDrag(card, node); attachConnect(card, node);
    }
    function refreshNodeSummary(node) { const sub = surface.querySelector(`[data-node-id="${node.id}"] .drip-node-sub`); if (sub) sub.textContent = nodeSummary(node); }

    function attachNodeDrag(card, node) {
      card.onmousedown = (e) => {
        if (e.button !== 0) return;
        if (e.target.closest && (e.target.closest(".drip-h") || e.target.closest(".drip-node-del"))) return;
        e.preventDefault(); e.stopPropagation(); selectNode(node.id);
        const sx = e.clientX, sy = e.clientY, ox = node.x, oy = node.y; let moved = false;
        const move = (ev) => { const dx = (ev.clientX - sx) / state.view.scale, dy = (ev.clientY - sy) / state.view.scale; if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true; node.x = Math.max(0, Math.round(ox + dx)); node.y = Math.max(0, Math.round(oy + dy)); card.style.left = node.x + "px"; card.style.top = node.y + "px"; renderEdges(); };
        const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); if (moved) markDirty(); };
        document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
      };
      card._moveTo = (x, y) => { node.x = Math.max(0, Math.round(x)); node.y = Math.max(0, Math.round(y)); card.style.left = node.x + "px"; card.style.top = node.y + "px"; renderEdges(); markDirty(); };
    }

    function attachConnect(card, node) {
      card.querySelectorAll('.drip-h-out').forEach((out) => {
        const branch = out.dataset.branch;
        out.onmousedown = (e) => {
          e.preventDefault(); e.stopPropagation();
          const start = outAnchor(node, branch);
          const temp = document.createElementNS(SVGNS, "path"); temp.setAttribute("fill", "none"); temp.setAttribute("stroke", "#fb923c"); temp.setAttribute("stroke-width", "2.5"); temp.setAttribute("stroke-dasharray", "5 4"); edgeLayer.appendChild(temp);
          const move = (ev) => { const p = clientToSurface(ev.clientX, ev.clientY); temp.setAttribute("d", edgePath(start, p)); };
          const up = (ev) => {
            document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); temp.remove();
            const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
            const inH = tgt && tgt.closest && tgt.closest('.drip-h-in');
            if (inH) addEdge(node.id, inH.dataset.nodeId, branch);
          };
          document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
        };
      });
    }

    function selectNode(id) { if (state.flush) { try { state.flush(); } catch (e) {} state.flush = null; } state.selectedId = id; state.nodes.forEach(renderNode); renderConfig(); }
    function deselect() { if (state.flush) { try { state.flush(); } catch (e) {} state.flush = null; } if (state.selectedId != null) { state.selectedId = null; renderConfig(); state.nodes.forEach(renderNode); } }

    // ---- Config panel ----
    function renderConfig() {
      configPanel.innerHTML = "";
      const node = state.nodes.find((n) => n.id === state.selectedId);
      if (!node) { configPanel.appendChild(el("div", "cell-muted", "Select a step to configure it, or drag a new one from the palette.")); return; }
      const m = NODE_META[node.type];
      const head = el("div"); head.classList.add("dr-cfg-head");;
      head.innerHTML = `<div class="dr-cfg-title">${m.icon} ${esc(m.label)}</div>`;
      const delBtn = el("button", "btn btn-ghost btn-sm drip-node-del txt-danger", "Delete");
      delBtn.onclick = () => { state.flush = null; state.edges = state.edges.filter((ed) => ed.source !== node.id && ed.target !== node.id); state.nodes = state.nodes.filter((n) => n.id !== node.id); const c = surface.querySelector(`[data-node-id="${node.id}"]`); if (c) c.remove(); state.selectedId = null; renderEdges(); renderConfig(); markDirty(); };
      head.appendChild(delBtn); configPanel.appendChild(head);
      const body = el("div"); configPanel.appendChild(body);
      buildConfig(node, body);
    }
    function buildConfig(node, body) {
      node.config = node.config || {};
      const done = () => { refreshNodeSummary(node); };
      if (node.type === "wait") return cfgWait(node, body, done);
      if (node.type === "enroll_audience" || node.type === "enroll") return cfgAudience(node, body, done);
      if (node.type === "enroll_condition" || node.type === "unenroll") return cfgCondition(node, body, done, false);
      if (node.type === "branch") return cfgCondition(node, body, done, true);
      if (node.type === "send_email") return cfgEmail(node, body, done);
      if (node.type === "send_survey") return cfgSurvey(node, body, done);
      body.appendChild(el("div", "cell-muted", "No settings."));
    }
    function cfgWait(node, body, done) {
      const cfg = node.config;
      const row = el("div"); row.classList.add("dr-wait-row");;
      const amtWrap = el("label", "field u-flex-1"); amtWrap.innerHTML = `<span class="field-label">Wait</span>`;
      const amt = el("input", "input"); amt.type = "number"; amt.min = "0"; amt.value = cfg.amount != null ? cfg.amount : 1; amtWrap.appendChild(amt);
      const unitWrap = el("label", "field u-flex-1"); unitWrap.innerHTML = `<span class="field-label">Unit</span>`;
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
    async function cfgCondition(node, body, done, isBranch) {
      const cfg = node.config;
      body.appendChild(el("div", "field-label", isBranch ? "Branch when the contact matches" : (node.type === "unenroll" ? "Unenroll people who match (optional)" : "Enroll people who match")));
      if (isBranch) { const hint = el("div", "cell-muted", "Use a yes/no style rule (is, contains, is empty…). The “Otherwise” path runs for everyone who doesn’t match."); hint.classList.add("dr-hint"); body.appendChild(hint); }
      const holder = el("div"); body.appendChild(holder); holder.appendChild(el("div", "cell-muted", "Loading…"));
      let contacts = [], fields = [];
      try { [contacts, fields] = await Promise.all([App.portalApi("/api/contacts").catch(() => []), App.portalApi("/api/fields").catch(() => [])]); } catch (e) {}
      let columns = App.portal.contactColumnDefs(fields || []);
      if (isBranch) { columns = columns.map((c) => ({ ...c, ops: (c.ops || undefined) })); } // ruleEditor default ops are fine; compiler enforces negatable
      const rules = Array.isArray(cfg.rules) ? cfg.rules.map((r) => ({ ...r })) : [];
      holder.innerHTML = ""; holder.appendChild(App.table.ruleEditor(columns, contacts, rules, () => { node.config = { rules }; done(); }));
      state.flush = () => { node.config = { rules }; done(); };
    }
    function cfgEmail(node, body, done) {
      const cfg = node.config;
      const mode = el("select", "input"); ["scratch", "template"].forEach((mv) => { const o = el("option"); o.value = mv; o.textContent = mv === "scratch" ? "Create from scratch" : "Use an email template"; if ((cfg.mode || "scratch") === mv) o.selected = true; mode.appendChild(o); });
      body.appendChild(el("div", "field-label", "Email")); body.appendChild(mode);
      const area = el("div", "u-mt-10"); body.appendChild(area);
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
          const cHost = el("div", "u-mt-8"); area.appendChild(cHost);
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
      const area = el("div", "u-mt-10"); body.appendChild(area);
      let surveySel = null, composer = null, subj = null;
      function paint() {
        area.innerHTML = ""; surveySel = null; composer = null; subj = null;
        surveySel = el("select", "input"); surveySel.innerHTML = `<option value="">— pick a survey —</option>`;
        App.portalApi("/api/surveys").then((rows) => { (rows || []).forEach((s) => { const o = el("option"); o.value = s.id; o.textContent = s.name; if (s.id === cfg.surveyId) o.selected = true; surveySel.appendChild(o); }); }).catch(() => {});
        surveySel.onchange = () => done();
        area.appendChild(el("div", "field-label", mode.value === "existing" ? "Which survey" : "Attach to survey")); area.appendChild(surveySel);
        subj = el("input", "input"); subj.placeholder = "Email subject"; subj.value = cfg.subject || ""; area.appendChild(el("div", "field-label", "Invite subject")); area.appendChild(subj);
        const cHost = el("div", "u-mt-8"); area.appendChild(cHost);
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
      if (errors && errors.length) { banner.classList.remove("u-hidden"); banner.innerHTML = `<div class="dr-banner-title">This drip can't run yet:</div><ul class="dr-banner-list">` + (errors.map((e) => `<li>${esc(e.message)}</li>`).join("")) + `</ul>`; }
      else { banner.classList.add("u-hidden"); banner.innerHTML = ""; }
    }
    function clearErrors() { state.errorsByNode = {}; banner.classList.add("u-hidden"); banner.innerHTML = ""; state.nodes.forEach(renderNode); }

    // ---- Save / toggle ----
    function serialize() { return { nodes: state.nodes.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, config: n.config || {} })), edges: state.edges.map((e) => e.branch ? ({ source: e.source, target: e.target, branch: e.branch }) : ({ source: e.source, target: e.target })) }; }
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
        if (state.enabled) { const d = await App.portalApi("/api/drips/" + drip.id + "/deactivate", { method: "POST" }); state.enabled = !!d.enabled; clearErrors(); paintStatus(); toast("Drip turned off"); }
        else { await doSave(); const d = await App.portalApi("/api/drips/" + drip.id + "/activate", { method: "POST" }); state.enabled = !!d.enabled; clearErrors(); paintStatus(); toast("Drip is on — it now runs through your automations."); }
      } catch (e) { const errs = (e && e.data && e.data.errors) || (e && e.errors) || null; if (errs) showErrors(errs); else toast(e.message || "Couldn't change status", true); }
      finally { toggleBtn.disabled = false; }
    };

    // Initial paint
    applyView(); state.nodes.forEach(renderNode); renderEdges(); renderConfig(); paintStatus();

    // Test hook
    canvas.__dripTest = {
      addNode, addEdge, state, serialize, showErrors,
      moveNode: (id, x, y) => { const c = surface.querySelector(`[data-node-id="${id}"]`); if (c && c._moveTo) c._moveTo(x, y); },
      selectNode, save: doSave, toggle: () => toggleBtn.onclick(), edgeCount: () => edgeLayer.querySelectorAll("path[data-edge]").length,
      getView: () => ({ ...state.view }), zoomIn: () => zIn.onclick(), zoomOut: () => zOut.onclick(), fit: fitView,
      pathFor: (s, t) => { const p = edgeLayer.querySelector(`path[data-edge="${s}>${t}"]`); return p ? p.getAttribute("d") : null; },
    };
  }

  function defaultConfig(type) {
    if (type === "wait") return { amount: 1, unit: "days" };
    if (type === "enroll_audience" || type === "enroll") return { audienceIds: [] };
    if (type === "enroll_condition" || type === "unenroll" || type === "branch") return { rules: [] };
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
      case "branch": return (c.rules && c.rules.length) ? `${c.rules.length} rule${c.rules.length === 1 ? "" : "s"}` : "set a condition";
      case "send_email": return c.mode === "template" ? (c.templateId ? "template" : "pick a template") : (c.subject ? c.subject : "from scratch");
      case "send_survey": return c.surveyId ? "survey chosen" : (c.mode === "scratch" ? "compose invite" : "pick a survey");
      default: return "";
    }
  }

  App.drips = { renderLibrary, openEditor, openDripById, NODE_META, _defaultConfig: defaultConfig, _nodeSummary: nodeSummary };
})(window);
