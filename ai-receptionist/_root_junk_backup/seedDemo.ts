import { prisma } from "../db/client";

export async function listExports(tenantId: string) {
  const rows = await prisma.exportRecord.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, rowCount: true, fields: true, createdAt: true },
    take: 100,
  });
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    rowCount: r.rowCount,
    fields: r.fields ?? [],
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createExport(input: {
  tenantId: string;
  name: string;
  rowCount: number;
  fields: unknown;
  csv: string;
  createdById?: string | null;
}) {
  const rec = await prisma.exportRecord.create({
    data: {
      tenantId: input.tenantId,
      name: input.name.trim(),
      rowCount: input.rowCount,
      fields: (input.fields ?? []) as any,
      csv: input.csv,
      createdById: input.createdById ?? null,
    },
  });
  return { id: rec.id, name: rec.name, rowCount: rec.rowCount, createdAt: rec.createdAt.toISOString() };
}

export async function getExportCsv(id: string, tenantId: string): Promise<{ name: string; csv: string } | null> {
  const rec = await prisma.exportRecord.findUnique({ where: { id } });
  if (!rec || rec.tenantId !== tenantId) return null;
  return { name: rec.name, csv: rec.csv };
}
