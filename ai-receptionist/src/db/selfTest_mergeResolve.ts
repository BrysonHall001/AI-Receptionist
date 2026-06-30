// Batch self-test (DB-backed → Codespace) — runtime merge-tag resolution: a value
// resolves to the contact's real data; a missing value uses the fallback (never a raw
// token); typed/no-contact uses fallback; subject resolves the same way.
//
//   npx tsx src/db/selfTest_mergeResolve.ts
//
// SAFETY: one TEMPORARY tenant + two contacts, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { resolveMergeTags, hasMergeTags, contactMergeValues, contactMergeResolver } from "../services/mergeTags";
import { loadFieldDefs } from "../automation/contactRow";

const db = prisma as any;
const T_NAME = "__SELFTEST_MERGE__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Merge-tag resolution (runtime)");
  console.log("==============================");
  let tId: string | null = null;
  try {
    // ---- pure resolver ----
    console.log("(1) resolver:");
    check(resolveMergeTags("Hi {{first_name}}!", { first_name: "Ada" }) === "Hi Ada!", "value resolves");
    check(resolveMergeTags("Hi {{first_name|there}}!", {}) === "Hi there!", "fallback used when empty (no 'Hi ,' artifact)");
    const bare = resolveMergeTags("X{{first_name}}Y", {});
    check(bare === "XY" && bare.indexOf("{{") === -1, "empty + no fallback collapses cleanly (no raw token)");
    check(resolveMergeTags("{{email|none}}", { email: "" }) === "none", "blank value falls back too");
    check(hasMergeTags("a {{x}} b") && !hasMergeTags("no tags"), "hasMergeTags detects tags");

    // ---- contact value map ----
    console.log("\n(2) contact values:");
    const vals = contactMergeValues({ name: "Ada Lovelace", email: "ada@x.com", phone: "555" }, []);
    check(vals.first_name === "Ada", "first_name derived");
    check(vals.last_name === "Lovelace", "last_name derived");
    check(vals.name === "Ada Lovelace" && vals.email === "ada@x.com", "system fields present");

    // ---- end-to-end against real contacts + the per-tenant resolver ----
    console.log("\n(3) per-recipient (DB):");
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "m@example.invalid" } })).id;
    const tenantId: string = tId!;
    const withName = await db.contact.create({ data: { tenantId, name: "Grace Hopper", email: "grace@example.invalid" } });
    const noName = await db.contact.create({ data: { tenantId, name: "", email: "anon@example.invalid" } });
    const resolver = await contactMergeResolver(tenantId);
    check(resolver.apply("Hi {{first_name|there}}!", withName) === "Hi Grace!", "resolves to the contact's real first name");
    check(resolver.apply("Hi {{first_name|there}}!", noName) === "Hi there!", "missing value uses the fallback");
    check(resolver.apply("Hi {{first_name|there}}!", null) === "Hi there!", "typed/no-contact uses the fallback");
    // subject resolves with the same function
    check(resolver.apply("A note for {{first_name|friend}}", withName) === "A note for Grace", "subject resolves per recipient");
    // never a raw token for any of these
    const outputs = [resolver.apply("{{first_name}} {{email}}", withName), resolver.apply("{{first_name}}", null)];
    check(outputs.every((o) => o.indexOf("{{") === -1), "no raw {{token}} ever leaks");

    // field defs load (the picker's source) is reachable
    const defs = await loadFieldDefs(tenantId);
    check(Array.isArray(defs), "contact field defs load for the picker source");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    if (tId) {
      try { await db.contact.deleteMany({ where: { tenantId: tId } }); } catch {}
      try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n==============================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (merge resolution)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
