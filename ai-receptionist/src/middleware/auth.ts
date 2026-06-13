import { Request, Response, NextFunction } from "express";
import { getUserForToken, getImpersonationForToken, ImpersonationOverlay, SESSION_COOKIE } from "../auth/session";

export type Role = "OWNER" | "SUPER_ADMIN" | "PORTAL_ADMIN" | "CLIENT_USER" | "AUDITOR";

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
    if (req.user && isAdminTier(req.user.role)) {
      req.impersonation = await getImpersonationForToken(token);
    }
    // --- Batch D + view-as re-skin: BOTH impersonation modes render/enforce as the
    // EFFECTIVE role + pinned tenant, so the UI and server treat the session exactly
    // like a real user of that role in that one portal. We keep the REAL super-admin
    // id (role-only re-skin: actions stamp honestly as the super-admin, and personal
    // data stays the super-admin's), and leave req.realUser untouched (authoritative
    // real identity, used only for exit + the "is a real super-admin impersonating"
    // check). VIEW-AS-USER additionally stays READ-ONLY via the view-only middleware,
    // which is keyed on the mode and is unaffected by this role swap.
    if (
      req.impersonation &&
      (req.impersonation.mode === "act-as-type" || req.impersonation.mode === "view-as-user") &&
      req.realUser
    ) {
      req.user = {
        id: req.realUser.id, // real id → honest action-stamping; personal data stays yours
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
 * The top admin tier: OWNER, SUPER_ADMIN, or AUDITOR. OWNER sits above
 * SUPER_ADMIN; AUDITOR is a temporary tester granted the same full reach as a
 * super-admin (master hub, any tenant, impersonation, jobs). Every place that
 * used to check `role === "SUPER_ADMIN"` for access should use this, so none of
 * these roles is ever accidentally locked out.
 */
export function isAdminTier(role?: string | null): boolean {
  return role === "OWNER" || role === "SUPER_ADMIN" || role === "AUDITOR";
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
  if (isAdminTier(user.role)) {
    return (
      requested ||
      (req.query.tenantId as string | undefined) ||
      (req.body && (req.body.tenantId as string | undefined)) ||
      null
    );
  }
  return user.tenantId;
}
