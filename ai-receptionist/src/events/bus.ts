import crypto from "crypto";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { DomainEvent, EventActor, EventSubject } from "./types";

// `prisma.event` exists at runtime once the client is regenerated against the
// new schema. We cast here so the project type-checks even before the local
// client has been regenerated (CI / fresh checkout). Runtime is unaffected.
const db = prisma as any;

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// The bus is a tiny in-process pub/sub. It is deliberately ignorant of who is
// listening (the automation engine is just one subscriber), which keeps the
// event system and any consumer loosely coupled. Swapping this for a durable
// queue (BullMQ / SQS / Kafka) later means reimplementing `dispatch` only.
// ---------------------------------------------------------------------------
const handlers: EventHandler[] = [];

export function subscribe(handler: EventHandler): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

export interface EmitInput {
  tenantId: string;
  type: string;
  actor?: EventActor;
  subject?: Partial<EventSubject>;
  payload?: Record<string, any>;
}

/**
 * Emit a domain event: persist it to the append-only Event log (for debugging
 * and execution history), then dispatch to subscribers asynchronously so the
 * caller's request flow is never blocked by downstream work.
 *
 * Best-effort: a failure to log or dispatch is swallowed (logged) so emitting
 * an event can never break the primary operation that produced it.
 */
export async function emitEvent(input: EmitInput): Promise<DomainEvent> {
  const actor: EventActor = {
    type: input.actor?.type ?? "system",
    id: input.actor?.id ?? null,
    name: input.actor?.name ?? null,
  };
  const subject: EventSubject = {
    type: input.subject?.type ?? "contact",
    id: input.subject?.id ?? null,
  };

  const event: DomainEvent = {
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    type: input.type,
    actor,
    subject,
    payload: input.payload ?? {},
    occurredAt: new Date().toISOString(),
  };

  // 1) Persist (the event log). The DB id mirrors the in-memory id.
  try {
    await db.event.create({
      data: {
        id: event.id,
        tenantId: event.tenantId,
        type: event.type,
        actorType: actor.type,
        actorId: actor.id,
        actorName: actor.name,
        subjectType: subject.type,
        subjectId: subject.id,
        payload: event.payload,
        occurredAt: new Date(event.occurredAt),
      },
    });
  } catch (err) {
    logger.error(`event persist failed (${event.type}): ${(err as Error).message}`);
  }

  // 2) Dispatch asynchronously — does not block the caller.
  dispatch(event);
  return event;
}

function dispatch(event: DomainEvent): void {
  for (const handler of handlers.slice()) {
    setImmediate(() => {
      Promise.resolve()
        .then(() => handler(event))
        .catch((err) => logger.error(`event handler error (${event.type}): ${(err as Error).message}`));
    });
  }
}
