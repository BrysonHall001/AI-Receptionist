import { env } from "../config/env";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { startCall, handleTurn, finalizeCall } from "./callOrchestrator";

interface Scenario {
  label: string;
  // The caller's lines, in order. The simulator feeds these one per turn; the REAL
  // AI generates every receptionist reply and decides what to ask next. Lines are
  // written so information dribbles out (vague -> specific), giving the AI room to
  // ask follow-ups across several turns. NOTE: a scripted caller can't truly answer
  // an unexpected question — these are ordered to flow naturally for the most likely
  // follow-up sequence, not to react dynamically to the AI.
  utterances: string[];
}

const SCENARIOS: Scenario[] = [
  // --- A couple of easy baselines (clean info on the first ask) ---
  {
    label: "Easy — clear leak",
    utterances: [
      "Hi, this is Jordan Lee.",
      "You can reach me at 919-555-2841, and my email is jordan.lee@example.com.",
      "My water heater is leaking and I need someone to come out today.",
    ],
  },
  {
    label: "Easy — tune-up booking",
    utterances: [
      "Hi, it's Maria Gonzalez.",
      "Best number for me is 919-555-7732.",
      "I'd like to schedule a routine furnace tune-up before winter.",
    ],
  },

  // --- Books a real appointment with a concrete date + time (capture-only) ---
  {
    label: "Booking — concrete appointment",
    utterances: [
      "Hi, this is Sarah Chen.",
      "You can reach me at 919-555-8080.",
      "I'd like to book a furnace tune-up.",
      "How about June 24th at 2 PM?",
      "Yes, that works great — thank you!",
    ],
  },

  // --- Vague / rambling: doesn't volunteer clear info ---
  {
    label: "Vague — 'something's wrong in the basement'",
    utterances: [
      "Uh, yeah, hi... so something's kind of wrong with, um, the thing in my basement?",
      "I dunno exactly, it's making a weird noise and I think there's some water?",
      "Can someone just come out and take a look at it?",
      "Oh — my name? It's Pat. Pat Reilly.",
      "Yeah, you can call me back at 919-555-0148.",
    ],
  },

  // --- Refuses / hesitates on the phone number, then odd format ---
  {
    label: "Reluctant — won't give number easily",
    utterances: [
      "Hey, it's Dana.",
      "Wait, why do you need my phone number? Can't you just email me?",
      "Ugh, fine. It's nine one nine, five five five, oh one two three.",
      "My dishwasher is flooding all over the kitchen floor.",
    ],
  },

  // --- Off-topic / hard questions the receptionist may not know ---
  {
    label: "Hard questions — price, hours, brand",
    utterances: [
      "Hi, I'm Sam Carter.",
      "Before anything else — how much is this going to cost me?",
      "And are you guys even open on Sunday?",
      "Do you service Trane systems? That's what I've got.",
      "Anyway — my AC is blowing warm air. My number's 919-555-6610.",
    ],
  },

  // --- Changes mind / conflicting info mid-call ---
  {
    label: "Changes mind — reschedule, then reverses",
    utterances: [
      "Hi, this is Helen Park.",
      "I need to reschedule my Thursday appointment to sometime next week.",
      "Actually — no, keep Thursday. But can you also send someone for the gutters?",
      "Oh, and my number changed — it's 919-555-9090 now, not the old one.",
    ],
  },

  // --- Frustrated / impatient ---
  {
    label: "Frustrated — wants someone today",
    utterances: [
      "Finally, a real person. I've been on hold forever.",
      "Look, I just need somebody out here today, okay?",
      "It's Marcus. My roof is leaking into the bedroom ceiling.",
      "How fast can someone actually get here? I don't have all day. Call me at 919-555-2277.",
    ],
  },

  // --- Ambiguous reason -> forces a clarifying follow-up ---
  {
    label: "Ambiguous — 'it's just not working'",
    utterances: [
      "Hi, um, it's Aisha.",
      "Yeah, so... it's just not working right.",
      "Oh — the sink. The kitchen one. The water won't go down at all.",
      "My email's aisha.b@example.com if you need it.",
    ],
  },

  // --- Over-shares / buries the actual request ---
  {
    label: "Rambler — buries the request",
    utterances: [
      "Oh hi! So, funny story — my mother-in-law was visiting this weekend and the whole house was chaos...",
      "...anyway, long story short, the garbage disposal made this awful grinding noise and then just quit.",
      "I'm Tom, by the way — Tom Whitfield.",
      "You can call me back at 919-555-3360 pretty much anytime.",
    ],
  },

  // --- Minimal / terse: barely gives anything ---
  {
    label: "Terse — one-word answers",
    utterances: [
      "AC's out.",
      "Derek.",
      "919-555-7781.",
      "How soon?",
    ],
  },

  // --- Unsure they have the right place / multiple issues ---
  {
    label: "Multi-issue — not sure you cover it",
    utterances: [
      "Hi, is this the plumbing folks? Or do you do heating and air too?",
      "Because I've got a clogged drain AND my heater's been acting up — do you handle both?",
      "Name's Priya Nair.",
      "Best number is 919-555-4402.",
    ],
  },

  // --- Gives info out of order / interrupts ---
  {
    label: "Out of order — leads with the number",
    utterances: [
      "919-555-2210 — write that down before I forget.",
      "Oh, sorry — I'm Helen. Helen Diaz.",
      "My garage door is stuck halfway open and won't budge.",
      "Can someone come this afternoon?",
    ],
  },
];

/** Ensure a tenant exists; returns its id. Used only as a fallback. */
async function ensureTenantId(): Promise<string> {
  const existing = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  const created = await prisma.tenant.create({
    data: {
      billingStatus: "trial",
      name: process.env.SEED_BUSINESS_NAME || "Acme Services",
      businessType: process.env.SEED_BUSINESS_TYPE || "home services company",
      phoneNumber: env.TWILIO_PHONE_NUMBER,
      greeting: process.env.SEED_GREETING || "Thanks for calling Acme Services. How can I help you today?",
      notifyEmail: process.env.SEED_NOTIFY_EMAIL || "owner@example.com",
    },
  });
  logger.info("Auto-created a default tenant for simulation.");
  return created.id;
}

function randomPhone(): string {
  return `(919) 555-${String(Math.floor(1000 + Math.random() * 9000))}`;
}

/** Run a complete scripted call into a specific portal (tenant). */
export async function runSimulatedCall(tenantId?: string | null): Promise<{ id: string; callSid: string }> {
  const targetTenantId = tenantId || (await ensureTenantId());

  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  const phone = randomPhone();
  const callSid = `SIM-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const fromNumber = "+1" + phone.replace(/\D/g, "");

  // The caller's lines come straight from the scenario, in order. The REAL AI
  // generates each receptionist reply between them and decides what to ask next.
  // The loop stops early if the AI signals it's done; otherwise it ends when the
  // caller's scripted lines run out (then we finalize). So a scenario's number of
  // lines is the ceiling on how long that simulated call can run.
  const utterances = scenario.utterances;

  await startCall({ callSid, from: fromNumber, tenantId: targetTenantId });
  for (const speech of utterances) {
    const turn = await handleTurn({ callSid, speech });
    if (turn.done) break;
  }
  await finalizeCall(callSid, "COMPLETED");

  const session = await prisma.callSession.findUnique({ where: { callSid } });
  logger.info(`Simulated call ${callSid} [${scenario.label}] complete.`);
  return { id: session?.id ?? "", callSid };
}
