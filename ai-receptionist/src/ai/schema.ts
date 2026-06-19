import { z } from "zod";

/** Structured data the receptionist extracts from the caller. */
export const ExtractedSchema = z.object({
  name: z.string().nullable().optional(),
  intent: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  // Appointment capture (capture-only). A ZONELESS wall-clock string in the
  // EXACT picker format "YYYY-MM-DDTHH:MM" (24-hour), or null when no concrete
  // date+time has been confirmed. Stored verbatim as the booking's wall-clock
  // appointmentAt — never converted. `service` is the caller's words for what
  // they want booked (mapped to a Booking service later).
  appointment_datetime: z.string().nullable().optional(),
  service: z.string().nullable().optional(),
  // Staff/resource the caller asks for BY NAME (e.g. "I'd like Alice"), in the
  // caller's own words, or null when they don't name one. Fuzzy-matched to a real
  // configured resource at booking time; an unrecognized name falls back to
  // Unassigned (never an invented assignment).
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
