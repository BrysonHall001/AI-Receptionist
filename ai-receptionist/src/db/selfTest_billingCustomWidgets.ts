// Self-test: global billing dashboards (scopes, defaults, persistence, validation).
// Run: npx tsx src/db/selfTest_billingCustomWidgets.ts
import { prisma } from "./client";
import {
  BILLING_DASHBOARD_SCOPES,
  isBillingDashboardScope,
  DEFAULT_BILLING_WIDGETS,
  getBillingDashboard,
  updateBillingDashboard,
} from "../services/billingDashboardService";

let failures = 0;
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
}

async function main() {
  console.log("billing custom widgets self-test\n");

  // Scope validation.
  check(isBillingDashboardScope("tenant_drilldown") && isBillingDashboardScope("macro"), "both scopes are valid");
  check(!isBillingDashboardScope("nope") && !isBillingDashboardScope(""), "unknown scopes rejected");
  check(BILLING_DASHBOARD_SCOPES.length === 2, "exactly two scopes");

  // Defaults: KPIs + over-time, all over the usage source.
  check(DEFAULT_BILLING_WIDGETS.length === 8, "8 default widgets");
  check(DEFAULT_BILLING_WIDGETS.filter((w) => w.type === "kpi").length === 5, "5 KPI defaults");
  check(DEFAULT_BILLING_WIDGETS.every((w) => w.source === "usage"), "defaults use the usage source");
  check(DEFAULT_BILLING_WIDGETS.some((w) => w.type === "line") && DEFAULT_BILLING_WIDGETS.some((w) => w.type === "bar"), "defaults include line + bar over-time");

  // Seed-on-read: a fresh scope returns the defaults (migration seeds these; this also covers
  // the defensive upsert path).
  const macro = await getBillingDashboard("macro");
  check(Array.isArray(macro.widgets) && macro.widgets.length >= 8, "macro seeds with >= 8 widgets");
  const drill = await getBillingDashboard("tenant_drilldown");
  check(Array.isArray(drill.widgets) && drill.widgets.length >= 8, "tenant_drilldown seeds with >= 8 widgets");

  // Persistence: update replaces the layout; re-read reflects it.
  const custom = [{ id: "t1", title: "Custom", source: "usage", type: "kpi", measure: { op: "sum", field: "calls" }, groupBy: [], series: [], filters: [] }];
  const saved = await updateBillingDashboard("macro", custom);
  check(saved.widgets.length === 1 && saved.widgets[0].id === "t1", "update replaces macro widgets");
  const reread = await getBillingDashboard("macro");
  check(reread.widgets.length === 1 && reread.widgets[0].title === "Custom", "re-read returns the saved layout");

  // Editing tenant_drilldown is shared (single row) — a save is visible on the next read.
  await updateBillingDashboard("tenant_drilldown", custom.concat(custom.map((w) => ({ ...w, id: "t2" }))));
  const drill2 = await getBillingDashboard("tenant_drilldown");
  check(drill2.widgets.length === 2, "tenant_drilldown layout is shared/persisted");

  // Validation: non-array is rejected.
  let threw = false;
  try { await updateBillingDashboard("macro", { not: "an array" } as any); } catch { threw = true; }
  check(threw, "non-array widgets rejected");

  // Restore defaults so the suite is repeatable.
  await updateBillingDashboard("macro", DEFAULT_BILLING_WIDGETS);
  await updateBillingDashboard("tenant_drilldown", DEFAULT_BILLING_WIDGETS);

  console.log(failures === 0 ? "\nALL PASSED ✅" : `\n${failures} FAILED ❌`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
