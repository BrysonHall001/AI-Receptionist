// Self-test (Batch 2) — attachments in EXPORT ROWS, REAL Prisma path.
//
//   npx tsx src/db/selfTest_exportAttachmentRows.ts
//
// PROVES (real listFeedbackExportRows + real Prisma):
//  - each export row carries the ticket's attachments array, REPEATED across that
//    ticket's reply rows (ticket-level, like the other fields);
//  - a ticket with 2 links + 2 replies -> 2 rows, both with both links;
//  - a ticket with 0 links + 0 replies -> 1 row with an EMPTY attachments array;
//  - a ticket with 1 link + 0 replies -> 1 row with that link;
//  - the max link count across rows (which drives the number of "Attachment N"
//    columns in the export modal) computes to the expected value.
// The column PADDING/labels are built client-side in the modal — verified manually.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_EXPATT__"), removed at the end.

import { prisma, disconnectDb } from "./client";
import { listFeedbackExportRows } from "../services/feedbackService";

const db = prisma as any;
const T = "__SELFTEST_EXPATT__";
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  console.log("Batch 2 — attachments in export rows (real path)");
  console.log("================================================");

  let tId = "", uId = "";
  try {
    const t = await db.tenant.create({ data: { name: T, businessType: "salon", notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    const u = await db.user.create({ data: { email: `expatt_${Date.now()}@example.invalid`, passwordHash: "x", role: "CLIENT_USER", tenantId: tId, name: "Cory" } });
    uId = u.id;

    const linksA = ["https://a.example.com/1", "https://a.example.com/2"];
    const tA = await db.feedbackTicket.create({ data: { tenantId: tId, createdById: uId, problem: "A", description: "d", status: "OPEN", attachments: linksA } });
    await db.feedbackMessage.create({ data: { ticketId: tA.id, authorId: uId, body: "r1", createdAt: new Date(Date.now() - 60000) } });
    await db.feedbackMessage.create({ data: { ticketId: tA.id, authorId: uId, body: "r2", createdAt: new Date() } });
    const tB = await db.feedbackTicket.create({ data: { tenantId: tId, createdById: uId, problem: "B", description: "d", status: "OPEN", attachments: [] } });
    const tC = await db.feedbackTicket.create({ data: { tenantId: tId, createdById: uId, problem: "C", description: "d", status: "RESOLVED", resolvedAt: new Date(), attachments: ["https://c.example.com/1"] } });

    const ctx = { scope: "portal", tenantId: tId, actor: { id: "owner-x", role: "OWNER" } } as any;
    const rows = await listFeedbackExportRows(ctx);
    const rowsA = rows.filter((r: any) => r.ticketId === tA.id);
    const rowsB = rows.filter((r: any) => r.ticketId === tB.id);
    const rowsC = rows.filter((r: any) => r.ticketId === tC.id);

    console.log("(1) 2-link, 2-reply ticket -> 2 rows, both carrying both links:");
    check(rowsA.length === 2, `2 rows (got ${rowsA.length})`);
    check(rowsA.every((r: any) => eq(r.attachments, linksA)), "both rows carry [link1, link2] (repeated across replies)");

    console.log("(2) 0-link, 0-reply ticket -> 1 row, empty attachments:");
    check(rowsB.length === 1, `1 row (got ${rowsB.length})`);
    check(rowsB[0] && eq(rowsB[0].attachments, []), "attachments is an empty array");

    console.log("(3) 1-link, 0-reply ticket -> 1 row with that link:");
    check(rowsC.length === 1 && eq(rowsC[0].attachments, ["https://c.example.com/1"]), "single-link row correct");

    console.log("(4) max link count across rows = 2 (drives the # of Attachment columns):");
    let maxAtt = 0;
    for (const r of rows) { const n = (r.attachments && r.attachments.length) || 0; if (n > maxAtt) maxAtt = n; }
    check(maxAtt === 2, `max attachments = ${maxAtt} (expected 2 -> 'Attachment 1' + 'Attachment 2')`);
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T } }); } catch {}
  }

  console.log("\n================================================");
  console.log("Proves attachments ride along on export rows; column count = max links (client-side padding verified manually).");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
