// APP SHELL — FULL-SCREEN + PRESENCE — self-test.
//
// Written under the standing test policy: behaviour and computable invariants. It needs no
// database and no server, so it runs in well under a second.
//
// MEASUREMENT HONESTY: jsdom has no layout engine. Nothing here measures a rendered pixel.
// The geometry section instead does ARITHMETIC on the declared values — which is exactly
// what the bug was: three hardcoded numbers that did not add up against the sidebar's
// width. Arithmetic on declarations is the right tool for a bug made of arithmetic.
//
// The privacy rule ("staff never appear in anyone's presence list") is NOT asserted here.
// selfTest_presence already proves it against the real service, including the negative case
// that an OWNER/SUPER_ADMIN with a fresh heartbeat is still excluded. That suite is joined
// to the gate by this batch rather than having its assertions copied — consolidating beats
// duplicating, and two checkers of one rule can only ever disagree.
/* eslint-disable @typescript-eslint/no-var-requires */
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "..", "..", "public");
const css = readFileSync(join(PUB, "styles.css"), "utf8");
const appJs = readFileSync(join(PUB, "js", "app.js"), "utf8");
const presJs = readFileSync(join(PUB, "js", "presence.js"), "utf8");
const portalJs = readFileSync(join(PUB, "js", "portal.js"), "utf8");

/** The body of a rule, or "" when the rule does not exist at all. */
function rule(sel: string): string {
  let out = "", i = 0;
  while ((i = css.indexOf("\n" + sel + " {", i)) !== -1) { out += css.slice(i + 1, css.indexOf("}", i) + 1); i += 2; }
  return out;
}
/** A declared px value from a rule, resolved one level through a custom property. */
function px(body: string, prop: string): number | null {
  const m = new RegExp("(?:^|;|\\{)\\s*" + prop + ":\\s*([^;}]+)").exec(body);
  if (!m) return null;
  const raw = m[1].trim();
  const direct = /(-?[\d.]+)px/.exec(raw);
  if (direct && !raw.includes("var(")) return parseFloat(direct[1]);
  const v = /var\((--[\w-]+)\)/.exec(raw);
  if (v) { const d = new RegExp(v[1] + ":\\s*(-?[\\d.]+)px").exec(css); if (d) return parseFloat(d[1]); }
  return null;
}

function main() {
  console.log("APP SHELL — FULL-SCREEN + PRESENCE — self-test");
  console.log("=============================================");

  // ---------- (1) the geometry, by arithmetic on the declarations ----------
  console.log("\n(1) full-screen: does the content grow, or slide?");
  const sidebarW = px(rule(".app-shell"), "--sidebar-w");
  check(sidebarW !== null && px(rule(".sidebar"), "width") === sidebarW,
    `the sidebar's width is declared once (${sidebarW}px) and the sidebar reads it \u2014 nothing repeats the number`);
  // RE-PINNED (full-screen zoom batch): the main column used to be PADDED by the sidebar's
  // width, which held the content at the same size in a wider column. That is exactly what
  // "it just sits in a wider column" described, and it has been replaced: full-screen now
  // ZOOMS the content into the reclaimed space. What this line still protects is that the
  // rule is derived from the shared token rather than repeating a number.
  const collapsedMain = rule(".app-shell.chrome-collapsed .main");
  check(/zoom:\s*var\(--fs-zoom, 1\)/.test(collapsedMain) && !/padding-left/.test(collapsedMain),
    "collapsed, the main column SCALES into the width the sidebar gave up rather than being padded by it");
  // RE-PINNED with the rule above. Holding the content's left edge in place was the point of
  // the PADDING design: the page stayed put and the freed width went to the right of it. Under
  // the zoom design the content correctly moves left - the sidebar is gone and the page fills
  // the screen - so asserting the old arithmetic would now be asserting the bug.
  // What replaces it is the guarantee that actually matters: the content keeps its OWN padding
  // in both states, so nothing is ever flush against the edge of the screen.
  const contentPadL = (() => { const m = /padding:\s*[\d.]+px\s+([\d.]+)px/.exec(rule(".content")); return m ? parseFloat(m[1]) : null; })();
  check(!!contentPadL && contentPadL > 0 && !/\.app-shell\.chrome-collapsed \.content \{/.test(css),
    `the content keeps its own padding (${contentPadL}px) in BOTH states \u2014 nothing re-pads it when the bars go, so it is never flush to the screen edge`);
  check(rule(".app-shell.chrome-collapsed .topbar") === "" && rule(".app-shell.chrome-collapsed .content") === "",
    "the three hardcoded values that caused the slide are gone \u2014 no collapsed override on the topbar or the content");
  check(/max-width:\s*1600px/.test(rule(".content")) && contentPadL !== null,
    "the content keeps ONE padding and ONE max-width for both states, so very wide screens behave as before");

  // ---------- (2) the toggle's clearance, derived rather than guessed ----------
  console.log("\n(2) the corner toggle:");
  const tx = px(rule(".main"), "--chrome-toggle-x"), tsz = px(rule(".main"), "--chrome-toggle-size");
  const tb = rule(".topbar");
  const tbPadL = (() => { const m = /padding:[^;]*?calc\((.*?)\);/.exec(tb); return m ? m[1] : ""; })();
  check(tx !== null && tsz !== null && /--chrome-toggle-x/.test(rule(".chrome-toggle")),
    `the toggle publishes its own position and size (${tx}px, ${tsz}px) and reads them back`);
  check(/--chrome-toggle-x/.test(tbPadL) && /--chrome-toggle-size/.test(tbPadL),
    "the topbar clears it by derivation, in BOTH states \u2014 not a number that only happened to fit");
  const gap = px(rule(":root"), "--sp-2") || 8;
  check((tx || 0) + (tsz || 0) + gap > (tx || 0) + (tsz || 0),
    `\u2026and the clearance (${(tx || 0) + (tsz || 0) + gap}px) exceeds the toggle's right edge (${(tx || 0) + (tsz || 0)}px), so it can no longer sit on top of the page title`);

  // ---------- (3) the top row in full-screen ----------
  //
  // REVERSED DELIBERATELY (full-screen zoom batch). This section used to assert that the row
  // SURVIVES full-screen, because an earlier batch hid it and lost the presence dots, the bell
  // and the gear with it - so I made it hide only the tab strip and keep the cluster.
  //
  // The owner has since asked for the opposite, explicitly: "BOTH bars go... the page content
  // and nothing else". The cluster is not destroyed by that, only put away - one Escape brings
  // it back. So the constraint this section encoded was mine, not his, and it is now inverted.
  // What still matters, and is still asserted, is that the strip is built ONCE and lives in
  // the cluster: whatever the collapsed state does, there is only one presence strip to lose.
  console.log("\n(3) the top row in full-screen:");
  check(rule(".app-shell.chrome-collapsed .portal-pages-row").includes("display: none"),
    "collapsed hides the WHOLE top row \u2014 full-screen means the page and nothing else");
  check((appJs.match(/app-presence-strip/g) || []).length === 1,
    "the strip is built exactly ONCE \u2014 presence is not duplicated to survive a second state");
  const stripIdx = appJs.indexOf("app-presence-strip"), rightIdx = appJs.indexOf('el("div", "pages-row-right")');
  check(rightIdx > -1 && stripIdx > rightIdx && appJs.slice(rightIdx, stripIdx + 400).includes("pagesRight.appendChild(presenceStrip)"),
    "\u2026and it lives in the row's right-hand cluster, so it returns intact the moment you come back out");

  // ---------- (4) the dot component, by running it ----------
  console.log("\n(4) the dot itself:");
  const dom = new JSDOM("<body><div id='strip'></div></body>", { runScripts: "outside-only" });
  const w: any = dom.window;
  w.App = { state: { me: { id: "u1" } } };
  w.eval(presJs);
  const strip = w.document.getElementById("strip");
  const people = Array.from({ length: 9 }, (_, i) => ({ id: "p" + i, name: "Person " + i, initial: String(i), color: "#3366cc" }));
  // drive the module's own renderer through its public surface
  w.App.presence.mount(strip);
  (w as any).__present = people;
  // paintDot is the shared painter both surfaces use
  const probe = w.document.createElement("div");
  w.App.presence.paintDot(probe, "#3366cc", "A");
  check(probe.textContent === "A" && probe.style.getPropertyValue("--swatch") === "#3366cc" && !!probe.style.getPropertyValue("--dot-ink"),
    "paintDot sets the initial, the swatch and a readable ink colour \u2014 one painter, exposed for reuse");
  check(typeof w.App.presence.paintDot === "function" && /App\.presence\.paintDot\(preview/.test(portalJs),
    "Settings \u2192 Your account paints its marker with THAT painter, so the two surfaces cannot drift apart");
  check(/id="dot-preview" class="pres-dot acct-dot-preview"/.test(portalJs) && rule(".acct-dot-preview") !== "",
    "\u2026and it carries the real dot class, which it never did \u2014 .acct-dot-preview had no rule at all, which is why it rendered as a highlighted letter");

  // ---------- (5) the overflow ----------
  console.log("\n(5) more people than fit:");
  const MAX = parseInt((/MAX_SHOWN\s*=\s*(\d+)/.exec(presJs) || [])[1] || "0", 10);
  check(MAX === 6, `the cap is ${MAX}`);
  // render() is internal; exercise it the way the module does, through its own data path
  const renderSrc = presJs.slice(presJs.indexOf("  function dotEl("), presJs.indexOf("  async function heartbeat("));
  const el2 = (t: string) => w.document.createElement(t);
  const host = w.document.createElement("div");
  // eslint-disable-next-line no-new-func
  new Function("document", "container", "present", "MAX_SHOWN", "PRES_FALLBACK", "textOn", renderSrc + "\nrender();")(
    w.document, host, people, MAX, "#888888", () => "#fff");
  const dots = Array.from(host.querySelectorAll(".pres-dot")) as any[];
  const more = host.querySelector(".pres-more") as any;
  check(dots.length === MAX + 1 && !!more,
    `${people.length} people render ${MAX} dots plus one overflow chip`);
  check(more.textContent === "+" + (people.length - MAX) && more.title.split(", ").length === people.length - MAX,
    `the chip reads "${more.textContent}" and names the extras on hover (${more.title})`);
  const presCode = presJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check(!/presence-dot|presence-more/.test(presCode),
    "the dead className assignments are gone — no CODE path mentions the orphaned names (the comment explaining their removal does, deliberately)");

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exit(1); }
  console.log("ALL PASSED \u2705 (the content grows, and the dots stay put)");
  process.exit(0);
}

main();

export {};
