import { prisma } from "../db/client";

// Map a stored ExportRecord to the list DTO.
function toListDTO(r: any) {
  return {
    id: r.id,
    name: r.name,
    rowCount: r.rowCount,
    fields: r.fields ?? [],
    scope: r.scope ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

// Portal export history (a real tenant).
export async function listExports(tenantId: string) {
  const rows = await prisma.exportRecord.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, rowCount: true, fields: true, scope: true, createdAt: true },
    take: 100,
  });
  return rows.map(toListDTO);
}

// Master-hub export history (no single portal): master-hub-local + all-portals exports.
export async function listMasterExports() {
  const rows = await prisma.exportRecord.findMany({
    where: { tenantId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, rowCount: true, fields: true, scope: true, createdAt: true },
    take: 100,
  });
  return rows.map(toListDTO);
}

export async function createExport(input: {
  tenantId: string | null;
  scope?: string | null;
  name: string;
  rowCount: number;
  fields: unknown;
  csv: string;
  createdById?: string | null;
}) {
  const rec = await prisma.exportRecord.create({
    data: {
      tenantId: input.tenantId ?? null,
      scope: input.scope ?? null,
      name: input.name.trim(),
      rowCount: input.rowCount,
      fields: (input.fields ?? []) as any,
      csv: input.csv,
      createdById: input.createdById ?? null,
    },
  });
  return { id: rec.id, name: rec.name, rowCount: rec.rowCount, scope: rec.scope ?? null, createdAt: rec.createdAt.toISOString() };
}

// Download a portal export (must belong to that portal).
export async function getExportCsv(id: string, tenantId: string): Promise<{ name: string; csv: string } | null> {
  const rec = await prisma.exportRecord.findUnique({ where: { id } });
  if (!rec || rec.tenantId !== tenantId) return null;
  return { name: rec.name, csv: rec.csv };
}

// Download a master-hub export (no tenant). Route-gated to master roles.
export async function getMasterExportCsv(id: string): Promise<{ name: string; csv: string } | null> {
  const rec = await prisma.exportRecord.findUnique({ where: { id } });
  if (!rec || rec.tenantId !== null) return null;
  return { name: rec.name, csv: rec.csv };
}
