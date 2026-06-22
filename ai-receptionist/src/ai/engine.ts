import OpenAI from "openai";
import { env, useMockAI } from "../config/env";
import { logger } from "../utils/logger";
import { AIResponse, AIResponseSchema } from "./schema";
import { buildSystemPrompt, PromptContext } from "./prompt";
import { runMockTurn } from "./mockEngine";
import { prisma } from "../db/client";
import { checkAvailability } from "../services/availabilityService";
// REUSE (export-only) the existing fail-safe resolvers — no second copies.
import { resolveResourceByName, mapServiceToSubtype, isConcreteAppointment } from "../services/bookingCaptureService";
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

// The COMMIT tool. Unlike check_availability (read-only), this RECORDS the booking
// decision on the CallSession the instant the AI announces it — so the booked
// resource + time come from a deterministic backend decision, not from whatever
// the model later happens to put in `extracted`. The backend re-verifies the slot
// and CHOOSES the resource here, then returns the chosen staff name for the AI to
// announce. This is the commitment moment.
const CONFIRM_BOOKING_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "confirm_booking",
    description:
      "Call this at the EXACT moment you announce a booking to the caller — after they have said yes to a specific date and time. " +
      "It records the booking on the backend so it cannot be lost or mis-recorded. Pass the confirmed date and 24-hour time; " +
      "optionally the staff member the caller asked for. The result tells you which staff member to announce — say exactly that name and that time. " +
      "Do NOT announce a booking without calling this on the same turn.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Confirmed appointment date, YYYY-MM-DD." },
        time: { type: "string", description: "Confirmed start time, 24-hour HH:MM (e.g. 14:00 for 2 PM)." },
        resource: { type: "string", description: "Optional staff member name the caller asked for. Omit for no-preference." },
        service: { type: "string", description: "Optional service in the caller's own words." },
      },
      required: ["date", "time"],
      additionalProperties: false,
    },
  },
};

/** The backend-owned commitment captured by confirm_booking, threaded back out of
 *  runAITurn so handleTurn (the SOLE session writer) can persist it. appointmentAt
 *  is the zoneless wall-clock string ("YYYY-MM-DDTHH:MM"), never converted. */
export interface CommittedBooking {
  resourceId: string | null;
  appointmentAt: string;
}

/** runAITurn returns the normal AIResponse plus, when the model committed a
 *  booking this turn, the backend-owned commitment to persist. */
export type AITurnResult = AIResponse & { committedBooking?: CommittedBooking };

/**
 * The availability tool's handler. READ-ONLY: resolves the resource NAME via the
 * reused fail-safe resolver (unknown → null → business-wide, never an invented
 * id), maps the service words to a subtype via the reused mapping (for accurate
 * per-service duration), then calls the Batch 1 checkAvailability. Wall-clock:
 * the slot labels come straight from Batch 1 (pure minute math, no Date/toLocale);
 * the requested time is sliced as a string. NO new date formatting is introduced.
 */
/** Map the caller's service words to a Booking subtype key (reused mapping) so the
 *  per-service duration is right. Best-effort: null on any failure (default
 *  duration is safe). Shared by both the availability and confirm tools. */
async function serviceWordsToKey(tenantId: string, serviceWords: string | null): Promise<string | null> {
  if (!serviceWords || !serviceWords.trim()) return null;
  try {
    const rtId = await resolveRecordTypeId(tenantId, BOOKING_RECORD_TYPE_KEY);
    const rt = await (prisma as any).recordType.findFirst({ where: { tenantId, id: rtId } });
    return mapServiceToSubtype((rt && rt.subtypes) || [], serviceWords);
  } catch {
    return null; // mapping is best-effort; default duration is safe
  }
}

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
  const serviceKey = await serviceWordsToKey(tenantId, serviceWords);

  const result = await checkAvailability(tenantId, date, time, serviceKey, resourceId);
  return JSON.stringify({
    date: result.date,
    closed: result.closed,
    requestedTime: result.requestedTime ? result.requestedTime.slice(11) : null, // "HH:MM" 24h (internal reference)
    requestedTimeSpoken: result.requestedLabel, // say the requested time THIS way, e.g. "12:00 PM"
    requestedOpen: result.requestedOpen,
    requestedReason: result.requestedReason, // "open"|"closed"|"booked"|"unavailable"|null — say "booked" ONLY when this is "booked"
    availableResources: result.availableResources.map((r) => r.name), // staff FREE at the requested time. 1 name -> just book that person; 2+ -> ask which they'd like; always book onto one of these (never "Unassigned").
    durationMin: result.durationMin, // each open slot is an appointment this many minutes long
    openSlots: result.slots.slice(0, 12).map((s) => s.startLabel), // the START time of each slot, e.g. "12:00 PM" (NOT a range)
    resourceScoped: resourceId != null,
    resource: resourceLabel, // WHOSE availability this is: a staff name (scoped) or null (business-wide / any staff)
    resourceNameUnmatched: resourceName && !resourceId ? resourceName : null, // a name was given but matches no staff → this is a business-wide result, not that person's
    uncertain: result.uncertain, // true => calendar sync is degraded/stale; DO NOT promise this slot. Offer to take details and have someone confirm.
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

/**
 * The confirm_booking handler — the COMMITMENT MOMENT. The backend, not the model,
 * decides the booked resource + time here and returns both: a JSON result for the
 * model to ANNOUNCE, and a CommittedBooking to PERSIST. Reuses the same fail-safe
 * resolvers + availability union the rest of the app uses (no new logic, no new
 * date math — the wall-clock string is the caller's exact digits).
 *
 * Decision rules (deterministic):
 *   - time must be a concrete wall-clock value AND report OPEN; otherwise NO commit
 *     (the model is told why so it doesn't announce a bad time).
 *   - resource: the caller's named staff IF they're free; else the first FREE staff
 *     (backend's pick); else the named staff even if not free (finalize's rescue
 *     covers it); else null only when the business has no free/!any staff.
 * Never throws — on any error returns committed:null so the turn still completes.
 */
async function runConfirmBookingTool(
  tenantId: string,
  args: any,
): Promise<{ toModel: string; committed: CommittedBooking | null }> {
  try {
    const date = String(args?.date ?? "").trim();
    const time = String(args?.time ?? "").trim();
    const resourceName = args?.resource != null ? String(args.resource) : null;
    const serviceWords = args?.service != null ? String(args.service) : null;
    const wallClock = `${date}T${time}`; // zoneless wall-clock, exact digits, no conversion

    // Guard: only commit a real, concrete, parseable wall-clock date+time.
    if (!isConcreteAppointment(wallClock)) {
      return { toModel: JSON.stringify({ committed: false, error: "need a concrete date and time (YYYY-MM-DD and HH:MM) before booking" }), committed: null };
    }

    const serviceKey = await serviceWordsToKey(tenantId, serviceWords);
    const result = await checkAvailability(tenantId, date, time, serviceKey, null);

    // Don't commit a time the slot brain doesn't report OPEN — tell the model why
    // so it offers something else instead of announcing a bad booking.
    if (!result.requestedOpen) {
      return {
        toModel: JSON.stringify({ committed: false, requestedReason: result.requestedReason, error: "that exact time is not open — do not announce it; offer another time" }),
        committed: null,
      };
    }

    // Backend CHOOSES the resource deterministically from who is actually free.
    const free = result.availableResources || []; // [{ id, name }]
    const namedId = await resolveResourceByName(tenantId, resourceName);
    let committedId: string | null = null;
    if (namedId && free.some((r) => r.id === namedId)) committedId = namedId; // caller's pick, and free
    else if (free.length) committedId = free[0].id; // backend picks a free staff member
    else if (namedId) committedId = namedId; // named but not in free list — finalize rescue covers it
    // else: no staff free and none named → null (unassigned lane; only when no resources)

    const committedName =
      free.find((r) => r.id === committedId)?.name ??
      (committedId
        ? (await (prisma as any).resource.findFirst({ where: { id: committedId, tenantId, deletedAt: null }, select: { name: true } }))?.name ?? null
        : null);

    return {
      toModel: JSON.stringify({
        committed: true,
        resource: committedName, // ANNOUNCE exactly this staff member
        appointmentTime: result.requestedLabel, // say the time this way, e.g. "2:00 PM"
        service: serviceWords,
        uncertain: result.uncertain, // if true, don't over-promise; details will be confirmed
        note: "Booking recorded on the backend. Announce exactly this staff member and time.",
      }),
      committed: { resourceId: committedId, appointmentAt: wallClock },
    };
  } catch (e) {
    logger.warn(`[ai] confirm_booking tool failed: ${(e as Error).message}`);
    return { toModel: JSON.stringify({ committed: false, error: "could not record the booking just now" }), committed: null };
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
export async function runAITurn(input: AITurnInput, deps: AITurnDeps = {}): Promise<AITurnResult> {
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

  // Backend-owned commitment captured if the model calls confirm_booking this turn;
  // attached to whatever AIResponse we return so handleTurn can persist it.
  let committedBooking: CommittedBooking | undefined;
  const attach = (r: AIResponse): AITurnResult => (committedBooking ? { ...r, committedBooking } : r);

  // --- TOOL PHASE ---
  let lookupSignalled = false; // ensure the filler fires at most once per turn
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await callModel({
      model: env.OPENAI_MODEL,
      temperature: 0.3,
      tools: [AVAILABILITY_TOOL, CONFIRM_BOOKING_TOOL],
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
        if ((tc as any)?.function?.name === "confirm_booking") {
          // COMMITMENT MOMENT: the backend decides + records the booking now.
          let cbArgs: any = {};
          try { cbArgs = JSON.parse((tc as any).function?.arguments || "{}"); } catch { cbArgs = {}; }
          const { toModel, committed } = await runConfirmBookingTool(input.tenantId, cbArgs);
          if (committed) committedBooking = committed; // last commit this turn wins
          messages.push({ role: "tool", tool_call_id: (tc as any).id, content: toModel });
        } else {
          const out = await dispatchToolCall(input.tenantId, tc);
          messages.push({ role: "tool", tool_call_id: (tc as any).id, content: out });
        }
      }
      continue; // allow a follow-up lookup or a final answer
    }
    // No tool call → use the direct answer if it's already valid JSON (1-call path).
    const direct = tryParseAIResponse(msg?.content);
    if (direct) return attach(direct);
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
      return attach(AIResponseSchema.parse(JSON.parse(raw)));
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
