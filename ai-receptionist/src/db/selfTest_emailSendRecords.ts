// Batch self-test — Email send records (3A). Verifies the three senders in
// notificationService.ts record every email in EmailLog (with type/status/meta), that
// blasts link per-recipient EmailLog rows via communicationSendId, that the tenant-scoped
// recipient endpoint reads them back, plus structural guards for the failed-send row,
// the meta threaded from every caller, and the invite-outcome (no silent success) change.
//
//   npx tsx src/db/selfTest_emailSendRecords.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end. No real email (mock forced on).

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { env } from "../config/env";
import { sendPlainEmail, sendRichEmail, sendCallSummaryEmail } from "../services/notificationService";
import { sendEmailBlast, listSendRecipients } from "../services/communicationService";

const db = prisma as any;
const T_NAME = "__SELFTEST_EMAIL_RECORDS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

async function main() {
  console.log("Email send records — EmailLog capture / linkage / outcome");
  console.log("=========================================================");
  (env as any).EMAIL_PROVIDER = "mock";

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const cA = await db.contact.create({ data: { tenantId, name: "Alice", email: "alice@example.invalid", phone: "+1", source: "web" } });

    // ---------- (1) each sender writes ONE EmailLog row (mock -> status "mock") ----------
    console.log("(1) every send is recorded (mock mode -> status 'mock'):");

    await sendPlainEmail("plain@example.invalid", "Plain subject", "body", { type: "password_reset" });
    const plain = await db.emailLog.findFirst({ where: { toEmail: "plain@example.invalid" } });
    check(!!plain && plain.type === "password_reset" && plain.status === "mock" && plain.subject === "Plain subject",
      "sendPlainEmail writes an EmailLog row (explicit type honored, status mock)");

    await sendRichEmail({ to: "rich@example.invalid", subject: "Rich subject", html: "<p>hi</p>", fromEmail: "from@example.invalid" }, {
      type: "single", tenantId, contactId: cA.id, sentById: "user-xyz", toName: "Alice",
    });
    const rich = await db.emailLog.findFirst({ where: { toEmail: "rich@example.invalid" } });
    check(!!rich && rich.type === "single" && rich.status === "mock" && rich.tenantId === tenantId && rich.contactId === cA.id && rich.sentById === "user-xyz" && rich.toName === "Alice",
      "sendRichEmail writes an EmailLog row carrying all threaded meta (tenant/contact/sentBy/toName)");

    await sendCallSummaryEmail({
      to: "notify@example.invalid", businessName: "Biz", extracted: {} as any,
      fromNumber: "+15550000", transcript: [] as any, startedAt: new Date(), completed: true,
    }, { tenantId, toName: "Biz" });
    const call = await db.emailLog.findFirst({ where: { toEmail: "notify@example.invalid" } });
    check(!!call && call.type === "call_summary" && call.status === "mock" && call.tenantId === tenantId,
      "sendCallSummaryEmail writes an EmailLog row (default type 'call_summary')");

    // ---------- (2) defaults when meta.type is omitted ----------
    console.log("\n(2) sensible default type when meta.type is absent:");
    await sendRichEmail({ to: "def@example.invalid", subject: "d", html: "<p>d</p>", fromEmail: "f@example.invalid" });
    const def = await db.emailLog.findFirst({ where: { toEmail: "def@example.invalid" } });
    check(!!def && def.type === "single", "sendRichEmail defaults type to 'single' when no meta.type given");

    // ---------- (3) blast links a per-recipient EmailLog row via communicationSendId ----------
    console.log("\n(3) blast fans out per-recipient EmailLog rows linked to the send:");
    const blast = await sendEmailBlast({
      tenantId, subject: "Blast", html: "<p>x</p>",
      contactIds: [cA.id], extraEmails: ["typed@example.invalid"],
      fromEmail: "sender@example.invalid", createdById: "user-abc",
    });
    const blastLogs = await db.emailLog.findMany({ where: { communicationSendId: blast.id } });
    check(blastLogs.length === 2, `2 EmailLog rows linked to the blast (1 contact + 1 typed) (got ${blastLogs.length})`);
    check(blastLogs.every((l: any) => l.type === "email_blast" && l.status === "mock" && l.communicationSendId === blast.id && l.sentById === "user-abc"),
      "each blast EmailLog row is type email_blast, status mock, linked + attributed to the sender");
    check(blastLogs.filter((l: any) => l.contactId).length === 1 && blastLogs.filter((l: any) => !l.contactId).length === 1,
      "contact recipient has a contactId; typed address has none");

    // ---------- (4) tenant-scoped recipient read-back (Task 5 endpoint/service) ----------
    console.log("\n(4) listSendRecipients reads EmailLog back, tenant-scoped:");
    const rcps = await listSendRecipients(tenantId, blast.id);
    check(!!rcps && rcps.length === 2 && rcps.every((p) => p.toEmail && p.status === "mock"),
      "listSendRecipients returns 2 rows with email + status for the blast");
    check((await listSendRecipients("someone-elses-tenant", blast.id)) === null,
      "a foreign tenant gets null (can't read another tenant's recipient list)");

    // ---------- (5) mock rows are still written (row count reflects every send) ----------
    console.log("\n(5) mock sends are recorded too (not skipped):");
    const total = await db.emailLog.count({ where: { tenantId } });
    // Tenant-scoped rows: rich + call + 2 blast = 4. (plain/password_reset and the
    // no-meta default send carry no tenantId, so they aren't counted here.)
    check(total === 4, `all tenant-scoped mock sends recorded (expected 4, got ${total})`);
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try {
        await db.emailLog.deleteMany({ where: { tenantId: tId } });
        await db.emailLog.deleteMany({ where: { toEmail: "plain@example.invalid" } });
        await db.communicationSend.deleteMany({ where: { tenantId: tId } });
        await db.tenant.delete({ where: { id: tId } });
      } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  // ---------- (6) structural: senders record a FAILED row before re-throwing ----------
  console.log("\n(6) failure path records status 'failed' before re-throwing (source guard):");
  const notif = read("../services/notificationService.ts");
  const failedWrites = (notif.match(/status:\s*"failed"/g) || []).length;
  check(failedWrites >= 3, `all three senders write a 'failed' EmailLog row on error (found ${failedWrites})`);
  check(/status:\s*"failed"[\s\S]{0,120}throw new Error/.test(notif), "the failed row is written BEFORE the re-throw");
  check((notif.match(/status:\s*"mock"/g) || []).length >= 3, "mock mode still writes a row in all three senders");

  // ---------- (7) structural: meta threaded from every Task-3 caller ----------
  console.log("\n(7) meta threaded from every caller (type present at each send site):");
  const callerType: Array<[string, string]> = [
    ["../services/callOrchestrator.ts", "call_summary"],
    ["../services/inviteService.ts", "invite"],
    ["../services/feedbackService.ts", "feedback"],
    ["../services/reportExecutor.ts", "report"],
    ["../services/surveyBlastService.ts", "survey_blast"],
    ["../services/communicationService.ts", "email_blast"],
    ["../routes/api.ts", "single"],
    ["../automation/actions.ts", "automation"],
    ["../routes/auth.ts", "password_reset"],
  ];
  for (const [rel, type] of callerType) {
    const src = read(rel);
    check(src.includes(`"${type}"`), `${rel.split("/").pop()} threads type "${type}"`);
  }
  // blasts create the CommunicationSend FIRST, then pass its id into each send.
  const comm = read("../services/communicationService.ts");
  const survey = read("../services/surveyBlastService.ts");
  check(/communicationSend\.create[\s\S]*?for \(const r of recipients\)[\s\S]*?communicationSendId: send\.id/.test(comm),
    "email blast creates the send row before fan-out and links each recipient");
  check(/communicationSend\.create[\s\S]*?for \(const r of recipients\)[\s\S]*?communicationSendId: send\.id/.test(survey),
    "survey blast creates the send row before fan-out and links each recipient");

  // ---------- (8) structural: no more silent-success on invites (Task 4) ----------
  console.log("\n(8) invite endpoints report whether the email actually sent:");
  const adminRoutes = read("../routes/admin.ts");
  const apiRoutes = read("../routes/api.ts");
  const adminJs = read("../../public/js/admin.js");
  check(/portals\/:id\/invites[\s\S]*?const emailed = await sendInvite[\s\S]*?res\.json\(\{[\s\S]*?emailed \}\)/.test(adminRoutes),
    "admin.ts portal-invite endpoint returns `emailed`");
  check((apiRoutes.match(/emailed \}\)/g) || []).length >= 1 && /const emailed = isCustom/.test(apiRoutes),
    "api.ts invite endpoint returns `emailed`");
  check(/r\.emailed === false/.test(adminJs) && /couldn't be sent/i.test(adminJs),
    "the tenant-create wizard warns when an invite record was created but the email failed");

  // ---------- (9) structural: Sent detail sources recipients from EmailLog endpoint ----------
  console.log("\n(9) Sent-detail recipient list is sourced from the EmailLog endpoint:");
  const commJs = read("../../public/js/communication.js");
  check(/\/api\/communication\/sends\/"?\s*\+\s*encodeURIComponent\(r\.id\)\s*\+\s*"\/recipients/.test(commJs),
    "openSendDetail fetches /api/communication/sends/:id/recipients");
  check(/Recipient list wasn't recorded for sends before this update\./.test(commJs),
    "muted note preserved for sends that predate recipient capture");
  check(/status === "mock"/.test(commJs), "the mock status is rendered distinctly");

  console.log("\n=========================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (email send records)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
