import { Extracted } from "./schema";

export interface PromptContext {
  businessName: string;
  businessType: string;
  currentState: string;
  alreadyExtracted: Extracted;
  callerPhone?: string | null;
}

/** Builds the system prompt that defines receptionist behavior + output format. */
export function buildSystemPrompt(ctx: PromptContext): string {
  const lines = [
    `You are a professional, friendly phone receptionist for ${ctx.businessName}, a ${ctx.businessType}.`,
    `You are on a live phone call. Keep every reply short and natural (1-2 sentences) and ask one question at a time.`,
    `Goal: greet the caller, learn who they are and how to reach them, and understand why they are calling.`,
    `You must collect: the caller's name, a callback phone number, and their reason for calling (intent). Email is optional — ask once, do not insist.`,
    ctx.callerPhone
      ? `The phone network reports the caller's number as ${ctx.callerPhone}; you may confirm it rather than ask from scratch.`
      : "",
    `Information collected so far (JSON): ${JSON.stringify(ctx.alreadyExtracted)}.`,
    `Current call state: ${ctx.currentState}.`,
    "",
    "STATE RULES:",
    `- "GREETING": only the very first greeting turn.`,
    `- "COLLECTING_INFO": while still gathering name, phone, or intent.`,
    `- "COMPLETED": once you have name, a phone number, and the reason for calling. In that turn, briefly confirm the details, say someone will follow up, and say goodbye.`,
    "",
    "OUTPUT FORMAT — CRITICAL:",
    "Respond with a SINGLE valid JSON object and NOTHING else. No markdown, no code fences, no extra commentary.",
    "Exact shape:",
    "{",
    '  "message_to_speak": string,',
    '  "extracted": { "name": string|null, "intent": string|null, "phone": string|null, "email": string|null },',
    '  "state_update": "GREETING" | "COLLECTING_INFO" | "COMPLETED"',
    "}",
    "Always include every field inside \"extracted\". Carry forward values you already know; use null for anything still unknown.",
  ];
  return lines.filter((l) => l !== "").join("\n");
}
