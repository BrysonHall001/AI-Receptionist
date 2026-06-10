import { Request, Response, NextFunction } from "express";
import { getUserForToken, getImpersonationForToken, ImpersonationOverlay, SESSION_COOKIE } from "../auth/session";

export type Role = "SUPER_ADMIN" | "PORTAL_ADMIN" | "CLIENT_USER";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  tenantId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      // Batch A plumbing (additive; nothing consumes these yet):
      // realUser = the authoritative real identity, never overwritten.
      // impersonation = the overlay, or null when not impersonating (always null
      // in Batch A). Effective identity today === real identity (req.user).
      realUser?: AuthUser;
      impersonation?: ImpersonationOverlay | null;
    }
  }
}

/** Populate req.user from the session cookie (does not enforce). */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    const user = await getUserForToken(token);
    if (user) {
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as Role,
        tenantId: user.tenantId,
      };
    }
    // --- Batch A plumbing: additive only, NOTHING consumes these yet. ---
    // The real identity is authoritative and never overwritten. req.user is left
    // EXACTLY as set above, so all existing code is unaffected (effective == real).
    req.realUser = req.user;
    req.impersonation = null;
    // Only a real SUPER_ADMIN can ever have an overlay; for everyone else we skip
    // the lookup entirely (zero extra work, identical behavior). In Batch A this
    // returns null regardless, since no overlay is ever written.
    if (req.user && req.user.role === "SUPER_ADMIN") {
      req.impersonation = await getImpersonationForToken(token);
    }
    // --- Batch D: ACT-AS-TYPE effective identity. When a real super-admin is
    // "acting as" a role, req.user becomes the EFFECTIVE principal — effective role
    // + the pinned tenant — so EVERY downstream authorization decision (and, once
    // the UI reads it, every rendering decision) is correct BY DEFAULT, with no
    // per-site special-casing. We keep the REAL super-admin id (so actions stamp
    // honestly as the super-admin) and leave req.realUser untouched (the authoritative
    // real identity, used only for exit + the "is a real super-admin impersonating"
    // check). View-as-user is NOT changed here (it stays read-only via Batch C).
    if (req.impersonation && req.impersonation.mode === "act-as-type" && req.realUser) {
      req.user = {
        id: req.realUser.id, // real id → honest action-stamping
        email: req.realUser.email,
        name: req.realUser.name,
        role: (req.impersonation.assumedRole as Role) || req.realUser.role, // effective role
        tenantId: req.impersonation.scopeTenantId || null, // pinned tenant (cross-tenant safe)
      };
    }
  } catch {
    // ignore; treated as unauthenticated
  }
  next();
}

/** Require a logged-in user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

/** Require one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    next();
  };
}

/**
 * Determine which tenant's data the request may touch.
 * - SUPER_ADMIN: may target any tenant via ?tenantId / body.tenantId / param.
 * - Others: locked to their own tenantId, ignoring any provided value.
 * Returns null if a non-super-admin has no tenant, or super-admin gave none.
 */
export function resolveTenantScope(req: Request, requested?: string | null): string | null {
  const user = req.user;
  if (!user) return null;
  if (user.role === "SUPER_ADMIN") {
    return (
      requested ||
      (req.query.tenantId as string | undefined) ||
      (req.body && (req.body.tenantId as string | undefined)) ||
      null
    );
  }
  return user.tenantId;
}
