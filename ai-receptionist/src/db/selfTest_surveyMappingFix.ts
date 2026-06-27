// Batch self-test — FIX: mapping cascade (per-record-type fields) + contact write +
// inert job/booking + New Survey reset discipline. Plus static guards for the client fix.
//
//   npx tsx src/db/selfTest_surveyMappingFix.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { createField, listFields } from "../services/fieldService";
import { isMappingCompatible } from "../services/surveyTypes";
import { upsertSurvey, getSurvey, listSurveys } from "../services/surveyService";
import { createRecipient, submitSurvey } from "../services/surveyResponseService";

const db = prisma as any;
const T_NAME = "__SELFTEST_SURVEY_MAPFIX__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Survey mapping fix — cascade, writes, New Survey reset");
  console.log("=====================================================");

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const u1 = await db.user.create({ data: { tenantId, email: `mf_${Date.now()}@example.invalid`, name: "Owner", role: "OWNER", passwordHash: "x" } });
    const contact = await db.contact.create({ data: { tenantId, name: "Sam", email: "sam@example.invalid", phone: "+1", source: "web" } });

    const cField = await createField(tenantId, { label: "Fav color", type: "text" }, "contact");
    const jField = await createField(tenantId, { label: "Job note", type: "text" }, "job");
    const bField = await createField(tenantId, { label: "Visit date", type: "date" }, "booking");

    // ---------- (1) per-record-type field cascade returns each type's OWN fields ----------
    console.log("(1) type → field cascade (per record type):");
    const cFields = await listFields(tenantId, "contact");
    const jFields = await listFields(tenantId, "job");
    const bFields = await listFields(tenantId, "booking");
    check(cFields.some((f: any) => f.key === cField.key) && !cFields.some((f: any) => f.key === jField.key), "contact fields list contains contact fields only");
    check(jFields.some((f: any) => f.key === jField.key) && !jFields.some((f: any) => f.key === cField.key), "job fields list contains job fields only");
    check(bFields.some((f: any) => f.key === bField.key), "booking fields list contains booking fields");

    // ---------- (2) compatibility filter per question type ----------
    console.log("\n(2) compatibility:");
    check(isMappingCompatible("short_text", "text") === true, "short_text ↔ text compatible");
    check(isMappingCompatible("date", "date") === true && isMappingCompatible("date", "text") === false, "date only maps to date fields");
    check(isMappingCompatible("yes_no", "checkbox") === true, "yes_no ↔ checkbox compatible");

    // ---------- (3) persistence: {recordType, fieldKey} round-trips ----------
    console.log("\n(3) persistence:");
    const built = await upsertSurvey({
      tenantId, createdById: u1.id, name: "MapFix", status: "active",
      questions: [
        { type: "short_text", label: "Color?", mapFieldKey: cField.key, mapRecordType: "contact" },
        { type: "short_text", label: "Note?", mapFieldKey: jField.key, mapRecordType: "job" },
      ],
    });
    const survey = await getSurvey(tenantId, built.id);
    const qC = survey!.questions.find((x: any) => x.label === "Color?");
    const qJ = survey!.questions.find((x: any) => x.label === "Note?");
    check(qC.mapRecordType === "contact" && qC.mapFieldKey === cField.key, "contact mapping reloads {contact, fieldKey}");
    check(qJ.mapRecordType === "job" && qJ.mapFieldKey === jField.key, "job mapping reloads {job, fieldKey} (prefill-ready)");

    // ---------- (4) contact-mapped answer WRITES end-to-end ----------
    console.log("\n(4) contact write works end-to-end:");
    const recordsBefore = await db.record.count({ where: { tenantId } });
    const rec = await createRecipient(tenantId, built.id, contact.id);
    const ans: any = {}; ans[qC.id] = "teal"; ans[qJ.id] = "call back";
    const sub = await submitSurvey({ token: rec!.token, answers: ans });
    check(sub.ok === true, "submission via per-recipient link accepted");
    const c2 = await db.contact.findUnique({ where: { id: contact.id } });
    check((c2.customFields || {})[cField.key] === "teal", "CONTACT-mapped answer wrote to the contact field");

    // ---------- (5) job-mapped answer is INERT ----------
    console.log("\n(5) job/booking inert:");
    check(!((c2.customFields || {})[jField.key]), "JOB-mapped answer not written onto the contact");
    const recordsAfter = await db.record.count({ where: { tenantId } });
    check(recordsAfter === recordsBefore, "no job/booking record created or mutated");
    const stored = await db.surveyAnswer.count({ where: { response: { surveyId: built.id } } });
    check(stored === 2, "both answers still stored on the response");

    // ---------- (6) New Survey reset = create path always INSERTs ----------
    console.log("\n(6) New Survey reset (fresh create, no overwrite):");
    const a = await upsertSurvey({ tenantId, name: "Fresh A", status: "draft", questions: [{ type: "short_text", label: "Q" }] });
    const b = await upsertSurvey({ tenantId, name: "Fresh B", status: "draft", questions: [{ type: "short_text", label: "Q" }] });
    check(a.id !== b.id, "two consecutive creates make two distinct rows");
    const stillA = await getSurvey(tenantId, a.id);
    check(!!stillA && stillA!.name === "Fresh A", "the first survey is untouched by the second create");
    check((await listSurveys(tenantId)).length === 3, "library lists all three surveys");

    // ---------- (7) client wiring fixes (static) ----------
    console.log("\n(7) client wiring (static):");
    const comm = readFileSync(resolve(__dirname, "../../public/js/communication.js"), "utf8");
    check(/MAP_TYPES = \[\["contact"[^\]]*\], \["job"[^\]]*\], \["booking"[^\]]*\]\]/.test(comm), "record-type options always include contact, job, booking");
    check(/async function ensureFields\(rt\)/.test(comm) && /\/api\/fields\?recordType=/.test(comm), "selecting a type fetches THAT type's fields (per-record-type)");
    check(/rtSel\.onchange = \(\) => \{ q\.mapRecordType = rtSel\.value \|\| null; q\.mapFieldKey = null; fillFields\(\); updateWarn\(\); \}/.test(comm), "cascade fills fields in place (no full repaint that resets the choice)");
    check(/\["new", "New Survey"\]/.test(comm) && /if \(v === "new"\) setEdit\(null\)/.test(comm), "New Survey tab present and resets the builder (no stale id)");
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

  console.log("\n=====================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (survey mapping fix)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
