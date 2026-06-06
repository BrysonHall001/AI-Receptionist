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
    status: t.status,
    requireEmail: (t as any).requireEmail !== false,
    createdAt: t.createdAt.toISOString(),
  };
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
