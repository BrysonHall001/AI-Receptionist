// Geocode backfill — run ONCE after the RecordGeo migration (and re-runnable any time):
//
//   npm run backfill:geocode
//
// Walks every module that has an address field and, for each of its live records, marks the
// RecordGeo cache row stale (pending/empty) via the SAME on-save hook the app uses — so the set
// of rows is exactly what a normal save would have produced. Then runs geocodePending() ONCE to
// fill coordinates. IDEMPOTENT: markRecordGeoStale leaves unchanged addresses alone (cache hit),
// and geocodePending only touches "pending" rows. Safe to run repeatedly.
//
// Non-blocking by design: if MAPBOX_TOKEN isn't set, rows are still marked (pending/empty) but
// the sweep is a no-op — nothing is sent anywhere and the script still completes cleanly.
import { prisma, disconnectDb } from "./client";
import { markRecordGeoStale, markContactGeoStale, geocodePending } from "../services/geocodingService";
import { geocodingEnabled } from "../config/env";

const db = prisma as any;

async function main(): Promise<void> {
  // Every (tenant, recordType) that has at least one address field.
  const addressDefs = await db.fieldDef.findMany({ where: { type: "address" }, select: { tenantId: true, recordTypeId: true, key: true } });
  if (!addressDefs.length) { console.log("No address fields in any module — nothing to backfill."); }

  // Group address field defs by tenant+type so each record is processed once with all its fields.
  const byType: Record<string, { tenantId: string; recordTypeId: string; defs: { key: string; type: string }[] }> = {};
  for (const d of addressDefs) {
    if (!d.recordTypeId) continue;
    const k = d.tenantId + "::" + d.recordTypeId;
    (byType[k] || (byType[k] = { tenantId: d.tenantId, recordTypeId: d.recordTypeId, defs: [] })).defs.push({ key: d.key, type: "address" });
  }

  // Contact record types are handled by the CONTACTS pass below (contacts aren't Records);
  // everything else goes through the record pass. Both idempotent (unchanged addresses are
  // cache hits and never re-queued).
  const contactTypes = await db.recordType.findMany({ where: { key: "contact" }, select: { id: true } });
  const contactTypeIds = new Set(contactTypes.map((t: any) => t.id));

  let marked = 0;
  for (const grp of Object.values(byType)) {
    if (contactTypeIds.has(grp.recordTypeId)) continue; // contacts handled below
    const records = await db.record.findMany({
      where: { tenantId: grp.tenantId, recordTypeId: grp.recordTypeId, deletedAt: null },
      select: { id: true, recordTypeId: true, customFields: true },
    });
    for (const rec of records) {
      await markRecordGeoStale(grp.tenantId, rec, grp.defs);
      marked++;
    }
  }
  console.log(`Marked geocode rows for ${marked} record(s) across ${Object.keys(byType).length} module(s).`);

  // CONTACTS pass (contacts-on-the-map): mark every live contact stale for the contact type's
  // address fields, mirroring the record pass. Idempotent and re-runnable for the same reason.
  let cMarked = 0, cTenants = 0;
  for (const grp of Object.values(byType)) {
    if (!contactTypeIds.has(grp.recordTypeId)) continue;
    cTenants++;
    const contacts = await db.contact.findMany({
      where: { tenantId: grp.tenantId, deletedAt: null },
      select: { id: true, customFields: true },
    });
    for (const c of contacts) {
      await markContactGeoStale(grp.tenantId, c, grp.defs);
      cMarked++;
    }
  }
  console.log(`Marked geocode rows for ${cMarked} contact(s) across ${cTenants} portal(s).`);

  if (!geocodingEnabled()) {
    console.log("MAPBOX_TOKEN not configured — rows left pending; skipping the geocoding sweep (no-op).");
    return;
  }
  console.log("Running geocoding sweep (this calls Mapbox for pending rows)…");
  let total = { processed: 0, ok: 0, failed: 0 };
  // Drain in bounded passes so a large backfill still completes.
  for (let pass = 0; pass < 1000; pass++) {
    const r = await geocodePending({ limit: 50 });
    total.processed += r.processed; total.ok += r.ok; total.failed += r.failed;
    if (r.skipped || r.processed === 0) break;
  }
  console.log(`Geocoding sweep done: processed ${total.processed}, ok ${total.ok}, failed ${total.failed}.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await disconnectDb(); });
