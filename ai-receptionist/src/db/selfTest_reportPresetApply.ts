// DB-backed self-test: applying a template appends its widget to a dashboard's
// widgets array and it PERSISTS through the normal dashboard save path.
//
//   npx tsx src/db/selfTest_reportPresetApply.ts        (needs dev Postgres)
import { prisma, disconnectDb } from "./client";
import { createDashboard, updateDashboard, listDashboards } from "../services/dashboardService";
import { REPORT_PRESETS } from "../analytics/reportPresets";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

let tenantId = "";
async function main() {
  console.log("Apply report template → persists on dashboard\n==============================================");
  const t = await prisma.tenant.create({ data: { name: `rpt-${stamp}`, notifyEmail: `rpt-${stamp}@ex.com`, billingStatus: "active" } });
  tenantId = t.id;

  const dash = await createDashboard(tenantId, "Test dashboard", null);
  check(Array.isArray(dash.widgets) && dash.widgets.length === 0, "new dashboard starts with no widgets");

  // Simulate the client "Add to dashboard": clone the preset widget, give it an id,
  // append, and save via the same updateDashboard path the UI uses.
  const preset = REPORT_PRESETS[0];
  const widget = Object.assign(JSON.parse(JSON.stringify(preset.widget)), { id: "w_apply_" + stamp });
  await updateDashboard(dash.id, tenantId, { widgets: [...dash.widgets, widget] }, "PORTAL_ADMIN");

  const after = (await listDashboards(tenantId)).find((d: any) => d.id === dash.id);
  check(!!after && Array.isArray(after.widgets) && after.widgets.some((w: any) => w.id === widget.id), "applied template widget PERSISTS on the dashboard");
  const saved = after && after.widgets.find((w: any) => w.id === widget.id);
  check(!!saved && saved.type === preset.widget.type && saved.source === preset.widget.source && !!saved.measure, "persisted widget keeps the preset's shape (type/source/measure)");

  // Appending a second one keeps the first (true append, not replace).
  const w2 = Object.assign(JSON.parse(JSON.stringify(REPORT_PRESETS[1].widget)), { id: "w_apply2_" + stamp });
  await updateDashboard(dash.id, tenantId, { widgets: [...after!.widgets, w2] }, "PORTAL_ADMIN");
  const after2 = (await listDashboards(tenantId)).find((d: any) => d.id === dash.id);
  check(!!after2 && after2.widgets.length === 2, "a second template appends (dashboard now has 2 widgets)");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (template apply persists)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
