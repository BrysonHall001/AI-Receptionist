// EMERGENT LAYER 2 — THE SUGGESTION SERVICE.
//
// Propose-and-approve, never self-modification:
//   * detectors CREATE suggestions (this file's upsert), nothing else;
//   * ACCEPT runs a registered action (suggestionActions.ts), which is a thin
//     wrapper over an existing service — this file performs no config writes;
//   * every accept/dismiss is permission-checked with the batch-30 read-time
//     model and audit-logged as a decision (the underlying service writes its
//     own audit event too).
//
// LIFETIMES: pending suggestions expire after 30 days (re-detectable later); a
// DISMISSED finding is suppressed for a 60-day cooldown. Re-detection UPSERTS
// the unique (tenantId, dedupeKey) row — reviving an expired one and refreshing
// its payload — so a nightly re-run can never stack duplicates or trip the
// constraint, and the dismissal history survives on the same row.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { can, Right } from "./permissionService";
import { getAction } from "./suggestionActions";
import { audit } from "./auditService";
import { AUDIT_ACTIONS } from "./auditCatalog";

const db = prisma as any;

export const SUGGESTION_LIFETIME = { PENDING_DAYS: 30, DISMISS_COOLDOWN_DAYS: 60 };

export interface PermUserLike { id: string; role: string; tenantId?: string | null; customRoleId?: string | null }

export interface SuggestionInput {
  tenantId: string;
  type: string;
  dedupeKey: string;
  finding: any;               // counts/keys/window only — never message bodies
  proposedAction: { type: string; params?: any };
  title: string;              // the plain-English observation
  transparency: string;       // "Based on 14 work orders in the last 30 days"
}

/** True when a dismissed finding is still inside its cooldown. */
export function inDismissCooldown(row: any, now: Date = new Date()): boolean {
  if (!row || row.status !== "dismissed" || !row.actedAt) return false;
  return now.getTime() < new Date(row.actedAt).getTime() + SUGGESTION_LIFETIME.DISMISS_COOLDOWN_DAYS * 86400000;
}

/**
 * Create the suggestion, or REVIVE/refresh the existing row for the same
 * finding. Returns "created" | "revived" | "refreshed" | "suppressed".
 */
export async function upsertSuggestion(input: SuggestionInput, now: Date = new Date()): Promise<string> {
  const action = getAction(input.proposedAction.type);
  if (!action) throw new Error(`Unknown suggestion action "${input.proposedAction.type}"`);
  const invalid = action.validate(input.proposedAction.params || {});
  if (invalid) throw new Error(`Invalid suggestion action: ${invalid}`);

  const existing = await db.suggestion.findFirst({ where: { tenantId: input.tenantId, dedupeKey: input.dedupeKey } });
  if (existing) {
    // An OPEN suggestion for the same finding: refresh its numbers, nothing more.
    if (existing.status === "pending") {
      await db.suggestion.update({
        where: { id: existing.id },
        data: { finding: { ...input.finding, title: input.title, transparency: input.transparency }, proposedAction: input.proposedAction, updatedAt: now },
      });
      return "refreshed";
    }
    // Accepted stays accepted — the owner already dealt with it.
    if (existing.status === "accepted") return "suppressed";
    // Dismissed: silent until the cooldown is over.
    if (existing.status === "dismissed" && inDismissCooldown(existing, now)) return "suppressed";
    // Expired, or a dismissal past its cooldown -> REVIVE the same row (the
    // unique key forbids a second one, and the dismissal history is kept).
    await db.suggestion.update({
      where: { id: existing.id },
      data: {
        status: "pending",
        finding: { ...input.finding, title: input.title, transparency: input.transparency },
        proposedAction: input.proposedAction,
        requiredArea: action.requiredArea, requiredRight: action.requiredRight,
        actedAt: null, actedByUserId: null,     // cleared: it's open again…
        outcome: existing.outcome,              // …but what happened before is kept
        expiresAt: new Date(now.getTime() + SUGGESTION_LIFETIME.PENDING_DAYS * 86400000),
        updatedAt: now,
      },
    });
    return "revived";
  }

  await db.suggestion.create({
    data: {
      tenantId: input.tenantId, type: input.type, dedupeKey: input.dedupeKey,
      finding: { ...input.finding, title: input.title, transparency: input.transparency },
      proposedAction: input.proposedAction,
      requiredArea: action.requiredArea, requiredRight: action.requiredRight,
      status: "pending",
      expiresAt: new Date(now.getTime() + SUGGESTION_LIFETIME.PENDING_DAYS * 86400000),
    },
  });
  return "created";
}

/** READ-TIME permission filter — the batch-30 model, reused verbatim in shape. */
async function filterVisible(user: PermUserLike, rows: any[]): Promise<any[]> {
  const pairs = new Map<string, boolean>();
  const out: any[] = [];
  for (const r of rows) {
    if (!r.requiredArea) { out.push(r); continue; }
    const key = `${r.requiredArea}:${r.requiredRight || "view"}`;
    if (!pairs.has(key)) pairs.set(key, await can(user as any, r.requiredArea, (r.requiredRight || "view") as Right));
    if (pairs.get(key)) out.push(r);
  }
  return out;
}

function dto(row: any) {
  const f = row.finding && typeof row.finding === "object" ? row.finding : {};
  const action = getAction((row.proposedAction || {}).type || "none");
  return {
    id: row.id, type: row.type, status: row.status,
    title: String(f.title || "A pattern worth a look"),
    transparency: String(f.transparency || ""),
    finding: f,
    actionType: (row.proposedAction || {}).type || "none",
    verb: action ? action.verb : "Got it",
    outcome: row.outcome || null,
    createdAt: row.createdAt, actedAt: row.actedAt || null,
  };
}

export async function listSuggestions(user: PermUserLike, opts: { status?: string; limit?: number } = {}): Promise<{ items: any[]; openCount: number }> {
  const tenantId = user.tenantId as string;
  const where: any = { tenantId, status: opts.status || "pending" };
  const rows = await db.suggestion.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(100, opts.limit || 25) });
  const visible = await filterVisible(user, rows);
  const open = await db.suggestion.findMany({ where: { tenantId, status: "pending" }, select: { requiredArea: true, requiredRight: true } });
  return { items: visible.map(dto), openCount: (await filterVisible(user, open)).length };
}

/** ACCEPT: permission-check, run the REGISTERED service call, record the
 *  decision. One service call — nothing can be half-applied here. */
/**
 * The audit log's actor column shows a NAME. Every other writer passes
 * `(u.name || u.email)`; these two paths passed the raw id, which is why
 * suggestion rows showed `cmrgq…` where the rest showed "Bryson Hall".
 */
async function actorNameFor(user: { id: string; name?: string | null; email?: string | null }): Promise<string> {
  if (user && (user.name || user.email)) return String(user.name || user.email);
  try {
    const u = await db.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } });
    if (u && (u.name || u.email)) return String(u.name || u.email);
  } catch { /* fall through to the honest placeholder */ }
  return "Unknown user";
}

export async function acceptSuggestion(user: PermUserLike, id: string): Promise<{ ok: true; outcome: string; link?: string | null }> {
  // An absent id must NOT fall through to "no filter" and hit whatever comes
  // first — Prisma ignores an undefined where value.
  if (!id || typeof id !== "string") throw new Error("Suggestion not found.");
  const row = await db.suggestion.findFirst({ where: { id, tenantId: user.tenantId as string } });
  if (!row) throw new Error("Suggestion not found.");
  if (row.status !== "pending") throw new Error("That suggestion has already been dealt with.");
  const action = getAction((row.proposedAction || {}).type || "none");
  if (!action) throw new Error("That suggestion's action is no longer available.");
  if (action.requiredArea && !(await can(user as any, action.requiredArea, action.requiredRight))) {
    throw new Error("You don't have permission to do that.");
  }
  const params = (row.proposedAction || {}).params || {};
  const invalid = action.validate(params);
  if (invalid) throw new Error(invalid);
  // The single service call. If it throws, the row stays pending and NOTHING
  // was written by this layer.
  const res = await action.run({ tenantId: user.tenantId as string, userId: user.id, role: user.role, customRoleId: user.customRoleId ?? null }, params);
  await db.suggestion.update({ where: { id: row.id }, data: { status: "accepted", outcome: res.outcome, actedAt: new Date(), actedByUserId: user.id } });
  // ADAPTATION: an accept resets this detector's ladder and clears any mute.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  void require("./suggestionAdaptation").noteAccept(user.tenantId as string, row.type, user);
  audit({
    tenantId: user.tenantId as string, actorType: "user", actorId: user.id, actorLabel: await actorNameFor(user), actorRole: user.role,
    action: AUDIT_ACTIONS.SUGGESTION_ACCEPTED, subjectType: "settings", subjectId: row.id, subjectLabel: row.type,
    meta: { suggestion_type: row.type, action_type: action.type },
  } as any);
  return { ok: true, outcome: res.outcome, link: res.link ?? null };
}

export async function dismissSuggestion(user: PermUserLike, id: string): Promise<{ ok: true }> {
  // An absent id must NOT fall through to "no filter" and hit whatever comes
  // first — Prisma ignores an undefined where value.
  if (!id || typeof id !== "string") throw new Error("Suggestion not found.");
  const row = await db.suggestion.findFirst({ where: { id, tenantId: user.tenantId as string } });
  if (!row) throw new Error("Suggestion not found.");
  await db.suggestion.update({ where: { id: row.id }, data: { status: "dismissed", actedAt: new Date(), actedByUserId: user.id } });
  // ADAPTATION: three dismissals with nothing accepted quiets this detector.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  void require("./suggestionAdaptation").noteDismissal(user.tenantId as string, row.type, user);
  audit({
    tenantId: user.tenantId as string, actorType: "user", actorId: user.id, actorLabel: await actorNameFor(user), actorRole: user.role,
    action: AUDIT_ACTIONS.SUGGESTION_DISMISSED, subjectType: "settings", subjectId: row.id, subjectLabel: row.type,
    meta: { suggestion_type: row.type },
  } as any);
  return { ok: true };
}

/** UNDO a dismiss (the toast's affordance) — back to pending, history cleared
 *  so the cooldown doesn't silently start. */
export async function undismissSuggestion(user: PermUserLike, id: string): Promise<{ ok: true }> {
  await db.suggestion.updateMany({ where: { id, tenantId: user.tenantId as string, status: "dismissed" }, data: { status: "pending", actedAt: null, actedByUserId: null } });
  return { ok: true };
}

/** Staleness: pending suggestions older than their expiry become "expired"
 *  (re-detectable later). Bounded, never throws — the sweep pattern. */
export async function runSuggestionExpirySweep(now: Date = new Date()): Promise<{ expired: number }> {
  try {
    const res = await db.suggestion.updateMany({ where: { status: "pending", expiresAt: { lt: now } }, data: { status: "expired" } });
    return { expired: res.count || 0 };
  } catch (err) {
    logger.error(`suggestion expiry sweep failed: ${(err as Error).message}`);
    return { expired: 0 };
  }
}
