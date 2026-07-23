// DB-backed self-test for the Equipment record-type batch.
//
//   npx tsx src/db/selfTest_equipment.ts        (needs dev Postgres)
//
// Proves:
//  (a) a fresh tenant's record types now include "equipment" (label/order) with the
//      three prior types (contact/job/booking) completely unchanged;
//  (b) equipment's default fields are seeded once and returned by the fields API for
//      recordType "equipment", idempotently;
//  (c) an equipment Record links to a Contact via createLink(parentType "contact"),
//      shows up in that contact's links (with title + customFields for the panel),
//      and unlinks cleanly.
import { prisma, disconnectDb } from "./client";
import { listRecordTypes, resolveRecordTypeId } from "../services/recordTypeService";
import { listFields } from "../services/fieldService";
import { createRecord } from "../services/recordService";
import { createLink, listLinksForContact, softDeleteLink } from "../services/recordLinkService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const tenantIds: string[] = [];
async function mkTenant(tag: string) {
  const t = await prisma.tenant.create({ data: { name: `eq-${tag}-${stamp}`, notifyEmail: `eq-${tag}-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}

async function main() {
  console.log("Equipment record type — seed + fields + contact link");
  console.log("====================================================");

  // (a) Fresh tenant: equipment present with right label/order; three priors unchanged.
  const A = await mkTenant("A");
  const types = await listRecordTypes(A);
  const byKey: Record<string, any> = {};
  types.forEach((t: any) => (byKey[t.key] = t));
  check(!!byKey.equipment, 'listRecordTypes includes "equipment"');
  check(!!byKey.equipment && byKey.equipment.label === "Equipment" && byKey.equipment.labelPlural === "Equipment",
    'equipment label + labelPlural are both "Equipment" (uncountable — same word)');
  check(!!byKey.equipment && byKey.equipment.order === 3, "equipment order is 3 (right after booking)");
  check(!!byKey.contact && byKey.contact.order === 0 && byKey.contact.label === "Contact"
    && !!byKey.job && byKey.job.order === 1 && byKey.job.label === "Job Opening" // relabeled (Work Orders batch), label-only
    && !!byKey.booking && byKey.booking.order === 2 && byKey.booking.label === "Booking",
    "contact/job/booking are unchanged (orders 0/1/2, same labels)");
  check(Array.isArray(byKey.equipment.stages) && byKey.equipment.stages.length === 0
    && Array.isArray(byKey.equipment.recordStages) && byKey.equipment.recordStages.length === 0,
    "equipment has no pipeline (empty stages + recordStages)");

  // (b) Default fields seeded + returned by the fields API for recordType "equipment".
  const fields = await listFields(A, "equipment");
  const keys = fields.map((f: any) => f.key);
  const wantKeys = ["equipment_type", "brand", "model", "serial", "install_date", "last_service_date", "next_service_due", "warranty_expires", "status", "notes"];
  check(wantKeys.every((k) => keys.includes(k)), "equipment default fields include every expected key");
  check(keys.length === wantKeys.length, `equipment has exactly ${wantKeys.length} default fields (got ${keys.length})`);
  const statusF = fields.find((f: any) => f.key === "status");
  check(!!statusF && statusF.type === "single_select" && Array.isArray(statusF.options) && statusF.options.length === 3,
    "status is a single_select with 3 options (Active / Needs service / Retired)");
  const typeF = fields.find((f: any) => f.key === "equipment_type");
  check(!!typeF && typeF.label === "Type" && typeF.type === "single_select", 'equipment_type is a single_select labelled "Type"');
  check(fields.every((f: any) => f.system === false), "all equipment default fields are editable/removable (system:false)");
  // Idempotent: listing again (which re-ensures) must NOT duplicate the defaults.
  const again = await listFields(A, "equipment");
  check(again.length === fields.length, "re-listing fields does not duplicate the defaults (idempotent seed)");

  // (c) Create an equipment record + link it to a contact; list includes it; unlink.
  const eqId = await resolveRecordTypeId(A, "equipment");
  check(!!eqId, 'resolveRecordTypeId("equipment") resolves to a row id');
  const contact = await prisma.contact.create({ data: { tenantId: A, name: "Homeowner", phone: "+15555550100" } });
  const rec: any = await createRecord(A, "equipment", { title: "Upstairs AC", customFields: { equipment_type: "Air conditioner", status: "Active", next_service_due: "2026-10-01" } });
  check(!!rec && !!rec.id, 'createRecord(type "equipment") returns a record');
  // ---- THE LINE THAT PROVES EQUIPMENT LINKS TO A CONTACT ----
  const link: any = await createLink(A, { recordId: rec.id, parentType: "contact", parentId: contact.id, stageKey: null });
  check(!!link && !!link.id, 'createLink(parentType "contact") links the unit to the contact');
  const links = await listLinksForContact(A, contact.id, "equipment");
  check(links.length === 1 && !!links[0].record && links[0].record.id === rec.id, "the contact's equipment links include the new unit");
  check(!!links[0].record && links[0].record.title === "Upstairs AC"
    && !!links[0].record.customFields && links[0].record.customFields.status === "Active",
    "linked record exposes title + customFields (so the contact panel can show name/type/status)");
  await softDeleteLink(A, link.id);
  const after = await listLinksForContact(A, contact.id, "equipment");
  check(after.length === 0, "unlink (softDeleteLink) removes it from the contact's equipment");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (equipment seeded + fields + links to a contact)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
