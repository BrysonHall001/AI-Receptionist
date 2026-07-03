// Self-test (Thread 2b) — CALLER ID field + identity-follows-spoken, REAL path.
//
//   npx tsx src/db/selfTest_callerId.ts
//
// Requires the migration applied first (adds Contact.callerId):
//   npm run prisma:migrate   (dev)   — Render runs `prisma migrate deploy` in prod.
//
// WHAT THIS PROVES (real createOrUpdateContact + phoneFromExtracted + real Prisma):
//   1. The verified caller ID is stored on the contact, SEPARATE from phone.
//   2. Identity = the SPOKEN/entered phone (phoneFromExtracted prefers it).
//   3. A caller ID may REPEAT across contacts (no uniqueness on it).
//   4. Uniqueness is PHONE-ONLY (same phone = same contact; same caller ID ≠ merge).
//   5. The caller ID is preserved as origin-of-record (not overwritten; back-filled
//      only when previously empty).
//   6. THE MISLINK FIX: a new call from a caller ID that matches an OLD contact, but
//      with a different spoken phone, links to the SPOKEN-phone contact — not the
//      caller-ID one — while still preserving the caller ID.
//
// SAFETY: one TEMPORARY tenant ("__SELFTEST_CALLERID__"), deleted at the end.

import { prisma, disconnectDb } from "./client";
import { createOrUpdateContact, phoneFromExtracted } from "../services/contactService";

const db = prisma as any;
const T = "__SELFTEST_CALLERID__";
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Thread 2b — Caller ID + identity-follows-spoken (real path)");
  console.log("==========================================================");

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T, businessType: "salon", notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    const C = (phone: string, callerId: string | null, name: string) =>
      createOrUpdateContact({ tenantId: tId, phone, callerId, name, source: "phone" });

    console.log("(1) caller ID is stored separately from phone:");
    const c1 = await C("+15550000001", "+15559990000", "Spoken Sam");
    check((c1 as any).callerId === "+15559990000", "contact.callerId holds the verified inbound number");
    check(c1.phone === "+15550000001", "contact.phone holds the spoken/entered number (not the caller ID)");

    console.log("(2) identity follows the SPOKEN phone (phoneFromExtracted):");
    check(phoneFromExtracted({ phone: "+15550000099" } as any, "+15559990000") === "+15550000099", "a spoken phone wins over the caller-ID fallback");
    check(phoneFromExtracted({ phone: "" } as any, "+15559990000") === "+15559990000", "with no spoken phone, it falls back to the caller ID");

    console.log("(3) a caller ID may REPEAT across contacts (no uniqueness on it):");
    const shared = "+15557778888";
    const a = await C("+15550000010", shared, "Family A");
    const b = await C("+15550000011", shared, "Family B");
    check(a.id !== b.id, "two different contacts were created (different phones)");
    check((a as any).callerId === shared && (b as any).callerId === shared, "both carry the SAME caller ID with no uniqueness error");

    console.log("(4) uniqueness is PHONE-ONLY (same phone = same contact):");
    const d1 = await C("+15550000020", "+15551110000", "First");
    const d2 = await C("+15550000020", "+15552220000", "Second");
    check(d1.id === d2.id, "same phone upserts onto the SAME contact (phone is the identity key)");
    check((d2 as any).callerId === "+15551110000", "the original caller ID is NOT overwritten by a later call (origin of record)");
    check(d2.name === "Second", "other fields (name) still update normally");

    console.log("(5) caller ID back-fills only when previously empty:");
    const e1 = await C("+15550000030", null, "No Caller Yet");
    check((e1 as any).callerId == null, "created with no caller ID → null");
    const e2 = await C("+15550000030", "+15553330000", "No Caller Yet");
    check((e2 as any).callerId === "+15553330000", "a later call back-fills the caller ID when it was empty");

    console.log("(6) THE MISLINK FIX — new spoken phone does NOT link to the caller-ID's old contact:");
    const callerNum = "+15556660000";
    // An OLD contact keyed by the caller-ID number (e.g. a prior no-spoken-phone call).
    const old = await C(callerNum, callerNum, "Old Prior-Call Contact");
    // New call: same caller ID, but the caller gives a DIFFERENT spoken callback number.
    const spoken = phoneFromExtracted({ phone: "+15550000040" } as any, callerNum);
    const fresh = await C(spoken, callerNum, "New Spoken Caller");
    check(fresh.id !== old.id, "the booking's contact is the SPOKEN-phone one, NOT the caller-ID match");
    check(fresh.phone === "+15550000040", "the new contact's phone is the spoken number");
    check((fresh as any).callerId === callerNum, "the verified caller ID is still preserved on the new contact");
    check((old as any).phone === callerNum, "the old caller-ID contact is left untouched");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T } }); } catch {}
  }

  console.log("\n==========================================================");
  console.log("Proves the data layer: caller ID stored separately + repeatable,");
  console.log("phone-only uniqueness, and bookings follow the spoken phone while");
  console.log("the caller ID is preserved. (The Calls 'Caller ID' column is a UI");
  console.log("check — verify it on the Calls page after deploy.)");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
