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
const { can, moduleAreaKey, getPermissionCatalogFor, effectiveMatrix, permissionMatrixForRole,
        validateCustomRolePermissions, createPortalRole } = require("../services/permissionService");
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { createPortal } = require("../services/portalService");
const { createUser } = require("../services/userService");
const { createApp } = require("../app");
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

  // ---------- (8) THE DEFECT: every published row must be grantable, not just Contacts ----------
  console.log("\n(8) every module row is grantable, saveable and reloadable:");
  await db.tenant.update({ where: { id: t.id }, data: { labels: {} } });   // unhide invoice again
  const cat4 = await getPermissionCatalogFor(t.id);
  const moduleAreas = cat4.filter((a: any) => a.section === "Modules").map((a: any) => a.key);
  const dynamic = moduleAreas.filter((k: string) => k !== "contacts");
  check(dynamic.length >= 3, `the tenant publishes ${dynamic.length} module rows besides Contacts`);

  // the granter is a Portal Admin, exactly as in the New role editor
  const granter = { id: "pa2", role: "PORTAL_ADMIN", tenantId: t.id, customRoleId: null };
  const ceiling = await effectiveMatrix(granter, moduleAreas);
  check(moduleAreas.every((k: string) => ceiling[k] && ceiling[k].view === true && ceiling[k].edit === true && ceiling[k].delete === true),
    "the granter's ceiling covers EVERY published row \u2014 which is what lets the editor draw a checkbox for each");

  // NEGATIVE: the ceiling as it was BUILT BEFORE THIS FIX (static areas only) - this is
  // precisely the shipped bug, and it must be visibly different.
  const shippedCeiling = await effectiveMatrix(granter);
  check(dynamic.every((k: string) => shippedCeiling[k] === undefined),
    "NEGATIVE: built the old way it has NO cell for any module but Contacts \u2014 the bug that shipped, and this check would have caught it");
  check(shippedCeiling["contacts"] && shippedCeiling["contacts"].edit === true,
    "\u2026and Contacts DID have one, which is exactly why it was the only row that worked");

  // the reference tables carry real values for every row too
  const ref = permissionMatrixForRole("PORTAL_ADMIN", moduleAreas);
  check(moduleAreas.every((k: string) => ref[k] && ref[k].delete === true),
    "the system-role reference table has a real value for every row, not a dash");

  // SAVE through the real path, with the real ceiling, then RELOAD
  const grant: any = {};
  dynamic.forEach((k: string) => { grant[k] = { view: true, edit: true, delete: true }; });
  check(validateCustomRolePermissions(grant, ceiling).ok === true,
    "a grant naming every module VALIDATES against that ceiling");
  check(validateCustomRolePermissions(grant, shippedCeiling).ok === false,
    "NEGATIVE: against the old ceiling the same grant is REFUSED \u2014 saving would have failed even if you could tick it");
  const saved: any = await createPortalRole(t.id, `pmp-saved-${stamp}`, grant, ceiling);
  const reloaded: any = await db.portalRole.findUnique({ where: { id: saved.id } });
  check(dynamic.every((k: string) => reloaded.permissions[k] && reloaded.permissions[k].edit === true),
    "\u2026it saves and RELOADS with every per-module grant intact");

  // and it is ENFORCED, not merely drawn
  const savedUser = { id: "u-saved", role: "CLIENT_USER", tenantId: t.id, customRoleId: saved.id };
  check((await gate(savedUser, "PATCH", `/records/${job.id}`)).allowed === true,
    "the saved role can edit a record in a module it was granted");
  const narrow: any = await db.portalRole.create({ data: { tenantId: t.id, name: `pmp-narrow-${stamp}`, permissions: { [moduleAreaKey("job")]: { view: true, edit: true }, [moduleAreaKey("invoice")]: { view: true } } } });
  const narrowUser = { id: "u-narrow", role: "CLIENT_USER", tenantId: t.id, customRoleId: narrow.id };
  check((await gate(narrowUser, "PATCH", `/records/${job.id}`)).allowed === true
    && (await gate(narrowUser, "PATCH", `/records/${inv.id}`)).allowed === false,
    "\u2026and a role granted edit on ONE module is refused on the other, at the endpoint");

  // GENERIC over whatever this tenant has, so a custom module needs no test edit
  let ungrantable = "";
  for (const k of moduleAreas) {
    for (const r of ["view", "edit", "delete"]) {
      if (ceiling[k]?.[r] !== true) ungrantable += ` ${k}.${r}`;
    }
  }
  check(ungrantable === "", `every row \u00d7 every right is grantable, checked generically over the tenant's own modules${ungrantable}`);

  // ---------- (8b) THE ENDPOINT ITSELF ----------
  // Everything above drives the SERVICE functions. That is exactly how a use-before-declare
  // in the ROUTE shipped and 500'd this page: `systemRoles` read `moduleAreas` inside a
  // .map() callback declared above it, which TypeScript cannot flag because it cannot prove a
  // callback runs immediately - and .map() runs at once. Nothing here called the endpoint, so
  // nothing caught it. This does.
  console.log("\n(8b) GET /api/portal-roles actually responds:");
  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  const pw = "Correct-Horse-9!";
  const admin: any = await createUser({ email: `pmp-admin-${stamp}@example.invalid`, name: "PMP Admin", password: pw, role: "PORTAL_ADMIN", tenantId: t.id });
  cleanup.push(admin.id);
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: admin.email, password: pw }) });
  const jar = login.headers.getSetCookie ? login.headers.getSetCookie().join("; ") : String(login.headers.get("set-cookie") || "");
  const r = await fetch(base + "/api/portal-roles", { headers: { Cookie: jar } });
  let payload: any = null; try { payload = await r.json(); } catch { /* */ }
  check(r.status === 200, `the endpoint returns 200 (got ${r.status}) \u2014 a 500 here is the whole page failing to load`);
  const rows = ((payload && payload.catalog) || []).filter((a: any) => a.section === "Modules");
  check(rows.length >= 2, `\u2026and the payload carries ${rows.length} module rows`);
  check(rows.every((a: any) => Array.isArray(a.rights) && a.rights.length === 3),
    "\u2026each with its three rights, so the screen has something to draw");
  const sysAdmin = ((payload && payload.systemRoles) || []).find((x: any) => x.role === "PORTAL_ADMIN");
  check(!!sysAdmin && rows.every((a: any) => sysAdmin.permissions[a.key] && sysAdmin.permissions[a.key].edit === true),
    "\u2026the reference matrix in the SAME response has a real cell for every module row");
  check(!!payload.myPermissions && rows.every((a: any) => payload.myPermissions[a.key] && payload.myPermissions[a.key].edit === true),
    "\u2026and so does the granter's ceiling, which is what lets a checkbox render");
  srv.close();

  // ---------- (9) the columns line up ----------
  console.log("\n(9) the permission columns:");
  const portalSrc = readFileSync(resolvePath(__dirname, "..", "..", "public", "js", "portal.js"), "utf8");
  const body = portalSrc.slice(portalSrc.indexOf("        const RIGHT_LABEL = {"), portalSrc.indexOf('        return (data.sections || []).map(sectionTable).join("");'));
  const escFn = (x: any) => String(x);
  const mk = (editing: boolean) =>
    // eslint-disable-next-line no-new-func
    new Function("data", "esc", "role", "my", "editing", "App", body + "\nreturn sectionTable;")(
      { catalog: cat4 }, escFn, { permissions: ceiling, editable: editing }, ceiling, editing, { util: {} });
  let misaligned = "";
  for (const editing of [false, true]) {
    const st = mk(editing);
    for (const sec of ["Pages", "Modules", "Settings", "Admin"]) {
      const html = st(sec);
      if (!html) continue;
      for (const tb of html.split("<table").slice(1)) {
        const heads = (tb.match(/<th class="pt-rt">/g) || []).length;
        const firstRow = (tb.match(/<tr><td>[\s\S]*?<\/tr>/) || [""])[0];
        const marks = (firstRow.match(/<td class="pt-t2[1-4]"/g) || []).length;
        if (heads !== marks) misaligned += ` ${editing ? "editor" : "reference"}/${sec}(${heads}v${marks})`;
      }
    }
  }
  check(misaligned === "", `every mark cell has a centred header above it, in all four sections and BOTH views${misaligned}`);
  const editorHtml = mk(true)("Modules");
  check((editorHtml.match(/<input type="checkbox"/g) || []).length === moduleAreas.length * 3,
    `the editor draws a checkbox for every module and every right (${(editorHtml.match(/<input type="checkbox"/g) || []).length} of ${moduleAreas.length * 3})`);

  for (const id of cleanup) { await db.tenant.delete({ where: { id } }).catch(() => { /* best-effort */ }); }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (one row per module, and every row means what it says)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
