import { prisma } from "../db/client";
import { Extracted } from "../ai/schema";
import { TranscriptTurn } from "../utils/transcript";

export interface CallDTO {
  id: string;
  callSid: string;
  status: string;
  fromNumber: string;
  toNumber: string | null;
  name: string | null;
  phone: string | null;
  intent: string | null;
  email: string | null;
  turnCount: number;
  createdAt: string;
  finalizedAt: string | null;
}

export interface CallDetailDTO extends CallDTO {
  tenantName: string | null;
  transcript: TranscriptTurn[];
  emailSentAt: string | null;
}

export interface ContactDTO {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  intent: string | null;
  callerId: string | null;
  customFields: Record<string, unknown>;
  callCount: number;
  createdAt: string;
  updatedAt: string;
}

function ex(value: unknown): Extracted {
  return (value ?? {}) as Extracted;
}

// Sentinel tenant id that no real tenant can equal (tenant ids are cuids). Used so
// a missing tenant filters to NOTHING instead of widening to every tenant.
const NO_TENANT = "__missing_tenant__";

// Fail safe: a real tenant is returned unchanged (identical to before); a missing/
// null/undefined tenant yields a filter that matches no rows. This guarantees that
// any future caller which forgets to pass a tenant gets an empty result, never a
// cross-tenant leak. (Every current caller passes a real tenant, so behavior is
// unchanged today.)
function scope(tenantId?: string | null) {
  return { tenantId: tenantId || NO_TENANT };
}

export async function getStats(tenantId?: string | null) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const base = scope(tenantId);

  const [totalCalls, completed, leads, today] = await Promise.all([
    prisma.callSession.count({ where: base }),
    prisma.callSession.count({ where: { ...base, status: "COMPLETED" } }),
    prisma.contact.count({ where: { ...base, deletedAt: null } }),
    prisma.callSession.count({ where: { ...base, createdAt: { gte: startOfToday } } }),
  ]);

  return { totalCalls, completed, leads, today };
}

export async function listCalls(tenantId?: string | null, limit = 500): Promise<CallDTO[]> {
  if (!tenantId) return []; // fail safe: no tenant -> no data (never all tenants)
  const rows = await prisma.callSession.findMany({
    where: scope(tenantId),
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r: any) => toCallDTO(r));
}

export async function getCall(id: string, tenantId?: string | null): Promise<CallDetailDTO | null> {
  if (!tenantId) return null; // fail safe: no tenant -> not found (never cross-tenant)
  const r = await prisma.callSession.findUnique({ where: { id }, include: { tenant: true } });
  if (!r) return null;
  if (r.tenantId !== tenantId) return null; // enforce scope
  return {
    ...toCallDTO(r),
    tenantName: r.tenant?.name ?? null,
    transcript: (r.transcript ?? []) as unknown as TranscriptTurn[],
    emailSentAt: r.emailSentAt ? r.emailSentAt.toISOString() : null,
  };
}

export const RETENTION_DAYS = 30;

function mapContact(c: any) {
  return {
    id: c.id,
    name: c.name ?? null,
    phone: c.phone,
    email: c.email ?? null,
    intent: c.intent ?? null,
    source: c.source ?? "unknown",
    callerId: c.callerId ?? null,
    customFields: (c.customFields as any) ?? {},
    callCount: c._count?.callSessions ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listContacts(tenantId?: string | null, limit = 500): Promise<ContactDTO[]> {
  if (!tenantId) return []; // fail safe: no tenant -> no data (never all tenants)
  const rows = await prisma.contact.findMany({
    where: { ...scope(tenantId), deletedAt: null }, // active only — never show soft-deleted
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { _count: { select: { callSessions: true } } },
  });
  return rows.map(mapContact);
}

// Recycle bin: soft-deleted contacts only, newest-deleted first, with a
// days-until-permanent-deletion countdown (RETENTION_DAYS from deletion).
export async function listDeletedContacts(tenantId?: string | null, limit = 500) {
  if (!tenantId) return []; // fail safe: no tenant -> no data (never all tenants)
  const rows = await prisma.contact.findMany({
    where: { ...scope(tenantId), deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    take: limit,
    include: { _count: { select: { callSessions: true } } },
  });
  const now = Date.now();
  return rows.map((c: any) => {
    const deletedMs = new Date(c.deletedAt).getTime();
    const expiresMs = deletedMs + RETENTION_DAYS * 86400000;
    const daysLeft = Math.max(0, Math.ceil((expiresMs - now) / 86400000));
    return { ...mapContact(c), deletedAt: new Date(c.deletedAt).toISOString(), deletedBy: c.deletedBy ?? null, deletedByType: c.deletedByType ?? null, daysLeft };
  });
}

export async function getContact(id: string, tenantId?: string | null) {
  if (!tenantId) return null; // fail safe: no tenant -> not found (never cross-tenant)
  const c = await prisma.contact.findUnique({
    where: { id },
    include: { callSessions: { orderBy: { createdAt: "desc" } } },
  });
  if (!c) return null;
  if (c.tenantId !== tenantId) return null;
  return {
    id: c.id,
    name: c.name ?? null,
    phone: c.phone,
    email: c.email ?? null,
    intent: c.intent ?? null,
    callerId: (c as any).callerId ?? null,
    customFields: (c.customFields as any) ?? {},
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    calls: (c.callSessions as any[]).map((r) => toCallDTO(r)),
  };
}

function toCallDTO(r: any): CallDTO {
  const e = ex(r.extracted);
  // A finalized call (finalizedAt set) is, by definition, no longer in progress.
  // If a late/concurrent turn reverted `status` to a non-terminal value AFTER
  // finalize set it (the walkie call-end race), honor the finalized fact so the
  // badge always reflects the true terminal state. This also RETROACTIVELY heals
  // any rows already left in that inconsistent state — no migration needed.
  const finalized = r.finalizedAt != null;
  const isTerminal = r.status === "COMPLETED" || r.status === "FAILED";
  const status = finalized && !isTerminal ? "COMPLETED" : r.status;
  return {
    id: r.id,
    callSid: r.callSid,
    status,
    fromNumber: r.fromNumber,
    toNumber: r.toNumber ?? null,
    name: e.name ?? null,
    phone: e.phone ?? r.fromNumber ?? null,
    intent: e.intent ?? null,
    email: e.email ?? null,
    turnCount: r.turnCount,
    createdAt: r.createdAt.toISOString(),
    finalizedAt: r.finalizedAt ? r.finalizedAt.toISOString() : null,
  };
}
