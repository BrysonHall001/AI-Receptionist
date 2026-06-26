import { prisma } from "../db/client";
import { getPortal } from "./portalService";
import { computeNextRunAt } from "./reportSchedule";

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
  emailBody?: string | null;
  mode?: string;                 // "immediate" | "recurring"
  cadence?: unknown;             // recurrence spec (recurring only); null for immediate
  nextRunAt?: Date | null;       // first due instant (recurring only)
  createdById?: string | null;
}): Promise<{ id: string }> {
  const recurring = input.mode === "recurring";
  const data: any = {
    name: (input.name || "").trim() || "Untitled report",
    format: input.format === "xlsx" ? "xlsx" : "csv",
    definition: (input.definition ?? {}) as any,
    recipients: (input.recipients ?? []) as any,
    emailBody: input.emailBody != null ? String(input.emailBody) : null,
    mode: recurring ? "recurring" : "immediate",
    // Cadence/nextRunAt only carry meaning for recurring reports; clear them for
    // immediate ones so flipping a report back to "Send now" can't leave a stale slot.
    cadence: (recurring ? (input.cadence ?? null) : null) as any,
    nextRunAt: recurring ? (input.nextRunAt ?? null) : null,
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

// Toggle a recurring report's Active state. Reactivating a recurring report
// RECOMPUTES nextRunAt from `now` so it resumes at the next future slot instead of
// firing a backlog of missed runs; pausing leaves nextRunAt untouched (the sweep
// excludes inactive reports regardless). Scoped to the tenant.
export async function setReportActive(tenantId: string, id: string, active: boolean): Promise<{ id: string; active: boolean; nextRunAt: string | null } | null> {
  const r = await db.scheduledReport.findFirst({ where: { id, tenantId } });
  if (!r) return null;
  const data: any = { active };
  if (active && r.mode === "recurring" && r.cadence) {
    const portal = await getPortal(tenantId);
    const zone = (portal as any)?.timezone || "America/New_York";
    data.nextRunAt = computeNextRunAt(r.cadence, new Date(), zone);
  }
  const updated = await db.scheduledReport.update({ where: { id: r.id }, data });
  return { id: updated.id, active: updated.active, nextRunAt: updated.nextRunAt ? updated.nextRunAt.toISOString() : null };
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
    emailBody: r.emailBody ?? "",
    cadence: r.cadence ?? null,
    nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}
