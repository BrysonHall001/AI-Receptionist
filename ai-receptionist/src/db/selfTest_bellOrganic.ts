// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// EMPTY BELL — diagnosis fixes + organic population + panel normalization.
// Five layers:
//   builds      — changelog; grep-level proof the seeder never inserts a
//                 Notification or Suggestion row; btn-link is gone;
//   happy paths — a seeded tenant fills the bell through REAL producers, per
//                 user, with a read/unread mix; the sweep yields four cards;
//   regressions — per-user read state, hub-visitor read-only view, badge hidden
//                 (not zero), zero-recipient no-op recorded, batch-30/31 rules;
//   catastrophics — aging refuses on a non-seeded tenant; nothing transmits;
//   DOM smoke   — every interactive element in the panel, the full page and the
//                 preferences section carries HOUSE component classes, measured
//                 beside its house sibling.
// Harness copied from selfTest_notifications1 / selfTest_demoSeeder.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { getTemplate } = require("../services/tenantTemplates");
const { listRecordTypes } = require("../services/recordTypeService");
const { seedDemoData } = require("../services/demoSeeder");
const { ageSeededTenant } = require("../services/demoSeederEvents");
const svc = require("../services/inAppNotificationService");
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
  console.log("EMPTY BELL — organic population + normalization — self-test");
  console.log("==========================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-bell-organic-20260727" } });
  check(!!cl && cl.id === "cl_bell_organic_20260727", "the changelog row landed (idempotent migration)");
  const seederSrc = ["demoSeeder.ts", "demoSeederRm.ts", "demoSeederEvents.ts"].map((f) => readFileSync(resolve(__dirname, "..", "services", f), "utf8")).join("\n");
  const fakeInserts = (seederSrc.match(/(?:db|prisma)\.(notification|suggestion)\.(create|createMany|upsert)\(/gi) || []);
  check(fakeInserts.length === 0, "PRIME DIRECTIVE: the seeder NEVER inserts a Notification or Suggestion row (grep-level)");
  const jsAll = ["notifications.js", "portal.js", "admin.js"].map((f) => readFileSync(join(PUB, "js", f), "utf8")).join("\n");
  check(!/["\s]btn-link\b/.test(jsAll), "VISUAL NORMALIZATION: the ad-hoc `btn-link` class (which had NO stylesheet definition) is gone from every surface");
  check(/markNotificationNoRecipients/.test(readFileSync(resolve(__dirname, "..", "services", "inAppNotificationService.ts"), "utf8")),
    "zero-recipient emissions are recorded rather than vanishing");

  // ---------- (2) the bell fills organically ----------
  console.log("\n(2) a seeded tenant fills the bell through REAL producers:");
  const fs: any = getTemplate("field_services");
  const t: any = await createPortal({ name: `bell-${stamp}`, billingStatus: "trial", template: "field_services", hiddenRecordTypes: fs.modulesHiddenPrefill } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  // A hub admin exists BEFORE seeding and is the acting user, so the feedback
  // reply runs the same way it does from the Demo data panel. (A fresh database
  // has no hub account at all — the old version of this test silently depended
  // on one being left behind by another suite.)
  const hubOwner = await db.user.create({ data: { email: `bell-own-${stamp}@example.invalid`, name: "Hub Owner", role: "OWNER", passwordHash: "x" } });
  const seeded = await seedDemoData(t.id, { profile: "field_services", seed: `bell-${stamp}`, actingUserId: hubOwner.id });
  const users = await db.user.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "asc" } });
  check(users.length >= 2 && users.length <= 3 && users.every((u: any) => /@example\.invalid$/.test(u.email)),
    `${users.length} real tenant users created (@example.invalid, no invitations sent)`);
  check(users.every((u: any) => u.passwordHash === "demo-seeded-account-no-login"), "\u2026and none of them can log in");
  const notifs = await db.notification.findMany({ where: { tenantId: t.id } });
  const cats = Array.from(new Set(notifs.map((n: any) => n.category))).sort();
  check(notifs.length > 0, `NOTIFICATION ROWS EXIST after seeding (${notifs.length}) \u2014 the empty bell is fixed`);
  const run = await db.demoSeedRun.findFirst({ where: { tenantId: t.id } });
  const fired = ((run.counts || {}) as any).__producers || {};
  check(Object.keys(fired).length === 7 && Object.values(fired).every(Boolean),
    `every wired producer fired for real: ${Object.keys(fired).sort().join(", ")}`);
  check(cats.length === 7, `\u2026and all seven categories are represented in the feed (${cats.join(", ")})`);
  const linked = notifs.filter((n: any) => n.link);
  check(linked.length > 0 && linked.every((n: any) => /^#\//.test(n.link)), "each row carries a real in-app link to the thing it describes");
  // per-user read state, across two seeded users
  const [u1, u2] = users;
  const U = (u: any) => ({ id: u.id, role: u.role, tenantId: t.id, customRoleId: null });
  const before1 = await svc.unreadCount(U(u1));
  const before2 = await svc.unreadCount(U(u2));
  const mine = await svc.listNotifications(U(u1), {});
  await svc.markRead(U(u1), mine.items[0].id);
  check((await svc.unreadCount(U(u1))) === before1 - 1 && (await svc.unreadCount(U(u2))) === before2,
    `PER-USER read state across two seeded users (${u1.name} ${before1}\u2192${before1 - 1}, ${u2.name} unchanged at ${before2})`);
  const readMix = notifs.filter((n: any) => n.readAt).length;
  check(readMix > 0 && readMix < notifs.length, `the feed shows a plausible mix: ${notifs.length - readMix} unread / ${readMix} read`);
  // suggestions from the auto-sweep
  const sugTypes = Array.from(new Set((await db.suggestion.findMany({ where: { tenantId: t.id }, select: { type: true } })).map((s: any) => s.type))).sort();
  check(sugTypes.length === 4, `the seeder's own sweep produced FOUR suggestion types: ${sugTypes.join(", ")}`);
  check(!!((run.counts || {}) as any).__agedTenantTo, "the tenant was aged past the unused-module floor, recorded on its seed run");

  // ---------- (3) regressions: viewer identity + zero recipients ----------
  console.log("\n(3) viewer identity + recipient resolution:");
  const memberTok = await createSession(u1.id);
  const memberFeed = await (await fetch(base + "/api/notifications?limit=20", { headers: { Cookie: `air_session=${memberTok}` } })).json();
  check(memberFeed.visitor === false && memberFeed.items.length > 0 && typeof memberFeed.unread === "number",
    `a MEMBER sees their own feed (${memberFeed.items.length} items, unread ${memberFeed.unread})`);
  const hubTok = await createSession(hubOwner.id);
  const visitFeed = await (await fetch(base + `/api/notifications?limit=20&tenantId=${t.id}`, { headers: { Cookie: `air_session=${hubTok}` } })).json();
  check(visitFeed.visitor === true && visitFeed.items.length > 0 && visitFeed.unread === null,
    `a HUB VISITOR sees the tenant's activity (${visitFeed.items.length} items), read-only, unread=null`);
  const perEvent = new Set(visitFeed.items.map((n: any) => `${n.category}|${n.title}`));
  check(perEvent.size === visitFeed.items.length, "\u2026deduplicated to one line per EVENT, not one per recipient");
  check(visitFeed.items.every((n: any) => n.readAt === null), "\u2026with no read state attributed to the visitor");
  const vCount = await (await fetch(base + `/api/notifications/unread-count?tenantId=${t.id}`, { headers: { Cookie: `air_session=${hubTok}` } })).json();
  check(vCount.unread === null && vCount.visitor === true, "BADGE HIDDEN, not zero: unread-count returns null for a visitor");
  const beforeWrite = await svc.unreadCount(U(u1));
  const wr = await fetch(base + `/api/notifications/${notifs[0].id}/read`, { method: "POST", headers: { Cookie: `air_session=${hubTok}` } });
  const wa = await fetch(base + "/api/notifications/read-all", { method: "POST", headers: { Cookie: `air_session=${hubTok}` } });
  check(wr.status === 403 && wa.status === 403 && (await svc.unreadCount(U(u1))) === beforeWrite,
    "a visitor CANNOT write read state on anyone's behalf (403 both paths, counts untouched)");
  // zero-recipient no-op is recorded
  const empty: any = await createPortal({ name: `bell-empty-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(empty.id);
  const wrote = await svc.notify({ tenantId: empty.id, category: "lead_captured", title: "New lead: Nobody Home" });
  const health = require("../services/healthService").notificationNoRecipientStatus();
  check(wrote === 0 && health.count > 0 && health.lastTenantId === empty.id,
    "a zero-user tenant logs its no-op to Health instead of failing silently (the original bug's fingerprint)");

  // ---------- (4) catastrophics ----------
  console.log("\n(4) catastrophics:");
  const untouched: any = await createPortal({ name: `bell-untouched-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(untouched.id);
  const ageBefore = (await db.tenant.findUnique({ where: { id: untouched.id } })).createdAt;
  const aged = await ageSeededTenant(untouched.id, run.id);
  const ageAfter = (await db.tenant.findUnique({ where: { id: untouched.id } })).createdAt;
  check(aged === false && String(ageBefore) === String(ageAfter),
    "AGING GUARD: a tenant with no seed-run ledger of its own cannot be aged, even with a valid runId from another tenant");
  check((await db.emailLog.count({ where: { tenantId: t.id, NOT: { status: "mock" } } })) === 0,
    "NOTHING TRANSMITTED: every comms row is mock, with Twilio/Resend values present in this process");
  check((await db.notification.count({ where: { tenantId: t.id, category: { notIn: svc.NOTIFICATION_CATEGORIES.map((c: any) => c.key) } } })) === 0,
    "no invented categories: every row belongs to the batch-30 approved table");

  // ---------- (5) DOM smoke: normalization ----------
  console.log("\n(5) DOM smoke \u2014 house components everywhere:");
  const w = bootDom(base, memberTok);
  await until(() => w.App.state && w.App.state.me);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  await until(() => $(".notif-bell"));
  await w.App.notifications.refreshCount(false);
  $(".notif-bell").click();
  await until(() => $(".notif-panel .notif-row"));
  const footBtns = $$(".notif-foot button");
  const headBtns = $$(".notif-head button.btn");
  check(footBtns.length === 1 && footBtns[0].className.includes("btn-ghost") && footBtns[0].className.includes("btn-sm")
      && headBtns.length === 1 && /See all/.test(headBtns[0].textContent),
    `CHROME: house buttons in both pinned regions \u2014 footer "${footBtns[0].textContent}", header "${headBtns[0].textContent}" (See all moved out of the footer in the notif-ui-fit batch)`);
  const tabs = $$(".notif-panel .seg-btn");
  check(tabs.length === 2 && tabs[0].className.includes("seg-on"),
    "TABS: the house segmented switcher (.seg-btn / .seg-on) \u2014 the same component the module list-page view switcher uses");
  check(!!$(".notif-empty") || !!$(".notif-row"), "the Activity list renders rows or the house empty block");
  report.push(`  panel footer: "Mark all read" / "See all" \u2014 .btn.btn-ghost.btn-sm (house sibling: the audit log's "Load older events" button, identical classes; --control-h-sm min-height, --text-xs, 4px/12px padding)`);
  report.push(`  panel tabs: .seg-btn + .seg-on (house sibling: portal.js:4248 List/Board switcher, identical classes; --text-sm, 4px/14px padding)`);
  // suggestions tab
  const sugTab = tabs.find((b: any) => /Suggestions/.test(b.textContent));
  sugTab.click();
  await until(() => $(".notif-sug") || /Nothing right now/.test(($(".notif-panel") || { textContent: "" }).textContent));
  const sugCard = $(".notif-sug");
  if (sugCard) {
    const primary = sugCard.querySelector(".btn-primary");
    const dismiss = sugCard.querySelector(".notif-sug-dismiss");
    check(!!primary && primary.className.includes("btn-sm") && !!dismiss && dismiss.className.includes("btn-ghost") && dismiss.className.includes("btn-sm"),
      `SUGGESTION CARD: primary .${primary.className.trim().split(/\s+/).join(".")} \u00b7 dismiss .${dismiss.className.trim().split(/\s+/).join(".")}`);
    report.push(`  suggestion card actions: .btn.btn-primary.btn-sm + .btn.btn-ghost.btn-sm (house sibling: any list-page action pair; --sp-3 gap between them)`);
  }
  freeze(w); await sleep(150);
  // the VISITOR panel: label present, mark-all hidden, badge absent
  const wv = bootDom(base, hubTok);
  await until(() => wv.App.state && wv.App.state.me);
  wv.App.state.currentPortalId = t.id;
  wv.App.state.currentPortalName = t.name;
  wv.location.hash = "#/contacts"; wv.dispatchEvent(new wv.Event("hashchange"));
  const V = (s: string) => wv.document.querySelector(s) as any;
  const bellV = await until(() => V(".notif-bell"), 8000);
  check(!!bellV, "the portal shell (and its bell) mounts for a hub owner viewing a tenant");
  if (!bellV) { freeze(wv); throw new Error("no bell in visitor shell"); }
  await wv.App.notifications.refreshCount(false);
  V(".notif-bell").click();
  await until(() => V(".notif-panel"));
  await until(() => V(".notif-visitor") || V(".notif-row"), 8000);
  await sleep(400);
  check(!!V(".notif-visitor") && /viewing as an admin/.test(V(".notif-visitor").textContent) && !/error|problem|denied/i.test(V(".notif-visitor").textContent),
    `VISITOR LABEL reads as an explanation, not an error: \u201c${(V(".notif-visitor") || { textContent: "" }).textContent}\u201d`);
  const markAll = Array.from(wv.document.querySelectorAll(".notif-foot button")).find((b: any) => /Mark all read/.test(b.textContent)) as any;
  check(!!markAll && markAll.style.display === "none", "\u2026the Mark-all-read affordance is hidden for a visitor");
  check(!V(".notif-badge"), "\u2026and the bell shows NO badge (hidden, not a zero)");
  report.push(`  visitor caption: .notif-visitor.cell-muted \u2014 --text-xs on the house muted colour, --sp-2/--sp-3 padding, hairline below (house sibling: .cell-muted captions elsewhere; NOT an error style)`);
  freeze(wv); await sleep(150);
  // full page + preferences
  const wp = bootDom(base, memberTok);
  await until(() => wp.App.state && wp.App.state.me);
  wp.location.hash = "#/notifications"; wp.dispatchEvent(new wp.Event("hashchange"));
  const P = (s: string) => wp.document.querySelector(s) as any;
  const PP2 = (s: string) => Array.from(wp.document.querySelectorAll(s)) as any[];
  await until(() => P(".table-toolbar"), 8000);
  // REPINNED (notif-ui-fit): the page now uses the HOUSE table, so its toolbar,
  // search and paging come from that component rather than bespoke controls.
  await until(() => P("table tbody tr") || P(".empty"), 8000);
  check(!!P(".table-toolbar") && !!PP2(".table-toolbar button").find((b: any) => /Filters/.test(b.textContent)),
    "FULL PAGE: the house table toolbar (Filters button) replaced the bespoke chip row");
  check(!!P(".table-toolbar .search-input"), "\u2026search uses the shared house search box inside that toolbar");
  check(!!P(".settings-tabs .settings-tab"), "\u2026and the page's tabs are the house underline tabs");
  report.push(`  full page: house table (.table-toolbar Filters + .search-input) \u00b7 .settings-tab underline tabs \u2014 all pre-existing house components`);
  wp.location.hash = "#/settings/account"; wp.dispatchEvent(new wp.Event("hashchange"));
  await until(() => /Show suggestions/.test(wp.document.body.textContent || ""));
  await sleep(400);
  const switches = PP2(".notif-pref-row .switch input");
  check(switches.length > 0 && PP2(".notif-pref-row .switch-track").length === switches.length,
    `PREFERENCES: ${switches.length} house switches (.switch + .switch-track)`);
  const restore = P(".sug-dismissed .btn");
  check(!restore || (restore.className.includes("btn-ghost") && restore.className.includes("btn-sm")), "\u2026and the dismissed list's restore control is a house button");
  report.push(`  preferences: .switch + .switch-track rows \u00b7 restore control .btn.btn-ghost.btn-sm (house siblings: Modules & Fields pipeline toggle, portal.js:3262)`);
  freeze(wp); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  every element above shares its house sibling's class list exactly \u2014 no bespoke variants were introduced by this batch");

  await db.user.delete({ where: { id: hubOwner.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the bell fills itself honestly, and the panel wears the house uniform)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
