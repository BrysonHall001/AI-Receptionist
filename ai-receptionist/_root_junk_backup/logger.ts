import { env } from "../config/env";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { startCall, handleTurn, finalizeCall } from "./callOrchestrator";

interface Scenario {
  name: string;
  email: string | null;
  reason: string;
}

const SCENARIOS: Scenario[] = [
  { name: "Jordan Lee", email: "jordan.lee@example.com", reason: "My water heater is leaking and I need someone to come out today." },
  { name: "Maria Gonzalez", email: null, reason: "I'd like to schedule a routine furnace tune-up before winter." },
  { name: "Derek Olsen", email: "d.olsen@example.com", reason: "I need a quote for replacing my roof after some storm damage." },
  { name: "Aisha Bello", email: null, reason: "My kitchen sink is clogged and the water won't drain at all." },
  { name: "Tom Whitfield", email: "tom.w@example.com", reason: "I'm interested in booking a deep cleaning for a 3-bedroom house." },
  { name: "Priya Nair", email: null, reason: "My AC stopped blowing cold air and it's an emergency." },
  { name: "Sam Carter", email: "sam.carter@example.com", reason: "I want an estimate for installing a new garage door." },
  { name: "Helen Park", email: null, reason: "I need to reschedule my appointment from Thursday to next week." },
];

/** Ensure a tenant exists; returns its id. Used only as a fallback. */
async function ensureTenantId(): Promise<string> {
  const existing = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  const created = await prisma.tenant.create({
    data: {
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

  const utterances = [
    `Hi, this is ${scenario.name}.`,
    scenario.email
      ? `You can reach me at ${phone}, and my email is ${scenario.email}.`
      : `You can reach me at ${phone}.`,
    scenario.reason,
  ];

  await startCall({ callSid, from: fromNumber, tenantId: targetTenantId });
  for (const speech of utterances) {
    const turn = await handleTurn({ callSid, speech });
    if (turn.done) break;
  }
  await finalizeCall(callSid, "COMPLETED");

  const session = await prisma.callSession.findUnique({ where: { callSid } });
  logger.info(`Simulated call ${callSid} for "${scenario.name}" complete.`);
  return { id: session?.id ?? "", callSid };
}
