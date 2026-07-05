// Headless (jsdom) canvas self-test for the Drips builder (slice 3).  node src/db/selfTest_dripsCanvas.js
// Headless (jsdom) check of the slice-3 Drips canvas: branch node with two labeled handles, branch
// edges + labels, pan/zoom transform, connectors tracking node moves, and branch round-trip.
const fs = require("fs");
const { JSDOM } = require("jsdom");
const dom = new JSDOM(`<!doctype html><html><body><div id="host"></div></body></html>`, { pretendToBeVisual: true });
const { window } = dom;
global.window = window; global.document = window.document; global.navigator = window.navigator;

let fails = 0;
function check(c, l) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }

// ---- Minimal App stubs (drips.js reads window.App) ----
function el(tag, cls, text) { const e = window.document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
window.App = {
  util: { el, esc: (s) => String(s == null ? "" : s), toast: () => {}, fmtDate: () => "now", $$: (sel, root) => Array.from((root || window.document).querySelectorAll(sel)) },
  portalApi: async () => [],
  table: { ruleEditor: (cols, rows, rules, onChange) => { const d = el("div", "rule-editor"); d._rules = rules; return d; } },
  portal: { contactColumnDefs: () => [] },
  audienceSelect: { mount: (host, opts) => ({ getSelectedIds: () => (opts && opts.selectedIds) || [] }) },
  compose: { mount: () => ({ getHTML: () => "", setHTML: () => {} }) },
  ui: { promptModal: async () => "x", confirmModal: async () => true },
  relabelText: (s) => s,
  go: () => {},
};

// Load drips.js into the window scope
const src = fs.readFileSync(process.argv[2] || __dirname + "/../../public/js/drips.js", "utf8");
window.eval(src);
check(!!(window.App.drips && window.App.drips.openEditor), "drips.js registered App.drips.openEditor");

const host = window.document.getElementById("host");
window.App.drips.openEditor(host, { id: "d1", name: "Test Drip", enabled: false, graph: { nodes: [], edges: [] } });
const canvas = host.querySelector('[data-drip-canvas]');
check(!!canvas, "canvas mounted");
const T = canvas.__dripTest;
check(!!T, "test hook exposed");

// ---- Build a branched graph programmatically ----
const trig = T.addNode("enroll_audience", 40, 40);
const br = T.addNode("branch", 40, 200);
const eIf = T.addNode("send_email", 300, 260);
const eElse = T.addNode("send_email", 300, 60);
check(T.state.nodes.length === 4, "4 nodes added");

// trigger renders as a CIRCLE (border-radius 50%), action as a card
const trigEl = canvas.querySelector(`[data-node-id="${trig.id}"]`);
const eIfEl = canvas.querySelector(`[data-node-id="${eIf.id}"]`);
check(/border-radius:\s*50%/.test(trigEl.getAttribute("style") || ""), "trigger node renders as a circle");
check(/border-radius:\s*12px/.test(eIfEl.getAttribute("style") || ""), "action node renders as a rounded card");

// branch node has TWO labeled output handles (if + otherwise)
const brEl = canvas.querySelector(`[data-node-id="${br.id}"]`);
const outs = brEl.querySelectorAll('.drip-h-out');
check(outs.length === 2, "branch node has two output handles");
const labels = Array.from(outs).map((o) => o.dataset.branch).sort().join(",");
check(labels === "if,otherwise", "branch handles labeled 'if' and 'otherwise'");
// non-branch action node has exactly one output handle
check(eIfEl.querySelectorAll('.drip-h-out').length === 1, "action node has a single output handle");

// ---- Edges + labels ----
check(T.addEdge(trig.id, br.id) === true, "trigger -> branch edge added");
check(T.addEdge(br.id, eIf.id, "if") === true, "branch -If-> email(if) edge added");
check(T.addEdge(br.id, eElse.id, "otherwise") === true, "branch -Otherwise-> email(else) edge added");
// guards
check(T.addEdge(br.id, eIf.id, "if") === false, "a second 'If' path is rejected");
const extra = T.addNode("wait", 500, 300);
check(T.addEdge(trig.id, extra.id) === false, "a non-branch node rejects a 2nd outgoing edge");
check(T.edgeCount() === 3, "exactly 3 edges rendered");

// branch edges are labeled with If / Otherwise text in the SVG
const svgText = Array.from(canvas.querySelectorAll('svg text')).map((t) => t.textContent);
check(svgText.includes("If"), "an 'If' label is drawn on the branch edge");
check(svgText.includes("Otherwise"), "an 'Otherwise' label is drawn on the branch edge");
// arrowhead marker exists + edges reference it
check(!!canvas.querySelector('marker#drip-arrow'), "arrowhead marker defined");
check(!!canvas.querySelector('path[marker-end]'), "edges use the arrowhead marker");

// ---- Connectors track node moves ----
const before = T.pathFor(br.id, eIf.id);
T.moveNode(eIf.id, 420, 380);
const after = T.pathFor(br.id, eIf.id);
check(!!before && !!after && before !== after, "connector path updates when its target node moves");

// ---- Pan / zoom ----
const v0 = T.getView();
T.zoomIn();
const v1 = T.getView();
check(v1.scale > v0.scale, "zoom in increases scale");
T.zoomOut(); T.zoomOut();
check(T.getView().scale < v1.scale, "zoom out decreases scale");
T.fit();
const vf = T.getView();
check(typeof vf.scale === "number" && vf.scale > 0 && isFinite(vf.tx) && isFinite(vf.ty), "fit-to-view yields a finite, positive-scale view");
// node model coords are unaffected by view changes (pan/zoom is a surface transform only)
check(eElse.x === 300 && eElse.y === 60, "node model coordinates unchanged by pan/zoom");

// ---- Serialize round-trips branch edges + labels ----
const ser = T.serialize();
const ifEdge = ser.edges.find((e) => e.source === br.id && e.target === eIf.id);
const elseEdge = ser.edges.find((e) => e.source === br.id && e.target === eElse.id);
check(ifEdge && ifEdge.branch === "if", "serialized 'if' edge keeps its branch label");
check(elseEdge && elseEdge.branch === "otherwise", "serialized 'otherwise' edge keeps its branch label");
const plain = ser.edges.find((e) => e.source === trig.id && e.target === br.id);
check(plain && plain.branch === undefined, "non-branch edge serialized without a branch label");
check(ser.nodes.length === 5 && ser.nodes.every((n) => typeof n.x === "number" && typeof n.y === "number"), "nodes serialize with numeric positions");

// ---- Reopen: branch edges + labels restore ----
host.innerHTML = "";
window.App.drips.openEditor(host, { id: "d1", name: "Test Drip", enabled: false, graph: ser });
const canvas2 = host.querySelector('[data-drip-canvas]');
const T2 = canvas2.__dripTest;
check(T2.state.edges.filter((e) => e.branch === "if").length === 1 && T2.state.edges.filter((e) => e.branch === "otherwise").length === 1, "reopened drip restores both labeled branch edges");
check(T2.edgeCount() === 3, "reopened drip re-renders all 3 connectors");

console.log(`\nRESULT: ${fails === 0 ? "ALL PASSED \u2705" : fails + " FAILED \u274c"} (canvas jsdom)`);
process.exit(fails ? 1 : 0);
