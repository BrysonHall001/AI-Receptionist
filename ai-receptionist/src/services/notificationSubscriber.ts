// EMERGENT LAYER 1 — the bus-driven PRODUCERS.
//
// Registered in index.ts beside registerAuditSubscriber(). Every producer here
// is a pure reader of an event the app ALREADY emits, so no service gained a
// call site, no operation gained latency, and a notification failure cannot
// reach its host: the bus dispatches subscribers inside setImmediate +
// .catch(log) AFTER emitEvent has returned (events/bus.ts dispatch()).
//
// Titles/bodies stay short and GENERIC — no message bodies, transcripts, or
// PII beyond the name the linked record already shows that user. The link
// carries the user to the real thing, where real permissions apply.
import { subscribe } from "../events/bus";
import { DomainEvent } from "../events/types";
import { EVENT_TYPES } from "../events/types";
import { notifyNever } from "./inAppNotificationService";
import { logger } from "../utils/logger";

let registered = false;

/** A person's display name is safe (the linked record already shows it to
 *  anyone who can open the link); anything longer is not our business. */
function nameOf(payload: any): string {
  const n = payload && (payload.name || payload.contactName || payload.title);
  const s = String(n || "").trim();
  return s ? s.slice(0, 60) : "Someone";
}

export function registerNotificationSubscriber(): void {
  if (registered) return;
  registered = true;
  subscribe((e: DomainEvent) => {
    try {
      const tenantId = e.tenantId;
      if (!tenantId) return;
      const p: any = e.payload || {};
      const subjectId = e.subject && e.subject.id ? String(e.subject.id) : null;

      if (e.type === EVENT_TYPES.ContactCreated) {
        // A LEAD is a contact that arrived on its own — a form submission or a
        // caller the receptionist captured. A contact typed in by hand is not
        // news to the person who just typed it.
        const src = String(p.source || "").toLowerCase();
        if (src !== "lead_capture" && src !== "phone" && src !== "inbound" && src !== "web") return;
        notifyNever({
          tenantId, category: "lead_captured",
          title: `New lead: ${nameOf(p)}`,
          body: src === "phone" ? "Captured from a call." : "Captured from a form.",
          link: subjectId ? `#/contact/${subjectId}` : "#/contacts",
        });
        return;
      }

      if (e.type === EVENT_TYPES.BookingCreated) {
        // BookingCreated is emitted when a booking is linked to a contact
        // (recordLinkService) — the app's own definition of "a booking was made
        // for someone".
        notifyNever({
          tenantId, category: "booking_created",
          title: p.record_title ? `Booking made: ${String(p.record_title).slice(0, 60)}` : "Booking made",
          body: null,
          link: subjectId ? `#/record/${subjectId}` : "#/bookings",
        });
        return;
      }

      if (e.type === EVENT_TYPES.BookingStatusChanged) {
        // The emitter's payload shape (recordService.emitBookingStatusChanged):
        // { record_id, record_title, old_status, new_status, changes[] }.
        const to = String(p.new_status || "").toLowerCase();
        if (to !== "cancelled" && to !== "no_show") return;
        notifyNever({
          tenantId, category: "booking_cancelled",
          title: to === "no_show" ? "Booking marked no-show" : "Booking cancelled",
          body: p.record_title ? String(p.record_title).slice(0, 60) : null,
          link: subjectId ? `#/record/${subjectId}` : "#/bookings",
        });
      }
    } catch (err) {
      // Belt and braces: the bus already swallows, but a producer must never be
      // the reason an event handler chain dies.
      logger.error(`notification subscriber error (${e.type}): ${(err as Error).message}`);
    }
  });
  logger.info("Notification subscriber registered on event bus");
}
