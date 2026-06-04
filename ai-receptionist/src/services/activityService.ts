import { prisma } from "../db/client";
import { emitEvent } from "../events/bus";
import { EVENT_TYPES } from "../events/types";

export interface Actor {
  id?: string | null;
  name?: string | null;
  type?: "user" | "system" | "automation";
}

export async function log(input: {
  tenantId: string;
  contactId: string;
  type: string;
  summary: string;
  detail?: unknown;
  actor?: Actor;
}): Promise<void> {
  const actorType = input.actor?.type ?? (input.actor?.id ? "user" : "system");
  await prisma.activityLog.create({
    data: {
      tenantId: input.tenantId,
      contactId: input.contactId,
      type: input.type,
      summary: input.summary,
      detail: (input.detail ?? {}) as any,
      actorType,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? null,
    },
  });

  // Generic activity stream + a dedicated NoteAdded for note entries. The event
  // actor carries the same provenance so automation-sourced activity is ignored
  // by the engine (loop-safe).
  try {
    const actor = { type: actorType as any, id: input.actor?.id ?? null, name: input.actor?.name ?? null };
    const subject = { type: "contact", id: input.contactId };
    await emitEvent({ tenantId: input.tenantId, type: EVENT_TYPES.ActivityLogged, actor, subject, payload: { activityType: input.type, summary: input.summary } });
    if (input.type === "note") {
      await emitEvent({ tenantId: input.tenantId, type: EVENT_TYPES.NoteAdded, actor, subject, payload: { text: input.summary } });
    }
  } catch {
    /* emitting is non-critical */
  }
}

/**
 * Build a unified, newest-first timeline for a contact: stored events
 * (field edits, emails) merged with the contact's calls and its creation.
 */
export async function listTimeline(contactId: string, tenantId: string) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { callSessions: { orderBy: { createdAt: "desc" } } },
  });
  if (!contact || contact.tenantId !== tenantId) return null;

  const events = await prisma.activityLog.findMany({
    where: { contactId, tenantId },
    orderBy: { createdAt: "desc" },
  });

  const items: any[] = [];

  events.forEach((e: any) => {
    items.push({
      id: e.id,
      type: e.type,
      actorType: e.actorType,
      actorName: e.actorName,
      summary: e.summary,
      detail: e.detail ?? {},
      createdAt: e.createdAt.toISOString(),
    });
  });

  (contact.callSessions as any[]).forEach((c) => {
    const ex = (c.extracted ?? {}) as any;
    items.push({
      id: "call-" + c.id,
      type: "call",
      actorType: "system",
      actorName: "System",
      summary: c.status === "COMPLETED" ? "Call completed" : c.status === "FAILED" ? "Missed call" : "Call in progress",
      detail: { intent: ex.intent ?? null, callId: c.id },
      createdAt: c.createdAt.toISOString(),
    });
  });

  items.push({
    id: "created-" + contact.id,
    type: "created",
    actorType: "system",
    actorName: "System",
    summary: "Contact created",
    detail: {},
    createdAt: contact.createdAt.toISOString(),
  });

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}
