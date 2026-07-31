process.env.AI_PROVIDER = "mock";

// HELP TIPS — self-test.
//
// The assertion that matters most is KEYBOARD REACH. A hover-only tip is invisible to anyone
// who does not use a mouse, and that is a large number of people; it is also the easiest thing
// to get wrong, because a tip built on hover looks perfect to the person who built it.
//
// WHAT THIS SUITE CANNOT DO, said plainly rather than faked: jsdom has no layout engine, so
// "opening a tip shifts nothing" cannot be measured in pixels here. What IS asserted is the
// structural guarantee that makes it true - the panel is absolutely positioned inside the
// marker's own wrapper, so it is out of flow and cannot push anything. That is a real check
// on a real rule, and it is labelled as such rather than dressed up as a pixel measurement.
/* eslint-disable @typescript-eslint/no-var-requires */
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { JSDOM } = require("jsdom");

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const R = resolvePath(__dirname, "..", "..");
const TIPS_SRC = readFileSync(resolvePath(R, "public", "js", "tips.js"), "utf8");
const CSS = readFileSync(resolvePath(R, "public", "styles.css"), "utf8");
const PLACED_IN = ["admin.js", "portal.js", "app.js"];

/** tips.js in a window, with a Learning Center tree the caller controls. */
function boot(guides?: any) {
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" }).window;
  (globalThis as any).document = w.document; (globalThis as any).window = w;
  w.App = guides === undefined ? {} : { learn: { activeGuides: () => guides } };
  new Function("window", "App", TIPS_SRC)(w, w.App);
  return { w, App: w.App };
}
const FULL_TREE = [{ cat: "Admin", items: [{ id: "modules-fields" }, { id: "invite-team" }, { id: "receptionist-setup" }] }];

async function main() {
  console.log("HELP TIPS \u2014 self-test");
  console.log("=====================");
  const { w, App } = boot(FULL_TREE);
  const ids: string[] = App.tips.tipIds();

  // ---------- (1) keyboard reach ----------
  console.log("\n(1) reachable and readable by keyboard alone:");
  let notButton: string[] = [];
  let noEnter: string[] = [];
  let noEscape: string[] = [];
  let noLabel: string[] = [];
  for (const id of ids) {
    const node = App.tips.tip(id);
    w.document.body.appendChild(node);
    const btn = node.querySelector(".tip-mark");
    if (!btn || btn.tagName !== "BUTTON") { notButton.push(id); continue; }
    if (!/What is this/.test(btn.getAttribute("aria-label") || "")) noLabel.push(id);
    App.tips.closeAll();
    btn.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    if (!node.querySelector(".tip-panel")) noEnter.push(id);
    btn.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (node.querySelector(".tip-panel")) noEscape.push(id);
  }
  check(notButton.length === 0, `every tip's marker is a real <button>, so Tab reaches it (${ids.length} checked)${notButton.length ? " \u2014 " + notButton.join(", ") : ""}`);
  check(noEnter.length === 0, `every tip OPENS on Enter with no mouse involved${noEnter.length ? " \u2014 " + noEnter.join(", ") : ""}`);
  check(noEscape.length === 0, `every tip CLOSES on Escape${noEscape.length ? " \u2014 " + noEscape.join(", ") : ""}`);
  check(noLabel.length === 0, `every marker carries an aria-label naming what it explains${noLabel.length ? " \u2014 " + noLabel.join(", ") : ""}`);
  // Space as well as Enter, since a button must honour both
  App.tips.closeAll();
  const spaceNode = App.tips.tip(ids[0]); w.document.body.appendChild(spaceNode);
  spaceNode.querySelector(".tip-mark").dispatchEvent(new w.KeyboardEvent("keydown", { key: " ", bubbles: true }));
  check(!!spaceNode.querySelector(".tip-panel"), "\u2026and Space opens one too, as a button must");
  // NEGATIVE: prove the keyboard checks are not passing because everything opens regardless
  App.tips.closeAll();
  const inert = App.tips.tip(ids[0]); w.document.body.appendChild(inert);
  inert.querySelector(".tip-mark").dispatchEvent(new w.KeyboardEvent("keydown", { key: "a", bubbles: true }));
  check(!inert.querySelector(".tip-panel"), "NEGATIVE: an unrelated key does NOT open a tip, so the checks above mean something");

  // ---------- (2) every placement resolves ----------
  console.log("\n(2) the registry and its placements:");
  const wired = new Set<string>();
  const wrongIds: string[] = [];
  for (const f of PLACED_IN) {
    const src = readFileSync(resolvePath(R, "public", "js", f), "utf8");
    for (const m of src.matchAll(/App\.tips\.(?:attach|tip)\([^,)]*,?\s*"(\w+)"/g)) {
      wired.add(m[1]);
      if (ids.indexOf(m[1]) === -1) wrongIds.push(`${f}:${m[1]}`);
    }
  }
  check(wrongIds.length === 0,
    `every placement in the app names a REAL registry id${wrongIds.length ? " \u2014 " + wrongIds.join(", ") : ""}`);
  const unwired = ids.filter((i) => !wired.has(i));
  check(unwired.length === 0, `every tip in the registry is actually placed somewhere${unwired.length ? " \u2014 " + unwired.join(", ") : ""}`);
  check(wired.size === ids.length,
    `the count matches exactly: ${ids.length} in the registry, ${wired.size} placed \u2014 nothing was added inline outside it`);
  check(App.tips.tip("no_such_tip_id") === null,
    "a placement naming a tip that does not exist returns nothing, so it fails loudly rather than rendering an empty marker");

  // ---------- (3) the Learning Center link ----------
  console.log("\n(3) the optional link:");
  const withLink = boot(FULL_TREE);
  const n1 = withLink.App.tips.tip("modules_vs_permissions"); withLink.w.document.body.appendChild(n1);
  n1.querySelector(".tip-mark").click();
  const p1 = n1.querySelector(".tip-panel");
  check(!!p1 && !!p1.querySelector("a.tip-link"), "a tip whose guide IS visible to this tenant carries a link");
  check(!!p1 && /#\/learn\?guide=modules-fields/.test(p1.querySelector("a.tip-link").getAttribute("href")),
    "\u2026pointing at that guide");
  const filtered = boot([{ cat: "Admin", items: [{ id: "something-else" }] }]);
  const n2 = filtered.App.tips.tip("modules_vs_permissions"); filtered.w.document.body.appendChild(n2);
  n2.querySelector(".tip-mark").click();
  const p2 = n2.querySelector(".tip-panel");
  check(!!p2 && /Switched off/.test(p2.textContent), "a tip whose guide is FILTERED OUT for this tenant still renders");
  check(!!p2 && !p2.querySelector("a.tip-link"), "\u2026carrying NO link rather than a dead one");
  const noLC = boot(undefined);
  const n3 = noLC.App.tips.tip("modules_vs_permissions"); noLC.w.document.body.appendChild(n3);
  n3.querySelector(".tip-mark").click();
  check(!!n3.querySelector(".tip-panel") && !n3.querySelector("a.tip-link"),
    "\u2026and with no Learning Center loaded at all, still renders, still no dead link");
  // every declared learn id is a real guide id somewhere, or it could never resolve
  const learnSrc = readFileSync(resolvePath(R, "public", "js", "learn.js"), "utf8");
  const declaredLearn = [...TIPS_SRC.matchAll(/learn: "([a-z0-9-]+)"/g)].map((m) => m[1]);
  const unknown = declaredLearn.filter((g) => learnSrc.indexOf(`id: "${g}"`) === -1);
  check(unknown.length === 0,
    `every guide a tip names exists in the Learning Center (${declaredLearn.length} links)${unknown.length ? " \u2014 " + unknown.join(", ") : ""}`);

  // ---------- (4) nothing shifts ----------
  console.log("\n(4) opening a tip moves nothing (the RULE, not the pixels):");
  const wrapRule = CSS.slice(CSS.indexOf(".tip-wrap {"), CSS.indexOf("}", CSS.indexOf(".tip-wrap {")));
  const panelRule = CSS.slice(CSS.indexOf(".tip-panel {"), CSS.indexOf("}", CSS.indexOf(".tip-panel {")));
  check(/position:\s*relative/.test(wrapRule), "the marker's wrapper is a positioning context");
  check(/position:\s*absolute/.test(panelRule),
    "\u2026and the panel is absolutely positioned inside it, so it is out of flow and cannot push anything");
  check(/max-width:/.test(panelRule),
    "\u2026with a max-width escape, so on a narrow screen it shrinks rather than overflowing");
  // structural, and checkable: the panel is a child of the wrapper, never of the page
  App.tips.closeAll();
  const structural = App.tips.tip(ids[0]); w.document.body.appendChild(structural);
  structural.querySelector(".tip-mark").click();
  const panel = structural.querySelector(".tip-panel");
  check(!!panel && panel.parentNode === structural,
    "\u2026and at runtime the panel really is a child of the wrapper, not appended to the page");
  const before = w.document.body.childNodes.length;
  structural.querySelector(".tip-mark").click();
  check(w.document.body.childNodes.length === before, "opening and closing adds nothing to the page's own children");

  // ---------- (5) the copy ----------
  console.log("\n(5) the copy, which IS the product here:");
  const tooLong: string[] = [];
  const restating: string[] = [];
  for (const id of ids) {
    const t = App.tips.TIPS[id];
    const sentences = String(t.body).split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 2) tooLong.push(`${id} (${sentences.length})`);
    if (!t.title || !t.body) restating.push(id);
  }
  check(tooLong.length === 0, `no tip runs past two sentences${tooLong.length ? " \u2014 " + tooLong.join(", ") : ""}`);
  check(restating.length === 0, "every tip has both a title and a body");
  const jargon = ids.filter((id) => /var\(--|className|innerHTML|API|endpoint|recordType|tenantId/.test(App.tips.TIPS[id].body));
  check(jargon.length === 0, `no tip leaks jargon or class names into owner-facing copy${jargon.length ? " \u2014 " + jargon.join(", ") : ""}`);

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exit(1); }
  console.log("ALL PASSED \u2705 (eleven tips, every one reachable without a mouse)");
  process.exit(0);
}

main().catch((e: any) => { console.error("threw:", e); process.exit(1); });

export {};
