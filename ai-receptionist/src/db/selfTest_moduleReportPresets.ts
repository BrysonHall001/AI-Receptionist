// Self-test for the CONDITIONAL report presets on the five pre-built modules
// (Estimates, Tasks, Vehicles, Properties, Products & Services).
//
//   npx tsx src/db/selfTest_moduleReportPresets.ts     (needs dev Postgres for the field check)
//
// Proves:
//  (1) every module preset is STRUCTURALLY VALID against its module's source fields —
//      i.e. it runs cleanly through the Reports aggregate()/render path (source known,
//      valid type + measure, group-by fields exist, date buckets only on date fields).
//      validateReportPreset() mirrors what aggregate() needs.  <-- PROVES THE PRESETS APPLY
//  (2) each module's templates ARE offered only when that module's type exists, and
//      NOT for a portal without it (the conditional gating).   <-- PROVES CONDITIONAL GATING
//  (3) new module presets live in the EXISTING FUNCTIONAL categories (no per-module
//      category), and the public projection leaks NO internal-only `vertical` tag.
//  (4) every field a preset references (group-by, measure, and filter keys) is a REAL
//      default field on that module's record type — so each template applies cleanly.
import { prisma, disconnectDb } from "./client";
import {
  REPORT_PRESET_CATEGORIES, RECORD_TYPE_PRESETS, RECORD_TYPE_PRESET_FIELDS,
  validateReportPreset, recordTypePresetsFor, publicRecordTypePresets,
} from "../analytics/reportPresets";
import { resolveRecordTypeId } from "../services/recordTypeService";
import { listFields } from "../services/fieldService";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const MODULES = ["estimate", "task", "vehicle", "property", "product"] as const;
const FUNCTIONAL = new Set(["volume_activity", "conversion_pipeline", "breakdowns", "trends"]);

const tenantIds: string[] = [];
async function mkTenant() {
  const t = await prisma.tenant.create({ data: { name: `mrp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, notifyEmail: `mrp-${Date.now()}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}

async function main() {
  console.log("Module report presets — valid + gated (functional cats) + no leak + real fields");
  console.log("================================================================================");

  const catKeys = new Set(REPORT_PRESET_CATEGORIES.map((c) => c.key));
  // The per-module "Equipment" category is gone — everything is functional now.
  check(!catKeys.has("equipment"), "the per-module 'equipment' category has been removed from REPORT_PRESET_CATEGORIES");

  // (1) validity + FUNCTIONAL category + correct source, for every module preset.
  let total = 0;
  for (const mod of MODULES) {
    const presets = RECORD_TYPE_PRESETS[mod] || [];
    check(presets.length >= 1, `${mod} ships >= 1 template (got ${presets.length})`);
    for (const p of presets) {
      total++;
      const probs = validateReportPreset(p);
      check(probs.length === 0, `preset "${p.key}" is structurally valid & renderable${probs.length ? " — " + probs.join("; ") : ""}`);
      check(FUNCTIONAL.has(p.category), `preset "${p.key}" sits in a FUNCTIONAL category ("${p.category}"), not a per-module one`);
      check(p.widget.source === mod, `preset "${p.key}" targets the ${mod} source`);
    }
  }
  check(total >= 8, `at least 8 new module templates ship (got ${total})`);

  // (2) CONDITIONAL GATING — a module's templates are offered only when its type is present.
  check(recordTypePresetsFor([]).length === 0, "no record-type templates for a portal with no matching types"); // proves gating floor
  const estimateOnly = recordTypePresetsFor(["estimate"]);
  check(estimateOnly.length === (RECORD_TYPE_PRESETS.estimate || []).length, "estimate templates ARE offered when the estimate type exists");
  check(estimateOnly.every((p) => p.widget.source === "estimate"), "a portal with ONLY estimates gets ONLY estimate templates (no task/vehicle/property/product)"); // proves conditional gating
  const taskOnly = recordTypePresetsFor(["task"]);
  check(taskOnly.length === (RECORD_TYPE_PRESETS.task || []).length && taskOnly.every((p) => p.widget.source === "task"), "task templates are gated to portals that have the task type");
  // All five present -> the union of all module presets (plus equipment if asked).
  const allFive = recordTypePresetsFor([...MODULES]);
  check(allFive.length === total, "all five modules present -> every module template is offered");

  // (3) strip — no internal `vertical` tag leaks in the public projection.
  const pub = publicRecordTypePresets([...MODULES]);
  check(pub.length === total, "public projection returns all module presets");
  check(!pub.some((p: any) => "vertical" in p || (p.widget && "vertical" in p.widget)), "public module presets have no 'vertical' key");
  check(!JSON.stringify(pub).includes("vertical"), "serialized public module presets contain 'vertical' NOWHERE");
  check(pub.every((p: any) => p.widget && p.widget.type && p.widget.source && p.widget.measure), "every served module preset carries a ready-to-apply widget");

  // (4) every referenced field key (group-by + numeric measure + filter) is a REAL default
  //     field on that module's record type, and the allowlist agrees with the real fields.
  const synthetic = new Set(["title", "createdAt"]);
  const T = await mkTenant();
  for (const mod of MODULES) {
    await resolveRecordTypeId(T, mod); // seeds the module + its default fields
    const fieldKeys = new Set((await listFields(T, mod)).map((f: any) => f.key));
    const referenced = new Set<string>();
    for (const p of RECORD_TYPE_PRESETS[mod] || []) {
      for (const d of p.widget.groupBy || []) referenced.add((d as any).key);
      if (p.widget.measure && (p.widget.measure as any).field) referenced.add((p.widget.measure as any).field);
      for (const f of (p.widget.filters as any[]) || []) if (f && f.key) referenced.add(f.key);
    }
    const realRefs = [...referenced].filter((k) => !synthetic.has(k));
    for (const k of realRefs) check(fieldKeys.has(k), `[${mod}] preset field "${k}" is a real default field on the ${mod} type`);
    const allow = (RECORD_TYPE_PRESET_FIELDS[mod] || []).map((f) => f.key).filter((k) => !synthetic.has(k));
    check(allow.every((k) => fieldKeys.has(k)), `[${mod}] every allowlist field exists on the real ${mod} type`);
  }
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (module presets valid, gated to functional cats, clean, real-field-backed)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
