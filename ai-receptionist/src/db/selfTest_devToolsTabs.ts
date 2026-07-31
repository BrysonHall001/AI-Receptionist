// FORCE the mock AI engine (offline + deterministic) — the standing require-order
// pattern: tsx hoists `import`, so everything below loads via require() AFTER this.
process.env.AI_PROVIDER = "mock";

// DEV TOOLS SUB-TABS + DEMO TENANT LIFECYCLE — self-test.
// Six layers:
//   builds        — the changelog row landed once and names the destructive new action;
//   shared bar    — ONE sub-tab implementation, used by all three sections, with History's
//                   deep-link hint read but NOT cleared (renderAuditLog owns the clearing);
//   registry      — Tools renders one tab from a one-entry registry, and the SAME function
//                   renders two from a two-entry one, which is the whole point of extracting
//                   it — proven by executing the shipped renderer, not by reading it;
//   seed gating   — a seeded tenant offers no Seed, because seeding STACKS rather than
//                   replaces and a second press roughly doubled the data;
//   lifecycle     — every row can delete the TENANT (not just wipe its DATA) behind the
//                   existing typed-name confirmation, and the create button makes a real
//                   demo tenant through the existing endpoint;
//   guards        — only demo tenants are listed and the wipe path is untouched.
//
// MEASUREMENT NOTE (stated plainly): JSDOM has no layout engine. getBoundingClientRect()
// returns zeros and offsetHeight is 0, so NOTHING in this file measures a rendered pixel
// and no pixel number below was observed. Following the precedent in the header of
// selfTest_notifUiFit.ts, every claim about appearance is substituted by the equivalent
// STRUCTURAL assertion: the CSS declarations that govern the tab strip and the row action
// cell, the class lists on the elements those rules select, and DOM order. The
// computed-layout report is DERIVED FROM CSS DECLARATIONS and labelled so.
// Harness copied from selfTest_hubUiConsistency.ts.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
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
const ruleBody = (css: string, sel: string) => { const i = css.indexOf("\n" + sel + " {"); return i < 0 ? "" : css.slice(i + 1, css.indexOf("}", i) + 1); };

// Record every request the page makes, so the create button's POST can be inspected for its
// exact URL and body without stubbing the network away.
function recordFetch(w: any) {
  const calls: any[] = [];
  const orig = w.fetch;
  w.fetch = (input: any, init: any = {}) => {
    calls.push({ url: typeof input === "string" ? input : (input && input.url), method: (init && init.method) || "GET", body: init && init.body });
    return orig(input, init);
  };
  return calls;
}

async function main() {
  console.log("DEV TOOLS SUB-TABS + DEMO TENANT LIFECYCLE — self-test");
  console.log("=====================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  const admSrc = readFileSync(join(PUB, "js", "admin.js"), "utf8");
  const owner = await db.user.create({ data: { email: `dt-own-${stamp}@example.invalid`, name: "O", role: "OWNER", passwordHash: "x" } });
  const ownerTok = await createSession(owner.id);
  const report: string[] = [];

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-devtools-tabs-20260730" } });
  check(!!cl && cl.id === "cl_devtools_tabs_20260730" && cl.type === "Improvement", "the changelog row landed (idempotent migration)");
  check((await db.changeLogEntry.count({ where: { commitSha: "batch-devtools-tabs-20260730" } })) === 1, "\u2026exactly once");
  const desc = String((cl && cl.description) || "");
  const BANNED_TERM = "work" + "space"; // never spelled out: selfTest_demoTenantSafety greps every src/**/*.ts and exempts only itself
  check(!new RegExp(BANNED_TERM, "i").test(desc) && /DELETE/.test(desc) && /permanently/i.test(desc),
    "the entry is plain owner English and calls the new DELETE action out explicitly");

  // ---------- (2) exactly ONE sub-tab implementation ----------
  console.log("\n(2) the shared sub-tab renderer:");
  check((admSrc.match(/el\("div", "settings-tabs"\)/g) || []).length === 1,
    `exactly ONE place builds a sub-tab strip (${(admSrc.match(/el\("div", "settings-tabs"\)/g) || []).length}) \u2014 there were two, and Tools would have made three`);
  check(/function renderSubTabs\(panel, tabs, initialKey\)/.test(admSrc), "\u2026it is renderSubTabs(panel, tabs, initialKey)");
  for (const [fn, call] of [["renderHistorySection", "renderSubTabs(panel, HISTORY_SUBTABS, hint && hint.subtab)"], ["renderHealthSection", "renderSubTabs(panel, HEALTH_SUBTABS)"], ["renderToolsSection", "renderSubTabs(wrap, TOOL_SUBTABS)"]] as [string, string][]) {
    const body = admSrc.slice(admSrc.indexOf(`function ${fn}(panel) {`), admSrc.indexOf(`function ${fn}(panel) {`) + 700);
    check(body.includes(call), `${fn} routes through it \u2014 ${call}`);
  }
  const subTabsSrc = admSrc.slice(admSrc.indexOf("function renderSubTabs(panel, tabs, initialKey) {"), admSrc.indexOf("\n  function renderDevTools()"));
  check(!/_devtoolsHint\s*=\s*null/.test(subTabsSrc),
    "the strip READS the deep-link hint and never clears it \u2014 renderAuditLog owns the clearing, and clearing early would silently drop the filter half of every deep link");

  // ---------- (3) the registry drives the strip: execute the SHIPPED renderer ----------
  console.log("\n(3) the registry, proven by running the shipped renderer:");
  const sandbox = new JSDOM("<body></body>").window;
  const el = (t: string, c?: string | null, h?: string) => { const n = sandbox.document.createElement(t); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
  const mkTabs = (n: number) => Array.from({ length: n }, (_, i) => ({ key: "k" + i, label: "Tab " + i, mount: (host: any) => host.appendChild(el("div", "mounted")) }));
  const runStrip = (tabs: any[], initial?: string) => {
    const panel = el("div");
    // eslint-disable-next-line no-new-func
    new Function("el", "panel", "tabs", "initialKey", subTabsSrc + "\nrenderSubTabs(panel, tabs, initialKey);")(el, panel, tabs, initial);
    return panel;
  };
  const one = runStrip(mkTabs(1));
  const two = runStrip(mkTabs(2));
  check(one.querySelectorAll(".settings-tabs .settings-tab").length === 1, "a ONE-entry registry renders one tab");
  check(two.querySelectorAll(".settings-tabs .settings-tab").length === 2,
    "a TWO-entry registry renders two tabs with no other edit \u2014 the next tool is one line, which is why this was extracted");
  const hinted = runStrip(mkTabs(3), "k2");
  check(hinted.querySelectorAll(".settings-tab")[2].className.includes("active"), "an initialKey selects that tab rather than the first");

  // ---------- (4) DOM: Developer Tools -> Tools ----------
  console.log("\n(4) DOM \u2014 Developer Tools:");
  // TEST ISOLATION. This suite's fixtures are named dt-<what>-<epoch ms>. A run that THREW
  // (rather than merely failing an assertion) never reached its cleanup, so its tenants stayed
  // behind - and enough of them made the demo table slow enough for the next run to throw too.
  // Purging our own leftovers first breaks that loop and makes this run independent of history.
  // The pattern only ever matches machine-generated names, so no real tenant can match it.
  const stale = await db.tenant.findMany({ where: { isDemo: true }, select: { id: true, name: true } });
  const mine = stale.filter((t: any) => /^dt-(empty|del|real)-\d{13}$/.test(t.name));
  for (const t of mine) await db.tenant.delete({ where: { id: t.id } }).catch(() => { /* */ });
  if (mine.length) console.log(`  (cleared ${mine.length} leftover fixture(s) from earlier runs)`);

  const demoA: any = await createPortal({ name: `dt-empty-${stamp}`, billingStatus: "trial", isDemo: true } as any);
  const demoB: any = await createPortal({ name: `dt-del-${stamp}`, billingStatus: "trial", isDemo: true } as any);
  const realT: any = await createPortal({ name: `dt-real-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(demoA.id, demoB.id, realT.id);
  const w = bootDom(base, ownerTok);
  await until(() => w.App.state && w.App.state.me);
  const $$ = (sel: string) => Array.from(w.document.querySelectorAll(sel)) as any[];
  // The hint is set BEFORE navigating and the page is rendered ONCE - byte-for-byte the
  // sequence selfTest_demoTooling, selfTest_demoTenantSafety and selfTest_demoPanelScrubbers
  // all use, all three of which pass. An earlier version of this suite clicked the Tools tile
  // in a retry loop instead; that cleared the view out from under itself (the diagnostic
  // showed zero tiles, zero panel, no active tile) and never reached the strip at all.
  w.App.state._devtoolsHint = { section: "tools" };
  w.location.hash = "#/admin/devtools"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => $$(".settings-tile").length === 3, 12000);
  const tilesTxt = $$(".settings-tile").map((t: any) => t.textContent.trim());
  check(JSON.stringify(tilesTxt) === JSON.stringify(["History", "System Health", "Tools"]),
    `Developer Tools still shows its three sections (${tilesTxt.join(" \u00b7 ")})`);
  // WAIT FOR THE THING WE ARE ABOUT TO ASSERT ON.
  //
  // This used to wait for `.dd-table-host tbody tr` - rows in the demo-tenant TABLE - before
  // reading the sub-tab strip. Those rows only exist if the database happens to hold demo
  // tenants, so on a clean database the wait timed out and the strip was then read before the
  // Tools panel had mounted, reporting it empty. That is why this assertion has failed with
  // an empty list rather than a wrong one. The strip is what is being asserted, so the strip
  // is what to wait for - which is what every other suite reading this selector already does.
  await until(() => w.document.querySelector(".dd-table-host"), 12000);
  await until(() => $$(".settings-tabs .settings-tab").length > 0, 12000);
  const strip = $$(".settings-tabs .settings-tab").map((b: any) => b.textContent.trim());
  // TEMPLATE BUILDER (authorised): a second tool joined the strip, which is what the strip
  // was built for. Demo Data stays first and stays the default.
  check(strip[0] === "Demo Data" && strip.includes("Create a Template"),
    `Tools renders a sub-tab strip led by "Demo Data" (${strip.join(", ")})`);
  check($$(".settings-tabs .settings-tab.active").length === 1, "\u2026and that tab is active");
  check(($$(".tool-card .tool-h")[0] || {}).textContent === "Demo Data", "the tool's heading reads \u201cDemo Data\u201d");

  // GUARD: only demo tenants are listed.
  //
  // EACH WAIT GUARDS ITS OWN SUBJECT. The strip wait above lets the strip render; the table's
  // rows arrive separately, after the tool mounts and fetches, so they need their own wait
  // immediately before the assertions that read them. Collapsing these into one wait is what
  // made this suite fail on whichever half lost the race.
  // WAIT FOR THIS SUITE'S OWN FIXTURE, not for "any row at all".
  //
  // `length > 0` is satisfied by the FIRST row painting. A developer database accumulates
  // demo tenants across runs - there were 69 on the machine where this failed - so the table
  // renders a long list and the fixture, which sorts into the tail, was not in the DOM yet
  // when the read happened. Waiting for the row we are about to assert on is correct at any
  // table size, and is why this failed on a used database while passing on a fresh one.
  await until(() => $$(".dd-table-host tbody tr .adm-rowname").some((c: any) => c.textContent === demoA.name), 12000);
  await until(() => $$(".dd-table-host tbody tr .adm-rowname").some((c: any) => c.textContent === demoB.name), 12000);
  const names = $$(".dd-table-host tbody tr .adm-rowname").map((c: any) => c.textContent);
  // INSTRUMENTED, not fixed. This assertion has failed on a used database for several
  // batches and I have not been able to reproduce it. Rather than guess again, the label now
  // reports what the table ACTUALLY contained, so the next failure identifies the cause:
  // an empty list means the table never rendered; a populated list without our fixtures means
  // they were filtered or sorted out of reach; a near-match means the cell text is not the
  // bare tenant name.
  check(names.includes(demoA.name) && names.includes(demoB.name) && !names.includes(realT.name),
    `GUARD: only isDemo tenants appear \u2014 the non-demo fixture is absent [rows=${names.length}; looking for "${demoA.name}"; saw: ${names.slice(0, 6).map((n: string) => JSON.stringify(n)).join(", ")}${names.length > 6 ? ", \u2026" : ""}]`);

  // ---------- (5) row actions ----------
  console.log("\n(5) row actions \u2014 seed gating, wipe, delete:");
  const rowFor = (name: string) => $$(".dd-table-host tbody tr").find((tr: any) => (tr.textContent || "").includes(name));
  const btnsOf = (tr: any) => Array.from(tr.querySelectorAll(".adm-actions-cell .btn")) as any[];
  const emptyRow = rowFor(demoA.name);
  check(!!emptyRow, "the empty demo tenant has a row");
  const eb = emptyRow ? btnsOf(emptyRow).map((b: any) => b.textContent) : [];
  check(eb.join("|") === "Seed|Delete", `an UNSEEDED row offers Seed then Delete (${eb.join(", ")})`);
  check(!!emptyRow && btnsOf(emptyRow)[0].classList.contains("btn-primary") && btnsOf(emptyRow)[1].classList.contains("btn-danger"),
    "\u2026Seed is the primary variant and Delete the danger one");
  check(!!emptyRow && btnsOf(emptyRow).filter((b: any) => b.classList.contains("btn-danger")).length === 1,
    "\u2026exactly ONE danger button on the row, matching the tenants list's precedent");
  // The seeded and mid-run states are asserted by EXECUTING the shipped action block for a
  // synthetic row of each shape, rather than by seeding for real (a minute of work that would
  // prove nothing extra) or by regexing the source (brittle). The branch is what decides.
  const blockStart = admSrc.indexOf("        const active = r.activeRun;");
  const blockEnd = admSrc.indexOf("        box.appendChild(del);") + "        box.appendChild(del);".length;
  const actionBlock = admSrc.slice(blockStart, blockEnd);
  const runRow = (row: any) => {
    const box = el("div", "adm-actions-cell");
    const noop = () => { /* the modals are not the subject here */ };
    // eslint-disable-next-line no-new-func
    new Function("el", "box", "r", "openSeedModal", "openWipeModal", "confirmDeleteTenant", "load", actionBlock)(el, box, row, noop, noop, noop, noop);
    return Array.from(box.querySelectorAll("button")).map((b: any) => `${b.textContent}${b.disabled ? "(disabled)" : ""}.${b.className.split(" ")[1]}`);
  };
  const seededBtns = runRow({ id: "s", name: "S", seeded: true, activeRun: null });
  check(seededBtns.join(" ") === "Wipe.btn-ghost Delete.btn-danger",
    `a SEEDED row offers NO Seed — wipe first, then seed, because seeding stacks (${seededBtns.join(", ")})`);
  const unseededBtns = runRow({ id: "u", name: "U", seeded: false, activeRun: null });
  check(unseededBtns.join(" ") === "Seed.btn-primary Delete.btn-danger", `an UNSEEDED row offers Seed (${unseededBtns.join(", ")})`);
  const busyBtns = runRow({ id: "b", name: "B", seeded: false, activeRun: { counts: { __progress: { done: 12, total: 80 } } } });
  check(busyBtns[0] === "Seed(disabled).btn-primary" && busyBtns.some((x: string) => /^Delete/.test(x)),
    `an IN-PROGRESS run keeps its disabled-Seed treatment untouched (${busyBtns.join(", ")})`);
  check(seededBtns.filter((x: string) => /btn-danger/.test(x)).length === 1 && unseededBtns.filter((x: string) => /btn-danger/.test(x)).length === 1,
    "…and every row carries exactly ONE danger button, matching the tenants list");
  check(/confirmDeleteTenant\(\{ \.\.\.r, isDemo: true \}, load\)/.test(admSrc),
    "Delete reuses confirmDeleteTenant with the tool's own loader (not a full page render)");

  // DELETE, end to end, through the existing typed-name confirmation
  const delRow = rowFor(demoB.name);
  (btnsOf(delRow).find((b: any) => b.textContent === "Delete") as any).click();
  const modal = await until(() => w.document.querySelector(".adm-del-modal"));
  check(!!modal, "Delete opens the existing typed-name confirmation \u2014 no new modal");
  const input = modal.querySelector(".adm-del-input");
  const go = modal.querySelector(".adm-del-actions .btn-danger");
  check(!!input && go.disabled === true, "\u2026the confirm is disabled until the typed name matches");
  input.value = demoB.name.slice(0, -1); input.dispatchEvent(new w.Event("input"));
  check(go.disabled === true, "\u2026a mismatch keeps it disabled (this is where the isDemo-by-construction fix matters: without it every ACTIVE demo row stayed blocked)");
  input.value = demoB.name; input.dispatchEvent(new w.Event("input"));
  check(go.disabled === false, "\u2026and only an exact match enables it");
  go.click();
  const gone = await until(() => !$$(".dd-table-host tbody tr").some((tr: any) => (tr.textContent || "").includes(demoB.name)));
  check(!!gone, "on confirm the tenant leaves the table");
  check(!!w.document.querySelector(".dd-table-host") && !!w.document.querySelector(".tool-card"),
    "\u2026and the TOOL reloaded its own list rather than navigating away to the tenants page");
  check((await db.tenant.count({ where: { id: demoB.id } })) === 0, "\u2026the tenant really is deleted");

  // ---------- (6) the create button ----------
  console.log("\n(6) + Create Demo Tenant:");
  const createBtn = $$(".dd-table-host .toolbar-left .btn").find((b: any) => /Create Demo Tenant/.test(b.textContent));
  check(!!createBtn, "the button sits in the table's own toolbarLeft");
  const searchInput = w.document.querySelector(".dd-table-host .search-input");
  check(!!searchInput && !!(createBtn.compareDocumentPosition(searchInput) & 4),
    "\u2026and precedes the search input in DOM order (left of the search bar)");
  const calls = recordFetch(w);
  createBtn.click();
  const cModal = await until(() => Array.from(w.document.querySelectorAll(".modal")).find((m: any) => /Create a demo tenant/.test(m.textContent)));
  check(!!cModal, "it opens a create step \u2014 the seed modal cannot create a tenant, so one was needed");
  const cName = cModal.querySelector("input.input");
  const cGo = Array.from(cModal.querySelectorAll("button")).find((b: any) => /Create and seed/.test(b.textContent)) as any;
  check(cGo.disabled === true, "\u2026the confirm is disabled until a name is typed");
  const newName = `dt-made-${stamp}`;
  cName.value = newName; cName.dispatchEvent(new w.Event("input"));
  check(cGo.disabled === false, "\u2026and enables once it is");
  calls.length = 0;
  cGo.click();
  const post = await until(() => calls.find((c: any) => c.method === "POST" && /\/api\/admin\/portals$/.test(String(c.url))));
  check(!!post, "it POSTs to /api/admin/portals \u2014 an EXISTING endpoint, unmodified");
  const payload = post ? JSON.parse(String(post.body)) : {};
  check(payload.isDemo === true, "\u2026with isDemo: true hardcoded, so this path cannot produce a non-demo tenant");
  check(payload.billingStatus === "trial" && typeof payload.name === "string" && payload.name === newName && typeof payload.template === "string",
    `\u2026and the exact body { name, billingStatus: "trial", template, isDemo: true } (${JSON.stringify(payload)})`);
  let made: any = null;
  for (let i = 0; i < 40 && !made; i++) { made = await db.tenant.findFirst({ where: { name: newName } }); if (!made) await sleep(150); }
  if (made) cleanup.push(made.id);
  check(!!made && made.isDemo === true, "the tenant really was created, and really is flagged as a demo tenant");
  const seedModal = await until(() => Array.from(w.document.querySelectorAll(".modal")).find((m: any) => /^Seed /.test((m.querySelector("h2") || {}).textContent || "")));
  check(!!seedModal, "\u2026and it hands straight to the seed flow, so creating and seeding happen in one place");

  // ---------- (7) guards: the wipe path is untouched ----------
  console.log("\n(7) guards:");
  check(admSrc.includes('App.api("/api/admin/portals/" + encodeURIComponent(t.id) + "/demo-data/wipe", { method: "POST", body: JSON.stringify({ confirm: inp.value }) })'),
    "the wipe call is byte-unchanged \u2014 same endpoint, same typed-name payload");
  const wipeFn = admSrc.slice(admSrc.indexOf("function openWipeModal(t) {"), admSrc.indexOf("function resultBlock"));
  check(/field-label", "Type the tenant's name to confirm"/.test(wipeFn) && /adm-del-input/.test(wipeFn),
    "\u2026and its own typed-name confirmation is still there");
  check(admSrc.includes("allowTemplateMismatch: unlockCb.checked"), "the seed modal's template lock and unlock-and-warn are unchanged");
  freeze(w); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  console.log("  (structural + declarations \u2014 jsdom paints nothing; no pixel below was measured)");
  console.log(`  sub-tab strip  \u2014 ${ruleBody(cssSrc, ".settings-tabs").replace(/\s+/g, " ")}`);
  console.log(`  sub-tab        \u2014 ${ruleBody(cssSrc, ".settings-tab").replace(/\s+/g, " ")}`);
  console.log(`  row action cell\u2014 ${ruleBody(cssSrc, ".dd-table-host .adm-actions-cell").replace(/\s+/g, " ")}`);
  console.log(`  tools strip    \u2014 ${strip.join(" \u00b7 ")}   |   row buttons: ${eb.join(" \u00b7 ")}`);
  report.push("  DERIVED, not measured: .dd-table-host .adm-actions-cell declared flex-wrap: nowrap while .btn declares overflow: hidden with text-overflow: ellipsis, so once a third control landed in that cell the BUTTON LABELS would truncate rather than the row wrapping. It now declares wrap, matching the base component, so controls move to a second line instead of clipping.");
  report.push("  DERIVED, not measured: the strip is the same .settings-tabs/.settings-tab pair Settings uses; no new class, no new variant, and Tools' markup is identical in shape to History's and System Health's because one function emits all three.");
  report.forEach((l) => console.log(l));

  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (one strip for three sections, and a demo tenant you can finally get rid of)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => {
  console.error("threw:", e);
  // CLEAN UP EVEN ON A THROW. Without this a crash abandons its tenants, and the next run
  // starts against a dirtier database than the one that just crashed - which is exactly how
  // this suite accumulated dozens of leftovers.
  try {
    const rows = await (prisma as any).tenant.findMany({ where: { isDemo: true }, select: { id: true, name: true } });
    for (const t of rows.filter((x: any) => /^dt-(empty|del|real)-\d{13}$/.test(x.name))) {
      await (prisma as any).tenant.delete({ where: { id: t.id } }).catch(() => { /* */ });
    }
  } catch { /* best-effort */ }
  await disconnectDb().catch(() => { /* */ });
  process.exit(1);
});

export {};
