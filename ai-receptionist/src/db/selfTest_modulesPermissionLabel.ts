// Self-test (no DB) for renaming the "Records (Jobs / Bookings / custom)" permission area
// to "Modules" — a LABEL-only change that must not touch enforcement.
//
//   npx tsx src/db/selfTest_modulesPermissionLabel.ts
//
// Proves:
//  (1) the permission catalog now shows the label "Modules" for the record-data area, and
//      the old "Records (Jobs / Bookings / custom)" label is gone;
//  (2) the area KEY is still "records" (stored grants + enforcement key off the key, not the
//      label), its kind is still "data", and it still supports View/Edit/Delete — so what the
//      permission GRANTS is unchanged;
//  (3) enforcement is unchanged: a Portal Admin still gets view/edit/delete on the area, and
//      the ceiling still allows all three.
import { getPermissionCatalog, CEILING, can } from "../services/permissionService";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

async function main() {
  console.log("Permission area rename — Records -> Modules (label only)");
  console.log("=======================================================");

  const catalog = getPermissionCatalog();
  const recs = catalog.find((a) => a.key === "records");

  // (1) label changed; old label gone.
  check(!!recs, "the record-data area still exists under key 'records'");
  check(recs?.label === "Modules", `its label now reads "Modules" (got "${recs?.label}")`);
  check(!catalog.some((a) => /Records \(Jobs/.test(a.label)), "no area still shows the old 'Records (Jobs / Bookings / custom)' label");

  // (2) what it grants is unchanged: data kind with view/edit/delete.
  check(recs?.kind === "data", "the area is still kind 'data' (governs record DATA)");
  const rights = new Set(recs?.rights || []);
  check(["view", "edit", "delete"].every((r) => rights.has(r as any)), "it still supports View / Edit / Delete");

  // (3) enforcement unchanged: ceiling + a Portal Admin still get all three on 'records'.
  check(CEILING.records?.view === true && CEILING.records?.edit === true && CEILING.records?.delete === true, "the permission CEILING still allows view/edit/delete on 'records'");
  const admin = { role: "PORTAL_ADMIN" };
  const v = await can(admin, "records", "view");
  const e = await can(admin, "records", "edit");
  const d = await can(admin, "records", "delete");
  check(v && e && d, "a Portal Admin still passes can('records', view/edit/delete) — enforcement intact");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(() => {
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (label is 'Modules'; key/kind/rights/enforcement unchanged)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
