// Real-Prisma self-test for Batch C — Data Backup (blanket portal export).
//
//   npx tsx src/db/selfTest_dataBackup.ts     (needs dev Postgres)
//
// The backup file is assembled CLIENT-side (Excel/zip), so this test covers the
// parts that run through Prisma: the real READ PATHS that feed the backup, the
// credential EXCLUSION, the no-download history log, and the Feedback gate.
//
// Asserts:
//   (1) Each data type's real read path returns real rows (listContacts, listCalls,
//       listEvents, listResources, listUsers, listAutomations).
//   (2) NEGATIVE: a backup payload assembled from those paths contains NO
//       credentials — no password hash, no OAuth tokens, no passwordHash/token keys —
//       even with a seeded GoogleConnection token + a user password hash present.
//   (3) A backup run records a history entry that is NOT downloadable (no download
//       button), labelled "Full backup".
//   (4) A non-admit role's backup omits Feedback (admin-tier gate).
//
// SAFETY: one TEMPORARY tenant + user + connection + sample rows, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { listContacts, listCalls } from "../services/readModels";
import { listEvents, listAutomations } from "../services/automationService";
import { listResources } from "../services/resourceService";
import { listUsers } from "../services/userService";
import { listFeedbackExportRows } from "../services/feedbackService";
import { createBackupRecord, listExports } from "../services/exportService";

const db = prisma as any;
const T_NAME = "__SELFTEST_DATA_BACKUP__";
const PW_HASH = "HASHED_PW_SECRET_do_not_export";
const OAUTH_TOKEN = "OAUTH_TOKEN_SECRET_do_not_export";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// ---- mirrors of portal.js (kept tiny + in sync) ----
const isAdminTier = (role: string) => role === "OWNER" || role === "SUPER_ADMIN" || role === "AUDITOR";
// Mirror of gatherBackupSections' section list (labels), for the gate assertion.
function backupSectionLabels(o: { isAdmin: boolean; includeAuto: boolean; includeTeam: boolean; recordTypeLabels: string[] }) {
  const labels = ["Contacts"].concat(o.recordTypeLabels).concat(["Calls", "Events"]);
  if (o.isAdmin) labels.push("Feedback");
  labels.push("Resources");
  if (o.includeAuto) labels.push("Automations");
  if (o.includeTeam) labels.push("Team");
  return labels;
}
const backupWhat = (r: any) => (r.kind === "backup" ? "Full backup" : "(other)");

async function main() {
  console.log("Batch C — Data Backup (real read paths / no credentials / no-download)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "", uId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "backup@example.invalid" } })).id;
    uId = (await db.user.create({ data: { email: `backup_${Date.now()}@example.invalid`, passwordHash: PW_HASH, name: "Casey Owner", role: "OWNER", tenantId: tId } })).id;
    // Seed credential-bearing + ordinary data so exclusion is a real (not vacuous) test.
    await db.googleConnection.create({ data: { tenantId: tId, accountEmail: "g@example.invalid", accessTokenEnc: OAUTH_TOKEN, refreshTokenEnc: OAUTH_TOKEN } });
    await db.contact.create({ data: { tenantId: tId, name: "Pat Sample", phone: "+15550100" } });
    await db.resource.create({ data: { tenantId: tId, name: "Chair 1" } });

    console.log("(1) Real read paths return rows:");
    const contacts = await listContacts(tId);
    const calls = await listCalls(tId);
    const events = await listEvents(tId);
    const resources = await listResources(tId);
    const users = await listUsers(tId) as any[];
    const autos = await listAutomations(tId);
    check(Array.isArray(contacts) && contacts.length >= 1, `contacts read path returns rows (${contacts.length})`);
    check(Array.isArray(calls), "calls read path returns an array");
    check(Array.isArray(events), "events read path returns an array");
    check(Array.isArray(resources) && resources.length >= 1, `resources read path returns rows (${resources.length})`);
    check(Array.isArray(users) && users.some((u) => u.id === uId), "users read path returns the team");
    check(Array.isArray(autos), "automations read path returns an array");

    console.log("\n(2) NEGATIVE — no credentials in the assembled backup payload:");
    // The Team sheet outputs ONLY name/email/role (backupUserColumns); mirror that.
    const usersSafe = users.map((u) => ({ name: u.name, email: u.email, role: u.role }));
    const feedbackRows = await listFeedbackExportRows({ scope: "portal", tenantId: tId, actor: { id: uId, role: "OWNER" } as any });
    const payload = { contacts, calls, events, resources, automations: autos, feedback: feedbackRows, team: usersSafe };
    const blob = JSON.stringify(payload);
    check(blob.indexOf(PW_HASH) === -1, "password hash is NOT in the backup payload");
    check(blob.indexOf(OAUTH_TOKEN) === -1, "OAuth tokens are NOT in the backup payload");
    check(blob.indexOf("passwordHash") === -1, 'no "passwordHash" key anywhere in the payload');
    check(blob.indexOf("accessTokenEnc") === -1 && blob.indexOf("refreshTokenEnc") === -1, "no Google token fields in the payload");
    check(users.every((u) => !("passwordHash" in u)), "the users read path itself strips passwordHash (publicUser)");

    console.log("\n(3) A backup run logs a NON-downloadable history entry:");
    const rec = await createBackupRecord({ tenantId: tId, name: "Data backup 2026-06-24", rowCount: 7, createdById: uId });
    check(rec.kind === "backup", "backup record stored with kind=backup");
    const hist = await listExports(tId);
    const bRow = hist.find((r: any) => r.id === rec.id) as any;
    check(!!bRow, "backup shows up in history");
    check(!!bRow && bRow.downloadable === false, "backup history row is NOT downloadable (no download button)");
    check(!!bRow && backupWhat(bRow) === "Full backup", "backup history row labels as \"Full backup\"");
    check(!!bRow && bRow.createdByName === "Casey Owner", "backup User column resolves the runner's name");

    console.log("\n(4) Feedback is gated by admin tier:");
    const rtLabels = ["Jobs", "Bookings"];
    const adminLabels = backupSectionLabels({ isAdmin: isAdminTier("OWNER"), includeAuto: true, includeTeam: true, recordTypeLabels: rtLabels });
    const clientLabels = backupSectionLabels({ isAdmin: isAdminTier("CLIENT_USER"), includeAuto: true, includeTeam: true, recordTypeLabels: rtLabels });
    check(adminLabels.indexOf("Feedback") !== -1, "Feedback IS included for an OWNER backup");
    check(clientLabels.indexOf("Feedback") === -1, "NEGATIVE: Feedback omitted from a CLIENT_USER backup");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try {
      if (tId) await db.googleConnection.deleteMany({ where: { tenantId: tId } });
      if (tId) await db.contact.deleteMany({ where: { tenantId: tId } });
      if (tId) await db.resource.deleteMany({ where: { tenantId: tId } });
      if (uId) await db.user.deleteMany({ where: { id: uId } });
      if (tId) await db.tenant.deleteMany({ where: { name: T_NAME } });
    } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }

  const after = await db.tenant.count();
  check(after === before, `real tenants unchanged (${before} -> ${after})`);

  console.log("\n=====================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }

  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
