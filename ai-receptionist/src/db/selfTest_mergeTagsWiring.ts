// Batch self-test (static, sandbox-runnable) — merge tags wired into the SHARED
// composer + EVERY send path, the richer template picker, and the Email Templates
// master-detail. Runtime resolution is proven in selfTest_mergeResolve.ts (DB-backed).
//
//   npx tsx src/db/selfTest_mergeTagsWiring.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

function main() {
  console.log("Merge tags + Email Templates polish");
  console.log("===================================");

  const merge = read("../services/mergeTags.ts");
  const comm = read("../services/communicationService.ts");
  const survey = read("../services/surveyBlastService.ts");
  const actions = read("../automation/actions.ts");
  const invite = read("../services/inviteService.ts");
  const compose = read("../../public/js/compose.js");
  const communication = read("../../public/js/communication.js");

  // ---------- (1) the shared resolver ----------
  console.log("(1) shared resolver (mergeTags.ts):");
  check(/export function resolveMergeTags/.test(merge), "resolveMergeTags exists");
  check(/return fallback != null \? fallback : "";/.test(merge), "value -> fallback -> '' (never a raw token)");
  check(/\{\{\s\*\?\(\[a-zA-Z0-9_\]\+\)\s\*\?\(\?:\\\|\(\[\^}\]\*\)\)\?\}\}/.test(merge.replace(/\\\\/g, "\\")) || /\(\?:\\\|\(\[\^\}\]\*\)\)\?/.test(merge), "{{key|fallback}} syntax supported");
  check(/export function contactMergeValues/.test(merge) && /first_name/.test(merge) && /last_name/.test(merge), "contactMergeValues derives first/last name");
  check(/templateContext\(/.test(merge), "reuses the existing field resolution (templateContext)");
  check(/export function availableMergeTags/.test(merge), "availableMergeTags for the picker");

  // ---------- (2) every send path resolves per recipient ----------
  console.log("\n(2) send paths resolve at send:");
  check(/contactMergeResolver\(input\.tenantId\)/.test(comm), "email blast builds a per-tenant resolver");
  check(/resolver\.apply\(input\.subject, contact\)[\s\S]*?resolver\.apply\(input\.html[\s\S]*?contact\)/.test(comm), "email blast resolves SUBJECT + body for contacts");
  check(/resolver\.apply\(input\.subject, null\)[\s\S]*?resolver\.apply\(input\.html[\s\S]*?null\)/.test(comm), "typed addresses resolve with no contact (fallback only)");
  check(/resolver\.apply\(personalize\(input\.html, url\), contact\)/.test(survey), "survey blast resolves AFTER the survey link (no token clash)");
  check(/resolveMergeTags\(subject, tmpl\)[\s\S]*?resolveMergeTags\(html, tmpl\)/.test(actions), "automation email uses the fallback-aware resolver");
  check(/const html = resolveMergeTags\(linked, \{\}\)/.test(invite), "invite custom email collapses tags (no contact identity)");
  check(/resolver\.apply\(personalize\(input\.html, sampleUrl\), sample\)/.test(survey), "preview/test resolves against a sample (current user)");

  // ---------- (3) composer: insert control + picker from real fields ----------
  console.log("\n(3) composer merge-tag control:");
  check(/class="ql-merge"|"ql-merge"/.test(compose) && /Insert merge tag/.test(compose), "toolbar has an Insert-merge-tag control");
  check(/function openMergeTagPicker/.test(compose), "picker exists");
  check(/App\.portalApi\("\/api\/fields\?recordType=contact"\)/.test(compose), "picker is built from REAL contact field definitions");
  check(/"\{\{" \+ t\.key \+ \(f \? "\|" \+ f : ""\) \+ "\}\}"/.test(compose), "inserts {{key}} or {{key|fallback}} with stable keys");
  check(/quill\.insertText\(idx, token, "user"\)/.test(compose), "token is inserted as plain text (survives save/reload)");

  // ---------- (4) richer template picker ----------
  console.log("\n(4) richer template picker:");
  check(/function stripPreview/.test(compose), "preview snippet (HTML stripped)");
  check(/Search templates/.test(compose), "picker is searchable");
  check(/t\.name[\s\S]{0,60}?includes\(q\)[\s\S]{0,40}?t\.tag[\s\S]{0,40}?includes\(q\)/.test(compose), "filters by name and tag");
  check(/tagPill[\s\S]*?pill/.test(compose), "shows the tag as a pill");

  // ---------- (5) Email Templates master-detail ----------
  console.log("\n(5) Email Templates tab:");
  check(/\["templates", "Email Templates"\]/.test(communication), "tab renamed to 'Email Templates' (key unchanged)");
  check(/survey-split[\s\S]*?survey-master[\s\S]*?survey-detail/.test(communication), "library-left / editor-right split (mirrors Surveys)");
  check(/leftPane\.appendChild\(libCard\)[\s\S]*?rightPane\.appendChild\(card\)/.test(communication), "library in left pane, editor in right pane");
  check(/\+ New template/.test(communication) && /libNewBtn\.onclick = \(\) => \{ setEdit\(null\)/.test(communication), "'+ New template' clears the editor (new, cleared id)");
  check(/if \(state\.id\) await App\.portalApi\("\/api\/templates\/"/.test(communication), "Save UPDATES the bound row (no duplicate)");

  const api = read("../routes/api.ts");
  check(/contactMergeValues\(contact, await loadFieldDefs\(tenantId\)\)[\s\S]*?resolveMergeTags\(subject, mergeVals\)/.test(api), "single-contact email resolves merge tags (no raw token in transactional sends)");

  console.log("\n===================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (merge tags + templates)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
