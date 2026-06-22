// READ-ONLY diagnostic for Issue 4 (booking name vs contact name divergence).
//
//   npx tsx src/db/diagnoseContactSplit.ts
//
// It ONLY READS — no inserts, updates, or deletes anywhere. It prints, per tenant
// that has bookings: each Booking record, the contact it's LINKED to (the name
// that shows ON the booking), and ALL contacts in that tenant (id, name, phone,
// source, created time). That lets us see whether the caller exists as TWO
// contact records under two different phone keys (the suspected cause) — e.g. one
// "Reed Frost" the booking links to, and a separate "Roger Smith" you viewed.
//
// SAFE TO RUN against the live DB: it is read-only. Nothing is written.

import { prisma, disconnectDb } from "./client";

const db = prisma as any;

function row(label: string, c: any) {
  if (!c) { console.log(`    ${label}: (none)`); return; }
  console.log(`    ${label}: name=${JSON.stringify(c.name)}  phone=${JSON.stringify(c.phone)}  source=${c.source}  id=${c.id}  created=${new Date(c.createdAt).toISOString()}`);
}

async function main() {
  console.log("Issue 4 diagnostic — booking↔contact name split (READ-ONLY)");
  console.log("==========================================================\n");

  const tenants = await db.tenant.findMany({ orderBy: { createdAt: "asc" } });
  let sawAnyBooking = false;

  for (const t of tenants) {
    const rt = await db.recordType.findFirst({ where: { tenantId: t.id, key: "booking" } });
    if (!rt) continue;

    const bookings = await db.record.findMany({
      where: { tenantId: t.id, recordTypeId: rt.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    if (!bookings.length) continue;
    sawAnyBooking = true;

    console.log(`TENANT: ${JSON.stringify(t.name)}  (id=${t.id})`);
    console.log(`  Bookings (most recent ${bookings.length}):`);
    for (const b of bookings) {
      console.log(`  • booking id=${b.id}  title=${JSON.stringify(b.title)}  appt=${b.appointmentAt ?? "-"}  resourceId=${b.resourceId ?? "Unassigned"}  created=${new Date(b.createdAt).toISOString()}`);
      const links = await db.recordLink.findMany({
        where: { tenantId: t.id, recordId: b.id, parentType: "contact", deletedAt: null },
      });
      if (!links.length) { console.log("    linked contact: (NONE linked)"); continue; }
      for (const lk of links) {
        const c = await db.contact.findUnique({ where: { id: lk.parentId } });
        row(`linked contact (role=${lk.role ?? "-"})`, c);
      }
    }

    const contacts = await db.contact.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "asc" } });
    console.log(`\n  ALL contacts in this tenant (${contacts.length}):`);
    for (const c of contacts) row("contact", c);

    // Flag potential duplicates: contacts whose names differ — the human-eye check.
    const names = new Set(contacts.map((c: any) => (c.name ?? "").trim()).filter(Boolean));
    if (contacts.length > 1 && names.size > 1) {
      console.log(`  ⚠️  ${contacts.length} contacts with ${names.size} distinct names — check whether some are the SAME caller under different phone keys.`);
    }
    console.log("\n----------------------------------------------------------\n");
  }

  if (!sawAnyBooking) {
    console.log("No bookings found in any tenant on THIS database.");
    console.log("If the divergence happened on your deployed app, run this against that");
    console.log("database (read-only) — see the note I'll give you.");
  }

  await disconnectDb();
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
