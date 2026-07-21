// Developer Tools batch 2 — THE AUDIT ACTION CATALOG.
//
// The vocabulary is FIXED here: call sites import these constants; new actions are
// added here first (never inline strings), so the viewer (batch 3) can enumerate,
// group, and label every action the system can emit. Dot-namespaced: area.verb.
export const AUDIT_ACTIONS = {
  // records + contacts (updates carry a field-level diff)
  RECORD_CREATE: "record.create",
  RECORD_UPDATE: "record.update",
  RECORD_DELETE: "record.delete",
  RECORD_RESTORE: "record.restore",
  RECORD_PURGE: "record.purge",
  CONTACT_CREATE: "contact.create",
  CONTACT_UPDATE: "contact.update",
  CONTACT_DELETE: "contact.delete",
  CONTACT_RESTORE: "contact.restore",
  CONTACT_PURGE: "contact.purge",
  // structure (Modules & Fields)
  MODULE_CREATE: "structure.module.create",
  MODULE_UPDATE: "structure.module.update",
  MODULE_DELETE: "structure.module.delete",
  FIELD_CREATE: "structure.field.create",
  FIELD_UPDATE: "structure.field.update",
  FIELD_DELETE: "structure.field.delete",
  STAGES_UPDATE: "structure.stages.update",
  TERMS_UPDATE: "structure.terms.update",
  VIEWS_UPDATE: "structure.views.update",
  SECTION_UPDATE: "structure.section.update",
  // settings (setting-level diffs)
  SETTINGS_APPEARANCE: "settings.appearance.update",
  SETTINGS_AI: "settings.aireceptionist.update",
  SETTINGS_INTEGRATIONS: "settings.integrations.update",
  SETTINGS_PROFILE: "settings.profile.update",
  SETTINGS_SCHEDULING: "settings.scheduling.update",
  SETTINGS_PERMISSIONS: "settings.permissions.update",
  // auth (IP in meta)
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_LOGIN_FAILED: "auth.login_failed",
  IMPERSONATION_START: "auth.impersonation.start",
  IMPERSONATION_END: "auth.impersonation.end",
  // data movement (counts in meta)
  IMPORT_RUN: "data.import",
  EXPORT_RUN: "data.export",
  BULK_UPDATE: "data.bulk_update",
  BULK_DELETE: "data.bulk_delete",
  // automation + communication (never message bodies; recipient counts in meta)
  AUTOMATION_EXECUTED: "automation.executed",
  EMAIL_SENT: "communication.email.sent",
  SMS_SENT: "communication.sms.sent",
  // AI receptionist mutations (actorType "ai")
  AI_CONTACT_CREATED: "ai.contact.create",
  AI_BOOKING_CREATED: "ai.booking.create",
  // master hub (tenantId null or the target tenant, as appropriate)
  HUB_TENANT_CREATE: "hub.tenant.create",
  HUB_TENANT_SUSPEND: "hub.tenant.suspend",
  HUB_SETTINGS_UPDATE: "hub.settings.update",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
export const AUDIT_ACTION_VALUES: string[] = Object.values(AUDIT_ACTIONS);

export const AUDIT_ACTOR_TYPES = ["user", "system", "ai", "automation"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

// Retention policy (named config — no magic numbers at the sweep site).
export const AUDIT_RETENTION = {
  ACTIVE_DAYS: 14,          // active -> pending_deletion after 14 days
  PENDING_DAYS: 14,         // pending_deletion -> hard delete after 14 MORE days
  SWEEP_BATCH_SIZE: 500,    // bounded batches per tick, both phases
} as const;
