// Self-test for the five pre-built industry modules (Vehicles, Properties, Products &
// Services, Estimates, Tasks). Proves each is registered with correct label/order + seeded
// default fields, that they're togglable-but-default-hidden in the create-tenant picker (while
// the existing modules keep their default), and that Estimates' total auto-computes.
//
//   npx tsx src/db/selfTest_prebuiltModules.ts        (needs dev Postgres)
import { prisma, disconnectDb } from "./client";
import { listRecordTypes, systemRecordTypeOptions, ensureAllSystemRecordTypes } from "../services/recordTypeService";
import { listFields } from "../services/fieldService";
import { createRecord, getRecord } from "../services/recordService";

const db = prisma as any;
const T_NAME = "__SELFTEST_PREBUILT__";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const FIVE = [
  { key: "vehicle", label: "Vehicle", plural: "Vehicles", order: 5, sample: ["vin", "make", "vehicle_type", "status"] },
  { key: "property", label: "Property", plural: "Properties", order: 6, sample: ["property_address", "property_type", "beds", "status"] },
  { key: "product", label: "Product", plural: "Products", order: 7, sample: ["sku", "price", "unit", "category"] },
  { key: "estimate", label: "Estimate", plural: "Estimates", order: 8, sample: ["estimate_number", "line_items", "total", "status"] },
  { key: "task", label: "Task", plural: "Tasks", order: 9, sample: ["due_date", "priority", "status", "assignee"] },
];

async function main() {
  console.log("Pre-built modules — registry + seeded fields + default-off picker");
  console.log("================================================================\n");
  const before = { tenants: await db.tenant.count() };

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    await ensureAllSystemRecordTypes(tId);
    const types = await listRecordTypes(tId);
    const byKey: any = {}; (types as any[]).forEach((x) => (byKey[x.key] = x));

    // (1) ALL FIVE REGISTERED (with the existing four/five still present).
    console.log("(1) all five registered alongside the existing modules:");
    check(["contact", "job", "booking", "equipment", "invoice"].every((k) => byKey[k]), "existing modules (contact/job/booking/equipment/invoice) still present");
    check(FIVE.every((m) => byKey[m.key]), "ALL FIVE new modules are registered (vehicle/property/product/estimate/task)");
    for (const m of FIVE) {
      const rt = byKey[m.key];
      check(!!rt && rt.label === m.label && rt.labelPlural === m.plural && rt.system === false && rt.order === m.order, `${m.plural}: label/plural/order (${m.order}) correct, system:false`);
    }

    // (2) SEEDED DEFAULT FIELDS (spot-check key fields incl. address + line_items).
    console.log("\n(2) seeded default fields per module:");
    for (const m of FIVE) {
      const keys = new Set((await listFields(tId, m.key)).map((f: any) => f.key));
      check(m.sample.every((k) => keys.has(k)), `${m.plural} seeded its fields (${m.sample.join(", ")})`);
    }
    const propAddr = (await listFields(tId, "property")).find((f: any) => f.key === "property_address");
    check(!!propAddr && propAddr.type === "address", "Properties has an ADDRESS field (property_address)");
    const estLine = (await listFields(tId, "estimate")).find((f: any) => f.key === "line_items");
    check(!!estLine && estLine.type === "line_items", "Estimates has a LINE_ITEMS table (line_items)");

    // (3) PICKER: the five are togglable + default-hidden; existing keep their default.
    console.log("\n(3) create-tenant picker defaults (five OFF, others ON):");
    const opts = systemRecordTypeOptions();
    const optByKey: any = {}; opts.forEach((o: any) => (optByKey[o.key] = o));
    check(FIVE.every((m) => optByKey[m.key] && optByKey[m.key].togglable === true && optByKey[m.key].defaultHidden === true), "the five are togglable AND defaultHidden (start unchecked)");
    check(["job", "booking", "equipment", "invoice"].every((k) => optByKey[k] && optByKey[k].togglable === true && !optByKey[k].defaultHidden), "job/booking/equipment/invoice remain togglable + default-ON");
    check(optByKey["contact"] && optByKey["contact"].togglable === false, "contact stays core (not togglable)");

    // (4) Estimates' total auto-computes from line items (reuses the invoice mechanism).
    console.log("\n(4) Estimates total computes from line items:");
    const est: any = await createRecord(tId, "estimate", { title: "Quote A", customFields: { line_items: [{ description: "Labor", quantity: 2, unitPrice: 40 }, { description: "Part", quantity: 1, unitPrice: 450 }], total: 0 } });
    check((await getRecord(tId, est.id) as any).customFields.total === 530, "an Estimate's total is derived from its line items (530)");

    // (5) A new module behaves like a normal record type (create + read a Vehicle).
    console.log("\n(5) normal-module behavior:");
    const veh: any = await createRecord(tId, "vehicle", { title: "2020 Camry", customFields: { make: "Toyota", model: "Camry", year: 2020, vehicle_type: "Car" } });
    const vr: any = await getRecord(tId, veh.id);
    check(vr && vr.customFields.make === "Toyota" && vr.customFields.vehicle_type === "Car", "a Vehicle record creates + reads back like any module record");
  } catch (e) {
    failures.push("unexpected error: " + (e as Error).message);
    console.log("  \u2717 threw:", (e as Error).message);
  } finally {
    if (tId) { console.log("\nCleaning up the temporary tenant…"); await db.tenant.delete({ where: { id: tId } }).catch(() => {}); }
  }

  const after = { tenants: await db.tenant.count() };
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);
  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705  (five pre-built modules registered, seeded, default-off; estimate total computes)" : failures.length + " FAILED \u274c: " + failures.join("; ")}`);
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}
main();
