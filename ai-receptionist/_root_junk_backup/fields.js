import { prisma } from "../db/client";

export async function listDashboards(tenantId: string) {
  const rows = await prisma.dashboard.findMany({ where: { tenantId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return rows.map(serialize);
}

function serialize(d: any) {
  return { id: d.id, name: d.name, widgets: d.widgets ?? [], order: d.order, createdAt: d.createdAt.toISOString() };
}

export async function createDashboard(tenantId: string, name: string, createdById?: string | null) {
  const max = await prisma.dashboard.aggregate({ where: { tenantId }, _max: { order: true } });
  const d = await prisma.dashboard.create({
    data: { tenantId, name: name.trim() || "Untitled dashboard", widgets: [] as any, order: (max._max.order ?? -1) + 1, createdById: createdById ?? null },
  });
  return serialize(d);
}

export async function updateDashboard(id: string, tenantId: string, data: { name?: string; widgets?: unknown }) {
  const d = await prisma.dashboard.findUnique({ where: { id } });
  if (!d || d.tenantId !== tenantId) throw new Error("Dashboard not found");
  const patch: any = {};
  if (data.name != null) patch.name = data.name.trim();
  if (data.widgets != null) patch.widgets = data.widgets as any;
  const updated = await prisma.dashboard.update({ where: { id }, data: patch });
  return serialize(updated);
}

export async function deleteDashboard(id: string, tenantId: string): Promise<boolean> {
  const d = await prisma.dashboard.findUnique({ where: { id } });
  if (!d || d.tenantId !== tenantId) return false;
  await prisma.dashboard.delete({ where: { id } });
  return true;
}
