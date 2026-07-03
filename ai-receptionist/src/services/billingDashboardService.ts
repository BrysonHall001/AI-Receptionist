// Shared master-hub billing dashboards (a SET of named dashboards, global). Rendered in both
// the Overview (all-tenants) and each tenant panel (that tenant's data); per-widget `scope`
// controls where each widget shows.
import { prisma } from "../db/client";

const db = prisma as any;

export const WIDGET_SCOPES = ["both", "macro", "tenant"] as const;
export type WidgetScope = (typeof WIDGET_SCOPES)[number];
export function isWidgetScope(v: unknown): v is WidgetScope {
  return typeof v === "string" && (WIDGET_SCOPES as readonly string[]).includes(v);
}

// Default widgets for a brand-new install (KPIs + cost/calls/minutes over time), scope "both".
const kpi = (id: string, title: string, field: string) => ({ id, title, source: "usage", type: "kpi", scope: "both", measure: { op: "sum", field }, groupBy: [] as any[], series: [] as any[], filters: [] as any[] });
const overTime = (id: string, title: string, type: string, field: string) => ({ id, title, source: "usage", type, scope: "both", measure: { op: "sum", field }, groupBy: [{ key: "date" }], series: [] as any[], filters: [] as any[] });
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

function serialize(d: any) {
  return { id: d.id, name: d.name, widgets: Array.isArray(d.widgets) ? d.widgets : [], sortOrder: d.sortOrder, createdAt: d.createdAt, updatedAt: d.updatedAt };
}

// List all dashboards (seed a default "Overview" if the set is empty).
export async function listBillingDashboards() {
  let rows = await db.billingDashboard.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  if (!rows.length) {
    await db.billingDashboard.create({ data: { name: "Overview", widgets: DEFAULT_BILLING_WIDGETS, sortOrder: 0 } });
    rows = await db.billingDashboard.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  }
  return rows.map(serialize);
}

export async function createBillingDashboard(name: string) {
  const nm = String(name || "").trim();
  if (!nm) throw new Error("name is required");
  const max = await db.billingDashboard.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (max?._max?.sortOrder ?? -1) + 1;
  const row = await db.billingDashboard.create({ data: { name: nm, widgets: [], sortOrder } });
  return serialize(row);
}

export async function renameBillingDashboard(id: string, name: string) {
  const nm = String(name || "").trim();
  if (!nm) throw new Error("name is required");
  const row = await db.billingDashboard.update({ where: { id }, data: { name: nm } });
  return serialize(row);
}

export async function updateBillingDashboardWidgets(id: string, widgets: unknown) {
  if (!Array.isArray(widgets)) throw new Error("widgets must be an array");
  const normalized = (widgets as any[]).map((w) => ({ ...w, scope: isWidgetScope(w && w.scope) ? w.scope : "both" }));
  const row = await db.billingDashboard.update({ where: { id }, data: { widgets: normalized } });
  return serialize(row);
}

export async function deleteBillingDashboard(id: string) {
  await db.billingDashboard.delete({ where: { id } });
  return { ok: true };
}

// Reorder by an ordered list of ids (index -> sortOrder).
export async function reorderBillingDashboards(ids: unknown) {
  if (!Array.isArray(ids)) throw new Error("ids must be an array");
  await db.$transaction((ids as string[]).map((id, i) => db.billingDashboard.update({ where: { id }, data: { sortOrder: i } })));
  return listBillingDashboards();
}
