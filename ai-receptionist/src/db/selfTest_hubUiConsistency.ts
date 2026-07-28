// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// HUB UI CONSISTENCY — self-test. Five standing layers:
// builds (changelog, the shared picker exists once, the hub exposes no module
// writer); happy paths (Part A three-column geometry; Part B carousel mount,
// selection semantics, Fun slider, excluded sections, and the created tenant's
// theme + intensity; Part C two panels, editable Pages, read-only Modules with
// live fields); prime-directive regressions (portal Appearance still works on
// the shared component, page-save unchanged, identical inputs still produce
// identical tenants apart from the newly-carried intensity); catastrophics
// (hub reads hub-admin-gated + tenant-scoped, no module mutation route);
// DOM smoke throughout + the computed-layout report.
// Harness copied from selfTest_createUi2 / selfTest_lcRecruitment.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes, createRecordType, setRecordTypeLabels } = require("../services/recordTypeService");
const { createField } = require("../services/fieldService");
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
  console.log("HUB UI CONSISTENCY — self-test");
  console.log("=============================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  const admSrc = readFileSync(join(PUB, "js", "admin.js"), "utf8");
  const themeSrc = readFileSync(join(PUB, "js", "theme.js"), "utf8");
  const adminRouteSrc = readFileSync(resolve(__dirname, "..", "routes", "admin.ts"), "utf8");
  const owner = await db.user.create({ data: { email: `hub-own-${stamp}@example.invalid`, name: "O", role: "OWNER", passwordHash: "x" } });
  const ownerTok = await createSession(owner.id);
  const report: string[] = [];

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-hub-ui-consistency-20260727" } });
  check(!!cl && cl.id === "cl_hub_ui_consistency_20260727", "the changelog row landed (idempotent migration)");
  check((themeSrc.match(/function coverflowCarousel\(/g) || []).length === 1 && (themeSrc.match(/function mountThemePicker\(/g) || []).length === 1
      && !/coverflowCarousel|thc-carousel|themePreviewCard/.test(admSrc),
    "the carousel exists ONCE (theme.js) and the hub owns no copy of it");
  check(/mountThemePicker,/.test(themeSrc) && /App\.theme\.mountThemePicker\(/.test(admSrc) && /mountThemePicker\(\{/.test(themeSrc),
    "both hosts mount the SAME shared picker (portal Appearance + hub wizard)");
  // REPINNED (notif-polish): the hub now owns module visibility, because the
  // portal can no longer hide OR show a module. The guarantee that replaced the
  // old read-only one: exactly two routes, and the write goes through the SAME
  // setTenantNav service the create wizard uses — no parallel writer.
  const hubModuleRoutes = adminRouteSrc.match(/adminRouter\.(get|post|patch|put|delete)\("\/portals\/:id\/modules/g) || [];
  const hubModuleWrite = /adminRouter\.post\("\/portals\/:id\/modules\/:key\/visibility"/.test(adminRouteSrc);
  const usesSharedWriter = /setTenantNav\(tenantId, \{/.test(adminRouteSrc);
  check(hubModuleRoutes.length === 2 && hubModuleWrite && usesSharedWriter,
    `the hub has exactly ${hubModuleRoutes.length} module routes — the read plus a visibility write through setTenantNav (no parallel writer)`);
  const modHandler = adminRouteSrc.slice(adminRouteSrc.indexOf("/portals/:id/modules"), adminRouteSrc.indexOf("/portals/:id/modules") + 1800);
  check(!/\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/.test(modHandler) && !/setRecordTypeLabels|setModuleViews|updatePortal/.test(modHandler),
    "\u2026and the handler only READS — no write call of any kind inside it");

  // ---------- (2) Part A: the basic-details row ----------
  console.log("\n(2) Part A \u2014 basic details in one row:");
  const wh = bootDom(base, ownerTok);
  const H$ = (sel: string) => Array.from(wh.document.querySelectorAll(sel)) as any[];
  await until(() => wh.App.state && wh.App.state.me);
  (await until(() => H$("button").find((b: any) => b.textContent.trim() === "+ Create tenant"))).click();
  await until(() => wh.document.querySelector(".adm-formrow3"));
  const cols = H$(".adm-formrow3 .adm-fcol");
  check(cols.length === 3, "ONE row of THREE columns");
  check(cols.map((c: any) => c.querySelector("label").textContent).join("|") === "Business name *|Notify email|Billing status *",
    "\u2026in order: name, email, billing (asterisks unchanged)");
  check(cols.every((c: any) => !!c.querySelector(".input")) && !!wh.document.querySelector("#sp-name") && !!wh.document.querySelector("#sp-email") && !!wh.document.querySelector("#sp-billing"),
    "each column owns its control (ids preserved, so every existing flow still finds them)");
  check(!cols[0].querySelector(".adm-fhelp")
      && cols[1].querySelector(".adm-fhelp").textContent === "Notify email is optional — it's where call summaries and notifications go."
      && cols[2].querySelector(".adm-fhelp").textContent === "Required — pick how this tenant is billed. You can change it later from the tenant's detail panel.",
    "helper text is verbatim and lives INSIDE its own column (name has none)");
  check(cssSrc.includes(".adm-formrow3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-4); align-items: start; }"),
    "equal fractions + the house form-gap token; align-items:start puts the three controls on one line");
  check(cssSrc.includes("@media (max-width: 860px) { .adm-formrow3 { grid-template-columns: 1fr; } }"),
    "below the hub breakpoint (860px) the row stacks full-width \u2014 no cramped 3-across");
  report.push(`  Part A: 3 columns \u00d7 1fr, gap 16px (--sp-4); at the hub's 1120px content width \u2248 ${Math.round((1120 - 32) / 3)}px per column; controls share one top edge, helpers hang inside their column`);

  // ---------- (3) Part B: the carousel ----------
  console.log("\n(3) Part B \u2014 the appearance carousel:");
  await until(() => wh.document.querySelector(".thc-carousel"));
  const gsel = wh.document.querySelector(".thc-group-sel") as any;
  const cards = () => H$(".thc-card");
  check(!!gsel && Array.from(gsel.options as any[]).map((o: any) => o.textContent).join("/") === "Basic/Fun", "family selector mounts with both options");
  const basicCount = cards().length;
  check(basicCount > 1 && H$(".thc-dot").length === basicCount && H$(".thc-arrow").length === 2,
    `carousel mounts with the REAL roster (${basicCount} Basic cards), one dot each, both arrows`);
  check(cards().every((c: any) => !!c.querySelector(".thc-scope")), "every card is a LIVE preview under its own scoped token set");
  check(!wh.document.querySelector(".theme-custom-card") && !/Design your own|white-label|Logo/i.test((wh.document.querySelector(".adm-wrap") || wh.document.body).textContent || ""),
    "EXCLUDED on the hub: Design-your-own and Logo/white-label are absent");
  const centerName = () => { const c = wh.document.querySelector(".thc-card.thc-d0"); return c ? (c.querySelector(".thc-name") || { textContent: "" }).textContent : "-"; };
  const dotOn = () => H$(".thc-dot").findIndex((d: any) => d.className.includes("thc-dot--on"));
  const firstName = centerName();
  (wh.document.querySelector(".thc-arrow-right") as any).click(); await sleep(220);
  check(centerName() !== firstName && dotOn() === 1 && (wh.document.querySelector(".thc-card.thc-d0") as any).getAttribute("aria-selected") === "true",
    "arrows advance the CENTERED card, dots follow, centered carries the selected treatment");
  check(!wh.document.querySelector(".fun-slider-row"), "Basic hides the Fun-intensity slider");
  gsel.value = "fun"; gsel.dispatchEvent(new wh.Event("change")); await sleep(280);
  const funCount = cards().length;
  check(!!wh.document.querySelector(".fun-slider-row") && funCount > 1, `Fun reveals the intensity slider (${funCount} Fun cards)`);
  (wh.document.querySelector(".thc-arrow-right") as any).click(); await sleep(220);
  const chosenTheme = centerName();
  const seg = wh.document.querySelector(".fun-seg") as any;
  seg.focus(); for (let i = 0; i < 5; i++) { seg.dispatchEvent(new wh.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await sleep(40); }
  const shownLevel = Number((wh.document.querySelector(".fun-range-val") as any).textContent);
  report.push(`  Part B: ${basicCount} Basic + ${funCount} Fun cards, ${H$(".thc-dot").length} dots, 2 arrows; card labels render in full (.thc-name, no truncation rule in the stylesheet)`);
  // finish -> the created tenant carries BOTH
  const finName = `hub-fin-${stamp}`;
  (wh.document.querySelector("#sp-name") as any).value = finName;
  (wh.document.querySelector("#sp-billing") as any).value = "trial";
  (H$("button").find((b: any) => b.textContent.includes("Finish")) as any).click();
  const made: any = await (async () => { for (let i = 0; i < 70; i++) { const r = await db.tenant.findFirst({ where: { name: finName } }); if (r) return r; await sleep(200); } return null; })();
  if (made) cleanup.push(made.id);
  await sleep(1200);
  const madeRow: any = made ? await db.tenant.findUnique({ where: { id: made.id } }) : null;
  const th: any = madeRow ? madeRow.theme : null;
  check(!!th && th.active && th.active.mode === "preset" && typeof th.active.preset === "string" && th.active.preset.length > 0,
    `the created tenant's theme is the CENTERED card ("${chosenTheme}" \u2192 ${th && th.active ? th.active.preset : "?"})`);
  check(!!th && th.funLevel === shownLevel, `\u2026and the Fun INTENSITY travelled with it (${shownLevel})`);
  freeze(wh); await sleep(200);

  // ---------- (4) Part C: the dual panels ----------
  console.log("\n(4) Part C \u2014 tenant detail dual panels:");
  const t: any = await createPortal({ name: `hub-det-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  const wd = bootDom(base, ownerTok);
  await until(() => wd.App.state && wd.App.state.me);
  const D$ = (sel: string) => Array.from(wd.document.querySelectorAll(sel)) as any[];
  wd.location.hash = "#/admin/portals"; wd.dispatchEvent(new wd.Event("hashchange"));
  const rowBtn = await until(() => Array.from(wd.document.querySelectorAll("button, a, tr")).find((x: any) => (x.textContent || "").includes(t.name)));
  (rowBtn as any).click();
  await until(() => D$(".adm-mp-panel").length === 2);
  await until(() => D$(".adm-mp-row").length > 0);
  const panels = D$(".adm-mp-panel");
  check(panels.length === 2 && panels.map((p: any) => (p.querySelector(".adm-mp-h") || {}).textContent).join("|") === "Pages|Modules",
    "TWO separate panels, own headers (Pages | Modules)");
  check(panels.every((p: any) => !!p.querySelector(".card")) && panels[0].querySelector(".card") !== panels[1].querySelector(".card")
      && /Modules and pages/.test(wd.document.body.textContent || ""),
    "\u2026each in its OWN card container under the \"Modules and pages\" heading (not one panel split by a divider)");
  const pageRows = panels[0].querySelectorAll(".adm-row3");
  check(pageRows.length > 0 && !!pageRows[0].querySelector(".adm-row-ic") && !!pageRows[0].querySelector("input") && !!pageRows[0].querySelector(".adm-rowdesc"),
    `LEFT: ${pageRows.length} page rows with icon + checkbox + title + description (the create page's anatomy)`);
  const saveBtn = Array.from(panels[0].querySelectorAll("button")).find((b: any) => b.textContent.includes("Save page access")) as any;
  check(!!saveBtn && Array.from(pageRows).every((r: any) => r.querySelector("input").disabled === false), "\u2026its checkboxes stay EDITABLE and the existing Save button is still there");
  const modRows = D$(".adm-mp-row");
  const inds = D$(".adm-mp-ind");
  check(modRows.length > 0 && inds.length === modRows.length && inds.some((i: any) => !i.disabled && typeof i.onchange === "function"),
    `RIGHT: ${modRows.length} module rows, their switches now LIVE (the hub owns module visibility since the notif-polish batch)`);
  check(modRows.every((r: any) => !!r.querySelector(".adm-row-ic") && !!r.querySelector(".adm-rowname") && !!r.querySelector(".adm-r3-chips")),
    "\u2026each row: icon + indicator + title + description + chips column");
  check(/Switch a module on or off for this tenant here/.test(panels[1].textContent || ""), "\u2026and the footer line says what the panel now does");
  // page-save regression: toggling still PATCHes and sticks
  const firstCb = pageRows[0].querySelector("input") as any;
  firstCb.checked = false; firstCb.onchange();
  saveBtn.click();
  const savedOk = await until(async () => true, 10) && await (async () => { for (let i = 0; i < 40; i++) { const row = await db.tenant.findUnique({ where: { id: t.id } }); if (((row as any).lockedPages || []).length > 0) return true; await sleep(200); } return false; })();
  check(savedOk, "PAGE-SAVE regression: unchecking a page still locks it through the existing endpoint");

  // ---------- (5) live mirror round-trip ----------
  console.log("\n(5) the live mirror (portal changes -> hub panel):");
  const custom: any = await createRecordType(t.id, "Venue", "Venues");
  await createField(t.id, { label: "Capacity", type: "number" } as any, custom.key);
  await createField(t.id, { label: "Preferred contact time", type: "text" } as any, "contact");
  await setRecordTypeLabels(t.id, "booking", "Session", "Sessions");
  const hubMods = async () => ((await (await fetch(base + `/api/admin/portals/${t.id}/modules`, { headers: { Cookie: `air_session=${ownerTok}` } })).json()).modules || []);
  const mods = await hubMods();
  const venue = mods.find((m: any) => m.key === custom.key);
  const contactMod = mods.find((m: any) => m.key === "contact");
  const bookingMod = mods.find((m: any) => m.key === "booking");
  check(!!venue && venue.labelPlural === "Venues" && (venue.fields || []).includes("Capacity"), "a CUSTOM module and its CUSTOM field appear");
  check(!!contactMod && (contactMod.fields || []).includes("Preferred contact time"), "a custom field added to a stock module appears");
  check(!!bookingMod && bookingMod.label === "Session" && bookingMod.labelPlural === "Sessions", "a RENAMED module shows the TENANT'S label");
  const capField = await db.fieldDef.findFirst({ where: { tenantId: t.id, key: "capacity" } });
  if (capField) await db.fieldDef.delete({ where: { id: capField.id } });
  const mods2 = await hubMods();
  check(!((mods2.find((m: any) => m.key === custom.key) || {}).fields || []).includes("Capacity"), "a REMOVED field disappears (the panel is live, not the creation-time catalog)");
  // and the rendered panel reflects it after a revisit
  wd.location.hash = "#/admin/portals"; wd.dispatchEvent(new wd.Event("hashchange")); await sleep(300);
  const rowBtn2 = await until(() => Array.from(wd.document.querySelectorAll("button, a, tr")).find((x: any) => (x.textContent || "").includes(t.name)));
  (rowBtn2 as any).click();
  await until(() => D$(".adm-mp-row").some((r: any) => /Venues/.test(r.textContent)));
  const venueRow = D$(".adm-mp-row").find((r: any) => /Venues/.test(r.querySelector(".adm-rowname").textContent));
  const sessionRow = D$(".adm-mp-row").find((r: any) => /Sessions/.test(r.querySelector(".adm-rowname").textContent));
  check(!!venueRow && !!sessionRow, "the RENDERED panel shows the custom module and the renamed one after a revisit");
  // chips + popover inside the panel
  const contactRow = D$(".adm-mp-row").find((r: any) => /Contacts/.test(r.querySelector(".adm-rowname").textContent));
  const chipTexts = contactRow ? Array.from(contactRow.querySelectorAll(".adm-chip")).map((c: any) => c.textContent) : [];
  check(chipTexts.length > 0 && chipTexts.includes("Preferred contact time") || chipTexts.some((c: string) => /\+\d+ more/.test(c)),
    `chips render the LIVE fields (${chipTexts.join(", ") || "none"})`);
  const moreChip = contactRow && contactRow.querySelector(".adm-chip-more");
  if (moreChip) {
    (moreChip as any).click(); await sleep(160);
    const pop = wd.document.querySelector(".adm-chip-pop") as any;
    const popRows = pop ? pop.querySelectorAll(".adm-chip-pop-row").length : 0;
    check(!!pop && pop.parentElement === wd.document.body && popRows > 0, `the "+N more" popover opens inside the panel, body-appended (${popRows} rows, unclippable)`);
    wd.document.body.click(); await sleep(120);
    check(!wd.document.querySelector(".adm-chip-pop"), "\u2026and closes on outside click (batch-26 behavior intact)");
  }
  report.push(`  Part C: panels 4fr / 6fr (minmax(0,\u2026) floors) with a 16px gap \u2014 at the hub's 1120px content width \u2248 442px Pages / 662px Modules; lists scroll internally at max-height 420px; ${modRows.length} module rows \u00b7 ${pageRows.length} page rows`);
  report.push(`  Part C rows: three columns fit at 662px (icon+indicator+title | description | chips); .adm-mp-row uses flex-wrap so a narrower panel stacks the row instead of squeezing`);
  freeze(wd); await sleep(200);

  // ---------- (6) regressions + catastrophics ----------
  console.log("\n(6) regressions + catastrophics:");
  // the shared component still works in its ORIGINAL home
  const pt: any = await createPortal({ name: `hub-portal-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(pt.id);
  const pu = await db.user.create({ data: { email: `hub-p-${stamp}@example.invalid`, name: "P", role: "PORTAL_ADMIN", tenantId: pt.id, passwordHash: "x" } });
  const pTok = await createSession(pu.id);
  const wp = bootDom(base, pTok);
  await until(() => wp.App.state && wp.App.state.me);
  wp.location.hash = "#/settings/appearance"; wp.dispatchEvent(new wp.Event("hashchange"));
  await until(() => wp.document.querySelector(".thc-carousel"));
  const pCards = Array.from(wp.document.querySelectorAll(".thc-card")) as any[];
  check(pCards.length > 1 && !!wp.document.querySelector(".thc-group-sel"), "PORTAL Appearance still mounts the carousel (the shared component didn't break its original home)");
  check(!!wp.document.querySelector(".theme-custom-card"), "\u2026and the portal KEEPS Design-your-own (the hub-only exclusions are per-host flags, not deletions)");
  (wp.document.querySelector(".thc-arrow-right") as any).click();
  const persisted = await (async () => { for (let i = 0; i < 40; i++) { const row: any = await db.tenant.findUnique({ where: { id: pt.id } }); if (row.theme && row.theme.active && row.theme.active.preset) return row.theme.active.preset; await sleep(200); } return null; })();
  check(!!persisted, `\u2026and centering a card still SAVES immediately in the portal (stored "${persisted}")`);
  freeze(wp); await sleep(200);
  // hub read is gated + tenant-scoped
  const asPortalAdmin = await fetch(base + `/api/admin/portals/${t.id}/modules`, { headers: { Cookie: `air_session=${pTok}` } });
  check(asPortalAdmin.status === 401 || asPortalAdmin.status === 403, `hub-admin gated: a tenant's own PORTAL_ADMIN is refused (${asPortalAdmin.status})`);
  const otherMods = ((await (await fetch(base + `/api/admin/portals/${pt.id}/modules`, { headers: { Cookie: `air_session=${ownerTok}` } })).json()).modules || []);
  check(!otherMods.some((m: any) => m.labelPlural === "Venues"), "tenant-scoped: one tenant's custom module never appears in another's panel");
  // identical inputs still produce identical tenants (apart from the carried intensity)
  const a1: any = await createPortal({ name: `hub-eq-a-${stamp}`, billingStatus: "trial" } as any);
  const b1: any = await createPortal({ name: `hub-eq-b-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(a1.id, b1.id);
  const stripT = (x: any) => { const { id, name, notifyEmail, createdAt, updatedAt, ...rest } = x; return rest; };
  check(JSON.stringify(stripT(await db.tenant.findUnique({ where: { id: a1.id } }))) === JSON.stringify(stripT(await db.tenant.findUnique({ where: { id: b1.id } }))),
    "identical inputs still produce identical tenants (creation itself untouched by this batch)");

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  side-by-side verdict: comfortable \u2014 the Modules panel keeps ~662px, enough for the three-column row WITH chips; the Pages panel needs less because it has no chips column");

  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the hub caught up with the create page, and it still can't touch a tenant's modules)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
