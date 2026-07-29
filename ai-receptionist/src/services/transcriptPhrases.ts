// TRANSCRIPT PHRASES — the deterministic half of the transcript insights.
//
// NO MODEL IS CALLED HERE, EVER. Everything below is string processing and
// counting over text the system already stored. Token cost is exactly zero, and
// the absence of any AI import is asserted by the suite.
//
// THREE RULES this file exists to keep:
//   1. ONLY THE CALLER IS MINED. The receptionist's own turns are dropped
//      before a single word is counted — otherwise its stock greeting becomes
//      the tenant's top "topic", which would be worse than saying nothing.
//   2. NOTHING IDENTIFYING IS EVER STORED. A candidate phrase carrying a phone
//      number, an email, a street address or a known contact's name is
//      DISCARDED, not scrubbed — a scrubbed phrase is still evidence that the
//      identifier was there.
//   3. BOUNDED. A capped number of calls, a capped amount of text per call.
//      This runs in the nightly sweep and never in a request path.
import { prisma } from "../db/client";

const db = prisma as any;

export const PHRASE_LIMITS = {
  /** Calls read per tenant per sweep. */
  MAX_CALLS: 500,
  /** Caller text read per call, in characters. */
  MAX_CHARS_PER_CALL: 8000,
  /** The longest phrase we will ever store as evidence. */
  MAX_PHRASE_CHARS: 40,
  /** n-gram sizes. Bigrams and trigrams: long enough to mean something, short
   *  enough to recur across different callers' phrasing. */
  NGRAMS: [2, 3],
};

/** Words that carry no topic on their own. */
const STOP_WORDS = new Set([
  "a", "about", "actually", "after", "again", "all", "also", "am", "an", "and", "any", "anything", "are", "as", "at",
  "back", "be", "because", "been", "before", "being", "but", "by", "call", "called", "calling", "can", "could",
  "did", "do", "does", "doing", "done", "down", "for", "from", "get", "getting", "give", "go", "going", "good",
  "got", "great", "had", "has", "have", "having", "he", "her", "here", "hi", "him", "his", "how", "i", "if", "im",
  "in", "into", "is", "it", "its", "just", "know", "let", "like", "little", "ll", "look", "looking", "me", "mean",
  "might", "more", "morning", "my", "need", "needed", "no", "not", "now", "of", "off", "ok", "okay", "on", "one",
  "only", "or", "other", "our", "out", "over", "please", "really", "right", "said", "say", "see", "she", "should",
  "so", "some", "sorry", "still", "sure", "take", "than", "thank", "thanks", "that", "thats", "the", "their",
  "them", "then", "there", "these", "they", "thing", "things", "think", "this", "those", "time", "to", "too",
  "up", "us", "ve", "very", "want", "wanted", "was", "we", "well", "were", "what", "when", "where", "which",
  "who", "will", "with", "would", "yeah", "yes", "yet", "you", "your", "youre",
]);

/**
 * Business-generic phrases every receptionist call contains. Without these the
 * top "insight" for every tenant would be "phone number" — the batch-31 lesson
 * that one noisy first suggestion costs more trust than ten good ones earn.
 */
const GENERIC_PHRASES = new Set([
  "phone number", "your name", "my name", "the number", "best number", "call you back", "give me a call",
  "let me know", "sounds good", "thank you", "no problem", "hold on", "one moment", "make an appointment",
  "book an appointment", "come out", "as soon", "soon as possible", "next week", "this week", "next month",
  "in the morning", "in the afternoon", "the address", "my address", "email address", "credit card",
]);

/** Tokens that only ever appear inside an email address. */
const EMAIL_TOKENS = new Set([
  "com", "net", "org", "io", "co", "gmail", "yahoo", "hotmail", "outlook", "icloud", "example", "dot",
]);

/** Street-suffix tokens: their presence means the phrase is an address. */
const ADDRESS_TOKENS = new Set([
  "street", "st", "road", "rd", "avenue", "ave", "boulevard", "blvd", "lane", "ln", "drive", "dr",
  "court", "ct", "circle", "cir", "way", "terrace", "place", "pl", "highway", "hwy", "apt", "suite", "unit",
]);

/** Caller-spoken text only. The receptionist's turns never reach the counters. */
export function callerTextFromTranscript(transcript: any): string {
  if (!Array.isArray(transcript)) return "";
  const parts: string[] = [];
  let total = 0;
  for (const turn of transcript) {
    if (!turn || typeof turn !== "object") continue;
    if (String(turn.role || "").toLowerCase() !== "caller") continue;   // RULE 1
    const text = typeof turn.text === "string" ? turn.text : "";
    if (!text) continue;
    parts.push(text);
    total += text.length;
    if (total >= PHRASE_LIMITS.MAX_CHARS_PER_CALL) break;               // RULE 3
  }
  return parts.join(" ").slice(0, PHRASE_LIMITS.MAX_CHARS_PER_CALL);
}

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PhraseRejectReason { phrase: string; reason: string }

/**
 * THE PRIVACY GATE. Returns a reason when a phrase must never be stored.
 * Rejection, not redaction: a phrase with the identifier removed still tells
 * you an identifier was said there.
 */
export function rejectReason(phrase: string, knownNames: Set<string>): string | null {
  if (!phrase) return "empty";
  if (phrase.length > PHRASE_LIMITS.MAX_PHRASE_CHARS) return "too long";
  const tokens = phrase.split(" ");
  // ANY digit is rejected, not just long runs. A first probe let "9 fern"
  // through — a house number and a street fragment — because the number was
  // one character and the street suffix landed in the next n-gram. Topics
  // worth surfacing are words; numbers are almost always identifiers.
  if (/\d/.test(phrase)) return "contains a digit";
  // Email fragments split across n-grams too ("com i live"), so the TLD
  // tokens are rejected on their own, not only when an @ survives.
  if (phrase.includes("@")) return "looks like an email";
  if (tokens.some((t) => EMAIL_TOKENS.has(t))) return "looks like part of an email";
  if (tokens.some((t) => ADDRESS_TOKENS.has(t))) return "looks like an address";
  if (tokens.some((t) => knownNames.has(t))) return "contains a known contact's name";
  return null;
}

/** The tenant's OWN words — its name, its modules, its services. Insight
 *  should never be "callers keep saying work order". */
export async function tenantOwnWords(tenantId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const add = (s: any) => {
    const n = normalizeText(String(s || ""));
    if (!n) return;
    out.add(n);
    for (const w of n.split(" ")) if (w.length > 2) out.add(w);
  };
  try {
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    if (t) add(t.name);
    const types = await db.recordType.findMany({ where: { tenantId }, select: { label: true, labelPlural: true, subtypes: true } });
    for (const rt of types) {
      add(rt.label); add(rt.labelPlural);
      const subs = Array.isArray(rt.subtypes) ? rt.subtypes : [];
      for (const s of subs) add(s && s.label);
    }
  } catch { /* the stop-list is a quality measure, never a failure mode */ }
  return out;
}

/** Surnames and forenames already known to this tenant, for the name gate. */
export async function knownNameTokens(tenantId: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const contacts = await db.contact.findMany({ where: { tenantId, deletedAt: null }, select: { name: true }, take: 2000 });
    for (const c of contacts) {
      for (const w of normalizeText(c.name || "").split(" ")) if (w.length > 2) out.add(w);
    }
  } catch { /* */ }
  return out;
}

/** Every bigram/trigram in one call's caller text, deduplicated within the call. */
export function phrasesFromText(text: string, opts: { ownWords: Set<string>; knownNames: Set<string> }): Set<string> {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const found = new Set<string>();
  for (const n of PHRASE_LIMITS.NGRAMS) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      // A phrase made only of filler is not a topic.
      if (gram.every((w) => STOP_WORDS.has(w))) continue;
      if (STOP_WORDS.has(gram[0]) || STOP_WORDS.has(gram[gram.length - 1])) continue;
      const phrase = gram.join(" ");
      if (GENERIC_PHRASES.has(phrase)) continue;
      if (opts.ownWords.has(phrase)) continue;
      if (gram.some((w) => opts.ownWords.has(w))) continue;
      if (rejectReason(phrase, opts.knownNames)) continue;
      found.add(phrase);
    }
  }
  return found;
}

export interface PhraseTally {
  phrase: string;
  distinctCalls: number;
  distinctDays: number;
  callIds: string[];
}

/**
 * Count phrases across a tenant's calls in a window, BY DISTINCT CALL — never
 * by raw occurrence, so one talkative caller cannot manufacture a topic.
 */
export async function tallyPhrases(tenantId: string, sinceDays: number, until?: Date): Promise<{ tally: Map<string, PhraseTally>; callsRead: number }> {
  const end = until || new Date();
  const start = new Date(end.getTime() - sinceDays * 86400000);
  const calls = await db.callSession.findMany({
    where: { tenantId, createdAt: { gte: start, lt: end } },
    select: { id: true, transcript: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: PHRASE_LIMITS.MAX_CALLS,
  });
  const [ownWords, knownNames] = await Promise.all([tenantOwnWords(tenantId), knownNameTokens(tenantId)]);
  const tally = new Map<string, PhraseTally>();
  for (const c of calls) {
    const text = callerTextFromTranscript(c.transcript);
    if (!text) continue;
    const day = new Date(c.createdAt).toISOString().slice(0, 10);
    for (const phrase of phrasesFromText(text, { ownWords, knownNames })) {
      let row = tally.get(phrase);
      if (!row) { row = { phrase, distinctCalls: 0, distinctDays: 0, callIds: [] }; (row as any)._days = new Set<string>(); tally.set(phrase, row); }
      row.distinctCalls += 1;
      if (row.callIds.length < 25) row.callIds.push(c.id);
      (row as any)._days.add(day);
      row.distinctDays = (row as any)._days.size;
    }
  }
  return { tally, callsRead: calls.length };
}
