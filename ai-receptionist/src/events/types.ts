// ===================== Domain event contract =====================
// Every event in the system is a consistently-structured object. New event
// types are just new string literals — no code in the bus or engine needs to
// change to support them, which keeps emitters and consumers loosely coupled.

export type ActorType = "user" | "system" | "automation" | "sync";

export interface EventActor {
  type: ActorType;
  id?: string | null;
  name?: string | null;
}

// Loose actor shape accepted by deletedByFromActor — both EventActor (records)
// and contactService's MutationActor satisfy it structurally.
export interface ActorLike {
  type?: string | null;
  id?: string | null;
  name?: string | null;
}

/**
 * Map the actor behind a soft-delete to the pair we persist on the row, so the
 * Recycle Bin preview can later show "by [user]" for each case:
 *   human user        -> their name (captured at delete time), type "user"
 *   AI receptionist   -> "AI receptionist",  type "ai"   (automation actor)
 *   calendar sync     -> "Calendar sync",    type "sync"
 *   system            -> "System",           type "system"
 * Unknown / no actor / a user with no resolvable name -> deletedBy NULL (the
 * date-only fallback). Pure + side-effect-free; never throws.
 */
export function deletedByFromActor(actor?: ActorLike | null): { deletedBy: string | null; deletedByType: string | null } {
  if (!actor || !actor.type) return { deletedBy: null, deletedByType: null };
  switch (actor.type) {
    case "user":
      return { deletedBy: (actor.name && actor.name.trim()) || null, deletedByType: "user" };
    case "automation":
      return { deletedBy: "AI receptionist", deletedByType: "ai" };
    case "sync":
      return { deletedBy: "Calendar sync", deletedByType: "sync" };
    case "system":
      return { deletedBy: "System", deletedByType: "system" };
    default:
      return { deletedBy: (actor.name && actor.name.trim()) || null, deletedByType: actor.type };
  }
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
  // Loop-safety backstop (Batch A step 1): how many automation-hops deep this
  // event is in a cascade. A top-level user/system action is 0; each automation
  // that causes a further event increments it. Carried IN MEMORY only — never
  // written to the Event table (no migration). The engine refuses to process
  // beyond MAX_CHAIN_DEPTH.
  chainDepth?: number;
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
  // Audit: a portal's AI Instructions were edited. Subject = the portal (tenant).
  // Not a real automation trigger — recorded for the settings audit trail only.
  AiInstructionsUpdated: "AiInstructionsUpdated",
  // A candidate's relationship stage on a record changed. Subject = the contact.
  StageChanged: "StageChanged",
  // A record's own field/status changed (e.g. a job's Status). Subject = record.
  RecordUpdated: "RecordUpdated",
  // NOT an independently-emitted event — a SCOPED TRIGGER derived from
  // ContactCreated when the contact's source is "phone" (see the engine's
  // trigger matching). Named here so the trigger type has one canonical string.
  // Fires only for first-time phone leads captured by the AI receptionist.
  CallLeadCreated: "CallLeadCreated",
  // Bookings as first-class automation citizens. BookingCreated fires once when a
  // new booking gets its linked contact (manual OR AI — both go through the same
  // link step), so an automation's act_on_linked always has a contact to reach.
  // BookingStatusChanged fires when a booking's status moves (subject = the
  // booking record); the engine derives scoped "BookingStatusChanged:status=<v>"
  // triggers from its changes[] just like RecordUpdated.
  BookingCreated: "BookingCreated",
  BookingStatusChanged: "BookingStatusChanged",
} as const;

export type KnownEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// Triggers exposed in the automation builder UI. A subset of event types that
// make sense as workflow entry points.
export const TRIGGERABLE_EVENT_TYPES: { type: string; label: string; group: string; description: string }[] = [
  { type: EVENT_TYPES.ContactCreated, label: "Contact created", group: "When something changes", description: "Runs once when a new contact is first added." },
  // The receptionist-specific trigger: a brand-new contact whose source is
  // "phone" (a first-time caller captured by the AI). It is a scoped match on
  // top of ContactCreated, so "Contact created" still fires for every new
  // contact (including phone) — this one fires ONLY for new phone leads.
  { type: EVENT_TYPES.CallLeadCreated, label: "New call lead", group: "When something changes", description: "Runs when the AI receptionist captures a brand-new lead from a phone call (a first-time caller). Does not run for manual adds, imports, webhooks, or repeat callers." },
  { type: EVENT_TYPES.ContactUpdated, label: "Contact updated", group: "When something changes", description: "Runs when any detail on a contact is edited." },
  { type: EVENT_TYPES.FieldChanged, label: "Field changed", group: "When something changes", description: "Runs when one specific field's value changes." },
  { type: EVENT_TYPES.TagAdded, label: "Tag added", group: "Messaging & tags", description: "Runs when a tag is added." },
  { type: EVENT_TYPES.TagRemoved, label: "Tag removed", group: "Messaging & tags", description: "Runs when a tag is removed." },
  { type: EVENT_TYPES.EmailSent, label: "Email sent", group: "Messaging & tags", description: "Runs after an email is sent." },
  { type: EVENT_TYPES.SMSSent, label: "SMS sent", group: "Messaging & tags", description: "Runs after a text message is sent." },
  { type: EVENT_TYPES.NoteAdded, label: "Note added", group: "Messaging & tags", description: "Runs when an internal note is added." },
  // Fires when a contact's relationship stage on a record changes. Like
  // "FieldChanged:<fieldKey>", an OPTIONAL scoped variant "StageChanged:<stageKey>"
  // fires only when the NEW stage matches; plain "StageChanged" fires on any
  // stage change. Labels stay generic ("Stage", "Record") so portals can relabel.
  { type: EVENT_TYPES.StageChanged, label: "Stage changed", group: "When something changes", description: "Runs when an item moves to a different pipeline stage." },
  // Fires when a record's own field/status changes (subject = the record). Like
  // FieldChanged, optional scoped variants "RecordUpdated:<field>" and
  // "RecordUpdated:<field>=<value>" narrow it to one field (e.g. Status) or one
  // destination value. Generic labels ("Record") so portals can relabel.
  { type: EVENT_TYPES.RecordUpdated, label: "Record updated / status changed", group: "When something changes", description: "Runs when a record's own field or status changes." },
  // Manual is a trigger-only entry: it is NOT an emitted event, so the engine's
  // event dispatch never fires it automatically. It runs only when a user clicks
  // "Run automation" on a record (see runManualAutomation in automation/engine).
  { type: "Manual", label: "Manual — run from a record", group: "Manual", description: "Runs only when you click Run on a record — never automatically." },
  // Date-relative schedule. Its parameters are encoded into triggerType as
  // "Scheduled:<field>:<amount>:<unit>:<dir>" (no schema change). It does not
  // fire on instant events; the daily sweep evaluates and queues it.
  { type: "Scheduled", label: "On a date (relative to a date field)", group: "Time-based", description: "Runs on a date worked out from a date field (e.g. 3 days before)." },
  // Time-in-stage: a candidate has sat in their CURRENT stage with no movement
  // for N days. Encoded as "Stalled:<days>" or "Stalled:<days>:<stageKey>"
  // (no schema change). Like Scheduled, it does not fire on instant events — the
  // sweep evaluates it. Generic label (no "job"/"candidate").
  { type: "Stalled", label: "Stalled in a stage for N days (no movement)", group: "Time-based", description: "Runs when an item sits in the same stage with no movement for N days." },
  // Booking lifecycle triggers (subject = the booking). "Booking status changed"
  // can be narrowed to a specific status (e.g. → No-show) via the same field=value
  // scoping the record triggers use: "BookingStatusChanged:status=<statusKey>".
  { type: EVENT_TYPES.BookingCreated, label: "Booking created", group: "Bookings", description: "Runs when a new booking is made for a contact — whether booked manually or by the AI receptionist." },
  { type: EVENT_TYPES.BookingStatusChanged, label: "Booking status changed", group: "Bookings", description: "Runs when a booking moves to a different status (e.g. Confirmed, Completed, No-show)." },
  // Time-based booking trigger: queues a reminder a set time BEFORE the
  // appointment. Stored as "AppointmentReminder:<amount>:<unit>:before". Evaluated
  // by the scheduler sweep (not an instant event). Hour-precise.
  { type: "AppointmentReminder", label: "Before an appointment (reminder)", group: "Bookings", description: "Runs a set time before a booking's appointment (e.g. 2 hours before) — for sending reminders. Texts/emails the booking's linked contact." },
];
