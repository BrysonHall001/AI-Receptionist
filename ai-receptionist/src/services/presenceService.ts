import { prisma } from "../db/client";
import { Role } from "../middleware/auth";

// "Who's online" presence. Only real portal MEMBERS ever appear; OWNER /
// SUPER_ADMIN / AUDITOR are excluded by the role filter (and never carry a
// tenantId), so an admin — even while impersonating a member — never produces a
// dot, because heartbeat/queries key off the REAL identity's row.
export const PRESENCE_WINDOW_MS = 90_000;
/**
 * WHO COUNTS AS PRESENT — and why admin-tier staff are absent, deliberately.
 *
 * This list is the whole privacy rule. Super admins, owners and auditors are NOT in it, so
 * they are never returned to anyone: not to portal members, and not to each other. That is
 * stronger than "hidden in the UI" - the data never leaves the server.
 *
 * ASKED FOR AND DEFERRED (app-shell batch): showing admin-tier staff to OTHER admin-tier
 * staff as a square, still invisible to portal members. It was deferred on the owner's call
 * after this analysis, so the next person to consider it does not have to redo it:
 *
 *   The blocker is that admin-tier presence is not REPRESENTABLE today. Presence answers
 *   "who is in tenant X" from User.tenantId plus lastSeenAt. An admin-tier user has
 *   tenantId = null - they belong to no tenant - and lastSeenAt is one global timestamp
 *   with no record of which tenant they were looking at. resolveTenantScope takes the
 *   tenant from the REQUEST, not from anything stored. So nothing anywhere says
 *   "auditor Jane is currently viewing Northfield HVAC".
 *
 *   THE RIGHT ANSWER WHEN IT IS WANTED: a nullable presenceTenantId on User, stamped by the
 *   heartbeat that already runs every 45 seconds. One column, no new endpoint, and it makes
 *   presence honest for impersonating admins too. It needs a schema change, which is why it
 *   was out of scope.
 *
 *   REJECTED: inferring presence from an impersonation session. It would miss an admin
 *   browsing a tenant without impersonating, and a presence indicator that is trusted and
 *   wrong is worse than none.
 *
 *   The deferral was a cost call, not a design one: with a single person on the hub today,
 *   the square would only ever show him himself. It earns its column when there is a second.
 *
 *   The tooltip the square would carry, drafted and kept here so it is not lost:
 *     "You're shown as a square because you're staff. People in this tenant can't see you
 *      here - only other staff can."
 */
export const PRESENCE_MEMBER_ROLES: Role[] = ["PORTAL_ADMIN", "CLIENT_USER"];
export const DOT_COLOR_RE = /^#[0-9a-f]{6}$/;

export interface PresenceEntry { id: string; name: string; initial: string; color: string }

export function presenceInitial(name?: string | null, email?: string | null): string {
  const n = (name || "").trim();
  if (n) return n[0]!.toUpperCase();
  const e = (email || "").trim();
  if (e) return e[0]!.toUpperCase();
  return "?";
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return "#" + to(f(0)) + to(f(8)) + to(f(4));
}

// Deterministic fallback color from the user id (same user → same color; never random).
export function presenceFallbackColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return hslToHex(h % 360, 62, 55);
}

// Present MEMBERS of one tenant (scoped, no cross-tenant leak; caller included if a member).
export async function listPresentMembers(tenantId: string, now: Date = new Date()): Promise<PresenceEntry[]> {
  const cutoff = new Date(now.getTime() - PRESENCE_WINDOW_MS);
  const users = await prisma.user.findMany({
    where: { tenantId, role: { in: PRESENCE_MEMBER_ROLES }, disabled: false, lastSeenAt: { gte: cutoff } },
    select: { id: true, name: true, email: true, dotColor: true },
    orderBy: { lastSeenAt: "desc" },
    take: 50,
  });
  return users.map((u: { id: string; name: string | null; email: string; dotColor: string | null }) => ({
    id: u.id,
    name: u.name || (u.email ? u.email.split("@")[0] : "Member"),
    initial: presenceInitial(u.name, u.email),
    color: u.dotColor || presenceFallbackColor(u.id),
  }));
}

export async function stampHeartbeat(userId: string): Promise<void> {
  try { await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }); }
  catch (e) { /* fail quietly (e.g. user row gone) */ }
}

// Validate + normalize a hex color; returns null if invalid.
export function normalizeDotColor(input?: string | null): string | null {
  const c = String(input || "").trim().toLowerCase();
  return DOT_COLOR_RE.test(c) ? c : null;
}

export async function setDotColor(userId: string, color: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { dotColor: color } });
}

export async function getDotColor(userId: string): Promise<{ color: string; isDefault: boolean }> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { dotColor: true } });
  return { color: u?.dotColor || presenceFallbackColor(userId), isDefault: !u?.dotColor };
}
