// CLIENT-FACING billing read model. This is a second window into the SAME Charge ledger the
// hub uses — no separate records. MARGIN-SAFETY: it selects ONLY client-safe columns from the
// DB (never breakdown/cost/markup/passthrough), excludes drafts + voided charges, and is always
// scoped to a single tenant by the caller. Nothing here exposes internal economics or other
// tenants. Always reads live (no caching), so hub edits/approvals/payments reflect immediately.
import { prisma } from "../db/client";

const db = prisma as any;
function iso(v: any): string | null { return v ? new Date(v).toISOString() : null; }

export interface PortalCharge {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  amount: number;
  currency: string;
  status: "Due" | "Overdue" | "Paid";
  dueDate: string | null;
  note: string | null;
  paidAt: string | null;
  payUrl: string | null;
}

export async function listPortalCharges(tenantId: string): Promise<{ charges: PortalCharge[]; summary: { outstanding: number; paid: number; currency: string } }> {
  // SELECT only client-safe columns. breakdown/cost/markup are never even fetched.
  const rows = await db.charge.findMany({
    where: { tenantId, status: { in: ["approved", "unpaid", "paid"] } }, // excludes draft + void
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, periodStart: true, periodEnd: true, amount: true, currency: true,
      status: true, dueDate: true, notes: true, stripeInvoiceUrl: true,
      payments: { select: { amount: true, paidAt: true } },
    },
  });

  const now = Date.now();
  const charges: PortalCharge[] = rows.map((c: any) => {
    const amount = Math.round((Number(c.amount) || 0) * 100) / 100;
    const payments = Array.isArray(c.payments) ? c.payments : [];
    const paidTotal = payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const isPaid = c.status === "paid" || (paidTotal >= amount && amount > 0);
    const overdue = !isPaid && !!c.dueDate && new Date(c.dueDate).getTime() < now;

    // paidAt = when payments first covered the charge (fallback: latest payment).
    let paidAt: any = null;
    if (isPaid && payments.length) {
      const asc = [...payments].sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime());
      let cum = 0;
      for (const p of asc) { cum += Number(p.amount); if (amount > 0 && cum >= amount) { paidAt = p.paidAt; break; } }
      if (!paidAt) paidAt = asc[asc.length - 1].paidAt;
    }

    return {
      id: c.id,
      periodStart: iso(c.periodStart),
      periodEnd: iso(c.periodEnd),
      amount,
      currency: c.currency || "USD",
      status: isPaid ? "Paid" : overdue ? "Overdue" : "Due",
      dueDate: iso(c.dueDate),
      note: c.notes ?? null,
      paidAt: isPaid ? iso(paidAt) : null,
      // Hosted Stripe payment link only while unpaid.
      payUrl: !isPaid ? (c.stripeInvoiceUrl ?? null) : null,
    };
  });

  const round = (n: number) => Math.round(n * 100) / 100;
  const outstanding = round(charges.filter((c) => c.status !== "Paid").reduce((s, c) => s + c.amount, 0));
  const paid = round(charges.filter((c) => c.status === "Paid").reduce((s, c) => s + c.amount, 0));
  const currency = charges[0]?.currency || "USD";
  return { charges, summary: { outstanding, paid, currency } };
}
