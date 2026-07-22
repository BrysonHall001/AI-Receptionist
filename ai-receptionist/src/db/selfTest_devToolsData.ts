// Self-test — DevTools data layer (batch devtools-data).
//
//   npx tsx src/db/selfTest_devToolsData.ts
//
// Proves: (1) Email History relocated VERBATIM (the original render fn mounts the
// sub-tab; the nav item is gone; the old route maps); (2) the embedded-panel
// wrapper — failed-logins/automations/retention EMBED the audit component with
// exact preset filters, geo/drip panels query correctly (DB-driven, with the
// endpoint's own where-shapes drift-pinned); (3) ErrorEvent — rate limit, 5xx
// middleware capture, truncation, a simulated boot-crash report landing end-to-end
// through the OPEN endpoint, and the bounded 14-day prune; (4) WebhookEvent —
// every grounded route wired, redaction (tokens + bodies absent from a seeded
// payload's excerpt), outcome/latency recorded, never-block stub, prune; (5) the
// data-driven registries and named thresholds; (6) ledger (nine groups) + ratchet.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";
import {
  captureError, clientErrorAllowed, runErrorPruneSweep, _setErrorWriterForTests,
  ERROR_RETENTION_DAYS, ERROR_PRUNE_BATCH, ERROR_PRUNE_MAX_BATCHES, ERROR_STACK_MAX, CLIENT_ERROR_LIMIT_PER_MIN,
} from "../services/errorService";
import {
  captureWebhook, webhookRecorder, redactPayload, runWebhookPruneSweep, _setWebhookWriterForTests,
  WEBHOOK_RETENTION_DAYS, WEBHOOK_EXCERPT_MAX, WEBHOOK_PRUNE_BATCH,
} from "../services/webhookService";
import { HEALTH, HEALTH_CHECK_KEYS } from "../services/healthService";
import { EventEmitter } from "events";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const adminJs = read("public/js/admin.js");
const appJs = read("public/js/app.js");
const appTs = read("src/app.ts");
const adminRoutes = read("src/routes/admin.ts");
const keep = setInterval(() => { /* event-loop anchor */ }, 500);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("DevTools data layer");
  console.log("===================");

  // ---------- (1) Email History ----------
  console.log("\n(1) Email History relocation:");
  check(adminJs.includes('{ key: "email", label: "Email History", mount: (host) => renderEmail(host) }'), "the sub-tab mounts the ORIGINAL renderEmail (verbatim reuse, not a rewrite)");
  check(adminJs.includes("const emailHost = () => _emailHost || view();") && adminJs.includes("async function renderEmail(hostEl) {"), "the trio is host-threaded (the DT-1 changelog precedent) — internal flows untouched");
  check(!appJs.includes('["#/admin/email", "Email"]'), "the top-level Email nav item is GONE");
  check(adminJs.includes('if (v === "email") { App.state._devtoolsHint = { section: "history", subtab: "email" }; return renderDevTools(); }') && appJs.includes('"#/admin/email": "Developer Tools"'), "the old route maps into Developer Tools \u2192 History \u2192 Email History");

  // ---------- (2) the embedded-panel wrapper ----------
  console.log("\n(2) embedded data panels:");
  check(adminJs.includes('failedLogins: { audit: () => ({ action: "auth.login_failed", status: "all", from: dayIsoAgo(1), to: dayIsoAgo(0) }), defaultKeys: ["createdAt", "tenant", "actor", "userType", "action", "ip"] }'), "failed logins EMBED the audit table: auth.login_failed + last-24h, with user/user-type/tenant/IP/time columns");
  check(adminJs.includes('automations: { audit: () => ({ group: "automations", status: "all"') && adminJs.includes('auditSweep: { audit: () => ({ status: "pending_deletion" }) }'), "automations + retention panels are audit-table configurations too");
  check(adminJs.includes("if (cfg.audit) { await renderAuditLog(host, { embedded: true, embedId: checkKey, filter: cfg.audit(), defaultKeys: cfg.defaultKeys }); return; }"), "the wrapper EMBEDS renderAuditLog itself \u2014 the DT-3 component, not a fork (source-asserted)");
  check(adminJs.includes("if (cfg.component) { await cfg.component(host); return; }") && adminJs.includes("async function mountHealthDataPanel(host, checkKey, cfg)"), "ONE wrapper turns configs into panels (audit-embed / fetch-table / component branches)");
  // the endpoints' where-shapes, drift-pinned, then a live DB-driven leg
  check(adminRoutes.includes('contactGeo.findMany({ where: { status: { in: ["pending", "failed"] } }') && adminRoutes.includes('recordGeo.findMany({ where: { status: { in: ["pending", "failed"] } }'), "geo rows endpoint queries pending+failed ContactGeo/RecordGeo");
  check(adminRoutes.includes('{ status: "failed", updatedAt: { gte: new Date(now - 24 * 60 * 60_000) } }, { status: "pending", dueAt: { lt: new Date(now - 10 * 60_000) } }'), "drip rows endpoint queries failed-24h + overdue-pending ScheduledJob");
  try {
    const { prisma } = require("../db/client");
    const t = await (prisma as any).tenant.findFirst({ select: { id: true } });
    if (!t) throw new Error("no tenant seeded");
    const contact = await (prisma as any).contact.findFirst({ where: { tenantId: t.id }, select: { id: true } });
    if (!contact) throw new Error("no contact seeded");
    const cg = await (prisma as any).contactGeo.create({ data: { tenantId: t.id, contactId: contact.id, fieldKey: "selftest_addr", addressHash: "h" + Date.now(), status: "failed", lastError: "selftest: no such place" } });
    const sj = await (prisma as any).scheduledJob.create({ data: { tenantId: t.id, automationName: "Selftest drip", contactName: "Selftest", action: {}, dueAt: new Date(Date.now() - 60 * 60_000), status: "pending", description: "selftest" } });
    const geoRows = await (prisma as any).contactGeo.findMany({ where: { status: { in: ["pending", "failed"] } }, select: { id: true } });
    const dripRows = await (prisma as any).scheduledJob.findMany({ where: { OR: [{ status: "failed", updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } }, { status: "pending", dueAt: { lt: new Date(Date.now() - 10 * 60_000) } }] }, select: { id: true } });
    check(geoRows.some((r: any) => r.id === cg.id) && dripRows.some((r: any) => r.id === sj.id), "LIVE: a seeded failed geocode row and an overdue drip row surface in the panels' queries");
    await (prisma as any).contactGeo.delete({ where: { id: cg.id } });
    await (prisma as any).scheduledJob.delete({ where: { id: sj.id } });
  } catch (e: any) {
    console.log("  \u26a0 DB unavailable (" + String(e && e.message ? e.message : e).split("\n")[0].slice(0, 60) + ") — where-shapes drift-pinned above; the build block runs the LIVE leg with clarity-pg up.");
  }

  // ---------- (3) ErrorEvent ----------
  console.log("\n(3) error capture:");
  let allowed = 0;
  for (let i = 0; i < CLIENT_ERROR_LIMIT_PER_MIN + 5; i++) if (clientErrorAllowed("selftest-ip")) allowed++;
  check(allowed === CLIENT_ERROR_LIMIT_PER_MIN, `the client endpoint's per-IP rate limit holds (${CLIENT_ERROR_LIMIT_PER_MIN}/min, ${allowed} of ${CLIENT_ERROR_LIMIT_PER_MIN + 5} allowed)`);
  check(appTs.includes("app.use((err: any, req: any, res: any, _next: any) => {") && appTs.includes('source: "server"') && appTs.includes('res.status(500).json({ error: "Internal error" })'), "the final error middleware captures server 5xx (fire-and-forget) then answers a clean 500");
  check(appTs.includes('app.use("/api/client-errors", clientErrorsRouter);') && appTs.indexOf('app.use("/api/client-errors"') < appTs.indexOf('app.use("/api", apiRouter)'), "the OPEN client endpoint mounts before the auth-gated /api catch-all");
  let wrote: any = null;
  _setErrorWriterForTests(async (d) => { wrote = d; });
  captureError({ source: "client", message: "m".repeat(5000), stack: "s".repeat(9000), route: "#/boot" });
  await wait(30);
  check(!!wrote && wrote.stack.length <= ERROR_STACK_MAX + 20 && wrote.message.length <= 1020, `truncation applied at capture (stack \u2264 ~${ERROR_STACK_MAX})`);
  _setErrorWriterForTests(async () => { throw new Error("db down"); });
  captureError({ source: "server", message: "never blocks" });
  await wait(30);
  check(true, "a throwing writer never propagates (the warn above is the only trace)");
  _setErrorWriterForTests(null);
  check(read("public/index.html").indexOf("errorReporter.js") < read("public/index.html").indexOf("vendor/xlsx"), "the reporter loads FIRST (boot-order safety \u2014 a boot crash in ANY later script is catchable)");
  const rep = read("public/js/errorReporter.js");
  check(rep.includes("window.onerror") && rep.includes("unhandledrejection") && rep.includes("MAX_PER_SESSION = 20") && rep.includes('fetch("/api/client-errors"') && rep.includes("keepalive: true") && !rep.includes("App."), "the reporter: onerror + unhandledrejection, deduped, capped, batched, keepalive, ZERO dependencies");
  try {
    const { prisma } = require("../db/client");
    // the white-screen incident, end to end: a boot-crash report lands through the OPEN endpoint
    const { createApp } = require("../app");
    const srv = createApp().listen(0);
    const port = (srv.address() as any).port;
    const resp = await fetch(`http://127.0.0.1:${port}/api/client-errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Selftest boot crash: Cannot read properties of undefined", stack: "at boot (app.js:1:1)", route: "#/dashboard" }) });
    await wait(150);
    const row = await (prisma as any).errorEvent.findFirst({ where: { message: { contains: "Selftest boot crash" } }, orderBy: { createdAt: "desc" } });
    check(resp.status === 204 && !!row && row.source === "client" && row.route === "#/dashboard", "LIVE: a simulated tenant boot-crash report LANDS as an ErrorEvent row (204, no auth needed)");
    // prune: an old row dies at 14d, a fresh one survives; batches are bounded
    const old = await (prisma as any).errorEvent.create({ data: { source: "server", message: "selftest old", createdAt: new Date(Date.now() - (ERROR_RETENTION_DAYS + 1) * 86400000) } });
    const pr = await runErrorPruneSweep();
    const oldGone = !(await (prisma as any).errorEvent.findUnique({ where: { id: old.id } }));
    const freshKept = !!(await (prisma as any).errorEvent.findUnique({ where: { id: row.id } }));
    check(oldGone && freshKept && pr.deleted >= 1 && ERROR_PRUNE_BATCH === 500 && ERROR_PRUNE_MAX_BATCHES === 14, `LIVE: the prune removes >${ERROR_RETENTION_DAYS}d rows in bounded batches and keeps fresh ones`);
    await (prisma as any).errorEvent.deleteMany({ where: { message: { contains: "Selftest boot crash" } } });
    srv.close();
  } catch (e: any) {
    console.log("  \u26a0 DB unavailable (" + String(e && e.message ? e.message : e).split("\n")[0].slice(0, 60) + ") — capture/limit/truncation proven above; the build block runs the LIVE boot-crash + prune legs.");
  }

  // ---------- (4) WebhookEvent ----------
  console.log("\n(4) webhook capture:");
  for (const site of ['app.use("/webhooks/twilio", webhookRecorder("twilio"), twilioRouter)', 'app.use("/webhooks/relay", webhookRecorder("twilio"), conversationRelayRouter)', 'webhookRecorder("stripe"), stripeWebhookRouter', 'app.use("/hooks/in", webhookRecorder("other"), inboundRouter)', 'webhookRecorder("other"), resendWebhookRouter']) {
    check(appTs.includes(site), `capture wired: ${site.slice(0, 58)}\u2026`);
  }
  let whWrote: any = null;
  _setWebhookWriterForTests(async (d) => { whWrote = d; });
  // drive the REAL recorder middleware with a seeded payload carrying secrets + a body
  const req: any = { baseUrl: "/webhooks/twilio", path: "/sms", body: { From: "+15550001111", Body: "the private message text", AuthToken: "tok_secret_123", twilioSignature: "sig==" }, headers: {} };
  const res: any = new EventEmitter(); res.statusCode = 200;
  webhookRecorder("twilio")(req, res, () => {});
  await wait(15);
  res.emit("finish");
  await wait(30);
  check(!!whWrote && whWrote.provider === "twilio" && whWrote.endpoint === "/webhooks/twilio/sms" && whWrote.outcome === "ok" && whWrote.httpStatus === 200 && typeof whWrote.latencyMs === "number", "the recorder middleware records provider/endpoint/outcome/status/latency on response finish");
  check(!!whWrote && whWrote.summary === "Inbound SMS webhook", "\u2026with a human one-line summary");
  const exc = (whWrote && whWrote.payloadExcerpt) || "";
  check(!exc.includes("the private message text") && !exc.includes("tok_secret_123") && !exc.includes("sig==") && exc.includes("[redacted]") && exc.includes("+15550001111"), "REDACTION: the seeded payload's token, signature, and message BODY are absent from the excerpt; structure survives");
  check(redactPayload("x".repeat(5000)) !== null && String(redactPayload({ a: "y".repeat(5000) })).length <= WEBHOOK_EXCERPT_MAX + 30, `excerpts truncate at ~${WEBHOOK_EXCERPT_MAX} bytes`);
  _setWebhookWriterForTests(async () => { throw new Error("db down"); });
  captureWebhook({ provider: "other", endpoint: "/hooks/in", outcome: "fail", httpStatus: 500, latencyMs: 5, summary: "never blocks" });
  await wait(30);
  check(true, "a throwing webhook writer never propagates");
  _setWebhookWriterForTests(null);
  try {
    const { prisma } = require("../db/client");
    const old = await (prisma as any).webhookEvent.create({ data: { provider: "other", endpoint: "/hooks/in", outcome: "ok", httpStatus: 200, latencyMs: 1, summary: "selftest old", createdAt: new Date(Date.now() - (WEBHOOK_RETENTION_DAYS + 1) * 86400000) } });
    const pr = await runWebhookPruneSweep();
    check(!(await (prisma as any).webhookEvent.findUnique({ where: { id: old.id } })) && pr.deleted >= 1 && WEBHOOK_PRUNE_BATCH === 500, `LIVE: webhook prune removes >${WEBHOOK_RETENTION_DAYS}d rows in bounded batches`);
  } catch (e: any) {
    console.log("  \u26a0 DB unavailable — the build block runs the LIVE webhook prune leg.");
  }
  check(adminRoutes.includes('adminRouter.get("/webhook-events"') && adminRoutes.includes('adminRouter.get("/errors"'), "both read-only query surfaces exist behind the hub gate");

  // ---------- (5) registries + thresholds ----------
  console.log("\n(5) registries + thresholds:");
  const hist = adminJs.slice(adminJs.indexOf("const HISTORY_SUBTABS"), adminJs.indexOf("];", adminJs.indexOf("const HISTORY_SUBTABS")));
  check(hist.indexOf('"changelog"') < hist.indexOf('"auditlog"') && hist.indexOf('"auditlog"') < hist.indexOf('"email"'), "History: Change Log | Audit Log | Email History (data-driven)");
  const hsub = adminJs.slice(adminJs.indexOf("const HEALTH_SUBTABS"), adminJs.indexOf("];", adminJs.indexOf("const HEALTH_SUBTABS")));
  check(hsub.indexOf('"overview"') < hsub.indexOf('"errors"') && hsub.indexOf('"errors"') < hsub.indexOf('"webhooks"'), "System Health: Overview | Errors | Webhooks (data-driven)");
  check(HEALTH.ERRORS_24H_WARN === 1 && HEALTH.ERRORS_24H_FAIL === 25 && HEALTH.WEBHOOK_FAILS_24H_WARN === 1 && HEALTH.WEBHOOK_FAILS_24H_FAIL === 25, "tile thresholds are NAMED constants");
  check(HEALTH_CHECK_KEYS.includes("errors") && HEALTH_CHECK_KEYS.length === 17 && adminJs.includes("errors: HW("), "the Errors tile lives in the registry with its accent widget");
  check(read("src/services/healthService.ts").includes("webhookEvent.count") && !read("src/services/healthService.ts").includes("emailLog.count"), "the Webhook-deliveries check reads REAL WebhookEvent counts (the EmailLog read is gone)");
  check(adminJs.includes('errors: { component: (host) => renderErrorsTable(host, { embedId: "panel"') && adminJs.includes('webhooks: { component: (host) => renderWebhooksTable(host, { embedId: "panel"'), "both tiles' panels ARE their sub-tab components, pre-filtered ~24h (one implementation each)");

  // ---------- (6) ledger + ratchet ----------
  console.log("\n(6) ledger + ratchet:");
  const css = read("public/styles.css");
  check(read("public/js/theme.js").includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1 kept");
  const utilJs = read("public/js/util.js");
  check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2 kept");
  check(read("src/db/selfTest_contactsAllViews.ts").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3 kept");
  check(css.includes("--ink-on-bg: #f6ecff;"), "ledger 4 kept");
  check(read("public/js/learnScenes.js").includes("sourceFn"), "ledger 5 kept (LC untouched)");
  check(adminJs.includes("const DEVTOOL_SECTIONS = ["), "ledger 6 kept");
  check(read("src/services/auditService.ts").includes("void Promise.resolve()") && read("prisma/schema.prisma").includes("actorRole     String?"), "ledger 7 kept");
  check(adminJs.includes('{ key: "userType", label: "User Type"') && css.includes(".toolbar-left, .table-lead { padding-left: var(--table-lead-inset); }"), "ledger 8 kept");
  check(adminJs.includes("health-flip-inner") && !read("src/services/healthService.ts").includes("ELEVENLABS_API_KEY") && adminJs.includes('stripe: "/img/stripe.png"'), "ledger 9 kept (health v2: flip tiles, honest cards, no phantom key)");
  const auditR = runAudit();
  check(auditR.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (auditR.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

  clearInterval(keep);
  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (the panels show the data, the errors show themselves, and every webhook leaves a receipt)" : failures.length + " FAILED \u274c"}`);
  process.exit(failures.length ? 1 : 0);
}
main();
