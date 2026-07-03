// Stage 3c self-test — proves the stale-candidate mechanics without manual clicking.
//
//   npx tsx src/db/selfTest_stage3c.ts
//
// HOW IT AVOIDS POLLUTING YOUR DATA: it creates two clearly-named TEMPORARY
// tenants ("__SELFTEST_3C_A__" / "__SELFTEST_3C_B__"), seeds candidate links +
// StageHistory at controlled ages inside them, runs the REAL detection/sweep
// functions scoped to those temp tenants, asserts, then DELETES the temp tenants.
// Every table created (contacts, records, links, history, runs, activity) has an
// onDelete: Cascade path back to Tenant, so deleting the tenant removes it all.
// It captures your real StageHistory + tenant counts before and after and fails
// loudly if either changed.
//
// WHAT IT PROVES: the time-in-stage math, clock-reset on a newer move, stage
// scoping, the send-gate (block without ack / proceed with it), the zero-match
// neutral outcome, and tenant isolation — all via the same code the scheduler
// runs. WHAT IT DOES NOT PROVE: the builder UI wiring, or that a real (non-mock)
// email is delivered (comms are mocked). Those are the few manual clicks.

import { prisma, disconnectDb } from "./client";
import { findStalledLinks, runStalledSweep } from "../automation/scheduler";

const db = prisma as any;
const A_NAME = "__SELFTEST_3C_A__";
const B_NAME = "__SELFTEST_3C_B__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`); failures.push(label); }
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

async function makeTenant(name: string): Promise<string> {
  const t = await db.tenant.create({ data: { billingStatus: "trial", name, notifyEmail: "selftest@example.invalid" } });
  const rt = await db.recordType.create({ data: { tenantId: t.id, key: "job", label: "Job" } });
  const rec = await db.record.create({ data: { tenantId: t.id, recordTypeId: rt.id, title: "Test Job" } });
  // stash the record id on the tenant object we return via a map
  recordByTenant.set(t.id, rec.id);
  return t.id;
}
const recordByTenant = new Map<string, string>();

// Create a staged candidate link with a base history row N days old, and
// (optionally) a NEWER row to simulate a recent move that should reset the clock.
async function makeStalled(tenantId: string, name: string, stageKey: string, enteredDaysAgo: number, recentMoveDaysAgo?: number): Promise<string> {
  const recordId = recordByTenant.get(tenantId)!;
  const contact = await db.contact.create({ data: { tenantId, name } });
  const link = await db.recordLink.create({ data: { tenantId, recordId, parentType: "contact", parentId: contact.id, stageKey, customFields: {} } });
  await db.stageHistory.create({ data: { tenantId, recordLinkId: link.id, fromStage: null, toStage: stageKey, enteredAt: daysAgo(enteredDaysAgo), source: "move" } });
  if (recentMoveDaysAgo != null) {
    await db.stageHistory.create({ data: { tenantId, recordLinkId: link.id, fromStage: stageKey, toStage: stageKey, enteredAt: daysAgo(recentMoveDaysAgo), source: "move" } });
  }
  return link.id;
}

async function newestRun(automationId: string) {
  return db.automationRun.findFirst({ where: { automationId }, orderBy: { createdAt: "desc" } });
}

async function main() {
  console.log("Stage 3c self-test\n==================");

  // Baseline of REAL data (must be untouched at the end).
  const realHistoryBefore = await db.stageHistory.count();
  const realTenantsBefore = await db.tenant.count();
  console.log(`Real StageHistory rows before: ${realHistoryBefore}; real tenants before: ${realTenantsBefore}\n`);

  let aId = "", bId = "";
  try {
    aId = await makeTenant(A_NAME);
    bId = await makeTenant(B_NAME);

    // --- Tenant A: a controlled set, N=7 ---
    const oldLink   = await makeStalled(aId, "Old Olivia",   "applied",      30);          // stalled
    const freshLink = await makeStalled(aId, "Fresh Fred",   "applied",      2);           // too fresh
    const movedLink = await makeStalled(aId, "Moved Mona",   "applied",      30, 1);        // moved 1d ago -> reset
    const phoneLink = await makeStalled(aId, "Phone Phoebe", "phone_screen", 30);          // stalled, different stage
    // --- Tenant B: one stalled candidate (also serves the isolation check) ---
    const bLink     = await makeStalled(bId, "Bravo Bianca", "applied",      30);

    // ---------- T1: basic detection (unscoped, N=7) ----------
    console.log("T1 — finds only links older than N days:");
    const t1 = await findStalledLinks(aId, 7);
    const t1ids = new Set(t1.map((m) => m.linkId));
    check(t1ids.has(oldLink),   "old (30d) is matched");
    check(t1ids.has(phoneLink), "phone (30d) is matched");
    check(!t1ids.has(freshLink), "fresh (2d) is NOT matched");
    check(t1.length === 2, `exactly 2 matched (got ${t1.length})`);
    const oldMatch = t1.find((m) => m.linkId === oldLink);
    check(!!oldMatch && oldMatch.daysInStage >= 29, `days_in_stage computed (~30, got ${oldMatch ? oldMatch.daysInStage : "n/a"})`);

    // ---------- T2: clock reset on a newer move ----------
    console.log("T2 — a recently-moved candidate is excluded (clock reset):");
    check(!t1ids.has(movedLink), "moved (newer row 1d ago) is NOT matched");

    // ---------- T3: stage-scoped trigger ----------
    console.log("T3 — stage scope matches only the chosen stage:");
    const t3 = await findStalledLinks(aId, 7, "phone_screen");
    const t3ids = new Set(t3.map((m) => m.linkId));
    check(t3ids.has(phoneLink), "phone_screen link matched when scoped to phone_screen");
    check(!t3ids.has(oldLink), "applied-stage link NOT matched when scoped to phone_screen");
    check(t3.length === 1, `exactly 1 matched in scope (got ${t3.length})`);

    // ---------- T6: tenant isolation ----------
    console.log("T6 — the sweep never crosses portals:");
    check(!t1ids.has(bLink), "tenant B's stalled link is absent from tenant A's results");
    const tb = await findStalledLinks(bId, 7);
    check(new Set(tb.map((m) => m.linkId)).has(bLink), "tenant B's link IS found when scoped to B");
    check(!new Set(tb.map((m) => m.linkId)).has(oldLink), "tenant A's link is absent from tenant B's results");

    // ---------- T4: send-gate (block without ack, proceed with it) ----------
    console.log("T4 — send-gate blocks bulk messaging without ack, proceeds with it:");
    // Push tenant B over the threshold (it already has 1 stalled; add 26 more = 27 > 25).
    for (let i = 0; i < 26; i++) await makeStalled(bId, `Bulk ${i}`, "applied", 30);
    const emailAuto = await db.automation.create({
      data: { tenantId: bId, name: "Stalled bulk email", enabled: true, triggerType: "Stalled:7",
        conditions: [], actions: [{ type: "send_email", config: { subject: "Hi {{name}}", html: "You have been in {{current_stage}} for {{days_in_stage}} days." } }] },
    });
    await runStalledSweep(bId);
    const blockedRun = await newestRun(emailAuto.id);
    check(!!blockedRun && blockedRun.status === "failed", `over-threshold messaging run is FAILED (got ${blockedRun ? blockedRun.status : "no run"})`);
    const blockedText = JSON.stringify(blockedRun ? blockedRun.results : "");
    check(/bulk send not allowed/i.test(blockedText), "blocked run explains the bulk gate + count");

    // Now grant the ack and re-run -> should proceed (success).
    await db.automation.update({ where: { id: emailAuto.id }, data: { actions: [{ type: "send_email", config: { subject: "Hi {{name}}", html: "...", allowBulk: true } }] } });
    await runStalledSweep(bId);
    const okRun = await newestRun(emailAuto.id);
    check(!!okRun && okRun.id !== (blockedRun ? blockedRun.id : "") && okRun.status === "success", `with ack, messaging run is SUCCESS (got ${okRun ? okRun.status : "no run"})`);

    // ---------- T5: zero-match neutral outcome ----------
    console.log("T5 — zero matches logs a neutral 'skipped', never a fake green:");
    const zeroAuto = await db.automation.create({
      data: { tenantId: aId, name: "Stalled never", enabled: true, triggerType: "Stalled:9999",
        conditions: [], actions: [{ type: "create_note", config: { text: "x" } }] },
    });
    await runStalledSweep(aId);
    const zeroRun = await newestRun(zeroAuto.id);
    check(!!zeroRun && zeroRun.status === "skipped", `zero-match run status is 'skipped' (got ${zeroRun ? zeroRun.status : "no run"})`);
    check(!!zeroRun && zeroRun.matched === false, "zero-match run is flagged matched=false");
    check(/no stalled candidates/i.test(JSON.stringify(zeroRun ? zeroRun.results : "")), "zero-match run says 'No stalled candidates'");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR during test:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    // ---------- Cleanup: delete temp tenants (cascades to everything) ----------
    console.log("\nCleaning up temporary tenants…");
    for (const id of [aId, bId]) if (id) { try { await db.tenant.delete({ where: { id } }); } catch (e) { console.error("cleanup failed for", id, e); failures.push("cleanup failed"); } }
    // Belt-and-suspenders: remove any stragglers by marker name.
    try { await db.tenant.deleteMany({ where: { name: { in: [A_NAME, B_NAME] } } }); } catch {}
  }

  // ---------- Prove real data is untouched ----------
  console.log("\nVerifying real data is untouched:");
  const realHistoryAfter = await db.stageHistory.count();
  const realTenantsAfter = await db.tenant.count();
  check(realHistoryAfter === realHistoryBefore, `real StageHistory rows unchanged (${realHistoryBefore} -> ${realHistoryAfter})`);
  check(realTenantsAfter === realTenantsBefore, `real tenant count unchanged (${realTenantsBefore} -> ${realTenantsAfter})`);

  console.log("\n==================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
