// Built-in automation presets ("templates").
//
// Each preset is just a declarative FlowDefinition (trigger + conditions +
// actions, using ONLY trigger/action types that already exist in the engine)
// plus the plain-English text the library shows. There is no new data model:
// applying a preset creates a normal Automation row via the shared
// applyFlowDefinition() plumbing, as an inactive DRAFT.
//
// The trigger/action SHAPES used here mirror what the builder reads/writes
// (see public/js/automations.js buildActionConfig + the FieldChanged:/Scheduled:
// trigger encodings), so an applied preset opens cleanly in the existing editor.
//
// "Standard fields" (name, phone, email, intent, createdAt) always exist, so
// presets that use only those apply cleanly. Presets that reference a custom
// field (owner, status, source, …) still apply, but get flagged for the user to
// create/map that field before turning the automation on.

import type { FlowDefinition } from "../services/flowProvisioningService";

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
  summary: PresetSummary;
  shape: PresetShape;
  definition: FlowDefinition;
  note?: string; // extra plain-English caveat
}

export const AUTOMATION_PRESETS: FlowPreset[] = [
  {
    key: "welcome_new_contact",
    name: "Welcome new contact",
    description: "Send a friendly intro email the moment a new contact is added.",
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
];

export function getPreset(key: string): FlowPreset | undefined {
  return AUTOMATION_PRESETS.find((p) => p.key === key);
}
