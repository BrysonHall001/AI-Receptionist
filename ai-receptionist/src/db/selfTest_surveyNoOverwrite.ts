// Batch self-test — REGRESSION: creating a new survey must INSERT a new row and never
// overwrite another survey (or its questions). Also confirms edits stay scoped.
//
//   npx tsx src/db/selfTest_surveyNoOverwrite.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { upsertSurvey, getSurvey, listSurveys } from "../services/surveyService";

const db = prisma as any;
const T_NAME = "__SELFTEST_SURVEY_NO_OVERWRITE__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Survey create must not overwrite existing surveys");
  console.log("=================================================");

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;

    // ---------- (1) three creates in sequence -> three DISTINCT rows ----------
    console.log("(1) three sequential creates:");
    // Each create passes NO id (the fixed client clears the bound id after a create).
    const s1 = await upsertSurvey({ tenantId, name: "Survey One", status: "draft", mapTargetType: "contact", questions: [{ type: "short_text", label: "Q1-a" }] });
    const s2 = await upsertSurvey({ tenantId, name: "Survey Two", status: "draft", mapTargetType: "contact", questions: [{ type: "short_text", label: "Q2-a" }, { type: "yes_no", label: "Q2-b" }] });
    const s3 = await upsertSurvey({ tenantId, name: "Survey Three", status: "draft", mapTargetType: "contact", questions: [{ type: "rating", label: "Q3-a", config: { min: 1, max: 5 } }] });
    check(s1.id !== s2.id && s2.id !== s3.id && s1.id !== s3.id, "three creates produced three DISTINCT ids");

    const all = await listSurveys(tenantId);
    check(all.length === 3, "list endpoint returns all THREE surveys");
    check(all.some((s: any) => s.name === "Survey One") && all.some((s: any) => s.name === "Survey Two") && all.some((s: any) => s.name === "Survey Three"), "all three names present (none overwritten)");

    // survey one is intact after creating two & three
    const g1 = await getSurvey(tenantId, s1.id);
    check(!!g1 && g1!.name === "Survey One" && g1!.questions.length === 1 && g1!.questions[0].label === "Q1-a", "Survey One is UNCHANGED after creating Two & Three");
    const g2 = await getSurvey(tenantId, s2.id);
    check(!!g2 && g2!.questions.length === 2, "Survey Two kept its own 2 questions");
    const g3 = await getSurvey(tenantId, s3.id);
    check(!!g3 && g3!.questions.length === 1 && g3!.questions[0].type === "rating", "Survey Three kept its own question");

    // ---------- (2) editing #2 leaves #1 and #3 untouched ----------
    console.log("\n(2) edit is scoped to its own survey:");
    await upsertSurvey({ tenantId, id: s2.id, name: "Survey Two (edited)", status: "active", mapTargetType: "contact", questions: [{ type: "long_text", label: "Q2-new" }] });
    const e1 = await getSurvey(tenantId, s1.id);
    const e2 = await getSurvey(tenantId, s2.id);
    const e3 = await getSurvey(tenantId, s3.id);
    check(!!e2 && e2!.name === "Survey Two (edited)" && e2!.questions.length === 1 && e2!.questions[0].label === "Q2-new", "Survey Two updated in place");
    check(!!e1 && e1!.name === "Survey One" && e1!.questions.length === 1 && e1!.questions[0].label === "Q1-a", "Survey One untouched by the edit to Two");
    check(!!e3 && e3!.name === "Survey Three" && e3!.questions.length === 1, "Survey Three untouched by the edit to Two");
    check((await listSurveys(tenantId)).length === 3, "still exactly three surveys after the edit");

    // ---------- (3) adding a question to #3 doesn't touch #1's questions ----------
    console.log("\n(3) question edits are scoped:");
    const before1Qids = (await db.surveyQuestion.findMany({ where: { surveyId: s1.id } })).map((q: any) => q.id).sort();
    await upsertSurvey({ tenantId, id: s3.id, name: "Survey Three", status: "draft", mapTargetType: "contact", questions: [{ type: "rating", label: "Q3-a", config: { min: 1, max: 5 } }, { type: "nps", label: "Q3-b" }] });
    const g3b = await getSurvey(tenantId, s3.id);
    check(!!g3b && g3b!.questions.length === 2, "Survey Three now has 2 questions");
    const after1Qids = (await db.surveyQuestion.findMany({ where: { surveyId: s1.id } })).map((q: any) => q.id).sort();
    check(JSON.stringify(before1Qids) === JSON.stringify(after1Qids) && after1Qids.length === 1, "Survey One's questions are byte-for-byte unchanged");

    // ---------- (4) static guard: the builder resets after a create ----------
    console.log("\n(4) client builder reset-after-create:");
    const commJs = readFileSync(resolve(__dirname, "../../public/js/communication.js"), "utf8");
    check(/const wasCreate = !state\.id;/.test(commJs), "save handler distinguishes create from edit (wasCreate)");
    check(/if \(wasCreate\) setEdit\(null\);/.test(commJs), "after a create the builder resets (clears the bound id)");
    check(commJs.indexOf('state.id = res.id; heading.textContent = "Edit survey"; newBtn.style.display = "";') === -1, "the old always-bind-after-save line is gone");
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

  console.log("\n=================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (survey no-overwrite)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
