// Batch self-test — Survey results: aggregation correctness (counts/%, rating avg,
// NPS), anonymous vs tied, export fidelity (+ ExportRecord), lifecycle, role gate.
//
//   npx tsx src/db/selfTest_surveyResults.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { can } from "../services/permissionService";
import { upsertSurvey, setSurveyStatus } from "../services/surveyService";
import { createRecipient, submitSurvey, listResponses } from "../services/surveyResponseService";
import { aggregateResults, getResponseExport } from "../services/surveyResultsService";
import { createExport, getExportCsv } from "../services/exportService";

const db = prisma as any;
const T_NAME = "__SELFTEST_SURVEY_RESULTS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Survey results — aggregation, export, lifecycle");
  console.log("===============================================");

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const u1 = await db.user.create({ data: { tenantId, email: `res_${Date.now()}@example.invalid`, name: "Owner", role: "OWNER", passwordHash: "x" } });
    const mk = async (n: string) => (await db.contact.create({ data: { tenantId, name: n, email: `${n.toLowerCase()}@example.invalid`, phone: "+1", source: "web" } })).id;
    const ids = [await mk("Ann"), await mk("Ben"), await mk("Cara"), await mk("Dan")];

    const built = await upsertSurvey({
      tenantId, createdById: u1.id, name: "Quarterly", status: "active", mapTargetType: "contact",
      questions: [
        { type: "single_select", label: "Plan", config: { options: ["A", "B"] }, mapFieldKey: null },
        { type: "rating", label: "Rate", config: { min: 1, max: 5 }, mapFieldKey: null },
        { type: "nps", label: "Recommend", mapFieldKey: null },
        { type: "yes_no", label: "Return", mapFieldKey: null },
        { type: "short_text", label: "Comments", mapFieldKey: null },
      ],
    });
    const surveyId = built.id;
    const survey = await db.survey.findUnique({ where: { id: surveyId }, include: { questions: { orderBy: { order: "asc" } } } });
    const qid: Record<string, string> = {};
    survey.questions.forEach((q: any) => { qid[q.label] = q.id; });

    // Known answer matrix (5 responses: 4 tied + 1 anonymous)
    const plan = ["A", "A", "B", "B", "A"];       // A=3, B=2
    const rate = [5, 4, 3, 2, 1];                  // avg 3
    const nps = [10, 9, 8, 7, 0];                  // promoters 2, passives 2, detractors 1 -> score 20
    const ret = [true, true, false, true, false];  // Yes=3, No=2
    const txt = ["great", "ok", "meh", "good", "bad"];

    const mkAnswers = (i: number) => {
      const a: any = {};
      a[qid["Plan"]] = plan[i]; a[qid["Rate"]] = rate[i]; a[qid["Recommend"]] = nps[i]; a[qid["Return"]] = ret[i]; a[qid["Comments"]] = txt[i];
      return a;
    };
    // 4 tied via per-recipient tokens
    for (let i = 0; i < 4; i++) {
      const rec = await createRecipient(tenantId, surveyId, ids[i]);
      const sub = await submitSurvey({ token: rec!.token, answers: mkAnswers(i) });
      if (!sub.ok) throw new Error("seed submit failed: " + sub.message);
    }
    // 1 anonymous via the public link
    const anonSub = await submitSurvey({ publicId: survey.publicId, answers: mkAnswers(4) });
    if (!anonSub.ok) throw new Error("anon seed failed: " + anonSub.message);

    // ---------- (1) summary + anonymous/tied ----------
    console.log("(1) summary:");
    const agg = await aggregateResults(tenantId, surveyId);
    check(!!agg && agg!.total === 5, "total responses = 5");
    check(!!agg && agg!.tied === 4 && agg!.anonymous === 1, "4 tied + 1 anonymous");

    // ---------- (2) per-question aggregation ----------
    console.log("\n(2) aggregation correctness:");
    const byLabel = (l: string) => agg!.questions.find((q: any) => q.label === l);
    const planQ = byLabel("Plan");
    const optA = planQ.options.find((o: any) => o.value === "A"); const optB = planQ.options.find((o: any) => o.value === "B");
    check(optA.count === 3 && optA.pct === 60, "single_select A = 3 (60%)");
    check(optB.count === 2 && optB.pct === 40, "single_select B = 2 (40%)");
    check(byLabel("Rate").average === 3, "rating average = 3");
    const npsQ = byLabel("Recommend");
    check(npsQ.promoters === 2 && npsQ.passives === 2 && npsQ.detractors === 1, "NPS split: 2 promoters / 2 passives / 1 detractor");
    check(npsQ.score === 20, "NPS score = %promoters − %detractors = 40 − 20 = 20");
    const retQ = byLabel("Return");
    const yes = retQ.options.find((o: any) => o.value === "Yes"); const no = retQ.options.find((o: any) => o.value === "No");
    check(yes.count === 3 && no.count === 2, "yes_no: Yes=3, No=2");
    check(byLabel("Comments").texts.length === 5, "short_text collected all 5 text answers");

    // ---------- (3) responses list labels anonymous vs tied ----------
    console.log("\n(3) responses list:");
    const view = await listResponses(tenantId, surveyId);
    check(!!view && view!.length === 5, "responses list returns 5 rows");
    check(!!view && view!.filter((r: any) => r.contactName === "Anonymous").length === 1, "exactly one row labelled Anonymous");
    check(!!view && view!.some((r: any) => r.contactName === "Ann"), "tied rows show the contact name");

    // ---------- (4) export fidelity ----------
    console.log("\n(4) export fidelity:");
    const ex = await getResponseExport(tenantId, surveyId);
    check(!!ex && ex!.rows.length === 5, "export has one row per response (5)");
    check(!!ex && ex!.columns.length === 4 + 5, "export has fixed cols + one per question (4 + 5)");
    const qKey = "q_" + qid["Plan"];
    const annRow = ex!.rows.find((r: any) => r.contact === "Ann");
    check(!!annRow && annRow[qKey] === "A" && annRow.anonymous === "No", "a tied row's values match stored answers + anonymous=No");
    const anonRow = ex!.rows.find((r: any) => r.anonymous === "Yes");
    check(!!anonRow && anonRow.contact === "Anonymous", "the anonymous row is flagged + named Anonymous");

    // log it like the client does, then confirm it's downloadable from history
    const header = ex!.columns.map((c: any) => c.label).join(",");
    const csv = [header, ...ex!.rows.map((r: any) => ex!.columns.map((c: any) => JSON.stringify(r[c.key] ?? "")).join(","))].join("\n");
    const rec = await createExport({ tenantId, dataType: "survey", name: "Quarterly responses", rowCount: ex!.rows.length, fields: ex!.columns.map((c: any) => c.label), csv, createdById: u1.id });
    check(!!rec && rec.rowCount === 5, "export logged to history (ExportRecord) with 5 rows");
    const dl = await getExportCsv(rec.id, tenantId);
    check(!!dl && dl!.csv === csv, "logged export is downloadable and matches");

    // ---------- (5) lifecycle ----------
    console.log("\n(5) lifecycle:");
    await setSurveyStatus(tenantId, surveyId, "closed");
    const recC = await createRecipient(tenantId, surveyId, ids[0]);
    const blocked = await submitSurvey({ token: recC!.token, answers: mkAnswers(0) });
    check(blocked.ok === false && blocked.code === "inactive", "closing blocks new submissions");
    check((await db.surveyResponse.count({ where: { surveyId } })) === 5, "closing retains existing responses (still 5)");
    await setSurveyStatus(tenantId, surveyId, "active");
    const recR = await createRecipient(tenantId, surveyId, ids[1]);
    const reopened = await submitSurvey({ token: recR!.token, answers: mkAnswers(1) });
    check(reopened.ok === true, "reopening allows submissions again");

    // ---------- (6) role gate ----------
    console.log("\n(6) role gate:");
    check((await can({ role: "CLIENT_USER" } as any, "contacts", "edit")) === false, "a disallowed role can't view results / export");
    check((await can({ role: "OWNER" } as any, "contacts", "edit")) === true, "OWNER allowed");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try { await db.exportRecord.deleteMany({ where: { tenantId: tId } }); await db.tenant.delete({ where: { id: tId } }); }
      catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n===============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (survey results)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
