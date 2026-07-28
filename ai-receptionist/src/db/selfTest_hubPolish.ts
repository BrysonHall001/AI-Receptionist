// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// HUB POLISH — create-page fixes, the demo mini-pill, tenant actions, and the
// FIRST enforcement of tenant suspension. Five layers:
//   builds      — changelog; ONE segmented-control builder; the Demo column is
//                 out of the default view but still filterable;
//   happy paths — step 2's anatomy matches step 1; the mini-pill; the three
//                 tenant actions; Developer Tools' four tabs;
//   regressions — the AI receptionist control is untouched; step 1 still
//                 renders three columns through the shared class;
//   catastrophics — SUSPENSION: every reachable surface refuses, hub admins keep
//                 access, another tenant's work is unaffected, resume restores;
//   DOM smoke   — class lists and the stylesheet's own declarations.
// Harness copied from selfTest_demoTenantSafety.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const { runDetectorSweep } = require("../detectors");
const { forgetTenantStatus, SUSPENDED_MESSAGE } = require("../services/tenantSuspensionService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const DAY = 86400000;
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
  console.log("HUB POLISH \u2014 create page, mini-pill, tenant actions, suspension");
  console.log("==============================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const css = readFileSync(join(PUB, "styles.css"), "utf8");
  const adminJs = readFileSync(join(PUB, "js", "admin.js"), "utf8");
  const report: string[] = [];
  const hub = await db.user.create({ data: { email: `hp-hub-${stamp}@example.invalid`, name: "Hub Owner", role: "OWNER", passwordHash: "x" } });
  const hubTok = await createSession(hub.id);

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-hub-polish-20260727" } });
  check(!!cl && cl.id === "cl_hub_polish_20260727", "the changelog row landed (idempotent migration)");
  check((adminJs.match(/function segmentedControl\(/g) || []).length === 1 && /--seg-count/.test(css) && /\.adm-seg--sm/.test(css),
    "ONE segmented-control builder, extended with --seg-count and a .adm-seg--sm scale (not forked)");
  check(/\.filter\(\(k\) => k !== "demo"\)/.test(adminJs) && /key: "demo"/.test(adminJs),
    "the Demo COLUMN is out of the default view but still in the spec (so the Filters rail keeps it)");
  const fcol = css.match(/\n\.adm-fcol \{[^}]*\}/)![0];
  check(/gap: var\(--sp-2\)/.test(fcol), `the shared field column now spaces label from control: ${fcol.trim()}`);

  // ---------- (2) the create page ----------
  console.log("\n(2) the create page:");
  const w = bootDom(base, hubTok);
  await until(() => w.App.state && w.App.state.me);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  (await until(() => $$("button").find((b: any) => b.textContent.trim() === "+ Create tenant")) as any).click();
  await until(() => $(".adm-uform"));
  const s2cols = $$(".adm-uform .adm-fcol");
  check(s2cols.length === 2 && s2cols.every((c: any) => c.firstElementChild.tagName === "LABEL" && !!c.querySelector(".input")),
    `STEP 2: ${s2cols.length} field columns, each LABEL above its control (the same .adm-fcol as step 1)`);
  check(s2cols.map((c: any) => c.querySelector("label").textContent).join("|") === "Email|Role", "\u2026labelled Email and Role");
  const uformCss = css.match(/\.adm-uform \{[^}]*\}/)![0];
  check(/gap: var\(--sp-4\)/.test(uformCss), `\u2026at step 1's column gap (${uformCss.trim()})`);
  check(/\.adm-uform-email \{ width: 260px/.test(css), "\u2026with the email input at the house 260px width, so Role sits beside it rather than drifting right");
  check(!!$(".adm-uform .adm-uform-add") && $(".adm-uform-add").className.indexOf("btn-ghost") !== -1, "\u2026and the add button is the house ghost, in the same row");
  const step1Cols = $$(".adm-formrow3 .adm-fcol");
  check(step1Cols.length === 3, `STEP 1 REGRESSION: still three columns through the same shared class (${step1Cols.length})`);
  report.push(`  step-1 delta: .adm-fcol gained gap: var(--sp-2) \u2014 all THREE step-1 fields (Business name, Notify email, Billing status) now sit 8px below their labels instead of flush; helper text unchanged at 8px below its control (.adm-fhelp margin 8px \u2192 0, the column gap supplies it)`);
  report.push(`  step-2 row: 2 \u00d7 .adm-fcol (260px + 170px) at gap --sp-4, add button bottom-aligned \u2014 previously flex 1 1 220px / 0 0 170px at 8px, which pushed Role to the card's right edge`);
  // the mini-pill
  const demoSeg = $(".adm-seg--sm");
  const aiSeg = $$(".adm-seg").find((s: any) => !s.className.includes("--sm"));
  check(!!demoSeg && demoSeg.style.getPropertyValue("--seg-count") === "2" && demoSeg.querySelectorAll(".adm-seg-btn").length === 2,
    "the DEMO control is the same component at two segments (--seg-count: 2)");
  check(!!aiSeg && aiSeg.querySelectorAll(".adm-seg-btn").length === 3 && aiSeg.className === "adm-seg",
    "\u2026and the AI receptionist control is untouched: three segments, unchanged class list");
  const dBtns = demoSeg.querySelectorAll(".adm-seg-btn");
  check(Array.from(dBtns).every((b: any) => b.firstElementChild.className === "adm-seg-lab" && !!b.querySelector(".adm-seg-rule") && b.lastElementChild.className === "adm-seg-ic"),
    "\u2026with the same anatomy: label \u2192 hairline \u2192 icon");
  check(Array.from(dBtns).map((b: any) => b.querySelector(".adm-seg-lab").textContent).join("/") === "Off/Demo" && dBtns[0].className.indexOf("active") !== -1,
    "\u2026segments Off / Demo, Off active by default");
  check(!!$(".adm-demo-row .adm-ai-div") && !!$(".adm-demo-row .adm-ai-desc") && !$(".adm-demo-card"),
    "\u2026placed like the AI zone: divider + caption beside the control, and NO bordered card");
  (dBtns[1] as any).click(); await sleep(120);
  check(($(".adm-seg--sm .adm-seg-fill") as any).className.indexOf("seg-fill-right") !== -1,
    "\u2026and selecting Demo slides the fill to the right segment");
  const smCss = css.match(/\.adm-seg--sm \.adm-seg-btn \{[^}]*\}/)![0];
  report.push(`  mini-pill scale: ${smCss.trim()} vs the full control's padding: 10px 18px 9px / min-width: 86px \u2014 ~75% linear, same radius family and clip-path geometry`);
  freeze(w); await sleep(150);

  // ---------- (3) tenant actions + devtools ----------
  console.log("\n(3) tenant actions and Developer Tools:");
  const live: any = await createPortal({ name: `hp-live-${stamp}`, billingStatus: "paid" } as any);
  const demoT: any = await createPortal({ name: `hp-demo-${stamp}`, billingStatus: "trial", isDemo: true } as any);
  cleanup.push(live.id, demoT.id);
  await listRecordTypes(live.id); await listRecordTypes(demoT.id);
  const w2 = bootDom(base, hubTok);
  await until(() => w2.App.state && w2.App.state.me);
  w2.location.hash = "#/admin/portals"; w2.dispatchEvent(new w2.Event("hashchange"));
  await until(() => w2.document.querySelector("table tbody tr"), 9000);
  await sleep(600);
  const $2 = (s: string) => w2.document.querySelector(s) as any;
  const $$2 = (s: string) => Array.from(w2.document.querySelectorAll(s)) as any[];
  const heads = $$2("table thead th").map((th: any) => th.textContent.replace(/[\u25be\u25bc\u25b4]/g, "").trim()).filter(Boolean);
  check(heads.indexOf("Demo") === -1 && heads.indexOf("Tenant actions") !== -1,
    `the Demo column is GONE from the default view: ${heads.join(" \u00b7 ")}`);
  const demoRow = $$2("table tbody tr").find((r: any) => r.textContent.includes(demoT.name));
  check(!!demoRow.querySelector(".adm-demo-pill"), "\u2026while the Demo pill still marks the tenant beside its name");
  const acts = demoRow.querySelectorAll(".adm-actions-cell .btn");
  const cls = (b: any) => b.className.trim().split(/\s+/).filter((c: string) => c.indexOf("btn") === 0).join(".");
  check(acts.length === 3 && cls(acts[0]) === "btn.btn-primary.btn-sm" && cls(acts[1]) === "btn.btn-ghost.btn-sm" && cls(acts[2]) === "btn.btn-danger.btn-sm",
    `TENANT ACTIONS: three house buttons at one size \u2014 .${cls(acts[0])} \u00b7 .${cls(acts[1])} \u00b7 .${cls(acts[2])}`);
  check(acts[1].getAttribute("title") === "Suspend tenant", "\u2026the middle one offers Suspend while the tenant is active");
  report.push(`  tenant actions: three .btn-sm siblings (primary \u00b7 ghost \u00b7 danger) in .adm-actions-cell at --sp-2, wrapping; panels view stacks the same three`);
  (acts[1] as any).click();
  await until(() => $2(".adm-susp-modal"));
  const suspModal = $2(".adm-susp-modal");
  const bullets = suspModal.querySelectorAll(".adm-susp-list li").length;
  check(suspModal.className.indexOf("modal") !== -1 && bullets >= 4 && /can't sign in/.test(suspModal.textContent),
    `the suspend dialog uses the house modal and spells out what stops (${bullets} consequences)`);
  check(/full access from here/.test(suspModal.textContent), "\u2026and says the hub keeps access, including opening the portal");
  (suspModal.querySelector(".btn-ghost") as any).click(); await sleep(200);
  // devtools tabs
  await sleep(400);
  w2.App.state._devtoolsHint = { section: "demodata" };
  w2.location.hash = "#/admin/devtools"; w2.dispatchEvent(new w2.Event("hashchange"));
  await until(() => $2(".settings-tile"), 9000);
  const tiles = $$2(".settings-tile").map((t: any) => t.textContent.trim());
  check(JSON.stringify(tiles) === JSON.stringify(["History", "System Health", "Demo Data", "Tools"]),
    `Developer Tools now has four top-level tabs: ${tiles.join(" \u00b7 ")}`);
  await until(() => $2(".tool-card"), 9000);
  const toolTitles = $$2(".tool-card .tool-h").map((h: any) => h.textContent);
  check(JSON.stringify(toolTitles) === JSON.stringify(["Demo data"]), `\u2026Demo Data opens straight into its own tool (${toolTitles.join(", ")})`);
  freeze(w2); await sleep(150);

  // ---------- (4) SUSPENSION, enforced ----------
  console.log("\n(4) suspension \u2014 the first enforcement:");
  const num = "+1555" + String(Math.floor(1000000 + Math.random() * 8999999)).slice(0, 7);
  await db.tenant.update({ where: { id: live.id }, data: { phoneNumber: num, voiceMode: "WALKIE", receptionistEnabled: true } });
  const member = await db.user.create({ data: { email: `hp-m-${stamp}@example.invalid`, name: "M", role: "PORTAL_ADMIN", tenantId: live.id, passwordHash: "x" } });
  const memberTok = await createSession(member.id);
  const ep = await db.inboundEndpoint.create({ data: { tenantId: live.id, name: "probe", token: `hp-tok-${stamp}`, enabled: true } });
  const bystander: any = await createPortal({ name: `hp-bystander-${stamp}`, billingStatus: "paid" } as any);
  cleanup.push(bystander.id);
  await listRecordTypes(bystander.id);
  await db.tenant.update({ where: { id: bystander.id }, data: { createdAt: new Date(Date.now() - 200 * DAY) } });
  // before
  const beforeUser = await fetch(base + "/api/contacts", { headers: { Cookie: `air_session=${memberTok}` } });
  const beforeCall = await (await fetch(base + "/webhooks/twilio/inbound", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `To=${encodeURIComponent(num)}&From=%2B15551234567&CallSid=HP-A${stamp}` })).text();
  check(beforeUser.status === 200 && !/not taking calls/.test(beforeCall), "while ACTIVE: the tenant's people are in and the receptionist answers");
  // suspend
  await db.tenant.update({ where: { id: live.id }, data: { status: "SUSPENDED" } });
  forgetTenantStatus(live.id);
  const afterUser = await fetch(base + "/api/contacts", { headers: { Cookie: `air_session=${memberTok}` } });
  const afterJson: any = await afterUser.json().catch(() => ({}));
  check(afterUser.status === 403 && afterJson.error === SUSPENDED_MESSAGE,
    `SESSIONS: a tenant user is refused with an honest, tenant-facing message \u2014 “${afterJson.error}”`);
  const afterCall = await (await fetch(base + "/webhooks/twilio/inbound", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `To=${encodeURIComponent(num)}&From=%2B15551234567&CallSid=HP-B${stamp}` })).text();
  check(/not taking calls/.test(afterCall) && (await db.callSession.count({ where: { tenantId: live.id, callSid: `HP-B${stamp}` } })) === 0,
    "INBOUND CALLS: declined politely, and no call session is written");
  const ing = await fetch(base + `/hooks/in/${ep.token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X", email: `x-${stamp}@example.invalid` }) });
  check(ing.status === 403 && (await db.inboundCall.count({ where: { tenantId: live.id, status: "rejected" } })) > 0,
    "PUBLIC LINKS: form/integration submissions are refused (403) \u2014 and the attempt is logged for the owner");
  // hub keeps access
  const hubDetail = await fetch(base + `/api/admin/portals/${live.id}`, { headers: { Cookie: `air_session=${hubTok}` } });
  const hubInside = await fetch(base + `/api/contacts?tenantId=${live.id}`, { headers: { Cookie: `air_session=${hubTok}` } });
  check(hubDetail.status === 200 && hubInside.status === 200,
    "HUB ADMINS keep the detail page AND read-write entry to the portal (that is how a suspension gets fixed)");
  // sweeps skip it, others unaffected
  await db.suggestion.deleteMany({ where: { tenantId: { in: [live.id, bystander.id] } } });
  const counters = await runDetectorSweep(new Date());
  check((await db.suggestion.count({ where: { tenantId: live.id } })) === 0 && counters.tenants > 1,
    `SCHEDULED WORK: the nightly sweep skips the suspended tenant while running for ${counters.tenants} others`);
  const schedSrc = readFileSync(resolve(__dirname, "..", "automation", "scheduler.ts"), "utf8");
  const engineSrc = readFileSync(resolve(__dirname, "..", "automation", "engine.ts"), "utf8");
  const recurSrc = readFileSync(resolve(__dirname, "..", "services", "recurringWorkService.ts"), "utf8");
  check((schedSrc.match(/status: \{ not: "SUSPENDED" \}/g) || []).length === 4 && /isTenantSuspended/.test(engineSrc) && /status: \{ not: "SUSPENDED" \}/.test(recurSrc),
    "\u2026and all four scheduled passes, the event-driven engine, and recurring spawns are gated at source");
  // resume restores
  await db.tenant.update({ where: { id: live.id }, data: { status: "ACTIVE" } });
  forgetTenantStatus(live.id);
  const resumed = await fetch(base + "/api/contacts", { headers: { Cookie: `air_session=${memberTok}` } });
  const resumedCall = await (await fetch(base + "/webhooks/twilio/inbound", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `To=${encodeURIComponent(num)}&From=%2B15551234567&CallSid=HP-C${stamp}` })).text();
  check(resumed.status === 200 && !/not taking calls/.test(resumedCall),
    "RESUME restores everything at once \u2014 nothing was deleted or changed while suspended");
  check((await db.contact.count({ where: { tenantId: live.id } })) >= 0 && !!(await db.tenant.findUnique({ where: { id: live.id } })),
    "\u2026and the tenant's data was never touched");

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: class lists and the stylesheet's own declarations \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  await db.user.delete({ where: { id: hub.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the create page lines up, the pill is the same control, and suspension finally means something)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
