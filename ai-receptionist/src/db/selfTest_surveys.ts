// Batch self-test — Surveys builder (CRUD + ordering + field mapping + role gate),
// on the REAL engine.
//
//   npx tsx src/db/selfTest_surveys.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { can } from "../services/permissionService";
import { listFields, createField } from "../services/fieldService";
import { listSurveys, getSurvey, upsertSurvey, deleteSurvey } from "../services/surveyService";

const db = prisma as any;
const T_NAME = "__SELFTEST_SURVEYS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Surveys — model + builder CRUD + mapping");
  console.log("========================================");

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const u1 = await db.user.create({ data: { tenantId, email: `surv_${Date.now()}@example.invalid`, name: "Sam Owner", role: "OWNER", passwordHash: "x" } });

    await listFields(tenantId, "contact"); // ensure system fields (name=text, email=email, intent=textarea, phone=phone)
    const dateField = await createField(tenantId, { label: "Visit date", type: "date" }, "contact");
    const numField = await createField(tenantId, { label: "Score num", type: "number" }, "contact");
    const selField = await createField(tenantId, { label: "Plan", type: "single_select", options: ["A", "B"] }, "contact");

    // ---------- (1) create with several types + ordering ----------
    console.log("(1) create + ordering + mapping:");
    const created = await upsertSurvey({
      tenantId, createdById: u1.id, name: "Post-visit", description: "How did we do?", status: "active", mapTargetType: "contact",
      questions: [
        { type: "short_text", label: "Your name", mapFieldKey: "name" },           // text-compatible
        { type: "rating", label: "Rate us", config: { min: 1, max: 5, step: 1 }, mapFieldKey: numField.key }, // rating -> number
        { type: "single_select", label: "Which plan?", config: { options: ["A", "B"] }, mapFieldKey: selField.key },
        { type: "date", label: "When did you visit?", mapFieldKey: dateField.key }, // date -> date
        { type: "long_text", label: "Comments", mapFieldKey: null },                // don't map
      ],
    });
    check(!!created.id, "survey created");
    const got = await getSurvey(tenantId, created.id);
    check(!!got && got.questions.length === 5, "reload returns all 5 questions");
    check(!!got && got.questions.map((q: any) => q.type).join(",") === "short_text,rating,single_select,date,long_text", "questions returned in saved order");
    check(!!got && got.questions[4].mapFieldKey === null, "\"don't map\" persists as null");

    // ---------- (2) field-key fidelity ----------
    console.log("\n(2) field-key fidelity:");
    const dateQ = got!.questions.find((q: any) => q.type === "date");
    check(!!dateQ && dateQ.mapFieldKey === dateField.key, "mapping stores the field KEY (not the label)");
    const fields = await listFields(tenantId, "contact");
    check(fields.some((f: any) => f.key === dateQ.mapFieldKey && f.type === "date"), "stored key resolves to a real, compatible field def");

    // ---------- (3) edit updates the SAME survey (no duplicate) ----------
    console.log("\n(3) edit updates in place (no duplicate):");
    const beforeCount = (await listSurveys(tenantId)).length;
    await upsertSurvey({
      tenantId, id: created.id, name: "Post-visit (v2)", status: "draft", mapTargetType: "contact",
      questions: [
        { type: "nps", label: "How likely to recommend?", mapFieldKey: null },
        { type: "yes_no", label: "Would you return?", mapFieldKey: null },
      ],
    });
    const afterCount = (await listSurveys(tenantId)).length;
    check(afterCount === beforeCount, `no duplicate survey created (count ${beforeCount} -> ${afterCount})`);
    const got2 = await getSurvey(tenantId, created.id);
    check(!!got2 && got2.name === "Post-visit (v2)" && got2.questions.length === 2 && got2.questions[0].type === "nps", "same survey now has the new name + replaced questions");
    const qCount = await db.surveyQuestion.count({ where: { surveyId: created.id } });
    check(qCount === 2, "old questions were removed (no orphans) — exactly 2 remain");

    // ---------- (4) mapping validity is enforced ----------
    console.log("\n(4) mapping validity:");
    let rejected = false;
    try {
      await upsertSurvey({ tenantId, name: "Bad map", mapTargetType: "contact", questions: [{ type: "date", label: "A date", mapFieldKey: "name" }] });
    } catch { rejected = true; }
    check(rejected, "a date question mapped to a TEXT field is rejected");
    let okMap = false;
    try {
      const s = await upsertSurvey({ tenantId, name: "Good map", mapTargetType: "contact", questions: [{ type: "date", label: "A date", mapFieldKey: dateField.key }] });
      okMap = !!s.id; await deleteSurvey(tenantId, s.id);
    } catch { okMap = false; }
    check(okMap, "a date question mapped to a DATE field is accepted");

    // ---------- (5) delete cascades to questions ----------
    console.log("\n(5) delete cascades:");
    const delId = created.id;
    check((await deleteSurvey(tenantId, delId)) === true, "delete returns true");
    check((await getSurvey(tenantId, delId)) === null, "survey is gone");
    check((await db.surveyQuestion.count({ where: { surveyId: delId } })) === 0, "its questions were cascade-deleted");

    // ---------- (6) role gate ----------
    console.log("\n(6) role gate:");
    check((await can({ role: "CLIENT_USER" } as any, "contacts", "edit")) === false, "a role that can't use the Email tab can't create/edit surveys");
    check((await can({ role: "OWNER" } as any, "contacts", "edit")) === true, "OWNER allowed");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try { await db.survey.deleteMany({ where: { tenantId: tId } }); await db.tenant.delete({ where: { id: tId } }); }
      catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n========================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (surveys)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
