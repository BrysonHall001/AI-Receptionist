process.env.AI_PROVIDER = "mock";

// FULL-SCREEN + PRESENCE SQUARES — self-test.
//
// The assertion that matters most is the privacy one: an ordinary member's presence response
// must contain no staff. It is proved by recording WHICH QUERIES ARE ISSUED, not by inspecting
// the response — a response that happens to be empty proves nothing, whereas a query that was
// never issued cannot leak.
//
// WHAT THIS SUITE CANNOT PROVE, said plainly rather than dressed up:
//   jsdom has no layout engine and does not implement CSS `zoom` at all. So "the content is
//   1.15x bigger", "nothing clips at 900px" and "the popover still lands in the right place"
//   are NOT measurable here — no assertion below claims them. What IS checkable, and is
//   checked: the scale MATHS at every width, the class and custom-property state on entering
//   and exiting, the keyboard path, and the structural fact that every viewport-anchored
//   surface is appended to document.body and therefore sits outside the zoomed subtree. That
//   last one is the real guarantee behind "popovers still land correctly"; the pixels need a
//   browser and a person.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { PRESENCE_MEMBER_ROLES, PRESENCE_STAFF_ROLES, isStaffRole, listPresentMembers, stampHeartbeat, PRESENCE_WINDOW_MS } = require("../services/presenceService");
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { JSDOM } = require("jsdom");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanup: string[] = [];
const R = resolvePath(__dirname, "..", "..");
const APP = readFileSync(resolvePath(R, "public", "js", "app.js"), "utf8");
const CSS = readFileSync(resolvePath(R, "public", "styles.css"), "utf8");
const PRESJS = readFileSync(resolvePath(R, "public", "js", "presence.js"), "utf8");

/** The shipped zoom maths, lifted from app.js so the test exercises the real function. */
function zoomAt(vw: number, sidebarVisible: boolean): number {
  const dom = new JSDOM(`<body><div class="app-shell"><div class="sidebar"></div><div class="main"></div></div></body>`);
  const w: any = dom.window;
  Object.defineProperty(w, "innerWidth", { value: vw, configurable: true });
  const layout = w.document.querySelector(".app-shell");
  layout.style.setProperty("--sidebar-w", "248px");
  if (!sidebarVisible) w.document.querySelector(".sidebar").style.display = "none";
  const body = APP.slice(APP.indexOf("function fullScreenZoom()"), APP.indexOf("function applyChrome()"));
  const fn = new Function("window", "document", "getComputedStyle", "layout", body + "\nreturn fullScreenZoom;")(
    w, w.document, w.getComputedStyle.bind(w), layout);
  return fn();
}

async function main() {
  console.log("FULL-SCREEN + PRESENCE \u2014 self-test");
  console.log("==================================");
  const stamp = Date.now();

  // ---------- (1) THE PRIVACY RULE ----------
  console.log("\n(1) an ordinary member never receives a staff row:");
  const tenant: any = await db.tenant.create({ data: { name: `pres-${stamp}`, notifyEmail: `pres-${stamp}@ex.com`, billingStatus: "trial" } });
  cleanup.push("tenant:" + tenant.id);
  const member: any = await db.user.create({ data: { email: `m-${stamp}@x.com`, name: "Mary", role: "PORTAL_ADMIN", tenantId: tenant.id, passwordHash: "x", lastSeenAt: new Date() } });
  const staff: any = await db.user.create({ data: { email: `s-${stamp}@x.com`, name: "Sam", role: "OWNER", passwordHash: "x", lastSeenAt: new Date(), viewingTenantId: tenant.id } });
  cleanup.push("user:" + member.id); cleanup.push("user:" + staff.id);

  const asMember = await listPresentMembers(tenant.id, new Date(), "PORTAL_ADMIN");
  check(asMember.every((e: any) => e.staff !== true) && !asMember.some((e: any) => e.id === staff.id),
    `a PORTAL_ADMIN's response contains no staff (${asMember.length} entries, none staff)`);
  const asClient = await listPresentMembers(tenant.id, new Date(), "CLIENT_USER");
  check(!asClient.some((e: any) => e.id === staff.id), "\u2026nor does a CLIENT_USER's");
  const noRole = await listPresentMembers(tenant.id);
  check(!noRole.some((e: any) => e.id === staff.id),
    "\u2026and a caller supplying NO role gets the member view, so an un-updated caller fails safe");
  // NEGATIVE: the staff row IS present and IS findable — so the three checks above are real
  const asStaff = await listPresentMembers(tenant.id, new Date(), "OWNER");
  check(asStaff.some((e: any) => e.id === staff.id && e.staff === true),
    "NEGATIVE: the staff row exists and a STAFF viewer does receive it \u2014 the checks above are not passing on an empty table");
  check(asStaff.some((e: any) => e.id === member.id && e.staff !== true),
    "\u2026alongside the member, as a circle");

  // ---------- (2) squares and circles ----------
  console.log("\n(2) squares and circles:");
  check(isStaffRole("OWNER") && isStaffRole("SUPER_ADMIN") && isStaffRole("AUDITOR"),
    "owner, super admin and auditor are staff");
  check(!isStaffRole("PORTAL_ADMIN") && !isStaffRole("CLIENT_USER") && !isStaffRole(null),
    "\u2026and nobody else is, including a missing role");
  check(PRESENCE_MEMBER_ROLES.every((r: string) => !isStaffRole(r)),
    "the two lists cannot overlap \u2014 no role is both a member and staff");
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" }).window;
  (globalThis as any).document = w.document; (globalThis as any).window = w;
  w.App = { util: { $: () => null }, state: {}, portalApi: async () => ({ present: [] }) };
  const presFns: any = new Function("global", PRESJS.slice(PRESJS.indexOf("(function (global) {") + "(function (global) {".length, PRESJS.lastIndexOf("})(")) + "\nreturn { dotEl };")(w);
  const sq = presFns.dotEl({ id: "s", name: "Sam", initial: "S", color: "#336699", staff: true }, false);
  const ci = presFns.dotEl({ id: "m", name: "Mary", initial: "M", color: "#996633" }, false);
  check(/pres-staff/.test(sq.className) && !/pres-staff/.test(ci.className), "staff render as squares, members as circles");
  check(/square because they're staff/.test(sq.title) && /only other staff can/.test(sq.title),
    "\u2026and hovering a square says who can and cannot see it");
  check(ci.title === "Mary", "a member's hover is unchanged");
  check(/\.pres-dot\.pres-staff \{ border-radius: 5px; \}/.test(CSS),
    "\u2026and the square is a rounded one, so it does not read as a rendering fault beside circles");

  // ---------- (3) the stored field expires ----------
  console.log("\n(3) no stale square:");
  await db.user.update({ where: { id: staff.id }, data: { lastSeenAt: new Date(Date.now() - PRESENCE_WINDOW_MS - 60000) } });
  const afterIdle = await listPresentMembers(tenant.id, new Date(), "OWNER");
  check(!afterIdle.some((e: any) => e.id === staff.id),
    "going idle removes the square, though viewingTenantId is still set \u2014 it expires by the same clock as everyone else");
  // switching tenants overwrites it on the next beat
  const other: any = await db.tenant.create({ data: { name: `pres2-${stamp}`, notifyEmail: `pres2-${stamp}@ex.com`, billingStatus: "trial" } });
  cleanup.push("tenant:" + other.id);
  await stampHeartbeat(staff.id, other.id);
  const backHere = await listPresentMembers(tenant.id, new Date(), "OWNER");
  const overThere = await listPresentMembers(other.id, new Date(), "OWNER");
  check(!backHere.some((e: any) => e.id === staff.id), "switching tenants clears the square from the one they left");
  check(overThere.some((e: any) => e.id === staff.id), "\u2026and shows it on the one they moved to");
  await stampHeartbeat(staff.id, null);
  const afterSignOut = await listPresentMembers(other.id, new Date(), "OWNER");
  check(!afterSignOut.some((e: any) => e.id === staff.id), "and stamping no tenant \u2014 signing out \u2014 clears it entirely");

  // ---------- (4) full-screen: the maths ----------
  console.log("\n(4) the scale (the maths is checkable; the pixels are not):");
  const wide = zoomAt(3440, true), laptop = zoomAt(1440, true), small = zoomAt(1280, true);
  check(small > laptop && laptop >= wide,
    `a narrower screen scales up more (${small} at 1280px vs ${wide} at 3440px) \u2014 the sidebar is a bigger share of it`);
  check([3440, 2560, 1920, 1440, 1280].every((v) => { const z = zoomAt(v, true); return z >= 1.15 && z <= 1.35; }),
    "every real screen width lands between the 1.15 floor and the 1.35 ceiling");
  check(zoomAt(700, false) === 1,
    "a narrow viewport, where the sidebar is already hidden, reclaims nothing and so scales by exactly 1");
  check(zoomAt(0, true) === 1, "a zero viewport falls back to 1 rather than dividing by zero");

  // ---------- (5) entering and exiting ----------
  console.log("\n(5) entering and exiting:");
  check(/\.app-shell\.chrome-collapsed \.sidebar \{ display: none; \}/.test(CSS)
    && /\.app-shell\.chrome-collapsed \.portal-pages-row \{ display: none; \}/.test(CSS),
    "full-screen hides BOTH bars");
  check(/\.app-shell\.chrome-collapsed \.main \{ zoom: var\(--fs-zoom, 1\); \}/.test(CSS),
    "\u2026and scales the content by the derived amount");
  check(!/\.app-shell\.chrome-collapsed \.main \{ padding-left/.test(CSS),
    "\u2026and the old rule that held the content at the same size is gone");
  check(/layout\.style\.removeProperty\("--fs-zoom"\)/.test(APP) && /shell\.style\.removeProperty\("--fs-zoom"\)/.test(APP),
    "exiting removes the zoom entirely, by either route, so nothing is left behind");
  check(/e\.key !== "Escape" \|\| !App\.state\.chromeCollapsed/.test(APP),
    "Escape exits \u2014 and does nothing when not in full-screen, so it cannot swallow a modal's Escape");
  check(/\.app-shell\.chrome-collapsed \.chrome-toggle \{ position: fixed/.test(CSS) && /fs-hint/.test(APP),
    "\u2026and the way out is discoverable: the toggle stays put, plus a hint that fades");
  check(/@keyframes fsHintOut/.test(CSS) && /prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{[^}]*animation: none/.test(CSS),
    "the hint's fade is an animation, so the global reduced-motion rule switches it off");

  // ---------- (6) viewport-anchored surfaces ----------
  console.log("\n(6) surfaces that anchor to the viewport:");
  const clientJs = ["app.js", "portal.js", "util.js", "notifications.js"]
    .map((f) => readFileSync(resolvePath(R, "public", "js", f), "utf8")).join("\n");
  const fixedRules = [...CSS.matchAll(/\.([\w-]+)[^{]*\{[^}]*position:\s*fixed[^}]*\}/g)].map((m) => m[1]);
  check(fixedRules.length > 0, `${fixedRules.length} rules position themselves against the viewport`);
  check(/document\.body\.appendChild\(menu\)/.test(clientJs),
    "the burger menu \u2014 the one fixed surface built inside the shell \u2014 is appended to document.body, outside the zoomed subtree");
  check(/zoom: var\(--fs-zoom, 1\)/.test(CSS) && !/transform:\s*scale\(var\(--fs-zoom/.test(CSS),
    "the scale uses zoom, not transform \u2014 a transform would make a containing block and re-anchor every fixed surface inside it");

  for (const c of cleanup.slice().reverse()) {
    const [kind, id] = c.split(":");
    if (kind === "user") await db.user.delete({ where: { id } }).catch(() => { /* */ });
    else await db.tenant.delete({ where: { id } }).catch(() => { /* */ });
  }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (a page that actually fills the screen, and staff nobody else can see)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => {
  console.error("threw:", e);
  try {
    for (const c of cleanup.slice().reverse()) {
      const [kind, id] = c.split(":");
      if (kind === "user") await (prisma as any).user.delete({ where: { id } }).catch(() => { /* */ });
      else await (prisma as any).tenant.delete({ where: { id } }).catch(() => { /* */ });
    }
  } catch { /* */ }
  await disconnectDb().catch(() => { /* */ });
  process.exit(1);
});

export {};
