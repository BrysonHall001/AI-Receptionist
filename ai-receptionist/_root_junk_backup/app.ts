import { Request, Response, NextFunction } from "express";
import { getUserForToken, SESSION_COOKIE } from "../auth/session";

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
