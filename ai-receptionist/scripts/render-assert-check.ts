// RENDERED-ASSERTION CHECK. `npm run check-assertions` evaluates assertions over source
// TEXT; it cannot see assertions over rendered MARKUP, and those have now broken twice.
// This renders the permissions tables from the real code and evaluates the suites' header
// assertions exactly as written - conditions and negations intact.
//
// Run it after changing anything that builds those tables:  npx tsx scripts/render-assert-check.ts
// Evaluate the two suites' header assertions EXACTLY as written - conditions and negations
// intact, no tautologies, nothing suppressed.
const Module = require("module"); const orig = (Module as any)._load;
(Module as any)._load = function (r: string, p: any, m: boolean) {
  if (r.endsWith("db/client")) return { prisma: {} };
  if (r.endsWith("./portalService")) return { getLockedPages: async () => [] };
  return orig.apply(this, [r, p, m]);
};
const S = require(require("path").resolve("src/services/permissionService.ts"));
const fs = require("fs");
const catalog = S.getPermissionCatalog();
const portal = fs.readFileSync("public/js/portal.js", "utf8");
const body = portal.slice(portal.indexOf("        const RIGHT_LABEL = {"), portal.indexOf('        return (data.sections || []).map(sectionTable).join("");'));
const full = Object.fromEntries(catalog.map((a: any) => [a.key, Object.fromEntries(a.rights.map((r: string) => [r, true]))]));
const st = new Function("data", "esc", "role", "my", "editing", "App", body + "\nreturn sectionTable;")(
  { catalog }, (x: any) => String(x), { permissions: full, editable: true }, full, false, { util: {} });

let bad = 0; const T = (c: boolean, m: string) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) bad++; };
const pages = st("Pages"), pagesHtml = pages;

// selfTest_permissionsRegroup:104-105, verbatim
T((pages.match(/<table/g) || []).length === 2, "regroup: a section holding both kinds renders TWO tables");
T(/<th[^>]*>Access<\/th>/.test(pages) && /nothing partial to grant/.test(pages),
  "regroup: the on/off table has a single Access column and says there is nothing partial to grant");
// selfTest_permissionsHonesty:96,100, verbatim (including the negation)
T(/<th[^>]*>Access<\/th>/.test(pagesHtml) && !/SECTION_COLS/.test(body),
  "honesty: a single-right area renders one 'Access' column, and no column is chosen by section name");
T(/<th[^>]*>View<\/th><th[^>]*>Edit<\/th><th[^>]*>Delete<\/th>/.test(pagesHtml) && !/<th[^>]*>Manage<\/th>/.test(pagesHtml),
  "honesty: a three-right area renders View/Edit/Delete and nothing else");
// and the header-count invariant both suites share
for (const sec of S.AREA_SECTIONS) {
  if (sec === "Settings") continue;
  const inSec = catalog.filter((a: any) => a.section === sec);
  // Set<unknown> unless the element type is stated - catalog comes from a require(), so it
  // is `any` and the inference collapses. This is the line that failed `tsc --noEmit`.
  const sigs: string[] = Array.from(new Set<string>(inSec.map((a: any) => String(a.rights.join(",")))));
  const want: number = sigs.reduce((n: number, sig: string) => n + 1 + sig.split(",").length, 0);
  const got = (st(sec).match(/<th[ >]/g) || []).length;
  T(want === got, `header count for ${sec}: ${want} expected, ${got} rendered`);
}
console.log(bad ? `\n  ${bad} FAILED` : "\n  EVERY HEADER ASSERTION MATCHES THE REAL RENDER");
process.exit(bad ? 1 : 0);
