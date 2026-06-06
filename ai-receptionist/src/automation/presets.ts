// Built-in automation presets ("templates").
//
// Each preset is a declarative FlowDefinition (trigger + conditions + actions,
// using ONLY trigger/action types that already exist in the engine) plus the
// plain-English text the library shows. There is no new data model: applying a
// preset creates a normal Automation row via the shared applyFlowDefinition()
// plumbing, as an inactive DRAFT.
//
// CATEGORIES (visible in the UI): function-based, niche-agnostic groupings.
// Reorder or rename them in PRESET_CATEGORIES below — that one array is the
// single source of truth for the library's section order and labels.
//
// HIDDEN INTERNAL VERTICAL TAG: every preset also carries `vertical`, an
// internal-only label for future master-hub templating. It is metadata only and
// is NEVER sent to the browser (the presets route does not include it in its
// response) — no industry/vertical wording ever appears in the user-facing UI.
//
// "Standard fields" (name, phone, email, intent, createdAt) always exist, so
// presets using only those apply cleanly. Presets that reference a custom field
// (owner, status, a date field, …) still apply, but get flagged by the EXISTING
// missing-field check for the user to create/map that field before turning the
// automation on. That flag firing on field-dependent templates is expected.

import type { FlowDefinition } from "../services/flowProvisioningService";

export interface PresetCategory {
  key: string;
  label: string;
}

// The ONLY grouping the user sees. Function-based, never industry-based.
// Rename/reorder here; nothing else needs to change.
export const PRESET_CATEGORIES: PresetCategory[] = [
  { key: "lead_capture", label: "Lead capture & routing" },
  { key: "follow_ups", label: "Follow-ups" },
  { key: "pipeline", label: "Pipeline & status" },
  { key: "stay_in_touch", label: "Stay in touch" },
];

// Internal-only. NOT shown anywhere in the UI; not sent to the browser.
export type Vertical = "recruiting" | "home_services" | "insurance" | "general";

export interface PresetSummary {
  trigger: string; // "When …"
  conditions: string[]; // "If …" (empty => always runs)
  actions: string[]; // "Then …"
}

export interface PresetShape {
  trigger: string; // short label for the visual cue
  actions: string[]; // short action labels for the visual cue
}

export interface FlowPreset {
  key: string;
  name: string;
  description: string;
  category: string; // one of PRESET_CATEGORIES[].key
  vertical: Vertical; // HIDDEN internal tag — never surfaced in the UI
  summary: PresetSummary;
  shape: PresetShape;
  definition: FlowDefinition;
  note?: string;
}

export const AUTOMATION_PRESETS: FlowPreset[] = [
  // ===================== Existing 5 (now categorized) =====================
  {
    key: "welcome_new_contact",
    name: "Welcome new contact",
    description: "Send a friendly intro email the moment a new contact is added.",
    category: "stay_in_touch",
    vertical: "general",
    summary: {
      trigger: "A new contact is created",
      conditions: ["Only if the contact has an email address"],
      actions: ["Send them a welcome email"],
    },
    shape: { trigger: "New contact", actions: ["Send email"] },
    definition: {
      name: "Welcome new contact",
      triggerType: "ContactCreated",
      conditions: [{ field: "email", op: "not_empty" }],
      actions: [
        {
          type: "send_email",
          config: {
            subject: "Welcome, {{name}}!",
            html:
              "<p>Hi {{name}},</p>" +
              "<p>Thanks for connecting with us — we're glad you're here. " +
              "If you have any questions, just reply to this email and a real person will help.</p>" +
              "<p>— The team</p>",
          },
        },
      ],
    },
    note: "Uses only standard fields, so it applies cleanly. The email won't actually send until your email service (Resend) is connected — until then it just sits as a harmless draft.",
  },
  {
    key: "stale_contact_followup",
    name: "Stale contact follow-up",
    description: "A few days after a contact is added, drop an internal reminder to follow up.",
    category: "follow_ups",
    vertical: "general",
    summary: {
      trigger: "7 days after a contact's created date",
      conditions: ["Runs for every contact"],
      actions: ["Add an internal follow-up note on the contact"],
    },
    shape: { trigger: "7 days after created", actions: ["Add note"] },
    definition: {
      name: "Stale contact follow-up",
      triggerType: "Scheduled:createdAt:7:days:after",
      conditions: [],
      actions: [
        {
          type: "create_note",
          config: { text: "Follow up with {{name}} — added a week ago, check there's been some activity." },
        },
      ],
    },
    note: "Uses the standard created date, so it applies cleanly. It runs on the scheduled-jobs sweep (triggered by a super-admin now, and a host cron later). If you later add a custom 'last activity' date field, you can point the trigger at it instead.",
  },
  {
    key: "unassigned_lead",
    name: "Unassigned lead",
    description: "Flag brand-new contacts that don't have an owner yet so they don't slip through.",
    category: "lead_capture",
    vertical: "general",
    summary: {
      trigger: "A new contact is created",
      conditions: ["Only if the contact has no owner"],
      actions: ["Add an internal note flagging it for assignment"],
    },
    shape: { trigger: "New contact", actions: ["Flag for assignment"] },
    definition: {
      name: "Unassigned lead",
      triggerType: "ContactCreated",
      conditions: [{ field: "owner", op: "empty" }],
      actions: [
        {
          type: "create_note",
          config: { text: "New lead {{name}} has no owner — please assign someone." },
        },
      ],
    },
    note: "Expects an 'owner' field. If this portal doesn't have one, the preset still applies as a draft and is flagged so you can create or map the field before turning it on.",
  },
  {
    key: "status_moved_forward",
    name: "Status moved forward",
    description: "When a contact's status/stage changes, create a reminder to do the next step.",
    category: "pipeline",
    vertical: "general",
    summary: {
      trigger: "The 'status' field changes",
      conditions: ["Runs whenever status changes"],
      actions: ["Add an internal next-step note"],
    },
    shape: { trigger: "Status changes", actions: ["Add note"] },
    definition: {
      name: "Status moved forward",
      triggerType: "FieldChanged:status",
      conditions: [],
      actions: [
        {
          type: "create_note",
          config: { text: "{{name}}'s status changed — create the next-step task." },
        },
      ],
    },
    note: "Expects a 'status' (stage) field. If it doesn't exist in this portal, the preset is flagged so you can create or map it before activating.",
  },
  {
    key: "inbound_webhook_lead",
    name: "Inbound webhook lead",
    description: "Stamp a source on contacts as they arrive so webhook leads are easy to spot.",
    category: "lead_capture",
    vertical: "general",
    summary: {
      trigger: "A new contact is created (e.g. via an inbound webhook)",
      conditions: ["Runs for every new contact"],
      actions: ["Set the contact's 'source' to 'Inbound webhook'"],
    },
    shape: { trigger: "New contact", actions: ["Set source"] },
    definition: {
      name: "Inbound webhook lead",
      triggerType: "ContactCreated",
      conditions: [],
      actions: [
        {
          type: "update_field",
          config: { field: "source", value: "Inbound webhook" },
        },
      ],
    },
    note: "Pairs with an Inbound Webhook endpoint (Settings → Inbound webhooks), which creates the contact. Expects a 'source' field; if missing, the preset is flagged so you can add it first.",
  },

  // ===================== New: Lead capture & routing =====================
  {
    key: "speed_to_lead_callback",
    name: "Speed-to-lead callback",
    description: "The instant a new lead arrives, flag it for an immediate call back and text them.",
    category: "lead_capture",
    vertical: "home_services",
    summary: {
      trigger: "A new contact is created",
      conditions: ["Runs for every new lead"],
      actions: ["Add a 'call back ASAP' note", "Text the lead a quick acknowledgement (optional)"],
    },
    shape: { trigger: "New lead", actions: ["Call-back note", "Text lead"] },
    definition: {
      name: "Speed-to-lead callback",
      triggerType: "ContactCreated",
      conditions: [],
      actions: [
        { type: "create_note", config: { text: "New lead {{name}} just came in — call back ASAP." } },
        { type: "send_sms", config: { body: "Hi {{name}}, thanks for reaching out! We'll call you back shortly." } },
      ],
    },
    note: "Uses standard fields, so it applies cleanly. The text won't send until SMS (Twilio) is connected — until then it stays a harmless draft.",
  },
  {
    key: "new_lead_intake_assign",
    name: "New lead intake & assign",
    description: "Route a new, unowned lead to an owner and send a welcome message.",
    category: "lead_capture",
    vertical: "insurance",
    summary: {
      trigger: "A new contact is created",
      conditions: ["Only if the contact has no owner yet"],
      actions: ["Assign an owner (you pick who)", "Send a welcome/intro email"],
    },
    shape: { trigger: "New lead", actions: ["Assign owner", "Send email"] },
    definition: {
      name: "New lead intake & assign",
      triggerType: "ContactCreated",
      conditions: [{ field: "owner", op: "empty" }],
      actions: [
        { type: "assign_owner", config: { userId: "" } },
        {
          type: "send_email",
          config: {
            subject: "Welcome, {{name}}!",
            html: "<p>Hi {{name}},</p><p>Thanks for getting in touch — your dedicated contact will reach out shortly.</p>",
          },
        },
      ],
    },
    note: "Expects an 'owner' field. Open the draft to choose which owner to assign. Email won't send until Resend is connected; the draft is safe to apply meanwhile.",
  },

  // ===================== New: Follow-ups =====================
  {
    key: "quote_estimate_followup",
    name: "Quote / estimate follow-up",
    description: "After a quote is sent, wait a few days and remind yourself to chase a reply.",
    category: "follow_ups",
    vertical: "home_services",
    summary: {
      trigger: "The 'status' field changes",
      conditions: ["Only when status is 'Quote sent'"],
      actions: ["Wait 3 days", "Add a 'no response yet' follow-up note"],
    },
    shape: { trigger: "Status = Quote sent", actions: ["Wait 3 days", "Add note"] },
    definition: {
      name: "Quote / estimate follow-up",
      triggerType: "FieldChanged:status",
      conditions: [{ field: "status", op: "is", value: "Quote sent" }],
      actions: [
        { type: "wait", config: { amount: 3, unit: "days" } },
        { type: "create_note", config: { text: "No response to {{name}}'s quote after 3 days — follow up." } },
      ],
    },
    note: "Expects a 'status' (stage) field with a 'Quote sent' value. If missing, it's flagged so you can create or map it first. The wait step uses the scheduled-jobs sweep.",
  },
  {
    key: "missed_call_callback",
    name: "Missed-call callback",
    description: "After a missed call, queue a reminder to call the contact back (and optionally text them).",
    category: "follow_ups",
    vertical: "home_services",
    summary: {
      trigger: "You run it on a contact (from their record)",
      conditions: ["Runs on demand"],
      actions: ["Add a 'call back' note", "Text the contact (optional)"],
    },
    shape: { trigger: "Run on a contact", actions: ["Call-back note", "Text contact"] },
    definition: {
      name: "Missed-call callback",
      triggerType: "Manual",
      conditions: [],
      actions: [
        { type: "create_note", config: { text: "Missed call from {{name}} — call them back." } },
        { type: "send_sms", config: { body: "Hi {{name}}, sorry we missed your call! We'll ring you back shortly." } },
      ],
    },
    note: "There's no automatic 'missed call' trigger yet, so this is set to run manually from a contact's record. Applies cleanly; the text won't send until SMS (Twilio) is connected.",
  },
  {
    key: "document_application_followup",
    name: "Document / application follow-up",
    description: "When documents are pending, wait a few days and remind yourself to chase them.",
    category: "follow_ups",
    vertical: "insurance",
    summary: {
      trigger: "The 'status' field changes",
      conditions: ["Only when status is 'Docs pending'"],
      actions: ["Wait 5 days", "Add a 'documents still pending' note"],
    },
    shape: { trigger: "Status = Docs pending", actions: ["Wait 5 days", "Add note"] },
    definition: {
      name: "Document / application follow-up",
      triggerType: "FieldChanged:status",
      conditions: [{ field: "status", op: "is", value: "Docs pending" }],
      actions: [
        { type: "wait", config: { amount: 5, unit: "days" } },
        { type: "create_note", config: { text: "Documents still pending for {{name}} after 5 days — follow up." } },
      ],
    },
    note: "Expects a 'status' (stage) field with a 'Docs pending' value. If missing, it's flagged so you can create or map it first. The wait step uses the scheduled-jobs sweep.",
  },

  // ===================== New: Pipeline & status =====================
  {
    key: "job_complete_request_review",
    name: "Job complete → request review",
    description: "When work is marked complete, ask the customer for a review.",
    category: "pipeline",
    vertical: "home_services",
    summary: {
      trigger: "The 'status' field changes",
      conditions: ["Only when status is 'Job complete'"],
      actions: ["Email asking for a review", "Add a 'review requested' note"],
    },
    shape: { trigger: "Status = Job complete", actions: ["Send email", "Add note"] },
    definition: {
      name: "Job complete → request review",
      triggerType: "FieldChanged:status",
      conditions: [{ field: "status", op: "is", value: "Job complete" }],
      actions: [
        {
          type: "send_email",
          config: {
            subject: "How did we do, {{name}}?",
            html: "<p>Hi {{name}},</p><p>Thanks for choosing us! If you have a moment, we'd really appreciate a quick review.</p>",
          },
        },
        { type: "create_note", config: { text: "Job complete for {{name}} — review requested." } },
      ],
    },
    note: "Expects a 'status' (stage) field with a 'Job complete' value. If missing, it's flagged so you can create or map it first. Email won't send until Resend is connected.",
  },

  // ===================== New: Stay in touch =====================
  {
    key: "seasonal_service_reminder",
    name: "Seasonal service reminder",
    description: "When it's been a while since the last service, remind yourself to reach out.",
    category: "stay_in_touch",
    vertical: "home_services",
    summary: {
      trigger: "6 months after the 'last service date'",
      conditions: ["Runs for every contact with that date set"],
      actions: ["Add a 'time to reach out' reminder note"],
    },
    shape: { trigger: "6 months after last service", actions: ["Add note"] },
    definition: {
      name: "Seasonal service reminder",
      triggerType: "Scheduled:last_service_date:6:months:after",
      conditions: [],
      actions: [
        { type: "create_note", config: { text: "It's been a while since {{name}}'s last service — reach out to schedule the next one." } },
      ],
    },
    note: "Expects a date field 'last_service_date'. If missing, it's flagged so you can create or map it first. Runs on the scheduled-jobs sweep.",
  },
  {
    key: "policy_renewal_reminder",
    name: "Renewal reminder",
    description: "A month before a renewal date, remind yourself to reach out and renew.",
    category: "stay_in_touch",
    vertical: "insurance",
    summary: {
      trigger: "30 days before the 'renewal date'",
      conditions: ["Runs for every contact with that date set"],
      actions: ["Add a 'renewal coming up' note", "Send a reminder email"],
    },
    shape: { trigger: "30 days before renewal", actions: ["Add note", "Send email"] },
    definition: {
      name: "Renewal reminder",
      triggerType: "Scheduled:renewal_date:30:days:before",
      conditions: [],
      actions: [
        { type: "create_note", config: { text: "{{name}}'s renewal is 30 days out — reach out to renew." } },
        {
          type: "send_email",
          config: {
            subject: "Time to renew, {{name}}",
            html: "<p>Hi {{name}},</p><p>Your renewal is coming up soon. Let's make sure everything stays in place — reply and we'll take care of it.</p>",
          },
        },
      ],
    },
    note: "Expects a date field 'renewal_date'. If missing, it's flagged so you can create or map it first. Email won't send until Resend is connected. Runs on the scheduled-jobs sweep.",
  },
  {
    key: "annual_review_reminder",
    name: "Annual review reminder",
    description: "A year after the last review, remind yourself to schedule the next one.",
    category: "stay_in_touch",
    vertical: "insurance",
    summary: {
      trigger: "12 months after the 'last review date'",
      conditions: ["Runs for every contact with that date set"],
      actions: ["Add a 'due for review' reminder note"],
    },
    shape: { trigger: "12 months after last review", actions: ["Add note"] },
    definition: {
      name: "Annual review reminder",
      triggerType: "Scheduled:last_review_date:12:months:after",
      conditions: [],
      actions: [
        { type: "create_note", config: { text: "{{name}} is due for an annual review — schedule one." } },
      ],
    },
    note: "Expects a date field 'last_review_date'. If missing, it's flagged so you can create or map it first. Runs on the scheduled-jobs sweep.",
  },
  {
    key: "birthday_milestone_touch",
    name: "Birthday / milestone touch",
    description: "On a contact's birthday (or another set date), send a friendly note.",
    category: "stay_in_touch",
    vertical: "insurance",
    summary: {
      trigger: "On the 'birthday' date",
      conditions: ["Runs for every contact with that date set"],
      actions: ["Send a friendly birthday email", "Add a 'reach out' note"],
    },
    shape: { trigger: "On birthday", actions: ["Send email", "Add note"] },
    definition: {
      name: "Birthday / milestone touch",
      triggerType: "Scheduled:birthday:0:days:before",
      conditions: [],
      actions: [
        {
          type: "send_email",
          config: {
            subject: "Happy birthday, {{name}}!",
            html: "<p>Hi {{name}},</p><p>Wishing you a wonderful birthday from all of us!</p>",
          },
        },
        { type: "create_note", config: { text: "It's {{name}}'s birthday — send a friendly note." } },
      ],
    },
    note: "Expects a date field 'birthday'. If missing, it's flagged so you can create or map it first. Email won't send until Resend is connected. Runs on the scheduled-jobs sweep.",
  },
];

export function getPreset(key: string): FlowPreset | undefined {
  return AUTOMATION_PRESETS.find((p) => p.key === key);
}
