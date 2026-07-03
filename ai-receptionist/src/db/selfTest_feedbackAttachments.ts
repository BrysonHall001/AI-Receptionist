// Self-test (Batch 1) — ticket attachment LINKS, REAL Prisma path.
//
//   npx tsx src/db/selfTest_feedbackAttachments.ts
//
// PROVES (real createFeedbackTicket / addFeedbackAttachments + real Prisma):
//  - valid http/https links are stored IN ORDER on create;
//  - an invalid URL is rejected on CREATE (400) — no ticket written;
//  - non-http schemes are rejected (400);
//  - adding links to an EXISTING ticket APPENDS in order;
//  - an invalid URL is rejected on the add path (400) and leaves links untouched;
//  - the creator can add to their own ticket;
//  - someone WITHOUT access cannot add (hidden as 404, same rule as viewing/reply).
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_FBATT__"), removed at the end.
// (createFeedbackTicket sends a best-effort "new ticket" email, mocked in dev.)

import { prisma, disconnectDb } from "./client";
import { createFeedbackTicket, addFeedbackAttachments, getFeedbackTicket } from "../services/feedbackService";

const db = prisma as any;
const T = "__SELFTEST_FBATT__";
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
async function expectStatus(fn: () => Promise<any>, status: number, label: string) {
  try { await fn(); check(false, `${label} (expected ${status}, but it succeeded)`); }
  catch (e: any) { check(e?.status === status, `${label} (got ${e?.status ?? "?"}: ${e?.message ?? e})`); }
}

async function main() {
  console.log("Batch 1 — ticket attachment links (real path)");
  console.log("=============================================");

  let tId = "", cuId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T, businessType: "salon", notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    const cu = await db.user.create({ data: { email: `fbatt_${Date.now()}@example.invalid`, passwordHash: "x", role: "CLIENT_USER", tenantId: tId, name: "Creator Cory" } });
    cuId = cu.id;

    const portal = (actorId: string, role: string) => ({ scope: "portal", tenantId: tId, actor: { id: actorId, role } }) as any;
    const ctxCreator = portal(cuId, "CLIENT_USER");
    const ctxOwner = portal("owner-x", "OWNER");      // portal moderator (synthetic actor)
    const ctxOther = portal("other-x", "CLIENT_USER"); // a different portal user (no access)

    console.log("(1) create stores valid links IN ORDER:");
    const links1 = ["https://a.example.com/1", "http://b.example.com/2"];
    const created = await createFeedbackTicket(ctxCreator, { problem: "p", description: "d", attachments: links1 });
    check(JSON.stringify(created.attachments) === JSON.stringify(links1), `DTO attachments preserved in order (${JSON.stringify(created.attachments)})`);
    const fromDb = await db.feedbackTicket.findUnique({ where: { id: created.id } });
    check(JSON.stringify(fromDb.attachments) === JSON.stringify(links1), "stored array in DB matches, in order");

    console.log("(2) create rejects an invalid URL / non-http scheme (400, nothing written):");
    const before = await db.feedbackTicket.count({ where: { tenantId: tId } });
    await expectStatus(() => createFeedbackTicket(ctxCreator, { problem: "p", description: "d", attachments: ["asdf"] }), 400, "non-URL 'asdf' rejected");
    await expectStatus(() => createFeedbackTicket(ctxCreator, { problem: "p", description: "d", attachments: ["ftp://x.example.com"] }), 400, "non-http scheme rejected");
    const after = await db.feedbackTicket.count({ where: { tenantId: tId } });
    check(before === after, "no ticket was written for the rejected creates");

    console.log("(3) adding links to an existing ticket APPENDS in order (mod access):");
    const up = await addFeedbackAttachments(created.id, ctxOwner, { urls: ["https://c.example.com/3"] });
    check(JSON.stringify(up.attachments) === JSON.stringify([...links1, "https://c.example.com/3"]), `appended in order (${JSON.stringify(up.attachments)})`);

    console.log("(4) invalid URL on the add path is rejected (400), links untouched:");
    await expectStatus(() => addFeedbackAttachments(created.id, ctxOwner, { urls: ["nope"] }), 400, "invalid add rejected");
    const stillThree = await db.feedbackTicket.findUnique({ where: { id: created.id } });
    check(stillThree.attachments.length === 3, "attachments unchanged after the rejected add");

    console.log("(5) the creator can add to their OWN ticket:");
    const own = await addFeedbackAttachments(created.id, ctxCreator, { urls: ["https://own.example.com/4"] });
    check(own.attachments.length === 4 && own.attachments[3] === "https://own.example.com/4", "creator's add appended");

    console.log("(6) someone WITHOUT access cannot add (404, same rule as viewing):");
    await expectStatus(() => addFeedbackAttachments(created.id, ctxOther, { urls: ["https://x.example.com"] }), 404, "no-access user rejected (404)");
    const finalT = await db.feedbackTicket.findUnique({ where: { id: created.id } });
    check(finalT.attachments.length === 4, "attachments unchanged after the no-access attempt");

    // Sanity: getFeedbackTicket surfaces attachments to the detail view.
    const viewed = await getFeedbackTicket(created.id, ctxCreator);
    check(Array.isArray(viewed.attachments) && viewed.attachments.length === 4, "getFeedbackTicket returns attachments for display");

    console.log("(7) bare domains normalize to https:// (create + add); blanks dropped; junk rejected:");
    const norm = await createFeedbackTicket(ctxCreator, { problem: "p", description: "d", attachments: ["google.com", "google.com/some/path", "https://already.example.com", "", "  "] });
    check(
      JSON.stringify(norm.attachments) === JSON.stringify(["https://google.com", "https://google.com/some/path", "https://already.example.com"]),
      `normalized + blank rows dropped (${JSON.stringify(norm.attachments)})`,
    );
    await expectStatus(() => createFeedbackTicket(ctxCreator, { problem: "p", description: "d", attachments: ["hello world"] }), 400, "'hello world' (spaces) rejected on create");
    await expectStatus(() => createFeedbackTicket(ctxCreator, { problem: "p", description: "d", attachments: ["asdf"] }), 400, "'asdf' (no dot) rejected on create");
    const addNorm = await addFeedbackAttachments(norm.id, ctxOwner, { urls: ["dropbox.com/x"] });
    check(addNorm.attachments[addNorm.attachments.length - 1] === "https://dropbox.com/x", "bare domain normalized on the add-to-existing path");
    await expectStatus(() => addFeedbackAttachments(norm.id, ctxOwner, { urls: ["asdf"] }), 400, "'asdf' rejected on the add path");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T } }); } catch {}
  }

  console.log("\n=============================================");
  console.log("Proves attachment storage/order + http/https validation (create & add) + access rule.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
