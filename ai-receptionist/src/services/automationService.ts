import { prisma } from "../db/client";

const db = prisma as any;

function serialize(a: any) {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    triggerType: a.triggerType,
    conditions: a.conditions ?? [],
    actions: a.actions ?? [],
    pairId: a.pairId ?? null,
    createdAt: a.createdAt?.toISOString?.() ?? a.createdAt,
    updatedAt: a.updatedAt?.toISOString?.() ?? a.updatedAt,
  };
}

export async function listAutomations(tenantId: string) {
  const rows = await db.automation.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  return rows.map(serialize);
}

// Enabled Manual-trigger flows for a tenant — used to populate the "Run
// automation" button on a record. Tenant-scoped like every other query here.
export async function listManualAutomations(tenantId: string) {
  const rows = await db.automation.findMany({
    where: { tenantId, triggerType: "Manual", enabled: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(serialize);
}

export async function getAutomation(id: string, tenantId: string) {
  const a = await db.automation.findUnique({ where: { id } });
  if (!a || a.tenantId !== tenantId) return null;
  return serialize(a);
}

export interface AutomationInput {
  name?: string;
  triggerType?: string;
  conditions?: unknown;
  actions?: unknown;
  enabled?: boolean;
  pairId?: string | null;
}

export async function createAutomation(tenantId: string, input: AutomationInput, createdById?: string | null) {
  const a = await db.automation.create({
    data: {
      tenantId,
      name: (input.name || "Untitled automation").trim(),
      triggerType: input.triggerType || "ContactCreated",
      conditions: (input.conditions ?? []) as any,
      actions: (input.actions ?? []) as any,
      enabled: input.enabled ?? true,
      createdById: createdById ?? null,
      // Only set when a caller (the branching wizard) supplies a pair token.
      // Normal/single automations omit it entirely, leaving the column null.
      ...(input.pairId ? { pairId: input.pairId } : {}),
    },
  });
  return serialize(a);
}

export async function updateAutomation(id: string, tenantId: string, input: AutomationInput) {
  const a = await db.automation.findUnique({ where: { id } });
  if (!a || a.tenantId !== tenantId) throw new Error("Automation not found");
  const patch: any = {};
  if (input.name != null) patch.name = String(input.name).trim() || "Untitled automation";
  if (input.triggerType != null) patch.triggerType = input.triggerType;
  if (input.conditions != null) patch.conditions = input.conditions as any;
  if (input.actions != null) patch.actions = input.actions as any;
  if (input.enabled != null) patch.enabled = !!input.enabled;
  const updated = await db.automation.update({ where: { id }, data: patch });
  return serialize(updated);
}

export async function deleteAutomation(id: string, tenantId: string): Promise<boolean> {
  const a = await db.automation.findUnique({ where: { id } });
  if (!a || a.tenantId !== tenantId) return false;
  await db.automation.delete({ where: { id } });
  return true;
}

export async function listRuns(tenantId: string, opts: { automationId?: string; limit?: number } = {}) {
  const where: any = { tenantId };
  if (opts.automationId) where.automationId = opts.automationId;
  const rows = await db.automationRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 100, 500),
  });
  return rows.map((r: any) => ({
    id: r.id,
    automationId: r.automationId,
    eventType: r.eventType,
    contactId: r.contactId,
    status: r.status,
    matched: r.matched,
    results: r.results ?? [],
    error: r.error ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listEvents(tenantId: string, opts: { limit?: number; type?: string } = {}) {
  const where: any = { tenantId };
  if (opts.type) where.type = opts.type;
  const rows = await db.event.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: Math.min(opts.limit ?? 100, 500),
  });
  return rows.map((e: any) => ({
    id: e.id,
    type: e.type,
    actorType: e.actorType,
    actorName: e.actorName,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    payload: e.payload ?? {},
    occurredAt: e.occurredAt.toISOString(),
  }));
}
