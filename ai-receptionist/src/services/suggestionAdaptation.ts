// ADAPTATION — suggestions learn what a tenant wants, by COUNTING.
//
// No model, no machine learning, no thresholds that drift: a tally of accepts
// and dismissals per detector per tenant, and a ladder of temporary mutes.
//
// FOUR RULES this file exists to keep:
//   1. NOTHING IS EVER SILENT. Every mute records its tier, its reason and its
//      expiry, and the preferences surface reads them back. A tenant can always
//      answer "why am I not seeing this?".
//   2. AN ACCEPT ALWAYS WINS. Any accept, by anyone in the tenant, resets the
//      ladder to zero and clears an active mute — they just told us they want it.
//   3. A MANUAL TOGGLE IS THE OWNER'S. The ladder never overrides it, never
//      resumes it, never counts against it.
//   4. FLOORS ARE NOT TOUCHED. This batch mutes; it never tunes. No detector's
//      evidence floor is read or written here.
//
// COUNTS ARE DERIVED, never materialised: they come from the Suggestion rows
// themselves, so there is no second tally that can disagree with the history.
import { prisma } from "../db/client";
import { audit } from "./auditService";
import { AUDIT_ACTIONS } from "./auditCatalog";
import { logger } from "../utils/logger";

const db = prisma as any;
const DAY = 86400000;

/** The approved ladder. Tier N's mute length, in days; tier 3 is indefinite. */
export const MUTE_LADDER = {
  DISMISSALS_TO_MUTE: 3,
  TIER_DAYS: [60, 180] as number[],   // tier 1, tier 2
  INDEFINITE_TIER: 3,
};

export interface MuteState {
  tier: number;              // 0 = active, 1|2 = timed, 3 = indefinite
  mutedUntil: string | null; // ISO date, null when indefinite or inactive
  reason: string | null;
  appliedAt: string | null;
  /** The moment the current counting cycle began — an accept moves this. */
  cycleStart: string | null;
}

const EMPTY: MuteState = { tier: 0, mutedUntil: null, reason: null, appliedAt: null, cycleStart: null };

/** Mute state lives beside the manual toggles it must coexist with. */
export function readMutes(prefs: any): Record<string, MuteState> {
  const bag = prefs && typeof prefs === "object" && prefs._mutes && typeof prefs._mutes === "object" ? prefs._mutes : {};
  const out: Record<string, MuteState> = {};
  for (const k of Object.keys(bag)) {
    const m = bag[k] || {};
    out[k] = {
      tier: Number(m.tier) || 0,
      mutedUntil: typeof m.mutedUntil === "string" ? m.mutedUntil : null,
      reason: typeof m.reason === "string" ? m.reason : null,
      appliedAt: typeof m.appliedAt === "string" ? m.appliedAt : null,
      cycleStart: typeof m.cycleStart === "string" ? m.cycleStart : null,
    };
  }
  return out;
}

export function muteFor(prefs: any, detectorId: string): MuteState {
  return readMutes(prefs)[detectorId] || { ...EMPTY };
}

/** Is this detector quiet right now because of the ladder? */
export function isLadderMuted(state: MuteState, now = new Date()): boolean {
  if (!state || !state.tier) return false;
  if (state.tier >= MUTE_LADDER.INDEFINITE_TIER) return true;
  if (!state.mutedUntil) return false;
  return now.getTime() < new Date(state.mutedUntil).getTime();
}

async function writeMute(tenantId: string, detectorId: string, next: MuteState | null): Promise<void> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { suggestionPrefs: true } });
  const prefs = t && t.suggestionPrefs && typeof t.suggestionPrefs === "object" ? { ...(t.suggestionPrefs as any) } : {};
  const mutes = { ...(prefs._mutes && typeof prefs._mutes === "object" ? prefs._mutes : {}) };
  if (next) mutes[detectorId] = next; else delete mutes[detectorId];
  prefs._mutes = mutes;
  await db.tenant.update({ where: { id: tenantId }, data: { suggestionPrefs: prefs } });
}

/**
 * The tally, DERIVED from the suggestion rows themselves. Counted from the
 * current cycle's start, so a reset genuinely starts over.
 */
export async function tallyForDetector(tenantId: string, detectorId: string, since?: string | null): Promise<{ accepted: number; dismissed: number }> {
  const where: any = { tenantId, type: detectorId, status: { in: ["accepted", "dismissed"] } };
  if (since) where.actedAt = { gte: new Date(since) };
  const rows = await db.suggestion.groupBy({ by: ["status"], where, _count: { _all: true } }).catch(() => []);
  let accepted = 0; let dismissed = 0;
  for (const r of rows as any[]) {
    if (r.status === "accepted") accepted = r._count._all;
    if (r.status === "dismissed") dismissed = r._count._all;
  }
  return { accepted, dismissed };
}

const actorOf = (user: any) => ({
  actorType: "user" as const,
  actorId: user?.id ?? null,
  actorLabel: (user && (user.name || user.email)) || "Unknown user",
  actorRole: user?.role ?? null,
});

/**
 * A DISMISSAL happened. If this detector has now been dismissed three times
 * with nothing accepted this cycle, it goes quiet for a while.
 *
 * NEVER-BLOCK: any failure here is logged and swallowed — a tally must never
 * cost someone their dismissal.
 */
export async function noteDismissal(tenantId: string, detectorId: string, user: any): Promise<void> {
  try {
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { suggestionPrefs: true } });
    const prefs = (t && t.suggestionPrefs) || {};
    // A manual toggle is the owner's decision; the ladder stays out of it.
    if ((prefs as any)[detectorId] === false) return;
    const state = muteFor(prefs, detectorId);
    if (isLadderMuted(state)) return;   // already quiet; nothing to count
    const { accepted, dismissed } = await tallyForDetector(tenantId, detectorId, state.cycleStart);
    if (accepted > 0) return;           // they have used it this cycle
    if (dismissed < MUTE_LADDER.DISMISSALS_TO_MUTE) return;

    const nextTier = Math.min(MUTE_LADDER.INDEFINITE_TIER, (state.tier || 0) + 1);
    const days = MUTE_LADDER.TIER_DAYS[nextTier - 1];
    const until = days ? new Date(Date.now() + days * DAY) : null;
    const reason = days
      ? `Dismissed ${dismissed} times without being used`
      : `Dismissed repeatedly across three rounds \u2014 off until you turn it back on`;
    await writeMute(tenantId, detectorId, {
      tier: nextTier,
      mutedUntil: until ? until.toISOString() : null,
      reason,
      appliedAt: new Date().toISOString(),
      cycleStart: state.cycleStart,
    });
    audit({
      tenantId, ...actorOf(user),
      action: AUDIT_ACTIONS.SUGGESTION_MUTED,
      subjectType: "settings", subjectId: detectorId, subjectLabel: detectorId,
      meta: { tier: nextTier, until: until ? until.toISOString() : null, dismissed, reason },
    });
    logger.info(`[suggestions] ${detectorId} muted for tenant ${tenantId} (tier ${nextTier}${days ? `, ${days} days` : ", indefinite"})`);
  } catch (err) {
    logger.error(`[suggestions] dismissal tally failed: ${(err as Error).message}`);
  }
}

/**
 * An ACCEPT happened. Whatever tier we were at, we are now at zero: they want
 * this kind of suggestion. Clears an active mute, including an indefinite one.
 */
export async function noteAccept(tenantId: string, detectorId: string, user: any): Promise<void> {
  try {
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { suggestionPrefs: true } });
    const prefs = (t && t.suggestionPrefs) || {};
    const state = muteFor(prefs, detectorId);
    const wasMuted = isLadderMuted(state);
    if (!state.tier && !wasMuted && !state.cycleStart) {
      // Nothing to reset, but start a fresh counting cycle from this accept so
      // earlier dismissals cannot add up against a detector they just used.
      await writeMute(tenantId, detectorId, { ...EMPTY, cycleStart: new Date().toISOString() });
      return;
    }
    await writeMute(tenantId, detectorId, { ...EMPTY, cycleStart: new Date().toISOString() });
    audit({
      tenantId, ...actorOf(user),
      action: AUDIT_ACTIONS.SUGGESTION_UNMUTED,
      subjectType: "settings", subjectId: detectorId, subjectLabel: detectorId,
      meta: { via: "accept", clearedTier: state.tier, wasMuted },
    });
  } catch (err) {
    logger.error(`[suggestions] accept tally failed: ${(err as Error).message}`);
  }
}

/** The explicit "turn this back on" control, for an indefinite mute. */
export async function clearMute(tenantId: string, detectorId: string, user: any): Promise<void> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { suggestionPrefs: true } });
  const state = muteFor((t && t.suggestionPrefs) || {}, detectorId);
  await writeMute(tenantId, detectorId, { ...EMPTY, cycleStart: new Date().toISOString() });
  audit({
    tenantId, ...actorOf(user),
    action: AUDIT_ACTIONS.SUGGESTION_UNMUTED,
    subjectType: "settings", subjectId: detectorId, subjectLabel: detectorId,
    meta: { via: "manual", clearedTier: state.tier },
  });
}

/**
 * SWEEP-TIME GATE. Returns true when this detector must not run for this
 * tenant, and clears an expired mute in passing — so resumption needs no
 * separate scheduler: the nightly sweep that would have been blocked is the
 * one that lets it through again.
 */
export async function shouldSkipDetector(tenantId: string, prefs: any, detectorId: string, now = new Date()): Promise<boolean> {
  try {
    const state = muteFor(prefs, detectorId);
    if (!state.tier) return false;
    if (isLadderMuted(state, now)) return true;
    // Tier was set and the clock has run out: resume, and say so.
    await writeMute(tenantId, detectorId, { ...state, mutedUntil: null, reason: null, appliedAt: null });
    audit({
      tenantId, actorType: "system", actorId: null, actorLabel: "Clarity", actorRole: null,
      action: AUDIT_ACTIONS.SUGGESTION_UNMUTED,
      subjectType: "settings", subjectId: detectorId, subjectLabel: detectorId,
      meta: { via: "expired", tier: state.tier },
    });
    logger.info(`[suggestions] ${detectorId} resumed for tenant ${tenantId} (tier ${state.tier} mute expired)`);
    return false;
  } catch (err) {
    // A mute-state failure must never abort a sweep: default to RUNNING the
    // detector, because a missing suggestion is worse than an extra one.
    logger.error(`[suggestions] mute check failed: ${(err as Error).message}`);
    return false;
  }
}

/** What the preferences surface renders, per detector. */
export interface DetectorStatus {
  state: "active" | "muted" | "indefinite" | "manual_off";
  label: string;
  reason: string | null;
  until: string | null;
  tier: number;
  canReenable: boolean;
}

export function statusFor(prefs: any, detectorId: string, now = new Date()): DetectorStatus {
  if (prefs && (prefs as any)[detectorId] === false) {
    return { state: "manual_off", label: "Off \u2014 you turned this off", reason: null, until: null, tier: 0, canReenable: false };
  }
  const m = muteFor(prefs, detectorId);
  if (m.tier >= MUTE_LADDER.INDEFINITE_TIER) {
    return { state: "indefinite", label: "Off \u2014 dismissed repeatedly", reason: m.reason, until: null, tier: m.tier, canReenable: true };
  }
  if (isLadderMuted(m, now)) {
    const when = new Date(m.mutedUntil as string).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return { state: "muted", label: `Quiet until ${when}`, reason: m.reason, until: m.mutedUntil, tier: m.tier, canReenable: true };
  }
  return { state: "active", label: "Active", reason: null, until: null, tier: m.tier || 0, canReenable: false };
}
