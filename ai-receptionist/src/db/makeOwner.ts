import { prisma, disconnectDb } from "./client";
import { logger } from "../utils/logger";

/**
 * Promote a single account to the OWNER tier.
 *
 *   npm run make-owner
 *
 * Defaults to brysonhall001@gmail.com; pass another email as an argument to
 * target a different account:  npm run make-owner -- someone@example.com
 *
 * IMPORTANT: run this ONLY AFTER the "add_owner_role" migration has been applied,
 * because the OWNER value must exist in the database enum first.
 */
async function main(): Promise<void> {
  const email = (process.argv[2] || "brysonhall001@gmail.com").trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    logger.error(`No user found with email ${email}.`);
    await disconnectDb();
    process.exit(1);
  }
  // `as any` so this compiles even before the Prisma client is regenerated with
  // the new enum value; at runtime the DB enum already has OWNER (post-migration).
  const updated = await prisma.user.update({ where: { id: user.id }, data: { role: "OWNER" as any } });
  logger.info(`Set ${updated.email} to role ${updated.role}. Log out and back in for it to take effect.`);
  await disconnectDb();
  process.exit(0);
}

main().catch(async (err) => {
  logger.error(`make-owner failed: ${(err as Error).message}`);
  await disconnectDb();
  process.exit(1);
});
