// Self-test (Batch A) — ticket export ROW EXPANSION, REAL Prisma path.
//
//   npx tsx src/db/selfTest_feedbackExportRows.ts
//
// WHAT THIS PROVES (real listFeedbackExportRows + real Prisma, seeded throwaway data):
//   - A ticket with 2 replies expands to EXACTLY 2 rows, ticket fields repeated on
//     each, reply fields varying per reply (and in chronological order).
//   - A ticket with 0 replies still yields EXACTLY 1 row, with blank reply fields —
//     so unanswered/open tickets are never dropped.
//   - Ticket-level fields (problem, status, posted by, portal) are present on every row.
//   It does NOT test the modal UI, field-selection, or CSV/Excel building (client-side).
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_FBEXPORT__"), deleted at the end.

import { prisma, disconnectDb } from "./client";
import { listFeedbackExportRows } from "../services/feedbackService";

const db = prisma as any;
const T = "__SELFTEST_FBEXPORT__";
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Batch A — ticket export row expansion (real path)");
  console.log("=================================================");

  let tId = "", uId = "";
  try {
    const t = await db.tenant.create({ data: { name: T, businessType: "salon", notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    const u = await db.user.create({ data: { email: `fbexp_${Date.now()}@example.invalid`, passwordHash: "x", role: "OWNER", tenantId: tId, name: "Owner Olivia" } });
    uId = u.id;
    const u2 = await db.user.create({ data: { email: `fbexp2_${Date.now()}@example.invalid`, passwordHash: "x", role: "CLIENT_USER", tenantId: tId, name: "Client Cody" } });

    // Ticket WITH 2 replies (RESOLVED).
    const tk2 = await db.feedbackTicket.create({ data: { tenantId: tId, createdById: u2.id, problem: "Phone keeps dropping", description: "calls cut at 30s", status: "RESOLVED", resolvedAt: new Date(), resolvedById: uId } });
    await db.feedbackMessage.create({ data: { ticketId: tk2.id, authorId: u2.id, body: "still happening", createdAt: new Date(Date.now() - 60000) } });
    await db.feedbackMessage.create({ data: { ticketId: tk2.id, authorId: uId, body: "fixed now", createdAt: new Date() } });

    // Ticket WITH 0 replies (OPEN).
    const tk0 = await db.feedbackTicket.create({ data: { tenantId: tId, createdById: u2.id, problem: "Logo too small", description: "hard to see", status: "OPEN" } });

    const ctxOwner = { scope: "portal", tenantId: tId, actor: { id: uId, role: "OWNER" } } as any;
    const rows = await listFeedbackExportRows(ctxOwner);

    console.log("(1) total rows = 2 (from the 2-reply ticket) + 1 (from the 0-reply ticket) = 3:");
    check(rows.length === 3, `got ${rows.length} rows (expected 3)`);

    const rows2 = rows.filter((r: any) => r.ticketId === tk2.id);
    const rows0 = rows.filter((r: any) => r.ticketId === tk0.id);

    console.log("(2) the 2-reply ticket expands to exactly 2 rows:");
    check(rows2.length === 2, `got ${rows2.length} rows for the 2-reply ticket`);

    console.log("(3) ticket fields are repeated on BOTH of its rows:");
    check(rows2.every((r: any) => r.problem === "Phone keeps dropping"), "problem repeated on every row");
    check(rows2.every((r: any) => r.status === "RESOLVED"), "status repeated on every row");
    check(rows2.every((r: any) => r.postedBy === "Client Cody"), "posted-by repeated on every row");
    check(rows2.every((r: any) => r.resolvedBy === "Owner Olivia"), "resolved-by repeated on every row");
    check(rows2.every((r: any) => r.portal === T), "portal name repeated on every row");

    console.log("(4) reply fields VARY per row and are in chronological order:");
    const replyTexts = rows2.map((r: any) => r.replyText);
    check(replyTexts[0] === "still happening" && replyTexts[1] === "fixed now", `reply order: ${JSON.stringify(replyTexts)}`);
    check(rows2[0].replyAuthor === "Client Cody" && rows2[1].replyAuthor === "Owner Olivia", "reply authors vary per row");
    check(rows2.every((r: any) => r.replyAt != null), "every reply row has a reply timestamp");

    console.log("(5) the 0-reply ticket still yields EXACTLY ONE row, reply fields blank:");
    check(rows0.length === 1, `got ${rows0.length} rows for the 0-reply ticket (expected 1)`);
    check(rows0[0] && rows0[0].replyAuthor === null && rows0[0].replyAt === null && rows0[0].replyText === null, "reply fields are blank on the reply-less row");
    check(rows0[0] && rows0[0].problem === "Logo too small" && rows0[0].status === "OPEN", "ticket fields still present on the reply-less row");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T } }); } catch {}
  }

  console.log("\n=================================================");
  console.log("Proves: one row per reply, ticket fields repeated, and reply-less");
  console.log("tickets kept as exactly one blank-reply row. Modal/CSV/Excel = manual.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
