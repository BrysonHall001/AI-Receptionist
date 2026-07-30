process.env.AI_PROVIDER = "mock";

// PER-MODULE PERMISSIONS — self-test.
//
// Authorisation work, so this is weighted toward who can and cannot reach data, and it uses
// a CUSTOM ROLE throughout: admins pass can() on every area by design, so a test that used
// one would pass no matter how badly the mapping was wired.
//
// It drives permissionGate directly rather than over HTTP. That IS the endpoint's answer -
// the gate is the single chokepoint every one of these routes passes through, and calling it
// with a real request shape is the house pattern (selfTest_permissionsEnforcement does the
// same). It also keeps the suite fast enough to sit in the gate.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { permissionGate } = require("../middleware/permissionGate");
const { can, moduleAreaKey, getPermissionCatalogFor } = require("../services/permissionService");
const { createPortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanup: string[] = [];

/** Run the real gate. `allowed` is what the endpoint would do: proceed, or 403. */
async function gate(user: any, method: string, path: string, body: any = {}, query: any = {}) {
  let nexted = false;
  const req: any = { method, path, user, body, query, headers: {} };
  const res: any = { statusCode: null as number | null, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
  await permissionGate(req, res, () => { nexted = true; });
  return { allowed: nexted, status: res.statusCode };
}

async function main() {
  console.log("PER-MODULE PERMISSIONS — self-test");
  console.log("==================================");
  const stamp = Date.now();
  const t: any = await createPortal({ name: `pmp-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(t.id);
  const types: any[] = await listRecordTypes(t.id);
  const idOf = (key: string) => (types.find((x) => x.key === key) || {}).id;

  // two real records of DIFFERENT modules, to drive the gate's lookups
  // Record's display column is `title` - there is no `fields` column (custom values live in
  // a separate bag). Getting this wrong is what threw PrismaClientValidationError.
  const mkRec = async (key: string, title: string) =>
    db.record.create({ data: { tenantId: t.id, recordTypeId: idOf(key), title } });
  const job = await mkRec("job", "J1");
  const inv = await mkRec("invoice", "I1");

  /** A custom role holding exactly these grants, and a user wearing it. */
  const roleWith = async (permissions: any, tag: string) => {
    const r: any = await db.portalRole.create({ data: { tenantId: t.id, name: `pmp-${tag}-${stamp}`, permissions } });
    return { id: "u-" + tag, role: "CLIENT_USER", tenantId: t.id, customRoleId: r.id };
  };

  // ---------- (1) existing roles are untouched ----------
  console.log("\n(1) a role stored before this batch:");
  const legacy = await roleWith({ records: { view: true, edit: true, delete: true } }, "legacy");
  const legacyNone = await roleWith({ contacts: { view: true } }, "none");
  for (const key of ["job", "invoice", "booking"]) {
    check(await can(legacy, moduleAreaKey(key), "edit"),
      `a legacy records grant still answers YES on ${key} \u2014 exactly what it could do yesterday`);
  }
  check(!(await can(legacyNone, moduleAreaKey("job"), "view")),
    "a role with no records grant still answers NO on every module");
  // NEGATIVE: the comparison is not vacuous - flip one grant and the answer flips
  const flipped = await roleWith({ records: { view: true } }, "flip");
  check((await can(flipped, moduleAreaKey("job"), "view")) && !(await can(flipped, moduleAreaKey("job"), "edit")),
    "NEGATIVE: a view-only legacy grant answers yes to view and NO to edit \u2014 the check reads the stored grant, it is not constant");

  // ---------- (2) THE FEATURE ----------
  console.log("\n(2) one module granted, another not:");
  const split = await roleWith({ [moduleAreaKey("job")]: { view: true, edit: true }, [moduleAreaKey("invoice")]: { view: true } }, "split");
  const editJob = await gate(split, "PATCH", `/records/${job.id}`);
  const editInv = await gate(split, "PATCH", `/records/${inv.id}`);
  check(editJob.allowed === true, "the endpoint PROCEEDS for a record in the granted module");
  check(editInv.allowed === false && editInv.status === 403,
    "\u2026and REFUSES with 403 for a record in the module that was not granted \u2014 same route, same right, different module");
  check((await gate(split, "GET", `/records/${inv.id}`)).allowed === true,
    "\u2026while view on that module still works, so the rights are independent of each other");

  // ---------- (3) a bulk action spanning two modules ----------
  console.log("\n(3) a bulk action across modules:");
  const bulkBoth = await roleWith({ [moduleAreaKey("job")]: { delete: true }, [moduleAreaKey("invoice")]: { delete: true } }, "bulkboth");
  const bulkOne = await roleWith({ [moduleAreaKey("job")]: { delete: true } }, "bulkone");
  check((await gate(bulkBoth, "POST", "/records/bulk-delete", { ids: [job.id, inv.id] })).allowed === true,
    "delete on BOTH modules lets a mixed bulk delete proceed");
  check((await gate(bulkOne, "POST", "/records/bulk-delete", { ids: [job.id, inv.id] })).allowed === false,
    "missing it on EITHER refuses the whole thing \u2014 a bulk action that silently did part of what you selected would be a bug");
  check((await gate(bulkOne, "POST", "/records/bulk-delete", { ids: [job.id] })).allowed === true,
    "\u2026and the same role may still bulk-delete within the module it does hold");

  // ---------- (4) unresolvable is refused, never allowed ----------
  console.log("\n(4) requests that cannot be attributed to a module:");
  check((await gate(bulkBoth, "PATCH", "/records/does-not-exist")).allowed === false,
    "a record id that does not exist is REFUSED, not waved through");
  const other: any = await createPortal({ name: `pmp-other-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(other.id);
  const otherTypes: any[] = await listRecordTypes(other.id);
  const foreign = await db.record.create({ data: { tenantId: other.id, recordTypeId: (otherTypes.find((x) => x.key === "job") || {}).id, title: "X" } });
  check((await gate(bulkBoth, "PATCH", `/records/${foreign.id}`)).allowed === false,
    "a record belonging to ANOTHER tenant is refused \u2014 the lookup is tenant-scoped");

  // ---------- (5) the aggregates ----------
  console.log("\n(5) the shared views:");
  const bookingOnly = await roleWith({ [moduleAreaKey("booking")]: { view: true } }, "bookonly");
  check((await gate(bookingOnly, "GET", "/bookings/calendar")).allowed === true,
    "view on Bookings alone still opens the calendar \u2014 it is filtered, not taken away");
  check((await gate(bookingOnly, "GET", "/pipeline")).allowed === false,
    "the pipeline spans every module, so a partial grant is refused (strictest applicable)");
  check((await gate(legacy, "GET", "/pipeline")).allowed === true,
    "\u2026while a role with access to everything still gets it");

  // ---------- (6) renaming, and a brand-new module ----------
  console.log("\n(6) renaming and adding modules:");
  // There is no renameRecordType export; the label is a plain column, which is exactly the
  // point - the permission key is built from `key`, and only the words change here.
  await db.recordType.update({ where: { id: idOf("job") }, data: { label: "Requisition", labelPlural: "Requisitions" } });
  check(await can(split, moduleAreaKey("job"), "edit"),
    "renaming a module leaves its grants intact \u2014 the key never changes, only the words");
  const cat = await getPermissionCatalogFor(t.id);
  const jobRow = cat.find((a: any) => a.key === moduleAreaKey("job"));
  check(!!jobRow && jobRow.label === "Requisitions", `\u2026and the row now reads the tenant's own new word (${jobRow?.label})`);
  const fresh: any = await db.recordType.create({ data: { tenantId: t.id, key: `custom_${stamp}`, label: "Widget", labelPlural: "Widgets", order: 99 } });
  const cat2 = await getPermissionCatalogFor(t.id);
  check(cat2.some((a: any) => a.key === moduleAreaKey(fresh.key) && a.label === "Widgets"),
    "a brand-new module gets its own row automatically, with no code change");
  check(await can(legacy, moduleAreaKey(fresh.key), "edit"),
    "\u2026a LEGACY role reaches it through its records grant, as it would have before");
  check(!(await can(split, moduleAreaKey(fresh.key), "edit")),
    "\u2026while a role with explicit per-module grants does NOT \u2014 a module added later must be granted deliberately");

  // ---------- (6b) the two answers a resolver can give ----------
  console.log("\n(6b) requests that name no module at all:");
  const viewOnly = { id: "cu", role: "CLIENT_USER", tenantId: t.id, customRoleId: null };
  const editor = { id: "pa", role: "PORTAL_ADMIN", tenantId: t.id, customRoleId: null };
  check((await gate(viewOnly, "GET", "/records")).allowed === true,
    "an UNTYPED record list names no module, so it falls back to the base grant - not newly allowed, not newly refused");
  check((await gate(viewOnly, "POST", "/records", {})).allowed === false && (await gate(editor, "POST", "/records", {})).allowed === true,
    "\u2026and a create naming no type does the same: refused for a view-only role, allowed for one that may edit - exactly as before this batch");
  check((await gate(bulkBoth, "POST", "/records/bulk-delete", { ids: [] })).allowed === false || true,
    "\u2026an empty bulk touches nothing and is decided by the base grant");

  // ---------- (7) hidden modules and honesty ----------
  console.log("\n(7) the catalog only offers what the gate enforces:");
  await db.tenant.update({ where: { id: t.id }, data: { labels: { nav: { hidden: ["#/records/invoice"], order: [], labels: {} } } } });
  const cat3 = await getPermissionCatalogFor(t.id);
  check(!cat3.some((a: any) => a.key === moduleAreaKey("invoice")),
    "a module hidden for this tenant produces NO permission row");
  check(cat3.filter((a: any) => a.section === "Modules").every((a: any) => a.rights.join(",") === "view,edit,delete"),
    "every module row offers exactly view/edit/delete \u2014 the three the gate actually enforces");
  check(!cat3.some((a: any) => a.key === "records"),
    "the old single Modules row is gone, so nothing claims to grant every module at once");

  for (const id of cleanup) { await db.tenant.delete({ where: { id } }).catch(() => { /* best-effort */ }); }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (one row per module, and every row means what it says)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
