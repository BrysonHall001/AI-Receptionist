// PERMISSIONS REGROUP — self-test.
//
// The batch's whole reason for existing is the claim "not one permission changed", so the
// centre of gravity here is proving that rather than restating it. Everything is behaviour
// or a computable invariant; nothing asserts that a source file still contains a string.
//
// THE COMPARISON IS ONLY AS GOOD AS THE FIXTURE IS COMPLETE. A fixture missing an area or a
// right would let the identity check pass while hiding a real change, so completeness is
// proven against the LIVE catalog in both directions before the comparison is trusted, and
// a deliberately tampered copy proves the comparison is not vacuously true.
/* eslint-disable @typescript-eslint/no-var-requires */
const {
  AREAS, AREA_SECTIONS, CEILING, getPermissionCatalog, permissionMatrixForRole,
  SYSTEM_ROLES, capToCeiling, validateCustomRolePermissions,
} = require("../services/permissionService");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const baseline = require("./fixtures/permissionsBaseline.json");
const catalog: any[] = getPermissionCatalog();

/** Every cell where the live matrix and a given fixture disagree, named. */
function diffAgainst(fixture: any): string[] {
  const out: string[] = [];
  for (const role of baseline.roles) {
    const now = permissionMatrixForRole(role);
    const then = (fixture.matrix || {})[role] || {};
    for (const k of new Set([...Object.keys(now), ...Object.keys(then)])) {
      const rn = now[k] || {}, rt = then[k] || {};
      for (const r of new Set([...Object.keys(rn), ...Object.keys(rt)])) {
        if (rn[r] !== rt[r]) out.push(`${role}.${k}.${r}: ${rt[r]} -> ${rn[r]}`);
      }
    }
  }
  return out;
}

function main() {
  console.log("PERMISSIONS REGROUP — self-test");
  console.log("==============================");

  // ---------- (1) is the safety net actually complete? ----------
  console.log("\n(1) the baseline covers everything it claims to:");
  const liveAreas = catalog.map((a) => a.key).sort();
  check(eq(liveAreas, baseline.shape.areaKeys.slice().sort()),
    `every live area is in the baseline and every baseline area is still live (${liveAreas.length}) \u2014 an area added OR removed fails here`);
  let rightsOk = true, why = "";
  for (const a of catalog) {
    const want = a.rights.slice().sort(), got = (baseline.shape.rightsByArea[a.key] || []).slice().sort();
    if (!eq(want, got)) { rightsOk = false; why = ` (${a.key}: live [${want}] vs baseline [${got}])`; break; }
  }
  check(rightsOk, `every area's rights still match what its kind promises \u2014 a right added or dropped fails here${why}`);
  check(eq(SYSTEM_ROLES.map((r: any) => r.role).sort(), baseline.roles.slice().sort()),
    `all ${baseline.roles.length} built-in roles are covered`);
  const derived = baseline.roles.length * catalog.reduce((n: number, a: any) => n + a.rights.length, 0);
  let counted = 0;
  for (const r of baseline.roles) for (const k of Object.keys(baseline.matrix[r])) counted += Object.keys(baseline.matrix[r][k]).length;
  check(derived === baseline.shape.cellCount && counted === baseline.shape.cellCount,
    `the cell count re-derives from the live catalog (${derived}) AND the baseline really holds that many (${counted}) \u2014 a populated-but-partial fixture fails here`);

  // ---------- (2) THE CLAIM: not one permission changed ----------
  console.log("\n(2) not one permission changed:");
  const d = diffAgainst(baseline);
  check(d.length === 0,
    d.length === 0
      ? `every one of the ${baseline.shape.cellCount} role/area/right combinations is identical to before the regroup`
      : `PERMISSIONS MOVED: ${d.slice(0, 4).join("; ")}`);
  const tampered = JSON.parse(JSON.stringify(baseline));
  tampered.matrix.CLIENT_USER.contacts.edit = !tampered.matrix.CLIENT_USER.contacts.edit;
  const d2 = diffAgainst(tampered);
  check(d2.length === 1 && d2[0].startsWith("CLIENT_USER.contacts.edit"),
    `NEGATIVE: flipping a single cell is caught and named \u2014 ${d2[0] || "NOT CAUGHT, the check above is vacuous"}`);

  // ---------- (3) the new grouping ----------
  console.log("\n(3) the headings:");
  check(eq(AREA_SECTIONS, ["Pages", "Modules", "Settings", "Admin"]),
    `the four sections, in order (${AREA_SECTIONS.join(" \u00b7 ")})`);
  const orphans = catalog.filter((a) => AREA_SECTIONS.indexOf(a.section) === -1).map((a) => `${a.key}:${a.section}`);
  check(orphans.length === 0, `no area is orphaned into a section that is not declared${orphans.length ? " \u2014 " + orphans.join(", ") : ""}`);
  const bySection: Record<string, number> = {};
  catalog.forEach((a) => { bySection[a.section] = (bySection[a.section] || 0) + 1; });
  check(Object.values(bySection).reduce((n, x) => n + x, 0) === catalog.length,
    `every area belongs to exactly one section (${AREA_SECTIONS.map((s: string) => `${s} ${bySection[s] || 0}`).join(", ")})`);

  // ---------- (4) single-switch rows look different ----------
  console.log("\n(4) rows that are just on or off:");
  const single = catalog.filter((a) => a.rights.length === 1 && !a.locked);
  const multi = catalog.filter((a) => a.rights.length > 1);
  check(single.length > 0 && multi.length > 0, `the catalog has both kinds (${single.length} single-right, ${multi.length} multi-right)`);
  // run the REAL renderer over the REAL catalog
  const portalSrc = readFileSync(resolve(__dirname, "..", "..", "public", "js", "portal.js"), "utf8");
  const body = portalSrc.slice(portalSrc.indexOf("        const RIGHT_LABEL = {"), portalSrc.indexOf('        return (data.sections || []).map(sectionTable).join("");'));
  const esc = (x: any) => String(x).replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  const full = Object.fromEntries(catalog.map((a) => [a.key, Object.fromEntries(a.rights.map((r: string) => [r, true]))]));
  // eslint-disable-next-line no-new-func
  const sectionTable = new Function("data", "esc", "role", "my", "editing", "App", body + "\nreturn sectionTable;")(
    { catalog }, esc, { permissions: full, editable: true }, full, false, { util: {} });
  const pages = sectionTable("Pages");
  check((pages.match(/<table/g) || []).length === 2,
    "a section holding both kinds renders TWO tables, so a lone tick never sits in column one of three");
  check(/<th>Access<\/th>/.test(pages) && /nothing partial to grant/.test(pages),
    "\u2026the on/off table has a single Access column and says there is nothing partial to grant");
  let colsOk = "";
  for (const sec of AREA_SECTIONS) {
    if (sec === "Settings") continue; // Settings is one deliberate roll-up
    const inSec = catalog.filter((a) => a.section === sec);
    const sigs = Array.from(new Set(inSec.map((a) => a.rights.join(","))));
    const want = sigs.reduce((n, s) => n + 1 + s.split(",").length, 0);
    const got = (sectionTable(sec).match(/<th[ >]/g) || []).length;
    if (want !== got) colsOk += ` ${sec}: expected ${want} headers, got ${got};`;
  }
  check(colsOk === "", `every table has one Area column plus exactly the rights its rows expose${colsOk}`);
  // PER-MODULE PERMISSIONS (authorised): the single control is gone, so the note that
  // described it is too. Same intent - the section explains itself - on the new truth.
  check(/One row per module this tenant has/.test(sectionTable("Modules")),
    "Modules explains that it now carries one row per module, named the way the tenant names it");

  // ---------- (5) custom roles and the ceiling ----------
  console.log("\n(5) custom roles:");
  const everything = Object.fromEntries(catalog.map((a) => [a.key, Object.fromEntries(a.rights.map((r: string) => [r, true]))]));
  const capped = capToCeiling(everything);
  const grantable = catalog.filter((a) => Object.keys(capped[a.key] || {}).some((r) => capped[a.key][r] === true));
  check(grantable.length >= catalog.length - 2,
    `a full grant survives the ceiling for essentially every area (${grantable.length} of ${catalog.length}) \u2014 creating a custom role is still fully checkable`);
  check(validateCustomRolePermissions(capped).ok === true, "\u2026and a ceiling-capped grant validates");
  const over: any = JSON.parse(JSON.stringify(everything));
  over.__not_an_area__ = { view: true };
  check(validateCustomRolePermissions(over).ok === false,
    "\u2026while a grant naming an area outside the catalog is refused \u2014 the ceiling cannot be exceeded by inventing keys");

  // ---------- (6) locked areas ----------
  console.log("\n(6) admin-managed areas:");
  const locked = catalog.filter((a) => a.locked);
  check(locked.length === 2 && locked.every((a) => !!a.lockedNote),
    `the two admin-managed areas still declare themselves locked, with their note (${locked.map((a) => a.label).join(", ")})`);
  const settingsHtml = sectionTable("Settings");
  check(locked.every((a) => settingsHtml.includes(esc(a.label))) && /admin-managed/.test(settingsHtml),
    "\u2026and appear in the Settings note as admin-managed rather than as toggles anyone can grant");

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exit(1); }
  console.log("ALL PASSED \u2705 (new headings, and the same access down to the last cell)");
  process.exit(0);
}

main();

export {};
