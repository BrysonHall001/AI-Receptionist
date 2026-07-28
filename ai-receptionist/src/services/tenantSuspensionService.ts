// TENANT SUSPENSION — the gate.
//
// Until this batch, `Tenant.status` was stored and toggled but ENFORCED NOWHERE
// (grep found no consumer besides the delete guard). This module is the single
// place that answers "is this tenant suspended?", so every surface asks the
// same question the same way.
//
// WHAT SUSPENSION MEANS (owner's decision):
//   * tenant users cannot get in — sessions resolve, then the request is
//     refused with an honest message;
//   * the receptionist does not answer inbound calls;
//   * scheduled work skips that tenant (automations, drips, reports, detector
//     sweep, recurring spawns, feedback);
//   * PUBLIC surfaces stop accepting submissions (estimates, surveys, and any
//     public link) — a suspended business should not keep collecting work;
//   * hub admins keep full access, including entering the portal, because that
//     is how the cause of a suspension gets fixed;
//   * NOTHING is deleted or changed. Resuming restores everything.
//
// BILLING IS EXPLICITLY OUT OF SCOPE: `billingStatus` is a separate field, and
// nothing here reads or writes it.
import { prisma } from "../db/client";

const db = prisma as any;

/** The message a blocked tenant user sees. Tenant-facing: it names no hub
 *  concept, and points at the person who can actually help them. */
export const SUSPENDED_MESSAGE = "This portal is temporarily unavailable. Please contact your account manager.";

// A tiny cache: suspension changes rarely, and this is consulted on hot paths.
const CACHE_MS = 5000;
const cache = new Map<string, { at: number; suspended: boolean }>();

export function forgetTenantStatus(tenantId?: string | null): void {
  if (tenantId) cache.delete(tenantId); else cache.clear();
}

/** True when the tenant exists and is SUSPENDED. Unknown tenants are NOT
 *  treated as suspended — that is a different failure with its own handling. */
export async function isTenantSuspended(tenantId?: string | null): Promise<boolean> {
  if (!tenantId) return false;
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.suspended;
  let suspended = false;
  try {
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
    suspended = !!t && t.status === "SUSPENDED";
  } catch { /* a lookup failure must not lock anyone out */ }
  cache.set(tenantId, { at: Date.now(), suspended });
  return suspended;
}

/** Filter a list of tenant ids down to the ones still running — used by the
 *  scheduled sweeps so one suspended tenant never stops the others. */
export async function activeTenantIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db.tenant.findMany({ where: { id: { in: ids }, status: { not: "SUSPENDED" } }, select: { id: true } });
  return rows.map((r: any) => r.id);
}
