import { AIResponse } from "./schema";
import { AITurnInput } from "./engine";

/**
 * A fully local, deterministic stand-in for the OpenAI receptionist. It parses
 * the caller's words for a name, phone, email, and reason, then asks for
 * whatever is still missing — no network or API key required. This is what lets
 * the "Simulate call" button produce realistic leads with placeholder keys.
 */
export async function runMockTurn(input: AITurnInput): Promise<AIResponse> {
  const said = input.latestCallerUtterance || "";
  const prev = input.context.alreadyExtracted || {};

  const name = extractName(said) ?? prev.name ?? null;
  const phone = extractPhone(said) ?? prev.phone ?? null;
  const email = extractEmail(said) ?? prev.email ?? null;
  const intent = extractIntent(said, Boolean((prev.name ?? name) && (prev.phone ?? phone))) ?? prev.intent ?? null;

  const extracted = { name, phone, email, intent };
  const firstName = name ? name.split(/\s+/)[0] : null;

  let message: string;
  let state: AIResponse["state_update"];

  if (!name) {
    message = "Of course — may I have your name, please?";
    state = "COLLECTING_INFO";
  } else if (!phone) {
    message = `Thanks, ${firstName}! What's the best phone number to reach you?`;
    state = "COLLECTING_INFO";
  } else if (!intent) {
    message = `Got it. And how can we help you today, ${firstName}?`;
    state = "COLLECTING_INFO";
  } else {
    message =
      `Perfect, ${firstName}. I've got your number as ${phone} and noted that you're calling about ` +
      `${intent}. Someone from our team will follow up shortly. Thanks for calling!`;
    state = "COMPLETED";
  }

  return { message_to_speak: message, extracted, state_update: state };
}

function extractEmail(s: string): string | null {
  const m = s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].replace(/[.,;:]+$/, "") : null;
}

function extractPhone(s: string): string | null {
  const m = s.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (!m) return null;
  const digitCount = m[0].replace(/\D/g, "").length;
  return digitCount >= 7 ? m[0].trim() : null;
}

const NAME_STOPWORDS = new Set([
  "calling", "just", "here", "looking", "trying", "interested", "having",
  "needing", "wondering", "hoping", "not", "the", "a", "an",
]);

function extractName(s: string): string | null {
  const m = s.match(
    /(?:my name is|this is|the name is|name's|i am|i'm)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i,
  );
  if (!m) return null;
  const candidate = m[1].trim().replace(/[^A-Za-z'\- ]+$/, "");
  const first = candidate.split(/\s+/)[0].toLowerCase();
  if (NAME_STOPWORDS.has(first)) return null;
  return candidate
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const INTENT_KEYWORDS = [
  "need", "help", "about", "appointment", "schedule", "quote", "broken",
  "leak", "issue", "problem", "fix", "repair", "install", "question",
  "interested", "looking", "want", "estimate", "service", "book", "cancel",
  "reschedule", "emergency", "today", "tomorrow",
];

function extractIntent(s: string, haveNameAndPhone: boolean): string | null {
  const lower = s.toLowerCase();
  const looksLikeIntent = INTENT_KEYWORDS.some((k) => lower.includes(k));
  const isJustContactInfo =
    /^[\s\d\W]*$/.test(s) ||
    /^(my (number|cell|phone|email)|you can reach me|reach me|call me|it'?s|here'?s my)\b/i.test(s.trim());

  if (looksLikeIntent || (haveNameAndPhone && !isJustContactInfo && s.trim().length > 8)) {
    let cleaned = s.trim().replace(/\s+/g, " ");
    cleaned = cleaned.replace(/^(hi|hello|hey|yeah|yes|so|um|well|okay|ok)[,\s]+/i, "");
    cleaned = cleaned.replace(/[.\s]+$/, "");
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return null;
}
