// Global master-hub billing dashboards. Two fixed scopes, each storing a reports-engine
// widget layout (JSON). Shared across the hub (NOT per-portal): the tenant_drilldown layout
// is applied to every tenant's drill-in, computed against that tenant's own usage.
import { prisma } from "../db/client";

const db = prisma as any;

export const BILLING_DASHBOARD_SCOPES = ["tenant_drilldown", "macro"] as const;
export type BillingDashboardScope = (typeof BILLING_DASHBOARD_SCOPES)[number];
export function isBillingDashboardScope(v: unknown): v is BillingDashboardScope {
  return typeof v === "string" && (BILLING_DASHBOARD_SCOPES as readonly string[]).includes(v);
}

// Default widgets — the CURRENT built-in set (KPIs + cost/calls/minutes over time), expressed
// as reports-engine widget JSON over the "usage" source. Both scopes seed with this so nothing
// starts empty. Over-time widgets group by date; the drill-in's grouping control re-buckets
// them to day/week/month/year at render time.
const kpi = (id: string, title: string, field: string) => ({ id, title, source: "usage", type: "kpi", measure: { op: "sum", field }, groupBy: [] as any[], series: [] as any[], filters: [] as any[] });
const overTime = (id: string, title: string, type: string, field: string) => ({ id, title, source: "usage", type, measure: { op: "sum", field }, groupBy: [{ key: "date" }], series: [] as any[], filters: [] as any[] });

export const DEFAULT_BILLING_WIDGETS = [
  kpi("bw_cost", "Total est. cost", "totalCost"),
  kpi("bw_calls", "Calls", "calls"),
  kpi("bw_minutes", "Call minutes", "callMinutes"),
  kpi("bw_tokens", "Total tokens", "totalTokens"),
  kpi("bw_emails", "Emails", "emails"),
  overTime("bw_cost_ot", "Estimated cost over time", "line", "totalCost"),
  overTime("bw_calls_ot", "Calls over time", "bar", "calls"),
  overTime("bw_minutes_ot", "Call minutes over time", "bar", "callMinutes"),
];

// Read a scope, creating it (seeded with the defaults) on first access so it's never empty.
export async function getBillingDashboard(scope: BillingDashboardScope): Promise<{ scope: string; widgets: any[] }> {
  const row = await db.billingDashboard.upsert({
    where: { scope },
    update: {},
    create: { scope, widgets: DEFAULT_BILLING_WIDGETS },
  });
  return { scope: row.scope, widgets: Array.isArray(row.widgets) ? row.widgets : [] };
}

// Replace a scope's widget layout. Validates that widgets is an array (matching the reports
// PATCH contract, which sends the full widget list).
export async function updateBillingDashboard(scope: BillingDashboardScope, widgets: unknown): Promise<{ scope: string; widgets: any[] }> {
  if (!Array.isArray(widgets)) throw new Error("widgets must be an array");
  const row = await db.billingDashboard.upsert({
    where: { scope },
    update: { widgets },
    create: { scope, widgets },
  });
  return { scope: row.scope, widgets: Array.isArray(row.widgets) ? row.widgets : [] };
}
