// Real-Prisma self-test for the three capture bugfixes.
//   npx tsx src/db/selfTest_captureBugfixes.ts   (needs dev Postgres)
//
// Clean test data: a tenant with Bob + Alice on default hours (Mon–Fri 09–17).
// PROVES:
//   1a  a provided/announced resource name is what gets booked (safety net does
//       NOT override it); the safety net fires ONLY when resource is null
//   1b  two captures for the SAME contact + SAME wall-clock time create ONE
//       booking (the second is skipped and returns the same id); a DIFFERENT
//       contact at that time is unaffected
//   2   phone mapping: a spoken number lands in contact.phone with callerId kept
//       distinct; an empty spoken number falls back to caller ID for identity only

import { prisma, disconnectDb } from "./client";
import { ensureBookingRecordType } from "../services/recordTypeService";
import { createBookingFromCall } from "../services/bookingCaptureService";
import { createOrUpdateContact, phoneFromExtracted } from "../services/contactService";

const db = prisma as any;
const T_NAME = "__SELFTEST_CAPTURE_BUGFIX__";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const pad = (n: number) => String(n).padStart(2, "0");
function futureWeekday(): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const DATE = futureWeekday();

async function main() {
  console.log("Capture bugfixes (1a resource-recorded / 1b idempotency / 2 phone) — real-Prisma self-test");
  console.log("=========================================================================================\n");
  console.log(`(test date: ${DATE})\n`);
  const before = await db.tenant.count();
  let tId = "", bob = "", alice = "", rtId = "";
  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "cb@example.invalid", timezone: "America/New_York" } })).id;
    bob = (await db.resource.create({ data: { tenantId: tId, name: "Bob" } })).id;   // first in list
    alice = (await db.resource.create({ data: { tenantId: tId, name: "Alice" } })).id;
    await ensureBookingRecordType(tId);
    rtId = (await db.recordType.findFirst({ where: { tenantId: tId, key: "booking" } })).id;

    // (1a) the announced/named resource is what gets booked — NOT first-in-list.
    console.log("(1a) provided resource name is booked; safety net does not override:");
    const cA = await db.contact.create({ data: { tenantId: tId, name: "Caller A", phone: "+15555550010" } });
    const idAlice = await createBookingFromCall({ tenantId: tId, contactId: cA.id, appointmentDatetime: `${DATE}T14:00`, service: "consultation", resource: "Alice" });
    const rAlice = idAlice ? await db.record.findUnique({ where: { id: idAlice } }) : null;
    check(!!rAlice && rAlice.resourceId === alice, `"Alice" announced -> booked on Alice, not first-in-list Bob (got ${rAlice?.resourceId === alice ? "Alice" : rAlice?.resourceId === bob ? "Bob" : rAlice?.resourceId})`);
    const idBob = await createBookingFromCall({ tenantId: tId, contactId: cA.id, appointmentDatetime: `${DATE}T14:30`, service: "consultation", resource: "Bob" });
    const rBob = idBob ? await db.record.findUnique({ where: { id: idBob } }) : null;
    check(!!rBob && rBob.resourceId === bob, "\"Bob\" announced -> booked on Bob");
    // safety net fires ONLY when resource is null -> lands on a named resource (not null).
    const idNull = await createBookingFromCall({ tenantId: tId, contactId: cA.id, appointmentDatetime: `${DATE}T15:00`, service: "consultation", resource: null });
    const rNull = idNull ? await db.record.findUnique({ where: { id: idNull } }) : null;
    check(!!rNull && (rNull.resourceId === bob || rNull.resourceId === alice), `null resource -> safety net assigns a named resource (got ${rNull?.resourceId})`);

    // (1b) idempotency: same contact + same time twice -> ONE booking.
    console.log("\n(1b) duplicate guard: same contact + same time -> one booking:");
    const cB = await db.contact.create({ data: { tenantId: tId, name: "Caller B", phone: "+15555550011" } });
    const first = await createBookingFromCall({ tenantId: tId, contactId: cB.id, appointmentDatetime: `${DATE}T16:00`, service: "consultation", resource: "Bob" });
    const second = await createBookingFromCall({ tenantId: tId, contactId: cB.id, appointmentDatetime: `${DATE}T16:00`, service: "consultation", resource: "Bob" });
    check(!!first && second === first, `second capture returns the SAME booking id (no new record) (first=${first}, second=${second})`);
    const linkedB = await db.record.findMany({ where: { tenantId: tId, recordTypeId: rtId, deletedAt: null, links: { some: { parentType: "contact", parentId: cB.id } } } });
    check(linkedB.length === 1, `exactly ONE booking for that contact+time (got ${linkedB.length})`);
    // a DIFFERENT contact at the same time still books (dedup is per-contact).
    const cC = await db.contact.create({ data: { tenantId: tId, name: "Caller C", phone: "+15555550012" } });
    const other = await createBookingFromCall({ tenantId: tId, contactId: cC.id, appointmentDatetime: `${DATE}T16:00`, service: "consultation", resource: "Alice" });
    check(!!other && other !== first, "a different contact at the same time still books (separate record)");

    // (2) phone mapping.
    console.log("\n(2) phone = spoken number, callerId = inbound (distinct); fallback only when no number:");
    check(phoneFromExtracted({ phone: "1123456789" } as any, "+19197449871") === "1123456789", "spoken number wins over caller ID");
    check(phoneFromExtracted({ phone: null } as any, "+19197449871") === "+19197449871", "no spoken number -> falls back to caller ID (identity)");
    check(phoneFromExtracted({ phone: "" } as any, "+19197449871") === "+19197449871", "empty spoken number -> falls back to caller ID");
    const contact = await createOrUpdateContact({ tenantId: tId, phone: "1123456789", name: "Spoken Caller", callerId: "+19197449871", source: "phone" });
    check(contact.phone === "1123456789", `contact.phone holds the SPOKEN number (got ${contact.phone})`);
    check((contact as any).callerId === "+19197449871", `callerId holds the inbound number, not crossed (got ${(contact as any).callerId})`);
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e); failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
  }
  const after = await db.tenant.count();
  check(after === before, `tenants unchanged (${before} -> ${after})`);
  console.log("\n=========================================================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274C`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
