import { prisma } from "../db/client";
import { Role } from "../middleware/auth";

// "Who's online" presence. Only real portal MEMBERS ever appear; OWNER /
// SUPER_ADMIN / AUDITOR are excluded by the role filter (and never carry a
// tenantId), so an admin — even while impersonating a member — never produces a
// dot, because heartbeat/queries key off the REAL identity's row.
export const PRESENCE_WINDOW_MS = 90_000;
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
