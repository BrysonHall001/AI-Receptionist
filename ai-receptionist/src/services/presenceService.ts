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

export interface PresenceEntry { id: string; name: string; initial: string; color: string; staff?: boolean }

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

/** The roles that render as a SQUARE and are visible only to each other. */
export const PRESENCE_STAFF_ROLES: Role[] = ["OWNER", "SUPER_ADMIN", "AUDITOR"];
export function isStaffRole(role?: string | null): boolean {
  return PRESENCE_STAFF_ROLES.indexOf(String(role || "") as Role) !== -1;
}

/**
 * Present people in one tenant.
 *
 * TWO GROUPS, AND THE SECOND IS PRIVATE.
 *
 *  - MEMBERS of the tenant (portal admin, client user), found by their own tenantId. Circles.
 *    Everyone who can see presence at all sees these, exactly as before.
 *
 *  - STAFF (owner, super admin, auditor) currently VIEWING this tenant, found by the
 *    viewingTenantId the heartbeat stamps - they have no tenantId of their own. Squares.
 *
 * THE PRIVACY RULE IS ENFORCED IN THE QUERY, not on the client. An ordinary member's request
 * never SELECTS a staff row: the second query is not issued at all unless the person asking
 * is staff. Returning data and then hiding it in the browser would mean the data still
 * travelled, which is not privacy - it is a curtain.
 *
 * viewerRole is optional and defaults to a member's view, so any caller that has not been
 * updated gets the safe answer rather than the leaky one.
 */
export async function listPresentMembers(
  tenantId: string,
  now: Date = new Date(),
  viewerRole?: string | null,
): Promise<PresenceEntry[]> {
  const cutoff = new Date(now.getTime() - PRESENCE_WINDOW_MS);
  const shape = { id: true, name: true, email: true, dotColor: true, role: true } as const;
  const members = await prisma.user.findMany({
    where: { tenantId, role: { in: PRESENCE_MEMBER_ROLES }, disabled: false, lastSeenAt: { gte: cutoff } },
    select: shape,
    orderBy: { lastSeenAt: "desc" },
    take: 50,
  });

  // ONLY STAFF ASK FOR STAFF. To a member this query does not run, so their response cannot
  // contain a staff row even by accident.
  const staff = isStaffRole(viewerRole)
    ? await prisma.user.findMany({
        where: { viewingTenantId: tenantId, role: { in: PRESENCE_STAFF_ROLES }, disabled: false, lastSeenAt: { gte: cutoff } },
        select: shape,
        orderBy: { lastSeenAt: "desc" },
        take: 50,
      })
    : [];

  type Row = { id: string; name: string | null; email: string; dotColor: string | null; role: string };
  return ([...staff, ...members] as Row[]).map((u) => ({
    id: u.id,
    name: u.name || (u.email ? u.email.split("@")[0] : "Member"),
    initial: presenceInitial(u.name, u.email),
    color: u.dotColor || presenceFallbackColor(u.id),
    // The only new field on the wire, and it is only ever true for a viewer who is staff.
    staff: isStaffRole(u.role),
  }));
}

/**
 * The heartbeat. It now also records WHICH TENANT is being looked at, which is the only way
 * an admin-tier person can appear in presence at all: they have no tenantId of their own.
 *
 * Same request, same cadence - the endpoint already fires on this schedule and already knows
 * the tenant in scope. tenantId is optional so any other caller keeps working unchanged.
 *
 * NO CLEARING RULE IS NEEDED. The presence query filters lastSeenAt >= cutoff, so a stale
 * viewingTenantId stops being visible the moment the heartbeat stops - signing out, going
 * idle, closing the tab. Switching tenants overwrites it on the next beat. Writing null on
 * sign-out would be belt-and-braces, but a field that expires by the same clock as everything
 * else cannot strand a square on a tenant nobody is watching.
 */
export async function stampHeartbeat(userId: string, tenantId?: string | null): Promise<void> {
  const data: { lastSeenAt: Date; viewingTenantId?: string | null } = { lastSeenAt: new Date() };
  if (tenantId !== undefined) data.viewingTenantId = tenantId || null;
  try { await prisma.user.update({ where: { id: userId }, data }); }
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
