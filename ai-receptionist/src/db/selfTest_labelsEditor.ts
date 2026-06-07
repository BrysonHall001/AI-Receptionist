// Self-test for the Labels editor's SAVE PATH (the services the PATCH /api/labels
// endpoint calls). Proves saves are portal-scoped, validated, key-safe, and
// tenant-isolated.
//
//   npx tsx src/db/selfTest_labelsEditor.ts
//
// SAFETY: two clearly-named TEMPORARY tenants, deleted at the end (cascade).
// Captures real counts before/after. Calls the real services directly.
//
// PROVES: (a) saving a record-type label updates that type's label/labelPlural
// for ONLY that portal; (b) saving a generic word updates Tenant.labels for ONLY
// that portal; (c) blank values are rejected; (d) the stable key is untouched;
// (e) another portal's labels are unaffected (tenant isolation).
// DOES NOT prove: the editor UI rendering / that the right rows show — that's the
// click test. It tests the data layer the editor saves through.

import { prisma, disconnectDb } from "./client";
import { listRecordTypes, setRecordTypeLabels } from "../services/recordTypeService";
import { getPortal, setTenantLabels } from "../services/portalService";

const db = prisma as any;
const A_NAME = "__SELFTEST_LABELS_A__";
const B_NAME = "__SELFTEST_LABELS_B__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
async function throws(fn: () => Promise<any>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

async function main() {
  console.log("Labels editor — save-path self-test");
  console.log("===================================\n");

  const before = {
    recordTypes: await db.recordType.count(),
    tenants: await db.tenant.count(),
    autos: await db.automation.count(),
  };
  console.log(`Real rows before — recordTypes:${before.recordTypes} tenants:${before.tenants} automations:${before.autos}\n`);

  let aId = "", bId = "";
  try {
    const tA = await db.tenant.create({ data: { name: A_NAME, notifyEmail: "selftest@example.invalid" } });
    aId = tA.id;
    const tB = await db.tenant.create({ data: { name: B_NAME, notifyEmail: "selftest@example.invalid" } });
    bId = tB.id;
    // Ensure both portals have their built-in contact + job types.
    await listRecordTypes(aId);
    await listRecordTypes(bId);

    // (a) record-type label save (portal A only)
    console.log("(a) saving a record-type label updates that type for only that portal:");
    await setRecordTypeLabels(aId, "contact", "Client", "Clients");
    const aContact = await db.recordType.findFirst({ where: { tenantId: aId, key: "contact" } });
    check(!!aContact && aContact.label === "Client" && aContact.labelPlural === "Clients", "portal A contact type now Client/Clients");
    const aJob = await db.recordType.findFirst({ where: { tenantId: aId, key: "job" } });
    check(!!aJob && aJob.label === "Job", "portal A job type left unchanged");

    // (d) stable key untouched
    console.log("(d) the stable key is untouched:");
    check(!!aContact && aContact.key === "contact", "contact type key is still \"contact\"");

    // (b) generic word save -> Tenant.labels (portal A only)
    console.log("(b) saving a generic word updates Tenant.labels for only that portal:");
    await setTenantLabels(aId, { record: { one: "Item", many: "Items" } });
    const aPortal: any = await getPortal(aId);
    check(!!aPortal && aPortal.labels && aPortal.labels.record && aPortal.labels.record.one === "Item" && aPortal.labels.record.many === "Items", "portal A Tenant.labels.record = Item/Items");

    // (c) blank values rejected
    console.log("(c) blank values are rejected:");
    check(await throws(() => setRecordTypeLabels(aId, "contact", "", "Clients")), "blank singular on a record type is rejected");
    check(await throws(() => setRecordTypeLabels(aId, "contact", "Client", "  ")), "blank/whitespace plural on a record type is rejected");
    check(await throws(() => setTenantLabels(aId, { stage: { one: "Phase", many: "" } })), "blank plural on a generic word is rejected");
    // and a rejected save must not have changed anything
    const aContact2 = await db.recordType.findFirst({ where: { tenantId: aId, key: "contact" } });
    check(!!aContact2 && aContact2.label === "Client" && aContact2.labelPlural === "Clients", "a rejected blank save left the previous value intact");

    // (e) tenant isolation
    console.log("(e) tenant isolation — portal B is unaffected:");
    const bContact = await db.recordType.findFirst({ where: { tenantId: bId, key: "contact" } });
    check(!!bContact && bContact.label === "Contact" && bContact.labelPlural === "Contacts", "portal B contact type still default Contact/Contacts");
    const bPortal: any = await getPortal(bId);
    check(!!bPortal && (!bPortal.labels || !bPortal.labels.record), "portal B Tenant.labels has no record override");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up temporary tenants…");
    for (const id of [aId, bId]) if (id) { try { await db.tenant.delete({ where: { id } }); } catch (e) { console.error("cleanup failed", id, e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: { in: [A_NAME, B_NAME] } } }); } catch {}
  }

  console.log("\nVerifying real data untouched:");
  const after = {
    recordTypes: await db.recordType.count(),
    tenants: await db.tenant.count(),
    autos: await db.automation.count(),
  };
  check(after.recordTypes === before.recordTypes, `recordTypes unchanged (${before.recordTypes} -> ${after.recordTypes})`);
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);
  check(after.autos === before.autos, `automations unchanged (${before.autos} -> ${after.autos})`);

  console.log("\n===================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
