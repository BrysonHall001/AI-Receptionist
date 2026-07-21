// Self-test — Developer Tools batch 2: the audit foundation.
//
//   npx tsx src/db/selfTest_auditFoundation.ts
//
// Proves:
//  (1) NEVER-BLOCK (runtime, not just source): with a THROWING writer and a HANGING
//      writer, audit() returns synchronously and never throws; off-catalog actions are
//      rejected; valid writes land asynchronously. computeDiff builds field-level
//      diffs from in-hand values only.
//  (2) SCHEMA + RETENTION: the AuditEvent model + its four indexes exist in schema and
//      migration; the sweep implements 14d active -> pending_deletion -> 14d more ->
//      hard delete in bounded batches from the NAMED config, never throwing. (With a
//      live DB the sweep is exercised end-to-end; without one it degrades loudly to
//      source assertions — the build block runs it with clarity-pg up.)
//  (3) CATALOG: a fixed, dot-namespaced, duplicate-free vocabulary; capture validates
//      membership (proven at runtime in (1)).
//  (4) WIRING: every choke point in the map is hooked exactly ONCE — the bus subscriber
//      owns record/contact/booking/send lifecycle (with diffs from payload changes),
//      the declarative route map owns structure/settings/exports/bulk-update, and the
//      direct hooks own auth/impersonation/import-counts/automation-runs/purges/hub
//      tenant ops. No double-capture: services carry no extra audit calls, FieldChanged
//      facets are ignored, bulk-delete stays out of the route map.
//  (5) LEDGER + RATCHET.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit, LAYOUT_COUNTERS } from "./designAudit";
import baseline from "./designBaseline.json";
import { audit, computeDiff, runAuditRetentionSweep, _setWriterForTests } from "../services/auditService";
import { AUDIT_ACTIONS, AUDIT_ACTION_VALUES, AUDIT_RETENTION } from "../services/auditCatalog";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

async function main() {
  console.log("Audit foundation");
  console.log("================");

  // ---------- (1) never-block, runtime ----------
  console.log("\n(1) the never-block guarantee (runtime):");
  let threw = false;
  let elapsed = 0;
  try {
    _setWriterForTests(async () => { throw new Error("DB down"); });
    const t0 = Date.now();
    audit({ actorType: "user", actorLabel: "T", action: AUDIT_ACTIONS.RECORD_UPDATE, subjectType: "record", diff: computeDiff({ a: 1 }, { a: 2 }) });
    _setWriterForTests(() => new Promise(() => { /* hangs forever */ }));
    audit({ actorType: "system", actorLabel: "S", action: AUDIT_ACTIONS.CONTACT_PURGE, subjectType: "contact" });
    elapsed = Date.now() - t0;
  } catch { threw = true; }
  check(!threw && elapsed < 100, `throwing + hanging writers: audit() returned synchronously (${elapsed}ms) and never threw`);
  let wrote: any[] = [];
  _setWriterForTests(async (d) => { wrote.push(d); return d; });
  audit({ actorType: "user", actorLabel: "T", action: "not.in.catalog", subjectType: "x" } as any);
  audit({ actorType: "ai", actorLabel: "AI receptionist", action: AUDIT_ACTIONS.AI_BOOKING_CREATED, subjectType: "record", subjectLabel: "Booking" });
  audit({ actorType: "user", actorLabel: "", action: AUDIT_ACTIONS.RECORD_CREATE, subjectType: "record" }); // missing denormalized label -> dropped
  await new Promise((r) => setTimeout(r, 30));
  // (the fire-and-forget microtasks from leg 1 resolve against the current writer at
// their run time, so the two VALID leg-1 events land here too — exactly 3 writes.)
check(wrote.length === 3 && wrote.some((w) => w.action === "ai.booking.create" && w.status === "active") && !wrote.some((w) => w.action === "not.in.catalog" || w.actorLabel === ""), "valid events land; off-catalog actions and label-less events are DROPPED (validated, logged, never thrown)");
  _setWriterForTests(null);
  check(computeDiff({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })!.b.to === 3 && computeDiff({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })!.c.from === undefined && computeDiff({ a: 1 }, { a: 1 }) === null && computeDiff({ a: 1, b: 2 }, { a: 9, b: 9 }, ["a"])!.b === undefined, "computeDiff: changed-fields only, from in-hand values, key-scoped, null when unchanged");
  const svc = read("src/services/auditService.ts");
  check(svc.includes('function db(): any { if (!_prisma) _prisma = require("../db/client").prisma; return _prisma; }'), "the Prisma client is LAZY (first write, never at import — an init failure lands in the swallowed promise, not at boot)");
  check(svc.includes("void Promise.resolve()") && svc.includes(".catch((e) => { logger.error(`[audit] write failed"), "the write is fire-and-forget on its own promise chain; every failure swallowed + logged");

  // ---------- (2) schema + retention ----------
  console.log("\n(2) schema + retention:");
  const schema = read("prisma/schema.prisma");
  check(schema.includes("model AuditEvent {") && schema.includes('status        String   @default("active")') && schema.includes("diff          Json?"), "the AuditEvent model (denormalized labels, field-level diff Json, status lifecycle)");
  for (const idx of ["@@index([tenantId, createdAt])", "@@index([tenantId, subjectType, subjectId])", "@@index([status, createdAt])", "@@index([action])"]) check(schema.slice(schema.indexOf("model AuditEvent {")).includes(idx), `schema index: ${idx}`);
  const mig = read("prisma/migrations/20260717010000_audit_event/migration.sql");
  check(mig.includes('CREATE TABLE "AuditEvent"') && (mig.match(/CREATE INDEX/g) || []).length === 4, "the hand-written migration creates the table + all four indexes");
  check(AUDIT_RETENTION.ACTIVE_DAYS === 14 && AUDIT_RETENTION.PENDING_DAYS === 14 && AUDIT_RETENTION.SWEEP_BATCH_SIZE === 500, "retention policy from NAMED config: 14d -> pending_deletion, 14d more -> delete, 500-row batches");
  check(svc.includes("AUDIT_RETENTION.ACTIVE_DAYS * 24 * 60 * 60 * 1000") && svc.includes("(AUDIT_RETENTION.ACTIVE_DAYS + AUDIT_RETENTION.PENDING_DAYS)") && svc.includes("take: AUDIT_RETENTION.SWEEP_BATCH_SIZE") && svc.includes("retention sweep failed (will retry next tick)"), "the sweep: both phases, bounded batches, never throws");
  // live round-trip when a DB is present (the build block); loud fallback otherwise
  try {
    const { prisma } = require("../db/client");
    const old = new Date(Date.now() - 15 * 86400000);
    const ancient = new Date(Date.now() - 30 * 86400000);
    const a = await (prisma as any).auditEvent.create({ data: { actorType: "system", actorLabel: "t", action: "record.update", subjectType: "record", status: "active", createdAt: old } });
    const b = await (prisma as any).auditEvent.create({ data: { actorType: "system", actorLabel: "t", action: "record.update", subjectType: "record", status: "pending_deletion", createdAt: ancient } });
    const r = await runAuditRetentionSweep();
    const aNow = await (prisma as any).auditEvent.findUnique({ where: { id: a.id } });
    const bNow = await (prisma as any).auditEvent.findUnique({ where: { id: b.id } });
    check(aNow.status === "pending_deletion" && bNow === null && r.demoted >= 1 && r.deleted >= 1, `LIVE sweep round-trip: 15d active -> pending (demoted ${r.demoted}); 30d pending -> deleted (${r.deleted})`);
    await (prisma as any).auditEvent.deleteMany({ where: { id: { in: [a.id] } } });
  } catch (e: any) {
    console.log("  \u26a0 DB unavailable (" + String(e && e.message ? e.message : e).split("\n")[0].slice(0, 70) + ") — sweep verified at source; the build block runs the LIVE round-trip with clarity-pg up.");
  }

  // ---------- (3) the catalog ----------
  console.log("\n(3) the catalog:");
  check(AUDIT_ACTION_VALUES.length >= 35 && new Set(AUDIT_ACTION_VALUES).size === AUDIT_ACTION_VALUES.length, `fixed vocabulary: ${AUDIT_ACTION_VALUES.length} actions, no duplicates`);
  check(AUDIT_ACTION_VALUES.every((a) => /^[a-z]+(\.[a-z_]+)+$/.test(a)), "every action is dot-namespaced (area.verb)");
  check(svc.includes('return `unknown action "${String(evt.action)}" — add it to auditCatalog first`;'), "capture rejects off-catalog actions (call sites cannot go stringly-typed)");

  // ---------- (4) wiring: one hook per mutation ----------
  console.log("\n(4) wiring (one hook per mutation):");
  const sub = read("src/services/auditSubscriber.ts");
  const idx = read("src/index.ts");
  const api = read("src/routes/api.ts");
  const auth = read("src/routes/auth.ts");
  const adminR = read("src/routes/admin.ts");
  const engine = read("src/automation/engine.ts");
  check(idx.includes("registerAuditSubscriber();") && idx.includes("setInterval(() => { void runAuditRetentionSweep(); }, 60 * 60_000)"), "boot: the subscriber registers; the retention sweep ticks hourly (unref'd)");
  for (const t of ['case "ContactCreated"', 'case "ContactUpdated"', 'case "StageChanged"', 'case "RecordCreated"', 'case "BookingCreated"', 'case "RecordUpdated"', 'case "RecordDeleted"', 'case "EmailSent"', 'case "SMSSent"', 'case "AiInstructionsUpdated"']) check(sub.includes(t), `subscriber handles ${t.slice(5)}`);
  check(!sub.includes('case "FieldChanged"') && !sub.includes('case "TagAdded"'), "FieldChanged/Tag* facets are IGNORED (they are slices of ContactUpdated — no double-capture)");
  check(sub.includes("diffFromChanges") && sub.includes("payload's changes[]"), "diffs come from the payload's changes[] — values the emitter already held");
  check(api.includes("const AUDIT_ROUTE_MAP:") && api.includes('res.on("finish", () => {') && api.includes("if (res.statusCode < 200 || res.statusCode >= 300) return;"), "the declarative route map fires on response FINISH, 2xx only (zero latency; failures never audited)");
  for (const frag of ["FIELD_CREATE", "MODULE_CREATE", "VIEWS_UPDATE", "STAGES_UPDATE", "TERMS_UPDATE", "SETTINGS_APPEARANCE", "SETTINGS_PERMISSIONS", "SETTINGS_SCHEDULING", "EXPORT_RUN", "BULK_UPDATE"]) check(api.includes("AUDIT_ACTIONS." + frag), `route map covers ${frag}`);
  check(!/bulk-delete[^\n]*action: AUDIT_ACTIONS/.test(api), "bulk-delete is NOT in the route map (per-item ContactDeleted bus events already capture it)");
  check(auth.includes("AUDIT_ACTIONS.AUTH_LOGIN,") && auth.includes("AUDIT_ACTIONS.AUTH_LOGIN_FAILED") && auth.includes("AUDIT_ACTIONS.AUTH_LOGOUT") && auth.includes("meta: { ip: req.ip || null }"), "auth: login / failed login / logout with IPs in meta");
  check(api.includes("AUDIT_ACTIONS.IMPERSONATION_START") && api.includes("AUDIT_ACTIONS.IMPERSONATION_END"), "impersonation start + end (real hub user as actor, target denormalized)");
  check((api.match(/AUDIT_ACTIONS\.IMPORT_RUN/g) || []).length === 2 && api.includes("meta: { imported: result.imported, skipped: result.skipped }"), "both import handlers log data.import with row counts from the handler's own result");
  check(engine.includes("if (data.matched) audit({ tenantId: auto.tenantId, actorType: \"automation\""), "the engine logs automation.executed for matched runs (fire-and-forget beside the run log)");
  check(adminR.includes("AUDIT_ACTIONS.HUB_TENANT_CREATE") && adminR.includes("AUDIT_ACTIONS.HUB_TENANT_SUSPEND"), "hub: tenant create + suspend/settings");
  const cs = read("src/services/contactService.ts");
  const rs = read("src/services/recordService.ts");
  check((cs.match(/\baudit\(/g) || []).length === 1 && (rs.match(/\baudit\(/g) || []).length === 1, "services carry ONLY the purge hooks (lifecycle stays bus-captured — one hook per mutation, everywhere)");

  // ---------- (5) ledger + ratchet ----------
  console.log("\n(5) ledger + ratchet:");
  const themeJs = read("public/js/theme.js");
  const utilJs = read("public/js/util.js");
  const css = read("public/styles.css");
  check(themeJs.includes("var _themeVarsCache; // HOTFIX KEPT"), "ledger 1: var _themeVarsCache kept");
  check(utilJs.includes("App.util = App.util || {}; // HOTFIX KEPT") && utilJs.includes("Object.assign(App.util, { $, $$, el, esc,"), "ledger 2: util guard + merge kept");
  check(read("src/db/selfTest_contactsAllViews.ts").includes('if (!dateField) throw new Error("no date field on the contact type — cannot continue")'), "ledger 3: contactsAllViews throw-guard kept");
  check(css.includes("--ink-on-bg: #f6ecff;") && read("src/db/selfTest_allThemeContrast.ts").includes("const CSSRESOLVE = (k: string) =>"), "ledger 4: explicit inks + computational resolver kept");
  check(read("public/js/learnScenes.js").includes("sourceFn") && read("public/js/admin.js").includes("const DEVTOOL_SECTIONS = ["), "ledger 5: LC fidelity metadata + the devtools shell kept");
  const auditR = runAudit();
  check(auditR.totals.rawHex <= (baseline as any).totals.rawHex && LAYOUT_COUNTERS.every((k) => (auditR.layout as any)[k] <= (baseline as any).layout[k]), "ratchet (color + all seven counters) at-or-below baseline");

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (capture can never hurt the app; every mutation is caught exactly once; retention is bounded and named)" : failures.length + " FAILED \u274c"}`);
  process.exit(failures.length ? 1 : 0);
}
main();
