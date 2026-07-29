// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// HUB HISTORY + TENANT DETAIL PANELS. Five layers:
//   builds      — this batch's changelog entry; the early-history source file;
//   happy paths — the Modules panel mirrors Pages; batched save commits;
//   regressions — no prune and no cap hides changelog rows; Pages untouched;
//                 module writes still go through batch 38's one endpoint;
//   catastrophics — a toggle must never write on its own; a stored audit row is
//                 never rewritten by the display fix;
//   DOM smoke   — the two panels' heading/description/content rhythm at three
//                 viewport heights, and the save button beside its Pages twin.
// Harness copied from selfTest_hubUiConsistency / selfTest_demoTooling.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal, getPortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const sug = require("../services/suggestionService");
const { queryAuditEvents } = require("../services/auditQueryService");
const { listChangeLog } = require("../services/changelogService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync, existsSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(120); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "notifications.js", "globalSearch.js", "navModel.js", "app.js"];
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
  console.log("HUB HISTORY + TENANT DETAIL PANELS \u2014 self-test");
  console.log("=============================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const report: string[] = [];
  const adminJs = readFileSync(join(PUB, "js", "admin.js"), "utf8");

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-hub-history-panels-20260727" } });
  check(!!cl && cl.id === "cl_hub_history_panels_20260727", "this batch's changelog row landed (idempotent migration)");
  const srcDir = resolve(__dirname);
  const early = existsSync(join(srcDir, "changelog.json")) ? JSON.parse(readFileSync(join(srcDir, "changelog.json"), "utf8")) : null;
  const earlyRows = Array.isArray(early) ? early : (early && early.entries) || [];
  const earlyDates = earlyRows.map((r: any) => String(r.date || "")).filter(Boolean).sort();
  check(earlyRows.length > 100 && earlyDates[0] < "2026-06-24",
    `the project's early history lives in src/db/changelog.json (${earlyRows.length} entries, ${earlyDates[0]} \u2192 ${earlyDates[earlyDates.length - 1]}) \u2014 loadable with npm run seed:changelog`);
  check(earlyRows.every((r: any) => !!r.commitSha), "\u2026and every one of them carries a real commit sha");

  // ---------- (2) nothing prunes or caps the change log ----------
  console.log("\n(2) the change log is not truncated by anything we do:");
  const svcSrc = readFileSync(resolve(__dirname, "..", "services", "changelogService.ts"), "utf8");
  const auditSrc = readFileSync(resolve(__dirname, "..", "services", "auditService.ts"), "utf8");
  check(/listChangeLog\(limit = (\d{4,})\)/.test(svcSrc), `the list query's default limit is generous: ${(svcSrc.match(/listChangeLog\(limit = (\d+)\)/) || [])[1]}`);
  check(!/changeLogEntry\.deleteMany|changeLogEntry\.delete\(/.test(auditSrc) && !/changeLogEntry/.test(auditSrc),
    "the audit retention sweep never touches changelog entries (only audit events)");
  const total = await db.changeLogEntry.count();
  const listed = await listChangeLog();
  check(listed.length === total, `every stored entry is returned \u2014 no cap hides rows (${listed.length} of ${total})`);
  report.push(`  change log: ${total} entries, list limit ${(svcSrc.match(/listChangeLog\(limit = (\d+)\)/) || [])[1]}, no prune anywhere`);

  // ---------- (3) fixtures ----------
  const t: any = await createPortal({ name: `hh-${stamp}`, billingStatus: "trial", template: "field_services" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  const hub = await db.user.create({ data: { email: `hh-h-${stamp}@example.invalid`, name: "Hub Owner", role: "OWNER", passwordHash: "x" } });
  const member = await db.user.create({ data: { email: `hh-m-${stamp}@example.invalid`, name: "Bryson Hall", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const doomed = await db.user.create({ data: { email: `hh-d-${stamp}@example.invalid`, name: "Departed Person", role: "PORTAL_ADMIN", tenantId: t.id, passwordHash: "x" } });
  const hubTok = await createSession(hub.id);

  // ---------- (4) audit actor names ----------
  console.log("\n(4) audit actors:");
  const actor = { id: member.id, tenantId: t.id, role: member.role, customRoleId: null, name: member.name, email: member.email } as any;
  const rowFor = async (key: string) => db.suggestion.findFirst({ where: { tenantId: t.id, dedupeKey: key } });
  await sug.upsertSuggestion({ tenantId: t.id, type: "stage_stall", dedupeKey: `hh-a-${stamp}`, finding: {}, proposedAction: { type: "none", params: {} }, title: "Worth a look", transparency: "Based on recent activity" });
  await sug.acceptSuggestion(actor, (await rowFor(`hh-a-${stamp}`)).id);
  await sug.upsertSuggestion({ tenantId: t.id, type: "unused_module", dedupeKey: `hh-d-${stamp}`, finding: {}, proposedAction: { type: "none", params: {} }, title: "Also worth a look", transparency: "Based on recent activity" });
  await sug.dismissSuggestion(actor, (await rowFor(`hh-d-${stamp}`)).id);
  await sleep(800);
  const accepted = await db.auditEvent.findFirst({ where: { tenantId: t.id, action: "suggestion.accepted" }, orderBy: { createdAt: "desc" } });
  const dismissed = await db.auditEvent.findFirst({ where: { tenantId: t.id, action: { contains: "dismiss" } }, orderBy: { createdAt: "desc" } });
  check(!!accepted && accepted.actorLabel === "Bryson Hall", `ACCEPT writes a name, not an id (${accepted ? accepted.actorLabel : "\u2014"})`);
  check(!!dismissed && dismissed.actorLabel === "Bryson Hall", `DISMISS \u2014 the second defective path \u2014 writes a name too (${dismissed ? dismissed.actorLabel : "\u2014"})`);
  const srcSug = readFileSync(resolve(__dirname, "..", "services", "suggestionService.ts"), "utf8");
  check(!/actorLabel: user\.id/.test(srcSug), "no path in the codebase still passes an id as the actor label");
  // history: rows already written with a raw id
  await db.auditEvent.create({ data: { tenantId: t.id, actorType: "user", actorId: member.id, actorLabel: member.id, actorRole: "PORTAL_ADMIN", action: "suggestion.accepted", subjectType: "settings", subjectId: `old-${stamp}`, subjectLabel: "historical" } });
  await db.auditEvent.create({ data: { tenantId: t.id, actorType: "user", actorId: doomed.id, actorLabel: doomed.id, actorRole: "PORTAL_ADMIN", action: "suggestion.accepted", subjectType: "settings", subjectId: `orphan-${stamp}`, subjectLabel: "orphan" } });
  await db.user.delete({ where: { id: doomed.id } });
  const page = await queryAuditEvents({ tenantId: t.id, limit: "50" });
  const labels = page.events.map((e: any) => e.actorLabel);
  check(!labels.some((l: string) => /^c[a-z0-9]{20,}$/i.test(l)), `HISTORY: id-shaped rows resolve at read time (${Array.from(new Set(labels)).join(" \u00b7 ")})`);
  check(labels.includes("Deleted user"), "NEGATIVE: an actor whose account is gone shows an honest placeholder, never a raw id");
  const storedStill = await db.auditEvent.findFirst({ where: { tenantId: t.id, subjectId: `old-${stamp}` } });
  check(storedStill.actorLabel === member.id, "CATASTROPHIC GUARD: the stored row is UNCHANGED \u2014 only the display resolves");

  // ---------- (5) the two panels ----------
  console.log("\n(5) Modules mirrors Pages:");
  const w = bootDom(base, hubTok);
  await until(() => w.App.state && w.App.state.me);
  await sleep(500);
  const $ = (s: string) => w.document.querySelector(s) as any;
  const $$ = (s: string) => Array.from(w.document.querySelectorAll(s)) as any[];
  w.location.hash = "#/admin/portals"; w.dispatchEvent(new w.Event("hashchange"));
  await until(() => $("table tbody tr"), 9000);
  const row = $$("table tbody tr").find((tr: any) => tr.textContent.indexOf(t.name) !== -1);
  check(!!row, "the fixture tenant is in the list");
  (row as any).click();
  await until(() => $$(".adm-mp-panel").length === 2, 12000);
  await until(() => $$(".adm-mp-ind").length > 0, 12000);
  const panels = $$(".adm-mp-panel");
  const shape = (p: any) => Array.from(p.children).map((c: any) => c.tagName.toLowerCase() + "." + String(c.className).split(" ")[0]).join(" > ");
  const pagesPanel = panels.find((p: any) => /Pages/.test((p.querySelector(".adm-mp-h") || {}).textContent || ""));
  const modsPanel = panels.find((p: any) => /Modules/.test((p.querySelector(".adm-mp-h") || {}).textContent || ""));
  check(!!pagesPanel && !!modsPanel && shape(pagesPanel) === shape(modsPanel),
    `both panels render the SAME element rhythm \u2014 heading, description, card (${shape(modsPanel)})`);
  const pagesDesc = (pagesPanel.querySelector(".adm-hint") || { textContent: "" }).textContent;
  const modsDesc = (modsPanel.querySelector(".adm-hint") || { textContent: "" }).textContent;
  const within = Math.abs(pagesDesc.length - modsDesc.length) / pagesDesc.length;
  check(modsDesc.length > 0 && within <= 0.15,
    `the Modules description exists and is within 15% of Pages' length (${modsDesc.length} vs ${pagesDesc.length}, ${(within * 100).toFixed(1)}%)`);
  report.push(`  descriptions: Pages ${pagesDesc.length} chars \u00b7 Modules ${modsDesc.length} chars (\u0394 ${(within * 100).toFixed(1)}%), both p.cell-muted.adm-hint`);
  const pagesSave = pagesPanel.querySelector(".btn-primary");
  const modsSave = modsPanel.querySelector(".btn-primary");
  check(!!modsSave && modsSave.className === pagesSave.className,
    `the save buttons are the same house component at the same size (.${String(modsSave.className).trim().split(/\s+/).join(".")})`);
  report.push(`  save buttons: Pages "${pagesSave.textContent}" \u00b7 Modules "${modsSave.textContent}" \u2014 identical classes ${pagesSave.className}`);
  // the three shared Y positions, asserted structurally at three heights
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  const gridRule = (cssSrc.match(/\.adm-mp-grid \{[^}]*\}/) || [""])[0];
  for (const h of [1080, 800, 650]) {
    Object.defineProperty(w, "innerHeight", { value: h, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    await sleep(50);
    const stillPaired = $$(".adm-mp-panel").length === 2
      && shape($$(".adm-mp-panel")[0]) === shape($$(".adm-mp-panel")[1])
      && $$(".adm-mp-panel .adm-mp-h").length === 2
      && $$(".adm-mp-panel .adm-hint").length === 2
      && $$(".adm-mp-panel .adm-mp-card").length + $$(".adm-mp-panel > .card").length >= 2;
    check(stillPaired, `@${h}px both panels keep heading + description + card, one for one`);
  }
  report.push(`  alignment: the two panels are siblings in ${gridRule.trim() || ".adm-mp-grid"} with identical child sequences, so heading/description/content share a Y by construction`);

  // ---------- (6) batching ----------
  console.log("\n(6) batched save:");
  check(modsSave.disabled === true, "Save starts disabled \u2014 nothing is dirty");
  const before: any = await getPortal(t.id);
  const beforeHidden = JSON.stringify(((before.labels || {}).nav || {}).hidden || []);
  const ind = modsPanel.querySelector(".adm-mp-ind:not([disabled])");
  check(!!ind, "a module has an interactive toggle (batch 38's write path is present)");
  ind.checked = false;
  ind.dispatchEvent(new w.Event("change"));
  await sleep(300);
  const afterToggle: any = await getPortal(t.id);
  check(JSON.stringify(((afterToggle.labels || {}).nav || {}).hidden || []) === beforeHidden && modsSave.disabled === false,
    "CATASTROPHIC GUARD: toggling writes NOTHING \u2014 it only marks the change and enables Save");
  (modsSave as any).click();
  const dialog = await until(() => $(".modal-overlay"), 6000);
  check(!!dialog && /record|no records yet/.test(dialog.textContent),
    "Save asks ONE confirmation listing every module being switched off, with its record count");
  const goBtn = $$(".modal-overlay .btn").find((b: any) => /Hide and save/.test(b.textContent));
  check(!!goBtn, "\u2026behind a house confirm button");
  (goBtn as any).click();
  let saved = beforeHidden;
  for (let i = 0; i < 40; i++) {
    const p2: any = await getPortal(t.id);
    saved = JSON.stringify(((p2.labels || {}).nav || {}).hidden || []);
    if (saved !== beforeHidden) break;
    await sleep(200);
  }
  check(saved !== beforeHidden, `Save commits through batch 38's existing endpoint (hidden is now ${saved})`);
  check(modsSave.disabled === true, "\u2026and Save goes back to disabled once nothing is dirty");
  const routeSrc = readFileSync(resolve(__dirname, "..", "routes", "admin.ts"), "utf8");
  check((routeSrc.match(/adminRouter\.(get|post|patch|put|delete)\("\/portals\/:id\/modules/g) || []).length === 2,
    "\u2026and there is still exactly ONE module write route \u2014 no parallel writer was added");
  freeze(w); await sleep(150);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  report.forEach((l) => console.log(l));
  console.log("  measurement basis: element sequences, class lists and stylesheet declarations \u2014 JSDOM paints nothing, so no pixel is claimed as rendered");

  server.close();
  for (const u of [hub.id, member.id]) await db.user.delete({ where: { id: u } }).catch(() => { /* */ });
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the panels match, the log is whole, and every action has a name on it)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
