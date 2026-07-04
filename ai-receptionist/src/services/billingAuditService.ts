// Billing audit trail. Writing an audit row must NEVER break the underlying mutation, so every
// write is wrapped and only logs a warning on failure.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";

const db = prisma as any;

export interface Actor { id: string | null; name: string }
export const SYSTEM_ACTOR: Actor = { id: null, name: "System" };
export function actorOr(actor?: Actor | null): Actor {
  if (actor && actor.name) return { id: actor.id ?? null, name: actor.name };
  return SYSTEM_ACTOR;
}

export function money(v: any, currency = "USD"): string {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  return `${currency === "USD" ? "$" : ""}${n.toFixed(2)}${currency && currency !== "USD" ? " " + currency : ""}`;
}
export function ymd(v: any): string { return v ? new Date(v).toISOString().slice(0, 10) : "—"; }

export interface AuditInput {
  tenantId: string;
  chargeId?: string | null;
  actor?: Actor | null;
  action: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  note: string;
}

// Safe single-entry write.
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const a = actorOr(input.actor);
    await db.billingAuditLog.create({
      data: {
        tenantId: input.tenantId,
        chargeId: input.chargeId ?? null,
        actorUserId: a.id,
        actorName: a.name,
        action: input.action,
        field: input.field ?? null,
        oldValue: input.oldValue ?? null,
        newValue: input.newValue ?? null,
        note: input.note,
      },
    });
  } catch (e) {
    logger.warn(`[billing-audit] failed to write audit (${input.action}): ${(e as Error).message}`);
  }
}

// Safe multi-entry write (per-field changes).
export async function writeAuditMany(entries: AuditInput[]): Promise<void> {
  for (const e of entries) await writeAudit(e);
}

function serialize(r: any) {
  return {
    id: r.id, tenantId: r.tenantId, chargeId: r.chargeId,
    actorUserId: r.actorUserId, actorName: r.actorName,
    action: r.action, field: r.field, oldValue: r.oldValue, newValue: r.newValue,
    note: r.note, createdAt: r.createdAt,
  };
}

// Charge history — chronological (oldest first) for a timeline.
export async function getChargeAudit(chargeId: string) {
  const rows = await db.billingAuditLog.findMany({ where: { chargeId }, orderBy: { createdAt: "asc" } });
  return rows.map(serialize);
}

// Terms history for a tenant — newest first (chargeId null = terms/config changes).
export async function getTermsAudit(tenantId: string) {
  const rows = await db.billingAuditLog.findMany({ where: { tenantId, chargeId: null, action: "terms_updated" }, orderBy: { createdAt: "desc" } });
  return rows.map(serialize);
}
