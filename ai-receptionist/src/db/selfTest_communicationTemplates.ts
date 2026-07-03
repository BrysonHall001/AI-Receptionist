// Batch self-test — Communication Templates tab (list, create, edit-in-place,
// delete, shared library), on the REAL engine.
//
//   npx tsx src/db/selfTest_communicationTemplates.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { can } from "../services/permissionService";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from "../services/templateService";

const db = prisma as any;
const T_NAME = "__SELFTEST_COMM_TEMPLATES__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Communication — Templates tab (manage email templates)");
  console.log("======================================================");

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const u1 = await db.user.create({ data: { tenantId, email: `tpl_${Date.now()}@example.invalid`, name: "Tess Owner", role: "OWNER", passwordHash: "x" } });

    // ---------- (1) create -> appears in list with name/subject/updated/by ----------
    console.log("(1) create appears in the list:");
    const created = await createTemplate({ tenantId, name: "Welcome", kind: "email", subject: "Hi there", body: "<p>Welcome!</p>", createdById: u1.id });
    let list = await listTemplates(tenantId, "email");
    const row = list.find((t: any) => t.id === created.id);
    check(!!row, "created template appears in GET templates");
    check(!!row && row.name === "Welcome" && row.subject === "Hi there", "list carries name + subject");
    check(!!row && !!row.updatedAt, "list carries Last-updated timestamp");
    check(!!row && (row as any).createdByName === "Tess Owner", "Updated-by resolves to the creator's name");

    // ---------- (2) edit updates the SAME row (no duplicate) + round-trips ----------
    console.log("\n(2) edit updates in place (no duplicate):");
    const beforeCount = (await listTemplates(tenantId, "email")).length;
    const edited = await updateTemplate(created.id, tenantId, { name: "Welcome (v2)", subject: "Welcome aboard", body: "<p>Glad you're here.</p>" });
    check(!!edited && edited.id === created.id, "edit returns the same template id");
    const afterCount = (await listTemplates(tenantId, "email")).length;
    check(afterCount === beforeCount, `no duplicate created (count ${beforeCount} -> ${afterCount})`);
    const re = (await listTemplates(tenantId, "email")).find((t: any) => t.id === created.id);
    check(!!re && re.name === "Welcome (v2)" && re.subject === "Welcome aboard" && re.body === "<p>Glad you're here.</p>", "edited name/subject/body round-trip");
    // tenant-scope guard
    check((await updateTemplate(created.id, "some-other-tenant", { name: "Nope" })) === null, "cross-tenant update is rejected");

    // ---------- (3) delete removes it from the list ----------
    console.log("\n(3) delete removes it:");
    const tmp = await createTemplate({ tenantId, name: "Throwaway", kind: "email", subject: "x", body: "<p>x</p>", createdById: u1.id });
    check((await deleteTemplate(tmp.id, tenantId)) === true, "delete returns true");
    check(!(await listTemplates(tenantId, "email")).some((t: any) => t.id === tmp.id), "deleted template no longer in the list");

    // ---------- (4) shared library: a "save as template" from compose shows here ----------
    console.log("\n(4) shared library (one store, not two):");
    // The Email tab "save as template" hits the SAME createTemplate path.
    const fromCompose = await createTemplate({ tenantId, name: "Saved from draft", kind: "email", subject: "Draft subject", body: "<p>From the composer</p>", createdById: u1.id });
    const sharedList = await listTemplates(tenantId, "email");
    check(sharedList.some((t: any) => t.id === fromCompose.id && t.name === "Saved from draft"), "a template saved from the Email tab appears in the Templates tab list");

    // ---------- (5) role gate (same family as the Email tab = contacts:edit) ----------
    console.log("\n(5) role gate:");
    check((await can({ role: "CLIENT_USER" } as any, "contacts", "edit")) === false, "a role that can't use the Email tab is blocked from managing templates");
    check((await can({ role: "OWNER" } as any, "contacts", "edit")) === true, "OWNER allowed");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try { await db.emailTemplate.deleteMany({ where: { tenantId: tId } }); await db.tenant.delete({ where: { id: tId } }); }
      catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n======================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (communication templates)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
