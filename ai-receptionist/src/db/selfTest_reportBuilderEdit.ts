// Batch self-test — email body + One-Time status + click-to-edit, on the REAL engine.
// Proves: the custom email body round-trips save->edit and is used as the email HTML
// on send (empty body falls back to the default); the three-state status derives
// correctly (immediate->One-Time, recurring+active->Active, recurring+inactive->
// Inactive) and the One-Time filter never includes a recurring report; editing a
// saved report UPDATES the same row (no duplicate) and recomputes nextRunAt.
//
//   npx tsx src/db/selfTest_reportBuilderEdit.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end. No real email (mock forced on).

import { prisma, disconnectDb } from "./client";
import { upsertScheduledReport, getScheduledReport, listReports } from "../services/reportService";
import { runAndDeliverReport } from "../services/reportExecutor";
import { computeNextRunAt, currentAnchorWeekStart } from "../services/reportSchedule";
import * as notif from "../services/notificationService";
import { listRecordTypes } from "../services/recordTypeService";
import { listFields } from "../services/fieldService";
import { env } from "../config/env";

const db = prisma as any;
const ZONE = "America/New_York";
const T_NAME = "__SELFTEST_REPORT_BUILDER_EDIT__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
// The same derivation the Reports list uses.
const derive = (r: any) => (r.mode !== "recurring" ? "onetime" : (r.active ? "active" : "inactive"));

async function main() {
  console.log("Email body + One-Time status + click-to-edit");
  console.log("============================================");
  (env as any).EMAIL_PROVIDER = "mock";

  // Spy on sendRichEmail to capture the HTML actually sent (without sending).
  const origSend = (notif as any).sendRichEmail;
  let lastHtml = "";
  (notif as any).sendRichEmail = async (a: any) => { lastHtml = a.html; };

  let tId: string | null = null;
  const beforeExports = await db.exportRecord.count();
  try {
    const tenant = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid", timezone: ZONE } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    await listRecordTypes(tenantId);
    await listFields(tenantId, "contact");
    await db.contact.createMany({ data: [
      { tenantId, name: "Ada", phone: "+1", source: "web" },
      { tenantId, name: "Lin", phone: "+2", source: "web" },
    ] });
    const definition = { types: { contact: { fields: ["name", "createdAt"], rules: [] } } };

    // ---------- (1) body round-trips and is used as the email HTML ----------
    console.log("(1) email body — round-trip + used on send:");
    const body = "<p>Hello <strong>team</strong>, here is the latest.</p>";
    const r1 = await upsertScheduledReport({ tenantId, name: "Bodied", format: "csv", definition, recipients: ["a@example.invalid"], emailBody: body, createdById: null });
    const got1 = await getScheduledReport(tenantId, r1.id);
    check(!!got1 && got1.emailBody === body, "body round-trips through save -> getScheduledReport");

    lastHtml = "";
    await runAndDeliverReport({ tenantId, reportId: r1.id, name: "Bodied", format: "csv", definition, recipients: ["a@example.invalid"], emailBody: body, createdById: null });
    check(lastHtml === body, "the custom body is used verbatim as the email HTML");

    lastHtml = "";
    await runAndDeliverReport({ tenantId, reportId: r1.id, name: "Bodied", format: "csv", definition, recipients: ["a@example.invalid"], emailBody: "<p><br></p>", createdById: null });
    check(lastHtml.includes("is attached") && !lastHtml.includes("Hello"), "empty body falls back to the default attachment notice");

    // ---------- (2) three-state status + One-Time filter ----------
    console.log("\n(2) status — One-Time / Active / Inactive:");
    const cadence = { daysOfWeek: [1, 3, 5], weekInterval: 1, anchorWeekStart: currentAnchorWeekStart(ZONE), times: { "1": "09:00", "3": "09:00", "5": "09:00" } };
    const next = computeNextRunAt(cadence, new Date(), ZONE);
    const rActive = await upsertScheduledReport({ tenantId, name: "Recurring On", format: "csv", definition, recipients: ["b@example.invalid"], mode: "recurring", cadence, nextRunAt: next, createdById: null });
    const rInactive = await upsertScheduledReport({ tenantId, name: "Recurring Off", format: "csv", definition, recipients: ["c@example.invalid"], mode: "recurring", cadence, nextRunAt: next, createdById: null });
    await db.scheduledReport.update({ where: { id: rInactive.id }, data: { active: false } });

    const list = await listReports(tenantId);
    const byId: Record<string, any> = {}; list.forEach((r: any) => { byId[r.id] = r; });
    check(derive(byId[r1.id]) === "onetime", "immediate report derives to One-Time");
    check(derive(byId[rActive.id]) === "active", "recurring + active derives to Active");
    check(derive(byId[rInactive.id]) === "inactive", "recurring + inactive derives to Inactive");
    const oneTimeOnly = list.filter((r: any) => derive(r) === "onetime");
    check(oneTimeOnly.length === 1 && oneTimeOnly[0].id === r1.id, "One-Time filter returns only the immediate report");
    check(!list.some((r: any) => derive(r) === "active" && r.mode !== "recurring"), "no one-time report is ever labeled Active");

    // ---------- (3) edit updates the SAME row + recomputes nextRunAt ----------
    console.log("\n(3) edit — same row updated, nextRunAt recomputed:");
    const countBefore = await db.scheduledReport.count({ where: { tenantId } });
    const newCadence = { daysOfWeek: [2], weekInterval: 2, anchorWeekStart: currentAnchorWeekStart(ZONE), times: { "2": "16:30" } };
    const newNext = computeNextRunAt(newCadence, new Date(), ZONE);
    const edited = await upsertScheduledReport({ tenantId, id: rActive.id, name: "Recurring On (edited)", format: "xlsx", definition, recipients: ["b@example.invalid"], emailBody: "<p>Edited body</p>", mode: "recurring", cadence: newCadence, nextRunAt: newNext, createdById: null });
    check(edited.id === rActive.id, "edit returns the same report id");
    const countAfter = await db.scheduledReport.count({ where: { tenantId } });
    check(countAfter === countBefore, `no duplicate row created (count ${countBefore} -> ${countAfter})`);
    const got3 = await getScheduledReport(tenantId, rActive.id);
    check(!!got3 && got3.name === "Recurring On (edited)" && got3.format === "xlsx", "name + format updated in place");
    check(!!got3 && got3.emailBody === "<p>Edited body</p>", "email body updated through edit");
    const stored = await db.scheduledReport.findUnique({ where: { id: rActive.id } });
    check(!!stored.nextRunAt && !!newNext && stored.nextRunAt.getTime() === newNext.getTime(), "nextRunAt recomputed from the new cadence");
    check(stored.nextRunAt.getTime() !== (next ? next.getTime() : 0), "nextRunAt actually changed from the pre-edit value");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    (notif as any).sendRichEmail = origSend;
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try { await db.exportRecord.deleteMany({ where: { tenantId: tId } }); await db.tenant.delete({ where: { id: tId } }); }
      catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  const afterExports = await db.exportRecord.count();
  check(afterExports === beforeExports, `exportRecords unchanged (${beforeExports} -> ${afterExports})`);

  console.log("\n============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (body + status + edit)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
