// Static self-test (sandbox, fs-reads only) for: the Create-tenant wizard as a real
// client-side draft (all steps active, applied atomically on Finish), and the Tenants
// table fixes (split actions, separate Users column, shared manage-columns).
//   npx tsx src/db/selfTest_wizardTable.ts
import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;
function slice(s: string, a: string, b: string) { const i = s.indexOf(a); if (i === -1) return ""; const j = s.indexOf(b, i + a.length); return s.slice(i, j === -1 ? undefined : j); }

function main() {
  console.log("Create-tenant wizard (draft) + Tenants table");
  console.log("============================================");
  const admin = read("../../public/js/admin.js");
  const table = read("../../public/js/table.js");

  // ---------- (1) wizard is a real draft, no contradictions ----------
  console.log("(1) wizard collects a draft; steps active; atomic:");
  check(has(admin, "const draft = { users: []"), "wizard holds a client-side draft object");
  check(!has(admin, "Create tenant first") && !has(admin, "once the tenant is created") && !has(admin, "you can do this later"), "no greyed 'create first' / 'do this later' contradiction copy");
  check(has(admin, "Nothing is saved until you click Finish"), "intro states nothing is saved until Finish");
  const postCount = (admin.match(/\/api\/admin\/portals", \{ method: "POST"/g) || []).length;
  check(postCount === 1, "exactly one tenant-create POST (not per-step)");
  const finishBlock = slice(admin, "finish.onclick = async", "const back = el(");
  check(has(finishBlock, 'App.api("/api/admin/portals", { method: "POST"'), "the create POST lives in Finish");
  check(!has(admin, "function renderUsersStep"), "the old immediate-write users step is gone");

  // ---------- (2) steps 2-4 collect + apply on Finish ----------
  console.log("\n(2) each step collects into the draft and applies on Finish:");
  check(has(admin, "draft.users.push("), "Step 2 queues users into the draft");
  check(has(finishBlock, "/invites"), "Finish invites the queued users");
  check(has(admin, "THEME_PRESETS") && has(finishBlock, 'App.portalApi("/api/theme"'), "Step 3 theme applied on Finish");
  check(has(finishBlock, "voiceMode: draft.voiceMode"), "Step 4 receptionist mode applied on Finish");

  // ---------- (3) no silent partial failure ----------
  console.log("\n(3) partial-failure handling:");
  check(has(finishBlock, "problems.push(") && has(finishBlock, "Couldn't apply"), "Finish collects per-step failures and reports them");
  check(has(finishBlock, "enterPortal(portal)"), "Finish still enters the tenant (no orphan left silently)");

  // ---------- (4) Tenants table: split actions + Users column + manage-columns ----------
  console.log("\n(4) Tenants table fixes:");
  check(has(admin, "const handle = App.table.mount("), "table handle captured");
  check(has(admin, "App.table.manageColumns(handle"), "manage-columns wired via the shared App.table helper");
  const manageCol = slice(admin, 'key: "manage"', 'key: "actions"');
  check(has(manageCol, 'data-act="users"'), "Users is its own column (opens the users view)");
  const actionsCol = slice(admin, 'key: "actions"', "];");
  check(has(actionsCol, "white-space:nowrap") && has(actionsCol, "inline-flex"), "Open/Suspend are side by side (no vertical stacking)");
  check(!has(actionsCol, "flex-wrap:wrap"), "old stacked (flex-wrap) actions removed");

  // ---------- (5) shared manage-columns component lives in App.table ----------
  console.log("\n(5) shared manage-columns component:");
  check(has(table, "manageColumns: mountColumnManager") && has(table, "applyColumnLayout"), "App.table exports the shared manage-columns helper");
  check(has(table, "function openColumnManager") && has(table, "Manage columns"), "same show/hide + drag-reorder popup as elsewhere");

  console.log("\n============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (wizard draft + table)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
