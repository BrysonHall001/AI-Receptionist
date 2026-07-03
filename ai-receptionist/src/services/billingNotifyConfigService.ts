// Global approval-notification settings (single "singleton" row). Seeds the owner's email as
// the default recipient on first read.
import { prisma } from "../db/client";

const db = prisma as any;
const ID = "singleton";

export const NOTIFY_CADENCES = ["once", "daily_until_approved"] as const;
export type NotifyCadence = (typeof NOTIFY_CADENCES)[number];
export function isNotifyCadence(v: unknown): v is NotifyCadence {
  return typeof v === "string" && (NOTIFY_CADENCES as readonly string[]).includes(v);
}

function serialize(row: any) {
  return {
    id: row.id,
    recipients: Array.isArray(row.recipients) ? row.recipients : [],
    leadDays: row.leadDays,
    cadence: row.cadence,
    enabled: !!row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function defaultRecipients(): Promise<string[]> {
  try {
    const owner = await db.user.findFirst({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { email: true } });
    return owner?.email ? [owner.email] : [];
  } catch { return []; }
}

export async function getBillingNotifyConfig() {
  let row = await db.billingNotifyConfig.findUnique({ where: { id: ID } });
  if (!row) row = await db.billingNotifyConfig.create({ data: { id: ID, recipients: await defaultRecipients() } });
  return serialize(row);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateBillingNotifyConfig(input: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if ("recipients" in input) {
    const raw = Array.isArray(input.recipients) ? input.recipients : [];
    const cleaned = Array.from(new Set(raw.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)));
    for (const e of cleaned) if (!EMAIL_RE.test(e)) throw new Error(`invalid email: ${e}`);
    data.recipients = cleaned;
  }
  if ("leadDays" in input) { const n = Math.trunc(Number(input.leadDays)); if (!Number.isFinite(n) || n < 0 || n > 365) throw new Error("leadDays must be 0–365"); data.leadDays = n; }
  if ("cadence" in input) { if (!isNotifyCadence(input.cadence)) throw new Error("cadence must be one of: " + NOTIFY_CADENCES.join(", ")); data.cadence = input.cadence; }
  if ("enabled" in input) data.enabled = !!input.enabled;

  const row = await db.billingNotifyConfig.upsert({
    where: { id: ID },
    update: data,
    create: { id: ID, recipients: await defaultRecipients(), ...data },
  });
  return serialize(row);
}
