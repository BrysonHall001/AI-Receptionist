// One tick of billing automation: auto-draft this period's charges, then send approval
// reminders for drafts nearing their due date. Guarded/idempotent; safe to run on a timer and
// at startup. Wrapped so a failure never crashes the scheduler.
import { logger } from "../utils/logger";
import { autoDraftCharges } from "./billingAutoDraftService";
import { sendApprovalReminders } from "./billingNotifyService";

export async function runBillingAutomationSweep(now: Date = new Date()) {
  const draft = await autoDraftCharges(now).catch((e) => { logger.error(`[billing-sweep] auto-draft failed: ${(e as Error).message}`); return null; });
  const notify = await sendApprovalReminders(now).catch((e) => { logger.error(`[billing-sweep] reminders failed: ${(e as Error).message}`); return null; });
  return { draft, notify };
}
