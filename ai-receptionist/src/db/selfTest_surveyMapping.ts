// Batch self-test — Surveys granular mapping + duplicate + write behavior.
//   npx tsx src/db/selfTest_surveyMapping.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { createField } from "../services/fieldService";
import { upsertSurvey, getSurvey, listSurveys, duplicateSurvey } from "../services/surveyService";
import { createRecipient, submitSurvey } from "../services/surveyResponseService";

const db = prisma as any;
const T_NAME = "__SELFTEST_SURVEY_MAPPING__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Surveys — granular mapping + duplicate + writes");
  console.log("===============================================");

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const u1 = await db.user.create({ data: { tenantId, email: `map_${Date.now()}@example.invalid`, name: "Owner", role: "OWNER", passwordHash: "x" } });
    const contact = await db.contact.create({ data: { tenantId, name: "Pat", email: "pat@example.invalid", phone: "+1", source: "web" } });

    const cField = await createField(tenantId, { label: "Fav color", type: "text" }, "contact");
    const jField = await createField(tenantId, { label: "Job note", type: "text" }, "job"); // auto-creates the job record type

    // ---------- (1) mapping shape {recordType, fieldKey} + per-type compatibility ----------
    console.log("(1) mapping shape + compatibility:");
    const built = await upsertSurvey({
      tenantId, createdById: u1.id, name: "Feedback", status: "active", mapTargetType: "contact",
      questions: [
        { type: "short_text", label: "Color?", mapFieldKey: cField.key, mapRecordType: "contact" },
        { type: "short_text", label: "Job note?", mapFieldKey: jField.key, mapRecordType: "job" },
        { type: "short_text", label: "Anything else?" },
        { type: "short_text", label: "Default rt", mapFieldKey: cField.key }, // omit recordType -> defaults contact
      ],
    });
    const survey = await getSurvey(tenantId, built.id);
    const q = (label: string) => survey!.questions.find((x: any) => x.label === label);
    check(q("Color?").mapRecordType === "contact" && q("Color?").mapFieldKey === cField.key, "contact mapping stores {contact, fieldKey}");
    check(q("Job note?").mapRecordType === "job" && q("Job note?").mapFieldKey === jField.key, "job mapping stores {job, fieldKey}");
    check(q("Default rt").mapRecordType === "contact", "a mapping with no recordType defaults to contact (migration shape)");
    check(q("Anything else?").mapFieldKey === null && q("Anything else?").mapRecordType === null, "unmapped stays null");

    let threw = false;
    try { await upsertSurvey({ tenantId, name: "Bad", status: "draft", questions: [{ type: "date", label: "D", mapFieldKey: jField.key, mapRecordType: "job" }] }); }
    catch { threw = true; }
    check(threw, "type-incompatible mapping (date → text field) is rejected per record type");

    // ---------- (2) write behavior: contact writes, job is inert ----------
    console.log("\n(2) write behavior:");
    const recordsBefore = await db.record.count({ where: { tenantId } });
    const rec = await createRecipient(tenantId, built.id, contact.id);
    const ans: any = {};
    ans[q("Color?").id] = "blue";
    ans[q("Job note?").id] = "fix the sink";
    ans[q("Anything else?").id] = "thanks";
    const sub = await submitSurvey({ token: rec!.token, answers: ans });
    check(sub.ok === true, "submission accepted");
    const c2 = await db.contact.findUnique({ where: { id: contact.id } });
    check((c2.customFields || {})[cField.key] === "blue", "CONTACT-mapped answer written to the contact");
    check(!((c2.customFields || {})[jField.key]), "JOB-mapped answer NOT written onto the contact");
    const recordsAfter = await db.record.count({ where: { tenantId } });
    check(recordsAfter === recordsBefore, "no job/booking record was created or mutated by the submit");
    // every answer is still STORED regardless of mapping
    const respCount = await db.surveyAnswer.count({ where: { response: { surveyId: built.id } } });
    check(respCount === 3, "all 3 answers stored on the response (nothing lost)");

    // ---------- (3) anonymous response writes nothing ----------
    console.log("\n(3) anonymous:");
    const head = await db.survey.findUnique({ where: { id: built.id } });
    const anonAns: any = {}; anonAns[q("Color?").id] = "red";
    const anon = await submitSurvey({ publicId: head.publicId, answers: anonAns });
    check(anon.ok === true && anon.wroteToContact === false, "anonymous response stored, wrote to no contact");
    const c3 = await db.contact.findUnique({ where: { id: contact.id } });
    check((c3.customFields || {})[cField.key] === "blue", "the contact's field is unchanged by the anonymous response");

    // ---------- (4) duplicate creates a new row, original intact ----------
    console.log("\n(4) duplicate:");
    const dup = await duplicateSurvey(tenantId, built.id, u1.id);
    check(!!dup && dup!.id !== built.id, "duplicate creates a NEW row (distinct id)");
    const orig = await getSurvey(tenantId, built.id);
    const copy = await getSurvey(tenantId, dup!.id);
    check(!!orig, "original survey still exists");
    check(!!copy && copy!.name === "Copy of Feedback" && copy!.status === "draft", "copy is a draft named 'Copy of …'");
    check(!!copy && copy!.questions.length === orig!.questions.length, "questions copied");
    check(!!copy && copy!.questions.find((x: any) => x.label === "Job note?")?.mapRecordType === "job", "mappings copied (job mapping preserved)");

    // ---------- (5) library lists all ----------
    console.log("\n(5) library:");
    const all = await listSurveys(tenantId);
    check(all.length === 2, "library lists ALL surveys (original + duplicate)");

    // ---------- (6) static guards ----------
    console.log("\n(6) client wiring (static):");
    const comm = readFileSync(resolve(__dirname, "../../public/js/communication.js"), "utf8");
    check(/Surveys Library/.test(comm), "list panel renamed 'Surveys Library'");
    check(/sv-dup/.test(comm), "library rows have a Duplicate action");
    check(/mapRecordType/.test(comm) && /coming soon/.test(comm), "granular mapping + job/booking 'coming soon' note present");
    const html = readFileSync(resolve(__dirname, "../../public/survey.html"), "utf8");
    check(/--accent:#5b59d6/.test(html), "public survey submit button uses brand purple");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try { await db.tenant.delete({ where: { id: tId } }); }
      catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n===============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (survey mapping)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
