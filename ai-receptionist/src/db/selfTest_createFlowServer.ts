// DB-backed self-test (runs in Codespace) for the Create-a-Tenant overhaul behavior:
// optional notify email at creation, requireEmail hard-set ON for manual/import, and
// the phone-call path staying exempt (emailless contacts still capture).
//   npx tsx src/db/selfTest_createFlowServer.ts
import { prisma, disconnectDb } from "./client";
import { createPortal } from "../services/portalService";
import { createContact, importContacts, createOrUpdateContact } from "../services/contactService";

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function threwAsync(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }

async function main() {
  console.log("Create-a-Tenant server behavior");
  console.log("===============================");
  const NAME = "AtomicCo_" + Date.now();
  let tId = "";
  try {
    // (1) optional notify email — create with NAME only.
    const before = await db.tenant.count();
    const t = await createPortal({ name: NAME, billingStatus: "trial" });
    tId = t.id;
    const after = await db.tenant.count();
    check(!!t.id && after === before + 1, "createPortal with name only creates exactly one tenant");
    check((t as any).notifyEmail === "", "notify email is optional (stored empty when omitted)");

    // (2) requireEmail hard-set ON for MANUAL create.
    check(await threwAsync(() => createContact(tId, { name: "No Email", phone: "15551230001" })), "manual create WITHOUT email is rejected (requireEmail on)");
    const withEmail = await createContact(tId, { name: "Has Email", phone: "15551230002", email: "has@example.com" });
    check(!!withEmail.id, "manual create WITH email succeeds");

    // (3) IMPORT skips email-less rows.
    const imp = await importContacts(tId, [
      { phone: "15551230003" },                                  // no email -> skipped
      { phone: "15551230004", email: "row@example.com" },        // ok
    ]);
    check(imp.imported === 1 && imp.skipped === 1, "import skips the email-less row, keeps the one with email");

    // (4) PHONE-CALL path is EXEMPT — emailless contact still captured.
    const called = await createOrUpdateContact({ tenantId: tId, phone: "15551230005", source: "phone" });
    check(!!called.id && !called.email, "phone-call contact saves with no email (exempt from the rule)");
  } finally {
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch { /* cascade cleanup */ } }
  }

  console.log("\n===============================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
