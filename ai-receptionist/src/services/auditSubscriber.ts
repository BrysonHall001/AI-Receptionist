// Developer Tools batch 2 — the EVENT-BUS AUDIT SUBSCRIBER.
//
// The domain event bus (src/events/bus.ts) already carries the record/contact
// lifecycle, booking changes, sends, and the AI-instructions edit — so for those we
// SUBSCRIBE rather than double-hook the services (the cardinal no-double-capture
// rule: each mutation is captured from exactly ONE place). Diffs are built from the
// payload's changes[] — values the emitter already had in hand; no extra reads.
//
// Handled here (and ONLY here):        Ignored here (captured elsewhere or derived):
//   ContactCreated/Updated/Deleted/      FieldChanged, Tag*   (facets of ContactUpdated)
//   Restored, StageChanged               NoteAdded, ActivityLogged (not in the catalog)
//   RecordCreated/Updated/Deleted/       CallLeadCreated (engine-derived, never emitted)
//   Restored, Booking*                   bulk/import SUMMARIES (route/handler hooks —
//   EmailSent, SMSSent                     the per-item events still land here)
//   AiInstructionsUpdated
import { subscribe } from "../events/bus";
import type { DomainEvent } from "../events/types";
import { audit } from "./auditService";
import { AUDIT_ACTIONS } from "./auditCatalog";

function actorTypeOf(e: DomainEvent): "user" | "system" | "ai" | "automation" {
  const t = e.actor?.type;
  if (t === "user") return "user";
  if (t === "sync" || t === "system") return "system";
  // bus "automation": the AI receptionist emits with the "AI receptionist" name (the
  // deletedByFromActor convention); the automation ENGINE emits without it.
  if (t === "automation") return (e.actor?.name === "AI receptionist" || (e.payload as any)?.source === "phone") ? "ai" : "automation";
  return "system";
}
function actorLabelOf(e: DomainEvent): string {
  return (e.actor?.name && String(e.actor.name).trim()) || (actorTypeOf(e) === "ai" ? "AI receptionist" : actorTypeOf(e) === "automation" ? "Automation" : "System");
}
function diffFromChanges(payload: any): Record<string, { from: unknown; to: unknown }> | null {
  const ch = payload && Array.isArray(payload.changes) ? payload.changes : null;
  if (!ch || !ch.length) return null;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const c of ch) if (c && c.field) out[String(c.field)] = { from: (c as any).old, to: (c as any).new };
  return Object.keys(out).length ? out : null;
}

export function registerAuditSubscriber(): void {
  subscribe((e: DomainEvent) => {
    try {
      const base = {
        tenantId: e.tenantId || null,
        actorType: actorTypeOf(e),
        actorId: e.actor?.id || null,
        actorLabel: actorLabelOf(e),
        actorRole: (e.actor && (e.actor as any).role) || null,
        subjectId: e.subject?.id || null,
      };
      const p: any = e.payload || {};
      switch (e.type) {
        case "ContactCreated": {
          const ai = base.actorType === "ai";
          audit({ ...base, action: ai ? AUDIT_ACTIONS.AI_CONTACT_CREATED : AUDIT_ACTIONS.CONTACT_CREATE, subjectType: "contact", subjectLabel: p.name || null, meta: p.source ? { source: p.source } : null });
          return;
        }
        case "ContactUpdated": audit({ ...base, action: AUDIT_ACTIONS.CONTACT_UPDATE, subjectType: "contact", subjectLabel: p.name || null, diff: diffFromChanges(p) }); return;
        case "StageChanged": audit({ ...base, action: AUDIT_ACTIONS.CONTACT_UPDATE, subjectType: "contact", subjectLabel: p.name || null, diff: diffFromChanges(p) || (p.old !== undefined || p.new !== undefined ? { stage: { from: p.old, to: p.new } } : null) }); return;
        case "ContactDeleted": audit({ ...base, action: AUDIT_ACTIONS.CONTACT_DELETE, subjectType: "contact" }); return;
        case "ContactRestored": audit({ ...base, action: AUDIT_ACTIONS.CONTACT_RESTORE, subjectType: "contact" }); return;
        case "RecordCreated": audit({ ...base, action: AUDIT_ACTIONS.RECORD_CREATE, subjectType: "record", subjectLabel: p.record_title || null, recordTypeKey: p.record_type_key || p.record_type || null }); return;
        case "BookingCreated": {
          const ai = base.actorType === "ai";
          audit({ ...base, action: ai ? AUDIT_ACTIONS.AI_BOOKING_CREATED : AUDIT_ACTIONS.RECORD_CREATE, subjectType: "record", subjectLabel: p.record_title || p.booking_title || null, recordTypeKey: "booking" });
          return;
        }
        case "RecordUpdated":
        case "BookingStatusChanged":
        case "BookingRescheduled":
        case "BookingResourceChanged":
          audit({ ...base, action: AUDIT_ACTIONS.RECORD_UPDATE, subjectType: "record", subjectLabel: p.record_title || null, recordTypeKey: p.record_type_key || (e.type.startsWith("Booking") ? "booking" : null), diff: diffFromChanges(p) });
          return;
        case "RecordDeleted": audit({ ...base, action: AUDIT_ACTIONS.RECORD_DELETE, subjectType: "record" }); return;
        case "RecordRestored": audit({ ...base, action: AUDIT_ACTIONS.RECORD_RESTORE, subjectType: "record" }); return;
        case "EmailSent": audit({ ...base, action: AUDIT_ACTIONS.EMAIL_SENT, subjectType: "communication", subjectLabel: p.subject || p.template || null, meta: { recipients: p.recipients ?? p.recipient_count ?? 1 } }); return; // never bodies
        case "SMSSent": audit({ ...base, action: AUDIT_ACTIONS.SMS_SENT, subjectType: "communication", meta: { recipients: p.recipients ?? 1 } }); return; // never bodies
        case "AiInstructionsUpdated": audit({ ...base, action: AUDIT_ACTIONS.SETTINGS_AI, subjectType: "settings", subjectLabel: "AI instructions" }); return;
        default: return; // everything else: not in the catalog, or captured at its own hook
      }
    } catch { /* the subscriber must never break dispatch */ }
  });
}
