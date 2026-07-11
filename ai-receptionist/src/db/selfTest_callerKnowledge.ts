// DB-backed self-test for System knowledge — the caller-record-awareness feature.
//
//   npx tsx src/db/selfTest_callerKnowledge.ts        (needs dev Postgres)
//
// Proves:
//  (1) with a module CHECKED and a KNOWN caller who has linked records of it,
//      the caller-knowledge summary names those records (readable labels, no ids),
//      and buildSystemPrompt injects it; with NO module checked, or an UNKNOWN
//      caller, nothing is produced/injected;
//  (2) the module list is registry-derived and the feature is GENERIC over any
//      module (a mock record type works end-to-end);
//  (3) aiKnowledgeModules persists and round-trips via the portal settings.
import { prisma, disconnectDb } from "./client";
import { buildCallerRecordKnowledge, buildCallerCallHistory } from "../ai/callerKnowledge";
import { buildSystemPrompt } from "../ai/prompt";
import { resolveRecordTypeId, listRecordTypes, SYSTEM_RECORD_TYPES } from "../services/recordTypeService";
import { createRecord } from "../services/recordService";
import { createLink } from "../services/recordLinkService";
import { updatePortal, getPortal } from "../services/portalService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
async function mkTenant() {
  const t = await prisma.tenant.create({ data: { name: `ck-${stamp}`, notifyEmail: `ck-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}

async function main() {
  console.log("System knowledge - caller record awareness");
  console.log("==========================================");

  const T = await mkTenant();
  await resolveRecordTypeId(T, "equipment"); // seed equipment + its default fields
  const phone = "+15555550123";
  const contact = await prisma.contact.create({ data: { tenantId: T, name: "Pat Caller", phone, source: "manual" } as any });
  const rec: any = await createRecord(T, "equipment", { title: "Upstairs AC", customFields: { equipment_type: "Air conditioner", status: "Active", install_date: "2018-05-01" } });
  await createLink(T, { recordId: rec.id, parentType: "contact", parentId: contact.id, stageKey: null });

  // (1) checked + known caller -> summary names the record
  const knChecked = await buildCallerRecordKnowledge(T, phone, ["equipment"]);
  check(knChecked.includes("Upstairs AC") && /Equipment/i.test(knChecked), "checked module + known caller -> summary names the caller's record");
  check(knChecked.includes("Air conditioner") && knChecked.includes("Active"), "summary includes readable field values by label");
  check(!knChecked.includes(rec.id), "summary never exposes internal record ids");

  const knNone = await buildCallerRecordKnowledge(T, phone, []);
  check(knNone === "", "no modules checked -> no caller knowledge");
  const knUnknown = await buildCallerRecordKnowledge(T, "+15550009999", ["equipment"]);
  check(knUnknown === "", "unknown caller -> no caller knowledge");

  // prompt rendering: block present only when knowledge is non-empty
  const base: any = { currentState: "GREETING", alreadyExtracted: {} };
  const withK = buildSystemPrompt({ ...base, callerRecordKnowledge: knChecked });
  const withoutK = buildSystemPrompt({ ...base, callerRecordKnowledge: "" });
  check(withK.includes("WHAT YOU ALREADY KNOW ABOUT THIS CALLER") && withK.includes("Upstairs AC"),
    "buildSystemPrompt injects the caller-knowledge block ONLY when a checked module produced it"); // <-- proves injected only when checked
  check(!withoutK.includes("WHAT YOU ALREADY KNOW ABOUT THIS CALLER"), "buildSystemPrompt omits the block when there's no knowledge");

  // (2) registry-derived + generic over ANY module
  const MOCK: any = { key: "vehicle_mock", defaults: { key: "vehicle_mock", label: "Vehicle", labelPlural: "Vehicles", system: false, stages: [], recordStages: [], subtypes: [], order: 98 } };
  SYSTEM_RECORD_TYPES.push(MOCK);
  try {
    const types = await listRecordTypes(T);
    check(types.some((t: any) => t.key === "vehicle_mock"), "a new registry module appears in listRecordTypes (checklist is registry-derived)");
    const vrec: any = await createRecord(T, "vehicle_mock", { title: "Red Truck", customFields: {} });
    await createLink(T, { recordId: vrec.id, parentType: "contact", parentId: contact.id, stageKey: null });
    const knMock = await buildCallerRecordKnowledge(T, phone, ["vehicle_mock"]);
    check(knMock.includes("Red Truck") && /Vehicles/i.test(knMock), "caller knowledge is GENERIC over any module (works for a brand-new type)");
  } finally {
    const i = SYSTEM_RECORD_TYPES.indexOf(MOCK); if (i >= 0) SYSTEM_RECORD_TYPES.splice(i, 1);
  }

  // (3) persistence round-trip
  await updatePortal(T, { aiKnowledgeModules: ["equipment"] } as any);
  const p: any = await getPortal(T);
  check(Array.isArray(p.aiKnowledgeModules) && p.aiKnowledgeModules.join(",") === "equipment", "aiKnowledgeModules persists and round-trips via portal settings");

  // (4) Pages / Calls history: a KNOWN caller's PRIOR finished calls
  await prisma.callSession.create({ data: { callSid: `sid-prior-${stamp}`, tenantId: T, contactId: contact.id, fromNumber: phone, status: "COMPLETED", extracted: { intent: "Broken furnace" }, finalizedAt: new Date() } as any });
  const callsChecked = await buildCallerCallHistory(T, phone, ["calls"]);
  check(callsChecked.includes("Broken furnace") && /prior calls/i.test(callsChecked), "Calls page checked + known caller -> summary names the prior call");
  const callsNone = await buildCallerCallHistory(T, phone, []);
  check(callsNone === "", "Calls page unchecked -> no call history");
  const callsUnknown = await buildCallerCallHistory(T, "+15550009999", ["calls"]);
  check(callsUnknown === "", "unknown caller -> no call history");
  const withCH = buildSystemPrompt({ ...base, callerCallHistory: callsChecked });
  const withoutCH = buildSystemPrompt({ ...base, callerCallHistory: "" });
  check(withCH.includes("PRIOR CALLS") && withCH.includes("Broken furnace"), "buildSystemPrompt injects the prior-calls block ONLY when Calls is checked");
  check(!withoutCH.includes("PRIOR CALLS"), "buildSystemPrompt omits the prior-calls block when empty");
  await updatePortal(T, { aiKnowledgePages: ["calls"] } as any);
  const p2: any = await getPortal(T);
  check(Array.isArray(p2.aiKnowledgePages) && p2.aiKnowledgePages.join(",") === "calls", "aiKnowledgePages persists and round-trips via portal settings");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (caller knowledge: checked-only, generic, persisted)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
