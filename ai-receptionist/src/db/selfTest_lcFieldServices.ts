// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// PER-TEMPLATE LEARNING CENTER (Field Services) — self-test. Five standing
// layers: the four-cell template×flag MATRIX (three cells byte-identical
// stock), the assembled variant live in a real FS+checked portal (tree order,
// search both directions, feature-tagging inside the variant, the dispatch
// stepper), the full scan battery over the VARIANT content (markers, sourceFn
// lineage, inertness, voice rule), the no-fork object-identity contracts, and
// the create-screen band recentering at two heights.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { getTemplate } = require("../services/tenantTemplates");
const { listRecordTypes } = require("../services/recordTypeService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(140); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "navModel.js", "app.js"];
const cleanup: string[] = [];

function bootDom(base: string, token: string) {
  const dom = new JSDOM(readFileSync(join(PUB, "index.html"), "utf8"), { url: base + "/", runScripts: "outside-only", pretendToBeVisual: true });
  const w: any = dom.window;
  w.fetch = (input: any, init: any = {}) => { const url = typeof input === "string" ? (input.startsWith("http") ? input : base + input) : input.url; init.headers = { ...(init.headers || {}), Cookie: `air_session=${token}` }; return (globalThis as any).fetch(url, init); };
  w.alert = () => { /* */ }; w.confirm = () => true; w.scrollTo = () => { /* */ };
  try { if (!w.crypto.randomUUID) Object.defineProperty(w.crypto, "randomUUID", { value: () => "u-" + Math.random().toString(36).slice(2) }); } catch { /* */ }
  w.Chart = function () { return { destroy() { /* */ }, update() { /* */ } }; }; (w.Chart as any).register = () => { /* */ };
  for (const f of SCRIPTS) w.eval(readFileSync(join(PUB, "js", f), "utf8"));
  return w;
}
const freeze = (w: any) => { try { w.fetch = () => new Promise(() => { /* frozen */ }); } catch { /* */ } };

async function main() {
  console.log("LC Field Services (per-template Learning Center) — self-test");
  console.log("=============================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const mk = async (opts: any) => { const t: any = await createPortal({ name: `lcm-${Math.random().toString(36).slice(2, 8)}-${stamp}`, billingStatus: "trial", ...opts } as any); cleanup.push(t.id); const u = await db.user.create({ data: { email: `lcm-${t.id.slice(-6)}@example.invalid`, name: "M", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } }); return { t, tok: await createSession(u.id) }; };
  const meOf = async (tok: string) => (await (await fetch(base + "/api/auth/me", { headers: { Cookie: `air_session=${tok}` } })).json());

  // ---------- (1) builds & the flag-contract MATRIX ----------
  console.log("\n(1) builds & the four-cell matrix (server-computed, one place):");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-lc-field-services-20260725" } });
  check(!!cl && cl.id === "cl_lc_field_services_20260725", "the changelog row landed (idempotent migration)");
  const fsTpl: any = getTemplate("field_services");
  const cells: any = {
    fsChecked: await mk({ template: "field_services", customLearningCenter: true, hiddenRecordTypes: fsTpl.modulesHiddenPrefill }),
    fsUnchecked: await mk({ template: "field_services", hiddenRecordTypes: fsTpl.modulesHiddenPrefill }),
    general: await mk({ template: "general" }),
    plain: await mk({}),
  };
  check((await meOf(cells.fsChecked.tok)).features.lcVariant === "field_services", "FS + checked \u2192 lcVariant=field_services");
  check((await meOf(cells.fsUnchecked.tok)).features.lcVariant === null, "FS + UNCHECKED \u2192 null (the checkbox is the contract)");
  check((await meOf(cells.general.tok)).features.lcVariant === null, "General \u2192 null");
  check((await meOf(cells.plain.tok)).features.lcVariant === null, "plain / pre-existing \u2192 null");
  const learnSrc = readFileSync(join(PUB, "js", "learn.js"), "utf8");
  check(!learnSrc.includes("templateKey") && !learnSrc.includes("customLearningCenter"),
    "the client NEVER re-derives the contract (learn.js contains neither column name)");

  // ---------- (2) the variant, live (FS+checked portal) ----------
  console.log("\n(2) the assembled variant, live:");
  await listRecordTypes(cells.fsChecked.t.id);
  const wv = bootDom(base, cells.fsChecked.tok);
  const V$ = (sel: string) => Array.from(wv.document.querySelectorAll(sel)) as any[];
  const vText = () => wv.document.body.textContent || "";
  await until(() => wv.App.state && wv.App.state.me);
  wv.location.hash = "#/learn"; wv.dispatchEvent(new wv.Event("hashchange")); await sleep(350);
  check(!!(await until(() => vText().includes("Your modules") && vText().includes("Workflows"))), "the FS tree renders");
  const tree = wv.App.learn.activeGuides();
  const cats = tree.map((g: any) => g.cat);
  check(JSON.stringify(cats.slice(0, 5)) === JSON.stringify(["Getting started", "Your modules", "Workflows", "Your receptionist", "Admin"]),
    `the five FS sections lead, in order (${cats.slice(0, 5).join(" \u2192 ")})`);
  check(["Working with records", "Analytics & dashboards", "Communication", "Automations", "Housekeeping"].every((c) => cats.includes(c)),
    "\u2026with the remaining stock sections riding along by reference (R1-approved; nothing loses its help)");
  check(tree.find((g: any) => g.cat === "Your modules").items.map((it: any) => it.id).join(",") === "fs-contacts,fs-work-orders,fs-equipment,fs-estimates,fs-invoices,fs-products,fs-tasks",
    "all seven module guides present, in order");
  // no-fork identity: refs ARE the stock objects; appended sections ARE stock sections.
  const stockOrientation = wv.App.learn.GUIDES[0].items.find((it: any) => it.id === "orientation");
  check(tree[0].items[0] === stockOrientation, "NO FORK: a {ref} resolves to the SAME stock guide object");
  check(tree.includes(wv.App.learn.GUIDES.find((g: any) => g.cat === "Communication")), "NO FORK: an appended stock section is the SAME section object");
  check(!wv.App.learn.GUIDES.some((g: any) => (g.items || []).some((it: any) => String(it.id).startsWith("fs-"))), "stock GUIDES carries ZERO fs-* ids (bodies live only in the variant)");
  // feature-tagging INSIDE the variant: validator green; hiding Equipment hides fs-equipment.
  check(wv.App.learn.validateGuideFeatureTags(tree).length === 0, "every variant guide carries valid feature tags (validator green over the assembled tree)");
  check(!!(await until(() => V$("button, a").find((b: any) => b.textContent.includes("Equipment: what you service")))), "fs-equipment visible while the Equipment module is on");
  // search, both directions
  const searchBox = V$("input.learn-search")[0];
  searchBox.value = "dispatch"; searchBox.dispatchEvent(new wv.Event("input"));
  await sleep(250);
  check(vText().includes("A day of dispatch: tray to done"), "SEARCH finds a variant guide (dispatch)");
  searchBox.value = "columns"; searchBox.dispatchEvent(new wv.Event("input"));
  await sleep(250);
  check(vText().includes("columns"), "\u2026and still finds referenced STOCK guides (Manage columns)");
  searchBox.value = ""; searchBox.dispatchEvent(new wv.Event("input")); await sleep(200);
  // the dispatch stepper: opens, has frames, advances, honors keyboard.
  const wf = await until(() => V$("button, a").find((b: any) => b.textContent.includes("A day of dispatch")));
  (wf as any).click(); await sleep(350);
  const stepHost = await until(() => wv.document.querySelector(".lstep, [class*=lstep]"));
  check(!!stepHost && V$(".scene-tray").length > 0, "the dispatch guide opens with the four-frame STEPPER (frame 1: the Unscheduled tray)");
  const nextBtn = V$("button").find((b: any) => /next|\u203a|\u2192/i.test(b.textContent) && (b.className || "").includes("lstep"));
  if (nextBtn) { nextBtn.click(); await sleep(200); }
  check(!!nextBtn && vText().includes("schedules it and assigns them"), "\u2026Next advances to frame 2 (drag onto a lane)");
  freeze(wv); await sleep(250);

  // ---------- (3) prime-directive regressions: byte-identical stock ----------
  console.log("\n(3) the other three cells: stock, byte for byte:");
  const wp = bootDom(base, cells.plain.tok);
  await until(() => wp.App.state && wp.App.state.me);
  check(wp.App.learn.activeGuides() === wp.App.learn.GUIDES, "a plain portal's tree IS the stock GUIDES array (reference equality = byte identity)");
  wp.location.hash = "#/learn"; wp.dispatchEvent(new wp.Event("hashchange")); await sleep(350);
  const pText = () => wp.document.body.textContent || "";
  check(!!(await until(() => pText().includes("Getting started"))) && !pText().includes("Your modules") && !pText().includes("A day of dispatch"),
    "\u2026renders the stock tree with ZERO fs-* content visible");
  const pSearch = Array.from(wp.document.querySelectorAll("input.learn-search"))[0] as any;
  pSearch.value = "dispatch"; pSearch.dispatchEvent(new wp.Event("input")); await sleep(250);
  check(!pText().includes("A day of dispatch"), "SEARCH on a stock portal can never surface variant guides");
  check(wp.App._lc.idKnownAnywhere("fs-dispatch-day") === true && !wp.App.learn.activeGuides().some((g: any) => g.items.some((it: any) => it.id === "fs-dispatch-day")),
    "a cross-tree deep link is KNOWN but not ACTIVE \u2192 the graceful-note branch (source-asserted next)");
  check(learnSrc.includes("Not available in this portal") && learnSrc.includes("|| idKnownAnywhere(id)"),
    "\u2026the note path is variant-aware in source (never a 404, never a leak)");
  freeze(wp); await sleep(250);
  check((await meOf(cells.fsUnchecked.tok)).features.lcVariant === null && (await meOf(cells.general.tok)).features.lcVariant === null,
    "FS+unchecked and General remain stock on re-read (no drift)");

  // ---------- (4) scans over the VARIANT content ----------
  console.log("\n(4) scans (variant guides + new scenes):");
  const wS = wv; // reuse the booted variant window's registries (frozen fetch is fine for pure reads)
  const FS = wS.App.learn.FS_GUIDES;
  const ids = Object.keys(FS);
  check(ids.length >= 13 && ids.indexOf("fs-service-plans") !== -1,
    `the FS variant ships ${ids.length} variant-only guides, including the service-plans one`);
  const missingMarkers: string[] = [];
  ids.forEach((id) => (FS[id].blocks || []).forEach((b: any) => { if (b.visual && !wS.App.learnScenes.has(b.visual)) missingMarkers.push(id + ":" + b.visual); }));
  check(missingMarkers.length === 0, "every VISUAL marker in the variant resolves to a registered scene");
  const newScenes = ["related-tabs", "dispatch-lanes", "estimate-public", "preset-library"];
  const fnCache: any = {};
  const fnResolves = (sf: string) => { const [file, fn] = sf.split("#"); if (!(file in fnCache)) { try { fnCache[file] = readFileSync(file.endsWith(".html") ? join(PUB, file) : join(PUB, "js", file), "utf8"); } catch { fnCache[file] = ""; } } return new RegExp("function\\s+" + fn + "\\s*\\(").test(fnCache[file]); };
  check(newScenes.every((id) => { const sc = wS.App.learnScenes.get(id); return sc && fnResolves(sc.sourceFn) && sc.regions.length >= 3; }),
    "all four NEW scenes carry resolving sourceFn lineage + regions (incl. the estimate.html public page)");
  const sceneHtml = newScenes.flatMap((id) => wS.App.learnScenes.get(id).frames.map((f: any) => f.html)).join("\n");
  check(!/\bon[a-z]+\s*=/.test(sceneHtml) && !/addEventListener|fetch\(|portalApi/.test(sceneHtml), "the new scenes are INERT (no handlers, no fetches)");
  check(wS.App.learnScenes.get("dispatch-lanes").frames.length === 4, "dispatch-lanes carries exactly the four stepper frames");
  const allBodies = ids.map((id) => JSON.stringify(FS[id])).join("\n");
  check(!/\bhub\b/i.test(allBodies) && !/template/i.test(allBodies) && !/platform/i.test(allBodies) && !/Vaala/i.test(allBodies),
    "VOICE RULE: variant guides never mention the hub, templates, or the platform");
  check(!/Harbor Plumbing|Avery Lane/.test(allBodies), "\u2026and guide TEXT stays free of scene fixture names (generic data lives only in scenes)");

  // ---------- (5) the band, recentered ----------
  console.log("\n(5) the create-screen band (content-driven recenter):");
  const owner = await db.user.create({ data: { email: `lcm-own-${stamp}@example.invalid`, name: "O", role: "OWNER", passwordHash: "x" } });
  const wh = bootDom(base, await createSession(owner.id));
  const H$ = (sel: string) => Array.from(wh.document.querySelectorAll(sel)) as any[];
  const btn = await until(() => H$("button").find((b: any) => b.textContent.trim() === "+ Create tenant"));
  (btn as any).click();
  await until(() => wh.document.querySelector(".adm-tpl-band") && H$(".adm-tpl-card").length >= 2);
  const pos = (h: number) => { const c = wh.App._createUi.positionTplBand(h); const top = parseFloat((wh.document.querySelector(".adm-tpl-band") as any).style.top); return { c, mid: top + 12 }; };
  const p87 = pos(87); const p159 = pos(159);
  check(Math.abs(p87.mid - p87.c) < 0.6 && Math.abs(p159.mid - p159.c) < 0.6 && p159.c > p87.c,
    `the band's CENTER tracks the main rects' midline at BOTH heights (87px \u2192 ${p87.c}; 159px \u2192 ${p159.c})`);
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  check(!/adm-tpl-band[^}]*top:\s*\d/.test(cssSrc), "the magic fixed offset is GONE from the stylesheet (position is derived, with a resize re-fit)");
  freeze(wh); await sleep(250);

  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (one manual per tenant: the FS shop gets its own book, everyone else keeps theirs to the byte)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
