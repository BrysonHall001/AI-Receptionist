// Self-test: drip engine prep. send_survey action (mocked), unenroll stops a run, audience
// enrollment (dynamic), and multi-wait linear-drip timing. No network (EMAIL_PROVIDER=mock).
//   npx tsx src/db/selfTest_dripEnginePrep.ts
import { prisma, disconnectDb } from "./client";
import { runAction, type ActionContext } from "../automation/actions";
import { enrollAudienceInAutomation } from "../automation/engine";
import { createAudience } from "../services/audienceService";
import { loadFieldDefs } from "../automation/contactRow";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const vipRule = { rules: [{ field: "name", op: "contains", value: "VIP", conj: "AND" }] };
let phoneSeq = 8000;
async function mkContact(tenantId: string, name: string, email: string | null) { return db.contact.create({ data: { tenantId, name, email, phone: `+1555${phoneSeq++}`, source: "test" } }); }

async function ctxFor(tenantId: string, contactId: string, automationId: string): Promise<ActionContext> {
  const fieldDefs = await loadFieldDefs(tenantId);
  const portal = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return { tenantId, contactId, fieldDefs, actor: { type: "automation", id: automationId, name: "Drip" }, portal: { notifyEmail: portal?.notifyEmail || "ops@test.local", name: portal?.name }, workingSet: [], triggerType: "test" } as ActionContext;
}

async function main() {
  console.log("drip engine prep\n================");
  const tenants: string[] = [];
  try {
    const t = (await db.tenant.create({ data: { name: "Drip Co", billingStatus: "paid", notifyEmail: "ops@test.local" } })).id; tenants.push(t);
    const alice = await mkContact(t, "VIP Alice", "alice@x.test");
    const bob = await mkContact(t, "VIP Bob", "bob@x.test");
    await mkContact(t, "Regular Carol", "carol@x.test");
    const aud = await createAudience({ tenantId: t, name: "VIPs", definition: vipRule, createdById: null });

    const survey = await db.survey.create({ data: { tenantId: t, name: "NPS", status: "active", publicId: "pub_" + Date.now(), mapTargetType: "contact" } });

    // Linear drip: wait -> send_email -> wait -> send_survey (Manual trigger, no conditions).
    const drip = await db.automation.create({ data: {
      tenantId: t, name: "Welcome drip", triggerType: "Manual", enabled: true, conditions: [],
      actions: [
        { type: "wait", config: { amount: 1, unit: "days" } },
        { type: "send_email", config: { subject: "Hi {{first_name}}", html: "<p>Welcome</p>" } },
        { type: "wait", config: { amount: 2, unit: "days" } },
        { type: "send_survey", config: { surveyId: survey.id, subject: "Quick survey", html: "<p>Please answer {{survey_link}}</p>" } },
      ],
    } });

    console.log("(Task 1) send_survey action sends via surveyBlastService (mocked):");
    const r1 = await runAction({ type: "send_survey", config: { surveyId: survey.id, subject: "Quick survey", html: "<p>Answer {{survey_link}}</p>" } }, await ctxFor(t, bob.id, drip.id));
    check(r1.status === "success", "send_survey returns success for an emailable contact");
    const sends = await db.communicationSend.findMany({ where: { tenantId: t } });
    check(sends.length >= 1, "a survey send/recipient record was created (personal link path)");
    const r1none = await runAction({ type: "send_survey", config: { subject: "x", html: "y" } }, await ctxFor(t, bob.id, drip.id));
    check(r1none.status === "failed", "send_survey with no surveyId -> failed (clear error)");

    console.log("\n(Task 3) enroll an Audience -> exactly current matchers, dynamic:");
    const enr = await enrollAudienceInAutomation(drip.id, aud.id, t);
    check(enr.enrolled === 2 && enr.contactIds.includes(alice.id) && enr.contactIds.includes(bob.id), "enrolled exactly the 2 VIP matchers (Carol excluded)");
    let jobs = await db.scheduledJob.findMany({ where: { tenantId: t, automationId: drip.id } });
    check(jobs.length === 4, "each matcher queued 2 steps (send_email + send_survey) = 4 jobs");
    const carol = await db.contact.findFirst({ where: { tenantId: t, name: "Regular Carol" } });
    check(!jobs.some((j: any) => j.contactId === carol.id), "non-matcher (Carol) has no queued steps");
    // dynamic: add a new matcher, enroll a fresh automation -> 3
    const dave = await mkContact(t, "VIP Dave", "dave@x.test");
    const drip2 = await db.automation.create({ data: { tenantId: t, name: "d2", triggerType: "Manual", enabled: true, conditions: [], actions: [{ type: "wait", config: { amount: 1, unit: "days" } }, { type: "send_email", config: { subject: "s", html: "h" } }] } });
    const enr2 = await enrollAudienceInAutomation(drip2.id, aud.id, t);
    check(enr2.enrolled === 3 && enr2.contactIds.includes(dave.id), "re-enrolling after adding a matcher enrolls 3 (dynamic at enroll time)");

    console.log("\n(Task 4) multiple waits honored (linear timing, not collapsed):");
    const aliceJobs = jobs.filter((j: any) => j.contactId === alice.id).sort((a: any, b: any) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    check(aliceJobs.length === 2 && aliceJobs[0].action.type === "send_email" && aliceJobs[1].action.type === "send_survey", "order preserved: email then survey");
    const gapMs = new Date(aliceJobs[1].dueAt).getTime() - new Date(aliceJobs[0].dueAt).getTime();
    check(Math.abs(gapMs - 2 * 86_400_000) < 60_000, "survey is scheduled ~2 days AFTER the email (second wait applied, not dropped)");

    console.log("\n(Task 2) unenroll stops a contact's run -> later steps don't fire:");
    const uctx = await ctxFor(t, alice.id, drip.id);
    const u = await runAction({ type: "unenroll", config: {} }, uctx); // default = this flow
    check(u.status === "success", "unenroll action succeeds");
    jobs = await db.scheduledJob.findMany({ where: { tenantId: t, automationId: drip.id } });
    const aliceAfter = jobs.filter((j: any) => j.contactId === alice.id);
    const bobAfter = jobs.filter((j: any) => j.contactId === bob.id);
    check(aliceAfter.every((j: any) => j.status === "canceled"), "Alice's pending steps are all canceled");
    check(bobAfter.every((j: any) => j.status === "pending"), "Bob's steps remain pending (only Alice unenrolled)");
    // Prove the scheduler would NOT run Alice's steps: due-selection is {pending, dueAt<=now}.
    await db.scheduledJob.updateMany({ where: { tenantId: t, automationId: drip.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    const due = await db.scheduledJob.findMany({ where: { tenantId: t, automationId: drip.id, status: "pending", dueAt: { lte: new Date() } } });
    check(!due.some((j: any) => j.contactId === alice.id), "Alice's canceled steps are NOT in the due-to-run set (later actions won't fire)");
    check(due.some((j: any) => j.contactId === bob.id), "Bob's steps ARE due to run (his run continues)");

    console.log("\n(Task 2) targeted unenroll — 'all flows' scope:");
    // Bob is in drip + drip2; unenroll all
    const u2 = await runAction({ type: "unenroll", config: { scope: "all" } }, await ctxFor(t, bob.id, drip.id));
    check(u2.status === "success", "unenroll scope=all succeeds");
    const bobAll = await db.scheduledJob.findMany({ where: { tenantId: t, contactId: bob.id } });
    check(bobAll.every((j: any) => j.status === "canceled"), "Bob unenrolled from ALL flows (drip + drip2)");
  } catch (e) {
    console.log("   (error: " + (e as Error).stack + ")"); fails++;
  } finally {
    for (const id of tenants) {
      try { await db.scheduledJob.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.communicationSend.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.emailLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.surveyRecipient.deleteMany({ where: { survey: { tenantId: id } } }); } catch {}
      try { await db.survey.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.automationRun.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.automation.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.savedFilter.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.contact.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (drip engine prep)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
