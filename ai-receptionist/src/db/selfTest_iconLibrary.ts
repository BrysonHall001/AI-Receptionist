process.env.AI_PROVIDER = "mock";

// ICON LIBRARY — self-test.
//
// The prime directive is that the five built-in templates render byte-identical glyphs. That
// is asserted against a committed fixture, with a negative proving the comparison would catch
// a change. Everything else follows: the library resolves, the picker is usable by keyboard
// and named, and a chosen icon survives a round trip and renders everywhere.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { TENANT_TEMPLATES, getTemplate, resolveTemplate, specToTemplate } = require("../services/tenantTemplates");
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { JSDOM } = require("jsdom");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanup: string[] = [];
const R = resolvePath(__dirname, "..", "..");
const baseline = require("./fixtures/templateIconBaseline.json");

/** icons.js in a window, exactly as the browser loads it. */
function loadIcons() {
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only" }).window;
  w.App = {};
  new Function("window", "App", readFileSync(resolvePath(R, "public", "js", "icons.js"), "utf8"))(w, w.App);
  return w.App.icons;
}

/** admin.js's shared templateCard, which is the ONE place a template glyph renders. */
function loadCard(icons: any) {
  const raw = readFileSync(resolvePath(R, "public", "js", "admin.js"), "utf8");
  const inner = raw.slice(raw.indexOf("(function (global) {") + "(function (global) {".length, raw.lastIndexOf("})(typeof window"));
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" }).window;
  const el = (t: string, c?: string, h?: string) => { const n = w.document.createElement(t); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
  const esc = (x: any) => String(x == null ? "" : x).replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  w.App = { util: { el, esc, toast: () => { /* */ }, $: (s: string) => w.document.querySelector(s) }, icons, state: { me: { role: "OWNER" } } };
  (globalThis as any).document = w.document; (globalThis as any).window = w;
  return { card: new Function("global", inner + "\nreturn templateCard;")(w), w };
}
const glyphOf = (card: any, t: any) => {
  const node = card(t, { onPick: () => { /* */ } });
  const g = node.querySelector(".tpl-glyph");
  return g ? g.innerHTML : null;
};
/** Put a raw glyph string through the SAME DOM round trip the card does before comparing.
 *  jsdom re-serialises SVG (attribute order, self-closing tags), so comparing a raw string to
 *  an innerHTML can never match even when the glyph is right. */
const asRendered = (w: any, svg: string | null) => {
  if (svg == null) return null;
  const span = w.document.createElement("span");
  span.innerHTML = svg;
  return span.innerHTML;
};

async function main() {
  console.log("ICON LIBRARY \u2014 self-test");
  console.log("========================");
  const stamp = Date.now();
  const icons = loadIcons();

  // ---------- (1) THE PRIME DIRECTIVE ----------
  console.log("\n(1) the five built-in templates:");
  const moved = Object.keys(baseline.templates).filter((k) => icons.forTemplateKey(k) !== baseline.templates[k]);
  check(moved.length === 0,
    moved.length ? `GLYPHS CHANGED: ${moved.join(", ")}` : `all ${Object.keys(baseline.templates).length} built-in glyphs are byte-identical to the fixture`);
  const tampered = JSON.parse(JSON.stringify(baseline));
  tampered.templates.food_service = tampered.templates.food_service.replace('stroke-width="1.4"', 'stroke-width="1.5"');
  const caught = Object.keys(tampered.templates).filter((k) => icons.forTemplateKey(k) !== tampered.templates[k]);
  check(caught.length === 1 && caught[0] === "food_service",
    `NEGATIVE: a one-character change to a glyph is caught and named (${caught.join(",") || "NOT CAUGHT"})`);
  const codeKeys = TENANT_TEMPLATES.map((t: any) => t.key);
  check(codeKeys.every((k: string) => icons.forTemplateKey(k) === baseline.templates[k]),
    `\u2026and every template in code resolves through the unchanged key path (${codeKeys.length})`);

  // ---------- (2) every library entry resolves ----------
  console.log("\n(2) the library:");
  const lib = icons.iconLibrary();
  check(lib.length === baseline.shape.libraryCount, `the library holds ${lib.length} glyphs`);
  const broken = lib.filter((x: any) => !x.svg || typeof x.svg !== "string" || x.svg.indexOf("<svg") !== 0);
  check(broken.length === 0,
    broken.length ? `ENTRIES POINT AT NOTHING: ${broken.map((x: any) => x.id).join(", ")}` : "every entry resolves to real SVG markup");
  const unnamed = lib.filter((x: any) => !x.id || !x.name || !String(x.name).trim());
  check(unnamed.length === 0, "every entry has an id and a human name \u2014 a picker is not a grid of unlabelled shapes");
  check(new Set(lib.map((x: any) => x.id)).size === lib.length, "ids are unique, so a stored choice cannot become ambiguous");
  // NEGATIVE for the "fail loudly" rule
  check(icons.iconById(lib[0].id) === lib[0].svg && icons.iconById("lib:does_not_exist") === null,
    "NEGATIVE: iconById returns null for an id that is not in the library, rather than empty markup");
  // every glyph shares the house conventions
  const offStyle = lib.filter((x: any) => x.svg.indexOf('viewBox="0 0 16 16"') === -1 || x.svg.indexOf('stroke-width="1.4"') === -1);
  check(offStyle.length === 0, `every glyph uses the house viewBox and stroke weight (${lib.length} checked)`);

  // ---------- (3) a chosen icon renders, everywhere ----------
  console.log("\n(3) a built template's chosen icon:");
  const { card, w: cardWin } = loadCard(icons);
  const chosen = { key: `built_${stamp}`, label: "Built", description: "d", icon: "lib:legal", builtIn: false };
  const inWizard = glyphOf(card, chosen);
  const inBuilder = glyphOf(card, Object.assign({}, chosen));   // the builder passes the same object shape
  check(inWizard === asRendered(cardWin, icons.iconById("lib:legal")), "a chosen icon renders as that glyph");
  check(inWizard === inBuilder, "\u2026and identically in both rows, because there is ONE resolver and one call site");
  const noIcon = glyphOf(card, { key: `built2_${stamp}`, label: "B2", description: "d", builtIn: false });
  check(noIcon === asRendered(cardWin, baseline.templates.__default), "a built template with NO chosen icon renders the default");
  const stale = glyphOf(card, { key: `built3_${stamp}`, label: "B3", description: "d", icon: "lib:removed_later", builtIn: false });
  check(stale === asRendered(cardWin, baseline.templates.__default), "\u2026and an icon id that no longer exists falls back to the default, not to nothing");
  const builtIn = glyphOf(card, { key: "food_service", label: "Food Service", description: "d", builtIn: true });
  check(builtIn === asRendered(cardWin, baseline.templates.food_service), "a code template still renders its own bespoke glyph through the same card");

  // (4) removed with the Create a Template tool: it asserted keyboard accessibility of
  // the builder's icon PICKER (buildIconPicker + .tb-iconopt CSS), which no longer exists.
  // Choosing an icon is gone; RENDERING a chosen icon is what sections (3) and (5) keep.

  // ---------- (5) the round trip ----------
  console.log("\n(5) saving and reopening:");
  const key = `icon_${stamp}`;
  const row: any = await db.tenantTemplateRow.create({ data: { key, label: `Icon ${stamp}`, description: "", spec: { icon: "lib:medical", modulesHiddenPrefill: [] } } });
  cleanup.push(row.id);
  const back = await resolveTemplate(key);
  check(!!back && (back as any).icon === "lib:medical", "a chosen icon survives a save and comes back on reopen");
  check(glyphOf(card, back) === asRendered(cardWin, icons.iconById("lib:medical")), "\u2026and renders as the glyph it names");
  // a template built BEFORE this batch has no icon key at all
  const oldKey = `iconold_${stamp}`;
  const oldRow: any = await db.tenantTemplateRow.create({ data: { key: oldKey, label: `Old ${stamp}`, description: "", spec: { modulesHiddenPrefill: ["vehicle"] } } });
  cleanup.push(oldRow.id);
  const oldTpl = await resolveTemplate(oldKey);
  check((oldTpl as any).icon === undefined, "a template built before this batch carries no icon key");
  check(JSON.stringify(Object.keys(oldTpl).sort()) === JSON.stringify(Object.keys(getTemplate("general")).sort()),
    "\u2026so it still has exactly the key set a code template has");
  check(glyphOf(card, oldTpl) === asRendered(cardWin, baseline.templates.__default), "\u2026and still renders the default glyph, exactly as before");
  check(specToTemplate({ key: "x", label: "x", description: "", spec: { icon: 123 } }).icon === undefined,
    "a non-string icon is refused rather than stored, so the picker cannot be bypassed with junk");

  for (const id of cleanup) await db.tenantTemplateRow.delete({ where: { id } }).catch(() => { /* */ });
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (twenty-six glyphs to choose from, and the five that shipped have not moved)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => {
  console.error("threw:", e);
  try { for (const id of cleanup) await (prisma as any).tenantTemplateRow.delete({ where: { id } }).catch(() => { /* */ }); } catch { /* */ }
  await disconnectDb().catch(() => { /* */ });
  process.exit(1);
});

export {};
