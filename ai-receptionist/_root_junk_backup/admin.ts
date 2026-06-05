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
  customFields: Record<string, unknown>;
  callCount: number;
  createdAt: string;
  updatedAt: string;
}

function ex(value: unknown): Extracted {
  return (value ?? {}) as Extracted;
}

function scope(tenantId?: string | null) {
  return tenantId ? { tenantId } : {};
}

export async function getStats(tenantId?: string | null) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const base = scope(tenantId);

  const [totalCalls, completed, leads, today] = await Promise.all([
    prisma.callSession.count({ where: base }),
    prisma.callSession.count({ where: { ...base, status: "COMPLETED" } }),
    prisma.contact.count({ where: base }),
    prisma.callSession.count({ where: { ...base, createdAt: { gte: startOfToday } } }),
  ]);

  return { totalCalls, completed, leads, today };
}

export async function listCalls(tenantId?: string | null, limit = 500): Promise<CallDTO[]> {
  const rows = await prisma.callSession.findMany({
    where: scope(tenantId),
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r: any) => toCallDTO(r));
}

export async function getCall(id: string, tenantId?: string | null): Promise<CallDetailDTO | null> {
  const r = await prisma.callSession.findUnique({ where: { id }, include: { tenant: true } });
  if (!r) return null;
  if (tenantId && r.tenantId !== tenantId) return null; // enforce scope
  return {
    ...toCallDTO(r),
    tenantName: r.tenant?.name ?? null,
    transcript: (r.transcript ?? []) as unknown as TranscriptTurn[],
    emailSentAt: r.emailSentAt ? r.emailSentAt.toISOString() : null,
  };
}

export async function listContacts(tenantId?: string | null, limit = 500): Promise<ContactDTO[]> {
  const rows = await prisma.contact.findMany({
    where: scope(tenantId),
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { _count: { select: { callSessions: true } } },
  });
  return rows.map((c: any) => ({
    id: c.id,
    name: c.name ?? null,
    phone: c.phone,
    email: c.email ?? null,
    intent: c.intent ?? null,
    customFields: (c.customFields as any) ?? {},
    callCount: c._count?.callSessions ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function getContact(id: string, tenantId?: string | null) {
  const c = await prisma.contact.findUnique({
    where: { id },
    include: { callSessions: { orderBy: { createdAt: "desc" } } },
  });
  if (!c) return null;
  if (tenantId && c.tenantId !== tenantId) return null;
  return {
    id: c.id,
    name: c.name ?? null,
    phone: c.phone,
    email: c.email ?? null,
    intent: c.intent ?? null,
    customFields: (c.customFields as any) ?? {},
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    calls: (c.callSessions as any[]).map((r) => toCallDTO(r)),
  };
}

function toCallDTO(r: any): CallDTO {
  const e = ex(r.extracted);
  return {
    id: r.id,
    callSid: r.callSid,
    status: r.status,
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
