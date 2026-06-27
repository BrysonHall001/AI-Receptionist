// Batch self-test — Template Library tags: tag round-trips, edit changes it, clearing
// nulls it, library filter-by-tag returns the right subset, and the upsert still updates
// in place (no duplicates).
//
//   npx tsx src/db/selfTest_templateTags.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { createTemplate, updateTemplate, listTemplates } from "../services/templateService";

const db = prisma as any;
const T_NAME = "__SELFTEST_TEMPLATE_TAGS__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Template Library — tags + upsert");
  console.log("================================");

  let tId: string | null = null;
  try {
    const tenant = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const u1 = await db.user.create({ data: { tenantId, email: `tpl_${Date.now()}@example.invalid`, name: "Owner", role: "OWNER", passwordHash: "x" } });

    // ---------- (1) tag round-trips on create + reload ----------
    console.log("(1) tag round-trip:");
    const a = await createTemplate({ tenantId, name: "Welcome", kind: "email", subject: "Hi", body: "<p>x</p>", tag: "Onboarding", createdById: u1.id });
    check(a.tag === "Onboarding", "create returns the tag");
    let listed = await listTemplates(tenantId, "email");
    check(!!listed.find((t: any) => t.id === a.id && t.tag === "Onboarding"), "tag persists on reload (listTemplates)");

    const noTag = await createTemplate({ tenantId, name: "Plain", kind: "email", subject: "", body: "", createdById: u1.id });
    check(noTag.tag === null, "a template saved without a tag is null (composer save path)");

    // ---------- (2) editing changes the tag; clearing nulls it ----------
    console.log("\n(2) edit + clear:");
    const e1 = await updateTemplate(a.id, tenantId, { tag: "Promos" });
    check(!!e1 && e1.tag === "Promos", "editing changes the tag");
    const e2 = await updateTemplate(a.id, tenantId, { tag: null });
    check(!!e2 && e2.tag === null, "clearing the tag leaves it null");
    // not passing tag leaves it unchanged
    const e3 = await updateTemplate(a.id, tenantId, { name: "Welcome v2" });
    check(!!e3 && e3.tag === null && e3.name === "Welcome v2", "omitting tag on an edit leaves it untouched");

    // ---------- (3) library filter/search by tag (data supports it) ----------
    console.log("\n(3) filter by tag:");
    await createTemplate({ tenantId, name: "Newsletter Jan", kind: "email", subject: "", body: "", tag: "Newsletter", createdById: u1.id });
    await createTemplate({ tenantId, name: "Newsletter Feb", kind: "email", subject: "", body: "", tag: "Newsletter", createdById: u1.id });
    listed = await listTemplates(tenantId, "email");
    const byTag = listed.filter((t: any) => (t.tag || "").toLowerCase() === "newsletter");
    check(byTag.length === 2, "filtering the library by a tag returns exactly the tagged subset");
    check(listed.length === 4, "library lists ALL templates (none hidden)");

    // ---------- (4) upsert: edit updates in place, create makes new ----------
    console.log("\n(4) upsert (no duplicates):");
    const beforeCount = (await db.emailTemplate.count({ where: { tenantId } })) as number;
    await updateTemplate(a.id, tenantId, { name: "Welcome v3", tag: "Onboarding" });
    const afterCount = (await db.emailTemplate.count({ where: { tenantId } })) as number;
    check(beforeCount === afterCount, "editing a template does NOT create a duplicate row");
    const reloaded = (await listTemplates(tenantId, "email")).find((t: any) => t.id === a.id);
    check(!!reloaded && reloaded.name === "Welcome v3" && reloaded.tag === "Onboarding", "the edit updated the same row");

    // ---------- (5) static guards: client wiring ----------
    console.log("\n(5) client wiring (static):");
    const comm = readFileSync(resolve(__dirname, "../../public/js/communication.js"), "utf8");
    check(/Template Library/.test(comm), "list panel renamed to 'Template Library'");
    check(/tagInput/.test(comm) && /Tag \(optional\)/.test(comm), "create panel has the optional Tag field");
    check(/key: "tag"/.test(comm), "library table surfaces a Tag column (filter/search ready)");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try { await db.tenant.delete({ where: { id: tId } }); }
      catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (template tags)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
