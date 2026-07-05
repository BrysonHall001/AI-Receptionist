import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { subscribe } from "../events/bus";
import { DomainEvent, EventActor } from "../events/types";
import { evalRules, ruleComplete, Rule } from "./conditions";
import { buildColumns, loadFieldDefs } from "./contactRow";
import { loadRecordFieldDefs, buildRecordColumns, attachResourceNames } from "./recordRow";
import { ActionConfig, ActionContext, ActionResult, runAction } from "./actions";
import { enqueueJob, fmtApptWall } from "./scheduler";
import { resolveAudienceContacts } from "../services/audienceService";

const db = prisma as any;

// Loop-safety backstop (Batch A step 1). A cascade of automation-caused events
// may go at most this many hops deep before the engine refuses to continue.
// This is a SECOND net, independent of the actor guard: even if some future
// event isn't correctly stamped "automation", an unbounded cascade still can't
// form. Change this one number to retune. Exported so the self-test references
// the real value (no drift).
export const MAX_CHAIN_DEPTH = 5;

interface AutomationRow {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  triggerType: string;
  conditions: Rule[];
  actions: ActionConfig[];
}

/**
 * Core handler. Invoked by the bus for every event (asynchronously, off the
 * request path). It is the ONLY place that knows about both events and
 * automations — emitters never reference it, keeping the two systems decoupled.
 */
export async function handleEvent(event: DomainEvent): Promise<void> {
  // Loop guard (MVP): we record automation-sourced events for observability but
  // never let them re-trigger automations. Multi-step chaining can be enabled
  // later by replacing this with a depth/visited-set guard carried on the event.
  if (event.actor.type === "automation") return;

  // Stage 2a: subject-aware dispatch. The contact path below is intentionally
  // UNCHANGED. A non-contact subject (e.g. a record/job) is handled by a
  // separate runner so existing contact automations behave exactly as before.
  const subjectType = event.subject?.type || "contact";
  if (subjectType !== "contact") {
    await handleRecordEvent(event);
    return;
  }

  const contactId = event.subject?.id;
  if (!contactId) return; // contact-centric MVP

  // Which trigger types should this event fire? Always the event's own type.
  // For a field change, ALSO fire flows scoped to that specific field, stored as
  // "FieldChanged:<fieldKey>" (no schema change — triggerType is just a string).
  const triggerTypes: string[] = [event.type];
  if (event.type === "FieldChanged" && event.payload && event.payload.field) {
    triggerTypes.push("FieldChanged:" + event.payload.field);
  }
  // Receptionist scope: a brand-new contact created by the AI from a phone call
  // (source === "phone") ALSO fires "New call lead" automations. This is purely
  // additive — "Contact created" still fires for every new contact (including
  // phone); CallLeadCreated is the narrower, phone-only trigger. Repeat callers
  // fire ContactUpdated (not ContactCreated), so they never match here.
  if (event.type === "ContactCreated" && event.payload && event.payload.source === "phone") {
    triggerTypes.push("CallLeadCreated");
  }
  // Same convention for stage changes: a flow scoped to a specific destination
  // stage is stored as "StageChanged:<stageKey>" and fires only when the NEW
  // stage matches. Plain "StageChanged" fires on any stage change.
  if (event.type === "StageChanged" && event.payload && event.payload.new_stage) {
    triggerTypes.push("StageChanged:" + event.payload.new_stage);
  }

  const automations: AutomationRow[] = await db.automation.findMany({
    where: { tenantId: event.tenantId, triggerType: { in: triggerTypes }, enabled: true },
  });
  if (!automations.length) return;

  // DEPTH BACKSTOP: refuse (visibly) once a cascade is too deep. Never silent.
  const depth = event.chainDepth ?? 0;
  if (depth > MAX_CHAIN_DEPTH) { await refuseForDepth(automations, event, depth); return; }

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.tenantId !== event.tenantId) return;

  const fieldDefs = await loadFieldDefs(event.tenantId);
  const columns = buildColumns(fieldDefs);
  const portal = await prisma.tenant.findUnique({ where: { id: event.tenantId } });

  for (const auto of automations) {
    await runOne(auto, event, contact, fieldDefs, columns, portal, event.id);
  }
}

// ===================== RECORD-SUBJECT PATH (Stage 2a) =====================
// Parallel to handleEvent's contact path. The subject is a RECORD (e.g. a job),
// loaded from the record table — never the contact loader. Only actions that
// make sense on a record are allowed; anything else is logged as a clear FAILED
// result (never a silent green no-op).
const RECORD_SUBJECT_ACTIONS = new Set(["create_note", "act_on_linked", "move_to_stage", "set_record_field", "create_record_item", "update_record_item", "find_record_items", "delete_record_items"]);

async function handleRecordEvent(event: DomainEvent): Promise<void> {
  const recordId = event.subject?.id || null;

  // Trigger matching mirrors the FieldChanged convention: base type, plus a
  // per-changed-field variant, plus a field=value variant (e.g.
  // "RecordUpdated:status" and "RecordUpdated:status=filled").
  const triggerTypes: string[] = [event.type];
  const changes: any[] = Array.isArray(event.payload?.changes) ? event.payload.changes : [];
  for (const ch of changes) {
    if (ch && ch.field) {
      triggerTypes.push(event.type + ":" + ch.field);
      const nv = ch.new;
      if (nv != null && typeof nv !== "object" && String(nv) !== "") {
        triggerTypes.push(event.type + ":" + ch.field + "=" + String(nv));
      }
    }
  }

  const automations: AutomationRow[] = await db.automation.findMany({
    where: { tenantId: event.tenantId, triggerType: { in: triggerTypes }, enabled: true },
  });
  if (!automations.length) return;

  // DEPTH BACKSTOP (record path): same ceiling as the contact path.
  const depth = event.chainDepth ?? 0;
  if (depth > MAX_CHAIN_DEPTH) { await refuseForDepth(automations, event, depth); return; }

  const portal = await prisma.tenant.findUnique({ where: { id: event.tenantId } });

  // Load the record subject from the RECORD table (tenant-scoped, active only).
  const record = recordId
    ? await db.record.findFirst({ where: { id: recordId, tenantId: event.tenantId, deletedAt: null } })
    : null;

  for (const auto of automations) {
    if (!record) {
      // ANTI-SILENT-GREEN #1: we matched an automation but the record subject is
      // missing / deleted / from another portal. Log a clear FAILED run with a
      // reason — never a green run that did nothing.
      await writeRun(auto, {
        eventId: event.id,
        eventType: event.type,
        contactId: null,
        status: "failed",
        matched: true,
        results: [{ type: "(subject)", status: "failed", error: `Record subject ${recordId || "(none)"} could not be loaded (missing, deleted, or another portal).` }],
        error: "Record subject could not be loaded",
      });
      continue;
    }
    await runRecordOne(auto, event, record, portal);
  }
}

async function runRecordOne(auto: AutomationRow, event: DomainEvent, record: any, portal: any): Promise<void> {
  // Relabel-safe template tokens from the payload. With multiple simultaneous
  // changes, {{changed_field}}/{{new_value}}/{{old_value}} reflect the FIRST
  // change (status changes are typically saved on their own).
  const p: any = event.payload || {};
  const firstChange = Array.isArray(p.changes) && p.changes.length ? p.changes[0] : null;
  const extraTokens: Record<string, string> = {};
  if (p.record_title != null) extraTokens.record_title = String(p.record_title);
  if (p.record_type != null) extraTokens.record_type = String(p.record_type);
  // {{appointment}} in the EVENT-DRIVEN path (e.g. booking confirmation / no-show).
  // Source the time from the record we already loaded above — no payload change,
  // no extra query — and format it through the SAME wall-clock formatter the
  // time-based reminder uses (fmtApptWall: reads the UTC-slot digits verbatim, NO
  // timezone conversion). Only set when a real appointment exists, so a booking
  // with no time — or a non-booking record — renders BLANK, never "Invalid Date".
  if (record.appointmentAt) extraTokens.appointment = fmtApptWall(new Date(record.appointmentAt));
  if (firstChange) {
    if (firstChange.label != null) extraTokens.changed_field = String(firstChange.label);
    if (firstChange.new != null) extraTokens.new_value = String(firstChange.new);
    if (firstChange.old != null) extraTokens.old_value = String(firstChange.old);
  }

  // Stage 3 (Batch A): conditions now evaluate against the RECORD's own fields
  // (Status, Title, Type, record custom fields) — loaded ONLY for this record's
  // type, so contact fields never leak in. UNKNOWN-FIELD SAFETY: if a condition
  // references a field this record doesn't have, we FAIL CLOSED (do not fire) —
  // never a silent pass that could run an automation on a condition it can't
  // actually evaluate. The contact path (runOne) is untouched and still uses the
  // contact loader.
  const recCustom = await loadRecordFieldDefs(auto.tenantId, record.recordTypeId);
  // Resolve the assigned staff name onto the record so a "resource" condition reads
  // the name (not the raw id). No-op for records without a resource.
  await attachResourceNames(auto.tenantId, [record]);
  const recCols = buildRecordColumns(recCustom);
  const activeRules = ((auto.conditions as Rule[]) || []).filter(ruleComplete);
  const knownKeys = new Set(recCols.map((c) => c.key));
  const unknownField = activeRules.some((r) => !knownKeys.has(r.field));
  const matched = !unknownField && evalRules(record, (auto.conditions as Rule[]) || [], recCols);
  if (!matched) {
    await writeRun(auto, {
      eventId: event.id, eventType: event.type, contactId: null,
      status: "skipped", matched: false,
      results: unknownField ? [{ type: "(conditions)", status: "skipped", detail: "A condition references a field this record doesn't have — not run (safe default)." }] : [],
    });
    return;
  }

  const actor: EventActor = { type: "automation", id: auto.id, name: auto.name };
  const ctx: ActionContext = {
    tenantId: auto.tenantId,
    contactId: "", // no contact subject; record actions use recordId/subjectType
    fieldDefs: [],
    actor,
    portal: { phoneNumber: portal?.phoneNumber, notifyEmail: portal?.notifyEmail, name: portal?.name },
    workingSet: [],
    triggerType: event.type,
    extraTokens,
    subjectType: "record",
    recordId: record.id,
    recordTitle: record.title ?? null,
    chainDepth: (event.chainDepth ?? 0) + 1, // loop-safety: writes from this run go one hop deeper
  };

  const results: ActionResult[] = [];
  for (const action of (auto.actions as ActionConfig[]) || []) {
    if (!RECORD_SUBJECT_ACTIONS.has(action.type)) {
      // ANTI-SILENT-GREEN #2: an action that can't target a record (e.g. Send
      // email/SMS — a record has no inbox) is BLOCKED with a clear reason, so it
      // can never silently "send to nothing". (Delays/other actions land here
      // too in this stage.)
      results.push({ type: action.type, status: "failed", error: `Action "${action.type}" can't target a record in this stage. Only "Create internal note" is supported.` });
      continue;
    }
    results.push(await runAction(action, ctx));
  }
  const status = results.some((r) => r.status === "failed") ? "failed" : "success";
  await writeRun(auto, { eventId: event.id, eventType: event.type, contactId: null, status, matched: true, results });
}

async function runOne(
  auto: AutomationRow,
  event: DomainEvent,
  contact: any,
  fieldDefs: any[],
  columns: any[],
  portal: any,
  eventId: string | null,
): Promise<void> {
  const matched = evalRules(contact, (auto.conditions as Rule[]) || [], columns);

  if (!matched) {
    await writeRun(auto, { eventId, eventType: event.type, contactId: contact.id, status: "skipped", matched: false, results: [] });
    return;
  }

  const actor: EventActor = { type: "automation", id: auto.id, name: auto.name };
  // Generic, relabel-safe template tokens drawn from the event payload (today:
  // StageChanged). For any other event these stay empty, so behavior is
  // unchanged. Token names avoid hardcoding "job" — {{record_title}} is the
  // parent record's title (the job), {{new_stage}}/{{old_stage}} the stages.
  const p: any = event.payload || {};
  const extraTokens: Record<string, string> = {};
  if (p.new_stage != null) extraTokens.new_stage = String(p.new_stage);
  if (p.old_stage != null) extraTokens.old_stage = String(p.old_stage);
  if (p.record_title != null) extraTokens.record_title = String(p.record_title);
  if (p.record_type != null) extraTokens.record_type = String(p.record_type);
  const ctx: ActionContext = {
    tenantId: auto.tenantId,
    contactId: contact.id,
    fieldDefs,
    actor,
    portal: { phoneNumber: portal?.phoneNumber, notifyEmail: portal?.notifyEmail, name: portal?.name },
    workingSet: [],
    triggerType: event.type,
    extraTokens,
    // Loop-safety: a write caused by THIS run should stamp its event one hop
    // deeper. No current action uses this; the stage-writing action (Step 2) will.
    chainDepth: (event.chainDepth ?? 0) + 1,
  };

  const results: ActionResult[] = [];
  const actionList = (auto.actions as ActionConfig[]) || [];
  const waitIdx = actionList.findIndex((a) => a.type === "wait");

  if (waitIdx === -1) {
    // No delay: run everything inline, exactly as before.
    for (const action of actionList) {
      results.push(await runAction(action, ctx));
    }
  } else {
    // Run actions before the FIRST Wait now; queue everything after it. A LINEAR drip can have
    // MULTIPLE waits (wait → email → wait → survey): we walk the tail accumulating each wait's
    // delay into a running dueAt, and enqueue each non-wait action at ITS cumulative due time. So
    // later waits are honored (previously any wait after the first was dropped, collapsing the
    // whole tail onto the first wait's time). Each queued job is a single action the scheduler
    // runs at its dueAt; waits are consumed here, never queued.
    for (let i = 0; i < waitIdx; i++) {
      results.push(await runAction(actionList[i], ctx));
    }
    const contactName = contact.name || contact.phone || contact.email || contact.id;
    let running: Date | null = null;
    let queued = 0;
    let lastDue: Date | null = null;
    for (let i = waitIdx; i < actionList.length; i++) {
      const a = actionList[i];
      if (a.type === "wait") {
        running = running ? addDelay(running, a.config || {}) : delayDueAt(a.config || {});
        continue;
      }
      // A non-wait after at least one wait -> queue at the current cumulative due time.
      const dueAt = running || new Date();
      lastDue = dueAt;
      await enqueueJob({
        tenantId: auto.tenantId,
        automationId: auto.id,
        automationName: auto.name,
        contactId: contact.id,
        contactName,
        action: a,
        dueAt,
        kind: "delay",
      });
      queued++;
      results.push({ type: a.type, status: "skipped", detail: `scheduled for ${dueAt.toISOString()}` });
    }
    results.push({ type: "wait", status: "success", detail: `deferred ${queued} action(s)${lastDue ? ` (last at ${lastDue.toISOString()})` : ""}` });
  }

  const status = results.some((r) => r.status === "failed") ? "failed" : "success";
  await writeRun(auto, { eventId, eventType: event.type, contactId: contact.id, status, matched: true, results });
}

// now + amount * (minutes|hours|days). Defaults to minutes.
function delayDueAt(cfg: Record<string, any>): Date {
  const amount = Number(cfg.amount) || 0;
  const unit = cfg.unit;
  const ms = unit === "hours" ? 3_600_000 : unit === "days" ? 86_400_000 : 60_000;
  return new Date(Date.now() + amount * ms);
}

// base + amount * unit — used to accumulate a SECOND (or later) wait onto the running due time so
// a linear drip's steps land at the right absolute moments.
function addDelay(base: Date, cfg: Record<string, any>): Date {
  const amount = Number(cfg.amount) || 0;
  const unit = cfg.unit;
  const ms = unit === "hours" ? 3_600_000 : unit === "days" ? 86_400_000 : 60_000;
  return new Date(base.getTime() + amount * ms);
}

// Visibly refuse a too-deep cascade: log a clear line AND write a FAILED run for
// each automation that would have fired, so the stop shows up in the Execution
// log (never a silent halt, never a crash).
async function refuseForDepth(automations: AutomationRow[], event: DomainEvent, depth: number): Promise<void> {
  logger.warn(`[engine] automation chain depth limit reached (depth ${depth} > ${MAX_CHAIN_DEPTH}); refusing event ${event.type} for tenant ${event.tenantId}`);
  const contactId = event.subject?.type === "contact" ? (event.subject?.id ?? null) : null;
  for (const auto of automations) {
    await writeRun(auto, {
      eventId: event.id,
      eventType: event.type,
      contactId,
      status: "failed",
      matched: true,
      results: [{ type: "(loop-guard)", status: "failed", error: `Automation chain depth limit reached (depth ${depth} > ${MAX_CHAIN_DEPTH}). Refused to run to prevent a runaway loop.` }],
      error: "chain depth limit reached",
    });
  }
}

async function writeRun(
  auto: AutomationRow,
  data: { eventId: string | null; eventType: string; contactId: string | null; status: string; matched: boolean; results: ActionResult[]; error?: string },
): Promise<void> {
  try {
    await db.automationRun.create({
      data: {
        tenantId: auto.tenantId,
        automationId: auto.id,
        eventId: data.eventId,
        eventType: data.eventType,
        contactId: data.contactId,
        status: data.status,
        matched: data.matched,
        results: data.results as any,
        error: data.error ?? null,
      },
    });
  } catch (err) {
    logger.error(`automation run log failed (${auto.id}): ${(err as Error).message}`);
  }
}

/**
 * Manually execute one automation against one contact (the "Test run" button),
 * bypassing trigger matching but still evaluating conditions. Returns the run.
 */
export async function testRunAutomation(automationId: string, contactId: string, tenantId: string) {
  const auto: AutomationRow | null = await db.automation.findUnique({ where: { id: automationId } });
  if (!auto || auto.tenantId !== tenantId) throw new Error("Automation not found");
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.tenantId !== tenantId) throw new Error("Contact not found");

  const fieldDefs = await loadFieldDefs(tenantId);
  const columns = buildColumns(fieldDefs);
  const portal = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const syntheticEvent: DomainEvent = {
    id: "test-" + Date.now(),
    tenantId,
    type: auto.triggerType,
    actor: { type: "user" },
    subject: { type: "contact", id: contactId },
    payload: { test: true },
    occurredAt: new Date().toISOString(),
  };
  await runOne(auto, syntheticEvent, contact, fieldDefs, columns, portal, null);
  const last = await db.automationRun.findFirst({ where: { automationId, tenantId }, orderBy: { createdAt: "desc" } });
  return last;
}

/**
 * Run a Manual-trigger automation on demand (the "Run automation" button on a
 * record). Unlike Test, this is restricted to flows whose trigger is "Manual"
 * and that are enabled. Conditions are still evaluated, so a manual flow whose
 * conditions don't match will be logged as skipped and its actions won't run.
 * Tenant-scoped: both the automation and the contact must belong to tenantId.
 */
export async function runManualAutomation(automationId: string, contactId: string, tenantId: string) {
  const auto: AutomationRow | null = await db.automation.findUnique({ where: { id: automationId } });
  if (!auto || auto.tenantId !== tenantId) throw new Error("Automation not found");
  if (auto.triggerType !== "Manual") throw new Error("This automation is not a manual trigger");
  if (!auto.enabled) throw new Error("This automation is turned off");
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.tenantId !== tenantId) throw new Error("Contact not found");

  const fieldDefs = await loadFieldDefs(tenantId);
  const columns = buildColumns(fieldDefs);
  const portal = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const syntheticEvent: DomainEvent = {
    id: "manual-" + Date.now(),
    tenantId,
    type: "Manual",
    actor: { type: "user" },
    subject: { type: "contact", id: contactId },
    payload: { manual: true },
    occurredAt: new Date().toISOString(),
  };
  await runOne(auto, syntheticEvent, contact, fieldDefs, columns, portal, null);
  const last = await db.automationRun.findFirst({ where: { automationId, tenantId }, orderBy: { createdAt: "desc" } });
  return last;
}

/**
 * Enroll the CURRENT contacts of an Audience into an automation (Task 3 — the Drips targeting
 * hook). The audience is resolved to its live matchers AT ENROLL TIME (dynamic — reuses
 * resolveAudienceContacts), then the automation runs once per matcher via the same run path as a
 * manual run. Each matcher's run starts immediately; any `wait` in the flow queues their later
 * steps (see runOne). Conditions still apply per contact, so a pure audience-targeted drip should
 * leave conditions empty and let the audience be the filter. Tenant-scoped throughout.
 *
 * DRIP-AS-AUTOMATION (Task 4): a LINEAR drip is representable purely as one Automation record —
 *   triggerType: "Manual" (enrolled via enrollAudienceInAutomation), conditions: [] (audience is
 *   the target), actions (ordered):
 *     [ wait, send_email, wait, send_survey ]
 *   plus a companion Automation triggered by the "exit" event (e.g. a reply/unsubscribe) whose
 *   action is `unenroll` targeting the drip. Multiple waits are honored (runOne accumulates due
 *   times), send_survey + unenroll are new actions, and enrollment is this function — so no gap
 *   remains for a linear (non-branching) drip.
 */
export async function enrollAudienceInAutomation(
  automationId: string,
  audienceId: string,
  tenantId: string,
): Promise<{ enrolled: number; contactIds: string[]; skipped: number }> {
  const auto: AutomationRow | null = await db.automation.findUnique({ where: { id: automationId } });
  if (!auto || auto.tenantId !== tenantId) throw new Error("Automation not found");
  if (!auto.enabled) throw new Error("This automation is turned off");
  const matchers = await resolveAudienceContacts(tenantId, audienceId);
  if (matchers === null) throw new Error("Audience not found");

  const fieldDefs = await loadFieldDefs(tenantId);
  const columns = buildColumns(fieldDefs);
  const portal = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const enrolledIds: string[] = [];
  let skipped = 0;
  for (const m of matchers) {
    const contact = await prisma.contact.findUnique({ where: { id: m.id } });
    if (!contact || contact.tenantId !== tenantId) { skipped++; continue; }
    const syntheticEvent: DomainEvent = {
      id: "enroll-" + Date.now() + "-" + m.id,
      tenantId,
      type: "AudienceEnroll",
      actor: { type: "user" },
      subject: { type: "contact", id: m.id },
      payload: { audienceId, enroll: true },
      occurredAt: new Date().toISOString(),
    };
    await runOne(auto, syntheticEvent, contact, fieldDefs, columns, portal, null);
    enrolledIds.push(m.id);
  }
  return { enrolled: enrolledIds.length, contactIds: enrolledIds, skipped };
}

let registered = false;
/** Wire the engine into the bus. Safe to call multiple times (idempotent). */
export function registerAutomationEngine(): void {
  if (registered) return;
  registered = true;
  subscribe((event) => handleEvent(event));
  logger.info("Automation engine registered on event bus");
}
