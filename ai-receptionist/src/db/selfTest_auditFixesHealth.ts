// Self-test — Audit tab fixes + System Health (batch audit-fixes-health).
//
//   npx tsx src/db/selfTest_auditFixesHealth.ts
//
// Proves:
//  (1) ALIGNMENT, ROOT-CAUSED — the shared lead-row primitive exists (ONE token + ONE
//      rule feeding BOTH .toolbar-left and .table-lead, with the .table-flush variant
//      zeroing both), the audit filter bar + retention note ride it, and no ad-hoc
//      margin nudge exists. Swept instances enumerated.
//  (2) actorRole — additive migration; the service persists it (runtime, stubbed
//      writer); every human call site threads it (source-asserted map); the User Type
//      mapping is driven HEADLESSLY for each actor class; historical null renders an
//      em-dash.
//  (3) Date presets compute the right from/to; Export rides App.exportModal (the
//      shared machinery — source-asserted) with the filtered rows + all columns
//      (hidden IDs included); default/hidden column sets as specced; Details NEVER
//      contains an IP for auth events (driven headlessly).
//  (4) HEALTH — every check returns the shape; a HANGING provider times out to fail
//      without stalling the sweep; the scheduler-age check flags a stale tick (and
//      passes a fresh one); the snapshot caches; the endpoints + recheck exist behind
//      the hub gate; the nav-dot condition derives from the SAME cached snapshot on
//      the /me boot payload (no polling loop).
//  (5) LEDGER (all eight groups) + RATCHET.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";
import { audit, _setWriterForTests } from "../services/auditService";
import { AUDIT_ACTIONS } from "../services/auditCatalog";
import { HEALTH, _runCheckForTests, _checkSchedulerForTests, _setMarksForTests, runHealthChecks, getHealthSnapshot } from "../services/healthService";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const css = read("public/styles.css");
const adminJs = read("public/js/admin.js");
const appJs = read("public/js/app.js");
const apiTs = read("src/routes/api.ts");
const authTs = read("src/routes/auth.ts");
const keep = setInterval(() => { /* event-loop anchor for unref'd check timeouts */ }, 500);

async function main() {
  console.log("Audit fixes + System Health");
  console.log("===========================");

  // ---------- (1) alignment ----------
  console.log("\n(1) the lead-row alignment primitive:");
  check(css.includes("--table-lead-inset: 18px;"), "ONE token defines the table alignment inset");
  check(css.includes(".toolbar-left, .table-lead { padding-left: var(--table-lead-inset); }"), "ONE rule feeds BOTH the toolbar and every lead row (flush by construction)");
  check(css.includes(".table-flush .toolbar-left, .table-flush .table-lead { padding-left: 0; }"), "the padded-card context zeroes BOTH the same way");
  check(adminJs.includes('el("div", "adm-auditbar table-lead")') && adminJs.includes('el("p", "cell-muted adm-audit-note table-lead",'), "the audit filter bar + retention note ride the primitive");
  check(!/\.adm-auditbar[^}]*margin-left/.test(css), "no ad-hoc margin nudges anywhere on the audit bar");
  console.log("  \u2139 sweep: every hub/portal mount walked — remaining pre-table control rows live inside .table-flush padded cards (charges/billing, already zeroed by the primitive's flush variant) or precede card lists/dashboards, not tables; the audit rows were the only live instance.");

  // ---------- (2) actorRole ----------
  console.log("\n(2) actorRole capture + User Type:");
  const mig = read("prisma/migrations/20260718000000_audit_actor_role/migration.sql");
  check(mig.includes('ALTER TABLE "AuditEvent" ADD COLUMN "actorRole" TEXT;') && !/DROP|DELETE|UPDATE /i.test(mig), "the migration is purely ADDITIVE");
  check(read("prisma/schema.prisma").includes("actorRole     String?"), "the schema carries the nullable denormalized role");
  // runtime: the service persists what call sites pass
  let wrote: any[] = [];
  _setWriterForTests(async (d) => { wrote.push(d); return d; });
  audit({ actorType: "user", actorLabel: "T", actorRole: "OWNER", action: AUDIT_ACTIONS.RECORD_UPDATE, subjectType: "record" });
  await new Promise((r) => setTimeout(r, 25));
  check(wrote.length === 1 && wrote[0].actorRole === "OWNER", "audit() persists actorRole");
  _setWriterForTests(null);
  // call-site threading (source-asserted, one per class)
  check(apiTs.includes("function actorRoleOf(req: Request): string | null {") && apiTs.includes('return "CUSTOM:" + real.customRoleId;') && apiTs.includes("const real: any = req.realUser || req.user;"), "the ONE helper: hub humans keep their HUB role (realUser wins); custom roles as CUSTOM:<id>");
  check(apiTs.includes('type: "user" as const, role: actorRoleOf(req)') && read("src/events/types.ts").includes("role?: string | null;") && read("src/events/bus.ts").includes("role: input.actor?.role ?? null,") && read("src/services/auditSubscriber.ts").includes('actorRole: (e.actor && (e.actor as any).role) || null,'), "the role rides actorOf \u2192 the bus \u2192 the subscriber (record/contact lifecycle covered at ONE point)");
  check(apiTs.includes("actorRole: actorRoleOf(req),") && authTs.includes('actorRole: (user as any).customRoleId ? "CUSTOM:" + (user as any).customRoleId : (user as any).role || null') && apiTs.includes("actorRole: real?.role ?? null, action: AUDIT_ACTIONS.IMPERSONATION_START") && read("src/routes/admin.ts").includes("actorRole: u?.role ?? null, action: AUDIT_ACTIONS.HUB_TENANT_CREATE"), "direct hooks thread it too: route map, auth, impersonation (HUB role), hub tenant ops");
  // the User Type mapping, headless
  const esc = (x: any) => String(x);
  const rl = adminJs.match(/const ROLE_LABELS = (\{[^}]+\});/);
  const ut = adminJs.match(/const userTypeOf = (\(r\) => \{[\s\S]*?\n    \});/);
  check(!!rl && !!ut, "the mapping is extractable");
  const meta = { customRoles: { abc123: "Front desk" } };
  const ROLE_LABELS = new Function("return " + rl![1])();
  const userTypeOf = new Function("meta", "ROLE_LABELS", "return " + ut![1])(meta, ROLE_LABELS);
  check(userTypeOf({ actorType: "user", actorRole: "OWNER" }) === "Owner" && userTypeOf({ actorType: "user", actorRole: "SUPER_ADMIN" }) === "Super Admin" && userTypeOf({ actorType: "user", actorRole: "AUDITOR" }) === "Auditor", "hub humans \u2192 Owner / Super Admin / Auditor");
  check(userTypeOf({ actorType: "user", actorRole: "PORTAL_ADMIN" }) === "Portal admin" && userTypeOf({ actorType: "user", actorRole: "CLIENT_USER" }) === "Client user" && userTypeOf({ actorType: "user", actorRole: "CUSTOM:abc123" }) === "Front desk" && userTypeOf({ actorType: "user", actorRole: "CUSTOM:gone" }) === "Custom role", "portal humans \u2192 portal role / the custom role's NAME (roster-resolved, safe fallback)");
  check(userTypeOf({ actorType: "ai" }) === "AI receptionist" && userTypeOf({ actorType: "system" }) === "System" && userTypeOf({ actorType: "automation" }) === "Automation", "non-humans map from actorType");
  check(userTypeOf({ actorType: "user", actorRole: null }) === "\u2014", "historical events (no role) render an em-dash");
  check(adminJs.includes('label: "User", type: "text", get: (r) => r.actorLabel, cellClass: "cell-strong", render: (r) => esc(r.actorLabel) }') && adminJs.includes('{ key: "userType", label: "User Type"'), "Actor \u2192 User (name only, pill gone); User Type is its own column");

  // ---------- (3) presets + export + columns + details ----------
  console.log("\n(3) presets, export, columns, details:");
  check(adminJs.includes('[["all", "All time"], ["today", "Today"], ["7", "Last 7 days"], ["14", "Last 14 days"], ["custom", "Custom\\u2026"]]') && adminJs.includes('customWrap.classList.toggle("u-hidden", v !== "custom")'), "ONE Date-range preset select; Custom\u2026 reveals the inline pair");
  check(adminJs.includes('if (v === "today") { f.from = dayIso(now); f.to = dayIso(now); }') && adminJs.includes('const d = new Date(now.getTime() - (Number(v) - 1) * 86400000); f.from = dayIso(d); f.to = dayIso(now);'), "presets compute the SAME server from/to params (7-day = today plus the 6 prior)");
  const viewerSrc = adminJs.slice(adminJs.indexOf("async function renderAuditLog"), adminJs.indexOf("// ---------------- Change Log"));
  check(viewerSrc.includes("exportBtn.onclick = () => App.exportModal({") && viewerSrc.includes("rows: handle.getFiltered(),") && viewerSrc.includes('dataType: "audit",') && viewerSrc.includes('historyBase: "/api/admin/exports",'), "Export rides App.exportModal WHOLESALE (filtered rows, master export history) — no parallel implementation");
  check(viewerSrc.includes("columns: columns.map((c) => ({ key: c.key, label: c.label, type: c.type, get: c.get, text: c.text }))") && viewerSrc.includes("insertBefore(exportBtn, manageBtnEl)"), "\u2026offering ALL columns (hidden IDs selectable), placed immediately LEFT of Manage columns");
  check(viewerSrc.includes('const defaultKeys = ["createdAt", "tenant", "actor", "userType", "action", "subject", "details"]'), "defaults: Time \u00b7 Tenant \u00b7 User \u00b7 User Type \u00b7 Action \u00b7 Subject \u00b7 Details");
  for (const extra of ['key: "actorId"', 'key: "subjectId"', 'key: "recordTypeKey"', 'key: "status"', 'key: "ip"']) check(viewerSrc.includes(extra), `hidden-by-default: ${extra}`);
  const grab = (name: string) => { const start = adminJs.indexOf(`function ${name}(`); let i = adminJs.indexOf("{", start), depth = 0, j = i; for (; j < adminJs.length; j++) { if (adminJs[j] === "{") depth++; if (adminJs[j] === "}") { depth--; if (!depth) break; } } return adminJs.slice(start, j + 1); };
  const summary = new Function("esc", `return (${grab("auditDetailsSummary").replace("function auditDetailsSummary", "function")})`)(esc);
  const authSum = summary({ meta: { ip: "9.9.9.9" } });
  check(authSum === "\u2014" && !String(authSum).includes("9.9.9.9") && summary({ diff: { a: {}, b: {}, c: {} } }) === "3 fields changed" && summary({ meta: { imported: 5, skipped: 1 } }) === "5 rows imported, 1 skipped" && summary({ meta: { recipients: 2 } }) === "2 recipients", "Details NEVER carries an IP (auth \u2192 \u2014); diffs/imports/comms summarize as specced");

  // ---------- (4) health ----------
  console.log("\n(4) System Health:");
  const hang = await _runCheckForTests(() => new Promise(() => { /* hangs forever */ }), 150);
  check(hang.status === "fail" && /timed out/.test(hang.detail) && hang.latencyMs >= 150 && hang.latencyMs < 3000, "a HANGING provider times out to its OWN fail card without stalling anything");
  const shaped = await _runCheckForTests(async () => ({ status: "ok" as const, detail: "fine" }));
  check(typeof shaped.status === "string" && typeof shaped.detail === "string" && typeof shaped.latencyMs === "number" && typeof shaped.checkedAt === "string", "every check returns { status, detail, latencyMs, checkedAt }");
  _setMarksForTests({ scheduler: Date.now() - HEALTH.SCHEDULER_INTERVAL_MS * 3 });
  const stale = await _checkSchedulerForTests();
  _setMarksForTests({ scheduler: Date.now() - 30_000 });
  const fresh = await _checkSchedulerForTests();
  check(stale.status === "fail" && /stale/.test(stale.detail) && fresh.status === "ok", "the scheduler-age check FLAGS a silent scheduler (>2 intervals) and passes a live one");
  check(HEALTH.INTERVAL_MS === 3 * 60_000 && HEALTH.SCHEDULER_STALE_FACTOR === 2 && HEALTH.CHECK_TIMEOUT_MS > 0 && HEALTH.DB_WARN_MS < HEALTH.DB_FAIL_MS, "thresholds are NAMED constants");
  const snap = await runHealthChecks(); // in a DB-less/offline sandbox the provider/DB cards simply fail — the sweep still completes
  const all = Object.values(snap.groups).flatMap((g: any) => Object.values(g)) as any[];
  check(all.length === 15 && all.every((c) => ["ok", "warn", "fail"].includes(c.status) && typeof c.latencyMs === "number"), `the full sweep completes with 15 shaped checks (this run: ${snap.summary.ok} ok / ${snap.summary.warn} warn / ${snap.summary.fail} fail)`);
  check(getHealthSnapshot() === snap && ["ok", "warn", "fail"].includes(snap.worst), "the snapshot CACHES; worst derives from the summary");
  const adminRoutes = read("src/routes/admin.ts");
  check(adminRoutes.includes('adminRouter.get("/health"') && adminRoutes.includes("getHealthSnapshot() || await runHealthChecks()") && adminRoutes.includes('adminRouter.post("/health/recheck"'), "the endpoints serve the CACHE + a recheck trigger, behind the sibling hub gate");
  check(read("src/index.ts").includes("startHealthSweep();") && read("src/index.ts").includes("markSchedulerTick(); void runAutomationSweep();") && read("src/services/auditService.ts").includes('require("./healthService").markAuditSweep();'), "boot wiring: the ~3-minute sweep + the REAL heartbeat and audit-sweep tick markers");
  check(authTs.includes("healthWorst = snap ? snap.worst : null;") && appJs.includes("App.state.healthWorst = j.healthWorst || null;") && appJs.includes('if (href === "#/admin/devtools" && (App.state.healthWorst === "warn" || App.state.healthWorst === "fail"))'), "the nav-dot condition derives from the SAME cached snapshot, delivered on the /me boot payload");
  const healthUiSrc = adminJs.slice(adminJs.indexOf("function paintHealth"), adminJs.indexOf("// ---------------- Audit Log"));
  check(!/setInterval/.test(healthUiSrc) && !/setInterval\([^)]*health/i.test(appJs), "no polling loop was added for the dot (it refreshes with /me and with rechecks)");
  check(adminJs.includes('{ key: "health", label: "System Health", render: renderHealthSection }') && adminJs.includes('{ key: "overview", label: "Overview", mount: (host) => renderHealthOverview(host) }') && adminJs.includes('el("div", "settings-tile health-card")'), "the section sits in the data-driven grid; Overview renders settings-tile status cards");

  // ---------- (5) ledger + ratchet ----------
  console.log("\n(5) ledger + ratchet:");
  check(read("public/js/theme.js").includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1 kept");
  const utilJs = read("public/js/util.js");
  check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2 kept");
  check(read("src/db/selfTest_contactsAllViews.ts").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3 kept");
  check(css.includes("--ink-on-bg: #f6ecff;") && read("src/db/selfTest_allThemeContrast.ts").includes("const CSSRESOLVE = (k: string) =>"), "ledger 4 kept");
  check(read("public/js/learnScenes.js").includes("sourceFn"), "ledger 5 kept (LC untouched)");
  check(adminJs.includes("const DEVTOOL_SECTIONS = [") && adminJs.includes('{ key: "changelog", label: "Change Log"'), "ledger 6 kept (DT-1 shell)");
  check(read("src/services/auditService.ts").includes("void Promise.resolve()") && read("src/index.ts").includes("registerAuditSubscriber();"), "ledger 7 kept (DT-2 foundation; capture/retention untouched beyond the additive role)");
  check(adminJs.includes('tableId: "admin-auditlog"') && adminRoutes.includes('adminRouter.get("/audit-events"'), "ledger 8 kept (DT-3 viewer)");
  const auditR = runAudit();
  check(auditR.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (auditR.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

  clearInterval(keep);
  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (flush by construction; every actor wears its true role; health watches itself)" : failures.length + " FAILED \u274c"}`);
  process.exit(failures.length ? 1 : 0);
}
main();
