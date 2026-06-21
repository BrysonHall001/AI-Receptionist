import { z } from "zod";

/** Structured data the receptionist extracts from the caller. */
export const ExtractedSchema = z.object({
  name: z.string().nullable().optional(),
  intent: z.string().nullable().optional(),
  // The callback number the caller SPEAKS or spells out — capture the digits they
  // say (even given one at a time, "one one two three…") here, e.g. "1123456789".
  // This is the number to reach them on, and is SEPARATE from the verified inbound
  // caller ID (tracked elsewhere). Never put the caller-ID number here when the
  // caller has stated a different one. Null when they haven't given a number.
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  // Appointment capture (capture-only). A ZONELESS wall-clock string in the
  // EXACT picker format "YYYY-MM-DDTHH:MM" (24-hour), or null when no concrete
  // date+time has been confirmed. Stored verbatim as the booking's wall-clock
  // appointmentAt — never converted. SAY IT, RECORD IT: the instant you tell the
  // caller a specific date/time is booked, this MUST hold that exact value on the
  // same turn — announcing a booking with this left null loses the booking.
  appointment_datetime: z.string().nullable().optional(),
  // The caller's words for what they want booked (mapped to a Booking service
  // later). If you state the service to the caller, record their words here.
  service: z.string().nullable().optional(),
  // The staff member the booking was made with: the one the caller named, OR the
  // one YOU (the assistant) selected and STATED to the caller (e.g. when the caller
  // had no preference and you said "I've got you with Alice"). Whatever staff name
  // you say out loud for the booking MUST be recorded here verbatim, so the booking
  // matches what you told the caller. Null ONLY when no staff was named or announced.
  // Fuzzy-matched to a real configured resource at booking time.
  resource: z.string().nullable().optional(),
});
export type Extracted = z.infer<typeof ExtractedSchema>;

/** The STRICT JSON contract the model must return on every turn (LAYER 3). */
export const AIResponseSchema = z.object({
  message_to_speak: z.string().min(1),
  extracted: ExtractedSchema,
  state_update: z.enum(["GREETING", "COLLECTING_INFO", "COMPLETED"]),
});
export type AIResponse = z.infer<typeof AIResponseSchema>;
