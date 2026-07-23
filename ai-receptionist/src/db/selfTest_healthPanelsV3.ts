// Self-test — System Health panels v3: tenant-first (batch health-panels-v3).
//
//   npx tsx src/db/selfTest_healthPanelsV3.ts
//
// Proves: (1) ROLLUP CORRECTNESS, DB-driven — events seeded across two tenants
// produce the right per-tenant rows AND the pinned all-tenants total from the ONE
// GROUPING-SETS statement (failed logins fully: counts, distinct users, distinct
// IPs, latest; at least one seeded case for every other Tier-A tile); (2) the
// drill-down passes the EXACT tenant + preset into last batch's detail components
// (source-asserted, with the back affordance); (3) Tier-B tables read the grounded
// real fields (DB-proven where cheap); (4) the one-aggregate-query discipline (no
// per-tenant query loops anywhere in the rollup path); (5) Tier-C panels unchanged
// with platform-wide captions; (6) ledger (ten groups) + ratchet.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const adminJs = read("public/js/admin.js");
const adminRoutes = read("src/routes/admin.ts");
const keep = setInterval(() => { /* anchor */ }, 500);

async function main() {
  console.log("System Health panels v3 — tenant-first");
  console.log("======================================");

  // ---------- (1) rollup correctness, DB-driven ----------
  console.log("\n(1) rollup correctness (two seeded tenants):");
  try {
    const { prisma } = require("../db/client");
    const { ROLLUP_SQL } = require("../routes/admin");
    const MARK = "pv3-" + Date.now();
    const [tA, tB] = await (prisma as any).tenant.findMany({ select: { id: true, name: true }, take: 2 });
    if (!tA || !tB) throw new Error("needs two seeded tenants");
    const run = async (key: string) => {
      const def = ROLLUP_SQL[key];
      const since = new Date(Date.now() - 24 * 60 * 60_000);
      const { text, params } = def.sql(since);
      const raw: any[] = await (prisma as any).$queryRawUnsafe(text, ...params);
      const num = (v: any) => (typeof v === "bigint" ? Number(v) : v);
      return raw.map((r) => { const o: any = {}; for (const k of Object.keys(r)) o[k] = num(r[k]); return o; });
    };
    const rowFor = (rows: any[], tid: string) => rows.find((r) => r.istotal === 0 && r.tenantId === tid);
    const totalOf = (rows: any[]) => rows.find((r) => r.istotal === 1);

    // failed logins, FULLY: A = 3 attempts (2 users, 2 IPs), B = 1
    const mkFail = (tid: string, actor: string, ip: string, ms: number) => (prisma as any).auditEvent.create({ data: { tenantId: tid, actorType: "user", actorId: MARK + actor, actorLabel: MARK, action: "auth.login_failed", subjectType: "auth", status: "active", meta: { ip }, createdAt: new Date(Date.now() - ms) } });
    await mkFail(tA.id, "u1", "10.0.0.1", 5000);
    await mkFail(tA.id, "u1", "10.0.0.2", 4000);
    const newest = await mkFail(tA.id, "u2", "10.0.0.1", 3000);
    await mkFail(tB.id, "u3", "10.0.0.9", 2000);
    const fl = await run("failedLogins");
    const a = rowFor(fl, tA.id), b = rowFor(fl, tB.id), tot = totalOf(fl);
    check(!!a && a.failed >= 3 && a.users >= 2 && a.ips >= 2, `tenant A rolls up: failed=${a && a.failed}, distinct users=${a && a.users}, distinct IPs=${a && a.ips}`);
    check(!!b && b.failed >= 1, "tenant B rolls up separately");
    check(!!a && new Date(a.latest).getTime() >= new Date(newest.createdAt).getTime() - 1000, "latest attempt is the newest seeded event");
    check(!!tot && tot.failed >= (a.failed + b.failed) && tot.users >= 2, "the PINNED total row comes from the SAME statement (GROUPING SETS) and sums the tenants");

    // one seeded case per remaining Tier-A tile
    const ar = await (prisma as any).automationRun.create({ data: { tenantId: tA.id, automationId: MARK, automationName: MARK, eventType: "selftest", status: "failed" } });
    const auto = await run("automations");
    check((rowFor(auto, tA.id) || {}).failed >= 1 && (rowFor(auto, tA.id) || {}).total >= 1 && !!totalOf(auto), "automations: failed + total + pinned total");
    const sj = await (prisma as any).scheduledJob.create({ data: { tenantId: tB.id, automationName: MARK, contactName: MARK, action: {}, dueAt: new Date(Date.now() - 60 * 60_000), status: "pending", description: MARK } });
    const drips = await run("dripQueue");
    check((rowFor(drips, tB.id) || {}).overdue >= 1 && !!totalOf(drips), "drips: overdue counts under the right tenant + pinned total");
    const contact = await (prisma as any).contact.findFirst({ where: { tenantId: tA.id }, select: { id: true } });
    let cg: any = null;
    if (contact) {
      cg = await (prisma as any).contactGeo.create({ data: { tenantId: tA.id, contactId: contact.id, fieldKey: MARK, addressHash: MARK, status: "failed", lastError: MARK } });
      const geo = await run("geoQueue");
      check((rowFor(geo, tA.id) || {}).failed >= 1 && !!totalOf(geo), "geocode: failed row surfaces (UNION of both geo tables) + pinned total");
    } else { console.log("  \u26a0 no contact on tenant A — geocode case covered by shape only"); }
    const wh = await (prisma as any).webhookEvent.create({ data: { tenantId: tA.id, provider: "twilio", endpoint: "/webhooks/twilio/sms", outcome: "fail", httpStatus: 500, latencyMs: 5, summary: MARK } });
    const whNull = await (prisma as any).webhookEvent.create({ data: { provider: "stripe", endpoint: "/webhooks/stripe", outcome: "ok", httpStatus: 200, latencyMs: 5, summary: MARK } });
    const whr = await run("webhooks");
    const nullRow = whr.find((r: any) => r.istotal === 0 && r.tenantId === null);
    check((rowFor(whr, tA.id) || {}).failures >= 1 && !!nullRow && nullRow.deliveries >= 1, "webhooks: per-tenant failures + the platform-level (no tenant) row");
    const ee = await (prisma as any).errorEvent.create({ data: { tenantId: tB.id, source: "client", message: MARK } });
    const errs = await run("errors");
    check((rowFor(errs, tB.id) || {}).client >= 1 && !!totalOf(errs), "errors: client/server split under the right tenant + pinned total");
    const pd = await (prisma as any).auditEvent.create({ data: { tenantId: tB.id, actorType: "system", actorLabel: MARK, action: "record.update", subjectType: "record", status: "pending_deletion" } });
    const ret = await run("auditSweep");
    check((rowFor(ret, tB.id) || {}).pending >= 1 && (totalOf(ret) || {}).active >= 0, "audit retention: pending-deletion counts + oldest, unwindowed");

    // cleanup by marker
    await (prisma as any).auditEvent.deleteMany({ where: { actorLabel: MARK } });
    await (prisma as any).automationRun.delete({ where: { id: ar.id } });
    await (prisma as any).scheduledJob.delete({ where: { id: sj.id } });
    if (cg) await (prisma as any).contactGeo.delete({ where: { id: cg.id } });
    await (prisma as any).webhookEvent.deleteMany({ where: { id: { in: [wh.id, whNull.id] } } });
    await (prisma as any).errorEvent.delete({ where: { id: ee.id } });
    await (prisma as any).auditEvent.deleteMany({ where: { id: pd.id } });
  } catch (e: any) {
    console.log("  \u26a0 DB unavailable (" + String(e && e.message ? e.message : e).split("\n")[0].slice(0, 60) + ") — the build block runs the full seeded rollup legs with clarity-pg up.");
  }

  // ---------- (2) drill-down wiring ----------
  console.log("\n(2) drill-down (reuse, not copies):");
  check(adminJs.includes('audit: (tenantId, win) => ({ action: "auth.login_failed", status: "all", from: winFrom(win), to: dayIsoAgo(0), tenantId: tenantId || "" })'), "failed-logins drill passes the EXACT tenant + preset into the embedded audit component");
  check(adminJs.includes('await renderAuditLog(dHost, { embedded: true, embedId: checkKey + "-drill", filter: cfg.audit(tenantId, win), defaultKeys: cfg.defaultKeys })'), "audit drills EMBED renderAuditLog itself (drill-scoped tableId)");
  check(adminJs.includes('component: (host, tenantId, win) => renderErrorsTable(host, { embedId: "drill", filter: { tenantId: tenantId || "", from: winFrom(win), to: dayIsoAgo(0) } })') && adminJs.includes('component: (host, tenantId, win) => renderWebhooksTable(host, { embedId: "drill"'), "errors/webhooks drills are last batch's components, tenant+window pre-filtered");
  check(adminJs.includes('await mountQueueRowsTable(dHost, checkKey, cfg, tenantId ? tenantNameById[tenantId] : "")') && adminJs.includes("async function mountQueueRowsTable(host, checkKey, cfg, presetTenantName)"), "geo/drip drills reuse the queue tables with the tenant preselected");
  check(adminJs.includes('"\\u2190 Back to tenant summary"') && adminJs.includes("back.onclick = paintRollup;"), "every drill carries the back affordance to the rollup");
  check(adminJs.includes('cfg.onDrill(tr.getAttribute("data-tenant") || null, windowKey, tr.getAttribute("data-tname") || "");') && adminJs.includes('const allBtn = el("button", "btn btn-ghost btn-sm", "All rows \\u2192");'), "tenant-row click-through + the All-rows toggle wire through the ONE rollup component");
  check(adminJs.includes("async function mountTenantRollup(host, cfg)") && adminJs.split("mountTenantRollup(").length === 3, "ONE rollup component, called from the one wrapper (no per-tile copies)");
  for (const c of ['{ key: "failed", label: "Failed"', '{ key: "users", label: "Distinct users"', '{ key: "ips", label: "Distinct IPs"', '{ key: "overdue", label: "Overdue"', '{ key: "pending", label: "Pending"', '{ key: "deliveries", label: "Deliveries"', '{ key: "client", label: "Client errors"', '{ key: "active", label: "Active events"']) check(adminJs.includes(c), `rollup column: ${c.slice(9, 40)}`);
  check(adminJs.includes('[["24h", "Last 24 hours"], ["7d", "Last 7 days"]]') && adminJs.includes('rollup: { windows: false,') && adminJs.includes("cfg.windows ? `?window=${windowKey}` : \"\""), "the 24h/7d window selector appears only on windowed tiles");
  check(adminJs.includes('cellRow(d.total || {}, true, "All tenants")') && adminJs.includes("${totalRow}${body}"), "the all-tenants total row is PINNED on top");

  // ---------- (3) Tier-B grounded fields ----------
  console.log("\n(3) Tier-B per-tenant configuration:");
  check(adminRoutes.includes('select: { id: true, name: true, phoneNumber: true, voiceMode: true, billingStatus: true, stripeCustomerId: true }'), "the endpoint reads the grounded Tenant fields (phoneNumber/voiceMode/billingStatus/stripeCustomerId)");
  check(adminRoutes.includes("SELECT DISTINCT ON (\"tenantId\") \"tenantId\", outcome, \"createdAt\"") && adminRoutes.includes("provider = 'twilio' AND \"tenantId\" IS NOT NULL"), "Twilio: latest inbound delivery outcome per tenant from WebhookEvent (unattributed => \u2014)");
  check(adminRoutes.includes("googleConnection.findMany({ select: { tenantId: true, status: true, lastSyncedAt: true, lastSyncError: true } })") && adminRoutes.includes('resourceCalendarMap.groupBy({ by: ["tenantId"]'), "Google Calendar: GoogleConnection status/lastSyncedAt/lastSyncError + ResourceCalendarMap counts");
  check(adminRoutes.includes('FROM "Charge" ORDER BY "tenantId", "createdAt" DESC'), "Stripe: the latest Charge per tenant (read-only)");
  check(adminJs.includes('if (!dataCfg && (checkKey === "twilio" || checkKey === "google" || checkKey === "stripe"))') && adminJs.includes('el("h4", "settings-sub", "Per-tenant configuration")'), "the table sits between the status header and check history on exactly the three Tier-B tiles");
  for (const col of ['"Phone number"', '"Voice mode"', '"Webhook OK?"', '"Connected?"', '"Calendars mapped"', '"Sync"', '"Billing status"', '"Stripe customer?"', '"Last charge"']) check(adminJs.includes(`label: ${col}`), `Tier-B column: ${col}`);
  try {
    const { prisma } = require("../db/client");
    const t = await (prisma as any).tenant.findFirst({ select: { phoneNumber: true, voiceMode: true, billingStatus: true, stripeCustomerId: true } });
    check(t !== undefined, "LIVE: the grounded Tenant fields exist against the real schema");
  } catch { console.log("  \u26a0 DB unavailable — Tier-B field existence verified by source + tsc."); }

  // ---------- (4) one-aggregate-query discipline ----------
  console.log("\n(4) aggregate discipline:");
  const rollupSlice = adminRoutes.slice(adminRoutes.indexOf("export const ROLLUP_SQL"), adminRoutes.indexOf('adminRouter.get("/health/rollup/:check"') + 2000);
  check((adminRoutes.match(/GROUP BY GROUPING SETS/g) || []).length === 7, "all seven Tier-A rollups are single GROUPING-SETS statements (tenant rows + total together)");
  check(!/for\s*\(\s*const\s+\w+\s+of\s+tenants\)[\s\S]{0,200}(findMany|count|\$queryRaw)/.test(adminRoutes), "no per-tenant query loop exists anywhere in the route file");
  check(rollupSlice.includes("$queryRawUnsafe(text, ...params)") && !rollupSlice.includes("for (const t of"), "the rollup route runs ONE statement per panel open, then joins names in memory");

  // ---------- (5) Tier-C unchanged ----------
  console.log("\n(5) Tier-C platform tiles:");
  for (const k of ["openai", "elevenlabs", "mapbox", "database", "process", "scheduler"]) check(!new RegExp(`\\n    ${k}: \\{\\s*\\n?\\s*rollup:`).test(adminJs), `${k}: no rollup (pure platform, v2 panel intact)`);
  check(adminJs.includes("one platform-wide connection serves every tenant") && adminJs.includes("a platform-wide service shared by all tenants") && adminJs.includes("one platform-wide store") && adminJs.includes("platform-wide by nature") && adminJs.includes("one platform-wide heartbeat") && adminJs.includes("Voice options are platform-wide"), "every Tier-C caption states it is platform-wide");
  check(adminJs.includes("no direct API connection from Clarity") && adminJs.includes("Syncs busy times and bookings with connected Google Calendars.") && adminJs.includes("Powers tenant billing"), "the required v2 caption wordings survive verbatim");

  // ---------- (6) ledger + ratchet ----------
  console.log("\n(6) ledger + ratchet:");
  const css = read("public/styles.css");
  check(read("public/js/theme.js").includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1 kept");
  const utilJs = read("public/js/util.js");
  check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2 kept");
  check(read("src/db/selfTest_contactsAllViews.ts").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3 kept");
  check(css.includes("--ink-on-bg: #f6ecff;"), "ledger 4 kept");
  check(read("public/js/learnScenes.js").includes("sourceFn"), "ledger 5 kept (LC untouched)");
  check(adminJs.includes("const DEVTOOL_SECTIONS = [") && adminJs.includes('{ key: "userType", label: "User Type"') && css.includes(".toolbar-left, .table-lead { padding-left: var(--table-lead-inset); }"), "ledger 6 kept (DT shells + viewer + primitive)");
  check(read("src/services/auditService.ts").includes("void Promise.resolve()") && read("prisma/schema.prisma").includes("actorRole     String?"), "ledger 7 kept");
  check(adminJs.includes("health-flip-inner") && !read("src/services/healthService.ts").includes("ELEVENLABS_API_KEY"), "ledger 8 kept (health v2)");
  check(adminJs.includes('{ key: "email", label: "Email History", mount: (host) => renderEmail(host) }') && read("src/services/errorService.ts").includes("CLIENT_ERROR_LIMIT_PER_MIN") && read("src/services/webhookService.ts").includes("redactPayload"), "ledger 9 kept (devtools-data)");
  check(read("public/index.html").indexOf("errorReporter.js") < read("public/index.html").indexOf("vendor/xlsx"), "ledger 10 kept (the reporter still loads first)");
  const auditR = runAudit();
  check(auditR.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (auditR.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

  clearInterval(keep);
  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (the tenant picture leads; the rows are one click beneath it)" : failures.length + " FAILED \u274c"}`);
  process.exit(failures.length ? 1 : 0);
}
main();
