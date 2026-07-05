// Self-test: "billing" is a real permission area. Portal Admin + top tiers get it by default,
// Client User does NOT, it's grantable via a custom role, the endpoint is mapped for server-side
// enforcement, and the #/billing page-lock remains an independent gate.
//   npx tsx src/db/selfTest_billingPermission.ts
import { prisma, disconnectDb } from "./client";
import { can, CEILING, capToCeiling, getPermissionCatalog, permissionMatrixForRole, createPortalRole } from "../services/permissionService";
import { getLockedPages } from "../services/portalService";
import { ruleFor, PERM_RULES } from "../middleware/permissionGate";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }

async function main() {
  console.log("billing permission\n==================");
  const ids: string[] = [];
  try {
    console.log("(1) catalog: billing is a grantable view-only Operations area:");
    const cat = getPermissionCatalog();
    const b = cat.find((a: any) => a.key === "billing");
    check(!!b, "billing area present in catalog");
    check(!!b && b.kind === "gated_view" && b.rights.join(",") === "view", "kind gated_view, rights = [view]");
    check(!!b && b.section === "Operations" && !b.locked, "section Operations, not admin-locked (grantable)");

    console.log("\n(2) system-role defaults (the leak fix):");
    check(permissionMatrixForRole("PORTAL_ADMIN").billing?.view === true, "PORTAL_ADMIN gets billing view by default");
    check(permissionMatrixForRole("CLIENT_USER").billing?.view !== true, "CLIENT_USER does NOT get billing view by default");
    check(permissionMatrixForRole("OWNER").billing?.view === true, "OWNER (top tier) gets billing view");
    check(permissionMatrixForRole("SUPER_ADMIN").billing?.view === true, "SUPER_ADMIN gets billing view");

    console.log("\n(3) grantable ceiling:");
    check(CEILING.billing?.view === true, "billing view is within the grant ceiling");
    check(capToCeiling({ billing: { view: true } }).billing?.view === true, "capToCeiling keeps a granted billing view");
    check(!capToCeiling({ billing: { edit: true } }).billing?.edit, "capToCeiling drops an unsupported billing edit");

    console.log("\n(4) endpoint mapped for server-side enforcement:");
    const rule = ruleFor("GET", "/portal-billing");
    check(!!rule && rule.area === "billing" && rule.right === "view", "GET /portal-billing -> (billing, view)");
    check(PERM_RULES.some((r) => r.area === "billing"), "a billing PERM_RULE exists");

    console.log("\n(5) live can() with tenants + custom roles:");
    const t = (await db.tenant.create({ data: { name: "Acme", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(t);
    const PA = { role: "PORTAL_ADMIN", tenantId: t, customRoleId: null };
    const CU = { role: "CLIENT_USER", tenantId: t, customRoleId: null };
    check((await can(PA, "billing", "view")) === true, "Portal Admin can view billing");
    check((await can(CU, "billing", "view")) === false, "Client User canNOT view billing (server-enforced)");
    check((await can({ role: "OWNER", tenantId: null } as any, "billing", "view")) === true, "master-hub OWNER can view billing");

    // Grant via a custom role (up to the granter's ceiling).
    const granted = await createPortalRole(t, "Billing Viewer", { billing: { view: true } });
    const CUgranted = { role: "CLIENT_USER", tenantId: t, customRoleId: (granted as any).id };
    check((await can(CUgranted, "billing", "view")) === true, "Client User WITH a role granting billing -> can view");
    const noBill = await createPortalRole(t, "Contacts Only", { contacts: { view: true } });
    const CUnoBill = { role: "CLIENT_USER", tenantId: t, customRoleId: (noBill as any).id };
    check((await can(CUnoBill, "billing", "view")) === false, "custom role without billing -> still canNOT view");

    console.log("\n(6) #/billing page-lock stays an independent gate:");
    // Fresh tenant so getLockedPages isn't already cached from a prior can() read.
    const t2 = (await db.tenant.create({ data: { name: "Locked Co", billingStatus: "paid", notifyEmail: "", lockedPages: ["#/billing"] } as any })).id; ids.push(t2);
    const locked = await getLockedPages(t2);
    check(locked.includes("#/billing"), "operator page-lock records #/billing (still lockable)");
    // Permission and page-lock are independent gates: billing maps to no nav area, so can() isn't
    // flipped by the lock — the lock is enforced separately by lockGate on /portal-billing.
    check((await can({ role: "PORTAL_ADMIN", tenantId: t2, customRoleId: null }, "billing", "view")) === true, "permission unaffected by page-lock (lockGate enforces the lock independently)");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    for (const id of ids) {
      try { await db.portalRole.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n==================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (billing permission)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
