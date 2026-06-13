import { prisma, disconnectDb } from "./client";
import { logger } from "../utils/logger";

/**
 * Testing helper: force an account to look expired by backdating its expiresAt,
 * so you can verify the "This account has expired." login refusal.
 *
 *   npm run expire-user -- tester@example.com
 *
 * Pass the auditor's email. Sets expiresAt to yesterday (does NOT delete the row).
 */
async function main(): Promise<void> {
  const email = (process.argv[2] || "").trim().toLowerCase();
  if (!email) {
    logger.error('Provide an email:  npm run expire-user -- tester@example.com');
    await disconnectDb();
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    logger.error(`No user found with email ${email}.`);
    await disconnectDb();
    process.exit(1);
  }
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.user.update({ where: { id: user.id }, data: { expiresAt: yesterday } });
  logger.info(`Set ${email} expiresAt to ${yesterday.toISOString()} (in the past). It should now be refused at login.`);
  await disconnectDb();
  process.exit(0);
}

main().catch(async (err) => {
  logger.error(`expire-user failed: ${(err as Error).message}`);
  await disconnectDb();
  process.exit(1);
});
