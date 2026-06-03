import { env } from "../config/env";
import { prisma, disconnectDb } from "./client";
import { logger } from "../utils/logger";
import { hashPassword } from "../auth/passwords";

/**
 * Bootstrap the system:
 *  - a SUPER_ADMIN login (you, the SaaS operator)
 *  - one default portal (tenant) bound to TWILIO_PHONE_NUMBER
 *  - a PORTAL_ADMIN login for that portal (a sample client)
 */
async function seed(): Promise<void> {
  // Super admin
  const adminEmail = env.SUPER_ADMIN_EMAIL.toLowerCase();
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword(env.SUPER_ADMIN_PASSWORD),
        name: "Super Admin",
        role: "SUPER_ADMIN",
      },
    });
    logger.info(`Created SUPER_ADMIN: ${adminEmail}`);
  } else {
    logger.info(`SUPER_ADMIN already exists: ${adminEmail}`);
  }

  // Default portal
  const notifyEmail = process.env.SEED_NOTIFY_EMAIL || "owner@example.com";
  const portal = await prisma.tenant.upsert({
    where: { phoneNumber: env.TWILIO_PHONE_NUMBER },
    update: { notifyEmail },
    create: {
      name: process.env.SEED_BUSINESS_NAME || "Acme Services",
      businessType: process.env.SEED_BUSINESS_TYPE || "home services company",
      phoneNumber: env.TWILIO_PHONE_NUMBER,
      greeting: process.env.SEED_GREETING || "Thanks for calling Acme Services. How can I help you today?",
      notifyEmail,
    },
  });
  logger.info(`Portal ready: ${portal.name} (${portal.id})`);

  // Portal admin (sample client login)
  const clientEmail = (process.env.SEED_CLIENT_EMAIL || "client@example.com").toLowerCase();
  const existingClient = await prisma.user.findUnique({ where: { email: clientEmail } });
  if (!existingClient) {
    await prisma.user.create({
      data: {
        email: clientEmail,
        passwordHash: await hashPassword(process.env.SEED_CLIENT_PASSWORD || "changeme123"),
        name: "Portal Admin",
        role: "PORTAL_ADMIN",
        tenantId: portal.id,
      },
    });
    logger.info(`Created PORTAL_ADMIN: ${clientEmail} (portal: ${portal.name})`);
  }

  logger.info("--------------------------------------------------");
  logger.info("Login credentials (change these!):");
  logger.info(`  Super Admin : ${adminEmail} / ${env.SUPER_ADMIN_PASSWORD}`);
  logger.info(`  Portal Admin: ${clientEmail} / ${process.env.SEED_CLIENT_PASSWORD || "changeme123"}`);
  logger.info("--------------------------------------------------");

  await disconnectDb();
}

seed().catch(async (err) => {
  logger.error(`Seed failed: ${(err as Error).message}`);
  await disconnectDb();
  process.exit(1);
});
