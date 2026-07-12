// Self-test — the Pipeline on/off toggle: enables the editors, is NON-DESTRUCTIVE, is guarded
// by the module-management permission, and the editors are grouped under "Structure & behavior".
//
//   npx tsx src/db/selfTest_pipelineToggle.ts     (needs dev Postgres)
//
// Proves:
//  (1) toggling a flat module ON sets pipelineEnabled=true (which reveals the stages editor);
//  (2) turning it back OFF is NON-DESTRUCTIVE — types/stages added while on are KEPT (and
//      pipelineEnabled=false), so turning it on again restores them;                  <-- safe choice
//  (3) the toggle endpoint is guarded by the module-management permission (fieldsAdminOnly);
//  (4) Modules & Fields groups the editors under a "Structure & behavior" section with the toggle.
import { prisma, disconnectDb } from "./client";
import { listRecordTypes, setPipelineEnabled, addSubtype, addStage } from "../services/recordTypeService";
import { readFileSync } from "fs";
import { resolve } from "path";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
const typeOf = async (tid: string, key: string) => (await listRecordTypes(tid) as any[]).find((x) => x.key === key);

async function main() {
  console.log("Pipeline toggle — enables editors, non-destructive, guarded, grouped");
  console.log("===================================================================");

  const t = await prisma.tenant.create({ data: { name: `pt-${stamp}`, notifyEmail: `pt-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id);

  // Products starts flat (pipeline off).
  let product = await typeOf(t.id, "product");
  check(product && product.pipelineEnabled === false, "Products starts flat (pipelineEnabled = false)");

  // (1) Toggle ON -> pipelineEnabled true (stages editor becomes available), data still empty.
  const on = await setPipelineEnabled(t.id, "product", true);
  check(on.pipelineEnabled === true, "toggling ON sets pipelineEnabled = true");
  check((on.subtypes || []).length === 0, "toggling ON starts with an empty pipeline to build (no invented stages)");

  // Build a little pipeline while ON: a subtype + a stage inside it.
  await addSubtype(t.id, "product", "Warranty");
  product = await typeOf(t.id, "product");
  const subKey = (product.subtypes[0] || {}).key;
  check(!!subKey, "a type (subtype) can be added while the pipeline is on");
  await addStage(t.id, "product", subKey, "In review");
  product = await typeOf(t.id, "product");
  check(((product.subtypes[0] || {}).stages || []).length === 1, "a stage can be added to the type's pipeline");

  // (2) Toggle OFF -> non-destructive: the subtype + stage are KEPT, pipelineEnabled=false.
  const off = await setPipelineEnabled(t.id, "product", false);
  check(off.pipelineEnabled === false, "toggling OFF sets pipelineEnabled = false");
  product = await typeOf(t.id, "product");
  check((product.subtypes || []).length === 1 && ((product.subtypes[0] || {}).stages || []).length === 1,
    "toggling OFF is NON-DESTRUCTIVE — the type + stage are kept, not deleted"); // proves safe choice
  // Turning it back ON restores the same pipeline.
  const reon = await setPipelineEnabled(t.id, "product", true);
  check(reon.pipelineEnabled === true && (reon.subtypes || []).length === 1, "turning it back ON restores the pipeline exactly");

  // (3) endpoint guarded by the module-management permission.
  const api = readFileSync(resolve(__dirname, "../../src/routes/api.ts"), "utf8");
  const idx = api.indexOf('/record-types/pipeline');
  const routeBlock = idx >= 0 ? api.slice(idx, api.indexOf("apiRouter.", idx + 10)) : "";
  check(idx >= 0, "the /record-types/pipeline endpoint exists");
  check(/fieldsAdminOnly\(req, res\)/.test(routeBlock), "the pipeline endpoint is guarded by fieldsAdminOnly (module-management permission)");
  check(/setPipelineEnabled\(/.test(routeBlock), "the endpoint calls setPipelineEnabled");

  // (4) editors grouped under "Structure & behavior" with the toggle, in the Modules & Fields UI.
  const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
  check(/function structureSection\(\)/.test(portal), "portal.js builds a Structure & behavior section");
  check(/"Structure & behavior"/.test(portal), "the section carries the 'Structure & behavior' heading");
  check(/\/api\/record-types\/pipeline/.test(portal), "the toggle posts to the pipeline endpoint");
  check(/if \(on\) \{ sec\.appendChild\(subtypesCard\(\)\); sec\.appendChild\(statusesCard\(\)\); \}/.test(portal), "the types/pipelines + Statuses editors show only when the pipeline is on");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (toggle enables editors, is non-destructive + guarded + grouped)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
