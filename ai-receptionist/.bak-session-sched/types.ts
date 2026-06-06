// ===================== Domain event contract =====================
// Every event in the system is a consistently-structured object. New event
// types are just new string literals — no code in the bus or engine needs to
// change to support them, which keeps emitters and consumers loosely coupled.

export type ActorType = "user" | "system" | "automation";

export interface EventActor {
  type: ActorType;
  id?: string | null;
  name?: string | null;
}

export interface EventSubject {
  type: string; // e.g. "contact"
  id: string | null;
}

export interface DomainEvent<P = Record<string, any>> {
  id: string;
  tenantId: string;
  type: string; // see EVENT_TYPES for the well-known set
  actor: EventActor;
  subject: EventSubject;
  payload: P;
  occurredAt: string; // ISO timestamp
}

// Well-known event types. This is a convenience registry for callers and the
// UI; the bus treats `type` as an opaque string, so adding a new type here (or
// emitting an ad-hoc one) never requires refactoring the core.
export const EVENT_TYPES = {
  ContactCreated: "ContactCreated",
  ContactUpdated: "ContactUpdated",
  FieldChanged: "FieldChanged",
  TagAdded: "TagAdded",
  TagRemoved: "TagRemoved",
  EmailSent: "EmailSent",
  SMSSent: "SMSSent",
  NoteAdded: "NoteAdded",
  ActivityLogged: "ActivityLogged",
} as const;

export type KnownEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// Triggers exposed in the automation builder UI. A subset of event types that
// make sense as workflow entry points.
export const TRIGGERABLE_EVENT_TYPES: { type: string; label: string }[] = [
  { type: EVENT_TYPES.ContactCreated, label: "Contact created" },
  { type: EVENT_TYPES.ContactUpdated, label: "Contact updated" },
  { type: EVENT_TYPES.FieldChanged, label: "Field changed" },
  { type: EVENT_TYPES.TagAdded, label: "Tag added" },
  { type: EVENT_TYPES.TagRemoved, label: "Tag removed" },
  { type: EVENT_TYPES.EmailSent, label: "Email sent" },
  { type: EVENT_TYPES.SMSSent, label: "SMS sent" },
  { type: EVENT_TYPES.NoteAdded, label: "Note added" },
  // Manual is a trigger-only entry: it is NOT an emitted event, so the engine's
  // event dispatch never fires it automatically. It runs only when a user clicks
  // "Run automation" on a record (see runManualAutomation in automation/engine).
  { type: "Manual", label: "Manual — run from a record" },
];
