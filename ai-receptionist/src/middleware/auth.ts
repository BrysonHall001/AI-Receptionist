import { Request, Response, NextFunction } from "express";
import { getUserForToken, getImpersonationForToken, ImpersonationOverlay, SESSION_COOKIE } from "../auth/session";

export type Role = "OWNER" | "SUPER_ADMIN" | "PORTAL_ADMIN" | "CLIENT_USER" | "AUDITOR";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  tenantId: string | null;
  // Null unless a custom PortalRole is assigned. Read by the permission resolver
  // (can()). Additive; null for everyone until custom roles are assigned.
  customRoleId?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      // realUser = the authoritative real identity, never overwritten. impersonation
      // = the active overlay, or null when not impersonating. While impersonating,
      // req.user is the EFFECTIVE identity (downgraded to the assumed role); realUser
      // stays the actual logged-in admin (used for action stamping + the exit path).
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
        customRoleId: (user as any).customRoleId ?? null,
      };
    }
    // The real identity is authoritative and never overwritten (req.realUser).
    // req.user may be re-skinned below to the EFFECTIVE identity while impersonating.
    req.realUser = req.user;
    req.impersonation = null;
    // Only a real admin-tier user can ever hold an overlay; skip the lookup entirely
    // for everyone else (zero extra work, identical behavior).
    if (req.user && isAdminTier(req.user.role)) {
      req.impersonation = await getImpersonationForToken(token);
    }
    // EFFECTIVE-ROLE DOWNGRADE: while impersonating (act-as-type OR view-as-user), the
    // session must act with EXACTLY the assumed role's permissions — no more. We keep
    // the real id/email/name (actions stamp honestly as the real admin, and personal
    // data stays theirs), but swap role -> assumedRole, tenant -> the pinned portal,
    // and set customRoleId from the overlay: for a CUSTOM-role impersonation the base
    // role is CLIENT_USER + this customRoleId, so can() resolves EXACTLY that role's
    // permissions; for a system-role impersonation it's null. This is what
    // lets the permission gate enforce the assumed role on data routes; without it an
    // impersonating admin would keep admin rights and pass every gate. (view-as-user
    // additionally stays read-only via the view-only guard, which keys on the mode.)
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
        customRoleId: req.impersonation.customRoleId ?? null, // custom-role impersonation resolves to EXACTLY that role's perms; null = system role
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
