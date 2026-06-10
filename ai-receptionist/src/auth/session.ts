import crypto from "crypto";
import { Response } from "express";
import { env, isProduction } from "../config/env";
import { prisma } from "../db/client";

export const SESSION_COOKIE = "air_session";

function ttlMs(): number {
  return env.SESSION_TTL_HOURS * 60 * 60 * 1000;
}

/** Create a DB-backed session and return its opaque token. */
export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { token, userId, expiresAt: new Date(Date.now() + ttlMs()) },
  });
  return token;
}

/** Resolve a session token to its user, or null if missing/expired. */
export async function getUserForToken(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { token } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.delete({ where: { token } }).catch(() => undefined);
}

// ---- Impersonation overlay (Batch A: read-only plumbing; nothing consumes it) ----
export interface ImpersonationOverlay {
  mode: "view-as-user" | "act-as-type";
  targetUserId: string | null;
  assumedRole: string | null;
  scopeTenantId: string | null;
  startedAt: Date | null;
}

/**
 * Read the impersonation overlay stored on a session, or null if there is none.
 * Defensive on purpose: if the new columns don't exist yet (migration not run)
 * or anything goes wrong, it returns null so the app behaves EXACTLY as before.
 * Note: this does NOT validate that the real user may impersonate — the caller
 * (attachUser) only invokes this for a real SUPER_ADMIN. In Batch A no overlay is
 * ever written, so this always returns null in practice.
 */
export async function getImpersonationForToken(token: string | undefined): Promise<ImpersonationOverlay | null> {
  if (!token) return null;
  try {
    const s: any = await prisma.session.findUnique({ where: { token } });
    if (!s) return null;
    const mode = s.impMode;
    if (mode !== "view-as-user" && mode !== "act-as-type") return null;
    return {
      mode,
      targetUserId: s.impTargetUserId ?? null,
      assumedRole: s.impAssumedRole ?? null,
      scopeTenantId: s.impScopeTenantId ?? null,
      startedAt: s.impStartedAt ?? null,
    };
  } catch {
    return null; // pre-migration or any error → behave as not impersonating
  }
}

/** Write an impersonation overlay onto the real session row. */
export async function setImpersonation(
  token: string | undefined,
  overlay: { mode: "view-as-user" | "act-as-type"; targetUserId?: string | null; assumedRole?: string | null; scopeTenantId?: string | null },
): Promise<void> {
  if (!token) throw new Error("No session");
  await prisma.session.update({
    where: { token },
    data: {
      impMode: overlay.mode,
      impTargetUserId: overlay.targetUserId ?? null,
      impAssumedRole: overlay.assumedRole ?? null,
      impScopeTenantId: overlay.scopeTenantId ?? null,
      impStartedAt: new Date(),
    } as any,
  });
}

/**
 * Clear the impersonation overlay from the real session row. This is the
 * GUARANTEED-EXIT primitive: it is catch-safe (never throws) and only touches the
 * overlay columns, so exiting can never be blocked by impersonation state.
 */
export async function clearImpersonation(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session
    .update({
      where: { token },
      data: { impMode: null, impTargetUserId: null, impAssumedRole: null, impScopeTenantId: null, impStartedAt: null } as any,
    })
    .catch(() => undefined);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Always secure (HTTPS-only) in production; in dev it follows COOKIE_SECURE
    // so http://localhost still works.
    secure: isProduction() || env.COOKIE_SECURE === "true",
    maxAge: ttlMs(),
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
