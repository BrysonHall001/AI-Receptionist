// Self-test: shared billing dashboards service (list/create/rename/widgets/reorder/delete +
// per-widget scope). (Supersedes the earlier per-scope custom-widgets test.)
//   npx tsx src/db/selfTest_billingCustomWidgets.ts
import { prisma, disconnectDb } from "./client";
import {
  WIDGET_SCOPES, isWidgetScope, DEFAULT_BILLING_WIDGETS,
  listBillingDashboards, createBillingDashboard, renameBillingDashboard,
  updateBillingDashboardWidgets, deleteBillingDashboard, reorderBillingDashboards,
} from "../services/billingDashboardService";

let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }

async function main() {
  console.log("shared billing dashboards\n=========================");

  check(WIDGET_SCOPES.length === 3 && isWidgetScope("both") && isWidgetScope("macro") && isWidgetScope("tenant") && !isWidgetScope("nope"), "widget scopes: both/macro/tenant");
  check(DEFAULT_BILLING_WIDGETS.length === 8 && DEFAULT_BILLING_WIDGETS.every((w) => w.scope === "both"), "8 default widgets, all scope 'both'");

  const created: string[] = [];
  try {
    // Seed-on-empty: list creates a default Overview if none exist.
    const initial = await listBillingDashboards();
    check(initial.length >= 1 && initial.some((d: any) => d.name === "Overview"), "list seeds/returns at least an Overview dashboard");

    const a = await createBillingDashboard("Test A"); created.push(a.id);
    const b = await createBillingDashboard("Test B"); created.push(b.id);
    check(a.sortOrder < b.sortOrder, "new dashboards get increasing sortOrder");

    const renamed = await renameBillingDashboard(a.id, "Test A2");
    check(renamed.name === "Test A2", "rename works");

    const widgets = [
      { id: "w1", title: "Macro only", source: "usage", type: "kpi", scope: "macro", measure: { op: "sum", field: "totalCost" }, groupBy: [] },
      { id: "w2", title: "Tenant only", source: "usage", type: "kpi", scope: "tenant", measure: { op: "sum", field: "calls" }, groupBy: [] },
      { id: "w3", title: "Both", source: "usage", type: "bar", measure: { op: "sum", field: "callMinutes" }, groupBy: [{ key: "date" }] },
    ];
    const withW = await updateBillingDashboardWidgets(a.id, widgets);
    check(withW.widgets.length === 3, "widgets saved");
    check(withW.widgets[2].scope === "both", "widget without scope normalized to 'both'");
    check(withW.widgets[0].scope === "macro" && withW.widgets[1].scope === "tenant", "explicit scopes preserved");

    let threw = false; try { await updateBillingDashboardWidgets(a.id, "nope" as any); } catch { threw = true; }
    check(threw, "non-array widgets rejected");

    // Reorder B before A2.
    const list = await listBillingDashboards();
    const ids = list.map((d: any) => d.id);
    const reordered = ids.slice().reverse();
    const after = await reorderBillingDashboards(reordered);
    check(after[0].id === reordered[0] && after[after.length - 1].id === reordered[reordered.length - 1], "reorder sets sortOrder by index");

    await deleteBillingDashboard(b.id); created.splice(created.indexOf(b.id), 1);
    const afterDel = await listBillingDashboards();
    check(!afterDel.some((d: any) => d.id === b.id), "delete removes the dashboard");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    for (const id of created) { try { await (prisma as any).billingDashboard.delete({ where: { id } }); } catch {} }
  }

  console.log("\n=========================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (shared billing dashboards)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
