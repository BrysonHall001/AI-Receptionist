// Self-test for the unified create-tenant checklists: "checked = ON/available", all on
// by default, unchecking locks a page / hides a module.
//
//   npx tsx src/db/selfTest_createTenantChecklist.ts     (needs dev Postgres)
//
// Proves:
//  (1) DEFAULT (nothing unchecked) -> a new portal has NO locked pages and NO hidden
//      modules: everything is on, matching the "all checked by default" behavior.
//  (2) Unchecking a PAGE (i.e. sending it in lockedPages) locks it.        <-- PAGE polarity
//  (3) Unchecking a MODULE (i.e. sending its key in hiddenRecordTypes) hides its nav item
//      while the type stays seeded (reversible).                            <-- MODULE polarity
//  (4) The admin.js checklists carry the "checked = on" POLARITY in code: the pages
//      checklist checks a box when the page is NOT locked and LOCKS on uncheck; the module
//      picker starts every togglable module CHECKED and HIDES on uncheck.
import { prisma, disconnectDb } from "./client";
import { createPortal } from "../services/portalService";
import { listRecordTypes } from "../services/recordTypeService";
import { readFileSync } from "fs";
import { resolve } from "path";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
function navHidden(p: any): string[] { return (p && p.labels && p.labels.nav && Array.isArray(p.labels.nav.hidden)) ? p.labels.nav.hidden : []; }

async function main() {
  console.log("Create-tenant checklists — checked = on, all-on default, uncheck to lock/hide");
  console.log("============================================================================");

  // (1) DEFAULT: omit lockedPages + hiddenRecordTypes entirely -> nothing locked, nothing hidden.
  const dflt: any = await createPortal({ name: `ck-default-${stamp}`, notifyEmail: `d-${stamp}@ex.com`, billingStatus: "free" });
  tenantIds.push(dflt.id);
  check(Array.isArray(dflt.lockedPages) && dflt.lockedPages.length === 0, "default portal has NO locked pages (all pages available)");
  check(navHidden(dflt).length === 0, "default portal hides NO modules (all modules visible)");
  // Every togglable module — including the five pre-built ones — is present + visible.
  const types = await listRecordTypes(dflt.id);
  const keys = new Set((types as any[]).map((t) => t.key));
  check(["vehicle", "property", "product", "estimate", "task"].every((k) => keys.has(k)), "all five pre-built modules exist in the default portal");
  const hidden = new Set(navHidden(dflt));
  check(["vehicle", "property", "product", "estimate", "task"].every((k) => !hidden.has(`#/records/${k}`)), "and none of them are hidden by default (flipped to default-ON)");

  // (2) Unchecking a PAGE => it arrives in lockedPages => it's locked.
  const pageLocked: any = await createPortal({ name: `ck-page-${stamp}`, notifyEmail: `p-${stamp}@ex.com`, billingStatus: "free", lockedPages: ["#/reports"] });
  tenantIds.push(pageLocked.id);
  check(Array.isArray(pageLocked.lockedPages) && pageLocked.lockedPages.includes("#/reports"), "unchecking a page LOCKS it (lands in lockedPages)"); // page polarity
  check(!pageLocked.lockedPages.includes("#/contacts"), "pages left checked stay unlocked");

  // (3) Unchecking a MODULE => its key arrives in hiddenRecordTypes => nav item hidden, type still seeded.
  const modHidden: any = await createPortal({ name: `ck-mod-${stamp}`, notifyEmail: `m-${stamp}@ex.com`, billingStatus: "free", hiddenRecordTypes: ["estimate"] });
  tenantIds.push(modHidden.id);
  check(navHidden(modHidden).includes("#/records/estimate"), "unchecking a module HIDES its nav item"); // module polarity
  const modTypes = await listRecordTypes(modHidden.id);
  check((modTypes as any[]).some((t) => t.key === "estimate"), "the hidden module's type is still SEEDED (reversible, no data loss)");

  // (4) POLARITY lives in admin.js: pages check when NOT locked + lock on uncheck; modules start checked.
  const admin = readFileSync(resolve(__dirname, "../../public/js/admin.js"), "utf8");
  check(/cb\.checked = pg\.hrefs\.every\(\(h\) => !locked\.has\(h\)\);/.test(admin), "pages checklist: a box is CHECKED when the page is NOT locked");
  check(/if \(cb\.checked\) locked\.delete\(h\); else locked\.add\(h\);/.test(admin), "pages checklist: UNCHECKING locks (adds hrefs to the locked set)");
  check(/cb\.checked = true;/.test(admin), "modules picker: every togglable module starts CHECKED (on)");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (checked = on; all-on by default; uncheck locks/hides)" : failures.length + " FAILED \u274c"}`);
    process.exit(failures.length ? 1 : 0);
  });
