// Self-test for the CONDITIONAL equipment report presets.
//
//   npx tsx src/db/selfTest_equipmentReportPresets.ts        (needs dev Postgres for the field check)
//
// Proves:
//  (1) every equipment preset is STRUCTURALLY VALID against the equipment source
//      fields — i.e. it runs cleanly through the Reports aggregate()/render path
//      (source known, valid type + measure, group-by fields exist, date buckets
//      only on date fields). validateReportPreset() mirrors what aggregate() needs.
//  (2) equipment templates ARE offered when the equipment type exists and are NOT
//      offered for a portal without it (the conditional gating).
//  (3) the public projection leaks NO internal-only `vertical` tag (strip test).
//  (4) every field the equipment presets reference is a REAL default field on the
//      equipment record type (so each template applies cleanly).
import { prisma, disconnectDb } from "./client";
import {
  REPORT_PRESET_CATEGORIES, RECORD_TYPE_PRESETS, RECORD_TYPE_PRESET_FIELDS,
  validateReportPreset, recordTypePresetsFor, publicRecordTypePresets,
} from "../analytics/reportPresets";
import { resolveRecordTypeId } from "../services/recordTypeService";
import { listFields } from "../services/fieldService";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const tenantIds: string[] = [];
async function mkTenant() {
  const t = await prisma.tenant.create({ data: { name: `erp-${Date.now()}`, notifyEmail: `erp-${Date.now()}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}

async function main() {
  console.log("Equipment report presets — valid + gated + no leak + real fields");
  console.log("================================================================");

  const equip = RECORD_TYPE_PRESETS.equipment || [];
  const catKeys = new Set(REPORT_PRESET_CATEGORIES.map((c) => c.key));

  // (1) validity + known category
  check(equip.length >= 5, `equipment ships >= 5 templates (got ${equip.length})`);
  for (const p of equip) {
    const probs = validateReportPreset(p);
    check(probs.length === 0, `preset "${p.key}" is structurally valid & renderable${probs.length ? " — " + probs.join("; ") : ""}`);
    check(catKeys.has(p.category), `preset "${p.key}" uses a known category ("${p.category}")`);
    check(p.widget.source === "equipment", `preset "${p.key}" targets the equipment source`);
  }

  // (2) CONDITIONAL GATING — offered with equipment, withheld without it
  const withEquip = recordTypePresetsFor(["contact", "job", "booking", "equipment"]);
  const withoutEquip = recordTypePresetsFor(["contact", "job", "booking"]);
  check(withEquip.length === equip.length, "equipment templates ARE offered when the equipment type exists");
  check(withoutEquip.length === 0, "equipment templates are NOT offered for a portal without the equipment type"); // <-- proves conditional gating
  check(recordTypePresetsFor([]).length === 0, "no record-type templates for a portal with no matching types");

  // (3) strip — no internal `vertical` tag leaks in the public projection
  const pub = publicRecordTypePresets(["equipment"]);
  check(pub.length === equip.length, "public projection returns all equipment presets");
  check(!pub.some((p: any) => "vertical" in p || (p.widget && "vertical" in p.widget)), "public equipment presets have no 'vertical' key");
  check(!JSON.stringify(pub).includes("vertical"), "serialized public equipment presets contain 'vertical' NOWHERE");
  check(pub.every((p: any) => p.widget && p.widget.type && p.widget.source && p.widget.measure), "every served equipment preset carries a ready-to-apply widget");

  // (4) the preset field keys are REAL equipment default fields
  const T = await mkTenant();
  await resolveRecordTypeId(T, "equipment"); // seeds equipment + its default fields
  const fieldKeys = new Set((await listFields(T, "equipment")).map((f: any) => f.key));
  // Keys referenced by the presets' group-by dimensions (skip synthetic title/createdAt).
  const synthetic = new Set(["title", "createdAt"]);
  const referenced = new Set<string>();
  for (const p of equip) for (const d of p.widget.groupBy || []) referenced.add((d as any).key);
  const realRefs = [...referenced].filter((k) => !synthetic.has(k));
  for (const k of realRefs) check(fieldKeys.has(k), `preset field "${k}" is a real default field on the equipment type`);
  // And the validator allowlist agrees with the real field set for the keys it lists.
  const allow = RECORD_TYPE_PRESET_FIELDS.equipment.map((f) => f.key).filter((k) => !synthetic.has(k));
  check(allow.every((k) => fieldKeys.has(k)), "every equipment allowlist field exists on the real equipment type");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (equipment presets valid, gated, clean, real-field-backed)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
