import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { ActionConfig, ActionContext, runAction } from "./actions";
import { loadFieldDefs, buildColumns, valueOf } from "./contactRow";
import { evalRules } from "./conditions";

const db = prisma as any;

// ---------------------------------------------------------------------------
// Plain-English description of a queued action (no date — the UI appends the
// "scheduled for <due>" part from dueAt so it survives across statuses).
// ---------------------------------------------------------------------------
export function describeAction(action: ActionConfig, contactName?: string | null): string {
  const cfg = action.config || {};
  const who = contactName ? ` for ${contactName}` : "";
  switch (action.type) {
    case "send_email": return `Send email${cfg.subject ? ` “${cfg.subject}”` : ""}${who}`;
    case "send_sms": return `Send SMS${who}`;
    case "add_tag": return `Add tag ${cfg.value ?? ""}${who}`;
    case "remove_tag": return `Remove tag ${cfg.value ?? ""}${who}`;
    case "update_field": return `Update field ${cfg.field ?? ""}${who}`;
    case "compute_field": return `Compute ${cfg.dest ?? "field"}${who}`;
    case "create_note": return `Create note${who}`;
    case "assign_owner": return `Assign owner${who}`;
    case "create_record": return `Create a record`;
    case "update_record": return `Update record(s)`;
    case "find_records":
    case "search_records": return `Find records`;
    case "delete_record": return `Delete record(s) (to recycle bin)`;
    default: return `${action.type}${who}`;
  }
}

// ---------------------------------------------------------------------------
// Enqueue one job. Returns the row, or null if a duplicate (same tenant +
// dedupeKey) already exists — this is how the daily sweep stays idempotent.
// ---------------------------------------------------------------------------
export async function enqueueJob(input: {
  tenantId: string;
  automationId?: string | null;
  automationName?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  action: ActionConfig;
  dueAt: Date;
  kind: "delay" | "schedule";
  dedupeKey?: string | null;
}) {
  try {
    return await db.scheduledJob.create({
      data: {
        tenantId: input.tenantId,
        automationId: input.automationId ?? null,
        automationName: input.automationName ?? null,
        contactId: input.contactId ?? null,
        contactName: input.contactName ?? null,
        action: input.action as any,
        description: describeAction(input.action, input.contactName),
        kind: input.kind,
        dueAt: input.dueAt,
        status: "pending",
        dedupeKey: input.dedupeKey ?? null,
      },
    });
  } catch (e) {
    // Unique violation on (tenantId, dedupeKey) => already queued. Skip quietly.
    if (String((e as Error).message).includes("Unique") || (e as any)?.code === "P2002") return null;
    throw e;
  }
}

// Build the same ActionContext the instant engine uses, so queued actions run
// through identical code (mock mode, validation, loop guard via actor=automation).
async function buildJobContext(job: any): Promise<ActionContext | null> {
  if (!job.contactId) return null;
  const contact = await prisma.contact.findUnique({ where: { id: job.contactId } });
  if (!contact || contact.tenantId !== job.tenantId) return null;
  const fieldDefs = await loadFieldDefs(job.tenantId);
  const portal = await prisma.tenant.findUnique({ where: { id: job.tenantId } });
  return {
    tenantId: job.tenantId,
    contactId: job.contactId,
    fieldDefs,
    actor: { type: "automation", id: job.automationId, name: job.automationName },
    portal: { phoneNumber: portal?.phoneNumber, notifyEmail: portal?.notifyEmail, name: portal?.name },
    workingSet: [],
    triggerType: job.kind === "schedule" ? "Scheduled" : "Delayed",
  };
}

// ---- date helpers (UTC, "YYYY-MM-DD"), matching the rest of the app ----
function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function shiftDateString(dateStr: any, amount: number, unit: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? "").trim());
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(dt.getTime())) return null;
  if (unit === "weeks") dt.setUTCDate(dt.getUTCDate() + amount * 7);
  else if (unit === "months") dt.setUTCMonth(dt.getUTCMonth() + amount);
  else if (unit === "years") dt.setUTCFullYear(dt.getUTCFullYear() + amount);
  else dt.setUTCDate(dt.getUTCDate() + amount);
  return dt.toISOString().slice(0, 10);
}

interface ScheduleTrigger { field: string; amount: number; unit: string; dir: string; }
// "Scheduled:<field>:<amount>:<unit>:<dir>" -> parts (no migration: encoded in
// triggerType, exactly like the session-2 "FieldChanged:<key>" convention).
export function parseScheduleTrigger(triggerType: string): ScheduleTrigger | null {
  if (!triggerType || triggerType.indexOf("Scheduled:") !== 0) return null;
  const parts = triggerType.slice("Scheduled:".length).split(":");
  if (parts.length < 4) return null;
  const amount = Number(parts[1]);
  if (!isFinite(amount)) return null;
  return { field: parts[0], amount, unit: parts[2] || "days", dir: parts[3] || "before" };
}

// ---------------------------------------------------------------------------
// Daily sweep: for each enabled "Scheduled:" flow, find records whose computed
// fire-date is due (<= today) and queue the flow's actions. Idempotent via
// dedupeKey. Honors each flow's conditions before queuing.
// ---------------------------------------------------------------------------
export async function runDailySweep(scope?: string): Promise<number> {
  const where: any = { enabled: true };
  if (scope) where.tenantId = scope;
  const autos = await db.automation.findMany({ where });
  const today = todayUtc();
  const floor = shiftDateString(today, -366, "days") || "0000-00-00"; // don't resurrect very old dates
  let swept = 0;

  for (const auto of autos) {
    const parsed = parseScheduleTrigger(auto.triggerType || "");
    if (!parsed) continue;
    const fieldDefs = await loadFieldDefs(auto.tenantId);
    const columns = buildColumns(fieldDefs);
    const contacts = await db.contact.findMany({ where: { tenantId: auto.tenantId, deletedAt: null } as any, take: 5000 });

    for (const c of contacts) {
      const dateVal = valueOf(c, parsed.field);
      const delta = parsed.dir === "after" ? parsed.amount : -parsed.amount;
      const fireDate = shiftDateString(dateVal, delta, parsed.unit);
      if (!fireDate) continue;
      if (fireDate > today) continue;   // not due yet
      if (fireDate < floor) continue;   // too old, ignore
      if (!evalRules(c, (auto.conditions as any) || [], columns)) continue; // honor conditions

      const contactName = c.name || c.phone || c.email || c.id;
      const actions: ActionConfig[] = (auto.actions as any) || [];
      for (let i = 0; i < actions.length; i++) {
        if (actions[i].type === "wait") continue;
        const row = await enqueueJob({
          tenantId: auto.tenantId,
          automationId: auto.id,
          automationName: auto.name,
          contactId: c.id,
          contactName,
          action: actions[i],
          dueAt: new Date(fireDate + "T00:00:00Z"),
          kind: "schedule",
          dedupeKey: `${auto.id}:${c.id}:${fireDate}:${i}`,
        });
        if (row) swept++;
      }
    }
  }
  return swept;
}

// ---------------------------------------------------------------------------
// Process due jobs. Runs the sweep first, then executes every pending job whose
// dueAt has passed. Each job is "claimed" (pending -> running) with a conditional
// update so it can never be executed twice, even on repeated clicks.
// scope = a tenantId (process one CRM) or undefined (all CRMs — for the host).
// ---------------------------------------------------------------------------
export async function processDueJobs(scope?: string): Promise<{ swept: number; ran: number; failed: number }> {
  const swept = await runDailySweep(scope);
  const now = new Date();
  const where: any = { status: "pending", dueAt: { lte: now } };
  if (scope) where.tenantId = scope;
  const due = await db.scheduledJob.findMany({ where, orderBy: { dueAt: "asc" }, take: 500 });

  let ran = 0, failed = 0;
  for (const job of due) {
    // Atomic claim: only the caller that flips pending->running proceeds.
    const claim = await db.scheduledJob.updateMany({ where: { id: job.id, status: "pending" }, data: { status: "running" } });
    if (claim.count !== 1) continue; // already taken
    try {
      const ctx = await buildJobContext(job);
      if (!ctx) { await markFailed(job.id, "Contact or tenant no longer available"); failed++; continue; }
      const result = await runAction(job.action as ActionConfig, ctx);
      if (result.status === "failed") { await markFailed(job.id, result.error || "Action failed"); failed++; }
      else { await db.scheduledJob.update({ where: { id: job.id }, data: { status: "done", error: null } }); ran++; }
    } catch (e) {
      await markFailed(job.id, (e as Error).message);
      failed++;
    }
  }
  logger.info(`[scheduler] processed jobs (scope=${scope || "all"}): swept ${swept}, ran ${ran}, failed ${failed}`);
  return { swept, ran, failed };
}

async function markFailed(id: string, error: string) {
  try { await db.scheduledJob.update({ where: { id }, data: { status: "failed", error: String(error).slice(0, 1000) } }); }
  catch (e) { logger.error(`[scheduler] could not mark job ${id} failed: ${(e as Error).message}`); }
}

// ---- listing + cancel (tenant-scoped) ----
export async function listScheduledJobs(tenantId: string) {
  const rows = await db.scheduledJob.findMany({ where: { tenantId }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 500 });
  return rows.map((j: any) => ({
    id: j.id,
    description: j.description,
    kind: j.kind,
    dueAt: j.dueAt instanceof Date ? j.dueAt.toISOString() : j.dueAt,
    status: j.status === "running" ? "pending" : j.status, // running is a momentary internal state
    error: j.error ?? null,
    automationName: j.automationName ?? null,
    contactName: j.contactName ?? null,
    createdAt: j.createdAt instanceof Date ? j.createdAt.toISOString() : j.createdAt,
  }));
}

export async function cancelScheduledJob(id: string, tenantId: string): Promise<boolean> {
  const job = await db.scheduledJob.findUnique({ where: { id } });
  if (!job || job.tenantId !== tenantId) return false;
  if (job.status !== "pending") return false; // only pending jobs can be canceled
  await db.scheduledJob.update({ where: { id }, data: { status: "canceled" } });
  return true;
}
