import { prisma } from "../db/client";

export async function listPortals() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { callSessions: true, contacts: true, users: true } } },
  });
  return tenants.map((t: any) => ({
    id: t.id,
    name: t.name,
    businessType: t.businessType,
    phoneNumber: t.phoneNumber,
    notifyEmail: t.notifyEmail,
    greeting: t.greeting,
    status: t.status,
    requireEmail: (t as any).requireEmail !== false,
    calls: t._count?.callSessions ?? 0,
    contacts: t._count?.contacts ?? 0,
    users: t._count?.users ?? 0,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function getPortal(id: string) {
  const t = await prisma.tenant.findUnique({ where: { id } });
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    businessType: t.businessType,
    phoneNumber: t.phoneNumber,
    notifyEmail: t.notifyEmail,
    greeting: t.greeting,
    labels: (t as any).labels ?? {},
    status: t.status,
    requireEmail: (t as any).requireEmail !== false,
    createdAt: t.createdAt.toISOString(),
  };
}

// Merge generic-word overrides (e.g. "record","stage") into Tenant.labels.
// Portal-scoped (only this tenant's row). Both forms required per word. Stable
// keys aren't involved — this is display words only.
export async function setTenantLabels(
  tenantId: string,
  generic: Record<string, { one?: string; many?: string }>
) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw new Error("Portal not found");
  const current = (t as any).labels && typeof (t as any).labels === "object" ? { ...(t as any).labels } : {};
  for (const [k, v] of Object.entries(generic || {})) {
    const one = String((v && v.one) || "").trim();
    const many = String((v && v.many) || "").trim();
    if (!one || !many) throw new Error(`Both singular and plural are required for "${k}"`);
    current[k] = { one, many };
  }
  await prisma.tenant.update({ where: { id: tenantId }, data: { labels: current } as any });
  return current;
}

export async function createPortal(input: {
  name: string;
  businessType?: string;
  phoneNumber?: string | null;
  notifyEmail: string;
  greeting?: string;
  requireEmail?: boolean;
}) {
  return prisma.tenant.create({
    data: {
      name: input.name,
      businessType: input.businessType || "general business",
      phoneNumber: input.phoneNumber || null,
      notifyEmail: input.notifyEmail,
      greeting: input.greeting || "Thank you for calling. How can I help you today?",
      requireEmail: input.requireEmail !== false,
    } as any,
  });
}

export async function updatePortal(
  id: string,
  data: Partial<{ name: string; businessType: string; phoneNumber: string | null; notifyEmail: string; greeting: string; status: "ACTIVE" | "SUSPENDED"; requireEmail: boolean }>,
) {
  return prisma.tenant.update({ where: { id }, data: data as any });
}
