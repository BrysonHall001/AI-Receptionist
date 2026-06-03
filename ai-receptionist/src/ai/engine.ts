import OpenAI from "openai";
import { env, useMockAI } from "../config/env";
import { logger } from "../utils/logger";
import { AIResponse, AIResponseSchema } from "./schema";
import { buildSystemPrompt, PromptContext } from "./prompt";
import { runMockTurn } from "./mockEngine";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

/** Thrown when the model cannot produce valid structured output after retries. */
export class AIEngineError extends Error {}

export interface AITurnInput {
  context: PromptContext;
  history: { role: "user" | "assistant"; content: string }[];
  latestCallerUtterance: string;
}

/**
 * Send the conversation to OpenAI, force JSON output, parse + validate, and
 * retry on invalid output (LAYER 3). Throws AIEngineError if all attempts fail.
 */
export async function runAITurn(input: AITurnInput): Promise<AIResponse> {
  // No real OpenAI key -> use the local deterministic receptionist.
  if (useMockAI()) {
    return runMockTurn(input);
  }

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

  let lastError: unknown;
  for (let attempt = 1; attempt <= env.AI_MAX_RETRIES; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: env.OPENAI_MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages,
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw);
      return AIResponseSchema.parse(parsed);
    } catch (err) {
      lastError = err;
      logger.warn(`AI turn attempt ${attempt}/${env.AI_MAX_RETRIES} failed: ${(err as Error).message}`);
      messages.push({
        role: "user",
        content:
          "Your previous response was not valid JSON in the required schema. Respond again with ONLY the JSON object.",
      });
    }
  }
  throw new AIEngineError(
    `AI engine failed after ${env.AI_MAX_RETRIES} attempts: ${(lastError as Error)?.message ?? "unknown"}`,
  );
}
