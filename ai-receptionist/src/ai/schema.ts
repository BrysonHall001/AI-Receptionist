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
  // ---- SERVICE REQUEST capture (AI intake batch). A caller describing a PROBLEM
  // that needs someone sent out — without booking a specific time — is a service
  // request. These fields are CAPTURE-ONLY; the work order is created at
  // finalization, never mid-call. request_title non-null IS the signal that this
  // call contains a service request — never fill it for a plain booking,
  // question, or message.
  // A SHORT problem label in plain words, e.g. "AC not cooling" or "Water heater
  // leaking" — the work order's title. Fill it the moment the caller has described
  // a problem needing service; null on calls that aren't service requests.
  request_title: z.string().nullable().optional(),
  // The caller's OWN description of the problem — their words, lightly cleaned
  // (what's wrong, since when, anything they tried). Grows as they add detail.
  request_details: z.string().nullable().optional(),
  // The address the visit should go to, AS SPOKEN, in one line (street, city,
  // and anything else they give). Only ask when the visit location isn't already
  // known from caller knowledge — for a known caller with a service address on
  // file, CONFIRM it instead ("still at 12 Main St?") and leave this null unless
  // they give a DIFFERENT address. Null when not stated.
  service_address: z.string().nullable().optional(),
  // How urgent the caller says it is: EXACTLY "emergency" (no heat/water actively
  // flooding/safety issue — needs someone ASAP), "soon" (days), or "whenever"
  // (routine, no rush). Infer from their words; ask only if unclear. Null when
  // this isn't a service request.
  urgency: z.string().nullable().optional(),
  // The caller's VERBATIM words about a specific unit or equipment, e.g. "the
  // water heater you installed last year". CAPTURE ONLY — never invent, never
  // paraphrase; null when no unit was mentioned.
  equipment_mention: z.string().nullable().optional(),
});
export type Extracted = z.infer<typeof ExtractedSchema>;

/** The STRICT JSON contract the model must return on every turn (LAYER 3). */
export const AIResponseSchema = z.object({
  message_to_speak: z.string().min(1),
  extracted: ExtractedSchema,
  state_update: z.enum(["GREETING", "COLLECTING_INFO", "COMPLETED"]),
});
export type AIResponse = z.infer<typeof AIResponseSchema>;
