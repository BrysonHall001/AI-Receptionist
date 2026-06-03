export type Role = "caller" | "assistant" | "system";

export interface TranscriptTurn {
  role: Role;
  text: string;
  at: string; // ISO timestamp
}

/** Append a turn, returning a new array (immutable update). */
export function appendTurn(transcript: TranscriptTurn[], role: Role, text: string): TranscriptTurn[] {
  return [...transcript, { role, text, at: new Date().toISOString() }];
}

/** Convert the stored transcript into OpenAI chat messages (caller -> user). */
export function toOpenAIMessages(
  transcript: TranscriptTurn[],
): { role: "user" | "assistant"; content: string }[] {
  return transcript
    .filter((t) => t.role === "caller" || t.role === "assistant")
    .map((t) => ({
      role: t.role === "caller" ? ("user" as const) : ("assistant" as const),
      content: t.text,
    }));
}

/** Human-readable transcript for the summary email. */
export function summarize(transcript: TranscriptTurn[], maxChars = 1500): string {
  const labelled = transcript
    .map((t) => {
      const who = t.role === "caller" ? "Caller" : t.role === "assistant" ? "Receptionist" : "System";
      return `${who}: ${t.text}`;
    })
    .join("\n");
  return labelled.length > maxChars ? labelled.slice(0, maxChars) + "\n…(truncated)" : labelled;
}
