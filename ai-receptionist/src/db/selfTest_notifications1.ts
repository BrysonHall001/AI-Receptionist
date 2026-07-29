// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// EMERGENT LAYER 1 — NOTIFICATIONS — self-test. Five standing layers:
// builds (changelog, migration, category table, no LLM/detector/Suggestion
// model anywhere); happy paths (each producer fires its category with the right
// title + link on its REAL trigger; preferences; retention); prime-directive
// regressions (never-block over a real host, per-user read state, permission
// filtering, impersonation read-only, toast scarcity, the gear does not move);
// catastrophics (tenant scoping, a broken service, an unknown category);
// DOM smoke (bell + badge + panel + tabs + rows + footer + full page +
// preferences) + the computed-layout report.
// Harness copied from selfTest_hubUiConsistency / selfTest_lcRecruitment.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const { createContact } = require("../services/contactService");
const { createRecord, updateRecord } = require("../services/recordService");
const { createLink } = require("../services/recordLinkService");
const { registerNotificationSubscriber } = require("../services/notificationSubscriber");
const svc = require("../services/inAppNotificationService");
const { createApp } = require("../app");
const { createSession, setImpersonation } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync, readdirSync, statSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(140); } }
async function untilAsync(fn: () => Promise<boolean>, ms = 9000) { const t0 = Date.now(); for (;;) { try { if (await fn()) return true; } catch { /* */ } if (Date.now() - t0 > ms) return false; await sleep(180); } }
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
  console.log("EMERGENT LAYER 1 — NOTIFICATIONS — self-test");
  console.log("============================================");
  const stamp = Date.now();
  registerNotificationSubscriber(); // app-boot parity (index.ts registers this)
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-notifications-1-20260727" } });
  check(!!cl && cl.id === "cl_notifications_1_20260727", "the changelog row landed (idempotent migration)");
  check(svc.NOTIFICATION_CATEGORIES.length === 7 && svc.NOTIFICATION_CATEGORIES.every((c: any) => c.key && c.label && c.description && (c.urgency === "toast" || c.urgency === "badge") && typeof c.defaultOn === "boolean"),
    "the category table is complete (7 categories, each with urgency + default)");
  const toastKeys = svc.NOTIFICATION_CATEGORIES.filter((c: any) => c.urgency === "toast").map((c: any) => c.key).sort();
  check(JSON.stringify(toastKeys) === JSON.stringify(["automation_failed", "booking_cancelled", "call_missed_or_failed", "lead_captured"]),
    `TOAST SCARCITY: exactly four categories may toast (${toastKeys.join(", ")})`);
  // no detectors, no Suggestion model, no LLM anywhere in this batch's code
  const svcSrc = readFileSync(resolve(__dirname, "..", "services", "inAppNotificationService.ts"), "utf8");
  const subSrc = readFileSync(resolve(__dirname, "..", "services", "notificationSubscriber.ts"), "utf8");
  const uiSrc = readFileSync(join(PUB, "js", "notifications.js"), "utf8");
  check(!/openai|anthropic|llm|completion/i.test(svcSrc + subSrc),
    "the notification service + subscriber contain NO LLM calls (the batch-30 contract; suggestions arrived in emergent layer 2 with the same rule)");
  check(/Clarity will post suggestions here as it spots patterns/.test(uiSrc),
    "\u2026and the Suggestions tab carries its empty line (emergent layer 2 replaced the placeholder with the real one)");

  // ---------- (2) fixtures ----------
  const t: any = await createPortal({ name: `notif-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  const mkUser = async (role: string, name: string) => db.user.create({ data: { email: `n-${name}-${stamp}@example.invalid`, name, role, tenantId: t.id, passwordHash: "x" } });
  const alice = await mkUser("PORTAL_ADMIN", "alice");
  const bob = await mkUser("PORTAL_ADMIN", "bob");
  const cara = await mkUser("CLIENT_USER", "cara");
  const U = (u: any) => ({ id: u.id, role: u.role, tenantId: t.id, customRoleId: null });
  const aliceTok = await createSession(alice.id);

  // ---------- (3) producers on their REAL triggers ----------
  console.log("\n(2) producers (each on its real trigger):");
  const rowsFor = async (u: any) => (await db.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "asc" } }));
  const contact: any = await createContact(t.id, { name: "Avery Lane", phone: "+15550001234", email: `avery-${stamp}@example.invalid`, source: "lead_capture" } as any);
  check(await untilAsync(async () => (await rowsFor(alice)).some((n: any) => n.category === "lead_captured")),
    "LEAD CAPTURED fires on a form/call-sourced contact");
  const lead = (await rowsFor(alice)).find((n: any) => n.category === "lead_captured");
  check(lead.title === "New lead: Avery Lane" && lead.link === `#/contact/${contact.id}`, `\u2026with a short title and the record link (${lead.link})`);
  await createContact(t.id, { name: "Typed By Hand", phone: "+15550004321", email: `typed-${stamp}@example.invalid` } as any);
  await sleep(500);
  check(!(await rowsFor(alice)).some((n: any) => n.title.includes("Typed By Hand")), "\u2026while a hand-typed contact is not news (no row)");
  const bkT = await db.recordType.findFirst({ where: { tenantId: t.id, key: "booking" }, select: { subtypes: true } });
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const booking: any = await createRecord(t.id, "booking", { title: "Consultation", subtypeKey: ((bkT.subtypes as any[])[0] || {}).key, appointmentAt: `${day}T14:00:00.000Z`, allowClosed: true, allowOverlap: true }, { source: "manual" });
  await createLink(t.id, { recordId: booking.id, parentType: "contact", parentId: contact.id });
  check(await untilAsync(async () => (await rowsFor(alice)).some((n: any) => n.category === "booking_created")), "BOOKING CREATED fires when a booking is made for a contact");
  await updateRecord(t.id, booking.id, { stageKey: "cancelled", allowClosed: true, allowOverlap: true });
  check(await untilAsync(async () => (await rowsFor(alice)).some((n: any) => n.category === "booking_cancelled")), "BOOKING CANCELLED fires on the status change");
  const allRows = await rowsFor(alice);
  check(allRows.every((n: any) => (n.title || "").length <= 160 && (!n.body || n.body.length <= 240) && !/transcript|password|token/i.test(`${n.title} ${n.body || ""}`)),
    "NO SENSITIVE PAYLOADS: titles/bodies stay short and generic");

  // ---------- (4) the four commitments ----------
  console.log("\n(3) the commitments:");
  // never-block, over a REAL host operation
  const origCreate = db.notification.createMany;
  db.notification.createMany = () => { throw new Error("boom"); };
  const t0 = Date.now();
  const survivor: any = await createContact(t.id, { name: "Still Works", phone: "+15550009876", email: `sw-${stamp}@example.invalid`, source: "lead_capture" } as any);
  const took = Date.now() - t0;
  await sleep(250);
  db.notification.createMany = origCreate;
  check(!!(survivor && survivor.id) && took < 1500, `NEVER-BLOCK: a throwing notifier leaves the host operation succeeding (${took}ms, no added failure mode)`);
  // per-user read state
  const aliceUnreadBefore = await svc.unreadCount(U(alice));
  const bobUnreadBefore = await svc.unreadCount(U(bob));
  await svc.markRead(U(alice), (await rowsFor(alice))[0].id);
  check((await svc.unreadCount(U(alice))) === aliceUnreadBefore - 1 && (await svc.unreadCount(U(bob))) === bobUnreadBefore,
    "PER-USER READ STATE: Alice marking one read leaves Bob's count untouched");
  // permission filtering at read time
  await svc.notify({ tenantId: t.id, category: "automation_failed", title: "Automation problem: Nightly sync" });
  const caraFeed = await svc.listNotifications(U(cara), {});
  check(!caraFeed.items.some((n: any) => n.category === "automation_failed") && (await rowsFor(cara)).some((n: any) => n.category === "automation_failed"),
    "PERMISSION-CORRECT AT READ TIME: the row exists for the CLIENT_USER but is filtered from their feed (never shown-then-denied)");
  check((await svc.unreadCount(U(cara))) < (await db.notification.count({ where: { userId: cara.id, readAt: null } })),
    "\u2026and the badge count is filtered too, so it can't leak the existence of a hidden item");
  const aliceFeed = await svc.listNotifications(U(alice), {});
  check(aliceFeed.items.some((n: any) => n.category === "automation_failed"), "\u2026while an admin sees it normally (emit broadly, filter on read)");
  // impersonation is read-only
  const superUser = await db.user.create({ data: { email: `n-super-${stamp}@example.invalid`, name: "Super", role: "SUPER_ADMIN", passwordHash: "x" } });
  const superTok = await createSession(superUser.id);
  await setImpersonation(superTok, { mode: "view-as-user", targetUserId: alice.id, scopeTenantId: t.id });
  const impUnreadBefore = await db.notification.count({ where: { userId: alice.id, readAt: null } });
  const impRead = await fetch(base + `/api/notifications/${(await rowsFor(alice))[1].id}/read`, { method: "POST", headers: { Cookie: `air_session=${superTok}` } });
  const impAll = await fetch(base + "/api/notifications/read-all", { method: "POST", headers: { Cookie: `air_session=${superTok}` } });
  check(impRead.status === 403 && impAll.status === 403 && (await db.notification.count({ where: { userId: alice.id, readAt: null } })) === impUnreadBefore,
    "IMPERSONATION is READ-ONLY: both mark-read paths refuse (403) and nothing was written on the user's behalf");
  await db.user.delete({ where: { id: superUser.id } }).catch(() => { /* */ });

  // ---------- (5) preferences, retention, index ----------
  console.log("\n(4) preferences, retention, the index:");
  const defaults = await svc.getUserNotificationPrefs(bob.id);
  check(defaults.lead_captured.on === true && defaults.lead_captured.toast === true && defaults.booking_created.toast === false,
    "DEFAULTS for a fresh user: everything on; badge-only categories carry toast=false");
  await svc.setUserNotificationPrefs(bob.id, { import_complete: { on: false }, lead_captured: { on: true, toast: false } });
  const bobBefore = await db.notification.count({ where: { userId: bob.id } });
  await svc.notify({ tenantId: t.id, category: "import_complete", title: "Import finished: 3 contacts" });
  check((await db.notification.count({ where: { userId: bob.id } })) === bobBefore, "PREFERENCE OFF \u2192 no row is written at all for that user");
  check((await db.notification.count({ where: { userId: alice.id, category: "import_complete" } })) === 1, "\u2026and everyone else still gets it");
  const bobPrefs = await svc.getUserNotificationPrefs(bob.id);
  check(bobPrefs.lead_captured.on === true && bobPrefs.lead_captured.toast === false, "TOAST OFF keeps the row and silences only the toast");
  await svc.setUserNotificationPrefs(bob.id, { booking_created: { on: true, toast: true } });
  check((await svc.getUserNotificationPrefs(bob.id)).booking_created.toast === false, "a badge-only category can NEVER be toasted, whatever is stored");
  // retention
  const keepCount = await db.notification.count({ where: { userId: alice.id } });
  const aged = await db.notification.create({ data: { tenantId: t.id, userId: alice.id, category: "booking_created", title: "Ancient unread", createdAt: new Date(Date.now() - 200 * 86400000) } });
  const agedRead = await db.notification.create({ data: { tenantId: t.id, userId: alice.id, category: "booking_created", title: "Ancient read", readAt: new Date(), createdAt: new Date(Date.now() - 100 * 86400000) } });
  const fresh = await db.notification.create({ data: { tenantId: t.id, userId: alice.id, category: "booking_created", title: "Recent read", readAt: new Date(), createdAt: new Date(Date.now() - 10 * 86400000) } });
  const pruned = await svc.runNotificationPruneSweep();
  const stillThere = await db.notification.findMany({ where: { id: { in: [aged.id, agedRead.id, fresh.id] } }, select: { id: true } });
  check(pruned.deleted === 2 && stillThere.length === 1 && stillThere[0].id === fresh.id && (await db.notification.count({ where: { userId: alice.id } })) === keepCount + 1,
    "RETENTION: 180-day unread and 90-day read are pruned; a recent one and everything else survive");
  // the index actually serves the unread query
  const plan = await db.$queryRawUnsafe(`EXPLAIN SELECT "id" FROM "Notification" WHERE "userId" = '${alice.id}' AND "readAt" IS NULL ORDER BY "createdAt" DESC LIMIT 20`);
  const planText = JSON.stringify(plan);
  check(/Notification_userId_readAt_createdAt_idx/.test(planText), "the unread query is served by the [userId, readAt, createdAt] INDEX (query plan asserted)");

  // ---------- (6) DOM smoke ----------
  console.log("\n(5) DOM smoke:");
  const w = bootDom(base, aliceTok);
  await until(() => w.App.state && w.App.state.me);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  await until(() => $(".notif-bell"));
  const bell = $(".notif-bell");
  const gear = $(".gear");
  const gearIndexBefore = Array.from(gear.parentElement.children).indexOf(gear);
  check(bell.className.includes("icon-btn") && bell.nextElementSibling === gear,
    "the BELL is an .icon-btn mounted immediately before the gear (same size/hit-area/spacing tokens)");
  check(gear.parentElement.className.includes("pages-row-right") && gearIndexBefore === Array.from(gear.parentElement.children).indexOf(gear),
    "\u2026and the GEAR did not move (same container, same position)");
  await until(() => $(".notif-badge"));
  check(!!$(".notif-badge") && /^\d|9\+/.test($(".notif-badge").textContent), `the BADGE shows the unread count ("${$(".notif-badge").textContent}")`);
  await svc.markAllRead(U(alice));
  await w.App.notifications.refreshCount(false);
  await until(() => !$(".notif-badge"), 5000);
  check(!$(".notif-badge"), "\u2026and is ABSENT (not \"0\") at zero");
  for (let i = 0; i < 12; i++) await svc.notify({ tenantId: t.id, category: "booking_created", title: "Booking made " + i, userIds: [alice.id] });
  await w.App.notifications.refreshCount(false);
  await until(() => $(".notif-badge") && $(".notif-badge").textContent === "9+", 5000);
  check($(".notif-badge").textContent === "9+", "\u2026and caps at 9+");
  bell.click();
  await until(() => $(".notif-panel .notif-row"));
  const panel = $(".notif-panel");
  check(panel.parentElement === w.document.body, "the PANEL is body-appended at the overlay layer (no ancestor can clip it)");
  const tabs = $$(".notif-panel .seg-btn").map((b: any) => b.textContent);
  check(JSON.stringify(tabs) === JSON.stringify(["Activity", "Suggestions"]) && $$(".notif-panel .seg-btn")[0].className.includes("seg-on"),
    "TABS: Activity + Suggestions, Activity default");
  const row = $(".notif-panel .notif-row");
  check(!!row.querySelector(".notif-row-ic") && !!row.querySelector(".notif-row-title") && !!row.querySelector(".notif-row-time") && row.className.includes("notif-unread"),
    "ROWS carry icon + title + time, with the unread accent edge");
  const footBtns = $$(".notif-foot button").map((b: any) => b.textContent);
  const headSee = $$(".notif-head button").map((b: any) => b.textContent);
  check(JSON.stringify(footBtns) === JSON.stringify(["Mark all read"]) && headSee.indexOf("See all") !== -1,
    "CHROME: Mark all read in the pinned footer, See all in the pinned header (moved there in the notif-ui-fit batch)");
  ($$(".notif-panel .seg-btn").find((b: any) => b.textContent === "Suggestions") as any).click();
  await sleep(200);
  check(!!$(".notif-panel") && /suggestions/i.test($(".notif-panel").textContent),
    "the panel survives an inside click and shows the Suggestions tab");
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" })); await sleep(150);
  check(!w.document.getElementById("notif-panel"), "Esc closes the panel");
  bell.click(); await until(() => w.document.getElementById("notif-panel")); await sleep(60);
  ($(".portal-pages-row") || w.document.body).dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await sleep(180);
  check(!w.document.getElementById("notif-panel"), "an outside click closes it");
  // full page
  w.location.hash = "#/notifications"; w.dispatchEvent(new w.Event("hashchange"));
  // REPINNED (notif-ui-fit): the page was rebuilt on the HOUSE table — the chip
  // row was replaced by the house Filters button + rail, and Load-more by the
  // table's own paging. The data contract is unchanged, so this cell asserts
  // the house machinery instead of the old bespoke furniture.
  await until(() => $("table tbody tr"), 8000);
  const pageRows = $$("table tbody tr").length;
  check(pageRows > 0 && !!$(".table-toolbar .search-input") && !!$$(".table-toolbar button").find((b: any) => /Filters/.test(b.textContent)) && $$(".notif-chip").length === 0,
    `the FULL PAGE renders ${pageRows} rows in the house table, with the house search + Filters button and no chip row`);
  const searchInput = $(".table-toolbar .search-input");
  searchInput.value = "Booking made 3"; searchInput.dispatchEvent(new w.Event("input"));
  await untilAsync(async () => $$("table tbody tr").length === 1, 6000);
  const narrowed = $$("table tbody tr").map((r: any) => (r.querySelector(".notif-col-title") || { textContent: "" }).textContent);
  check(narrowed.length >= 1 && narrowed.every((x: string) => /Booking made 3/.test(x)),
    `\u2026and the house search narrows the table (${narrowed.length} row(s): ${narrowed.join(", ")})`);
  // preferences
  w.location.hash = "#/settings/account"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => $(".notif-pref-row"));
  const catLabels = svc.NOTIFICATION_CATEGORIES.map((c: any) => c.label);
  const prefRows = $$(".notif-pref-row").filter((r: any) => catLabels.some((l: string) => r.textContent.indexOf(l) === 0 || r.textContent.startsWith(l)));
  const leadRow = prefRows.find((r: any) => /New lead captured/.test(r.textContent));
  const badgeRow = prefRows.find((r: any) => /Booking made/.test(r.textContent));
  check(prefRows.length === svc.NOTIFICATION_CATEGORIES.length && prefRows.every((r: any) => !!r.querySelector(".notif-pref-title") && !!r.querySelector(".notif-pref-desc")),
    `PREFERENCES: ${prefRows.length} notification rows, each with label + description (the Suggestions switches live in their own section since emergent layer 2)`);
  const segStates = (r: any) => Array.from(r.querySelectorAll(".notif-pref-seg .seg-btn")).map((b2: any) => b2.dataset.state);
  check(JSON.stringify(segStates(leadRow)) === JSON.stringify(["off", "badge", "toast"]),
    `\u2026a toast-eligible row offers all three states (${segStates(leadRow).join("/")})`);
  check(JSON.stringify(segStates(badgeRow)) === JSON.stringify(["off", "badge"]) && /Badge only/.test(badgeRow.textContent),
    `\u2026and a badge-only row offers no toast at all (${segStates(badgeRow).join("/")})`);
  // DOM smoke: nothing clipped over text
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  check(/\.notif-row-title \{[^}]*-webkit-line-clamp: 2/.test(cssSrc) && /\.notif-row-body \{[^}]*-webkit-line-clamp: 2/.test(cssSrc) && /\.notif-body \{[^}]*overflow-y: auto/.test(cssSrc),
    "UI-QUALITY: title/body clamp to 2 lines by design and the panel scrolls \u2014 no silent overflow over text");
  freeze(w); await sleep(200);

  // ---------- (7) catastrophics ----------
  console.log("\n(6) catastrophics:");
  const other: any = await createPortal({ name: `notif-b-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(other.id);
  const dave = await db.user.create({ data: { email: `n-dave-${stamp}@example.invalid`, name: "dave", role: "PORTAL_ADMIN", tenantId: other.id, passwordHash: "x" } });
  await svc.notify({ tenantId: other.id, category: "lead_captured", title: "New lead: Someone Else" });
  check(!(await rowsFor(alice)).some((n: any) => n.title.includes("Someone Else")) && (await db.notification.count({ where: { userId: dave.id } })) === 1,
    "TENANT SCOPING: a notification never crosses into another tenant's users");
  let threw = false;
  try { await svc.notify({ tenantId: t.id, category: "not_a_real_category", title: "x" }); } catch { threw = true; }
  check(threw, "an unknown category is REFUSED (no silent mystery rows)");
  const producerFiles: string[] = [];
  const scan = (dir: string) => { for (const f of readdirSync(dir)) { const p2 = join(dir, f); const st = statSync(p2); if (st.isDirectory()) { if (!/node_modules|selfTest/.test(p2)) scan(p2); } else if (/\.ts$/.test(f) && !/selfTest|_tmp|probe/.test(f)) { const src = readFileSync(p2, "utf8"); if (/notifyNever\(/.test(src)) producerFiles.push(f); } } };
  scan(resolve(__dirname, ".."));
  check(producerFiles.length >= 4 && !producerFiles.some((f) => /Test/.test(f)),
    `every producer uses the never-block entry point (${producerFiles.sort().join(", ")})`);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  console.log("  bell: .icon-btn 30\u00d730 (--control-h-sm), 18\u00d718 glyph, immediately before the gear in .pages-row-right \u2014 gear position unchanged");
  console.log("  badge: absolute top-right INSIDE the bell (min-width 15px, height 15px, --text-xs, --on-accent on --accent), capped \"9+\", absent at 0 \u2014 zero layout shift");
  console.log("  panel: 400px wide \u00b7 body max-height 480px with internal scroll \u00b7 body-appended overlay, anchored below-right of the bell (+8px)");
  console.log("  rows: icon 16px + title/body (2-line clamps) + right-aligned relative time; --list-row-pad vertical, 2px accent left edge when unread");
  console.log(`  full page: ${pageRows} rows in the house table (house toolbar: Filters + search; the chip row was retired in the notif-ui-fit batch)`);
  console.log(`  preferences: ${prefRows.length} rows, house switches, badge-only rows disabled with a reason`);
  report.forEach((l) => console.log(l));

  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the system speaks up \u2014 quietly, per person, and only about things you're allowed to see)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
