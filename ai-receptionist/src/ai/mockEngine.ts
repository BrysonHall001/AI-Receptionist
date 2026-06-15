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
  // Booking capture (offline): pull a concrete date+time and a service so the
  // "Simulate call" button can create a Booking with no OpenAI key. Only a real,
  // parseable date+time produces a value; otherwise null (no junk booking).
  const appointment_datetime = extractAppointment(said) ?? prev.appointment_datetime ?? null;
  const service = extractService(said) ?? prev.service ?? null;

  const extracted = { name, phone, email, intent, appointment_datetime, service };
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
  } else if (service && !appointment_datetime) {
    // A booking is in progress but we don't have a concrete time yet — pin it
    // down before wrapping up (mirrors the real receptionist's behavior).
    message = `Sure, I can set up ${service.toLowerCase()} for you. What day and time works best?`;
    state = "COLLECTING_INFO";
  } else if (appointment_datetime) {
    // Read the captured time back, plainly, then complete.
    const when = new Date(appointment_datetime + ":00").toLocaleString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    message =
      `Perfect, ${firstName}. I've got you down for ${service || "an appointment"} on ${when}. ` +
      `Someone will confirm shortly. Thanks for calling!`;
    state = "COMPLETED";
  } else {
    message =
      `Perfect, ${firstName}. I've got your number as ${phone} and noted that you're calling about ` +
      `${intent}. Someone from our team will follow up shortly. Thanks for calling!`;
    state = "COMPLETED";
  }

  return { message_to_speak: message, extracted, state_update: state };
}

// ---- Booking capture helpers (offline / simulator) -----------------------
// Modest, deterministic parsers. The REAL OpenAI receptionist handles fuzzy
// language; these just let the simulator and no-key dev path produce a booking
// from clearly-spoken lines like "June 24th at 2 PM".

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function pad2(n: number): string { return String(n).padStart(2, "0"); }

/** Parse a clock time like "2pm", "2:30 pm", "10 am" -> {h, m} (24h) or null. */
function parseClock(s: string): { h: number; m: number } | null {
  const m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const pm = /p/i.test(m[3]);
  if (h === 12) h = pm ? 12 : 0;
  else if (pm) h += 12;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/** Resolve a concrete date+time from a spoken line to "YYYY-MM-DDTHH:MM", or null.
 *  Supports "<Month> <day> at <time>", "tomorrow at <time>", and "today at <time>".
 *  Uses the server's current date for relative phrases (read-back confirms it). */
function extractAppointment(s: string): string | null {
  const clock = parseClock(s);
  if (!clock) return null; // no concrete time -> never a booking
  const now = new Date();

  // Explicit month + day, e.g. "June 24th" / "Jun 24".
  const md = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (md) {
    const mon = MONTHS[md[1].slice(0, 3).toLowerCase()];
    const day = parseInt(md[2], 10);
    if (mon != null && day >= 1 && day <= 31) {
      let year = now.getFullYear();
      // If that date already passed this year, assume next year (keeps it future).
      const candidate = new Date(year, mon, day);
      if (candidate.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) year += 1;
      return `${year}-${pad2(mon + 1)}-${pad2(day)}T${pad2(clock.h)}:${pad2(clock.m)}`;
    }
  }

  // Relative: "tomorrow" / "today".
  if (/\btomorrow\b/i.test(s)) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(clock.h)}:${pad2(clock.m)}`;
  }
  if (/\btoday\b/i.test(s)) {
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(clock.h)}:${pad2(clock.m)}`;
  }
  return null; // a time with no resolvable date -> not concrete enough
}

/** Pull a short service phrase from a booking line, e.g. "furnace tune-up". */
function extractService(s: string): string | null {
  const m = s.match(/\b(?:for|book|schedule|need|want)\s+(?:a|an|my)?\s*([a-z][a-z\s-]{2,40}?)(?:\s+(?:on|at|for|next|this|tomorrow|today)\b|[.,!?]|$)/i);
  if (!m) return null;
  const phrase = m[1].trim().replace(/\s+/g, " ");
  if (!phrase || /^(appointment|booking|time|slot)$/i.test(phrase)) return null;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
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
