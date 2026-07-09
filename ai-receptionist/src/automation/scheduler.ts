import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { ActionConfig, ActionContext, ActionResult, runAction } from "./actions";
import { loadFieldDefs, buildColumns, valueOf } from "./contactRow";
import { loadRecordFieldDefs, buildRecordColumns, recordValueOf } from "./recordRow";
import { evalRules } from "./conditions";
import { resolveRecordTypeId, BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { runGoogleCalendarSync } from "../services/googleSyncService";

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

// ===========================================================================
// APPOINTMENT REMINDER SWEEP (Batch 2)
// A "AppointmentReminder:<amount>:<unit>:before" trigger. Unlike the daily date
// sweep (contact date fields, day-granular), this is BOOKING-based and TIME-
// granular: it queues a reminder once the booking's appointment is within
// <amount> <unit> from now. Reuses enqueueJob + the same runner.
//
// WALL-CLOCK NOTE (honest limitation): appointmentAt is stored as a zoneless
// wall-clock value in the UTC slot, and there is no per-business timezone yet.
// dueAt = appointmentAt − offset is therefore measured in the UTC frame, so a
// business NOT operating in UTC will see the reminder shift by its UTC offset.
// Exact local-time reminders need the future per-business-timezone setting.
// ===========================================================================
interface ReminderTrigger { amount: number; unit: string; }
export function parseAppointmentReminderTrigger(triggerType: string): ReminderTrigger | null {
  if (!triggerType || triggerType.indexOf("AppointmentReminder:") !== 0) return null;
  const parts = triggerType.slice("AppointmentReminder:".length).split(":");
  const amount = Number(parts[0]);
  if (!isFinite(amount) || amount <= 0) return null;
  const unit = parts[1] || "hours";
  return { amount, unit };
}

export function reminderOffsetMs(amount: number, unit: string): number {
  const per = unit === "minutes" ? 60000 : unit === "days" ? 86400000 : 3600000; // default hours
  return amount * per;
}

const TERMINAL_BOOKING_STATUSES = new Set(["no_show", "completed", "canceled", "cancelled"]);

// Wall-clock formatter for the appointment (reads UTC-slot digits; NO timezone
// conversion), matching how the app stores/reads appointmentAt elsewhere.
// Exported so the event-driven path (engine.runRecordOne) renders {{appointment}}
// through this SAME formatter — one source of truth, no second time-formatter.
export function fmtApptWall(d: Date): string {
  return d.toLocaleString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Pre-render the booking-specific tokens into the action body at queue time (we
// know the booking now); contact tokens like {{name}} are left for run time.
export function injectBookingTokens(action: ActionConfig, booking: any): ActionConfig {
  const cfg: any = { ...(action.config || {}) };
  const appt = booking.appointmentAt ? new Date(booking.appointmentAt) : null;
  const apptStr = appt ? fmtApptWall(appt) : "";
  const subst = (s: string) => s
    .replace(/\{\{\s*appointment\s*\}\}/g, apptStr)
    .replace(/\{\{\s*appointment_time\s*\}\}/g, apptStr)
    .replace(/\{\{\s*service\s*\}\}/g, booking.subtypeKey || "")
    .replace(/\{\{\s*record_title\s*\}\}/g, booking.title || "");
  for (const k of ["body", "html", "subject", "text"]) {
    if (typeof cfg[k] === "string") cfg[k] = subst(cfg[k]);
  }
  return { ...action, config: cfg };
}

export async function runAppointmentReminderSweep(scope?: string): Promise<number> {
  const where: any = { enabled: true };
  if (scope) where.tenantId = scope;
  const autos = await db.automation.findMany({ where });
  const reminders = autos.filter((a: any) => parseAppointmentReminderTrigger(a.triggerType || ""));
  if (!reminders.length) return 0;

  const now = new Date();
  let swept = 0;

  // One booking-type lookup + one upcoming-bookings query per tenant.
  const byTenant: Record<string, any[]> = {};
  for (const a of reminders) { (byTenant[a.tenantId] = byTenant[a.tenantId] || []).push(a); }

  for (const tenantId of Object.keys(byTenant)) {
    const bookingTypeId = await resolveRecordTypeId(tenantId, BOOKING_RECORD_TYPE_KEY).catch(() => null);
    if (!bookingTypeId) continue;
    const bookings = await db.record.findMany({
      where: { tenantId, recordTypeId: bookingTypeId, deletedAt: null, appointmentAt: { gte: now } },
      take: 2000,
    });
    if (!bookings.length) continue;

    for (const auto of byTenant[tenantId]) {
      const parsed = parseAppointmentReminderTrigger(auto.triggerType)!;
      const off = reminderOffsetMs(parsed.amount, parsed.unit);
      const actions: ActionConfig[] = (auto.actions as any) || [];

      for (const b of bookings) {
        if (b.stageKey && TERMINAL_BOOKING_STATUSES.has(String(b.stageKey))) continue; // canceled/done/no-show
        const appt = new Date(b.appointmentAt);
        const dueAt = new Date(appt.getTime() - off);
        if (dueAt > now) continue;   // reminder window not reached yet
        if (appt <= now) continue;   // never remind at/after the appointment itself

        // The booking's first linked contact is who we text.
        const link = await db.recordLink.findFirst({ where: { tenantId, recordId: b.id, parentType: "contact", deletedAt: null }, orderBy: { createdAt: "asc" } });
        if (!link) continue;
        const contact = await db.contact.findFirst({ where: { id: link.parentId, tenantId, deletedAt: null } });
        if (!contact) continue;
        const contactName = contact.name || contact.phone || contact.email || contact.id;

        for (let i = 0; i < actions.length; i++) {
          if (actions[i].type === "wait") continue;
          // Stable dedupeKey per (automation, booking, action) → fires once.
          const row = await enqueueJob({
            tenantId, automationId: auto.id, automationName: auto.name,
            contactId: contact.id, contactName,
            action: injectBookingTokens(actions[i], b),
            dueAt, kind: "schedule",
            dedupeKey: `apptrem:${auto.id}:${b.id}:${i}`,
          });
          if (row) swept++;
        }
      }
    }
  }
  return swept;
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

// ===========================================================================
// RECORD DATE-REACHED SWEEP (Equipment service/warranty reminders, generic)
// A "RecordDateReached:<recordTypeKey>:<field>:<amount>:<unit>:<dir>" trigger —
// e.g. "RecordDateReached:equipment:next_service_due:7:days:before". Like the
// contact daily sweep it is day-granular and evaluated here (the instant engine
// needs no change), but the subject is a RECORD of the chosen type. When the
// record's chosen date field is due per the offset, we queue the flow's actions
// against the record's FIRST linked contact (who has an inbox, so Send email/SMS
// and Add note all work), with the record's own tokens ({{record_title}},
// {{next_service_due}}, {{status}}, …) pre-rendered at queue time. Idempotent per
// (automation, record, fire-date) so a record fires ONCE per due date, never
// again on later sweeps. Honors each flow's conditions against the record's
// fields (fail-closed on an unknown field, matching the event-driven record path).
// ===========================================================================
interface RecordDateTrigger { recordTypeKey: string; field: string; amount: number; unit: string; dir: string; }
export function parseRecordDateTrigger(triggerType: string): RecordDateTrigger | null {
  if (!triggerType || triggerType.indexOf("RecordDateReached:") !== 0) return null;
  const parts = triggerType.slice("RecordDateReached:".length).split(":");
  if (parts.length < 5) return null;
  const amount = Number(parts[2]);
  if (!isFinite(amount)) return null;
  return { recordTypeKey: parts[0], field: parts[1], amount, unit: parts[3] || "days", dir: parts[4] || "before" };
}

// Contact-owned tokens are LEFT for run time (resolved from the linked contact),
// so a record field must never clobber them even if a type reused the key.
const RESERVED_CONTACT_TOKENS = new Set(["name", "email", "phone", "first_name", "last_name"]);
// Pre-render RECORD tokens into the action at enqueue time (we know the record
// now): {{record_title}} + every one of the record's field values as {{<key>}}.
export function injectRecordTokens(action: ActionConfig, record: any, custom: any[]): ActionConfig {
  const cfg: any = { ...(action.config || {}) };
  const tokens: Record<string, string> = { record_title: record.title || "" };
  for (const f of custom || []) {
    if (RESERVED_CONTACT_TOKENS.has(f.key)) continue;
    const v = recordValueOf(record, f.key);
    tokens[f.key] = v == null ? "" : String(v);
  }
  const subst = (s: string) => s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) => (k in tokens ? tokens[k] : m));
  for (const k of ["body", "html", "subject", "text"]) {
    if (typeof cfg[k] === "string") cfg[k] = subst(cfg[k]);
  }
  return { ...action, config: cfg };
}

export async function runRecordDateSweep(scope?: string): Promise<number> {
  const where: any = { enabled: true };
  if (scope) where.tenantId = scope;
  const autos = await db.automation.findMany({ where });
  const flows = autos.filter((a: any) => parseRecordDateTrigger(a.triggerType || ""));
  if (!flows.length) return 0;
  const today = todayUtc();
  const floor = shiftDateString(today, -366, "days") || "0000-00-00"; // don't resurrect very old dates
  let swept = 0;

  for (const auto of flows) {
    const parsed = parseRecordDateTrigger(auto.triggerType)!;
    const recordTypeId = await resolveRecordTypeId(auto.tenantId, parsed.recordTypeKey).catch(() => null);
    if (!recordTypeId) continue;
    const custom = await loadRecordFieldDefs(auto.tenantId, recordTypeId);
    const cols = buildRecordColumns(custom);
    const knownKeys = new Set(cols.map((c: any) => c.key));
    const records = await db.record.findMany({ where: { tenantId: auto.tenantId, recordTypeId, deletedAt: null } as any, take: 5000 });
    const actions: ActionConfig[] = (auto.actions as any) || [];

    for (const rec of records) {
      const dateVal = recordValueOf(rec, parsed.field);
      const delta = parsed.dir === "after" ? parsed.amount : -parsed.amount;
      const fireDate = shiftDateString(dateVal, delta, parsed.unit);
      if (!fireDate) continue;
      if (fireDate > today) continue;   // not due yet
      if (fireDate < floor) continue;   // too old, ignore
      // Honor conditions against the record's own fields; fail closed on an
      // unknown field (never a silent pass), matching runRecordOne.
      const activeRules = ((auto.conditions as any[]) || []).filter((r: any) => r && r.field);
      if (activeRules.some((r: any) => !knownKeys.has(r.field))) continue;
      if (!evalRules(rec, (auto.conditions as any) || [], cols)) continue;
      // Message the record's FIRST linked contact (who has an inbox).
      const link = await db.recordLink.findFirst({ where: { tenantId: auto.tenantId, recordId: rec.id, parentType: "contact", deletedAt: null }, orderBy: { createdAt: "asc" } });
      if (!link) continue;
      const contact = await db.contact.findFirst({ where: { id: link.parentId, tenantId: auto.tenantId, deletedAt: null } });
      if (!contact) continue;
      const contactName = contact.name || contact.phone || contact.email || contact.id;
      for (let i = 0; i < actions.length; i++) {
        if (actions[i].type === "wait") continue;
        // Stable dedupeKey per (automation, record, fire-date, action) → fires ONCE.
        const row = await enqueueJob({
          tenantId: auto.tenantId, automationId: auto.id, automationName: auto.name,
          contactId: contact.id, contactName,
          action: injectRecordTokens(actions[i], rec, custom),
          dueAt: new Date(fireDate + "T00:00:00Z"), kind: "schedule",
          dedupeKey: `recdate:${auto.id}:${rec.id}:${fireDate}:${i}`,
        });
        if (row) swept++;
      }
    }
  }
  return swept;
}

// ===========================================================================
// STALE-CANDIDATE NUDGE (Stage 3c)
// A "Stalled:<days>" or "Stalled:<days>:<stageKey>" trigger. NOT an instant
// event — like Scheduled, it's evaluated by the sweep below (so the automation
// engine needs no change). The subject is the stalled CANDIDATE CONTACT, so the
// ordinary contact actions apply per candidate: create_note = (A) internal
// nudge, send_email/send_sms = (B) mock message. Per-candidate tokens
// {{name}} (contact), {{current_stage}}, {{days_in_stage}}, {{record_title}}.
// ===========================================================================
const STALL_SCAN_LIMIT = 5000;        // links scanned per automation (mirror existing sweep)
const STALL_MATCH_LIMIT = 500;        // candidates acted on per automation per sweep
const STALL_BULK_SEND_THRESHOLD = 25; // messaging fan-out gate (change this number to tune)

export interface StalledTrigger { days: number; stageKey: string | null; }

// "Stalled:7" -> {days:7, stageKey:null}; "Stalled:7:phone_screen" -> {days:7, stageKey:"phone_screen"}
export function parseStalledTrigger(triggerType: string): StalledTrigger | null {
  if (!triggerType || triggerType.indexOf("Stalled:") !== 0) return null;
  const parts = triggerType.slice("Stalled:".length).split(":");
  const days = Number(parts[0]);
  if (!isFinite(days) || days < 0) return null; // a bare "Stalled" (no N) never matches — by design
  return { days, stageKey: parts[1] ? parts[1] : null };
}

export interface StalledMatch { linkId: string; parentId: string; stageKey: string | null; recordId: string; enteredAt: Date; daysInStage: number; }

// Find active, staged, contact-parent links whose CURRENT stage was entered
// >= N days ago WITH NO MOVEMENT SINCE. The newest StageHistory row for a link
// is when they entered their current stage; any later move adds a newer row and
// resets the clock, so "newest enteredAt <= now - N days" == stalled. Strictly
// tenant-scoped. Read-only: this writes nothing.
export async function findStalledLinks(tenantId: string, days: number, stageKey?: string | null): Promise<StalledMatch[]> {
  const cutoff = new Date(Date.now() - days * 86400000);
  const where: any = { tenantId, deletedAt: null, parentType: "contact" };
  where.stageKey = stageKey ? stageKey : { not: null };
  const links = await db.recordLink.findMany({ where, take: STALL_SCAN_LIMIT });
  if (!links.length) return [];
  const linkIds = links.map((l: any) => l.id);
  // Newest entry time per link in ONE grouped query (tenant-scoped).
  const grouped = await db.stageHistory.groupBy({ by: ["recordLinkId"], where: { tenantId, recordLinkId: { in: linkIds } }, _max: { enteredAt: true } });
  const newest = new Map<string, Date>();
  for (const g of grouped) if (g._max?.enteredAt) newest.set(g.recordLinkId, g._max.enteredAt as Date);
  const out: StalledMatch[] = [];
  for (const l of links) {
    const entered = newest.get(l.id);
    if (!entered) continue;                 // no history -> cannot judge -> not matched (never a silent action)
    if (new Date(entered) > cutoff) continue; // moved more recently than N days -> clock not elapsed
    const daysInStage = Math.floor((Date.now() - new Date(entered).getTime()) / 86400000);
    out.push({ linkId: l.id, parentId: l.parentId, stageKey: l.stageKey ?? null, recordId: l.recordId, enteredAt: new Date(entered), daysInStage });
    if (out.length >= STALL_MATCH_LIMIT) break;
  }
  return out;
}

// Run every enabled "Stalled:" automation for a scope (one portal, or all).
export async function runStalledSweep(scope?: string): Promise<{ automations: number; matched: number; acted: number; blocked: number }> {
  const where: any = { enabled: true };
  if (scope) where.tenantId = scope;
  const autos = await db.automation.findMany({ where });
  let automations = 0, matched = 0, acted = 0, blocked = 0;
  for (const auto of autos) {
    const parsed = parseStalledTrigger(auto.triggerType || "");
    if (!parsed) continue;
    automations++;
    const r = await runStalledForAutomation(auto, parsed);
    matched += r.matched; acted += r.acted; if (r.blocked) blocked++;
  }
  return { automations, matched, acted, blocked };
}

async function runStalledForAutomation(auto: any, parsed: StalledTrigger): Promise<{ matched: number; acted: number; blocked: boolean }> {
  const tenantId = auto.tenantId;
  const stalled = await findStalledLinks(tenantId, parsed.days, parsed.stageKey);
  const actions: ActionConfig[] = (auto.actions as ActionConfig[]) || [];

  // ANTI-SILENT-GREEN (zero matches): log a clear neutral run, never a fake green.
  if (!stalled.length) {
    await writeStalledRun(auto, "skipped", false, [{ type: "(stalled-sweep)", status: "skipped", detail: "No stalled candidates" }]);
    return { matched: 0, acted: 0, blocked: false };
  }

  // SEND-GATE (B): a sweep can match many candidates, so messaging is fan-out.
  // If matches exceed the threshold and not EVERY messaging action carries the
  // explicit allowBulk ack, block messaging (recorded once as FAILED) — notes
  // (A) still run. The gate counts intended recipients regardless of mock/real.
  const messagingActions = actions.filter((a) => a.type === "send_email" || a.type === "send_sms");
  const over = stalled.length > STALL_BULK_SEND_THRESHOLD;
  const messagingBlocked = messagingActions.length > 0 && over && !messagingActions.every((a) => a.config && (a.config as any).allowBulk === true);

  const portal = await db.tenant.findUnique({ where: { id: tenantId } });
  const fieldDefs = await loadFieldDefs(tenantId);
  const results: ActionResult[] = [];
  if (messagingBlocked) {
    results.push({ type: "send_message", status: "failed", error: `Would message ${stalled.length} stalled candidates; bulk send not allowed. Turn on "Allow bulk send" on the message action to permit more than ${STALL_BULK_SEND_THRESHOLD}.` });
  }

  let acted = 0, failed = 0, noteOk = 0, msgOk = 0;
  for (const s of stalled) {
    const contact = await db.contact.findUnique({ where: { id: s.parentId } });
    if (!contact || contact.tenantId !== tenantId || contact.deletedAt) { failed++; continue; } // tenant + soft-delete guard
    const extraTokens: Record<string, string> = { current_stage: s.stageKey ?? "", days_in_stage: String(s.daysInStage), record_title: "" };
    try { const rec = await db.record.findFirst({ where: { id: s.recordId, tenantId } }); if (rec?.title) extraTokens.record_title = String(rec.title); } catch { /* title is best-effort */ }
    const ctx: ActionContext = {
      tenantId, contactId: contact.id, fieldDefs,
      actor: { type: "automation", id: auto.id, name: auto.name },
      portal: { phoneNumber: portal?.phoneNumber, notifyEmail: portal?.notifyEmail, name: portal?.name },
      workingSet: [], triggerType: "Stalled", extraTokens,
    };
    for (const action of actions) {
      const isMessaging = action.type === "send_email" || action.type === "send_sms";
      if (isMessaging && messagingBlocked) continue; // blocked; recorded once above
      const r = await runAction(action, ctx);
      if (r.status === "failed") failed++;
      else if (r.status === "success") { acted++; if (isMessaging) msgOk++; else noteOk++; }
    }
  }
  results.push({ type: "(stalled-sweep)", status: "success", detail: `stalled: ${stalled.length} | actions applied: ${noteOk} | messages (mock): ${msgOk}${failed ? ` | ${failed} failed` : ""}${messagingBlocked ? " | messaging BLOCKED (bulk gate)" : ""}` });
  const status = (messagingBlocked || failed > 0) ? "failed" : "success";
  await writeStalledRun(auto, status, true, results);
  return { matched: stalled.length, acted, blocked: messagingBlocked };
}

async function writeStalledRun(auto: any, status: string, matched: boolean, results: ActionResult[]): Promise<void> {
  try {
    await db.automationRun.create({ data: { tenantId: auto.tenantId, automationId: auto.id, eventType: "Stalled", contactId: null, status, matched, results: results as any } });
  } catch (e) { logger.error(`[stalled] run-log write failed (${auto.id}): ${(e as Error).message}`); }
}

// ---------------------------------------------------------------------------
// Process due jobs. Runs the sweep first, then executes every pending job whose
// dueAt has passed. Each job is "claimed" (pending -> running) with a conditional
// update so it can never be executed twice, even on repeated clicks.
// scope = a tenantId (process one CRM) or undefined (all CRMs — for the host).
// ---------------------------------------------------------------------------
export async function processDueJobs(scope?: string): Promise<{ swept: number; ran: number; failed: number; stalledMatched: number; stalledActed: number; stalledBlocked: number }> {
  const swept = await runDailySweep(scope);
  const reminded = await runAppointmentReminderSweep(scope); // Batch 2: appointment reminders
  const recDated = await runRecordDateSweep(scope); // record date-field due (e.g. equipment service/warranty)
  const stalled = await runStalledSweep(scope); // Stage 3c: time-in-stage nudges
  // Google Calendar READ-IN sync (Sub-batch D): flag-gated per tenant, OFF by
  // default. Self-contained + never throws, but wrap defensively so a sync hiccup
  // can never break the rest of the tick.
  try { await runGoogleCalendarSync(scope); } catch (e) { logger.error(`[google-sync] sweep error: ${(e as Error).message}`); }
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
  logger.info(`[scheduler] processed (scope=${scope || "all"}): swept ${swept + reminded + recDated}, ran ${ran}, failed ${failed}; stalled[matched ${stalled.matched}, acted ${stalled.acted}, blocked ${stalled.blocked}]`);
  return { swept: swept + reminded + recDated, ran, failed, stalledMatched: stalled.matched, stalledActed: stalled.acted, stalledBlocked: stalled.blocked };
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
