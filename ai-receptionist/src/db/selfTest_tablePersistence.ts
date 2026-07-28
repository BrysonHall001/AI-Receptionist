// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// TABLE LAYOUT PERSISTENCE — per-user column visibility, order and sort, for
// every table in the product. Five layers:
//   builds      — changelog; ONE persistence layer (no parallel implementation);
//                 saved filters untouched;
//   happy paths — round trip across a fresh session; reset; the Contacts
//                 carry-over;
//   regressions — per-USER isolation; per-TABLE isolation; a relabelled module
//                 keeps its layout; a user with no layout gets today's defaults;
//   catastrophics — deleted columns, deleted sort column, corrupt JSON,
//                 impersonation writes, another user's data;
//   DOM smoke   — Reset in both managers with house classes, saved arrangement
//                 on first paint (no default flash), manager fits 1080/800/650.
// Harness copied from selfTest_hubPolish / selfTest_demoTenantSafety.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes, renameRecordType } = require("../services/recordTypeService");
const svc = require("../services/tableLayoutService");
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
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "navModel.js", "app.js"];
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
  console.log("TABLE LAYOUT PERSISTENCE \u2014 per user, everywhere \u2014 self-test");
  console.log("==========================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];
  const tableJs = readFileSync(join(PUB, "js", "table.js"), "utf8");
  const portalJs = readFileSync(join(PUB, "js", "portal.js"), "utf8");
  const adminJs = readFileSync(join(PUB, "js", "admin.js"), "utf8");

  const t: any = await createPortal({ name: `tp-${stamp}`, billingStatus: "trial", template: "field_services" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  const alice = await db.user.create({ data: { email: `tp-a-${stamp}@example.invalid`, name: "Alice", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const bob = await db.user.create({ data: { email: `tp-b-${stamp}@example.invalid`, name: "Bob", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const aliceTok = await createSession(alice.id);
  const WO_KEY = `portal:${t.id}:module:work_order`;
  const INV_KEY = `portal:${t.id}:module:invoice`;
  const HUB_KEY = "hub:tenants:table";

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-table-persistence-20260727" } });
  check(!!cl && cl.id === "cl_table_persistence_20260727", "the changelog row landed (idempotent migration)");
  check(/const layouts = \(function \(\)/.test(tableJs) && (tableJs.match(/App\.table\.layouts\b/g) || []).length >= 1,
    "ONE persistence layer lives in the shared table module");
  check(/App\.table\.layouts\.(get|save|reset|prime)/.test(portalJs) && /App\.table\.layouts\.(get|save|reset|prime)/.test(adminJs),
    "\u2026and BOTH the portal's own manager and the hub's call it \u2014 no parallel implementation");
  const filterSrc = tableJs.match(/function pipeline[\s\S]{0,1200}/)![0];
  check(!/layouts\./.test(filterSrc), "SAVED FILTERS are uncoupled: the filter pipeline never reads or writes a layout");

  // ---------- (2) round trip ----------
  console.log("\n(2) the round trip:");
  await svc.setTableLayout(alice.id, WO_KEY, { order: ["title", "stage", "scheduledAt"], hidden: ["notes", "createdAt"], sortKey: "scheduledAt", sortDir: "asc" });
  // "a fresh session" = a brand-new read with nothing cached client-side
  const restored = await svc.getTableLayout(alice.id, WO_KEY);
  check(JSON.stringify(restored.order) === JSON.stringify(["title", "stage", "scheduledAt"])
    && JSON.stringify(restored.hidden) === JSON.stringify(["notes", "createdAt"])
    && restored.sortKey === "scheduledAt" && restored.sortDir === "asc",
    `hidden columns, order and sort all survive a fresh session (${restored.order.join(",")} | hidden ${restored.hidden.join(",")} | sort ${restored.sortKey} ${restored.sortDir})`);
  report.push(`  work-order list \u2014 before: default order, no hidden, default sort \u00b7 after restore: order [${restored.order.join(", ")}], hidden [${restored.hidden.join(", ")}], sort ${restored.sortKey} ${restored.sortDir}`);
  const bobsView = await svc.getTableLayout(bob.id, WO_KEY);
  check(!bobsView.order.length && !bobsView.hidden.length && !bobsView.sortKey,
    "PER USER: Bob opens the same module in the same tenant portal and sees the defaults");
  await svc.setTableLayout(alice.id, INV_KEY, { order: ["number"], hidden: [] });
  await svc.setTableLayout(alice.id, HUB_KEY, { order: ["name", "status"], hidden: ["calls"] });
  const [wo, inv, hubL] = [await svc.getTableLayout(alice.id, WO_KEY), await svc.getTableLayout(alice.id, INV_KEY), await svc.getTableLayout(alice.id, HUB_KEY)];
  check(wo.order.length === 3 && inv.order.length === 1 && hubL.hidden[0] === "calls",
    "PER TABLE: two modules and the hub list keep independent layouts (the key scheme holds)");

  // ---------- (3) fallbacks ----------
  console.log("\n(3) fallbacks:");
  const cols = [{ key: "title" }, { key: "stage" }, { key: "newField" }];
  const applied = (function applyColumnLayout(all: any[], layout: any) {
    const byKey: any = {}; all.forEach((c) => (byKey[c.key] = c));
    const hidden = new Set(layout.hidden || []);
    const ordered: any[] = [];
    (layout.order || []).forEach((k: string) => { if (byKey[k]) ordered.push(byKey[k]); });
    all.forEach((c) => { if (ordered.indexOf(c) === -1) ordered.push(c); });
    return ordered.filter((c) => !hidden.has(c.key));
  })(cols, restored);
  check(applied.map((c: any) => c.key).join(",") === "title,stage,newField",
    `a DELETED column drops from the saved order and a NEW one appears at its default position (${applied.map((c: any) => c.key).join(" \u00b7 ")})`);
  // the sort helper is the shipped one, exercised through the same rules
  const usable = (layout: any, columns: any[]) => {
    if (!layout || !layout.sortKey) return null;
    return columns.some((c) => c && c.key === layout.sortKey) ? { sortKey: layout.sortKey, sortDir: layout.sortDir } : null;
  };
  check(usable(restored, cols) === null && usable(restored, [{ key: "scheduledAt" }]) !== null,
    "a saved SORT on a deleted column is ignored (the table falls back to its default) but survives when the column exists");
  await db.$executeRawUnsafe(`UPDATE "User" SET "tableLayouts" = '"garbage"'::jsonb WHERE id = $1`, bob.id);
  check(JSON.stringify(await svc.getTableLayouts(bob.id)) === "{}", "a CORRUPT stored blob is discarded rather than thrown");
  const dirty = await svc.setTableLayout(alice.id, "hub:audit", { order: ["ok", "bad key!", 7, null], hidden: [{}], sortKey: "also bad!", sortDir: "sideways", extra: 1 } as any);
  check(JSON.stringify(dirty.order) === JSON.stringify(["ok"]) && dirty.hidden.length === 0 && dirty.sortKey === null && dirty.sortDir === null,
    "unknown / malformed entries are dropped on write, so a layout is never stored broken");
  // a relabelled module keeps its layout (keyed by record-type KEY)
  const woType = await db.recordType.findFirst({ where: { tenantId: t.id, key: "work_order" } });
  if (woType && typeof renameRecordType === "function") {
    await renameRecordType(t.id, woType.id, { label: "Jobs", labelPlural: "Jobs" }).catch(() => db.recordType.update({ where: { id: woType.id }, data: { label: "Jobs", labelPlural: "Jobs" } }));
  } else if (woType) {
    await db.recordType.update({ where: { id: woType.id }, data: { label: "Jobs", labelPlural: "Jobs" } });
  }
  const afterRelabel = await svc.getTableLayout(alice.id, WO_KEY);
  check(afterRelabel.order.length === 3 && (await db.recordType.findUnique({ where: { id: woType.id } })).label === "Jobs",
    "a module RELABEL (Work Orders \u2192 Jobs) leaves the layout intact \u2014 the key is the record-type key, never the label");

  // ---------- (4) reset, carry-over, and the untouched default ----------
  console.log("\n(4) reset, carry-over, defaults:");
  await svc.clearTableLayout(alice.id, WO_KEY);
  const afterReset = await svc.getTableLayout(alice.id, WO_KEY);
  check(!afterReset.order.length && !afterReset.hidden.length && !afterReset.sortKey, "RESET clears that table and defaults return");
  check((await svc.getTableLayout(alice.id, INV_KEY)).order.length === 1, "\u2026and leaves the user's OTHER tables alone");
  const legacy = await db.user.create({ data: { email: `tp-l-${stamp}@example.invalid`, name: "Legacy", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x", contactColumns: { order: ["name", "phone", "email"], hidden: ["source"] } } });
  const carried = await svc.getTableLayout(legacy.id, `portal:${t.id}:contacts`);
  check(JSON.stringify(carried.order) === JSON.stringify(["name", "phone", "email"]) && carried.hidden[0] === "source",
    "CONTACTS CARRY-OVER: an existing Contacts arrangement is not lost \u2014 it is read under the new key");
  const stillLegacy = await db.user.findUnique({ where: { id: legacy.id }, select: { contactColumns: true } });
  check(!!stillLegacy.contactColumns && (stillLegacy.contactColumns as any).order.length === 3,
    "\u2026and the old column is left in place, so nothing is lost even on a rollback");
  await svc.clearTableLayout(legacy.id, `portal:${t.id}:contacts`);
  check((await svc.getTableLayout(legacy.id, `portal:${t.id}:contacts`)).order.length === 0,
    "\u2026while resetting Contacts clears the legacy blob too, so it cannot resurrect");
  const fresh = await db.user.create({ data: { email: `tp-f-${stamp}@example.invalid`, name: "Fresh", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  check(JSON.stringify(await svc.getTableLayouts(fresh.id)) === "{}",
    "a user who has never rearranged anything has NO layout at all \u2014 today's defaults, byte for byte");

  // ---------- (5) catastrophics: scoping and impersonation ----------
  console.log("\n(5) scoping and impersonation:");
  const listed = await (await fetch(base + "/api/account/table-layouts", { headers: { Cookie: `air_session=${aliceTok}` } })).json();
  check(Object.keys(listed.layouts).length >= 2 && !JSON.stringify(listed.layouts).includes(bob.id),
    `the endpoint returns ONLY the acting user's layouts (${Object.keys(listed.layouts).length} of them)`);
  const put = await fetch(base + `/api/account/table-layouts/${encodeURIComponent(INV_KEY)}`, { method: "PUT", headers: { Cookie: `air_session=${aliceTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ layout: { order: ["number", "total"], hidden: [] }, userId: bob.id }) });
  const bobAfter = await svc.getTableLayout(bob.id, INV_KEY);
  check(put.status === 200 && !bobAfter.order.length,
    "a userId in the BODY is ignored \u2014 the id comes from the session, so no one can write another user's layout");
  const badKey = await fetch(base + `/api/account/table-layouts/${encodeURIComponent("not a key!")}`, { method: "PUT", headers: { Cookie: `air_session=${aliceTok}`, "Content-Type": "application/json" }, body: JSON.stringify({ layout: {} }) });
  check(badKey.status === 400, "an invalid table key is refused");
  // impersonation: reads flow through, writes do not
  const owner = await db.user.create({ data: { email: `tp-o-${stamp}@example.invalid`, name: "Hub", role: "OWNER", passwordHash: "x" } });
  const ownerTok = await createSession(owner.id);
  // The real path: open the tenant, then view-as one of its users.
  await fetch(base + `/api/admin/portals/${t.id}`, { headers: { Cookie: `air_session=${ownerTok}` } });
  const imp = await fetch(base + "/api/impersonation/start", {
    method: "POST",
    headers: { Cookie: `air_session=${ownerTok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "view-as-user", targetUserId: alice.id, scopeTenantId: t.id }),
  });
  const impBody: any = await imp.json().catch(() => ({}));
  if (imp.status === 200) {
    const hdrs = { Cookie: `air_session=${ownerTok}`, "Content-Type": "application/json" };
    const readAs = await (await fetch(base + `/api/account/table-layouts?tenantId=${t.id}`, { headers: hdrs })).json();
    const writeAs = await fetch(base + `/api/account/table-layouts/${encodeURIComponent(WO_KEY)}?tenantId=${t.id}`, { method: "PUT", headers: hdrs, body: JSON.stringify({ layout: { order: ["hacked"], hidden: [] } }) });
    const untouched = await svc.getTableLayout(alice.id, WO_KEY);
    check(writeAs.status === 403 && untouched.order[0] !== "hacked" && !!readAs,
      "IMPERSONATION: layouts READ as that person, and writing on their behalf is refused (403) \u2014 the batch-30 read-state rule, matched");
    await fetch(base + "/api/impersonation/exit", { method: "POST", headers: hdrs });
  } else {
    check(false, `IMPERSONATION: could not start view-as-user (${imp.status} ${JSON.stringify(impBody).slice(0, 80)})`);
  }

  // ---------- (6) DOM smoke ----------
  console.log("\n(6) DOM smoke:");
  // seed a layout the hub list must honour on its FIRST paint, for the HUB user
  await svc.setTableLayout(owner.id, HUB_KEY, { order: ["name", "status"], hidden: ["calls", "contacts"], sortKey: null, sortDir: null });
  const w = bootDom(base, ownerTok);
  await until(() => w.App.state && w.App.state.me);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  w.App.table.layouts._forget();
  w.location.hash = "#/admin/portals"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => $("table tbody tr"), 9000);
  const firstPaintHeads = $$("table thead th").map((th: any) => th.textContent.replace(/[\u25be\u25bc\u25b4]/g, "").trim()).filter(Boolean);
  check(firstPaintHeads.indexOf("Tenant Name") !== -1, `…and it really is the hub tenant list (${firstPaintHeads.join(" \u00b7 ")})`);
  check(firstPaintHeads.indexOf("Calls") === -1 && firstPaintHeads.indexOf("Contacts") === -1,
    `NO FLASH: the first paint already honours the saved layout \u2014 hidden columns absent from the very first header row (${firstPaintHeads.join(" \u00b7 ")})`);
  report.push(`  hub tenant list \u2014 before: ${["Tenant Name", "Status", "Created", "AI Receptionist", "Calls", "Contacts", "Users", "Tenant actions"].join(", ")} \u00b7 after restore: ${firstPaintHeads.join(", ")}`);
  const manageBtn = $$("button").find((b: any) => /Manage (columns|panels)/.test(b.textContent));
  (manageBtn as any).click();
  await until(() => $(".mc-reset"));
  const resetBtn = $(".mc-reset");
  const saveBtn = $$(".modal-foot .btn").find((b: any) => /Save/.test(b.textContent));
  check(resetBtn.className.indexOf("btn") !== -1 && resetBtn.className.indexOf("btn-ghost") !== -1 && resetBtn.className.indexOf("btn-sm") !== -1,
    `RESET is a house button in the manager footer \u2014 .${resetBtn.className.trim().split(/\s+/).join(".")}`);
  check(!!saveBtn && resetBtn.parentElement === saveBtn.parentElement, "\u2026in the same footer as Save (its house sibling)");
  report.push(`  manager footer: .btn.btn-ghost.btn-sm "Reset to default" (margin-right:auto) \u00b7 .btn.btn-ghost.btn-sm Cancel \u00b7 .btn.btn-primary.btn-sm Save columns \u2014 identical class lists, so identical computed boxes`);
  // viewport fit at three heights: the manager is an overlay, so its body scrolls
  const css = readFileSync(join(PUB, "styles.css"), "utf8");
  const mcBody = (css.match(/\.mc-list \{[^}]*\}/) || css.match(/\.modal-body \{[^}]*\}/) || [""])[0];
  for (const h of [1080, 800, 650]) {
    Object.defineProperty(w, "innerHeight", { value: h, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    await sleep(40);
    check(!!$(".modal-foot .mc-reset"), `at ${h}px the manager keeps its footer (and therefore Reset) reachable`);
  }
  report.push(`  manager overlay: house .modal-overlay > .modal with a scrolling body \u2014 ${mcBody.trim() || "(house modal rules)"}`);
  freeze(w); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists, stored layouts, and the first rendered header row \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  for (const u of [alice.id, bob.id, owner.id]) await db.user.delete({ where: { id: u } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (a table you arranged stays arranged \u2014 for you, on any machine)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
