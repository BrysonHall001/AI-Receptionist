import { prisma } from "../db/client";

// ScheduledReport service. The Data Administration → Reports tab lists every saved
// report (active AND inactive) joined with its LATEST run. Runs are ExportRecord
// rows (kind:"report") — NOT a second history table — so Rows + Download come from
// the same export path the history table already uses.

const db = prisma as any;

// Resolve createdById -> display name for the "Created by" column (same approach as
// exportService.resolveCreatorNames).
async function resolveCreatorNames(ids: Array<string | null | undefined>): Promise<Record<string, string | null>> {
  const uniq = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (!uniq.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } });
  const map: Record<string, string | null> = {};
  users.forEach((u: any) => { map[u.id] = u.name || u.email || null; });
  return map;
}

// One list row. `latestRun` is the most recent ExportRecord (kind:"report") for this
// report, or null if it has never run (true for every report until the scheduler
// lands next batch). Rows + Download read off that run.
function toListDTO(r: any, nameById: Record<string, string | null>) {
  const latest = Array.isArray(r.runs) && r.runs.length ? r.runs[0] : null;
  return {
    id: r.id,
    name: r.name,
    format: r.format,
    active: r.active,
    mode: r.mode,
    createdAt: r.createdAt.toISOString(),     // "Date Created" (date + time)
    createdById: r.createdById ?? null,
    createdByName: r.createdById ? (nameById[r.createdById] ?? null) : null, // "Created by"
    lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
    nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
    // Latest run -> Rows + Download. null until a run exists.
    latestRun: latest
      ? { exportRecordId: latest.id, rowCount: latest.rowCount, downloadable: true, createdAt: latest.createdAt.toISOString() }
      : null,
    rowCount: latest ? latest.rowCount : null,
  };
}

// All reports for a portal (active AND inactive), newest first, each joined with its
// latest run. Pull only the newest run per report via a bounded include.
export async function listReports(tenantId: string) {
  const rows = await db.scheduledReport.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
    take: 200,
  });
  const nameById = await resolveCreatorNames(rows.map((r: any) => r.createdById));
  return rows.map((r: any) => toListDTO(r, nameById));
}

// Create a ScheduledReport. The full spec lives in the opaque `definition` JSON so the
// builder form can evolve next batch without a migration; only list/scheduler columns
// are promoted. recipients/cadence default empty/null until delivery + recurrence land.
export async function createScheduledReport(input: {
  tenantId: string;
  name: string;
  format?: string;                 // "csv" | "xlsx"
  definition?: unknown;            // opaque spec
  recipients?: unknown;            // string[] of emails (empty for now)
  mode?: string;                   // "immediate" | "recurring"
  cadence?: unknown;               // null for now
  active?: boolean;
  createdById?: string | null;
  nextRunAt?: Date | null;
}) {
  const rec = await db.scheduledReport.create({
    data: {
      tenantId: input.tenantId,
      name: input.name.trim(),
      format: input.format === "xlsx" ? "xlsx" : "csv",
      definition: (input.definition ?? {}) as any,
      recipients: (input.recipients ?? []) as any,
      mode: input.mode === "recurring" ? "recurring" : "immediate",
      cadence: (input.cadence ?? null) as any,
      active: input.active !== false,
      createdById: input.createdById ?? null,
      nextRunAt: input.nextRunAt ?? null,
    },
  });
  return { id: rec.id, name: rec.name, active: rec.active, createdAt: rec.createdAt.toISOString() };
}

// Create OR update a report (used by "Send now"): if `id` belongs to this tenant we
// update its definition/format/recipients/name in place (so re-saving a report
// started from a saved one doesn't fork a duplicate); otherwise we create. Returns
// the row id either way. mode stays "immediate" (recurring is a later batch).
export async function upsertScheduledReport(input: {
  tenantId: string;
  id?: string | null;
  name: string;
  format?: string;
  definition?: unknown;
  recipients?: unknown;
  createdById?: string | null;
}): Promise<{ id: string }> {
  const data: any = {
    name: (input.name || "").trim() || "Untitled report",
    format: input.format === "xlsx" ? "xlsx" : "csv",
    definition: (input.definition ?? {}) as any,
    recipients: (input.recipients ?? []) as any,
    mode: "immediate",
  };
  if (input.id) {
    const existing = await db.scheduledReport.findFirst({ where: { id: input.id, tenantId: input.tenantId } });
    if (existing) {
      const rec = await db.scheduledReport.update({ where: { id: existing.id }, data });
      return { id: rec.id };
    }
  }
  const rec = await db.scheduledReport.create({ data: { ...data, tenantId: input.tenantId, active: true, createdById: input.createdById ?? null } });
  return { id: rec.id };
}

// The full saved report (definition + recipients + format + name) for the form's
// "Start from a saved report" prefill. Scoped to the tenant.
export async function getScheduledReport(tenantId: string, id: string) {
  const r = await db.scheduledReport.findFirst({ where: { id, tenantId } });
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    format: r.format,
    mode: r.mode,
    active: r.active,
    definition: r.definition ?? { types: {} },
    recipients: Array.isArray(r.recipients) ? r.recipients : [],
    createdAt: r.createdAt.toISOString(),
  };
}
