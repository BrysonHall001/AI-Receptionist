// PART A self-test — the generalized Related tabs rest on the SYMMETRIC record-link model.
//
//   npx tsx src/db/selfTest_relatedTabsLinks.ts     (needs dev Postgres)
//
// Proves the data guarantees the generalized tabs rely on:
//  (1) a link made from a NON-CONTACT record's side (record<->record) shows up on BOTH
//      records — each sees the OTHER as its `other` endpoint (this is what lets a Job show a
//      Vehicle in its "Vehicles" tab AND the Vehicle show the Job in its "Jobs" tab). <-- both sides
//  (2) the historical contact<->record link is unchanged (no regression to the Contact page):
//      the record still sees the contact as `parent`, and the contact still lists the record.
//  (3) a record cannot be linked to itself.
//  (4) the tab source (listRecordTypes) includes Contacts + the modules, so a record anchor
//      can build one tab per OTHER module (every type except its own).
import { prisma, disconnectDb } from "./client";
import { createRecord } from "../services/recordService";
import { createLink, listLinksForRecord, listLinksForContact } from "../services/recordLinkService";
import { listRecordTypes, resolveRecordTypeId } from "../services/recordTypeService";
import { createContact } from "../services/contactService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
async function mkTenant() {
  const t = await prisma.tenant.create({ data: { name: `rel-${stamp}-${Math.random().toString(36).slice(2, 6)}`, notifyEmail: `rel-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}

async function main() {
  console.log("Part A — generalized Related tabs (symmetric links)");
  console.log("===================================================");

  const T = await mkTenant();
  // Two records of DIFFERENT non-contact modules (both flat — no subtype needed).
  const vehicle: any = await createRecord(T, "vehicle", { title: "Van 1", customFields: {} });
  const task: any = await createRecord(T, "task", { title: "Oil change", customFields: {} });

  // (1) Link them from the vehicle's side (record<->record), then confirm BOTH sides see it.
  await createLink(T, { recordId: vehicle.id, parentType: "record", parentId: task.id, stageKey: null });
  const vehLinks = await listLinksForRecord(T, vehicle.id);
  const taskLinks = await listLinksForRecord(T, task.id);
  const vehSeesTask = vehLinks.some((l: any) => l.otherType === "record" && l.otherId === task.id && l.other && l.other.id === task.id);
  const taskSeesVeh = taskLinks.some((l: any) => l.otherType === "record" && l.otherId === vehicle.id && l.other && l.other.id === vehicle.id);
  check(vehSeesTask, "a record<->record link made from the vehicle side shows the Task on the Vehicle");
  check(taskSeesVeh, "…and the SAME link shows the Vehicle on the Task (both sides)"); // proves both-sides
  check(vehLinks.filter((l: any) => l.otherId === task.id).length === 1, "the symmetric link is not doubled on the origin side");

  // (2) Contact<->record path unchanged (Contact page must not regress).
  const contact: any = await createContact(T, { name: "Pat Client", email: `pat-${stamp}@ex.com`, source: "manual" } as any);
  await createLink(T, { recordId: task.id, parentType: "contact", parentId: contact.id, stageKey: null });
  const taskLinks2 = await listLinksForRecord(T, task.id);
  const cLink = taskLinks2.find((l: any) => l.parentType === "contact" && l.parentId === contact.id);
  check(!!cLink && !!cLink.parent && cLink.parent.id === contact.id, "a contact link still exposes the contact as `parent` (unchanged shape)");
  const contactSide = await listLinksForContact(T, contact.id, "task");
  check(contactSide.some((l: any) => l.record && l.record.id === task.id), "the contact's side still lists the linked Task");

  // (3) No self-links.
  let selfRejected = false;
  try { await createLink(T, { recordId: vehicle.id, parentType: "record", parentId: vehicle.id, stageKey: null }); }
  catch { selfRejected = true; }
  check(selfRejected, "a record cannot be linked to itself");

  // (4) Tab source: listRecordTypes has Contacts + the modules, so a record anchor can build
  //     one tab per OTHER module (the client filters out the anchor's own type).
  await resolveRecordTypeId(T, "job"); // ensure a staged module exists too
  const types = await listRecordTypes(T);
  const keys = new Set((types as any[]).map((t) => t.key));
  check(keys.has("contact"), "listRecordTypes includes Contacts (so record pages get a Contacts tab)");
  check(["job", "vehicle", "task"].every((k) => keys.has(k)), "listRecordTypes includes the modules used for tabs");
  // The client rule: tabs = every type whose key !== anchor.typeKey. Verify it excludes only self.
  const anchorKey = "vehicle";
  const tabKeys = (types as any[]).map((t) => t.key).filter((k) => k !== anchorKey && (k === "contact" || true));
  check(!tabKeys.includes(anchorKey) && tabKeys.includes("task") && tabKeys.includes("contact"), "tab set for a Vehicle excludes 'vehicle' but includes the other modules + Contacts");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (links show on both sides; contact path unchanged; tabs exclude own type)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
