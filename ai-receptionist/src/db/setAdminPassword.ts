import { env, isWeakPassword } from "../config/env";
import { prisma, disconnectDb } from "./client";
import { hashPassword } from "../auth/passwords";
import { logger } from "../utils/logger";

/**
 * Set (or reset) the super-admin password.
 *
 *   npm run set-admin-password -- "YourStrongPassword123"
 *
 * Targets the account whose email is SUPER_ADMIN_EMAIL. The password must be at
 * least 12 characters and not a known placeholder.
 */
async function main(): Promise<void> {
  const pw = process.argv[2] || process.env.NEW_ADMIN_PASSWORD || "";
  if (isWeakPassword(pw)) {
    logger.error(
      'Provide a strong password (12+ chars, not a placeholder):\n  npm run set-admin-password -- "YourStrongPassword123"',
    );
    await disconnectDb();
    process.exit(1);
  }
  const email = env.SUPER_ADMIN_EMAIL.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    logger.error(`No user found with email ${email}. Run \`npm run seed\` first, then re-run this.`);
    await disconnectDb();
    process.exit(1);
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw) } });
  logger.info(`Password updated for ${email}. You can now log in with the new password.`);
  await disconnectDb();
  process.exit(0);
}

main().catch(async (err) => {
  logger.error(`set-admin-password failed: ${(err as Error).message}`);
  await disconnectDb();
  process.exit(1);
});
