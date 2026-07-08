// DB-backed self-test for the record-type registry refactor.
//
//   npx tsx src/db/selfTest_recordTypeRegistry.ts        (needs dev Postgres)
//
// Proves (a) NOTHING changed for the existing system types, and (b) the registry
// is now a genuine doorway: adding one entry flows through listRecordTypes,
// resolveRecordTypeId AND surveyService's allow-list with NO edits to those files.
import { prisma, disconnectDb } from "./client";
import {
  listRecordTypes, resolveRecordTypeId, systemRecordTypeKeys, SYSTEM_RECORD_TYPES,
  CONTACT_RECORD_TYPE_KEY, JOB_RECORD_TYPE_KEY, BOOKING_RECORD_TYPE_KEY,
} from "../services/recordTypeService";
import { allowedMapRecordTypeKeys } from "../services/surveyService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const tenantIds: string[] = [];
async function mkTenant(tag: string) {
  const t = await prisma.tenant.create({ data: { name: `rt-${tag}-${stamp}`, notifyEmail: `rt-${tag}-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}

async function main() {
  console.log("Record-type registry — unchanged + additive\n============================================");

  // (1) Fresh tenant lists exactly the three system types, expected keys/labels/order.
  const A = await mkTenant("A");
  const types = await listRecordTypes(A);
  check(types.length === 3, "fresh tenant has exactly 3 system record types");
  const want = [
    { key: "contact", label: "Contact", labelPlural: "Contacts", order: 0 },
    { key: "job", label: "Job", labelPlural: "Jobs", order: 1 },
    { key: "booking", label: "Booking", labelPlural: "Bookings", order: 2 },
  ];
  want.forEach((w, i) => {
    const t = types[i];
    check(!!t && t.key === w.key && t.label === w.label && t.labelPlural === w.labelPlural && t.order === w.order,
      `type[${i}] is ${w.key} (${w.label}/${w.labelPlural}, order ${w.order})`);
  });
  // job/booking seeded shapes unchanged (spot-check stages/subtypes exist as before)
  const job = types.find((t: any) => t.key === "job")!;
  check(Array.isArray(job.stages) && job.stages.length === 6 && Array.isArray(job.subtypes) && job.subtypes.length === 3, "job keeps its 6 stages + 3 subtypes");
  const booking = types.find((t: any) => t.key === "booking")!;
  check(Array.isArray(booking.recordStages) && booking.recordStages.length === 5, "booking keeps its 5 record statuses");

  // (2) resolveRecordTypeId — keys, an arbitrary id, and unknown → contact default.
  const idByKey: Record<string, string> = {};
  for (const k of [CONTACT_RECORD_TYPE_KEY, JOB_RECORD_TYPE_KEY, BOOKING_RECORD_TYPE_KEY]) {
    idByKey[k] = await resolveRecordTypeId(A, k);
    check(idByKey[k] === types.find((t: any) => t.key === k)!.id, `resolveRecordTypeId("${k}") → its row id`);
  }
  check((await resolveRecordTypeId(A, idByKey["job"])) === idByKey["job"], "resolveRecordTypeId(<an id>) → that id");
  check((await resolveRecordTypeId(A, "totally-unknown")) === idByKey["contact"], "resolveRecordTypeId(unknown) → contact default");
  check((await resolveRecordTypeId(A, null)) === idByKey["contact"], "resolveRecordTypeId(null) → contact default");

  // (3) ADDITIVE doorway: register a mock system type in the registry only.
  check(systemRecordTypeKeys().join(",") === "contact,job,booking", "registry keys are exactly the three before adding");
  check(!allowedMapRecordTypeKeys().includes("equipment_mock"), "survey allow-list excludes the mock before adding");
  const MOCK = { key: "equipment_mock", defaults: { key: "equipment_mock", label: "Equipment", labelPlural: "Equipment", system: false, stages: [], recordStages: [], order: 99 } };
  SYSTEM_RECORD_TYPES.push(MOCK);
  try {
    check(systemRecordTypeKeys().includes("equipment_mock"), "registry now includes the mock");
    check(allowedMapRecordTypeKeys().includes("equipment_mock"), "surveyService allow-list now includes the mock — WITHOUT editing surveyService");
    const B = await mkTenant("B");
    const typesB = await listRecordTypes(B);
    check(typesB.some((t: any) => t.key === "equipment_mock"), "listRecordTypes includes the mock — WITHOUT editing listRecordTypes");
    const mockId = typesB.find((t: any) => t.key === "equipment_mock")!.id;
    check((await resolveRecordTypeId(B, "equipment_mock")) === mockId, "resolveRecordTypeId resolves the mock — WITHOUT editing resolveRecordTypeId");
  } finally {
    const i = SYSTEM_RECORD_TYPES.indexOf(MOCK);
    if (i >= 0) SYSTEM_RECORD_TYPES.splice(i, 1);
  }
  check(systemRecordTypeKeys().join(",") === "contact,job,booking", "registry restored to the three after the test");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (registry unchanged for contact/job/booking + additive)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
