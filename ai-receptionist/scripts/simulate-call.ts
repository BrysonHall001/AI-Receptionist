/**
 * Drive a full call through the internal HTTP endpoints — no phone required.
 * Prereqs: server running (`npm run dev`), DB migrated, tenant seeded, and a
 * valid OPENAI_API_KEY (the AI turns make real OpenAI calls).
 *
 *   npm run simulate
 */
const BASE = process.env.SIMULATE_BASE_URL || "http://localhost:3000";

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main(): Promise<void> {
  const callSid = `SIM${Date.now()}`;
  const from = "+15551230001";
  console.log(`Simulating call ${callSid} -> ${BASE}`);

  let r = await post("/internal/call/start", {
    callSid,
    from,
    to: process.env.TWILIO_PHONE_NUMBER,
  });
  console.log("start →", r.json);

  const utterances = [
    "Hi, my name is Jordan Lee.",
    "You can reach me at 555-123-0001.",
    "My water heater is leaking and I need someone to come out today.",
    "My email is jordan@example.com, that's everything, thanks.",
  ];

  for (const speech of utterances) {
    console.log(`\ncaller: ${speech}`);
    r = await post("/internal/call/update", { callSid, speech });
    console.log("ai →", r.json);
    if (r.json?.done) break;
  }

  await post("/internal/call/end", { callSid });
  console.log("\nCall ended. Check the server logs, the database, and the notify email.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
