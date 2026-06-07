import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { subscribe } from "../events/bus";
import { DomainEvent, EventActor } from "../events/types";
import { evalRules, Rule } from "./conditions";
import { buildColumns, loadFieldDefs } from "./contactRow";
import { ActionConfig, ActionContext, ActionResult, runAction } from "./actions";
import { enqueueJob } from "./scheduler";

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
const RECORD_SUBJECT_ACTIONS = new Set(["create_note", "act_on_linked", "move_to_stage", "set_record_field"]);

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
  if (firstChange) {
    if (firstChange.label != null) extraTokens.changed_field = String(firstChange.label);
    if (firstChange.new != null) extraTokens.new_value = String(firstChange.new);
    if (firstChange.old != null) extraTokens.old_value = String(firstChange.old);
  }

  // Stage 2a deliberately does NOT expose record fields to conditions (out of
  // scope). We evaluate with an empty column set: an unknown field resolves to
  // "pass" (same as the UI rule engine), so the per-field/value filtering is
  // done by trigger scoping above, not by conditions.
  const matched = evalRules(record, (auto.conditions as Rule[]) || [], []);
  if (!matched) {
    await writeRun(auto, { eventId: event.id, eventType: event.type, contactId: null, status: "skipped", matched: false, results: [] });
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
    // Run actions before the Wait now; queue the actions after it for later.
    for (let i = 0; i < waitIdx; i++) {
      results.push(await runAction(actionList[i], ctx));
    }
    const dueAt = delayDueAt(actionList[waitIdx].config || {});
    const remaining = actionList.slice(waitIdx + 1).filter((a) => a.type !== "wait");
    const contactName = contact.name || contact.phone || contact.email || contact.id;
    for (const action of remaining) {
      await enqueueJob({
        tenantId: auto.tenantId,
        automationId: auto.id,
        automationName: auto.name,
        contactId: contact.id,
        contactName,
        action,
        dueAt,
        kind: "delay",
      });
      results.push({ type: action.type, status: "skipped", detail: `scheduled for ${dueAt.toISOString()}` });
    }
    results.push({ type: "wait", status: "success", detail: `deferred ${remaining.length} action(s) until ${dueAt.toISOString()}` });
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

let registered = false;
/** Wire the engine into the bus. Safe to call multiple times (idempotent). */
export function registerAutomationEngine(): void {
  if (registered) return;
  registered = true;
  subscribe((event) => handleEvent(event));
  logger.info("Automation engine registered on event bus");
}
