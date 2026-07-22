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
import { VOICE_OPTIONS, isValidVoiceId } from "../config/voices";
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
  ERRORS_24H_WARN: 1, ERRORS_24H_FAIL: 25, // captured client+server errors (devtools-data)
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
// ElevenLabs — NO direct API integration, BY DESIGN (settled): premium voice works
// by TwiML handing Twilio ConversationRelay ttsProvider="ElevenLabs" + a curated
// voice id; Twilio performs the synthesis on its side. There is no key, so there is
// nothing to ping. EXACT CHECK (local, zero network): the configured/default voice
// id validates against VOICE_OPTIONS (isValidVoiceId), and the ConversationRelay
// TwiML builder is present (path sanity). Green when the voice config is sane;
// NEVER red for "no key".
const checkElevenLabs: CheckFn = async () => {
  const vid = env.ELEVENLABS_VOICE_ID;
  if (!isValidVoiceId(vid)) return { status: "warn", detail: `Configured voice id is not one of the ${VOICE_OPTIONS.length} curated options` };
  const relay = require("../telephony/conversationRelayTwiml");
  if (typeof relay.connectConversationRelayTwiml !== "function") return { status: "fail", detail: "ConversationRelay TwiML builder missing" };
  const label = (VOICE_OPTIONS.find((v) => v.id === vid) || { label: vid }).label;
  return { status: "ok", detail: `Voice "${label}" valid (1 of ${VOICE_OPTIONS.length}); synthesis rides Twilio ConversationRelay — no direct API connection` };
};

// Stripe — platform billing (settled: live integration behind Billing & Usage).
// EXACT CALL: GET /v1/balance via stripe.balance.retrieve() — the cheapest authed
// read; a health probe ONLY, no billing behavior touched. Unconfigured => NEUTRAL
// ("not configured", never red). A test-mode key surfaces as informational amber.
const checkStripe: CheckFn = async () => {
  const { isStripeConfigured, isStripeTestMode, getStripe } = require("./stripeService");
  if (!isStripeConfigured()) return { status: "ok", detail: "Not configured — platform billing off" };
  await getStripe().balance.retrieve();
  return isStripeTestMode()
    ? { status: "warn", detail: "Test mode — authenticated (balance readable); live charges disabled" }
    : { status: "ok", detail: "Authenticated (balance readable); live mode" };
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
// Webhook deliveries — devtools-data rewire: REAL 24h WebhookEvent counts (every
// inbound webhook route records here — Twilio voice/SMS/relay, Stripe, Resend, the
// custom ingest). Failures drive the amber/red thresholds.
const checkWebhooks: CheckFn = async () => {
  const [total, failed] = await Promise.all([
    db().webhookEvent.count({ where: { createdAt: { gte: H24() } } }),
    db().webhookEvent.count({ where: { outcome: "fail", createdAt: { gte: H24() } } }),
  ]);
  const status: HealthStatus = failed >= HEALTH.WEBHOOK_FAILS_24H_FAIL ? "fail" : failed >= HEALTH.WEBHOOK_FAILS_24H_WARN ? "warn" : "ok";
  return { status, detail: `${total} deliver${total === 1 ? "y" : "ies"}, ${failed} failed in 24h` };
};
// Errors — captured client + server ErrorEvent rows in 24h (devtools-data). A
// plain count; the Errors sub-tab and tile panel show the actual rows.
const checkErrors: CheckFn = async () => {
  const n = await db().errorEvent.count({ where: { createdAt: { gte: H24() } } });
  const status: HealthStatus = n >= HEALTH.ERRORS_24H_FAIL ? "fail" : n >= HEALTH.ERRORS_24H_WARN ? "warn" : "ok";
  return { status, detail: `${n} captured error${n === 1 ? "" : "s"} in 24h` };
};
// Failed logins — straight from the audit trail: AuditEvent action "auth.login_failed" in 24h.
const checkFailedLogins: CheckFn = async () => {
  const n = await db().auditEvent.count({ where: { action: "auth.login_failed", createdAt: { gte: H24() } } });
  const status: HealthStatus = n >= HEALTH.FAILED_LOGINS_24H_FAIL ? "fail" : n >= HEALTH.FAILED_LOGINS_24H_WARN ? "warn" : "ok";
  return { status, detail: `${n} failed login${n === 1 ? "" : "s"} in 24h` };
};

// ---------------- the check registry (health v2) ----------------
// One declarative map: key -> { group, fn }. The sweep, the per-tile single-check
// re-run, and the history buffer all drive off THIS — adding a check is one entry.
const CHECKS: Record<string, { group: keyof HealthSnapshot["groups"]; fn: CheckFn }> = {
  twilio: { group: "external", fn: checkTwilio },
  openai: { group: "external", fn: checkOpenAi },
  elevenlabs: { group: "external", fn: checkElevenLabs },
  mapbox: { group: "external", fn: checkMapbox },
  google: { group: "external", fn: checkGoogle },
  stripe: { group: "external", fn: checkStripe },
  database: { group: "internal", fn: checkDb },
  process: { group: "internal", fn: checkProcess },
  scheduler: { group: "background", fn: checkScheduler },
  geoQueue: { group: "background", fn: checkGeoQueue },
  auditSweep: { group: "background", fn: checkAuditSweep },
  automations: { group: "background", fn: checkAutomations },
  dripQueue: { group: "background", fn: checkDripQueue },
  requests: { group: "pulse", fn: checkRequests },
  webhooks: { group: "pulse", fn: checkWebhooks },
  errors: { group: "pulse", fn: checkErrors },
  failedLogins: { group: "pulse", fn: checkFailedLogins },
};
export const HEALTH_CHECK_KEYS = Object.keys(CHECKS);

// ---------------- the recent-checks ring buffer (health v2) ----------------
// BOUNDED, IN-MEMORY, per check: newest first, capped at HISTORY_LIMIT, resets on
// restart (the panel footer says so). No schema — deliberately ephemeral.
export const HEALTH_HISTORY_LIMIT = 30;
const history: Record<string, HealthCheck[]> = {};
function recordHistory(key: string, c: HealthCheck): void {
  const buf = history[key] || (history[key] = []);
  buf.unshift(c);
  if (buf.length > HEALTH_HISTORY_LIMIT) buf.length = HEALTH_HISTORY_LIMIT;
}
export function getHealthHistory(key: string): HealthCheck[] { return (history[key] || []).slice(); }

// ---------------- the sweep + cache ----------------
let snapshot: HealthSnapshot | null = null;
let running: Promise<HealthSnapshot> | null = null;

function summarize(groups: HealthSnapshot["groups"]): { summary: HealthSnapshot["summary"]; worst: HealthStatus } {
  const all = Object.values(groups).flatMap((g) => Object.values(g));
  const summary = { ok: all.filter((c) => c.status === "ok").length, warn: all.filter((c) => c.status === "warn").length, fail: all.filter((c) => c.status === "fail").length };
  return { summary, worst: summary.fail ? "fail" : summary.warn ? "warn" : "ok" };
}

/** Health v2: run ONE check by key (user-initiated per-tile re-check — the sweep's
 *  cost/frequency is untouched). Records to the ring buffer and patches the cached
 *  snapshot's entry + summary in place, so the nav-free verdict stays coherent. */
export async function runSingleCheck(key: string): Promise<HealthCheck | null> {
  const entry = CHECKS[key];
  if (!entry) return null;
  const c = await runCheck(entry.fn);
  recordHistory(key, c);
  if (snapshot) {
    (snapshot.groups[entry.group] as Record<string, HealthCheck>)[key] = c;
    const { summary, worst } = summarize(snapshot.groups);
    snapshot.summary = summary;
    snapshot.worst = worst;
  }
  return c;
}

export async function runHealthChecks(): Promise<HealthSnapshot> {
  if (running) return running; // coalesce concurrent rechecks
  running = (async () => {
    const keys = Object.keys(CHECKS);
    const results = await Promise.all(keys.map((k) => runCheck(CHECKS[k].fn)));
    const groups: HealthSnapshot["groups"] = { external: {}, internal: {}, background: {}, pulse: {} };
    keys.forEach((k, i) => {
      (groups[CHECKS[k].group] as Record<string, HealthCheck>)[k] = results[i];
      recordHistory(k, results[i]); // every sweep feeds the ring buffer
    });
    const { summary, worst } = summarize(groups);
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
