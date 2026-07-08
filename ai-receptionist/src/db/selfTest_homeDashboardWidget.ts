// DB-backed self-test: adding a template/wizard widget to the HOME dashboard uses
// the SAME shared path (updateDashboard) as an Analytics dashboard and persists.
//
//   npx tsx src/db/selfTest_homeDashboardWidget.ts        (needs dev Postgres)
import { prisma, disconnectDb } from "./client";
import { getOrCreateHomeDashboard, updateDashboard } from "../services/dashboardService";
import { REPORT_PRESETS } from "../analytics/reportPresets";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

let tenantId = "";
async function main() {
  console.log("Home Dashboard on-ramp — widget add persists\n============================================");
  const t = await prisma.tenant.create({ data: { name: `home-${stamp}`, notifyEmail: `home-${stamp}@ex.com`, billingStatus: "active" } });
  tenantId = t.id;

  const home = await getOrCreateHomeDashboard(tenantId, null);
  check(Array.isArray(home.widgets) && home.widgets.length === 0, "home dashboard starts with no widgets");

  // Simulate the on-ramp "Add to dashboard" on the Home Dashboard.
  const widget = Object.assign(JSON.parse(JSON.stringify(REPORT_PRESETS[0].widget)), { id: "w_home_" + stamp });
  await updateDashboard(home.id, tenantId, { widgets: [...home.widgets, widget] }, "PORTAL_ADMIN");

  const home2 = await getOrCreateHomeDashboard(tenantId, null);
  check(home2.id === home.id, "same single persistent home dashboard is returned");
  check(Array.isArray(home2.widgets) && home2.widgets.some((w: any) => w.id === widget.id), "template/wizard widget PERSISTS on the Home Dashboard");
  const saved = home2.widgets.find((w: any) => w.id === widget.id);
  check(!!saved && saved.type === REPORT_PRESETS[0].widget.type && saved.source === REPORT_PRESETS[0].widget.source, "persisted home widget keeps the preset's shape");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (home dashboard widget add persists)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
