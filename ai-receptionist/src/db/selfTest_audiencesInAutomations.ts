// Self-test: Audiences unified into the Automations engine.
//   • Enroll-audience trigger: enrolling resolves the audience's CURRENT members and runs them
//     through the automation (via the existing engine) — exactly the current matchers, dynamically.
//   • Audience-membership condition ("contact is in Audience X") gates a run through evalRules.
//   • Confirms send_survey + unenroll are exposed as wizard actions (in ACTION_TYPES) and __audience
//     is a condition field — i.e. no second engine, one shared set of triggers/conditions/actions.
//   npx tsx src/db/selfTest_audiencesInAutomations.ts   (email mocked)
import { prisma, disconnectDb } from "./client";
import { createAudience } from "../services/audienceService";
import { createAutomation, getAutomation } from "../services/automationService";
import { enrollAudienceInAutomation, runManualAutomation } from "../automation/engine";
import { ACTION_TYPES } from "../automation/actions";
import { conditionFields, loadFieldDefs, AUDIENCE_FIELD_KEY } from "../automation/contactRow";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
let phoneSeq = 9100;
async function mkContact(tenantId: string, name: string, email: string | null) { return db.contact.create({ data: { tenantId, name, email, phone: `+1555${phoneSeq++}`, source: "test" } }); }
async function runsFor(tenantId: string, automationId: string, contactId: string) { return db.automationRun.findMany({ where: { tenantId, automationId, contactId } }); }

async function main() {
  console.log("audiences in automations\n========================");
  const tenants: string[] = [];
  try {
    // ---- static wiring (no DB): the wizard's shared vocabulary now includes these ----
    console.log("shared vocabulary (one engine):");
    check(ACTION_TYPES.some((a) => a.type === "send_survey"), "Send survey is a wizard action (ACTION_TYPES)");
    check(ACTION_TYPES.some((a) => a.type === "unenroll"), "Unenroll is a wizard action (ACTION_TYPES)");
    const cf = conditionFields([]);
    check(cf.some((f) => f.key === AUDIENCE_FIELD_KEY && f.type === "audience"), "Audience membership is a condition field");

    const t = (await db.tenant.create({ data: { name: "AA", billingStatus: "paid", notifyEmail: "ops@test.local" } })).id; tenants.push(t);

    // ---- Task 1: enroll-audience trigger runs current members through the engine ----
    console.log("\nenroll an audience (dynamic, via the engine):");
    const a1 = await mkContact(t, "Aud Alice", "alice@x.test");
    const a2 = await mkContact(t, "Aud Bob", "bob@x.test");
    await mkContact(t, "Regular Carol", "carol@x.test"); // not in the audience
    const aud = await createAudience({ tenantId: t, name: "Aud folks", definition: { rules: [{ field: "name", op: "contains", value: "Aud", conj: "AND" }] }, createdById: null });

    const enrollAuto = await createAutomation(t, {
      name: "Welcome the audience",
      triggerType: "EnrollAudience:" + aud.id,
      conditions: [],
      actions: [{ type: "send_email", config: { subject: "Welcome", html: "<p>hi</p>" } }],
      enabled: true,
    } as any, null);

    const enr = await enrollAudienceInAutomation(enrollAuto.id, aud.id, t);
    check(enr.enrolled === 2, "enrolls exactly the 2 current matchers (Carol excluded)");
    check(enr.contactIds.includes(a1.id) && enr.contactIds.includes(a2.id), "the enrolled contacts are the audience members");
    const aliceRuns = await runsFor(t, enrollAuto.id, a1.id);
    check(aliceRuns.some((r: any) => r.status === "success" && Array.isArray(r.results) && r.results.some((x: any) => x.type === "send_email" && x.status === "success")), "the enrolled member's send_email actually fired");

    // dynamic: add a new matcher, re-enroll -> now 3 (resolved fresh each time)
    const dave = await mkContact(t, "Aud Dave", "dave@x.test");
    const enr2 = await enrollAudienceInAutomation(enrollAuto.id, aud.id, t);
    check(enr2.enrolled === 3 && enr2.contactIds.includes(dave.id), "re-enroll picks up a newly-matching contact (dynamic resolution)");

    // a disabled automation refuses enrollment (safety)
    await db.automation.update({ where: { id: enrollAuto.id }, data: { enabled: false } });
    let refused = false;
    try { await enrollAudienceInAutomation(enrollAuto.id, aud.id, t); } catch { refused = true; }
    check(refused, "a turned-off automation refuses audience enrollment");

    // ---- Task 2: audience-membership CONDITION gates a run ----
    console.log("\ncondition: contact is in Audience X:");
    const condAuto = await createAutomation(t, {
      name: "Only audience members",
      triggerType: "Manual",
      conditions: [{ field: AUDIENCE_FIELD_KEY, op: "in_audience", value: aud.id, conj: "AND" }],
      actions: [{ type: "send_email", config: { subject: "Members only", html: "<p>x</p>" } }],
      enabled: true,
    } as any, null);

    await runManualAutomation(condAuto.id, a1.id, t);   // Alice IS in the audience
    await runManualAutomation(condAuto.id, (await db.contact.findFirst({ where: { tenantId: t, name: "Regular Carol" } })).id, t); // Carol is NOT
    const memberRuns = await runsFor(t, condAuto.id, a1.id);
    const carol = await db.contact.findFirst({ where: { tenantId: t, name: "Regular Carol" } });
    const nonRuns = await runsFor(t, condAuto.id, carol.id);
    check(memberRuns.some((r: any) => r.status === "success"), "a member passes the audience condition (runs)");
    check(nonRuns.every((r: any) => r.matched === false || r.status === "skipped"), "a non-member is gated out by the audience condition");

    // not_in_audience is the complement
    const condAuto2 = await createAutomation(t, {
      name: "Everyone except the audience",
      triggerType: "Manual",
      conditions: [{ field: AUDIENCE_FIELD_KEY, op: "not_in_audience", value: aud.id, conj: "AND" }],
      actions: [{ type: "create_note", config: { text: "outsider" } }],
      enabled: true,
    } as any, null);
    await runManualAutomation(condAuto2.id, carol.id, t);
    await runManualAutomation(condAuto2.id, a1.id, t);
    check((await runsFor(t, condAuto2.id, carol.id)).some((r: any) => r.status === "success"), "not_in_audience: a non-member matches");
    check((await runsFor(t, condAuto2.id, a1.id)).every((r: any) => r.matched === false || r.status === "skipped"), "not_in_audience: a member is gated out");

    // condition resolves the audience's CURRENT definition: widen the audience, Carol now qualifies
    const { updateAudience } = await import("../services/audienceService");
    await updateAudience(aud.id, t, { definition: { rules: [{ field: "name", op: "contains", value: "a", conj: "AND" }] } }); // matches Carol/Alice/Dave (any 'a')
    await runManualAutomation(condAuto.id, carol.id, t);
    check((await runsFor(t, condAuto.id, carol.id)).some((r: any) => r.status === "success"), "editing the audience changes who the condition matches (current definition)");
  } catch (e) {
    console.log("   (error: " + (e as Error).stack + ")"); fails++;
  } finally {
    for (const id of tenants) {
      for (const tbl of ["emailLog", "communicationSend", "automationRun", "scheduledJob", "automation", "savedFilter", "contact"]) { try { await (db as any)[tbl].deleteMany({ where: { tenantId: id } }); } catch {} }
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n========================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (audiences in automations)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
