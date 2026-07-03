// Approval-request emails for draft charges nearing their due date (Task 3). Uses the existing
// sendRichEmail path (logged in EmailLog, respects mock mode). Tracks reminderSentAt/reminderCount
// per charge so "once" never repeats and "daily_until_approved" sends at most once/day until the
// charge leaves draft. Only draft charges are ever emailed.
import { prisma } from "../db/client";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { sendRichEmail } from "./notificationService";
import { getBillingNotifyConfig } from "./billingNotifyConfigService";

const db = prisma as any;
const DAY = 86400000;

function money(v: any): string { return "$" + (Math.round((Number(v) || 0) * 100) / 100).toFixed(2); }
function d(v: any): string { return v ? new Date(v).toISOString().slice(0, 10) : "—"; }

function approvalHtml(portalName: string, charge: any): string {
  const b = charge.breakdown || {};
  const us = b.usageSnapshot || {};
  const base = (env.APP_BASE_URL || "").replace(/\/+$/, "");
  const link = `${base}/#/admin/usage`;
  return `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111">
      <h2 style="margin:0 0 8px">Charge awaiting approval</h2>
      <p style="margin:0 0 12px">A draft charge for <b>${escapeHtml(portalName)}</b> is ready for your approval.</p>
      <table style="border-collapse:collapse;font-size:14px;margin-bottom:12px">
        <tr><td style="padding:2px 12px 2px 0;color:#555">Period</td><td><b>${d(charge.periodStart)} – ${d(charge.periodEnd)}</b></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555">Amount</td><td><b>${money(charge.amount)} ${escapeHtml(charge.currency || "USD")}</b></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555">Due</td><td>${d(charge.dueDate)}</td></tr>
      </table>
      <div style="font-size:13px;color:#444;margin-bottom:12px">
        Flat ${money(b.flatFee)} + passthrough ${money(b.passthroughBaseCost)} × (1 + ${Number(b.markupPct) || 0}%) = ${money(b.passthroughAmount)}.<br>
        Usage: ${us.calls || 0} calls · ${us.minutes || 0} min · ${us.tokens || 0} tokens · ${us.emails || 0} emails.
      </div>
      <p style="margin:0 0 4px"><a href="${link}" style="background:#2563eb;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;display:inline-block">Review &amp; approve</a></p>
      <p style="font-size:12px;color:#888;margin:12px 0 0">Nothing is charged automatically — this charge stays a draft until you approve it.</p>
    </div>`;
}

function escapeHtml(s: string): string {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export interface ReminderReport { candidates: number; sent: number; skippedCadence: number; skippedNoRecipients: number; disabled: boolean; }

export async function sendApprovalReminders(now: Date = new Date()): Promise<ReminderReport> {
  const report: ReminderReport = { candidates: 0, sent: 0, skippedCadence: 0, skippedNoRecipients: 0, disabled: false };
  const cfg = await getBillingNotifyConfig();
  if (!cfg.enabled) { report.disabled = true; return report; }

  const recipients: string[] = Array.isArray(cfg.recipients) ? cfg.recipients : [];
  const leadMs = Math.max(0, Number(cfg.leadDays) || 0) * DAY;
  const nowMs = now.getTime();

  // Draft charges whose due date is within the lead window (dueDate - now <= leadDays).
  const drafts = await db.charge.findMany({ where: { status: "draft", dueDate: { not: null } } });
  for (const charge of drafts) {
    const due = new Date(charge.dueDate).getTime();
    if (due - nowMs > leadMs) continue; // not yet within the lead window
    report.candidates++;

    // Cadence gate.
    if (cfg.cadence === "once") { if ((charge.reminderCount || 0) > 0) { report.skippedCadence++; continue; } }
    else { // daily_until_approved
      if (charge.reminderSentAt && nowMs - new Date(charge.reminderSentAt).getTime() < DAY) { report.skippedCadence++; continue; }
    }

    if (!recipients.length) { report.skippedNoRecipients++; continue; }

    const tenant = await db.tenant.findUnique({ where: { id: charge.tenantId }, select: { name: true } });
    const portalName = tenant?.name || charge.tenantId;
    const html = approvalHtml(portalName, charge);
    let anySent = false;
    for (const to of recipients) {
      try {
        await sendRichEmail(
          { to, subject: `Approve billing charge — ${portalName} (${money(charge.amount)})`, html, fromEmail: env.RESEND_FROM },
          { tenantId: charge.tenantId, type: "billing_approval" },
        );
        anySent = true;
      } catch (e) {
        logger.warn(`[billing-notify] send failed to ${to} for charge ${charge.id}: ${(e as Error).message}`);
      }
    }
    if (anySent) {
      await db.charge.update({ where: { id: charge.id }, data: { reminderSentAt: now, reminderCount: { increment: 1 } } });
      report.sent++;
    }
  }

  if (report.sent) logger.info(`[billing-notify] approval reminders sent=${report.sent} candidates=${report.candidates}`);
  return report;
}
