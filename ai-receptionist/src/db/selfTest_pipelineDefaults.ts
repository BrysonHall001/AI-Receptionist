// Self-test — pipelineEnabled defaults MATCH current reality, so existing modules are unchanged.
//
//   npx tsx src/db/selfTest_pipelineDefaults.ts     (needs dev Postgres)
//
// Proves the PRIME DIRECTIVE (no behavior change for existing modules):
//  (1) every seeded module's pipelineEnabled EQUALS whether it actually has a pipeline
//      (any subtypes / record statuses / relationship stages) — the exact migration rule. <-- unchanged
//  (2) Jobs = true and Bookings = true (they had pipelines); the flat modules
//      (Contacts, Equipment, Vehicles, Properties, Products, Estimates, Tasks, Invoices) = false.
//  (3) Jobs' actual pipeline data (6 stages, 3 subtypes, record statuses) is intact.
import { prisma, disconnectDb } from "./client";
import { listRecordTypes } from "../services/recordTypeService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];

async function main() {
  console.log("Pipeline defaults — pipelineEnabled matches reality (no change for existing modules)");
  console.log("================================================================================");

  const t = await prisma.tenant.create({ data: { name: `pl-${stamp}`, notifyEmail: `pl-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);
  const types: any[] = await listRecordTypes(t.id);
  const byKey: Record<string, any> = {}; types.forEach((x) => (byKey[x.key] = x));

  // (1) parity: pipelineEnabled === "has a pipeline" for EVERY module (the migration rule).
  const hasPipeline = (x: any) => ((x.subtypes || []).length > 0 || (x.recordStages || []).length > 0 || (x.stages || []).length > 0);
  for (const x of types) {
    check(x.pipelineEnabled === hasPipeline(x), `"${x.key}" pipelineEnabled (${x.pipelineEnabled}) matches whether it has a pipeline (${hasPipeline(x)})`);
  }

  // (2) explicit expectations.
  check(byKey.job && byKey.job.pipelineEnabled === true, "Jobs default pipelineEnabled = TRUE");
  check(byKey.booking && byKey.booking.pipelineEnabled === true, "Bookings default pipelineEnabled = TRUE");
  check(byKey.work_order && byKey.work_order.pipelineEnabled === true, "Work Orders default pipelineEnabled = TRUE (Work Orders batch)");
  const flat = ["contact", "equipment", "vehicle", "property", "product", "estimate", "task", "invoice"];
  for (const k of flat) check(byKey[k] && byKey[k].pipelineEnabled === false, `${k} default pipelineEnabled = FALSE (flat)`);

  // (3) Jobs' pipeline data intact (identical to before).
  check(byKey.job && (byKey.job.stages || []).length === 6, "Jobs still has its 6 relationship stages");
  check(byKey.job && (byKey.job.subtypes || []).length === 3, "Jobs still has its 3 types (subtypes) with pipelines");
  check(byKey.job && (byKey.job.recordStages || []).length > 0, "Jobs still has its record statuses");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (pipelineEnabled matches reality; Jobs/Bookings on, flat modules off; Jobs intact)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
