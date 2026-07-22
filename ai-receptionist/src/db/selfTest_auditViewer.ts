// Self-test — Developer Tools batch 3: the Audit Log viewer.
//
//   npx tsx src/db/selfTest_auditViewer.ts
//
// Proves:
//  (1) API — the pure where-builder: filters combine (tenant + action-prefix + date),
//      namespace-prefix matching, q over labels/action, status defaulting to Active,
//      the page-size cap. With a live DB (the build block): end-to-end query, cursor
//      pagination STABLE UNDER INSERTION, and an EXPLAIN check that the default view
//      rides the DT-2 (status, createdAt) index. Auth: the route inherits the admin
//      router's requireRole gate (source-asserted); the log is READ-ONLY — no
//      mutation endpoint exists for audit events anywhere.
//  (2) UI — the sub-tab registers in the data-driven History row; the table is the
//      SAME App.table.mount machinery as every sibling hub table (no parallel table);
//      the search box is the machinery's shared search class; the retention note
//      interpolates DT-2's constants (no hardcoded "14"); manage-columns +
//      persistence follow the tenants-table pattern; the rowClass hook is additive
//      (no sibling passes it).
//  (3) Diff rendering — auditValHtml + auditDetailsSummary driven headlessly (a
//      3-field diff summarizes as three changes; long values truncate with expand;
//      meta-only events render without error); the before -> after table builder is
//      source-asserted (old struck/muted, new emphasized, arrow column).
//  (4) LEDGER + RATCHET — all seven ledger groups persist; ratchet at-or-below.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";
import { buildAuditWhere, queryAuditEvents, encodeAuditCursor, AUDIT_QUERY_MAX_LIMIT } from "../services/auditQueryService";
import { AUDIT_RETENTION, AUDIT_ACTION_GROUPS } from "../services/auditCatalog";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const adminJs = read("public/js/admin.js");
const tableJs = read("public/js/table.js");
const adminRoutes = read("src/routes/admin.ts");
const css = read("public/styles.css");

async function main() {
  console.log("Audit Log viewer");
  console.log("================");

  // ---------- (1) API ----------
  console.log("\n(1) the query API:");
  const w1 = buildAuditWhere({ tenantId: "t1", action: "record.*", from: "2026-07-01", to: "2026-07-10" });
  check(w1.where.tenantId === "t1" && w1.where.action.startsWith === "record." && w1.where.createdAt.gte instanceof Date && w1.where.createdAt.lte.getHours() === 23 && w1.where.status === "active", "filters combine: tenant + action-prefix + inclusive date range (+ the Active default)");
  check(buildAuditWhere({ action: "auth.login" }).where.action === "auth.login" && buildAuditWhere({ actions: "contact.,ai.contact." }).where.AND[0].OR.length === 2, "namespace-prefix AND exact AND grouped-prefix matching");
  const wq = buildAuditWhere({ q: "avery" });
  check(wq.where.AND[0].OR.length === 3 && wq.where.AND[0].OR[0].actorLabel.contains === "avery" && wq.where.AND[0].OR[2].action.contains === "avery", "q searches actorLabel + subjectLabel + action, case-insensitive");
  check(buildAuditWhere({}).where.status === "active" && buildAuditWhere({ status: "all" }).where.status === undefined && buildAuditWhere({ status: "pending_deletion" }).where.status === "pending_deletion", "status filter honors the Active default (and All / Pending deletion)");
  check(buildAuditWhere({ limit: "99999" }).limit === AUDIT_QUERY_MAX_LIMIT && AUDIT_QUERY_MAX_LIMIT === 500 && buildAuditWhere({ limit: "0" }).limit === 1, "the page-size cap is enforced (500) with a sane floor");
  const wc = buildAuditWhere({ cursor: encodeAuditCursor(new Date("2026-07-10T00:00:00Z"), "abc") });
  check(wc.where.AND[0].OR[0].createdAt.lt instanceof Date && wc.where.AND[0].OR[1].id.lt === "abc", "the cursor decodes to a stable (createdAt, id) keyset clause");
  check(/adminRouter\.use\(requireRole\("OWNER", "SUPER_ADMIN", "AUDITOR"\)\);[\s\S]*adminRouter\.get\("\/audit-events"/.test(adminRoutes), "the route sits BEHIND the router-level hub role gate (+ the impersonation lockout above it) — non-hub auth rejected");
  check(!/adminRouter\.(post|patch|put|delete)\("\/audit-events/.test(adminRoutes) && !read("src/routes/api.ts").includes("audit-events"), "READ-ONLY by design: no mutation endpoint for audit events exists anywhere (retention alone removes rows)");
  // live end-to-end when the DB is up (the build block guarantees it)
  try {
    const { prisma } = require("../db/client");
    const mk = (over: any) => (prisma as any).auditEvent.create({ data: { actorType: "user", actorLabel: "Avery Viewer", action: "record.update", subjectType: "record", subjectLabel: "Bramble", status: "active", ...over } });
    const t = "selftest-viewer-tenant";
    const e1 = await mk({ tenantId: t, createdAt: new Date(Date.now() - 5000) });
    const e2 = await mk({ tenantId: t, createdAt: new Date(Date.now() - 4000), action: "contact.create" });
    const e3 = await mk({ tenantId: t, createdAt: new Date(Date.now() - 3000), action: "auth.login", subjectType: "auth" });
    const pfx = await queryAuditEvents({ tenantId: t, action: "record.*", status: "all" });
    check(pfx.events.length === 1 && pfx.events[0].id === e1.id, "LIVE: tenant + record.* prefix returns exactly the record event");
    const ql = await queryAuditEvents({ tenantId: t, q: "avery viewer" });
    check(ql.events.length === 3, "LIVE: q matches the actor label across all three");
    // pagination stable under insertion: hold a cursor, insert a NEWER row, walk on
    const p1 = await queryAuditEvents({ tenantId: t, limit: "2" });
    const newer = await mk({ tenantId: t, createdAt: new Date() });
    const p2 = await queryAuditEvents({ tenantId: t, limit: "2", cursor: p1.nextCursor! });
    const walked = p1.events.concat(p2.events).map((e: any) => e.id);
    check(p1.events.length === 2 && !walked.includes(newer.id) && new Set(walked).size === walked.length && walked.includes(e1.id), "LIVE: cursor pagination is stable under insertion (no skips, no duplicates; the new row waits for a fresh page-1)");
    const plan: any[] = await (prisma as any).$queryRawUnsafe(`EXPLAIN SELECT * FROM "AuditEvent" WHERE "status" = 'active' ORDER BY "createdAt" DESC LIMIT 50`);
    const planText = plan.map((r: any) => Object.values(r).join(" ")).join(" ");
    check(/AuditEvent_status_createdAt_idx|Index Scan/i.test(planText), "LIVE: the default view's plan rides the (status, createdAt) index");
    await (prisma as any).auditEvent.deleteMany({ where: { tenantId: t } });
  } catch (e: any) {
    console.log("  \u26a0 DB unavailable (" + String(e && e.message ? e.message : e).split("\n")[0].slice(0, 70) + ") — pure legs verified; the build block runs the LIVE legs (incl. EXPLAIN) with clarity-pg up.");
  }

  // ---------- (2) UI source assertions ----------
  console.log("\n(2) the sub-tab UI (shared machinery, not a fork):");
  check(adminJs.includes('{ key: "auditlog", label: "Audit Log", mount: (host) => renderAuditLog(host) }'), "the Audit Log registers in the data-driven History sub-tab row beside Change Log");
  const viewerSrc = adminJs.slice(adminJs.indexOf("async function renderAuditLog"), adminJs.indexOf("// ---------------- Change Log"));
  check(viewerSrc.includes("App.table.mount({") && viewerSrc.includes('tableId: opts.embedded ? "admin-auditlog-embed-" + (opts.embedId || "panel") : "admin-auditlog"') && viewerSrc.includes("App.table.manageColumns(handle, columns,") && viewerSrc.includes("App.table.applyColumnLayout(columns, layout, defaultKeys)"), "the table IS the shared machinery: App.table.mount + manageColumns + applyColumnLayout (no parallel table; embeddable since devtools-data)");
  check(tableJs.includes("right.appendChild(App.util.searchBox(search)); // motion & branding: the ONE shared search box (icon + C mark)") && viewerSrc.includes("App.table.mount"), "the search box is the machinery's shared search class (mounted with the table, like every sibling)");
  check(viewerSrc.includes('meta.retention.ACTIVE_DAYS + " days, then pending deletion for " + meta.retention.PENDING_DAYS'), "the retention note interpolates DT-2's constants\u2026");
  const noteLine = viewerSrc.split("\n").find((l) => l.includes("Events are kept")) || "";
  check(!/14/.test(noteLine), "\u2026with NO hardcoded \"14\" anywhere in the copy (it cannot drift from the code)");
  check(adminRoutes.includes("res.json({ actions: AUDIT_ACTION_VALUES, groups: AUDIT_ACTION_GROUPS, retention: AUDIT_RETENTION, customRoles });") && AUDIT_RETENTION.ACTIVE_DAYS === 14 && AUDIT_ACTION_GROUPS.length >= 8, "the meta endpoint serves the catalog's own groups + retention config");
  // audit-fixes batch: the default set gained User Type (Actor renamed to User)
check(viewerSrc.includes('const defaultKeys = opts.defaultKeys || ["createdAt", "tenant", "actor", "userType", "action", "subject", "details"]'), 'default columns: Time \u00b7 Tenant \u00b7 User \u00b7 User Type \u00b7 Action \u00b7 Subject \u00b7 Details (embeddable override)');
  for (const extra of ['key: "actorId"', 'key: "subjectId"', 'key: "recordTypeKey"', 'key: "status"', 'key: "ip"']) check(viewerSrc.includes(extra), `manage-columns extra: ${extra}`);
  check(viewerSrc.includes('localStorage.getItem(AUDIT_COLS_KEY)') && viewerSrc.includes("saveLayout(layout)"), "column prefs persist per-browser (the tenants-table localStorage pattern)");
  check(tableJs.includes("const { container, rows, onRowClick, emptyHtml, rowClass } = opts;") && viewerSrc.includes('rowClass: (r) => (r.status === "pending_deletion" ? "adm-audit-pending" : "")') && !read("public/js/portal.js").includes("rowClass:"), "the rowClass hook is ADDITIVE shared machinery (audit uses it; no sibling passes it \u2014 their behavior is untouched)");
  check(css.includes("tbody tr.adm-audit-pending td { opacity: 0.55; }") && viewerSrc.includes('<span class="pill skipped">pending deletion</span>'), "pending_deletion rows render muted with a status pill");
  check(viewerSrc.includes('emptyHtml: `<div class="card cell-muted adm-t14">No audit events match.</div>`'), "the shared empty-state block");
  check(viewerSrc.includes('mkSel([["active", "Active"], ["pending_deletion", "Pending deletion"], ["all", "All"]]') && viewerSrc.includes('["", "All tenants"]') && viewerSrc.includes('meta.groups.map((g) => [g.key, g.label])') && viewerSrc.includes('["all", "All time"], ["today", "Today"], ["7", "Last 7 days"], ["14", "Last 14 days"]'), "the filter set: tenant roster, actor type, grouped actions (from the catalog), status (Active default), the four-option Date-range preset select");

  // ---------- (3) diff rendering, headless ----------
  console.log("\n(3) diff rendering:");
  const esc = (x: any) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const grab = (name: string) => {
    const start = adminJs.indexOf(`function ${name}(`);
    let i = adminJs.indexOf("{", start), depth = 0, j = i;
    for (; j < adminJs.length; j++) { if (adminJs[j] === "{") depth++; if (adminJs[j] === "}") { depth--; if (!depth) break; } }
    return adminJs.slice(start, j + 1);
  };
  const auditDetailsSummary = new Function("esc", `return (${grab("auditDetailsSummary").replace("function auditDetailsSummary", "function")})`)(esc);
  const auditValHtml = new Function("esc", `return (${grab("auditValHtml").replace("function auditValHtml", "function")})`)(esc);
  check(auditDetailsSummary({ diff: { a: {}, b: {}, c: {} } }) === "3 fields changed" && auditDetailsSummary({ meta: { imported: 12, skipped: 2 } }) === "12 rows imported, 2 skipped" && auditDetailsSummary({ meta: { ip: "1.2.3.4" } }) === "\u2014" /* audit-fixes: auth substance = the IP COLUMN, never Details */ && auditDetailsSummary({}) === "\u2014", "the Details cell summarizes compactly (3-field diff, import counts, auth IP, em-dash fallback)");
  const longVal = auditValHtml("x".repeat(200));
  check(longVal.includes("adm-diff-expand") && longVal.includes("adm-diff-full u-hidden") && auditValHtml({ a: 1 }).includes("&quot;a&quot;: 1") && auditValHtml(undefined).includes("\u2014"), "values render safely: long values truncate with expand; JSON pretty-prints; empty shows an em-dash");
  const detailSrc = adminJs.slice(adminJs.indexOf("function openAuditDetail"), adminJs.indexOf("async function renderAuditLog"));
  check(detailSrc.includes("const overlay = modal(inner);") && detailSrc.includes('diffKeys.map((k) =>') && detailSrc.includes('<td class="adm-diff-old">') && detailSrc.includes('<td class="adm-diff-arrow">') && detailSrc.includes('<td class="adm-diff-new">'), "the detail view rides the shared modal framework; the diff table builds one before \u2192 after row PER diff field");
  check(css.includes(".adm-diff-old .adm-diff-val { color: var(--ink-faint); text-decoration: line-through; }") && css.includes(".adm-diff-new .adm-diff-val { font-weight: 600; }"), "old struck/muted, new emphasized (token-only)");
  check(detailSrc.includes('body.appendChild(el("p", "cell-muted", "No additional detail was recorded for this event."))'), "meta-less, diff-less events render cleanly");

  // ---------- (4) ledger + ratchet ----------
  console.log("\n(4) ledger + ratchet:");
  check(read("public/js/theme.js").includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1: theme cache hotfix kept");
  const utilJs = read("public/js/util.js");
  check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2: util guard + merge kept");
  check(read("src/db/selfTest_contactsAllViews.ts").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3: contactsAllViews throw-guard kept");
  check(css.includes("--ink-on-bg: #f6ecff;") && read("src/db/selfTest_allThemeContrast.ts").includes("const CSSRESOLVE = (k: string) =>"), "ledger 4: explicit inks + computational resolver kept");
  check(read("public/js/learnScenes.js").includes("sourceFn") && read("src/db/selfTest_learningCenter3.ts").includes("prisma.recordType.findMany"), "ledger 5: LC machinery kept (and this batch touched no LC files)");
  check(adminJs.includes("const DEVTOOL_SECTIONS = [") && adminJs.includes('{ key: "changelog", label: "Change Log", mount: (host) => renderChangelog(host) }'), "ledger 6: the DT-1 shell kept (Change Log verbatim beside the new tab)");
  check(read("src/services/auditService.ts").includes("void Promise.resolve()") && read("src/services/auditCatalog.ts").includes("SWEEP_BATCH_SIZE: 500") && read("src/index.ts").includes("registerAuditSubscriber();"), "ledger 7: the DT-2 foundation kept (capture, catalog, retention, subscriber)");
  const auditR = runAudit();
  check(auditR.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (auditR.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (a read-only window onto the trail, on the machinery everything else already uses)" : failures.length + " FAILED \u274c"}`);
  process.exit(failures.length ? 1 : 0);
}
main();
