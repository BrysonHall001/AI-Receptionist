import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { subscribe } from "../events/bus";
import { DomainEvent, EventActor } from "../events/types";
import { evalRules, Rule } from "./conditions";
import { buildColumns, loadFieldDefs } from "./contactRow";
import { ActionConfig, ActionContext, ActionResult, runAction } from "./actions";

const db = prisma as any;

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

  const contactId = event.subject?.id;
  if (!contactId) return; // contact-centric MVP

  const automations: AutomationRow[] = await db.automation.findMany({
    where: { tenantId: event.tenantId, triggerType: event.type, enabled: true },
  });
  if (!automations.length) return;

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.tenantId !== event.tenantId) return;

  const fieldDefs = await loadFieldDefs(event.tenantId);
  const columns = buildColumns(fieldDefs);
  const portal = await prisma.tenant.findUnique({ where: { id: event.tenantId } });

  for (const auto of automations) {
    await runOne(auto, event, contact, fieldDefs, columns, portal, event.id);
  }
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
  const ctx: ActionContext = {
    tenantId: auto.tenantId,
    contactId: contact.id,
    fieldDefs,
    actor,
    portal: { phoneNumber: portal?.phoneNumber, notifyEmail: portal?.notifyEmail, name: portal?.name },
  };

  const results: ActionResult[] = [];
  for (const action of (auto.actions as ActionConfig[]) || []) {
    results.push(await runAction(action, ctx));
  }
  const status = results.some((r) => r.status === "failed") ? "failed" : "success";
  await writeRun(auto, { eventId, eventType: event.type, contactId: contact.id, status, matched: true, results });
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

let registered = false;
/** Wire the engine into the bus. Safe to call multiple times (idempotent). */
export function registerAutomationEngine(): void {
  if (registered) return;
  registered = true;
  subscribe((event) => handleEvent(event));
  logger.info("Automation engine registered on event bus");
}
