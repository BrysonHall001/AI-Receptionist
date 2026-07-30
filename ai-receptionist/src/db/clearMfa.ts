import { prisma, disconnectDb } from "./client";
import { logger } from "../utils/logger";
import { audit } from "../services/auditService";
import { AUDIT_ACTIONS } from "../services/auditCatalog";

/**
 * THE ESCAPE HATCH. Clears two-factor for ONE named account.
 *
 *   npm run clear-mfa -- "someone@example.com"
 *
 * This exists because a lost phone with no way back is the difference between an
 * inconvenience and a lost product. It is runnable only by someone with server access.
 *
 * IT DOES EXACTLY ONE THING. It removes the two-factor secret, any enrolment in progress,
 * the recovery codes and the remembered devices for that account. It does NOT reset the
 * password, does NOT change a role, does NOT create a session, and does NOT touch any other
 * account. Anyone using it still needs the account's password to sign in afterwards.
 *
 * It writes an audit row, so using it is visible after the fact.
 */
async function main(): Promise<void> {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!email) {
    logger.error('Usage: npm run clear-mfa -- "someone@example.com"');
    process.exitCode = 1;
    return;
  }
  const db = prisma as any;
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    logger.error(`No account found for ${email}. Nothing was changed.`);
    process.exitCode = 1;
    return;
  }
  const codes = await db.userRecoveryCode.count({ where: { userId: user.id } });
  const devices = await db.userTrustedDevice.count({ where: { userId: user.id } });
  const wasOn = !!user.mfaSecret;

  await db.$transaction([
    db.userRecoveryCode.deleteMany({ where: { userId: user.id } }),
    db.userTrustedDevice.deleteMany({ where: { userId: user.id } }),
    db.user.update({ where: { id: user.id }, data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
  ]);

  audit({
    tenantId: user.tenantId ?? null, actorType: "system", actorId: null, actorLabel: "clear-mfa (command line)",
    action: AUDIT_ACTIONS.MFA_CLEARED_CLI, subjectType: "auth", subjectId: user.id,
    meta: { email, wasEnabled: wasOn, recoveryCodesDestroyed: codes, devicesForgotten: devices },
  });

  logger.info(`Two-factor cleared for ${email}.`);
  logger.info(`  was enabled           : ${wasOn ? "yes" : "no (nothing was on)"}`);
  logger.info(`  recovery codes removed: ${codes}`);
  logger.info(`  devices forgotten     : ${devices}`);
  logger.info(`  password              : UNCHANGED - they still need it to sign in`);
}

main()
  .catch((e) => { logger.error(String((e as Error).message || e)); process.exitCode = 1; })
  .finally(() => disconnectDb());
