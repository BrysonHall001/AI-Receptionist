import OpenAI from "openai";
import { env, useMockAI } from "../config/env";
import { logger } from "../utils/logger";
import { AIResponse, AIResponseSchema } from "./schema";
import { buildSystemPrompt, PromptContext } from "./prompt";
import { runMockTurn } from "./mockEngine";
import { prisma } from "../db/client";
import { checkAvailability } from "../services/availabilityService";
// REUSE (export-only) the existing fail-safe resolvers — no second copies.
import { resolveResourceByName, mapServiceToSubtype } from "../services/bookingCaptureService";
import { resolveRecordTypeId, BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

/** Thrown when the model cannot produce valid structured output after retries. */
export class AIEngineError extends Error {}

export interface AITurnInput {
  // Tenant the call belongs to — needed so the availability tool scopes correctly.
  tenantId: string;
  context: PromptContext;
  history: { role: "user" | "assistant"; content: string }[];
  latestCallerUtterance: string;
}

// ---------------------------------------------------------------------------
// TEST-ONLY SEAM (provably inert in production).
// `deps.chat` lets a test supply a fake model caller so the tool-call wiring can
// be exercised without the real OpenAI API. In production runAITurn is called
// with NO second argument, so `deps` is {} and `chat` is undefined → the real
// `defaultChatCaller` (identical to the previous code: client.chat.completions
// .create) is used and the mock short-circuit below behaves exactly as before.
// Nothing about a live turn changes; the seam only activates when a caller is
// explicitly injected, which only the plumbing self-test ever does.
// ---------------------------------------------------------------------------
type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type ChatResult = OpenAI.Chat.Completions.ChatCompletion;
export type ChatCaller = (params: ChatParams) => Promise<ChatResult>;
export interface AITurnDeps {
  chat?: ChatCaller;
  // Fired ONCE, the moment a lookup (tool call) is first detected in a turn,
  // BEFORE the tool query + finalize call run — so the voice layer can speak a
  // short "let me check…" filler over the dead air. Inert when not provided
  // (simulator / internal routes pass nothing → behaves exactly as before).
  onLookupStart?: () => void;
}

const defaultChatCaller: ChatCaller = (params) => client.chat.completions.create(params);

// Hard cap on availability lookups per turn (cost + dead-air guard). After this
// many tool rounds we force a final, tools-off, JSON answer.
export const MAX_TOOL_ROUNDS = 2;

// The ONE tool exposed to the model this batch. Read-only availability lookup.
const AVAILABILITY_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "check_availability",
    description:
      "Check real appointment availability before offering or confirming any time. " +
      "Verify a specific time, or list what is open on a date. Times are the business's " +
      "local clock time exactly as spoken (no timezone conversion).",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "The date to check, in YYYY-MM-DD." },
        time: { type: "string", description: "Optional specific time to verify, 24-hour HH:MM. Omit to ask what is open that day." },
        service: { type: "string", description: "Optional service the caller wants, in their own words." },
        resource: { type: "string", description: "Optional staff member name the caller asked for." },
      },
      required: ["date"],
      additionalProperties: false,
    },
  },
};

/**
 * The availability tool's handler. READ-ONLY: resolves the resource NAME via the
 * reused fail-safe resolver (unknown → null → business-wide, never an invented
 * id), maps the service words to a subtype via the reused mapping (for accurate
 * per-service duration), then calls the Batch 1 checkAvailability. Wall-clock:
 * the slot labels come straight from Batch 1 (pure minute math, no Date/toLocale);
 * the requested time is sliced as a string. NO new date formatting is introduced.
 */
async function runAvailabilityTool(tenantId: string, args: any): Promise<string> {
  const date = String(args?.date ?? "").trim();
  const time = args?.time != null && String(args.time).trim() !== "" ? String(args.time).trim() : null;
  const resourceName = args?.resource != null ? String(args.resource) : null;
  const serviceWords = args?.service != null ? String(args.service) : null;

  // Unknown name → null → business-wide lookup (AI may still clarify in speech).
  const resourceId = await resolveResourceByName(tenantId, resourceName);
  // Canonical name of the resource we actually scoped to (so the AI can SAY whose
  // availability this is). null = business-wide / any staff.
  let resourceLabel: string | null = null;
  if (resourceId) {
    const r = await (prisma as any).resource.findFirst({ where: { id: resourceId, tenantId, deletedAt: null }, select: { name: true } });
    resourceLabel = r?.name ?? null;
  }

  // Service words → subtype key (reused mapping) so the duration is right.
  let serviceKey: string | null = null;
  if (serviceWords && serviceWords.trim()) {
    try {
      const rtId = await resolveRecordTypeId(tenantId, BOOKING_RECORD_TYPE_KEY);
      const rt = await (prisma as any).recordType.findFirst({ where: { tenantId, id: rtId } });
      serviceKey = mapServiceToSubtype((rt && rt.subtypes) || [], serviceWords);
    } catch {
      serviceKey = null; // mapping is best-effort; default duration is safe
    }
  }

  const result = await checkAvailability(tenantId, date, time, serviceKey, resourceId);
  return JSON.stringify({
    date: result.date,
    closed: result.closed,
    requestedTime: result.requestedTime ? result.requestedTime.slice(11) : null, // "HH:MM" 24h (internal reference)
    requestedTimeSpoken: result.requestedLabel, // say the requested time THIS way, e.g. "12:00 PM"
    requestedOpen: result.requestedOpen,
    requestedReason: result.requestedReason, // "open"|"closed"|"booked"|"unavailable"|null — say "booked" ONLY when this is "booked"
    durationMin: result.durationMin, // each open slot is an appointment this many minutes long
    openSlots: result.slots.slice(0, 12).map((s) => s.startLabel), // the START time of each slot, e.g. "12:00 PM" (NOT a range)
    resourceScoped: resourceId != null,
    resource: resourceLabel, // WHOSE availability this is: a staff name (scoped) or null (business-wide / any staff)
    resourceNameUnmatched: resourceName && !resourceId ? resourceName : null, // a name was given but matches no staff → this is a business-wide result, not that person's
  });
}

/** Run one tool call requested by the model; never throws (errors become a JSON
 *  error the model can read and recover from). */
async function dispatchToolCall(tenantId: string, tc: any): Promise<string> {
  try {
    if (tc?.function?.name !== "check_availability") return JSON.stringify({ error: "unknown tool" });
    const args = JSON.parse(tc.function.arguments || "{}");
    return await runAvailabilityTool(tenantId, args);
  } catch (e) {
    logger.warn(`[ai] availability tool failed: ${(e as Error).message}`);
    return JSON.stringify({ error: "availability lookup failed" });
  }
}

/** Parse + validate model content into a strict AIResponse, or null if invalid. */
function tryParseAIResponse(raw: string | null | undefined): AIResponse | null {
  if (!raw) return null;
  try {
    return AIResponseSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Run one conversational turn. A turn is now up to two phases:
 *   TOOL PHASE (≤ MAX_TOOL_ROUNDS): tools enabled, response_format NOT forced.
 *     The model either answers directly (valid JSON → returned in ONE call) or
 *     requests check_availability; we run it and feed the result back.
 *   FINALIZE PHASE: tools OFF, response_format: json_object forced, with the
 *     existing retry budget — guarantees the spoken reply is valid AIResponse
 *     JSON. (json_object is only ever set when tools are off, so it never fights
 *     tool-calling.)
 * Throws AIEngineError if a valid final response can't be produced.
 */
export async function runAITurn(input: AITurnInput, deps: AITurnDeps = {}): Promise<AIResponse> {
  // No real OpenAI key AND no injected caller -> local deterministic receptionist
  // (unchanged production behavior). An injected caller (test only) skips this.
  if (!deps.chat && useMockAI()) {
    return runMockTurn(input);
  }
  const callModel: ChatCaller = deps.chat ?? defaultChatCaller;

  const system = buildSystemPrompt(input.context);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...input.history,
  ];

  if (input.latestCallerUtterance.trim().length > 0) {
    messages.push({ role: "user", content: input.latestCallerUtterance });
  } else {
    messages.push({
      role: "user",
      content: "(The caller did not say anything. Politely re-prompt, or move the call forward if appropriate.)",
    });
  }

  // --- TOOL PHASE ---
  let lookupSignalled = false; // ensure the filler fires at most once per turn
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await callModel({
      model: env.OPENAI_MODEL,
      temperature: 0.3,
      tools: [AVAILABILITY_TOOL],
      tool_choice: "auto",
      messages,
    });
    const msg = completion.choices[0]?.message;
    const toolCalls = msg?.tool_calls;
    if (toolCalls && toolCalls.length) {
      // A lookup is happening → signal the filler NOW, before the (slow) tool
      // query + finalize call, so it overlaps the dead air. Guarded to once, and
      // never allowed to break the turn if the callback throws.
      if (!lookupSignalled) {
        lookupSignalled = true;
        try { deps.onLookupStart?.(); } catch { /* filler is best-effort */ }
      }
      messages.push({ role: "assistant", content: msg?.content ?? null, tool_calls: toolCalls });
      for (const tc of toolCalls) {
        const out = await dispatchToolCall(input.tenantId, tc);
        messages.push({ role: "tool", tool_call_id: (tc as any).id, content: out });
      }
      continue; // allow a follow-up lookup or a final answer
    }
    // No tool call → use the direct answer if it's already valid JSON (1-call path).
    const direct = tryParseAIResponse(msg?.content);
    if (direct) return direct;
    break; // content wasn't valid JSON → force it below
  }

  // --- FINALIZE PHASE (tools off, JSON forced, existing retry budget) ---
  let lastError: unknown;
  for (let attempt = 1; attempt <= env.AI_MAX_RETRIES; attempt++) {
    try {
      const completion = await callModel({
        model: env.OPENAI_MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages,
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      return AIResponseSchema.parse(JSON.parse(raw));
    } catch (err) {
      lastError = err;
      logger.warn(`AI finalize attempt ${attempt}/${env.AI_MAX_RETRIES} failed: ${(err as Error).message}`);
      messages.push({
        role: "user",
        content: "Your previous response was not valid JSON in the required schema. Respond again with ONLY the JSON object.",
      });
    }
  }
  throw new AIEngineError(
    `AI engine failed after ${env.AI_MAX_RETRIES} attempts: ${(lastError as Error)?.message ?? "unknown"}`,
  );
}
