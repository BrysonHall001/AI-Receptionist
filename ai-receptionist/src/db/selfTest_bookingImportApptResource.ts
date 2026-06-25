// Real-Prisma self-test for Batch B — booking appointment + resource on import.
//
//   npx tsx src/db/selfTest_bookingImportApptResource.ts     (needs dev Postgres)
//
// THE WHOLE RISK IS WALL-CLOCK DRIFT. The client normalizes a file's appointment
// cell to the zoneless YYYY-MM-DDTHH:MM string (mirror below), then the REAL
// bulkCreateRecords path parks it via parseAppointmentAt. We assert the stored
// UTC-slot digits EXACTLY equal the input digits across formats, including a
// late-evening day-boundary time that would expose any timezone shift.
//
// Asserts:
//   (1) Appointment lands at the exact wall-clock time for: ISO-like, "M/D/YYYY
//       h:mm AM/PM", a day-boundary 11:30 PM, and an Excel serial date.
//   (2) A resource NAME in the file resolves to the correct resourceId.
//   (3) NEGATIVE: an unmatched resource name leaves the booking's resource blank and
//       is reported in resourceWarnings (no crash, booking still imported).
//
// SAFETY: one TEMPORARY tenant, deleted at the end.

import { prisma, disconnectDb } from "./client";
import { bulkCreateRecords } from "../services/recordService";
import { resolveRecordTypeId } from "../services/recordTypeService";

const db = prisma as any;
const T_NAME = "__SELFTEST_BOOKING_IMPORT__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// ---- mirror of portal.js normalizeApptInput (kept in sync) ----
const pad2 = (n: any) => String(n).padStart(2, "0");
function normalizeApptInput(val: any): string {
  const s = String(val == null ? "" : val).trim();
  if (!s) return "";
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${pad2(m[4])}:${m[5]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00`;
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/.exec(s);
  if (m) {
    let mo = m[1], da = m[2], yr = m[3];
    if (yr.length === 2) yr = (Number(yr) >= 70 ? "19" : "20") + yr;
    let H = m[4] != null ? parseInt(m[4], 10) : 0;
    const M = m[5] != null ? m[5] : "00";
    if (m[6]) { const pm = /p/i.test(m[6]); if (pm && H < 12) H += 12; if (!pm && H === 12) H = 0; }
    return `${yr}-${pad2(mo)}-${pad2(da)}T${pad2(H)}:${M}`;
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial >= 20000 && serial <= 90000) {
      const totalMin = Math.round(serial * 1440);
      const d = new Date(Date.UTC(1899, 11, 30) + totalMin * 60000);
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    }
  }
  return "";
}

// Assert a stored appointmentAt Date carries the exact wall-clock digits (read in UTC).
function digitsEqual(d: Date, y: number, mo: number, da: number, h: number, mi: number) {
  return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === mo && d.getUTCDate() === da && d.getUTCHours() === h && d.getUTCMinutes() === mi;
}

async function main() {
  console.log("Batch B — booking appointment + resource import (real Prisma, wall-clock)");
  console.log("=====================================================================\n");
  const before = await db.tenant.count();
  let tId = "";

  try {
    tId = (await db.tenant.create({ data: { name: T_NAME, notifyEmail: "bookimport@example.invalid" } })).id;
    const rtId = await resolveRecordTypeId(tId, "booking");
    const smith = await db.resource.create({ data: { tenantId: tId, name: "Dr. Smith" } });

    // The four appointment input formats, all meaning 2026-06-20, and a day-boundary.
    const excelSerial = (Date.UTC(2026, 5, 20, 23, 30) - Date.UTC(1899, 11, 30)) / 86400000;
    const cases = [
      { label: "ISO-like 17:00", input: "2026-06-20T17:00", norm: "2026-06-20T17:00", y: 2026, mo: 6, da: 20, h: 17, mi: 0, title: "B-iso" },
      { label: "M/D/YYYY 5:00 PM", input: "6/20/2026 5:00 PM", norm: "2026-06-20T17:00", y: 2026, mo: 6, da: 20, h: 17, mi: 0, title: "B-ampm" },
      { label: "day-boundary 11:30 PM", input: "6/20/2026 11:30 PM", norm: "2026-06-20T23:30", y: 2026, mo: 6, da: 20, h: 23, mi: 30, title: "B-late" },
      { label: "Excel serial 23:30", input: String(excelSerial), norm: "2026-06-20T23:30", y: 2026, mo: 6, da: 20, h: 23, mi: 30, title: "B-serial" },
    ];

    console.log("(1) Appointment lands at the EXACT wall-clock time (no drift):");
    for (const c of cases) {
      const norm = normalizeApptInput(c.input);
      check(norm === c.norm, `${c.label}: normalizes "${c.input}" -> "${norm}" (expect "${c.norm}")`);
      const res = await bulkCreateRecords(tId, "booking", [{ title: c.title, appointmentAt: norm, resourceName: "Dr. Smith" }]);
      check(res.imported === 1, `${c.label}: imported`);
      const rec = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: rtId, title: c.title } });
      check(!!rec && rec.appointmentAt != null && digitsEqual(rec.appointmentAt, c.y, c.mo, c.da, c.h, c.mi),
        `${c.label}: stored UTC-slot digits == input digits (${c.y}-${pad2(c.mo)}-${pad2(c.da)} ${pad2(c.h)}:${pad2(c.mi)}; got ${rec && rec.appointmentAt && rec.appointmentAt.toISOString()})`);
    }

    console.log("\n(2) Resource NAME resolves to the right resourceId:");
    const recAny = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: rtId, title: "B-iso" } });
    check(!!recAny && recAny.resourceId === smith.id, `"Dr. Smith" resolved to the resource id (got ${recAny && recAny.resourceId})`);

    console.log("\n(3) NEGATIVE — unmatched resource name handled + reported:");
    const res = await bulkCreateRecords(tId, "booking", [{ title: "B-ghost", appointmentAt: "2026-06-21T09:00", resourceName: "Nonexistent Person" }]);
    check(res.imported === 1, "booking with an unknown resource name still imports");
    const ghost = await db.record.findFirst({ where: { tenantId: tId, recordTypeId: rtId, title: "B-ghost" } });
    check(!!ghost && ghost.resourceId === null, "its resource is left blank (not a crash, not a wrong id)");
    check(Array.isArray(res.resourceWarnings) && res.resourceWarnings.indexOf("Nonexistent Person") !== -1, `the unmatched name is reported in resourceWarnings (${JSON.stringify(res.resourceWarnings)})`);
    check(!!ghost && ghost.appointmentAt != null && digitsEqual(ghost.appointmentAt, 2026, 6, 21, 9, 0), "its appointment still landed correctly");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up\u2026");
    try {
      if (tId) {
        await db.record.deleteMany({ where: { tenantId: tId } });
        await db.resource.deleteMany({ where: { tenantId: tId } });
        await db.fieldDef.deleteMany({ where: { tenantId: tId } });
        await db.recordType.deleteMany({ where: { tenantId: tId } });
        await db.tenant.deleteMany({ where: { name: T_NAME } });
      }
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
