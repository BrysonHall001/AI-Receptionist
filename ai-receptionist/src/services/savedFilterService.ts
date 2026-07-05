import { prisma } from "../db/client";

export async function listSavedFilters(tenantId: string, view = "contacts") {
  const rows = await prisma.savedFilter.findMany({
    where: { tenantId, view },
    orderBy: { name: "asc" },
  });
  return rows.map((f: any) => ({
    id: f.id,
    name: f.name,
    view: f.view,
    definition: f.definition ?? {},
    createdAt: f.createdAt.toISOString(),
  }));
}

export async function createSavedFilter(input: {
  tenantId: string;
  name: string;
  view?: string;
  definition: unknown;
  createdById?: string | null;
}) {
  return prisma.savedFilter.create({
    data: {
      tenantId: input.tenantId,
      name: input.name.trim(),
      view: input.view || "contacts",
      definition: (input.definition ?? {}) as any,
      createdById: input.createdById ?? null,
    },
  });
}

export async function deleteSavedFilter(id: string, tenantId: string): Promise<boolean> {
  const existing = await prisma.savedFilter.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return false;
  await prisma.savedFilter.delete({ where: { id } });
  return true;
}

export async function updateSavedFilter(
  id: string,
  tenantId: string,
  patch: { name?: string; definition?: unknown },
): Promise<boolean> {
  const existing = await prisma.savedFilter.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return false;
  const data: Record<string, unknown> = {};
  if (typeof patch.name === "string" && patch.name.trim()) data.name = patch.name.trim();
  if ("definition" in patch) data.definition = (patch.definition ?? {}) as any;
  await prisma.savedFilter.update({ where: { id }, data });
  return true;
}
