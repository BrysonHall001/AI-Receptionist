// Batch self-test — Communication Phase 1 Batch 2 (Sent log, detail fidelity,
// deep-link preload resolution, templates), on the REAL engine.
//
//   npx tsx src/db/selfTest_communicationBatch2.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end. No real email (mock forced on).

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { can } from "../services/permissionService";
import { sendEmailBlast, listSends, listSendRecipients, resolveEmailableRecipients } from "../services/communicationService";
import { listTemplates, createTemplate } from "../services/templateService";
import { env } from "../config/env";

const db = prisma as any;
const T_NAME = "__SELFTEST_COMMUNICATION_B2__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Communication B2 — sent log / detail / preload / templates");
  console.log("=========================================================");
  (env as any).EMAIL_PROVIDER = "mock";

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const u1 = await db.user.create({ data: { tenantId, email: `commb2_${Date.now()}@example.invalid`, name: "Send Er", role: "OWNER", passwordHash: "x" } });
    const mk = async (name: string, email: string | null, phone: string) =>
      (await db.contact.create({ data: { tenantId, name, email, phone, source: "web" } })).id;
    const id1 = await mk("Ada", "ada@example.invalid", "+1");
    const id2 = await mk("Ben", null, "+2");          // no email
    const id3 = await mk("Cy", "cy@example.invalid", "+3");

    // ---------- (1) deep-link preload resolution == criteria resolution ----------
    console.log("(1) preload resolution (preloaded − excluded − non-emailable):");
    const resolved = await resolveEmailableRecipients(tenantId, [id1, id2, id3], [id3]);
    check(resolved.length === 1 && resolved[0].id === id1, "3 preloaded, 1 no-email, 1 excluded -> 1 recipient (same math as criteria)");

    // ---------- (2) send writes a row; (3) detail fidelity (subject+body persisted) ----------
    console.log("\n(2/3) blast persists subject + body for the detail view:");
    const subject = "Spring update";
    const bodyHtml = "<p>Hello <strong>friends</strong> — news inside.</p>";
    const res = await sendEmailBlast({ tenantId, subject, html: bodyHtml, contactIds: [id1, id3], fromEmail: "sender@example.invalid", fromName: "Send Er", createdById: u1.id });
    check(res.recipientCount === 2 && res.sentCount === 2, "blast resolved 2 emailable recipients");

    const sends = await listSends(tenantId);
    check(sends.length === 1, "Sent log lists exactly one send");
    const s = sends[0];
    check(s.subject === subject && s.body === bodyHtml, "subject + body round-trip into the detail payload (faithful)");
    check(s.recipientCount === 2 && s.sentCount === 2 && s.failCount === 0, "counts correct in the Sent log row");
    check(s.createdByName === "Send Er", "Sent-by resolves to the creator's name");

    // NEW (email send records): the Sent-detail recipient list now comes from EmailLog
    // via listSendRecipients — tenant-scoped, one entry per recipient, with real status.
    const detailRcps = await listSendRecipients(tenantId, s.id);
    check(!!detailRcps && detailRcps.length === 2, `listSendRecipients returns 2 EmailLog rows for the send (got ${detailRcps ? detailRcps.length : "null"})`);
    check(!!detailRcps && detailRcps.every((p) => p.toEmail && p.status === "mock"), "each detail recipient has an email + mock status (mock mode)");
    check((await listSendRecipients("no-such-tenant", s.id)) === null, "listSendRecipients is tenant-scoped (foreign tenant -> null, not another tenant's list)");

    // newest-first ordering
    await new Promise((r) => setTimeout(r, 5));
    await sendEmailBlast({ tenantId, subject: "Second", html: "<p>2</p>", contactIds: [id1], fromEmail: "sender@example.invalid", fromName: "Send Er", createdById: u1.id });
    const sends2 = await listSends(tenantId);
    check(sends2.length === 2 && sends2[0].subject === "Second", "Sent log is newest-first");

    // ---------- (4) role gate on the Sent log (same as Email tab = contacts:edit) ----------
    console.log("\n(4) role gate (GET /communication/sends -> contacts:edit):");
    check((await can({ role: "CLIENT_USER" } as any, "contacts", "edit")) === false, "CLIENT_USER blocked from the Sent log");
    check((await can({ role: "OWNER" } as any, "contacts", "edit")) === true, "OWNER allowed");

    // ---------- (5) templates: save -> retrievable -> fills subject+body ----------
    console.log("\n(5) templates (save as / start from):");
    await createTemplate({ tenantId, name: "Newsletter", kind: "email", subject: "Monthly news", body: "<p>Body here</p>", createdById: u1.id });
    const tpls = await listTemplates(tenantId, "email");
    const tpl = (tpls || []).find((t: any) => t.name === "Newsletter");
    check(!!tpl, "saved template is retrievable via the templates list");
    check(!!tpl && tpl.subject === "Monthly news" && tpl.body === "<p>Body here</p>", "template carries subject + body so compose can fill both");

    // ---------- (6) the Contacts bulk-email is re-pointed (no second send path) ----------
    console.log("\n(6) Contacts bulk-email routes to the shared composer:");
    const portalJs = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
    check(/Email selected[\s\S]{0,160}App\.communication\.composeTo/.test(portalJs), "\"Email selected\" calls App.communication.composeTo (deep-link)");
    check(portalJs.indexOf("bulkCompose") === -1, "old inline bulkCompose email path removed (no dead code)");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try {
        await db.emailLog.deleteMany({ where: { tenantId: tId } });
        await db.communicationSend.deleteMany({ where: { tenantId: tId } });
        await db.emailTemplate.deleteMany({ where: { tenantId: tId } });
        await db.tenant.delete({ where: { id: tId } });
      } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n=========================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (communication batch 2)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
