// Static self-test (sandbox) for: (1) the master-hub invite composer using a SELF-scoped
// signature/templates/merge-tags source (App.api) instead of the portal-scoped default,
// and (2) the Tenants caption aligned to the same 18px gutter as the toolbar + table.
//   npx tsx src/db/selfTest_composeScopeAndCaption.ts
import { readFileSync } from "fs";
import { resolve } from "path";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;

function main() {
  console.log("Compose signature scope + Tenants caption alignment");
  console.log("===================================================");
  const compose = read("../../public/js/compose.js");
  const admin = read("../../public/js/admin.js");
  const portal = read("../../public/js/portal.js");
  const css = read("../../public/styles.css");

  console.log("(1) composer scope option:");
  check(has(compose, "const scopeApi = opts.scopeApi || App.portalApi"), "mount() has a scopeApi option (defaults to portal-scoped)");
  check(has(compose, 'const r = await scopeApi("/api/account/signature")') && !has(compose, 'await App.portalApi("/api/account/signature")'), "Insert signature goes through scopeApi (not hard-coded portalApi)");
  check(has(compose, 'templates = await scopeApi("/api/templates?kind=" + kind)'), "Templates load goes through scopeApi");
  check(has(compose, "loadMergeTags(scopeApi)") && has(compose, "async function loadMergeTags(scopeApi)"), "Merge tags load goes through scopeApi (cache bypassed for non-portal scope)");
  check(has(compose, "scopeApi: opts.selfScope ? App.api : undefined"), "openInviteComposer maps selfScope -> App.api (self) vs portal default");

  console.log("\n(2) callers use the right scope:");
  check(/App\.inviteComposer\.open\(\{\s*email,\s*selfScope: true/.test(admin), "master-hub invite (admin.js) passes selfScope: true");
  check(!/App\.inviteComposer\.open\(\{[^}]*selfScope/.test(portal), "portal invite (portal.js) does NOT pass selfScope (stays portal-scoped)");

  console.log("\n(3) caption alignment (18px gutter, matching toolbar + table):");
  check(/\.toolbar-left\s*\{[^}]*padding-left:\s*18px/.test(css), "CSS: .toolbar-left is indented 18px (Filters gutter)");
  check(/tbody td\s*\{\s*padding:\s*13px 18px/.test(css), "CSS: table cells use an 18px left gutter");
  check(/\.card\s*\{(?:(?!padding)[^}])*\}/.test(css), "CSS: .card has NO padding (table is flush in its container)");
  check(has(admin, 'margin:4px 0 10px 18px'), "caption margin-left is 18px (flush with Filters + first column), not 0");

  console.log("\n===================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
