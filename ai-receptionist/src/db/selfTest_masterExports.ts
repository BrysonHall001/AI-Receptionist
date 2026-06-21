// Self-test (master all-portals export, Batch 1) — REAL Prisma path.
//
//   npx tsx src/db/selfTest_masterExports.ts
//
// PART A proves the cross-portal gather (listAllFeedbackExportRows): rows come
// from MULTIPLE portals, each labelled with the correct Portal name, master-hub
// tickets labelled "Master hub", the one-row-per-reply expansion holds (incl. a
// reply-less ticket = one row), and a non-master caller gets nothing.
// PART B proves the master export HISTORY (tenant-less records): a master export
// saves with tenantId NULL + scope, lists via listMasterExports, downloads via
// getMasterExportCsv; a PORTAL export never leaks into the master list and is not
// downloadable through the master path (but still works through the portal path).
//
// SAFETY: two TEMPORARY tenants + temporary export rows, all removed at the end.

import { prisma, disconnectDb } from "./client";
import { listAllFeedbackExportRows } from "../services/feedbackService";
import { createExport, listMasterExports, getMasterExportCsv, getExportCsv } from "../services/exportService";

const db = prisma as any;
const PFX = "__SELFTEST_MEXP__";
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Master all-portals export — gather + history (real path)");
  console.log("========================================================");

  let aId = "", bId = "", uId = "";
  try {
    const A = await db.tenant.create({ data: { name: `${PFX} Portal A`, businessType: "salon", notifyEmail: "selftest@example.invalid" } });
    const B = await db.tenant.create({ data: { name: `${PFX} Portal B`, businessType: "salon", notifyEmail: "selftest@example.invalid" } });
    aId = A.id; bId = B.id;
    const u = await db.user.create({ data: { email: `mexp_${Date.now()}@example.invalid`, passwordHash: "x", role: "OWNER", tenantId: aId, name: "Owner Olivia" } });
    uId = u.id;

    // Portal A ticket with 2 replies; Portal B ticket with 0 replies; master-hub ticket with 1 reply.
    const tA = await db.feedbackTicket.create({ data: { tenantId: aId, createdById: uId, problem: "A-problem", description: "d", status: "OPEN" } });
    await db.feedbackMessage.create({ data: { ticketId: tA.id, authorId: uId, body: "a1", createdAt: new Date(Date.now() - 60000) } });
    await db.feedbackMessage.create({ data: { ticketId: tA.id, authorId: uId, body: "a2", createdAt: new Date() } });
    const tB = await db.feedbackTicket.create({ data: { tenantId: bId, createdById: uId, problem: "B-problem", description: "d", status: "RESOLVED", resolvedAt: new Date(), resolvedById: uId } });
    const tM = await db.feedbackTicket.create({ data: { tenantId: null, createdById: uId, problem: "M-problem", description: "d", status: "OPEN" } });
    await db.feedbackMessage.create({ data: { ticketId: tM.id, authorId: uId, body: "m1" } });

    console.log("\nPART A — all-portals gather");
    const owner = { id: uId, role: "OWNER" } as any;
    const all = await listAllFeedbackExportRows(owner);
    const rowsA = all.filter((r: any) => r.ticketId === tA.id);
    const rowsB = all.filter((r: any) => r.ticketId === tB.id);
    const rowsM = all.filter((r: any) => r.ticketId === tM.id);

    console.log("(1) rows come from all three sources, correctly labelled:");
    check(rowsA.length === 2, `Portal A ticket -> 2 rows (got ${rowsA.length})`);
    check(rowsA.every((r: any) => r.portal === `${PFX} Portal A`), "Portal A rows labelled with Portal A's name");
    check(rowsB.length === 1, `Portal B ticket -> 1 row (got ${rowsB.length})`);
    check(rowsB.every((r: any) => r.portal === `${PFX} Portal B`), "Portal B row labelled with Portal B's name");
    check(rowsM.length === 1 && rowsM[0].portal === "Master hub", "master-hub ticket labelled 'Master hub'");

    console.log("(2) expansion holds: reply-less Portal B row has blank reply fields:");
    check(rowsB[0] && rowsB[0].replyAuthor === null && rowsB[0].replyText === null, "reply-less row is blank, not dropped");
    check(rowsA[0].replyText === "a1" && rowsA[1].replyText === "a2", "Portal A reply rows in chronological order");

    console.log("(3) a NON-master caller gets nothing:");
    const notMaster = await listAllFeedbackExportRows({ id: uId, role: "PORTAL_ADMIN" } as any);
    check(notMaster.length === 0, "PORTAL_ADMIN -> 0 rows");

    console.log("\nPART B — master export history (tenant-less)");
    const recAll = await createExport({ tenantId: null, scope: "all", name: `${PFX} all-portals`, rowCount: 4, fields: ["Portal", "Problem"], csv: "Portal,Problem\nA,x", createdById: uId });
    const recPortal = await createExport({ tenantId: aId, scope: null, name: `${PFX} portal-A`, rowCount: 1, fields: ["Problem"], csv: "Problem\nx", createdById: uId });

    const masterList = await listMasterExports();
    console.log("(4) the all-portals export is saved with no portal + listed in the master log:");
    check(masterList.some((e: any) => e.id === recAll.id && e.scope === "all"), "all-portals export appears in master history with scope 'all'");
    console.log("(5) a PORTAL export does NOT leak into the master history:");
    check(!masterList.some((e: any) => e.id === recPortal.id), "portal export absent from master history");

    console.log("(6) download access is correctly scoped:");
    const dlAll = await getMasterExportCsv(recAll.id);
    check(!!dlAll && dlAll.csv.startsWith("Portal,Problem"), "master export downloadable via master path");
    const dlPortalViaMaster = await getMasterExportCsv(recPortal.id);
    check(dlPortalViaMaster === null, "portal export NOT downloadable via master path");
    const dlPortalViaPortal = await getExportCsv(recPortal.id, aId);
    check(!!dlPortalViaPortal && dlPortalViaPortal.csv.startsWith("Problem"), "portal export still downloadable via its portal path");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    try { await db.exportRecord.deleteMany({ where: { name: { startsWith: PFX } } }); } catch (e) { console.error("export cleanup failed", e); }
    for (const id of [aId, bId]) { if (id) { try { await db.tenant.delete({ where: { id } }); } catch (e) { console.error("tenant cleanup failed", e); failures.push("cleanup failed"); } } }
    try { await db.tenant.deleteMany({ where: { name: { startsWith: PFX } } }); } catch {}
  }

  console.log("\n========================================================");
  console.log("Proves cross-portal gather + Portal labels + tenant-less master export history.");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
