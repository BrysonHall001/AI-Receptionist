// Static self-test (sandbox, fs-reads only) for the Create-a-Tenant overhaul:
// dead-field removal, optional notify email, identity-rule hard-set, /api/settings drift
// fix, atomic creation (POST only on Finish), and the Learning Center note.
//   npx tsx src/db/selfTest_createFlowCleanup.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;
function slice(s: string, start: string, end: string) {
  const i = s.indexOf(start); if (i === -1) return "";
  const j = s.indexOf(end, i + start.length);
  return s.slice(i, j === -1 ? undefined : j);
}

function main() {
  console.log("Create-a-Tenant overhaul");
  console.log("========================");
  const admin = read("../../public/js/admin.js");
  const adminTs = read("../routes/admin.ts");
  const apiTs = read("../routes/api.ts");
  const svc = read("../services/portalService.ts");
  const contact = read("../services/contactService.ts");
  const learn = read("../../public/js/learn.js");

  // ---------- (1) dead fields removed from the create screen ----------
  console.log("(1) create screen: dead fields + identity dropdown removed:");
  for (const id of ["sp-type", "sp-phone", "sp-greet", "sp-rule"]) check(!has(admin, id), `#${id} removed from create screen`);
  check(!has(admin, "Contact identity rule") && !has(admin, "Require unique email"), "identity-rule dropdown removed from create screen");
  check(has(admin, "sp-name") && has(admin, "sp-email"), "Name + Notify email fields kept");

  // ---------- (2) atomic creation: POST only on Finish ----------
  console.log("\n(2) atomic creation (tenant written only on Finish):");
  const postCount = (admin.match(/\/api\/admin\/portals", \{ method: "POST"/g) || []).length;
  check(postCount === 1, "exactly one create POST in the setup screen");
  check(has(admin, 'body: JSON.stringify({ name, notifyEmail, lockedPages: draft.lockedPages }) })'), "create POST body is { name, notifyEmail, lockedPages }");
  const finishBlock = slice(admin, "finish.onclick = async", "const back = el(");
  check(has(finishBlock, 'method: "POST"'), "the create POST lives in the Finish handler");
  check(!has(admin, '"Create tenant");') || !has(admin, "go.onclick"), "old step-1 inline create button removed");
  check(has(admin, "Nothing is saved until you click Finish") || has(admin, "Nothing is created until you click"), "screen tells the user nothing is saved until Finish");

  // ---------- (3) notify email optional ----------
  console.log("\n(3) notify email optional:");
  check(!has(admin, "Name and notify email are required"), "client no longer requires notify email");
  check(has(admin, "Business name is required"), "client requires only the name");
  const post = slice(adminTs, 'adminRouter.post("/portals"', "adminRouter.patch");
  check(has(post, "if (!name) {") && !has(post, "|| !notifyEmail"), "server POST requires only name");

  // ---------- (4) dead fields not written server-side ----------
  console.log("\n(4) server no longer writes dead fields:");
  const createFn = slice(svc, "export async function createPortal", "export async function updatePortal");
  check(!has(createFn, "greeting:") && !has(createFn, "businessType:") && !has(createFn, "requireEmail:"), "createPortal writes neither greeting/businessType/requireEmail");
  const settings = slice(apiTs, 'apiRouter.patch("/settings"', "auditEvent(req, tenantId, EVENT_TYPES.SettingChanged");
  check(has(settings, "const { name, notifyEmail } =") && has(settings, "updatePortal(tenantId, { name, notifyEmail })"), "/api/settings forwards only name + notifyEmail");

  // ---------- (5) identity rule hard-set + not settable ----------
  console.log("\n(5) requireEmail hard-set on, not settable:");
  const trq = slice(contact, "async function tenantRequiresEmail", "/** Case-insensitive");
  check(has(trq, "return true;"), "tenantRequiresEmail is hard-set to true");
  check(has(post, "const { name, notifyEmail, lockedPages } =") && has(post, "createPortal({ name, notifyEmail:"), "admin POST accepts name/notifyEmail/lockedPages");
  const patch = slice(adminTs, 'adminRouter.patch("/portals/:id"', "adminRouter.get");
  check(!has(patch, "data.requireEmail =") && !has(patch, '"businessType"') && !has(patch, '"greeting"'), "admin PATCH drops requireEmail + dead businessType/greeting");

  // ---------- (6) Learning Center note ----------
  console.log("\n(6) Learning Center identity note (tenant-facing):");
  check(has(learn, 'id: "contact-identity"'), "identity guide present in the Learning Center");
  check(has(learn, "must have a unique email") && has(learn, "saved by phone number"), "note explains email rule + phone-call exemption");

  console.log("\n========================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (create-flow overhaul)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
