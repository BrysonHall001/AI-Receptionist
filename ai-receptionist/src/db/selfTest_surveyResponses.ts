// Batch self-test — Survey responses: identity, active-gating, field-writing,
// mapping safety, anonymous, idempotency, validation, public isolation.
// WEIGHTED toward the risky paths (identity + writing).
//
//   npx tsx src/db/selfTest_surveyResponses.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { listFields, createField } from "../services/fieldService";
import { upsertSurvey } from "../services/surveyService";
import { resolveContext, publicPayload, submitSurvey, createRecipient, listResponses } from "../services/surveyResponseService";

const db = prisma as any;
const T_NAME = "__SELFTEST_SURVEY_RESP__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function getContact(id: string) { return db.contact.findUnique({ where: { id } }); }
function cf(c: any, key: string) { return ((c.customFields as any) || {})[key]; }

async function main() {
  console.log("Survey responses — identity + field-writing (the risky paths)");
  console.log("============================================================");

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const u1 = await db.user.create({ data: { tenantId, email: `sr_${Date.now()}@example.invalid`, name: "Owner", role: "OWNER", passwordHash: "x" } });
    const cA = await db.contact.create({ data: { tenantId, name: "Alice", email: "alice@example.invalid", phone: "+1", source: "web" } });
    const cB = await db.contact.create({ data: { tenantId, name: "Bob", email: "bob@example.invalid", phone: "+2", source: "web" } });

    await listFields(tenantId, "contact");
    const fDate = await createField(tenantId, { label: "Visit date", type: "date" }, "contact");
    const fSel = await createField(tenantId, { label: "Plan", type: "single_select", options: ["Basic", "Pro"] }, "contact");
    const fBool = await createField(tenantId, { label: "Opted in", type: "checkbox" }, "contact");
    const fNum = await createField(tenantId, { label: "Score", type: "number" }, "contact");
    const fSkip = await createField(tenantId, { label: "Will vanish", type: "number" }, "contact");

    // Build an ACTIVE survey covering the mapped types (+ one unmapped + one that will lose its field).
    const built = await upsertSurvey({
      tenantId, createdById: u1.id, name: "Visit feedback", status: "active", mapTargetType: "contact",
      questions: [
        { type: "short_text", label: "Your name", mapFieldKey: "name" },                                  // system text
        { type: "single_select", label: "Which plan?", config: { options: ["Basic", "Pro"] }, mapFieldKey: fSel.key },
        { type: "date", label: "When did you visit?", mapFieldKey: fDate.key },
        { type: "yes_no", label: "Join our list?", mapFieldKey: fBool.key },                                // checkbox
        { type: "rating", label: "Rate us", config: { min: 1, max: 5, step: 1 }, mapFieldKey: fNum.key },
        { type: "long_text", label: "Anything else?", mapFieldKey: null },                                  // unmapped
        { type: "rating", label: "Secret rating", config: { min: 1, max: 5 }, mapFieldKey: fSkip.key },     // field deleted before submit
      ],
    });
    const surveyId = built.id;
    const full = await db.survey.findUnique({ where: { id: surveyId }, include: { questions: { orderBy: { order: "asc" } } } });
    const qid = (label: string) => full.questions.find((q: any) => q.label === label).id;

    // ---------- (1) token -> identity (server-side; body contactId ignored) ----------
    console.log("(1) token -> identity:");
    const rec = await createRecipient(tenantId, surveyId, cA.id);
    check(!!rec && !!rec.token, "minted a per-recipient token");
    const ctx = await resolveContext({ token: rec!.token });
    check(!!ctx && ctx!.contact && ctx!.contact.id === cA.id, "token resolves to the correct contact SERVER-SIDE");
    check(!!ctx && ctx!.tenantId === tenantId, "token resolves to the correct tenant");

    const answers1: any = {};
    answers1[qid("Your name")] = "Alice Updated";
    answers1[qid("Which plan?")] = "Pro";
    answers1[qid("When did you visit?")] = "2026-05-01";
    answers1[qid("Join our list?")] = true;
    answers1[qid("Rate us")] = 4;
    answers1[qid("Anything else?")] = "Great service";
    // delete the field behind "Secret rating" so its write is skipped (but response saves)
    await db.fieldDef.delete({ where: { id: fSkip.id } });
    answers1[qid("Secret rating")] = 5;

    // pass a DIFFERENT contactId in the body — it must be IGNORED (identity is the token).
    const sub1 = await submitSurvey({ token: rec!.token, answers: answers1, contactId: cB.id } as any);
    check(sub1.ok === true && !!sub1.responseId, "submission accepted");
    check(sub1.wroteToContact === true, "submission wrote to the token's contact");

    const aAfter = await getContact(cA.id);
    const bAfter = await getContact(cB.id);

    // ---------- (2) field-writing correctness (right field, right contact, coerced) ----------
    console.log("\n(2) field-writing correctness:");
    check(aAfter.name === "Alice Updated", "short_text -> system name field written on the RIGHT contact");
    check(cf(aAfter, fSel.key) === "Pro", "single_select written as the chosen option string");
    check(cf(aAfter, fDate.key) === "2026-05-01", "date written as YYYY-MM-DD");
    check(cf(aAfter, fBool.key) === true, "yes_no coerced to boolean true on a checkbox field");
    check(cf(aAfter, fNum.key) === 4, "rating coerced to number 4");
    check(bAfter.name === "Bob" && cf(bAfter, fSel.key) === undefined, "the body's contactId was IGNORED — Bob untouched");

    // ---------- (3) mapping safety (unmapped writes nothing; bad coercion skipped, response saved) ----------
    console.log("\n(3) mapping safety:");
    check(cf(aAfter, fSkip.key) === undefined, "answer for a now-missing field was SKIPPED (not written)");
    check(Array.isArray(sub1.skipped) && sub1.skipped!.length === 1, "the one un-writable field was recorded as skipped");
    const respCount1 = await db.surveyResponse.count({ where: { surveyId } });
    check(respCount1 === 1, "the response still saved despite the skipped field");
    const savedResp = await db.surveyResponse.findFirst({ where: { surveyId }, include: { answers: true } });
    check(!!savedResp && savedResp.answers.length === 7, "all answers stored on the response (incl. unmapped)");

    // ---------- (4) idempotency (same token twice) ----------
    console.log("\n(4) idempotency:");
    const sub2 = await submitSurvey({ token: rec!.token, answers: answers1 });
    check(sub2.ok === true && sub2.duplicate === true, "second submit on the same token is a no-op duplicate");
    check((await db.surveyResponse.count({ where: { surveyId } })) === 1, "still exactly ONE response (no double-write)");

    // ---------- (5) anonymous (no contact, writes nothing) ----------
    console.log("\n(5) anonymous link:");
    const anonCtx = await resolveContext({ publicId: full.publicId });
    check(!!anonCtx && anonCtx!.contact === null, "anonymous link resolves to contactId = null");
    const bBefore = await getContact(cB.id);
    const anonAnswers: any = {}; anonAnswers[qid("Your name")] = "Anon"; anonAnswers[qid("Which plan?")] = "Basic"; anonAnswers[qid("When did you visit?")] = "2026-06-01"; anonAnswers[qid("Join our list?")] = false; anonAnswers[qid("Rate us")] = 3;
    const subAnon = await submitSurvey({ publicId: full.publicId, answers: anonAnswers });
    check(subAnon.ok === true && subAnon.wroteToContact === false, "anonymous submission saved, wrote to NO record");
    const anonResp = await db.surveyResponse.findFirst({ where: { surveyId, contactId: null } });
    check(!!anonResp && anonResp.contactId === null, "anonymous response stored with contactId null");
    const bUnchanged = await getContact(cB.id);
    check(bUnchanged.name === bBefore.name && JSON.stringify(bUnchanged.customFields) === JSON.stringify(bBefore.customFields), "no contact was modified by the anonymous response");

    // ---------- (6) active gating ----------
    console.log("\n(6) active gating:");
    await db.survey.update({ where: { id: surveyId }, data: { status: "closed" } });
    const rec2 = await createRecipient(tenantId, surveyId, cA.id);
    const subClosed = await submitSurvey({ token: rec2!.token, answers: anonAnswers });
    check(subClosed.ok === false && subClosed.code === "inactive", "a closed survey rejects submissions");
    await db.survey.update({ where: { id: surveyId }, data: { status: "active" } });

    // ---------- (7) validation ----------
    console.log("\n(7) validation:");
    const rec3 = await createRecipient(tenantId, surveyId, cA.id);
    const badSel: any = {}; badSel[qid("Which plan?")] = "Enterprise"; // not an option
    const r7a = await submitSurvey({ token: rec3!.token, answers: badSel });
    check(r7a.ok === false && r7a.code === "invalid", "single_select value not in options is rejected");
    const rec4 = await createRecipient(tenantId, surveyId, cA.id);
    const badNps: any = {};
    // there's no nps question here; craft one quickly to test range
    const npsSurvey = await upsertSurvey({ tenantId, name: "NPS", status: "active", mapTargetType: "contact", questions: [{ type: "nps", label: "NPS", mapFieldKey: null }] });
    const npsFull = await db.survey.findUnique({ where: { id: npsSurvey.id }, include: { questions: true } });
    const recN = await createRecipient(tenantId, npsSurvey.id, cA.id);
    badNps[npsFull.questions[0].id] = 12; // out of 0..10
    const r7b = await submitSurvey({ token: recN!.token, answers: badNps });
    check(r7b.ok === false && r7b.code === "invalid", "out-of-range NPS (12) is rejected");

    // ---------- (8) public-page isolation ----------
    console.log("\n(8) public payload isolation:");
    const payload = publicPayload((await resolveContext({ publicId: full.publicId }))!);
    const json = JSON.stringify(payload);
    check(json.indexOf("mapFieldKey") === -1, "public payload does NOT expose field mappings");
    check(json.indexOf(tenantId) === -1 && json.indexOf(cA.id) === -1, "public payload does NOT expose tenant/contact identifiers");
    check(Array.isArray(payload.questions) && payload.questions.length === 7, "public payload carries the survey's questions");

    // ---------- (9) listResponses view ----------
    console.log("\n(9) responses view:");
    const view = await listResponses(tenantId, surveyId);
    check(Array.isArray(view) && view!.length === 2, "responses list returns this survey's responses");
    check(!!view && view.some((r: any) => r.contactName === "Anonymous") && view.some((r: any) => r.contactName && r.contactName !== "Anonymous"), "view labels named vs Anonymous correctly");
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

  console.log("\n============================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (survey responses)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
