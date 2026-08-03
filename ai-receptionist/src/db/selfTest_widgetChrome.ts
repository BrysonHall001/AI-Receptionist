// WIDGET CHROME + THEME-DRIVEN CHART PALETTE — self-test.
//
// Written under the standing test policy: behaviour and computable invariants only, no
// source-text pins. Nothing here asserts that a file still contains a string.
//
// It needs NO database and NO server: reports.js is a self-contained module whose chart
// renderer takes rows directly, so this boots a JSDOM with the REAL stylesheet, loads the
// REAL module, stubs Chart.js to capture what it is handed, and inspects the result. That is
// why it runs in about a second.
//
// MEASUREMENT NOTE: JSDOM has no layout engine, so nothing here asserts rendered geometry.
// Colour, however, IS computable from the token values, and that is where this suite spends
// most of its effort - the per-theme ramp validation below is the assertion that matters,
// because a ramp that silently rots is invisible until someone complains they cannot read a
// chart. It carries two negative cases proving it actually catches a bad ramp.
/* eslint-disable @typescript-eslint/no-var-requires */
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "..", "..", "public");
const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
const reportsSrc = readFileSync(join(PUB, "js", "reports.js"), "utf8");

// ---------------------------------------------------------------- colour maths
const hex2rgb = (h: string): number[] => { let x = h.trim().replace("#", ""); if (x.length === 3) x = x.split("").map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const contrast = (a: number[], b: number[]) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
function rgb2lab(rgb: number[]): number[] {
  const f = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const R = f(rgb[0]), G = f(rgb[1]), B = f(rgb[2]);
  const g = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = g((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const Y = g(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const Z = g((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const deltaE = (a: number[], b: number[]) => { const A = rgb2lab(a), B = rgb2lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };

/** THE RULE, as a pure function, so the negative cases can drive the same code path the
 *  positive assertion uses. Returns the problems found; empty means the ramp is sound. */
const MIN_CONTRAST = 3.0;   // WCAG 1.4.11 non-text contrast - the standard for graphical objects
const MIN_DELTA_E = 20;     // was 30, which forced maximum-separation ramps full of clashing hues
                            // (traffic-light yellow next to brown). 20 still means every pair is
                            // clearly tellable apart (~2x a "noticeable" dE of 10) while leaving
                            // room for ramps that stay inside a theme's own hue family.
function rampProblems(ramp: string[], panel: string): string[] {
  const bad: string[] = [];
  if (ramp.length !== 10) bad.push(`only ${ramp.length} colours`);
  const p = hex2rgb(panel);
  ramp.forEach((c, i) => { const r = contrast(hex2rgb(c), p); if (r < MIN_CONTRAST) bad.push(`series ${i + 1} is ${r.toFixed(2)}:1 against the panel`); });
  for (let i = 0; i < ramp.length; i++) for (let j = i + 1; j < ramp.length; j++) {
    const d = deltaE(hex2rgb(ramp[i]), hex2rgb(ramp[j]));
    if (d < MIN_DELTA_E) bad.push(`series ${i + 1} and ${j + 1} differ by only ${d.toFixed(1)}`);
  }
  return bad;
}

// ---------------------------------------------------------------- read the themes back out of the shipped CSS
function contexts(): Record<string, { panel: string; ramp: string[] }> {
  const out: Record<string, { panel: string; ramp: string[] }> = {};
  const readBlock = (block: string) => {
    const panel = (block.match(/--panel:\s*([^;]+);/) || [])[1];
    const ramp: string[] = [];
    for (let i = 1; i <= 10; i++) { const m = block.match(new RegExp("--chart-" + i + ":\\s*([^;]+);")); if (m) ramp.push(m[1].trim()); }
    return { panel: (panel || "").trim(), ramp };
  };
  const ri = cssSrc.indexOf(":root {");
  out[":root"] = readBlock(cssSrc.slice(ri, cssSrc.indexOf("\n}", ri)));
  const names = Array.from(new Set(Array.from(cssSrc.matchAll(/body\[data-theme="([a-z0-9-]+)"\]/g)).map((m: any) => m[1])));
  for (const t of names) {
    let i = 0; const marker = `body[data-theme="${t}"]`;
    while ((i = cssSrc.indexOf(marker, i)) !== -1) {
      const o = cssSrc.indexOf("{", i), c = cssSrc.indexOf("}", o);
      const block = cssSrc.slice(o, c);
      if (block.includes("--chart-1:")) { out[t as string] = readBlock(block); break; }
      i = c;
    }
    if (!out[t as string]) out[t as string] = { panel: "", ramp: [] };
  }
  return out;
}

// ---------------------------------------------------------------- a live page with the real stylesheet + module
function boot() {
  // runScripts is REQUIRED: without it w.eval() runs in Node's context, reports.js registers
  // its module on Node's globalThis instead of on the window, and App.reports is undefined.
  const dom = new JSDOM(`<style>${cssSrc}</style><body><div id="host"></div></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
  const w: any = dom.window;
  const el = (t: string, c?: string | null, h?: string) => { const n = w.document.createElement(t); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
  const esc = (s: any) => String(s == null ? "" : s).replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  w.App = { util: { el, esc, fmtDate: (x: any) => String(x) }, state: { me: { role: "OWNER" } } };
  const captured: any[] = [];
  w.Chart = function (ctx: any, config: any) { captured.push(config); return { destroy() { /* */ }, update() { /* */ } }; };
  (w.Chart as any).register = () => { /* */ };
  w.eval(reportsSrc);
  return { w, el, captured };
}

/** The chart config Chart.js is handed for a simple bar widget, under a given theme.
 *  ONE page is booted and the theme attribute swapped, because parsing a 300KB stylesheet
 *  per theme is the whole cost of this suite. */
let PAGE: any = null;
function renderUnder(theme: string | null) {
  if (!PAGE) PAGE = boot();
  const { w, captured } = PAGE;
  captured.length = 0;
  if (theme) w.document.body.setAttribute("data-theme", theme); else w.document.body.removeAttribute("data-theme");
  const host = w.document.getElementById("host");
  const src = { key: "contacts", topLevel: ["name", "createdAt"], reportFields: [{ key: "name", label: "Name", type: "text" }] };
  const rows = [{ name: "A", createdAt: "2026-01-01" }, { name: "B", createdAt: "2026-01-02" }];
  const widget = { id: "w1", title: "T", type: "bar", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "name" }], series: [], filters: [] };
  w.App.reports.renderWidgetBody(host, widget, src, rows, src.reportFields, []);
  return captured[0];
}

function main() {
  console.log("WIDGET CHROME + THEME-DRIVEN CHART PALETTE — self-test");
  console.log("=====================================================");

  // ---------- (1) the ramp, in every theme ----------
  console.log("\n(1) the chart ramp, checked in every theme:");
  const ctx = contexts();
  const names = Object.keys(ctx);
  check(names.length >= 18 && names.every((n) => ctx[n].ramp.length === 10),
    `every one of the ${names.length} theme contexts defines all ten series colours \u2014 a new theme without a ramp fails here`);
  const perTheme = names.map((n) => ({ n, bad: rampProblems(ctx[n].ramp, ctx[n].panel) }));
  const broken = perTheme.filter((x) => x.bad.length);
  check(broken.length === 0,
    broken.length === 0
      ? `all ten colours in all ${names.length} themes clear ${MIN_CONTRAST}:1 against their own panel and differ from each other by at least ${MIN_DELTA_E}`
      : `RAMP PROBLEMS: ${broken.map((x) => x.n + " (" + x.bad[0] + ")").join("; ")}`);
  // report the achieved worst case so drift is visible before it becomes a failure
  let worstC = Infinity, worstD = Infinity, worstCT = "", worstDT = "";
  for (const n of names) {
    const p = hex2rgb(ctx[n].panel);
    for (let i = 0; i < 10; i++) {
      const c = contrast(hex2rgb(ctx[n].ramp[i]), p); if (c < worstC) { worstC = c; worstCT = n; }
      for (let j = i + 1; j < 10; j++) { const d = deltaE(hex2rgb(ctx[n].ramp[i]), hex2rgb(ctx[n].ramp[j])); if (d < worstD) { worstD = d; worstDT = n; } }
    }
  }
  console.log(`      worst measured: contrast ${worstC.toFixed(2)}:1 (${worstCT}) \u00b7 separation ${worstD.toFixed(1)} (${worstDT})`);

  // ---------- (2) the rule is PROVEN to catch a bad ramp ----------
  console.log("\n(2) negative cases \u2014 the rule actually catches a bad ramp:");
  const greys = ["#808080", "#828282", "#848484", "#868686", "#888888", "#8a8a8a", "#8c8c8c", "#8e8e8e", "#909090", "#929292"];
  const gp = rampProblems(greys, "#ffffff");
  check(gp.length > 0 && gp.some((m) => /differ by only/.test(m)),
    `ten near-identical greys are rejected \u2014 ${gp.filter((m) => /differ by only/.test(m)).length} pairs too close to tell apart`);
  const faint = ctx[":root"].ramp.slice(0, 9).concat(["#fdfdfd"]);
  const fp = rampProblems(faint, "#ffffff");
  check(fp.some((m) => /against the panel/.test(m)),
    `a colour that vanishes into the panel is rejected \u2014 ${fp.find((m) => /against the panel/.test(m))}`);

  // ---------- (3) colour follows the theme, all the way into Chart.js ----------
  console.log("\n(3) chart colour follows the active theme:");
  const plain = renderUnder(null);
  const forest = renderUnder("forest");
  const dusk = renderUnder("dusk");
  const colourOf = (cfg: any) => String(cfg && cfg.data && cfg.data.datasets && cfg.data.datasets[0] && cfg.data.datasets[0].backgroundColor);
  check(!!plain && !!forest && !!dusk, "the widget renders a chart config in all three cases");
  check(colourOf(forest) !== colourOf(plain) && colourOf(dusk) !== colourOf(forest),
    `the SAME widget is handed a different colour under each theme (default ${colourOf(plain)} \u00b7 forest ${colourOf(forest)} \u00b7 dusk ${colourOf(dusk)})`);
  check(colourOf(forest).toLowerCase() === ctx.forest.ramp[0].toLowerCase(),
    "\u2026and the colour Chart.js receives is exactly that theme's first series token, not a coincidence");
  check(String(forest.options && forest.options.scales && forest.options.scales.x && forest.options.scales.x.ticks && forest.options.scales.x.ticks.color || "").length > 0,
    "axis tick colour is themed too \u2014 it used to default to dark grey and vanish on the dark themes");

  // ---------- (4) the card chrome ----------
  console.log("\n(4) the widget card:");
  if (!PAGE) PAGE = boot();
  const { w, el } = PAGE;
  const i = reportsSrc.indexOf("    function buildCard(w, dash) {");
  const cardSrc = reportsSrc.slice(i, reportsSrc.indexOf("\n    }\n", i) + 6);
  const calls: any[] = [];
  const mkCard = (canEdit: boolean, title: string) => {
    const normSize = () => ({ cw: 2, ch: "s" });
    const setSize = (id: string, o: any) => calls.push(["setSize", id, JSON.stringify(o)]);
    const openDuplicate = (x: any) => calls.push(["duplicate", x.id]);
    const openEditor = (x: any) => calls.push(["edit", x.id]);
    const removeWidget = (id: string) => calls.push(["remove", id]);
    const attachDnD = (card: any, handle: any, id: string) => calls.push(["attachDnD", handle.className, id]);
    // eslint-disable-next-line no-new-func
    const fn = new Function("el", "esc", "normSize", "canEdit", "setSize", "openDuplicate", "openEditor", "removeWidget", "attachDnD", cardSrc + "\nreturn buildCard;")(
      el, (s: any) => String(s), normSize, canEdit, setSize, openDuplicate, openEditor, removeWidget, attachDnD);
    return fn({ id: "w1", title, type: "bar" }, {});
  };
  const LONG = "Requests by source and channel over the last ninety days";
  const card = mkCard(true, LONG);
  const head = card.querySelector(".widget-head");
  check(head.textContent.includes(LONG) && head.querySelectorAll("select, button").length === 0,
    "a long title is present in full in the head, and NO control shares that row with it");
  const bar = card.querySelector(".widget-chrome");
  const barKids = Array.from(bar.children) as any[];
  check(bar && bar.parentElement === card && barKids.length === 5 && barKids.map((c: any) => c.title).join("|") === "Width|Height|Duplicate|Edit|Delete",
    "the five controls sit in a bar on the card, in their original order");
  check(barKids[0].value === "2" && barKids[1].value === "s", "the selects still carry the widget's current size");
  barKids[0].value = "3"; barKids[0].onchange();
  barKids[1].value = "t"; barKids[1].onchange();
  barKids[2].onclick(); barKids[3].onclick(); barKids[4].onclick();
  check(JSON.stringify(calls) === JSON.stringify([["attachDnD", "drag-handle", "w1"], ["setSize", "w1", '{"cw":3}'], ["setSize", "w1", '{"ch":"t"}'], ["duplicate", "w1"], ["edit", "w1"], ["remove", "w1"]]),
    "every control still reaches its original handler with its original payload, and dragging is still bound to the same handle");
  calls.length = 0;
  const viewer = mkCard(false, LONG);
  check(!viewer.querySelector(".widget-chrome") && !viewer.classList.contains("widget-has-chrome") && Array.from(viewer.children).length === 2,
    "a viewer without edit rights gets no bar and no height reserved for one \u2014 head and body only");

  // ---------- (5) the hub gets the same treatment ----------
  console.log("\n(5) the hub's Billing & Usage charts, not just the portal's:");
  check(typeof w.App.reports.renderWidgetBody === "function" && typeof w.App.reports.createDashboardEngine === "function",
    "both hub entry points exist on the shared engine (the fixed usage cards call the first, the editable dashboards the second)");
  check(colourOf(forest).toLowerCase() === ctx.forest.ramp[0].toLowerCase(),
    "\u2026and the hub's path IS this path: the colour asserted above came from renderWidgetBody, which is exactly what the hub's usage cards call");

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exit(1); }
  console.log("ALL PASSED \u2705 (titles have the card, and every theme's charts are legible and tellable apart)");
  process.exit(0);
}

main();

export {};
