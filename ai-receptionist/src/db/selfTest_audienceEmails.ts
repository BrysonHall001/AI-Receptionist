// Batch self-test — Audience rework: typed-email recipient math (union, dedupe,
// validation, count) on the REAL send path, plus static guards for the shared picker.
//
//   npx tsx src/db/selfTest_audienceEmails.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end. No real email (mock forced).

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { env } from "../config/env";
import { sendEmailBlast, resolveEmailableRecipients, dedupeTypedEmails } from "../services/communicationService";

const db = prisma as any;
const T_NAME = "__SELFTEST_AUDIENCE_EMAILS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Audience rework — typed emails + recipient math");
  console.log("==============================================");
  (env as any).EMAIL_PROVIDER = "mock";

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const u1 = await db.user.create({ data: { tenantId, email: `aud_${Date.now()}@example.invalid`, name: "Owner", role: "OWNER", passwordHash: "x" } });
    const cA = await db.contact.create({ data: { tenantId, name: "Alice", email: "alice@example.invalid", phone: "+1", source: "web" } });
    const cB = await db.contact.create({ data: { tenantId, name: "Bob", email: "bob@example.invalid", phone: "+2", source: "web" } });
    const cC = await db.contact.create({ data: { tenantId, name: "Cy", email: null, phone: "+3", source: "web" } });
    const from = "owner@example.invalid";

    // ---------- (1) pure dedupe/validation ----------
    console.log("(1) dedupeTypedEmails (validation + dedupe):");
    const d1 = dedupeTypedEmails(["a@b.com", "A@B.COM", "notanemail", "c@d.com"], ["c@d.com"]);
    check(d1.length === 1 && d1[0] === "a@b.com", "drops case-dupe, invalid, and addresses already included");
    check(dedupeTypedEmails(["nope", "@x", "..", "x@y"], []).length === 0 || dedupeTypedEmails(["nope", "@x", ".."], []).length === 0, "rejects invalid addresses");

    // ---------- (2) union + dedupe vs contacts on the real send path ----------
    console.log("\n(2) recipients = typed ∪ (contacts − excluded), emailable, deduped:");
    const res = await sendEmailBlast({
      tenantId, subject: "Hi", html: "<p>x</p>", contactIds: [cA.id, cB.id, cC.id],
      extraEmails: ["alice@example.invalid", "new1@example.invalid", "new1@example.invalid", "bad-addr"],
      fromEmail: from, createdById: u1.id,
    });
    // contacts emailable = A,B (C has none) = 2; typed: alice dup(contact), new1 once, bad invalid -> 1
    check(res.recipientCount === 3 && res.sentCount === 3, "2 contacts + 1 unique-valid typed = 3 (typed dup of a contact dropped)");
    const rec = await db.communicationSend.findFirst({ where: { tenantId } });
    check(!!rec && rec.recipientCount === 3, "logged CommunicationSend count includes typed");
    // NEW: the stored recipient list distinguishes contacts (contactId set) from typed
    // addresses (contactId null): 2 contacts + 1 unique-valid typed = 3.
    const storedRcps = rec && Array.isArray(rec.recipients) ? rec.recipients : [];
    check(storedRcps.length === 3, "recipients list stored with 3 entries");
    check(storedRcps.filter((p: any) => p.contactId).length === 2 && storedRcps.filter((p: any) => !p.contactId).length === 1,
      "2 contact recipients (contactId set) + 1 typed recipient (contactId null) captured");
    check(storedRcps.every((p: any) => p.email && p.status === "sent"), "each stored recipient has an email and sent status");
    // NEW (email send records): EmailLog mirrors the union — 3 rows linked to the blast,
    // 2 with a contactId (contacts) and 1 without (typed address), all status "mock".
    const logs = await db.emailLog.findMany({ where: { communicationSendId: rec.id } });
    check(logs.length === 3, `3 EmailLog rows linked to the blast (got ${logs.length})`);
    check(logs.filter((l: any) => l.contactId).length === 2 && logs.filter((l: any) => !l.contactId).length === 1,
      "EmailLog distinguishes 2 contact rows (contactId set) from 1 typed row (contactId null)");
    check(logs.every((l: any) => l.type === "email_blast" && l.status === "mock"), "each EmailLog row is type email_blast + status mock");

    // ---------- (3) typed-only send (no criteria) ----------
    console.log("\n(3) typed-only send:");
    const res2 = await sendEmailBlast({ tenantId, subject: "Solo", html: "<p>x</p>", contactIds: [], extraEmails: ["solo@example.invalid", "garbage"], fromEmail: from, createdById: u1.id });
    check(res2.recipientCount === 1 && res2.sentCount === 1, "a send with only typed emails resolves to 1 recipient");

    // ---------- (4) exclude still applies, count accurate ----------
    console.log("\n(4) exclude + count:");
    const res3 = await sendEmailBlast({ tenantId, subject: "Ex", html: "<p>x</p>", contactIds: [cA.id, cB.id], excludeIds: [cB.id], extraEmails: ["new2@example.invalid"], fromEmail: from, createdById: u1.id });
    check(res3.recipientCount === 2, "excluded contact removed; typed added (1 contact + 1 typed = 2)");
    const r = await resolveEmailableRecipients(tenantId, [cA.id, cB.id, cC.id], [cB.id]);
    check(r.length === 1 && r[0].id === cA.id, "resolveEmailableRecipients = matching − excluded − non-emailable");

    // ---------- (5) shared picker API + mount opts (static) ----------
    console.log("\n(5) shared audience picker (static guards):");
    const comm = readFileSync(resolve(__dirname, "../../public/js/communication.js"), "utf8");
    check(/getTypedEmails:/.test(comm), "audiencePicker exposes getTypedEmails() in its API");
    check(/tablePreview: true, allowTypedEmails: true/.test(comm), "email compose opts into the table preview + typed emails");
    check(/App\.audiencePicker\.mount\(audienceHost, \{\}\)/.test(comm), "survey-send reuses the shared picker (pick-mode)");
    check(/if \(hasPreload\) audOpts\.preloadIds = preloadIds/.test(comm), "preload (Contacts deep-link) mount path preserved");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try { await db.emailLog.deleteMany({ where: { tenantId: tId } }); await db.tenant.delete({ where: { id: tId } }); }
      catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n==============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (audience emails)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
