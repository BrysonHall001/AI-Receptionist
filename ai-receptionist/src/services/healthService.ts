// System Health (devtools batch: audit-fixes-health) — cached service checks.
//
// Runs EVERY check on a ~3-minute interval (the index.ts guarded-setInterval pattern,
// like the other sweeps), caches the snapshot, and serves it from the admin endpoint
// (which can also trigger an immediate re-check). Every check returns
//   { status: "ok" | "warn" | "fail", detail, latencyMs, checkedAt }
// with thresholds as NAMED constants. Every external ping is the cheapest possible
// authenticated call (documented per check), wrapped in a PER-CHECK TIMEOUT so a
// hanging provider can only fail its own card — never stall the sweep or the app.
import { env, geocodingEnabled } from "../config/env";
import { logger } from "../utils/logger";

// Lazy DB (the audit-service convention): never touched at import.
let _prisma: any = null;
function db(): any { if (!_prisma) _prisma = require("../db/client").prisma; return _prisma; }

// ---------------- named thresholds ----------------
export const HEALTH = {
  INTERVAL_MS: 3 * 60_000,          // the sweep cadence (~3 minutes)
  CHECK_TIMEOUT_MS: 6_000,          // per-check budget; a hang becomes ITS OWN fail
  DB_WARN_MS: 250, DB_FAIL_MS: 1500,
  SCHEDULER_INTERVAL_MS: 2 * 60_000, // the automation heartbeat's real cadence
  SCHEDULER_STALE_FACTOR: 2,        // fail when last tick is older than 2 intervals
  AUDIT_SWEEP_WARN_MS: 2 * 60 * 60_000, AUDIT_SWEEP_FAIL_MS: 6 * 60 * 60_000, // hourly sweep
  GEO_PENDING_WARN: 200, GEO_FAILED_WARN: 1,
  AUTOMATION_FAILS_24H_WARN: 1, AUTOMATION_FAILS_24H_FAIL: 25,
  DRIP_OVERDUE_GRACE_MS: 10 * 60_000, DRIP_OVERDUE_WARN: 1, DRIP_FAILED_24H_WARN: 1,
  WEBHOOK_FAILS_24H_WARN: 1, WEBHOOK_FAILS_24H_FAIL: 25,
  FAILED_LOGINS_24H_WARN: 10, FAILED_LOGINS_24H_FAIL: 50,
  MEM_WARN_MB: 768, MEM_FAIL_MB: 1536,
} as const;

export type HealthStatus = "ok" | "warn" | "fail";
export interface HealthCheck { status: HealthStatus; detail: string; latencyMs: number; checkedAt: string; }
export interface HealthSnapshot {
  checkedAt: string;
  summary: { ok: number; warn: number; fail: number };
  worst: HealthStatus;
  groups: { external: Record<string, HealthCheck>; internal: Record<string, HealthCheck>; background: Record<string, HealthCheck>; pulse: Record<string, HealthCheck> };
}

// ---------------- tick markers (instrumented by the real loops) ----------------
let lastSchedulerTickAt: number | null = null;
export function markSchedulerTick(): void { lastSchedulerTickAt = Date.now(); } // called by index.ts's automation heartbeat
let lastAuditSweepAt: number | null = null;
export function markAuditSweep(): void { lastAuditSweepAt = Date.now(); } // called by runAuditRetentionSweep
export function _setMarksForTests(m: { scheduler?: number | null; audit?: number | null }): void {
  if ("scheduler" in m) lastSchedulerTickAt = m.scheduler ?? null;
  if ("audit" in m) lastAuditSweepAt = m.audit ?? null;
}

const BOOT_AT = Date.now();

// ---------------- the per-check timeout harness ----------------
type CheckFn = () => Promise<{ status: HealthStatus; detail: string }>;
async function runCheck(fn: CheckFn, timeoutMs: number = HEALTH.CHECK_TIMEOUT_MS): Promise<HealthCheck> {
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => { const t = setTimeout(() => rej(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs); (t as any).unref && (t as any).unref(); }),
    ]);
    return { ...r, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
  } catch (e) {
    return { status: "fail", detail: (e as Error).message || "check failed", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
  }
}
export const _runCheckForTests = runCheck;
export const _checkSchedulerForTests = () => checkScheduler();

const H24 = () => new Date(Date.now() - 24 * 60 * 60_000);
const fmtAge = (ms: number) => ms < 90_000 ? Math.round(ms / 1000) + "s" : ms < 90 * 60_000 ? Math.round(ms / 60_000) + "m" : Math.round(ms / 3_600_000) + "h";

// ---------------- the checks ----------------
// EXTERNAL
// Twilio — EXACT CALL: GET /2010-04-01/Accounts/{sid}/Balance.json (one tiny authed
// fetch; returns the balance too, so the card shows it for free).
const checkTwilio: CheckFn = async () => {
  const sid = env.TWILIO_ACCOUNT_SID, tok = env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return { status: "warn", detail: "Not configured" };
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Balance.json`, { headers: { Authorization: "Basic " + Buffer.from(sid + ":" + tok).toString("base64") } });
  if (!r.ok) return { status: "fail", detail: `HTTP ${r.status}` };
  const b: any = await r.json();
  return { status: "ok", detail: b && b.balance !== undefined ? `Balance ${b.balance} ${b.currency || ""}`.trim() : "Authenticated" };
};
// OpenAI — EXACT CALL: GET https://api.openai.com/v1/models (list; costs nothing, proves the key).
const checkOpenAi: CheckFn = async () => {
  if (!env.OPENAI_API_KEY) return { status: "warn", detail: "Not configured" };
  const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
  return r.ok ? { status: "ok", detail: "Authenticated" } : { status: "fail", detail: `HTTP ${r.status}` };
};
// ElevenLabs — EXACT CALL: GET https://api.elevenlabs.io/v1/user with xi-api-key (the
// cheapest authed ping). NOTE: this deployment drives ElevenLabs through Twilio
// ConversationRelay (only a voice id is configured), so with no direct key the card
// reports that honestly instead of pinging.
const checkElevenLabs: CheckFn = async () => {
  const key = (env as any).ELEVENLABS_API_KEY as string | undefined;
  if (!key) return { status: "warn", detail: "No direct API key — voice runs via Twilio ConversationRelay (voice id set)" };
  const r = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": key } });
  return r.ok ? { status: "ok", detail: "Authenticated" } : { status: "fail", detail: `HTTP ${r.status}` };
};
// Mapbox — EXACT CALL: GET geocoding/v5/mapbox.places/{fixed address}.json?limit=1 —
// one fixed-address forward geocode, ONLY when geocoding is enabled; else warn.
const checkMapbox: CheckFn = async () => {
  if (!geocodingEnabled()) return { status: "warn", detail: "Not configured (no Mapbox token — maps and geocoding off)" };
  const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent("1600 Pennsylvania Ave NW, Washington DC")}.json?limit=1&access_token=${encodeURIComponent(env.MAPBOX_TOKEN)}`);
  if (!r.ok) return { status: "fail", detail: `HTTP ${r.status}` };
  const j: any = await r.json();
  return { status: j && Array.isArray(j.features) && j.features.length ? "ok" : "warn", detail: j.features && j.features.length ? "Geocode round-trip OK" : "Responded but returned no feature" };
};
// Google — EXACT CALL: none (a DB token-sanity read: connections + expired access
// tokens; refresh happens elsewhere). No account connected => neutral ok.
const checkGoogle: CheckFn = async () => {
  const rows = await db().googleConnection.findMany({ select: { accessTokenExpiresAt: true, refreshTokenEnc: true } });
  if (!rows.length) return { status: "ok", detail: "Not connected" };
  const expired = rows.filter((r: any) => r.accessTokenExpiresAt && new Date(r.accessTokenExpiresAt).getTime() < Date.now() && !r.refreshTokenEnc).length;
  return expired ? { status: "warn", detail: `${rows.length} connected; ${expired} with an expired token and no refresh token` } : { status: "ok", detail: `${rows.length} connected; tokens sane` };
};
// INTERNAL
// DB — EXACT CALL: SELECT 1 + a trivial count (tenant). Latency thresholds named above.
const checkDb: CheckFn = async () => {
  const t0 = Date.now();
  await db().$queryRaw`SELECT 1`;
  const tenants = await db().tenant.count();
  const ms = Date.now() - t0;
  const status: HealthStatus = ms > HEALTH.DB_FAIL_MS ? "fail" : ms > HEALTH.DB_WARN_MS ? "warn" : "ok";
  return { status, detail: `Connected; ${tenants} tenants; round-trip ${ms}ms` };
};
// Process — local process.uptime() + memoryUsage().rss.
const checkProcess: CheckFn = async () => {
  const mb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const status: HealthStatus = mb > HEALTH.MEM_FAIL_MB ? "fail" : mb > HEALTH.MEM_WARN_MB ? "warn" : "ok";
  return { status, detail: `Up ${fmtAge(process.uptime() * 1000)}; memory ${mb} MB` };
};
// BACKGROUND
// Scheduler — the age of the REAL heartbeat's last tick (index.ts calls
// markSchedulerTick() inside the automation-sweep interval). THIS is the check that
// catches a silent scheduler: > 2 intervals old = fail.
const checkScheduler: CheckFn = async () => {
  if (lastSchedulerTickAt == null) {
    return Date.now() - BOOT_AT < HEALTH.SCHEDULER_INTERVAL_MS * HEALTH.SCHEDULER_STALE_FACTOR
      ? { status: "ok", detail: "Awaiting first tick since boot" }
      : { status: "fail", detail: "NO tick since boot — the scheduler is silent" };
  }
  const age = Date.now() - lastSchedulerTickAt;
  if (age > HEALTH.SCHEDULER_INTERVAL_MS * HEALTH.SCHEDULER_STALE_FACTOR) return { status: "fail", detail: `Last tick ${fmtAge(age)} ago — stale (expected every ${fmtAge(HEALTH.SCHEDULER_INTERVAL_MS)})` };
  return { status: "ok", detail: `Last tick ${fmtAge(age)} ago` };
};
// Geocode queue — ContactGeo + RecordGeo counts by status (pending backlog / failed rows).
const checkGeoQueue: CheckFn = async () => {
  if (!geocodingEnabled()) return { status: "ok", detail: "Geocoding off — queue idle by design" };
  const [cp, cf, rp, rf] = await Promise.all([
    db().contactGeo.count({ where: { status: "pending" } }), db().contactGeo.count({ where: { status: "failed" } }),
    db().recordGeo.count({ where: { status: "pending" } }), db().recordGeo.count({ where: { status: "failed" } }),
  ]);
  const pending = cp + rp, failed = cf + rf;
  const status: HealthStatus = failed >= HEALTH.GEO_FAILED_WARN || pending >= HEALTH.GEO_PENDING_WARN ? "warn" : "ok";
  return { status, detail: `${pending} pending, ${failed} failed` };
};
// Audit retention — the age of the last sweep (runAuditRetentionSweep calls markAuditSweep()).
const checkAuditSweep: CheckFn = async () => {
  if (lastAuditSweepAt == null) {
    return Date.now() - BOOT_AT < HEALTH.AUDIT_SWEEP_WARN_MS ? { status: "ok", detail: "Awaiting first hourly sweep since boot" } : { status: "warn", detail: "No sweep since boot" };
  }
  const age = Date.now() - lastAuditSweepAt;
  const status: HealthStatus = age > HEALTH.AUDIT_SWEEP_FAIL_MS ? "fail" : age > HEALTH.AUDIT_SWEEP_WARN_MS ? "warn" : "ok";
  return { status, detail: `Last sweep ${fmtAge(age)} ago` };
};
// Automations — AutomationRun rows with status "failed" in the last 24h.
const checkAutomations: CheckFn = async () => {
  const n = await db().automationRun.count({ where: { status: "failed", createdAt: { gte: H24() } } });
  const status: HealthStatus = n >= HEALTH.AUTOMATION_FAILS_24H_FAIL ? "fail" : n >= HEALTH.AUTOMATION_FAILS_24H_WARN ? "warn" : "ok";
  return { status, detail: `${n} failed run${n === 1 ? "" : "s"} in 24h` };
};
// Drip / scheduled queue — ScheduledJob: overdue pending (past due + grace) and failed in 24h.
const checkDripQueue: CheckFn = async () => {
  const [overdue, failed] = await Promise.all([
    db().scheduledJob.count({ where: { status: "pending", dueAt: { lt: new Date(Date.now() - HEALTH.DRIP_OVERDUE_GRACE_MS) } } }),
    db().scheduledJob.count({ where: { status: "failed", updatedAt: { gte: H24() } } }),
  ]);
  const status: HealthStatus = overdue >= HEALTH.DRIP_OVERDUE_WARN || failed >= HEALTH.DRIP_FAILED_24H_WARN ? "warn" : "ok";
  return { status, detail: `${overdue} overdue, ${failed} failed in 24h` };
};
// PULSE (last 24h)
// Requests / 5xx — no request log exists in this codebase (nothing is cheaply
// available), so these report honestly instead of inventing a counter.
const checkRequests: CheckFn = async () => ({ status: "ok", detail: "Not tracked (no request log in this deployment)" });
// Webhook failures — EmailLog rows with status "failed" in 24h (the Resend delivery webhook writes these).
const checkWebhooks: CheckFn = async () => {
  const n = await db().emailLog.count({ where: { status: "failed", createdAt: { gte: H24() } } });
  const status: HealthStatus = n >= HEALTH.WEBHOOK_FAILS_24H_FAIL ? "fail" : n >= HEALTH.WEBHOOK_FAILS_24H_WARN ? "warn" : "ok";
  return { status, detail: `${n} failed deliver${n === 1 ? "y" : "ies"} in 24h` };
};
// Failed logins — straight from the audit trail: AuditEvent action "auth.login_failed" in 24h.
const checkFailedLogins: CheckFn = async () => {
  const n = await db().auditEvent.count({ where: { action: "auth.login_failed", createdAt: { gte: H24() } } });
  const status: HealthStatus = n >= HEALTH.FAILED_LOGINS_24H_FAIL ? "fail" : n >= HEALTH.FAILED_LOGINS_24H_WARN ? "warn" : "ok";
  return { status, detail: `${n} failed login${n === 1 ? "" : "s"} in 24h` };
};

// ---------------- the sweep + cache ----------------
let snapshot: HealthSnapshot | null = null;
let running: Promise<HealthSnapshot> | null = null;

export async function runHealthChecks(): Promise<HealthSnapshot> {
  if (running) return running; // coalesce concurrent rechecks
  running = (async () => {
    const [twilio, openai, elevenlabs, mapbox, google, dbc, proc, scheduler, geoQueue, auditSweep, automations, dripQueue, requests, webhooks, failedLogins] = await Promise.all([
      runCheck(checkTwilio), runCheck(checkOpenAi), runCheck(checkElevenLabs), runCheck(checkMapbox), runCheck(checkGoogle),
      runCheck(checkDb), runCheck(checkProcess),
      runCheck(checkScheduler), runCheck(checkGeoQueue), runCheck(checkAuditSweep), runCheck(checkAutomations), runCheck(checkDripQueue),
      runCheck(checkRequests), runCheck(checkWebhooks), runCheck(checkFailedLogins),
    ]);
    const groups = {
      external: { twilio, openai, elevenlabs, mapbox, google },
      internal: { database: dbc, process: proc },
      background: { scheduler, geoQueue, auditSweep, automations, dripQueue },
      pulse: { requests, webhooks, failedLogins },
    };
    const all = Object.values(groups).flatMap((g) => Object.values(g));
    const summary = { ok: all.filter((c) => c.status === "ok").length, warn: all.filter((c) => c.status === "warn").length, fail: all.filter((c) => c.status === "fail").length };
    const worst: HealthStatus = summary.fail ? "fail" : summary.warn ? "warn" : "ok";
    snapshot = { checkedAt: new Date().toISOString(), summary, worst, groups };
    return snapshot;
  })();
  try { return await running; } finally { running = null; }
}

export function getHealthSnapshot(): HealthSnapshot | null { return snapshot; }

export function startHealthSweep(): void {
  // first run shortly after boot (never blocking startup), then every INTERVAL_MS
  const first = setTimeout(() => { void runHealthChecks().catch((e) => logger.error(`[health] first sweep failed: ${(e as Error).message}`)); }, 10_000);
  (first as any).unref && (first as any).unref();
  const t = setInterval(() => { void runHealthChecks().catch((e) => logger.error(`[health] sweep failed (will retry next tick): ${(e as Error).message}`)); }, HEALTH.INTERVAL_MS);
  (t as any).unref && (t as any).unref();
}
