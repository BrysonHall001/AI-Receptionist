// Charge export builders. The CSV/xlsx file is assembled client-side by the shared export modal
// (identical to every other export), so these builders define the AUTHORITATIVE field sets and a
// server-side SAFE row source for the portal (client-facing) export. Keeping the client-safe set
// here — sourced from listPortalCharges' select-only projection — guarantees cost/markup/
// breakdown/audit internals can never leak into a client charge export.
import { listPortalCharges } from "./portalBillingService";

// Operator field set (master all-tenants + per-tenant). Order matches the export UI.
export const CHARGE_EXPORT_FIELDS = [
  "Tenant", "Period start", "Period end", "Amount", "Currency", "Status", "Paid",
  "Outstanding", "Due date", "Created", "Approved", "Paid date", "Notes",
];

// Per-tenant operator export drops the redundant Tenant column.
export const CHARGE_EXPORT_FIELDS_TENANT = CHARGE_EXPORT_FIELDS.filter((f) => f !== "Tenant");

// CLIENT-SAFE field set (portal Data Admin export + Data Backup). Mirrors the portal Billing
// view — NO cost/markup/passthrough/breakdown/audit fields, ever.
export const PORTAL_CHARGE_EXPORT_FIELDS = [
  "Period", "Amount", "Currency", "Status", "Due date", "Paid date", "Note",
];

// Any of these appearing in a portal charge export row would be a margin leak.
export const FORBIDDEN_PORTAL_CHARGE_KEYS = [
  "cost", "markup", "passthrough", "breakdown", "usage", "flatFee", "audit", "tenantId", "stripeInvoiceId",
];

export interface PortalChargeExportRow {
  Period: string;
  Amount: number;
  Currency: string;
  Status: string;
  "Due date": string;
  "Paid date": string;
  Note: string;
}

function ymd(iso: string | null): string { return iso ? new Date(iso).toISOString().slice(0, 10) : ""; }

// Server-side CLIENT-SAFE charge rows for a tenant, reusing the portal billing service's
// select-only projection. Returns labeled rows ready for CSV/xlsx with zero internals.
export async function portalChargeExportRows(tenantId: string): Promise<{ fields: string[]; rows: PortalChargeExportRow[] }> {
  const { charges } = await listPortalCharges(tenantId);
  const rows: PortalChargeExportRow[] = charges.map((c) => ({
    Period: `${ymd(c.periodStart)} – ${ymd(c.periodEnd)}`,
    Amount: c.amount,
    Currency: c.currency,
    Status: c.status,
    "Due date": ymd(c.dueDate),
    "Paid date": ymd(c.paidAt),
    Note: c.note ?? "",
  }));
  return { fields: PORTAL_CHARGE_EXPORT_FIELDS.slice(), rows };
}
