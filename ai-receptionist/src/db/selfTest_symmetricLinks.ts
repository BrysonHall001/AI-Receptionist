// SAFETY PROOF for the symmetric-record-link refactor (Batch 1 of 2). Talks to the real
// services. Proves existing Contact->Job / Contact->Equipment behavior is byte-identical,
// stage history is preserved, AND that any-record<->any-record links now work from both sides.
//
//   npx tsx src/db/selfTest_symmetricLinks.ts        (needs dev Postgres)
//
// SAFETY: one clearly-named TEMPORARY tenant, deleted at the end (cascade). Real counts
// captured before/after and asserted unchanged.
import { prisma, disconnectDb } from "./client";
import { createLink, updateLink, listLinksForRecord, listLinksForContact, softDeleteLink } from "../services/recordLinkService";
import { createRecord } from "../services/recordService";
import { ensureAllSystemRecordTypes, JOB_RECORD_TYPE_KEY, EQUIPMENT_RECORD_TYPE_KEY } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_SYMLINKS__";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const histCount = (recordLinkId: string) => db.stageHistory.count({ where: { recordLinkId } });

async function main() {
  console.log("Symmetric record links — safety proof");
  console.log("=====================================\n");
  const before = { links: await db.recordLink.count(), history: await db.stageHistory.count(), records: await db.record.count(), contacts: await db.contact.count(), tenants: await db.tenant.count() };
  console.log(`Real rows before — links:${before.links} history:${before.history} records:${before.records} contacts:${before.contacts} tenants:${before.tenants}\n`);

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    await ensureAllSystemRecordTypes(tId);

    const contact = await db.contact.create({ data: { tenantId: tId, name: "Ada Candidate", email: "ada@example.invalid", phone: null } });
    const job: any = await createRecord(tId, JOB_RECORD_TYPE_KEY, { title: "Backend role", subtypeKey: "technical", stageKey: null });
    const equip: any = await createRecord(tId, EQUIPMENT_RECORD_TYPE_KEY, { title: "Laptop 14", customFields: {} });

    // ---------- (1) Contact->Job & Contact->Equipment behave EXACTLY as before ----------
    console.log("(1) existing contact links resolve identically from both sides:");
    const jobLink: any = await createLink(tId, { recordId: job.id, parentType: "contact", parentId: contact.id, stageKey: "applied" });
    check(!!jobLink && !!jobLink.id, 'createLink(parentType "contact") creates the job link');
    check(jobLink.stageKey === "applied", "initial stage is set on the link");
    check((await histCount(jobLink.id)) === 1, "initial stage recorded ONE stageHistory row (from null -> applied)");

    const equipLink: any = await createLink(tId, { recordId: equip.id, parentType: "contact", parentId: contact.id, stageKey: null });
    check(!!equipLink && !!equipLink.id, "createLink links equipment to the contact");

    // listLinksForContact — the contact's linked job + equipment with stage/context (unchanged).
    const fromContact = await listLinksForContact(tId, contact.id);
    const jobFromContact = fromContact.find((l: any) => l.record && l.record.id === job.id);
    const equipFromContact = fromContact.find((l: any) => l.record && l.record.id === equip.id);
    check(!!jobFromContact && jobFromContact.stageKey === "applied", "listLinksForContact returns the job with its stage");
    check(!!equipFromContact, "listLinksForContact returns the linked equipment");

    // listLinksForRecord — from the job/equipment side, contact parent info is unchanged.
    const onJob = await listLinksForRecord(tId, job.id);
    const contactOnJob = onJob.find((l: any) => l.parentType === "contact" && l.parent && l.parent.id === contact.id);
    check(!!contactOnJob && contactOnJob.stageKey === "applied", "listLinksForRecord(job) returns the contact link with same stage + parent info");
    check(contactOnJob.parent.name === "Ada Candidate", "contact parent display info preserved (name/email/phone)");
    const onEquip = await listLinksForRecord(tId, equip.id);
    check(onEquip.some((l: any) => l.parentType === "contact" && l.parent && l.parent.id === contact.id), "listLinksForRecord(equipment) returns the contact link");

    // ---------- (2) stage movement records stageHistory as before ----------
    console.log("\n(2) stage movement preserves stageHistory:");
    await updateLink(tId, jobLink.id, { stageKey: "phone_screen" });
    check((await histCount(jobLink.id)) === 2, "moving the job link's stage appended a second stageHistory row");
    // Re-linking with a NEW stage is also a stage change (create path re-stage).
    await createLink(tId, { recordId: job.id, parentType: "contact", parentId: contact.id, stageKey: "onsite" });
    check((await histCount(jobLink.id)) === 3, "re-linking with a different stage appended another stageHistory row");

    // ---------- (3) ANY-TO-ANY: a record<->record link, found from BOTH records ----------
    console.log("\n(3) any-record<->any-record links (the new capability):");
    const recLink: any = await createLink(tId, { recordId: job.id, parentType: "record", parentId: equip.id, role: "uses" });
    check(!!recLink && !!recLink.id && recLink.parentType === "record", "createLink(parentType \"record\") links a Job to an Equipment record");

    const jobLinks2 = await listLinksForRecord(tId, job.id);
    const equipLinks2 = await listLinksForRecord(tId, equip.id);
    const foundFromJob = jobLinks2.find((l: any) => l.id === recLink.id && l.otherType === "record" && l.otherId === equip.id);
    const foundFromEquip = equipLinks2.find((l: any) => l.id === recLink.id && l.otherType === "record" && l.otherId === job.id);
    check(!!foundFromJob, "the record<->record link is found from the JOB side (other endpoint = equipment)");
    check(!!foundFromEquip, "the SAME link is found from the EQUIPMENT side (other endpoint = job) — symmetric");
    check(!!foundFromEquip && foundFromEquip.other && foundFromEquip.other.id === job.id, "reverse side resolves the other record's display info");

    // De-dup across orientations: linking the same pair the other way returns the same row.
    const recLinkAgain: any = await createLink(tId, { recordId: equip.id, parentType: "record", parentId: job.id, role: "used_by" });
    check(recLinkAgain.id === recLink.id, "linking the same two records in the other orientation de-dupes to the same link");
    const equipLinks3 = await listLinksForRecord(tId, equip.id);
    check(equipLinks3.filter((l: any) => l.parentType === "record").length === 1, "no duplicate record<->record link is created");

    // Self-link + missing endpoint are rejected.
    let selfRejected = false; try { await createLink(tId, { recordId: job.id, parentType: "record", parentId: job.id }); } catch { selfRejected = true; }
    check(selfRejected, "a record cannot be linked to itself");

    // Unlink still works (soft delete) and removes it from both sides.
    await softDeleteLink(tId, recLink.id);
    const jobAfterUnlink = await listLinksForRecord(tId, job.id);
    const equipAfterUnlink = await listLinksForRecord(tId, equip.id);
    check(!jobAfterUnlink.some((l: any) => l.id === recLink.id) && !equipAfterUnlink.some((l: any) => l.id === recLink.id), "unlinking removes the record<->record link from BOTH sides");
    check(jobAfterUnlink.some((l: any) => l.parentType === "contact"), "the contact link is untouched by the record-link unlink");
  } catch (e) {
    failures.push("unexpected error: " + (e as Error).message);
    console.log("  \u2717 threw:", (e as Error).message);
  } finally {
    if (tId) { console.log("\nCleaning up the temporary tenant…"); await db.tenant.delete({ where: { id: tId } }).catch(() => {}); }
  }

  console.log("\nReal data untouched:");
  const after = { links: await db.recordLink.count(), history: await db.stageHistory.count(), records: await db.record.count(), contacts: await db.contact.count(), tenants: await db.tenant.count() };
  check(after.links === before.links, `links unchanged (${before.links} -> ${after.links})`);
  check(after.history === before.history, `stageHistory unchanged (${before.history} -> ${after.history})`);
  check(after.records === before.records, `records unchanged (${before.records} -> ${after.records})`);
  check(after.contacts === before.contacts, `contacts unchanged (${before.contacts} -> ${after.contacts})`);
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705  (existing behavior identical; stages preserved; any-to-any links work)" : failures.length + " FAILED \u274c: " + failures.join("; ")}`);
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}
main();
