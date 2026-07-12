// Self-test for the new pre-built-module automation presets (date reminders on the
// Estimates and Tasks modules).
//
//   npx tsx src/db/selfTest_moduleAutomationPresets.ts    (needs dev Postgres for apply)
//
// Proves:
//  (1) each new preset's trigger PARSES as a RecordDateReached trigger on the named
//      module + date field (estimate.valid_until / task.due_date), with the right
//      direction (before / after).
//  (2) each new preset APPLIES AS AN INACTIVE DRAFT via the same applyFlowDefinition()
//      the /automations/presets/apply route uses — automation.enabled === false. <-- PROVES APPLY
//  (3) the "Overdue task alert" carries the status-is-not-Done condition (so the sweep
//      skips tasks already marked Done).
//  (4) the presets sit in the existing FUNCTIONAL "follow_ups" category (no per-module one).
import { prisma, disconnectDb } from "./client";
import { AUTOMATION_PRESETS, getPreset } from "../automation/presets";
import { parseRecordDateTrigger } from "../automation/scheduler";
import { applyFlowDefinition } from "../services/flowProvisioningService";
import { resolveRecordTypeId } from "../services/recordTypeService";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

// The three presets added this batch, with the module + date field each targets.
const NEW = [
  { key: "estimate_expiring_reminder", mod: "estimate", field: "valid_until", dir: "before" },
  { key: "task_due_soon_reminder", mod: "task", field: "due_date", dir: "before" },
  { key: "task_overdue_alert", mod: "task", field: "due_date", dir: "after" },
];

const tenantIds: string[] = [];
async function mkTenant() {
  const t = await prisma.tenant.create({ data: { name: `map-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, notifyEmail: `map-${Date.now()}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}

async function main() {
  console.log("Module automation presets — trigger parses + applies as inactive draft");
  console.log("======================================================================");

  // (1) & (4) — presence, parse, category (pure).
  for (const spec of NEW) {
    const p = getPreset(spec.key);
    check(!!p, `preset "${spec.key}" exists`);
    if (!p) continue;
    check(p.category === "follow_ups", `preset "${spec.key}" is in the FUNCTIONAL "follow_ups" category (got "${p.category}")`);
    const parsed = parseRecordDateTrigger((p.definition as any).triggerType);
    check(!!parsed, `preset "${spec.key}" trigger parses as a RecordDateReached trigger`);
    if (parsed) {
      check(parsed.recordTypeKey === spec.mod, `[${spec.key}] targets the ${spec.mod} module (got "${parsed.recordTypeKey}")`);
      check(parsed.field === spec.field, `[${spec.key}] fires on the ${spec.field} date field (got "${parsed.field}")`);
      check(parsed.dir === spec.dir, `[${spec.key}] direction is "${spec.dir}" (got "${parsed.dir}")`);
    }
  }

  // (3) — the overdue alert only runs for tasks that aren't Done.
  const overdue = getPreset("task_overdue_alert");
  const conds = ((overdue?.definition as any)?.conditions || []) as any[];
  check(conds.some((c) => c.field === "status" && c.op === "is_not" && c.value === "Done"),
    "task_overdue_alert carries the status-is-not-Done condition");

  // (2) — apply each preset as a draft in a real portal and confirm enabled:false.
  const T = await mkTenant();
  // Seed the modules so analyzeFlowDefinition sees their fields (no missing-field noise).
  await resolveRecordTypeId(T, "estimate");
  await resolveRecordTypeId(T, "task");
  for (const spec of NEW) {
    const p = getPreset(spec.key)!;
    const result = await applyFlowDefinition(T, p.definition, null);
    check(!!result.automation, `[${spec.key}] applied -> an automation row was created`);
    check(result.automation.enabled === false, `[${spec.key}] applies as an INACTIVE DRAFT (enabled === false)`); // proves apply-as-draft
    check(result.automation.triggerType === (p.definition as any).triggerType, `[${spec.key}] the draft keeps the module date-reached trigger`);
  }

  // Sanity: the total preset count grew by exactly the three we added over the prior set.
  check(AUTOMATION_PRESETS.filter((p) => NEW.some((n) => n.key === p.key)).length === NEW.length,
    "all three new module presets are present in AUTOMATION_PRESETS");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (module automation presets parse + apply as drafts)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
