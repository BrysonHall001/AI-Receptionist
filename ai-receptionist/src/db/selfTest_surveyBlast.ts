// Batch self-test — Survey blast: per-recipient link integrity, link-required,
// merge correctness, audience math, active gating, send record, suppression seam,
// role gate, and end-to-end tie-back. WEIGHTED toward link integrity.
//
//   npx tsx src/db/selfTest_surveyBlast.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end. No real email (mock forced).

import { prisma, disconnectDb } from "./client";
import { env } from "../config/env";
import { can } from "../services/permissionService";
import { listFields, createField } from "../services/fieldService";
import { upsertSurvey } from "../services/surveyService";
import { resolveContext, submitSurvey } from "../services/surveyResponseService";
import { sendSurveyBlast, sendSurveyTest, bodyHasLinkToken, _suppression, SURVEY_LINK_TOKEN } from "../services/surveyBlastService";

const db = prisma as any;
const T_NAME = "__SELFTEST_SURVEY_BLAST__";
const ORIGIN = "https://example.test";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
function tokenOf(url: string): string {
  const m = /[?&]token=([^&]+)/.exec(url || "");
  return m ? decodeURIComponent(m[1]) : "";
}

async function main() {
  console.log("Survey blast — per-recipient link integrity");
  console.log("===========================================");
  (env as any).EMAIL_PROVIDER = "mock";

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const u1 = await db.user.create({ data: { tenantId, email: `blast_${Date.now()}@example.invalid`, name: "Owner", role: "OWNER", passwordHash: "x" } });
    const cA = await db.contact.create({ data: { tenantId, name: "Alice", email: "alice@example.invalid", phone: "+1", source: "web" } });
    const cB = await db.contact.create({ data: { tenantId, name: "Bob", email: "bob@example.invalid", phone: "+2", source: "web" } });
    const cC = await db.contact.create({ data: { tenantId, name: "Cy (no email)", email: null, phone: "+3", source: "web" } });

    await listFields(tenantId, "contact");
    const fSel = await createField(tenantId, { label: "Plan", type: "single_select", options: ["Basic", "Pro"] }, "contact");

    const built = await upsertSurvey({
      tenantId, createdById: u1.id, name: "NPS check", status: "active", mapTargetType: "contact",
      questions: [{ type: "single_select", label: "Which plan?", config: { options: ["Basic", "Pro"] }, mapFieldKey: fSel.key }],
    });
    const surveyId = built.id;
    const qid = (await db.surveyQuestion.findFirst({ where: { surveyId } })).id;

    const goodHtml = `<p>Please take our survey: ${SURVEY_LINK_TOKEN}</p>`;
    const fromEmail = "owner@example.invalid";

    // ---------- (1) link required ----------
    console.log("(1) link required:");
    check(bodyHasLinkToken(goodHtml) && !bodyHasLinkToken("<p>no link here</p>"), "bodyHasLinkToken detects the merge token");
    let blocked = false;
    try { await sendSurveyBlast({ tenantId, surveyId, subject: "Hi", html: "<p>forgot the link</p>", contactIds: [cA.id], fromEmail, createdById: u1.id, origin: ORIGIN }); }
    catch (e) { blocked = /survey link/i.test((e as Error).message); }
    check(blocked, "a send without {{survey_link}} is blocked with a clear error");

    // ---------- (2/3) per-recipient uniqueness + merge correctness + audience math ----------
    console.log("\n(2/3) per-recipient links + audience math:");
    const suppressBefore = _suppression.calls;
    const res = await sendSurveyBlast({ tenantId, surveyId, subject: "Quick survey", html: goodHtml, contactIds: [cA.id, cB.id, cC.id], fromEmail, fromName: "Owner", createdById: u1.id, origin: ORIGIN });
    check(res.recipientCount === 2 && res.sentCount === 2, "audience = emailable only (Cy with no email dropped) -> 2 recipients");
    check(!!res.links && res.links.length === 2, "one link generated per recipient");
    const urlA = res.links!.find((l) => l.contactId === cA.id)!.url;
    const urlB = res.links!.find((l) => l.contactId === cB.id)!.url;
    check(!!urlA && !!urlB && urlA !== urlB, "the two recipients get DIFFERENT personalized URLs (merge correctness)");
    check(tokenOf(urlA) !== "" && tokenOf(urlA) !== tokenOf(urlB), "each URL carries a distinct token");

    // resolve each token SERVER-SIDE -> must map to the correct contact (attribution)
    const ctxA = await resolveContext({ token: tokenOf(urlA) });
    const ctxB = await resolveContext({ token: tokenOf(urlB) });
    check(!!ctxA && ctxA!.contact && ctxA!.contact.id === cA.id, "Alice's link resolves to Alice");
    check(!!ctxB && ctxB!.contact && ctxB!.contact.id === cB.id, "Bob's link resolves to Bob (not Alice)");

    // exclude math
    const res2 = await sendSurveyBlast({ tenantId, surveyId, subject: "x", html: goodHtml, contactIds: [cA.id, cB.id], excludeIds: [cB.id], fromEmail, createdById: u1.id, origin: ORIGIN });
    check(res2.recipientCount === 1, "excluded contact removed (matching − excluded − non-emailable)");

    // ---------- (4) suppression seam invoked ----------
    console.log("\n(4) suppression seam:");
    check(_suppression.calls > suppressBefore, "filterSuppressed checkpoint was invoked during fan-out");

    // ---------- (5) send record ----------
    console.log("\n(5) send record:");
    const rec = await db.communicationSend.findFirst({ where: { tenantId, channel: "survey", surveyId } });
    check(!!rec, "a CommunicationSend with channel 'survey' + surveyId was written");
    check(!!rec && rec.recipientCount === 2 && rec.sentCount === 2 && rec.failCount === 0, "send record has correct counts");

    // ---------- (6) active gating ----------
    console.log("\n(6) active gating:");
    await db.survey.update({ where: { id: surveyId }, data: { status: "draft" } });
    let gated = false;
    try { await sendSurveyBlast({ tenantId, surveyId, subject: "x", html: goodHtml, contactIds: [cA.id], fromEmail, createdById: u1.id, origin: ORIGIN }); }
    catch (e) { gated = /active/i.test((e as Error).message); }
    check(gated, "a non-active survey can't be sent");
    await db.survey.update({ where: { id: surveyId }, data: { status: "active" } });

    // ---------- (7) end-to-end tie-back ----------
    console.log("\n(7) end-to-end tie-back (send -> submit via that link -> attributed + field written):");
    const e2e = await sendSurveyBlast({ tenantId, surveyId, subject: "Tie-back", html: goodHtml, contactIds: [cA.id], fromEmail, createdById: u1.id, origin: ORIGIN });
    const tokA = tokenOf(e2e.links!.find((l) => l.contactId === cA.id)!.url);
    const ans: any = {}; ans[qid] = "Pro";
    const sub = await submitSurvey({ token: tokA, answers: ans });
    check(sub.ok === true && sub.wroteToContact === true, "submitting via the recipient link is accepted + writes to the contact");
    const respForA = await db.surveyResponse.findFirst({ where: { surveyId, contactId: cA.id } });
    check(!!respForA, "the response is attributed to the RIGHT contact (Alice)");
    const aFresh = await db.contact.findUnique({ where: { id: cA.id } });
    check(((aFresh.customFields as any) || {})[fSel.key] === "Pro", "the mapped answer was written onto Alice's field");

    // ---------- (8) test send (no recipient row, no send record) ----------
    console.log("\n(8) test send:");
    const sendsBefore = await db.communicationSend.count({ where: { tenantId } });
    const recipientsBefore = await db.surveyRecipient.count({ where: { surveyId } });
    await sendSurveyTest({ tenantId, surveyId, subject: "Preview", html: goodHtml, toEmail: "owner@example.invalid", fromEmail, origin: ORIGIN });
    check((await db.communicationSend.count({ where: { tenantId } })) === sendsBefore, "test send writes NO CommunicationSend");
    check((await db.surveyRecipient.count({ where: { surveyId } })) === recipientsBefore, "test send mints NO recipient token");

    // ---------- (9) role gate ----------
    console.log("\n(9) role gate:");
    check((await can({ role: "CLIENT_USER" } as any, "contacts", "edit")) === false, "a role that can't bulk-email is blocked from sending");
    check((await can({ role: "OWNER" } as any, "contacts", "edit")) === true, "OWNER allowed");
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

  console.log("\n===========================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (survey blast)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
