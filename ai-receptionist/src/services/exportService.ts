import { prisma } from "../db/client";

// Map a stored ExportRecord (now the shared import/export history) to the list DTO.
function toListDTO(r: any) {
  return {
    id: r.id,
    kind: r.kind ?? "export",
    dataType: r.dataType ?? null,
    name: r.name,
    rowCount: r.rowCount,
    okCount: r.okCount ?? null,
    failCount: r.failCount ?? null,
    fields: r.fields ?? [],
    scope: r.scope ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

const LIST_SELECT = { id: true, kind: true, dataType: true, name: true, rowCount: true, okCount: true, failCount: true, fields: true, scope: true, createdAt: true };

// Optional type-scoping: per-page history passes its own kind ("export"/"import")
// and dataType ("contact"/"job"/…) so each page sees ONLY its own entries. Omitting
// both returns everything (the later centralized view).
type HistoryFilter = { kind?: string | null; dataType?: string | null };
function filterWhere(f?: HistoryFilter) {
  const where: any = {};
  if (f?.kind) where.kind = f.kind;
  if (f?.dataType) where.dataType = f.dataType;
  return where;
}

// Portal export/import history (a real tenant).
export async function listExports(tenantId: string, filter?: HistoryFilter) {
  const rows = await prisma.exportRecord.findMany({
    where: { tenantId, ...filterWhere(filter) },
    orderBy: { createdAt: "desc" },
    select: LIST_SELECT,
    take: 100,
  });
  return rows.map(toListDTO);
}

// Master-hub history (no single portal): master-hub-local + all-portals exports.
export async function listMasterExports(filter?: HistoryFilter) {
  const rows = await prisma.exportRecord.findMany({
    where: { tenantId: null, ...filterWhere(filter) },
    orderBy: { createdAt: "desc" },
    select: LIST_SELECT,
    take: 100,
  });
  return rows.map(toListDTO);
}

export async function createExport(input: {
  tenantId: string | null;
  scope?: string | null;
  dataType?: string | null;
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
      kind: "export",
      dataType: input.dataType ?? null,
      name: input.name.trim(),
      rowCount: input.rowCount,
      fields: (input.fields ?? []) as any,
      csv: input.csv,
      createdById: input.createdById ?? null,
    },
  });
  return { id: rec.id, name: rec.name, rowCount: rec.rowCount, scope: rec.scope ?? null, createdAt: rec.createdAt.toISOString() };
}

// Record an IMPORT in the same history table (kind="import"). No CSV — imports have
// nothing to download — so csv is stored empty; okCount/failCount carry the result.
export async function createImportRecord(input: {
  tenantId: string;
  dataType: string;
  name: string;
  rowCount: number;
  okCount: number;
  failCount: number;
  createdById?: string | null;
}) {
  const rec = await prisma.exportRecord.create({
    data: {
      tenantId: input.tenantId,
      scope: null,
      kind: "import",
      dataType: input.dataType,
      name: input.name.trim(),
      rowCount: input.rowCount,
      okCount: input.okCount,
      failCount: input.failCount,
      fields: [],
      csv: "",
      createdById: input.createdById ?? null,
    },
  });
  return { id: rec.id, kind: "import", dataType: rec.dataType, name: rec.name, rowCount: rec.rowCount, okCount: rec.okCount, failCount: rec.failCount, createdAt: rec.createdAt.toISOString() };
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
