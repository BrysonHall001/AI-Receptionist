// AI organize pass: maps raw extracted document text into the portal's CURRENT instruction
// sections. The model is told to ONLY organize/summarise what's in the documents — never invent
// facts — and to leave a section empty if the docs don't cover it. Returns [{section, content}].
// A chat caller is injectable so tests can mock the model (the sandbox blocks the network).
import OpenAI from "openai";
import { env } from "../config/env";

export interface SectionSuggestion { section: string; content: string; }
export type OrganizeChat = (params: any) => Promise<any>;

let _client: OpenAI | null = null;
function client(): OpenAI { if (!_client) _client = new OpenAI({ apiKey: env.OPENAI_API_KEY }); return _client; }
const defaultChat: OrganizeChat = (params) => client().chat.completions.create(params);

export class InstructionsParseError extends Error {}

function buildPrompt(sectionNames: string[], docText: string) {
  const sections = sectionNames.length ? sectionNames : ["Overview", "Services", "Pricing", "What we don't do", "FAQs", "Tone & personality"];
  const system =
    "You organize a business's uploaded documents into fixed sections for an AI phone receptionist's instructions. " +
    "STRICT RULES: Use ONLY information present in the documents. Do NOT invent, guess, or add facts (no made-up prices, hours, policies, or services). " +
    "Summarize and reorganize the real content into the given sections. If the documents contain nothing relevant to a section, return an EMPTY string for that section. " +
    "Do not include business hours or availability — those come from the scheduling system, not here. " +
    'Respond with ONLY valid JSON of the form {"sections":[{"section":"<name>","content":"<text>"}]}, one entry per requested section, in the given order. No prose, no markdown fences.';
  const user =
    `Sections (fill these exact names, in order):\n${sections.map((s) => `- ${s}`).join("\n")}\n\n` +
    `Documents:\n"""\n${docText}\n"""`;
  return { sections, system, user };
}

// Organize docText into suggestions for sectionNames. Never throws on model shape issues without a
// clear InstructionsParseError; falls back to empty content per section only when parsing fails.
export async function organizeIntoSections(
  docText: string,
  sectionNames: string[],
  deps: { chat?: OrganizeChat } = {},
): Promise<SectionSuggestion[]> {
  const { sections, system, user } = buildPrompt(sectionNames, docText);
  if (!docText || !docText.trim()) return sections.map((s) => ({ section: s, content: "" }));

  const chat = deps.chat || defaultChat;
  let completion: any;
  try {
    completion = await chat({
      model: env.OPENAI_MODEL,
      messages: [ { role: "system", content: system }, { role: "user", content: user } ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });
  } catch (e) {
    throw new InstructionsParseError(`The AI organize step failed: ${(e as Error).message}`);
  }

  const raw = completion?.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== "string") throw new InstructionsParseError("The AI returned an empty response.");

  let parsed: any;
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()); }
  catch { throw new InstructionsParseError("The AI response wasn't valid JSON."); }

  const arr: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sections) ? parsed.sections : [];
  const byName = new Map<string, string>();
  for (const item of arr) {
    if (item && typeof item.section === "string") byName.set(item.section.trim().toLowerCase(), typeof item.content === "string" ? item.content : "");
  }
  // Return exactly the requested sections, in order; unknown/missing => empty (no invention).
  return sections.map((s) => ({ section: s, content: (byName.get(s.trim().toLowerCase()) || "").trim() }));
}
