import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { prisma, disconnectDb } from "./client";
import { logger } from "../utils/logger";

interface DemoTurn { role: "assistant" | "caller" | "system"; text: string; }
interface DemoRecord {
  sid: string;
  status: "COMPLETED" | "COLLECTING_INFO" | "FAILED";
  name: string | null;
  phone: string | null;
  email: string | null;
  intent: string | null;
  daysAgo: number;
  hour: number;
  minute: number;
  turnCount: number;
  emptyCount: number;
  hasContact: boolean;
  finalized: boolean;
  emailSent: boolean;
  transcript: DemoTurn[];
}

function digits(s: string | null): string {
  return (s || "").replace(/\D/g, "");
}

function fromNumberFor(r: DemoRecord): string {
  const d = digits(r.phone);
  if (d.length >= 10) return "+1" + d.slice(-10);
  return "+1919555" + r.sid.replace(/\D/g, "").slice(-4); // synthetic for unknown callers
}

async function main(): Promise<void> {
  const dataPath = path.resolve(process.cwd(), "scripts/demo-data.json");
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Cannot find demo data at ${dataPath}`);
  }
  const records: DemoRecord[] = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  // Tenant: reuse the first one, or create a default if the DB is empty.
  let tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: process.env.SEED_BUSINESS_NAME || "Acme Services",
        businessType: process.env.SEED_BUSINESS_TYPE || "home services company",
        phoneNumber: env.TWILIO_PHONE_NUMBER,
        greeting:
          process.env.SEED_GREETING || "Thanks for calling Acme Services. How can I help you today?",
        notifyEmail: process.env.SEED_NOTIFY_EMAIL || "owner@example.com",
      },
    });
    logger.info(`Created tenant ${tenant.name}`);
  }

  // Clean slate for re-runs: remove any previously seeded demo calls.
  const removed = await prisma.callSession.deleteMany({ where: { callSid: { startsWith: "DEMO-" } } });
  if (removed.count > 0) logger.info(`Cleared ${removed.count} previous demo calls.`);

  const now = new Date();
  let calls = 0;
  let contacts = 0;

  for (const r of records) {
    const createdAt = new Date(now);
    createdAt.setDate(createdAt.getDate() - r.daysAgo);
    createdAt.setHours(r.hour, r.minute, 0, 0);

    const finalizedAt = r.finalized ? new Date(createdAt.getTime() + 2 * 60000) : null;
    const emailSentAt = r.emailSent ? new Date(createdAt.getTime() + 3 * 60000) : null;

    const transcript = r.transcript.map((turn, i) => ({
      role: turn.role,
      text: turn.text,
      at: new Date(createdAt.getTime() + i * 20000).toISOString(),
    }));

    const extracted = {
      name: r.name,
      intent: r.intent,
      phone: r.status === "FAILED" ? null : r.phone,
      email: r.email,
    };

    const fromNumber = fromNumberFor(r);
    let contactId: string | null = null;

    if (r.hasContact && r.phone) {
      const contact = await prisma.contact.upsert({
        where: { tenantId_phone: { tenantId: tenant.id, phone: r.phone } },
        update: { name: r.name, email: r.email, intent: r.intent },
        create: { tenantId: tenant.id, phone: r.phone, name: r.name, email: r.email, intent: r.intent },
      });
      contactId = contact.id;
      contacts++;
    }

    await prisma.callSession.create({
      data: {
        callSid: r.sid,
        tenantId: tenant.id,
        contactId,
        fromNumber,
        toNumber: tenant.phoneNumber,
        status: r.status,
        transcript: transcript as any,
        extracted: extracted as any,
        turnCount: r.turnCount,
        emptyCount: r.emptyCount,
        finalizedAt,
        emailSentAt,
        createdAt,
      },
    });
    calls++;
  }

  logger.info(`Demo data loaded: ${calls} calls, ${contacts} contacts linked, for tenant "${tenant.name}".`);
  await disconnectDb();
}

main().catch(async (err) => {
  logger.error(`Demo seed failed: ${(err as Error).message}`);
  await disconnectDb();
  process.exit(1);
});
