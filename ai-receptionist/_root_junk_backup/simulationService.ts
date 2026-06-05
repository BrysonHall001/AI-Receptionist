import { z } from "zod";

/** Structured data the receptionist extracts from the caller. */
export const ExtractedSchema = z.object({
  name: z.string().nullable().optional(),
  intent: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});
export type Extracted = z.infer<typeof ExtractedSchema>;

/** The STRICT JSON contract the model must return on every turn (LAYER 3). */
export const AIResponseSchema = z.object({
  message_to_speak: z.string().min(1),
  extracted: ExtractedSchema,
  state_update: z.enum(["GREETING", "COLLECTING_INFO", "COMPLETED"]),
});
export type AIResponse = z.infer<typeof AIResponseSchema>;
