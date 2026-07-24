// File Storage — batch self-test (standing four-layer policy: builds; one happy
// path per shipped feature; prime-directive regressions; catastrophics only).
//
//   npx tsx src/db/selfTest_fileStorage.ts     (from ai-receptionist, clarity-pg up)
//
// Runs fully OFFLINE: without R2 env vars and outside production the storage
// mode is "local" (gitignored .data/files), which is the same code path as
// production minus the S3 transport.
//
// Fixture rules honored: own throwaway tenants; contacts via RAW
// db.contact.create with unique email AND phone (the convention from
// selfTest_customerComms / the drip suites); the sweep's AppSetting cursors —
// the settings its code path reads — are explicitly pinned to a clean start.
// NOTE the sweep is cursored over ALL rows, so this suite may also migrate any
// pre-existing embedded dev files while it drains to its own fixtures — that is
// the shipped, checksum-verified behavior, identical to what deploy does.

import { prisma, disconnectDb } from "./client";
import { listRecordTypes, WORK_ORDER_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { createRecord, getRecord } from "../services/recordService";
import { storage, storageMode, sha256Hex, storageKeyFor, makeFileRef, parseFileRef, isDataUrl, MAX_IMAGE_BYTES } from "../services/fileStorage";
import { runFileMigrationSweep, parseDataUrl, getFileSweepStats } from "../services/fileSweepService";
import { setAppSetting } from "../services/appSettingService";
import { can, createPortalRole } from "../services/permissionService";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];

// A real tiny PNG (1x1, valid base64) + a tiny "PDF" for file-shaped values.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_DATA_URL = "data:image/png;base64," + PNG_B64;
const PDF_DATA_URL = "data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK";

async function mkTenant(tag: string): Promise<string> {
  const t = await db.tenant.create({ data: { name: `fs-${tag}-${stamp}`, notifyEmail: `fs-${tag}-${stamp}@example.invalid`, billingStatus: "active" } });
  tenantIds.push(t.id);
  return t.id;
}

async function main() {
  console.log("File Storage — batch self-test");
  console.log("==============================");
  check(storageMode() === "local", `offline mode is "local" (got "${storageMode()}") — no network, no credentials, real code path`);

  // =========================================================================
  console.log("\n(1) cheap pure checks — reference + data-URL parsing:");
  const id0 = "abc123XYZ";
  check(parseFileRef(makeFileRef(id0)) === id0 && parseFileRef("data:image/png;base64,x") === null && parseFileRef("clarityfile:") === null,
    "clarityfile ref round-trips; data URLs and empty ids are never refs");
  const pd = parseDataUrl(PNG_DATA_URL);
  check(!!pd && pd.mime === "image/png" && sha256Hex(pd.bytes) === sha256Hex(Buffer.from(PNG_B64, "base64")), "data-URL parser recovers exact bytes + mime");
  check(parseDataUrl("data:,") === null && parseDataUrl("not a data url") === null, "malformed/empty data URLs parse to null (left-alone posture upstream)");

  // =========================================================================
  console.log("\n(2) happy path — store, round-trip, serve-model:");
  const T = await mkTenant("main");
  await listRecordTypes(T);
  const bytes = Buffer.from(PNG_B64, "base64");
  const row = await db.storedFile.create({ data: { tenantId: T, key: "pending", name: "site.png", mime: "image/png", size: bytes.length, sha256: sha256Hex(bytes), origin: "upload" } });
  const key = storageKeyFor(T, row.id);
  await storage().put(key, bytes, "image/png");
  await db.storedFile.update({ where: { id: row.id }, data: { key } });
  const back = await storage().get(key);
  check(!!back && back.equals(bytes), "upload lands in fallback storage and reads back byte-identical");
  // The serving route's exact lookup: tenant-scoped row -> bytes + stored mime.
  const served = await db.storedFile.findFirst({ where: { id: row.id, tenantId: T } });
  check(!!served && served.mime === "image/png" && !!(await storage().get(served.key)), "serving lookup finds the file with correct mime for its own tenant");

  // =========================================================================
  console.log("\n(3) prime-directive regressions:");
  // (3a) With storage OFF (production without keys), the sweep is a no-op and
  // embedded values stay byte-identical — the do-nothing path.
  const woOff: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Off-mode wo", subtypeKey: "repair", customFields: { photos: PNG_DATA_URL } });
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    check(storageMode() === "off", 'production without R2 keys is mode "off"');
    check((await runFileMigrationSweep()) === null, "…and the sweep declines to run at all");
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
  const offAfter: any = await getRecord(T, woOff.id);
  check(offAfter.customFields.photos === PNG_DATA_URL, "…leaving the embedded value byte-identical (storage-off behaves exactly as today)");

  // (3b) Transition honesty: pre-sweep, an embedded base64 value survives a
  // normal read/serialize unchanged (renderers show data URLs as-is until swept).
  check(isDataUrl(offAfter.customFields.photos), "a pre-sweep base64 value is still served to the client in its original form");

  // =========================================================================
  console.log("\n(4) happy path — the migration sweep:");
  // Pin the settings this code path reads: cursors to a clean start.
  await setAppSetting("fileSweep:cursor:record", "");
  await setAppSetting("fileSweep:cursor:contact", "");
  const c1 = await db.contact.create({ data: { tenantId: T, name: "Sweep Cust", email: `fs-c1-${stamp}@example.invalid`, phone: `+1555${String(stamp).slice(-7)}`, source: "test", customFields: { contract: { name: "contract.pdf", data: PDF_DATA_URL } } } });
  const woSweep: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Sweep wo", subtypeKey: "repair", customFields: { photos: PNG_DATA_URL } });
  const woBad: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Malformed wo", subtypeKey: "repair", customFields: { photos: "data:," } });

  // Drain: cursored 25-rows-per-pass over the WHOLE table, so loop until our
  // fixtures migrate (or the pass count proves something is wrong).
  let recAfter: any = null;
  for (let i = 0; i < 400; i++) {
    await runFileMigrationSweep();
    recAfter = await getRecord(T, woSweep.id);
    const cAfter = await db.contact.findFirst({ where: { id: c1.id } });
    if (parseFileRef(recAfter.customFields.photos) && parseFileRef((cAfter.customFields || {}).contract?.ref)) break;
  }
  const cAfter = await db.contact.findFirst({ where: { id: c1.id } });
  const recRefId = parseFileRef(recAfter.customFields.photos);
  const conRefId = parseFileRef((cAfter.customFields || {}).contract?.ref);
  check(!!recRefId, "record image value swapped to a clarityfile reference");
  check(!!conRefId && cAfter.customFields.contract.name === "contract.pdf" && !("data" in cAfter.customFields.contract || cAfter.customFields.contract.data),
    "contact file value swapped to {name, ref} — embedded blob gone, filename kept");
  const sf = recRefId ? await db.storedFile.findFirst({ where: { id: recRefId, tenantId: T } }) : null;
  check(!!sf && sf.origin === "sweep" && sf.sha256 === sha256Hex(Buffer.from(PNG_B64, "base64")), "StoredFile row carries the original's exact checksum");
  const swept = sf ? await storage().get(sf.key) : null;
  check(!!swept && sha256Hex(swept) === sf.sha256, "…and the bytes in storage match it (verified swap)");

  // Re-run = structural no-op: no new StoredFile rows appear for this tenant.
  const countBefore = await db.storedFile.count({ where: { tenantId: T } });
  await setAppSetting("fileSweep:cursor:record", "");
  await setAppSetting("fileSweep:cursor:contact", "");
  for (let i = 0; i < 400; i++) { const r = await runFileMigrationSweep(); if (r && r.examined === 0) break; }
  check((await db.storedFile.count({ where: { tenantId: T } })) === countBefore, "re-running the sweep is a no-op (nothing re-migrated, nothing duplicated)");

  // =========================================================================
  console.log("\n(5) catastrophics:");
  // Cross-tenant serving isolation: the route's exact tenant-scoped lookup.
  const TB = await mkTenant("iso");
  check((await db.storedFile.findFirst({ where: { id: row.id, tenantId: TB } })) === null,
    "CROSS-TENANT: another tenant's serving lookup finds NOTHING (hard 404, existence not revealed)");
  // Permission refusal: a role with neither records nor contacts view fails the
  // route's exact check.
  const noView = await createPortalRole(T, `fs novis ${stamp}`, { records: { view: false, edit: false }, contacts: { view: false, edit: false } });
  const blocked = { id: "fs-viewer", role: "CLIENT_USER", tenantId: T, customRoleId: noView.id };
  check(!(await can(blocked, "records", "view")) && !(await can(blocked, "contacts", "view")),
    "NO-RIGHTS: a user without records/contacts view fails the serving permission check");
  // No dangling references: every clarityfile ref the sweep wrote points at a
  // file that exists and matches its recorded checksum…
  const sweptRows = await db.storedFile.findMany({ where: { tenantId: T, origin: "sweep" } });
  let intact = sweptRows.length > 0;
  for (const s of sweptRows) {
    const b = await storage().get(s.key);
    if (!b || sha256Hex(b) !== s.sha256) intact = false;
  }
  check(intact, `INTEGRITY: every sweep-written reference has its file, checksum-true (${sweptRows.length} checked)`);
  // …and the un-migratable value was left exactly as-is (failure posture).
  const badAfter: any = await getRecord(T, woBad.id);
  check(badAfter.customFields.photos === "data:,", "FAILURE POSTURE: a malformed embedded value is left untouched, not broken, not half-swapped");
  const stats = await getFileSweepStats();
  check(stats.passes > 0, `sweep stats accumulate for the Health check (${stats.passes} passes recorded)`);
  check(MAX_IMAGE_BYTES === 8 * 1024 * 1024, "the raised image cap is the approved 8 MB");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) { try { await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }); } catch { /* leave for manual cleanup */ } }
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (bytes verified before every swap; tenants sealed; the do-nothing path does nothing)" : failures.length + " FAILED \u274c: " + failures.join("; ")}`);
    process.exit(failures.length === 0 ? 0 : 1);
  });
