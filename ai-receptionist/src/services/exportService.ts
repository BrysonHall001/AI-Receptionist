import { prisma } from "../db/client";

// Map a stored ExportRecord (now the shared import/export history) to the list DTO.
function toListDTO(r: any, nameById: Record<string, string | null>) {
  const kind = r.kind ?? "export";
  return {
    id: r.id,
    kind,
    dataType: r.dataType ?? null,
    name: r.name,
    rowCount: r.rowCount,
    okCount: r.okCount ?? null,
    failCount: r.failCount ?? null,
    fields: r.fields ?? [],
    scope: r.scope ?? null,
    createdById: r.createdById ?? null,
    createdByName: r.createdById ? (nameById[r.createdById] ?? null) : null,
    // Download is per-row: exports produced a stored file; imports (and, later, the
    // Data Backup) did not. Driven by kind so future non-export rows slot in cleanly.
    downloadable: kind === "export",
    createdAt: r.createdAt.toISOString(),
  };
}

const LIST_SELECT = { id: true, kind: true, dataType: true, name: true, rowCount: true, okCount: true, failCount: true, fields: true, scope: true, createdById: true, createdAt: true };

// Resolve the "who" for the history User column: map createdById -> display name.
async function resolveCreatorNames(rows: any[]): Promise<Record<string, string | null>> {
  const ids = Array.from(new Set(rows.map((r) => r.createdById).filter(Boolean))) as string[];
  if (!ids.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  const map: Record<string, string | null> = {};
  users.forEach((u: any) => { map[u.id] = u.name || u.email || null; });
  return map;
}

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
  const nameById = await resolveCreatorNames(rows);
  return rows.map((r: any) => toListDTO(r, nameById));
}

// Master-hub history (no single portal): master-hub-local + all-portals exports.
export async function listMasterExports(filter?: HistoryFilter) {
  const rows = await prisma.exportRecord.findMany({
    where: { tenantId: null, ...filterWhere(filter) },
    orderBy: { createdAt: "desc" },
    select: LIST_SELECT,
    take: 100,
  });
  const nameById = await resolveCreatorNames(rows);
  return rows.map((r: any) => toListDTO(r, nameById));
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

// Log that a full Data Backup happened. Like imports, NO file is stored (the backup
// is a large PII-heavy blob, download-only). kind="backup" => toListDTO marks it
// downloadable:false, so the history Download column is blank for it.
export async function createBackupRecord(input: {
  tenantId: string;
  name: string;
  rowCount: number;
  createdById?: string | null;
}) {
  const rec = await prisma.exportRecord.create({
    data: {
      tenantId: input.tenantId,
      scope: null,
      kind: "backup",
      dataType: null,
      name: input.name.trim(),
      rowCount: input.rowCount,
      fields: [],
      csv: "",
      createdById: input.createdById ?? null,
    },
  });
  return { id: rec.id, kind: "backup", name: rec.name, rowCount: rec.rowCount, createdAt: rec.createdAt.toISOString() };
}

// Download a portal export (must belong to that portal).
export async function getExportCsv(id: string, tenantId: string): Promise<{ name: string; csv: string } | null> {
  const rec = await prisma.exportRecord.findUnique({ where: { id } });
  if (!rec || rec.tenantId !== tenantId) return null;
  return { name: rec.name, csv: rec.csv };
}

// Format-aware download. Plain exports stay CSV text (base64:false). Report runs may
// be xlsx/zip — the {ext, mime, base64} hint lives in the `fields` JSON and the
// payload (`csv` column) is base64 for those. The route returns whichever applies so
// the client rebuilds the EXACT emailed file with the right bytes + extension.
export async function getExportArtifact(id: string, tenantId: string): Promise<{ name: string; csv: string; ext: string; mime: string; base64: boolean } | null> {
  const rec = await prisma.exportRecord.findUnique({ where: { id } });
  if (!rec || rec.tenantId !== tenantId) return null;
  const hint = (rec.fields && !Array.isArray(rec.fields) ? rec.fields : {}) as any;
  const base64 = hint.base64 === true;
  const ext = typeof hint.ext === "string" ? hint.ext : "csv";
  const mime = typeof hint.mime === "string" ? hint.mime : "text/csv;charset=utf-8;";
  return { name: rec.name, csv: rec.csv, ext, mime, base64 };
}

// Download a master-hub export (no tenant). Route-gated to master roles.
export async function getMasterExportCsv(id: string): Promise<{ name: string; csv: string } | null> {
  const rec = await prisma.exportRecord.findUnique({ where: { id } });
  if (!rec || rec.tenantId !== null) return null;
  return { name: rec.name, csv: rec.csv };
}
