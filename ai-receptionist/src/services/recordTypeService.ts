// Record-type helpers (Batch 1a backbone + 1b record-type listing/resolution).
//
// Provides each portal's system "contact" record type, the first non-contact
// type ("job", recruiting), a list of all types, and a resolver from a key/id to
// an id. Uses (prisma as any) because the generated client only knows the
// RecordType model after the 1a migration is applied and `prisma generate` ran.

import { prisma } from "../db/client";

const db = prisma as any;

export const CONTACT_RECORD_TYPE_KEY = "contact";
export const JOB_RECORD_TYPE_KEY = "job";
export const BOOKING_RECORD_TYPE_KEY = "booking";
export const EQUIPMENT_RECORD_TYPE_KEY = "equipment";
export const INVOICE_RECORD_TYPE_KEY = "invoice";
export const WORK_ORDER_RECORD_TYPE_KEY = "work_order";

// Record types whose calendar lays out by the TYPED Record.appointmentAt column
// (not a FieldDef): Bookings (as always) and now Work Orders. Registry-derived
// helper so the calendar wiring never grows another key literal.
const TYPED_APPOINTMENT_TYPE_KEYS = new Set<string>([BOOKING_RECORD_TYPE_KEY, WORK_ORDER_RECORD_TYPE_KEY]);
export function usesTypedAppointment(typeKey: string): boolean { return TYPED_APPOINTMENT_TYPE_KEYS.has(typeKey); }

// RESOURCE-CAPABLE modules (Scheduling Calendar batch): the ones whose records
// carry the typed Record.resourceId column, so their calendar can group into
// per-staff LANES. Today this coincides with the typed-appointment set, but it
// is a deliberately SEPARATE named set so the two concepts can diverge later
// without archaeology.
const RESOURCE_CAPABLE_TYPE_KEYS = new Set<string>(TYPED_APPOINTMENT_TYPE_KEYS);
export function isResourceCapable(typeKey: string): boolean { return RESOURCE_CAPABLE_TYPE_KEYS.has(typeKey); }

// Default fields seeded ONCE when a portal's Equipment type is first created (see the
// onCreate hook below). Equipment is a flat catalog (no pipeline), so these are plain
// editable/removable custom fields — the business can rename, reorder, add or delete
// them on the Fields page afterward; deletions are never undone (seeded on create only).
// The unit's display name is the record's own required title (like a Job's title), so
// there is deliberately NO separate "name" field here — that would duplicate the title.
const DEFAULT_EQUIPMENT_FIELDS = [
  { key: "equipment_type", label: "Type", type: "single_select", order: 0, options: ["Air conditioner", "Furnace", "Water heater", "Other"] },
  { key: "brand", label: "Brand", type: "text", order: 1, options: [] as string[] },
  { key: "model", label: "Model", type: "text", order: 2, options: [] as string[] },
  { key: "serial", label: "Serial number", type: "text", order: 3, options: [] as string[] },
  { key: "install_date", label: "Install date", type: "date", order: 4, options: [] as string[] },
  { key: "last_service_date", label: "Last service date", type: "date", order: 5, options: [] as string[] },
  { key: "next_service_due", label: "Next service due", type: "date", order: 6, options: [] as string[] },
  { key: "warranty_expires", label: "Warranty expires", type: "date", order: 7, options: [] as string[] },
  { key: "status", label: "Status", type: "single_select", order: 8, options: ["Active", "Needs service", "Retired"] },
  { key: "notes", label: "Notes", type: "textarea", order: 9, options: [] as string[] },
];

/** Seed Equipment's default fields (idempotent by key). Runs once, at type creation. */
export async function ensureEquipmentDefaultFields(tenantId: string, recordTypeId: string): Promise<void> {
  const existing = await db.fieldDef.findMany({ where: { tenantId, recordTypeId }, select: { key: true } });
  const have = new Set(existing.map((e: any) => e.key));
  const toCreate = DEFAULT_EQUIPMENT_FIELDS.filter((f) => !have.has(f.key));
  if (!toCreate.length) return;
  await db.fieldDef.createMany({
    data: toCreate.map((f) => ({ tenantId, recordTypeId, scope: "record", key: f.key, label: f.label, type: f.type, required: !!(f as any).required, options: f.options || [], order: f.order, system: false })) as any,
    skipDuplicates: true,
  });
}

// Default fields seeded once when a portal's Invoices type is first created. Ordinary
// editable/removable custom fields — the user can customize them on Modules & Fields like
// any module. "invoice_number" is auto-filled at create (Task 3); "total" is COMPUTED from
// the line_items rows on every save (Task 2) and shown read-only; "status" defaults to Draft.
const DEFAULT_INVOICE_FIELDS = [
  { key: "invoice_number", label: "Invoice number", type: "text", order: 0, options: [] as string[] },
  { key: "status", label: "Status", type: "single_select", order: 1, options: ["Draft", "Sent", "Paid", "Void"] },
  { key: "invoice_date", label: "Invoice date", type: "date", order: 2, options: [] as string[] },
  { key: "due_date", label: "Due date", type: "date", order: 3, options: [] as string[] },
  { key: "line_items", label: "Line items", type: "line_items", order: 4, options: [] as string[] },
  { key: "total", label: "Total", type: "currency", order: 5, options: [] as string[] },
  { key: "notes", label: "Notes", type: "textarea", order: 6, options: [] as string[] },
];

/** Seed Invoices' default fields (idempotent by key). Runs once, at type creation. */
export async function ensureInvoiceDefaultFields(tenantId: string, recordTypeId: string): Promise<void> {
  const existing = await db.fieldDef.findMany({ where: { tenantId, recordTypeId }, select: { key: true } });
  const have = new Set(existing.map((e: any) => e.key));
  const toCreate = DEFAULT_INVOICE_FIELDS.filter((f) => !have.has(f.key));
  if (!toCreate.length) return;
  await db.fieldDef.createMany({
    data: toCreate.map((f) => ({ tenantId, recordTypeId, scope: "record", key: f.key, label: f.label, type: f.type, required: !!(f as any).required, options: f.options || [], order: f.order, system: false })) as any,
    skipDuplicates: true,
  });
}

// ---- Batch: five pre-built industry modules (Vehicles, Properties, Products & Services,
// Estimates, Tasks). Each seeds ordinary editable/removable custom fields via onCreate, in
// exactly the same idempotent (skipDuplicates) way as Equipment/Invoices. Products & Tasks
// deliberately have NO "name"/"title" field — the record's built-in Title is their name,
// matching the Equipment precedent (avoids a duplicate). Estimates' "total" is a currency
// field keyed "total" so it auto-computes from the line_items rows (same as Invoices).
type SeedField = { key: string; label: string; type: string; order: number; options?: string[]; required?: boolean };

/** Shared idempotent seeder used by the pre-built modules' onCreate hooks. */
async function seedDefaultFields(tenantId: string, recordTypeId: string, defs: SeedField[]): Promise<void> {
  const existing = await db.fieldDef.findMany({ where: { tenantId, recordTypeId }, select: { key: true } });
  const have = new Set(existing.map((e: any) => e.key));
  const toCreate = defs.filter((f) => !have.has(f.key));
  if (!toCreate.length) return;
  await db.fieldDef.createMany({
    data: toCreate.map((f) => ({ tenantId, recordTypeId, scope: "record", key: f.key, label: f.label, type: f.type, required: !!f.required, options: f.options || [], order: f.order, system: false })) as any,
    skipDuplicates: true,
  });
}

const DEFAULT_VEHICLE_FIELDS: SeedField[] = [
  { key: "make", label: "Make", type: "text", order: 0 },
  { key: "model", label: "Model", type: "text", order: 1 },
  { key: "year", label: "Year", type: "number", order: 2 },
  { key: "vin", label: "VIN", type: "text", order: 3 },
  { key: "license_plate", label: "License plate", type: "text", order: 4 },
  { key: "mileage", label: "Mileage", type: "number", order: 5 },
  { key: "color", label: "Color", type: "text", order: 6 },
  { key: "vehicle_type", label: "Vehicle type", type: "single_select", order: 7, options: ["Car", "Truck", "SUV", "Van", "Motorcycle", "Other"] },
  { key: "status", label: "Status", type: "single_select", order: 8, options: ["Active", "In service", "Retired"] },
  { key: "notes", label: "Notes", type: "textarea", order: 9 },
];
const DEFAULT_PROPERTY_FIELDS: SeedField[] = [
  { key: "property_address", label: "Property address", type: "address", order: 0 },
  { key: "property_type", label: "Property type", type: "single_select", order: 1, options: ["Single-family", "Multi-family", "Condo", "Commercial", "Land", "Other"] },
  { key: "beds", label: "Beds", type: "number", order: 2 },
  { key: "baths", label: "Baths", type: "number", order: 3 },
  { key: "size_sqft", label: "Size (sq ft)", type: "number", order: 4 },
  { key: "year_built", label: "Year built", type: "number", order: 5 },
  { key: "status", label: "Status", type: "single_select", order: 6, options: ["Active", "Vacant", "Under maintenance", "Inactive"] },
  { key: "notes", label: "Notes", type: "textarea", order: 7 },
];
const DEFAULT_PRODUCT_FIELDS: SeedField[] = [
  // The catalog item's name is the record's built-in Title (no duplicate "name" field).
  { key: "sku", label: "SKU", type: "text", order: 0 },
  { key: "description", label: "Description", type: "textarea", order: 1 },
  { key: "price", label: "Price", type: "currency", order: 2 },
  { key: "unit", label: "Unit", type: "single_select", order: 3, options: ["Each", "Hour", "Day", "Job", "Unit"] },
  { key: "category", label: "Category", type: "single_select", order: 4, options: ["Part", "Labor", "Material", "Service", "Other"] },
  { key: "taxable", label: "Taxable", type: "checkbox", order: 5 },
  { key: "notes", label: "Notes", type: "textarea", order: 6 },
];
const DEFAULT_ESTIMATE_FIELDS: SeedField[] = [
  { key: "estimate_number", label: "Estimate #", type: "text", order: 0 },
  { key: "status", label: "Status", type: "single_select", order: 1, options: ["Draft", "Sent", "Accepted", "Declined", "Expired"] },
  { key: "estimate_date", label: "Estimate date", type: "date", order: 2 },
  { key: "valid_until", label: "Valid until", type: "date", order: 3 },
  { key: "line_items", label: "Line items", type: "line_items", order: 4 },
  { key: "total", label: "Total", type: "currency", order: 5 }, // auto-computed from line_items
  { key: "notes", label: "Notes", type: "textarea", order: 6 },
];
const DEFAULT_TASK_FIELDS: SeedField[] = [
  // The task's name is the record's built-in Title (no duplicate "title" field).
  { key: "due_date", label: "Due date", type: "date", order: 0 },
  { key: "priority", label: "Priority", type: "single_select", order: 1, options: ["Low", "Medium", "High", "Urgent"] },
  { key: "status", label: "Status", type: "single_select", order: 2, options: ["To do", "In progress", "Done", "Blocked"] },
  { key: "assignee", label: "Assignee", type: "text", order: 3 },
  { key: "notes", label: "Notes", type: "textarea", order: 4 },
];

export async function ensureVehicleDefaultFields(tenantId: string, recordTypeId: string): Promise<void> { return seedDefaultFields(tenantId, recordTypeId, DEFAULT_VEHICLE_FIELDS); }
export async function ensurePropertyDefaultFields(tenantId: string, recordTypeId: string): Promise<void> { return seedDefaultFields(tenantId, recordTypeId, DEFAULT_PROPERTY_FIELDS); }
export async function ensureProductDefaultFields(tenantId: string, recordTypeId: string): Promise<void> { return seedDefaultFields(tenantId, recordTypeId, DEFAULT_PRODUCT_FIELDS); }
export async function ensureEstimateDefaultFields(tenantId: string, recordTypeId: string): Promise<void> { return seedDefaultFields(tenantId, recordTypeId, DEFAULT_ESTIMATE_FIELDS); }
export async function ensureTaskDefaultFields(tenantId: string, recordTypeId: string): Promise<void> { return seedDefaultFields(tenantId, recordTypeId, DEFAULT_TASK_FIELDS); }

// ---- WORK ORDERS (field-services spine, Work Orders foundation batch) --------
// A schedulable, assignable field-service job. The scheduled window (typed
// Record.appointmentAt + endAt) and the assigned technician (typed
// Record.resourceId) are deliberately NOT FieldDefs — same precedent as Bookings,
// where appointmentAt "is not a FieldDef" (see calendarDateFieldKeys). Everything
// below is an ordinary editable/removable custom field seeded once via onCreate.
// service_address (address type) powers the Map view + geocoding; photos (image
// type) makes the Gallery view available should the owner turn it on.
const DEFAULT_WORK_ORDER_FIELDS: SeedField[] = [
  { key: "description", label: "Description", type: "textarea", order: 0 },
  { key: "priority", label: "Priority", type: "single_select", order: 1, options: ["Low", "Normal", "High", "Urgent"] },
  { key: "service_address", label: "Service address", type: "address", order: 2 },
  { key: "photos", label: "Photos", type: "image", order: 3 },
  { key: "internal_notes", label: "Internal notes", type: "textarea", order: 4 },
];
export async function ensureWorkOrderDefaultFields(tenantId: string, recordTypeId: string): Promise<void> { return seedDefaultFields(tenantId, recordTypeId, DEFAULT_WORK_ORDER_FIELDS); }

// Work-order lifecycle statuses (Record.stageKey), booking-style record statuses:
// status dropdown + pill column + "Record updated / status changed" automations,
// all via machinery that exists today. Keys stable; labels freely editable.
const DEFAULT_WORK_ORDER_RECORD_STAGES = [
  { key: "new_request", label: "New request", order: 0 },
  { key: "scheduled", label: "Scheduled", order: 1 },
  { key: "in_progress", label: "In progress", order: 2 },
  { key: "completed", label: "Completed", order: 3 },
  { key: "cancelled", label: "Cancelled", order: 4 },
];

// Trade-agnostic work categories as subtypes (the Type mechanism, like booking
// services). Stages intentionally empty — the lifecycle lives in the record
// statuses above, not per-subtype pipelines. Renamable/deletable on Fields.
const DEFAULT_WORK_ORDER_SUBTYPES = [
  { key: "repair", label: "Repair", order: 0, stages: [] as any[] },
  { key: "maintenance", label: "Maintenance", order: 1, stages: [] as any[] },
  { key: "installation", label: "Installation", order: 2, stages: [] as any[] },
  { key: "inspection", label: "Inspection", order: 3, stages: [] as any[] },
];

// Booking lifecycle statuses (Record.stageKey) — the exact pipeline requested:
// Requested -> Confirmed -> Completed -> No-show. Keys are stable; labels are
// freely editable/reorderable on the Fields page like any other record status.
const DEFAULT_BOOKING_RECORD_STAGES = [
  { key: "requested", label: "Requested", order: 0 },
  { key: "confirmed", label: "Confirmed", order: 1 },
  { key: "completed", label: "Completed", order: 2 },
  { key: "no_show", label: "No-show", order: 3 },
  // Cancellation is just a status: moving a booking here fires the existing
  // "Booking status changed" trigger (scoped: status=cancelled), so no new event
  // is needed. Seeded for NEW booking types only (existing portals keep their
  // customized statuses untouched — they can add this on the Fields page).
  { key: "cancelled", label: "Cancelled", order: 4 },
];

// Sample "services" as subtypes (the Type mechanism). SAMPLE DATA ONLY — seeded
// once when the booking type is first created, then never re-added; each business
// can rename or delete these on the Fields page. Stages are intentionally empty:
// bookings use the record-level status above, not a candidate pipeline.
const DEFAULT_BOOKING_SUBTYPES = [
  { key: "consultation", label: "Consultation", order: 0, stages: [] },
  { key: "standard_appointment", label: "Standard appointment", order: 1, stages: [] },
  { key: "follow_up", label: "Follow-up", order: 2, stages: [] },
];

// Sensible recruiting defaults; labels are freely editable later, keys are stable.
const DEFAULT_JOB_STAGES = [
  { key: "applied", label: "Applied", order: 0 },
  { key: "screening", label: "Screening", order: 1 },
  { key: "interview", label: "Interview", order: 2 },
  { key: "offer", label: "Offer", order: 3 },
  { key: "hired", label: "Hired", order: 4 },
  { key: "rejected", label: "Rejected", order: 5 },
];
const DEFAULT_JOB_RECORD_STAGES = [
  { key: "open", label: "Open", order: 0 },
  { key: "on_hold", label: "On hold", order: 1 },
  { key: "filled", label: "Filled", order: 2 },
  { key: "closed", label: "Closed", order: 3 },
];

// Three starter job types, each with its own pipeline. Keys are stable; labels
// and stages are freely editable on the Fields page afterwards.
const DEFAULT_JOB_SUBTYPES = [
  { key: "technical", label: "Technical", order: 0, stages: [
    { key: "applied", label: "Applied", order: 0 },
    { key: "phone_screen", label: "Phone screen", order: 1 },
    { key: "technical_interview", label: "Technical interview", order: 2 },
    { key: "onsite", label: "Onsite", order: 3 },
    { key: "offer", label: "Offer", order: 4 },
    { key: "hired", label: "Hired", order: 5 },
    { key: "rejected", label: "Rejected", order: 6 },
  ] },
  { key: "field", label: "Field", order: 1, stages: [
    { key: "applied", label: "Applied", order: 0 },
    { key: "interview", label: "Interview", order: 1 },
    { key: "offer", label: "Offer", order: 2 },
    { key: "start", label: "Start", order: 3 },
    { key: "rejected", label: "Rejected", order: 4 },
  ] },
  { key: "sales", label: "Sales", order: 2, stages: [
    { key: "applied", label: "Applied", order: 0 },
    { key: "screening", label: "Screening", order: 1 },
    { key: "interview", label: "Interview", order: 2 },
    { key: "offer", label: "Offer", order: 3 },
    { key: "hired", label: "Hired", order: 4 },
    { key: "rejected", label: "Rejected", order: 5 },
  ] },
];

/** The portal's system "contact" record type id, created if missing. Idempotent. */
/**
 * Idempotent seeder for a default record type, SAFE under concurrency.
 *
 * The setup screen loads several things at once for a brand-new portal (theme,
 * labels, record types, dashboard), so multiple requests can race to seed the
 * same default. Two requests both pass the "does it exist?" check, both try to
 * create, and the unique (tenantId,key) constraint rejects the loser's create
 * with Prisma error code P2002. That is NOT a real failure — the row now exists —
 * so we swallow exactly that case and return the existing row. (Previously this
 * threw and, being an un-awaited rejection in a request handler, crashed the
 * whole server process.) Any other error is still surfaced.
 */
async function ensureRecordType(tenantId: string, key: string, data: Record<string, unknown>, onCreate?: (recordTypeId: string) => Promise<void>): Promise<string> {
  const existing = await db.recordType.findFirst({ where: { tenantId, key } });
  if (existing) return existing.id;
  try {
    const created = await db.recordType.create({ data });
    if (onCreate) await onCreate(created.id); // one-time seeding (e.g. default fields)
    return created.id;
  } catch (err: any) {
    if (err?.code === "P2002") {
      // Lost a create race with a concurrent request — the row exists now.
      const row = await db.recordType.findFirst({ where: { tenantId, key } });
      if (row) return row.id;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// SYSTEM RECORD TYPE REGISTRY — the ONE source of truth for the built-in types.
// Adding a future system type later = add ONE entry to this list; every consumer
// below (ensureAllSystemRecordTypes / listRecordTypes / resolveRecordTypeId) and
// in other files (e.g. surveyService's allowed map types) iterates this list, so
// no if-chains or literal trios need editing. Each `defaults` is EXACTLY the
// create payload (minus tenantId) used before this refactor, so the seeded data
// for contact/job/booking is byte-for-byte identical.
// ---------------------------------------------------------------------------
export interface SystemRecordTypeDef { key: string; defaults: Record<string, unknown>; onCreate?: (tenantId: string, recordTypeId: string) => Promise<void>; defaultHidden?: boolean; }

export const SYSTEM_RECORD_TYPES: SystemRecordTypeDef[] = [
  { key: CONTACT_RECORD_TYPE_KEY, defaults: {
    key: CONTACT_RECORD_TYPE_KEY, label: "Contact", labelPlural: "Contacts", system: true, stages: [], recordStages: [], order: 0,
  } },
  // Relabeled (Work Orders batch): this is a RECRUITING pipeline (Applied→…→Hired),
  // so it now reads as what it is. LABEL ONLY — the stable key "job", the stages,
  // subtypes, and every existing record are byte-for-byte unchanged. Existing
  // tenants still on the stock label are relabeled by the 20260723010000 migration;
  // custom labels are never touched.
  { key: JOB_RECORD_TYPE_KEY, defaults: {
    key: JOB_RECORD_TYPE_KEY, label: "Job Opening", labelPlural: "Job Openings", system: false,
    stages: DEFAULT_JOB_STAGES, recordStages: DEFAULT_JOB_RECORD_STAGES, subtypes: DEFAULT_JOB_SUBTYPES, pipelineEnabled: true,
    // Board view ON (it has a pipeline) — mirrors the migration backfill so NEW portals match today.
    enabledViews: ["board"], order: 1,
  } },
  { key: BOOKING_RECORD_TYPE_KEY, defaults: {
    key: BOOKING_RECORD_TYPE_KEY, label: "Booking", labelPlural: "Bookings", system: false,
    stages: [], recordStages: DEFAULT_BOOKING_RECORD_STAGES, subtypes: DEFAULT_BOOKING_SUBTYPES, pipelineEnabled: true,
    // Board (it has a pipeline) + Calendar (mapped to its typed date column) — mirrors the
    // migration backfill so NEW portals match today. Bookings render no kanban (their pipeline
    // is record statuses, not stages), so the Board flag is inert there — exactly as today.
    enabledViews: ["board", "calendar"], calendarDateField: "appointmentAt", order: 2,
  } },
  // First data-driven system type: a flat catalog (no pipeline/subtypes). Its default
  // fields are seeded once via onCreate. Nav item + list page + permissions come for
  // free from the registry + records-area work done in earlier batches.
  { key: EQUIPMENT_RECORD_TYPE_KEY, defaults: {
    key: EQUIPMENT_RECORD_TYPE_KEY, label: "Equipment", labelPlural: "Equipment", system: false,
    stages: [], recordStages: [], subtypes: [], order: 3,
  }, onCreate: ensureEquipmentDefaultFields },
  // Invoices — a normal registry-driven module (seeded by default for every portal, exactly
  // like Equipment). Its header fields (incl. the line_items table + a COMPUTED total) are
  // seeded once via onCreate and are fully editable on Modules & Fields. No payment/Stripe —
  // creation + tracking only; entirely separate from the master-hub billing of tenants.
  { key: INVOICE_RECORD_TYPE_KEY, defaults: {
    key: INVOICE_RECORD_TYPE_KEY, label: "Invoice", labelPlural: "Invoices", system: false,
    stages: [], recordStages: [], subtypes: [], order: 4,
  }, onCreate: ensureInvoiceDefaultFields },
  // Five pre-built INDUSTRY modules (Field Services / Auto Repair / Property Management).
  // Seeded in every portal like Equipment, but default-HIDDEN in the create-tenant Modules
  // picker (defaultHidden) so they exist without cluttering until an owner opts in. Flat
  // catalogs (status via a single_select FIELD, not pipeline stages). Orders 5..9 (invoice
  // already occupies 4).
  { key: "vehicle", defaults: {
    key: "vehicle", label: "Vehicle", labelPlural: "Vehicles", system: false,
    stages: [], recordStages: [], subtypes: [], order: 5,
  }, onCreate: ensureVehicleDefaultFields, defaultHidden: true },
  { key: "property", defaults: {
    key: "property", label: "Property", labelPlural: "Properties", system: false,
    stages: [], recordStages: [], subtypes: [], order: 6,
  }, onCreate: ensurePropertyDefaultFields, defaultHidden: true },
  { key: "product", defaults: {
    key: "product", label: "Product", labelPlural: "Products", system: false,
    stages: [], recordStages: [], subtypes: [], order: 7,
  }, onCreate: ensureProductDefaultFields, defaultHidden: true },
  { key: "estimate", defaults: {
    key: "estimate", label: "Estimate", labelPlural: "Estimates", system: false,
    stages: [], recordStages: [], subtypes: [], order: 8,
  }, onCreate: ensureEstimateDefaultFields, defaultHidden: true },
  { key: "task", defaults: {
    key: "task", label: "Task", labelPlural: "Tasks", system: false,
    stages: [], recordStages: [], subtypes: [], order: 9,
  }, onCreate: ensureTaskDefaultFields, defaultHidden: true },
  // WORK ORDERS — the field-services spine (Work Orders foundation batch). Seeded
  // VISIBLE for every portal (like Equipment/Invoices, NOT defaultHidden): it is
  // the flagship of the field-services direction and the base later batches
  // (dispatch board, customer comms, recurring work, tech mobile) build on.
  // Board flag is ON but currently inert (record-status pipelines render no
  // kanban — exactly like Bookings, see the booking entry above); the dispatch
  // batch lights it up with no config migration. Calendar lays out by the TYPED
  // appointmentAt column (see usesTypedAppointment); Map is powered by the seeded
  // service_address field + the existing geocoding foundation.
  { key: WORK_ORDER_RECORD_TYPE_KEY, defaults: {
    key: WORK_ORDER_RECORD_TYPE_KEY, label: "Work Order", labelPlural: "Work Orders", system: false,
    stages: [], recordStages: DEFAULT_WORK_ORDER_RECORD_STAGES, subtypes: DEFAULT_WORK_ORDER_SUBTYPES, pipelineEnabled: true,
    enabledViews: ["board", "calendar", "map"], calendarDateField: "appointmentAt", order: 10,
  }, onCreate: ensureWorkOrderDefaultFields },
];

/** Keys of the built-in system record types, in registry order. Derived (not a
 *  hardcoded trio) so consumers auto-include a future system type. */
export function systemRecordTypeKeys(): string[] { return SYSTEM_RECORD_TYPES.map((d) => d.key); }

// Nav href convention (server-side mirror of navModel.js recordTypeHref): the three
// original system types keep bespoke hrefs; every other type uses #/records/<key>.
const SYSTEM_RT_HREF: Record<string, string> = { contact: "#/contacts", job: "#/jobs", booking: "#/bookings" };
export function recordTypeHref(key: string): string { return SYSTEM_RT_HREF[key] || ("#/records/" + key); }

// Registry options for the "which sections show" picker at portal creation. Derived
// from SYSTEM_RECORD_TYPES so a FUTURE system type appears automatically. Contact is
// core (togglable:false) — every other type can be shown/hidden.
export function systemRecordTypeOptions() {
  return SYSTEM_RECORD_TYPES.map((d) => ({
    key: d.key,
    label: String((d.defaults as any).label ?? d.key),
    labelPlural: String((d.defaults as any).labelPlural ?? (d.defaults as any).label ?? d.key),
    href: recordTypeHref(d.key),
    togglable: d.key !== CONTACT_RECORD_TYPE_KEY,
    defaultHidden: !!d.defaultHidden, // pre-built industry modules start unchecked in the picker
  }));
}
// The record-type keys that MAY be hidden at creation (everything except contact).
export function togglableRecordTypeKeys(): string[] {
  return SYSTEM_RECORD_TYPES.filter((d) => d.key !== CONTACT_RECORD_TYPE_KEY).map((d) => d.key);
}

function systemDef(key: string): SystemRecordTypeDef | undefined { return SYSTEM_RECORD_TYPES.find((d) => d.key === key); }

/** Generic idempotent seeder for a system type, from its registry entry. */
async function ensureSystemRecordType(tenantId: string, def: SystemRecordTypeDef): Promise<string> {
  return ensureRecordType(tenantId, def.key, { tenantId, ...def.defaults }, def.onCreate ? (id) => def.onCreate!(tenantId, id) : undefined);
}

/** Ensure every system record type exists for a portal (iterates the registry). */
export async function ensureAllSystemRecordTypes(tenantId: string): Promise<void> {
  for (const def of SYSTEM_RECORD_TYPES) await ensureSystemRecordType(tenantId, def);
}

// The three named ensurers other files import — now thin delegates to the registry.
export async function ensureContactRecordType(tenantId: string): Promise<string> {
  return ensureSystemRecordType(tenantId, systemDef(CONTACT_RECORD_TYPE_KEY)!);
}
export async function ensureJobRecordType(tenantId: string): Promise<string> {
  return ensureSystemRecordType(tenantId, systemDef(JOB_RECORD_TYPE_KEY)!);
}
export async function ensureBookingRecordType(tenantId: string): Promise<string> {
  return ensureSystemRecordType(tenantId, systemDef(BOOKING_RECORD_TYPE_KEY)!);
}

// Keys we must never let a user-created module take: the system record types plus the
// fixed page/route words, so a new module can't collide with a nav page or a bespoke href.
const RESERVED_RT_KEYS = new Set<string>([
  CONTACT_RECORD_TYPE_KEY, JOB_RECORD_TYPE_KEY, BOOKING_RECORD_TYPE_KEY, EQUIPMENT_RECORD_TYPE_KEY, WORK_ORDER_RECORD_TYPE_KEY,
  "record", "records", "dashboard", "calls", "reports", "analytics", "automations",
  "communication", "learn", "feedback", "settings", "admin", "contacts", "jobs", "bookings",
]);

function slugifyRecordTypeKey(label: string): string {
  const base = (label || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return base || "module";
}

/**
 * Create a USER-DEFINED module (record type). system:false, ordered AFTER the current
 * last module, seeded with a single "Name" text field so it isn't empty. Everything else
 * (nav item, list page, permissions "records" area, analytics source, automations subject,
 * import/export, backup, recycle bin, portal-creation picker, AI knowledge list) is
 * registry-driven off listRecordTypes, so it propagates with no per-surface code.
 */
export async function createRecordType(tenantId: string, label: string, labelPlural?: string): Promise<any> {
  const l = (label || "").trim();
  if (!l) throw new Error("Module name is required");
  if (l.length > 40) throw new Error("Module name is too long");
  const lp = (labelPlural || "").trim() || l;

  // Make sure the system types (and their orders) exist first, so "after last" is right.
  await ensureAllSystemRecordTypes(tenantId);

  // Unique, safe key.
  let base = slugifyRecordTypeKey(l);
  if (RESERVED_RT_KEYS.has(base)) base = base + "_module";
  let key = base;
  let n = 2;
  while (await db.recordType.findFirst({ where: { tenantId, key } })) { key = `${base}_${n}`; n++; }

  // Order AFTER the current last module.
  const max = await db.recordType.aggregate({ where: { tenantId }, _max: { order: true } });
  const order = (max._max.order ?? -1) + 1;

  const created = await db.recordType.create({
    data: { tenantId, key, label: l, labelPlural: lp, system: false, stages: [], recordStages: [], subtypes: [], pipelineEnabled: false, order },
  });
  // Seed ONE default "Name" text field so the new module isn't empty.
  await db.fieldDef.create({
    data: { tenantId, recordTypeId: created.id, scope: "record", key: "name", label: "Name", type: "text", required: false, options: [], order: 0, system: false } as any,
  });
  return serializeRecordType(created);
}

export function serializeRecordType(rt: any) {
  // A module "has a pipeline" if it carries subtypes, record-level stages, or top-level
  // relationship stages. Used as the fallback when pipelineEnabled is absent (pre-migration
  // rows / partial objects) so behaviour matches today until the column is backfilled.
  const hasPipeline = ((rt.subtypes && rt.subtypes.length) || (rt.recordStages && rt.recordStages.length) || (rt.stages && rt.stages.length)) ? true : false;
  const pipelineEnabled = typeof rt.pipelineEnabled === "boolean" ? rt.pipelineEnabled : hasPipeline;
  // enabledViews: the OPTIONAL views (board/calendar) this module offers, on top of the
  // always-on table/list. When the column is present, use it. When absent (pre-migration
  // rows / partial objects), fall back to today's reality — board for pipeline modules,
  // calendar for Bookings — so behaviour matches until the backfill lands.
  let enabledViews: string[];
  if (Array.isArray(rt.enabledViews)) {
    enabledViews = rt.enabledViews.map((v: any) => String(v));
  } else {
    enabledViews = [];
    if (pipelineEnabled || hasPipeline) enabledViews.push("board");
    if (rt.key === "booking") enabledViews.push("calendar");
  }
  const calendarDateField = rt.calendarDateField ?? (rt.key === "booking" ? "appointmentAt" : null);
  return {
    id: rt.id,
    key: rt.key,
    label: rt.label,
    labelPlural: rt.labelPlural ?? null,
    system: !!rt.system,
    stages: rt.stages ?? [],
    recordStages: rt.recordStages ?? [],
    subtypes: rt.subtypes ?? [],
    pipelineEnabled,
    enabledViews,
    calendarDateField,
    // Scheduling-calendar options — false when the column is absent (pre-migration
    // rows / partial objects), matching the enabledViews fallback style.
    calendarLanes: rt.calendarLanes === true,
    calendarTray: rt.calendarTray === true,
    order: rt.order ?? 0,
  };
}

/** All record types for a portal (ensures every system type exists first). */
export async function listRecordTypes(tenantId: string) {
  await ensureAllSystemRecordTypes(tenantId);
  const rows = await db.recordType.findMany({ where: { tenantId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return rows.map(serializeRecordType);
}

/** Resolve a record type given a key ("contact"/"job"/…) or an id, to its id. Defaults to contact. */
export async function resolveRecordTypeId(tenantId: string, keyOrId?: string | null): Promise<string> {
  const k = (keyOrId || CONTACT_RECORD_TYPE_KEY).toString().trim();
  const sys = systemDef(k);
  if (sys) return ensureSystemRecordType(tenantId, sys);
  const byId = await db.recordType.findFirst({ where: { tenantId, id: k } });
  if (byId) return byId.id;
  const byKey = await db.recordType.findFirst({ where: { tenantId, key: k } });
  if (byKey) return byKey.id;
  return ensureContactRecordType(tenantId);
}

// ============================ Pipeline stage editing ============================
// Manage a record type's `stages` list (the {key,label,order} pipeline that
// candidate RecordLink.stageKey values reference). KEYS ARE STABLE: rename
// changes the label only, reorder changes order only, add mints a new unique
// key, and delete is BLOCKED while any candidate link still points at the key —
// so existing candidates are never silently orphaned. No migration: this only
// rewrites the JSON `stages` column that already exists on RecordType.

function slugify(label: string, existingKeys: string[], fallback = "item"): string {
  const base = String(label || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
  let key = base, n = 2;
  while (existingKeys.includes(key)) { key = base + "_" + n; n++; }
  return key;
}

function normStages(stages: any): { key: string; label: string; order: number }[] {
  return (Array.isArray(stages) ? stages : []).map((s: any, i: number) => ({ key: String(s.key), label: String(s.label ?? s.key), order: i }));
}

/** Normalize the subtypes config (job types + each one's pipeline). */
function normSubtypes(subtypes: any): { key: string; label: string; order: number; stages: any[] }[] {
  return (Array.isArray(subtypes) ? subtypes : []).map((st: any, i: number) => ({
    key: String(st.key),
    label: String(st.label ?? st.key),
    order: i,
    stages: normStages(st.stages),
  }));
}

async function loadTypeRow(tenantId: string, recordType?: string | null) {
  const id = await resolveRecordTypeId(tenantId, recordType ?? null);
  const row = await db.recordType.findFirst({ where: { tenantId, id } });
  if (!row) throw new Error("Record type not found");
  return row;
}

function findSubtype(subtypes: any[], subtypeKey: string) {
  const st = subtypes.find((x) => x.key === subtypeKey);
  if (!st) throw new Error("Type not found");
  return st;
}

// ---- Record TYPE display labels (singular + plural) -----------------------
// Updates ONLY the editable label/labelPlural for a record type in this portal.
// The stable `key` is never touched. Portal-scoped: only matches a type owned by
// this tenant, so it can't affect another portal. Both forms are required.
export async function setRecordTypeLabels(tenantId: string, key: string, label: string, labelPlural: string) {
  const one = String(label || "").trim();
  const many = String(labelPlural || "").trim();
  if (!one || !many) throw new Error("Singular and plural names are both required");
  const row = await db.recordType.findFirst({ where: { tenantId, key } });
  if (!row) throw new Error(`Unknown record type "${key}"`);
  await db.recordType.update({ where: { id: row.id }, data: { label: one, labelPlural: many } });
  return serializeRecordType({ ...row, label: one, labelPlural: many });
}

/** Turn a module's pipeline ON/OFF. NON-DESTRUCTIVE: toggling OFF only flips the flag and
 *  hides the pipeline UI — subtypes, stages, record statuses, and every record's stage
 *  assignment are KEPT, so turning it back ON restores the pipeline exactly as it was.
 *  Toggling ON simply reveals the (possibly empty) types/stages/statuses editors to build.
 *  Guarded at the route by the existing module-management permission. */
export async function setPipelineEnabled(tenantId: string, recordType: string, enabled: boolean): Promise<any> {
  const row = await loadTypeRow(tenantId, recordType);
  const updated = await db.recordType.update({ where: { id: row.id }, data: { pipelineEnabled: !!enabled } });
  return serializeRecordType(updated);
}

// ---- VIEWS config -----------------------------------------------------------
// A module's OPTIONAL views (beyond the always-on table/list). Availability is derived
// from real data — Board requires a pipeline, Calendar requires a date/datetime field —
// so we VALIDATE the requested set against that reality and drop (never silently keep)
// anything that isn't actually available. Guarded at the route by the module-management
// permission. Non-destructive: turning a view off just hides it on the list page.
const KNOWN_VIEWS = ["board", "calendar", "map", "gallery"]; // all four optional views are live

/** The date-ish fields a module can lay a calendar out by: any date/datetime FieldDef,
 *  plus the typed "appointmentAt" column for Bookings (which is not a FieldDef). */
export async function calendarDateFieldKeys(tenantId: string, recordTypeId: string, typeKey: string): Promise<string[]> {
  const defs = await db.fieldDef.findMany({ where: { tenantId, recordTypeId }, select: { key: true, type: true } });
  const keys = defs.filter((f: any) => f.type === "date" || f.type === "datetime").map((f: any) => f.key);
  // Typed-appointment modules (Bookings and Work Orders) lay out by the real
  // Record.appointmentAt column, offered first. Registry-derived — no key literals.
  if (usesTypedAppointment(typeKey)) keys.unshift("appointmentAt");
  return keys;
}

/** The address fields a module can plot on a map (any address-type FieldDef, by order). */
export async function addressFieldKeys(tenantId: string, recordTypeId: string): Promise<string[]> {
  const defs = await db.fieldDef.findMany({ where: { tenantId, recordTypeId, type: "address" }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { key: true } });
  return defs.map((f: any) => f.key);
}

/** The image fields a module can build a gallery from (any image-type FieldDef, by order). */
export async function imageFieldKeys(tenantId: string, recordTypeId: string): Promise<string[]> {
  const defs = await db.fieldDef.findMany({ where: { tenantId, recordTypeId, type: "image" }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { key: true } });
  return defs.map((f: any) => f.key);
}

/** Turn the module's optional views on/off. Validates availability from real data and
 *  resolves calendarDateField to an actual date field (or the first available one). */
export async function setModuleViews(
  tenantId: string,
  recordType: string,
  input: { enabledViews?: any; calendarDateField?: any; calendarLanes?: any; calendarTray?: any },
): Promise<any> {
  const row = await loadTypeRow(tenantId, recordType);
  const hasPipeline =
    row.pipelineEnabled === true ||
    (Array.isArray(row.subtypes) && row.subtypes.length > 0) ||
    (Array.isArray(row.recordStages) && row.recordStages.length > 0) ||
    (Array.isArray(row.stages) && row.stages.length > 0);
  const dateKeys = await calendarDateFieldKeys(tenantId, row.id, row.key);
  const addrKeys = await addressFieldKeys(tenantId, row.id);
  const imgKeys = await imageFieldKeys(tenantId, row.id);

  const requested = Array.isArray(input.enabledViews) ? input.enabledViews.map((v: any) => String(v)) : [];
  const next: string[] = [];
  for (const v of KNOWN_VIEWS) {
    if (!requested.includes(v)) continue;
    if (v === "board" && !hasPipeline) throw new Error("Turn on a pipeline to enable the Board view.");
    if (v === "calendar" && dateKeys.length === 0) throw new Error("Add a date field to enable the Calendar view.");
    if (v === "map" && addrKeys.length === 0) throw new Error("Add an address field to enable the Map view.");
    if (v === "gallery" && imgKeys.length === 0) throw new Error("Add an image field to enable the Gallery view.");
    if (!next.includes(v)) next.push(v);
  }

  // Resolve the calendar's date field: keep the requested one if it's a real date field,
  // else keep the existing one if still valid, else default to the first available field.
  let calField: string | null = row.calendarDateField ?? null;
  if (input.calendarDateField !== undefined) {
    const req = input.calendarDateField == null ? null : String(input.calendarDateField);
    calField = req && dateKeys.includes(req) ? req : calField;
  }
  if (next.includes("calendar")) {
    if (!calField || !dateKeys.includes(calField)) calField = dateKeys[0] ?? null;
  }

  // Scheduling-calendar options (Scheduling Calendar batch). Same validate-and-
  // throw style as the views above; undefined = leave unchanged. Turning the
  // Calendar view OFF auto-clears both (non-destructive flags; flipping Calendar
  // back on starts them off again, the safe default).
  let lanes: boolean = row.calendarLanes === true;
  let tray: boolean = row.calendarTray === true;
  if (input.calendarLanes !== undefined) {
    const want = input.calendarLanes === true;
    if (want && !next.includes("calendar")) throw new Error("Turn on the Calendar view to enable this.");
    if (want && !isResourceCapable(row.key)) throw new Error("Lanes need staff assignment — available on Bookings and Work Orders.");
    lanes = want;
  }
  if (input.calendarTray !== undefined) {
    const want = input.calendarTray === true;
    if (want && !next.includes("calendar")) throw new Error("Turn on the Calendar view to enable this.");
    tray = want;
  }
  if (!next.includes("calendar")) { lanes = false; tray = false; }

  const updated = await db.recordType.update({
    where: { id: row.id },
    data: { enabledViews: next as any, calendarDateField: calField, calendarLanes: lanes, calendarTray: tray },
  });
  return serializeRecordType(updated);
}
export async function addSubtype(tenantId: string, recordType: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Type name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const key = slugify(lbl, subtypes.map((s) => s.key), "type");
  subtypes.push({ key, label: lbl, order: subtypes.length, stages: [] });
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

export async function renameSubtype(tenantId: string, recordType: string, key: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Type name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  findSubtype(subtypes, key).label = lbl; // key stays stable; existing jobs keep their type
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

export async function reorderSubtypes(tenantId: string, recordType: string, orderedKeys: string[]) {
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const byKey: Record<string, any> = {}; subtypes.forEach((s) => (byKey[s.key] = s));
  const next: any[] = [];
  (orderedKeys || []).forEach((k) => { if (byKey[k]) { next.push(byKey[k]); delete byKey[k]; } });
  subtypes.forEach((s) => { if (byKey[s.key]) next.push(s); });
  next.forEach((s, i) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { subtypes: next } });
  return serializeRecordType({ ...row, subtypes: next });
}

/** Active records of this type currently assigned to a given subtype (job type). */
export async function countRecordsOfSubtype(tenantId: string, recordTypeId: string, subtypeKey: string): Promise<number> {
  return db.record.count({ where: { tenantId, recordTypeId, subtypeKey, deletedAt: null } });
}

export async function deleteSubtype(tenantId: string, recordType: string, key: string) {
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  if (!subtypes.some((s) => s.key === key)) throw new Error("Type not found");
  const inUse = await countRecordsOfSubtype(tenantId, row.id, key);
  if (inUse > 0) throw new Error(`${inUse} record${inUse === 1 ? "" : "s"} use${inUse === 1 ? "s" : ""} this type — change ${inUse === 1 ? "its" : "their"} type first.`);
  const next = subtypes.filter((s) => s.key !== key);
  next.forEach((s, i) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { subtypes: next } });
  return serializeRecordType({ ...row, subtypes: next });
}

// ---- Stages within a subtype's pipeline ----
export async function addStage(tenantId: string, recordType: string, subtypeKey: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Stage name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const st = findSubtype(subtypes, subtypeKey);
  const key = slugify(lbl, st.stages.map((s: any) => s.key), "stage");
  st.stages.push({ key, label: lbl, order: st.stages.length });
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

export async function renameStage(tenantId: string, recordType: string, subtypeKey: string, key: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Stage name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const st = findSubtype(subtypes, subtypeKey);
  const s = st.stages.find((x: any) => x.key === key);
  if (!s) throw new Error("Stage not found");
  s.label = lbl; // key unchanged — existing candidate links keep working
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

export async function reorderStages(tenantId: string, recordType: string, subtypeKey: string, orderedKeys: string[]) {
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const st = findSubtype(subtypes, subtypeKey);
  const byKey: Record<string, any> = {}; st.stages.forEach((s: any) => (byKey[s.key] = s));
  const next: any[] = [];
  (orderedKeys || []).forEach((k) => { if (byKey[k]) { next.push(byKey[k]); delete byKey[k]; } });
  st.stages.forEach((s: any) => { if (byKey[s.key]) next.push(s); });
  next.forEach((s, i) => (s.order = i));
  st.stages = next;
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

/** Active candidate links sitting in a given stage, for jobs of a given subtype. */
export async function countCandidatesInStage(tenantId: string, recordTypeId: string, subtypeKey: string, stageKey: string): Promise<number> {
  const recs = await db.record.findMany({ where: { tenantId, recordTypeId, subtypeKey, deletedAt: null }, select: { id: true } });
  const ids = recs.map((r: any) => r.id);
  if (!ids.length) return 0;
  return db.recordLink.count({ where: { tenantId, recordId: { in: ids }, stageKey, deletedAt: null } });
}

export async function deleteStage(tenantId: string, recordType: string, subtypeKey: string, key: string) {
  const row = await loadTypeRow(tenantId, recordType);
  const subtypes = normSubtypes(row.subtypes);
  const st = findSubtype(subtypes, subtypeKey);
  if (!st.stages.some((s: any) => s.key === key)) throw new Error("Stage not found");
  const inUse = await countCandidatesInStage(tenantId, row.id, subtypeKey, key);
  if (inUse > 0) throw new Error(`${inUse} candidate${inUse === 1 ? " is" : "s are"} in this stage — move ${inUse === 1 ? "it" : "them"} to another stage first.`);
  st.stages = st.stages.filter((s: any) => s.key !== key);
  st.stages.forEach((s: any, i: number) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { subtypes } });
  return serializeRecordType({ ...row, subtypes });
}

/** Stages for a record's subtype (its job-type pipeline); falls back to legacy stages. */
export async function stagesForSubtype(tenantId: string, recordTypeId: string, subtypeKey?: string | null): Promise<any[]> {
  const row = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  if (!row) return [];
  const subtypes = normSubtypes(row.subtypes);
  const st = subtypeKey ? subtypes.find((s) => s.key === subtypeKey) : null;
  return st ? st.stages : normStages(row.stages);
}

/** Validate a subtype value for a record type. Returns the (possibly required) key. */
export async function validateSubtypeForType(tenantId: string, recordTypeId: string, subtypeKey: string | null | undefined, opts: { required: boolean }): Promise<string | null> {
  const row = await db.recordType.findFirst({ where: { tenantId, id: recordTypeId } });
  const subtypes = normSubtypes(row ? row.subtypes : []);
  if (!subtypes.length) return null; // this type has no subtypes — nothing to set
  const key = (subtypeKey || "").toString().trim();
  if (!key) { if (opts.required) throw new Error("Type is required"); return null; }
  if (!subtypes.some((s) => s.key === key)) throw new Error("Unknown type");
  return key;
}

// ============================================================================
// Record-level STATUS editor (RecordType.recordStages)
// ----------------------------------------------------------------------------
// recordStages is a JSON array {key,label,order} on the record type — the Status
// dropdown on a record's OWN profile (Record.stageKey). This is DISTINCT from
// pipeline stages (subtypes[].stages / RecordLink.stageKey). These functions
// mirror the subtype/stage editors above: keys are immutable, rename is a
// label-only change, reorder is cosmetic. Delete runs a DUAL guard (records in
// use AND automations referencing the key) and refuses with a blocker list.
// ============================================================================

function normRecordStages(stages: any): { key: string; label: string; order: number }[] {
  return (Array.isArray(stages) ? stages : []).map((s: any, i: number) => ({ key: String(s.key), label: String(s.label ?? s.key), order: i }));
}

export async function addRecordStatus(tenantId: string, recordType: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Status name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const recordStages = normRecordStages(row.recordStages);
  const key = slugify(lbl, recordStages.map((s) => s.key), "status");
  recordStages.push({ key, label: lbl, order: recordStages.length });
  await db.recordType.update({ where: { id: row.id }, data: { recordStages } });
  return serializeRecordType({ ...row, recordStages });
}

export async function renameRecordStatus(tenantId: string, recordType: string, key: string, label: string) {
  const lbl = String(label || "").trim();
  if (!lbl) throw new Error("Status name is required");
  const row = await loadTypeRow(tenantId, recordType);
  const recordStages = normRecordStages(row.recordStages);
  const s = recordStages.find((x) => x.key === key);
  if (!s) throw new Error("Status not found");
  s.label = lbl; // key stays stable — existing records & automations keep working
  await db.recordType.update({ where: { id: row.id }, data: { recordStages } });
  return serializeRecordType({ ...row, recordStages });
}

export async function reorderRecordStatuses(tenantId: string, recordType: string, orderedKeys: string[]) {
  const row = await loadTypeRow(tenantId, recordType);
  const recordStages = normRecordStages(row.recordStages);
  const byKey: Record<string, any> = {}; recordStages.forEach((s) => (byKey[s.key] = s));
  const next: any[] = [];
  (orderedKeys || []).forEach((k) => { if (byKey[k]) { next.push(byKey[k]); delete byKey[k]; } });
  recordStages.forEach((s) => { if (byKey[s.key]) next.push(s); });
  next.forEach((s, i) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { recordStages: next } });
  return serializeRecordType({ ...row, recordStages: next });
}

/** Active records of this type currently holding a given status key. */
export async function countRecordsInStatus(tenantId: string, recordTypeId: string, key: string): Promise<number> {
  return db.record.count({ where: { tenantId, recordTypeId, stageKey: key, deletedAt: null } });
}

// PURE detector (no DB): given one automation row and a status key, return where
// it references that key — any of "a trigger" / "an action" / "a condition".
// Match is by key string, since keys are what every reference stores. This is
// the exact logic the delete guard uses; kept pure so it can be unit-tested.
export function statusRefsInAutomation(auto: any, key: string): string[] {
  const where: string[] = [];
  if (auto && String(auto.triggerType || "") === "RecordUpdated:status=" + key) where.push("a trigger");
  const actions = Array.isArray(auto && auto.actions) ? auto.actions : [];
  const actionHit = actions.some((a: any) => {
    if (!a) return false;
    if (a.type === "set_record_field" && a.field === "status" && a.value === key) return true;
    if (a.type === "update_record_item" && Array.isArray(a.values) && a.values.some((v: any) => v && v.field === "status" && v.value === key)) return true;
    if (a.type === "create_record_item" && a.stageKey === key) return true;
    return false;
  });
  if (actionHit) where.push("an action");
  const conds = Array.isArray(auto && auto.conditions) ? auto.conditions : [];
  if (conds.some((c: any) => c && c.field === "status" && c.value === key)) where.push("a condition");
  return where;
}

/** Automations in the tenant referencing this status key (id + name + where). */
export async function automationsReferencingStatus(tenantId: string, key: string): Promise<{ id: string; name: string; where: string[] }[]> {
  const autos = await db.automation.findMany({ where: { tenantId } });
  const out: { id: string; name: string; where: string[] }[] = [];
  for (const a of autos as any[]) {
    const where = statusRefsInAutomation(a, key);
    if (where.length) out.push({ id: a.id, name: a.name || "(untitled automation)", where });
  }
  return out;
}

export async function deleteRecordStatus(tenantId: string, recordType: string, key: string) {
  const row = await loadTypeRow(tenantId, recordType);
  const recordStages = normRecordStages(row.recordStages);
  const target = recordStages.find((s) => s.key === key);
  if (!target) throw new Error("Status not found");
  // DUAL GUARD — records holding it (scoped to this type) AND automations
  // referencing the key (tenant-wide, conservative). Refuse with a blocker list.
  const recordCount = await countRecordsInStatus(tenantId, row.id, key);
  const records = recordCount > 0
    ? (await db.record.findMany({ where: { tenantId, recordTypeId: row.id, stageKey: key, deletedAt: null }, select: { id: true, title: true }, take: 25, orderBy: { createdAt: "desc" } }))
        .map((r: any) => ({ id: r.id, title: r.title || "(untitled)" }))
    : [];
  const automations = await automationsReferencingStatus(tenantId, key);
  if (recordCount > 0 || automations.length > 0) {
    const err: any = new Error("STATUS_IN_USE");
    err.code = "STATUS_IN_USE";
    err.blockers = { status: { key, label: target.label || key }, recordCount, records, automations };
    throw err;
  }
  const next = recordStages.filter((s) => s.key !== key);
  next.forEach((s, i) => (s.order = i));
  await db.recordType.update({ where: { id: row.id }, data: { recordStages: next } });
  return serializeRecordType({ ...row, recordStages: next });
}
