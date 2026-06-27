// Batch self-test (static/structural, sandbox-runnable) — custom-email invitations
// wired in BOTH places through ONE shared composer + the existing invite endpoints,
// plus removal of the stray "No fields yet" line. Token integrity at runtime is in
// selfTest_inviteTokenIntegrity.ts (DB-backed).
//
//   npx tsx src/db/selfTest_inviteCustomEmail.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

function main() {
  console.log("Custom-email invitations + Fields fix");
  console.log("=====================================");

  const compose = read("../../public/js/compose.js");
  const portal = read("../../public/js/portal.js");
  const admin = read("../../public/js/admin.js");
  const api = read("../routes/api.ts");
  const adminRoutes = read("../routes/admin.ts");
  const inviteSvc = read("../services/inviteService.ts");

  // ---------- (1) the merge token agrees across client + server ----------
  console.log("(1) merge token:");
  check(/export const INVITE_LINK_TOKEN = "\{\{invite_link\}\}"/.test(inviteSvc), "server token is {{invite_link}}");
  check(/export function hasInviteLinkToken\([\s\S]*?\.includes\(INVITE_LINK_TOKEN\)/.test(inviteSvc), "hasInviteLinkToken checks for the token");
  check(/const INVITE_LINK_TOKEN = "\{\{invite_link\}\}"/.test(compose), "client token matches server token");

  // ---------- (2) ONE shared composer (no duplicate implementation) ----------
  console.log("\n(2) shared composer:");
  check(/function openInviteComposer\(opts\)/.test(compose), "single openInviteComposer in compose.js");
  check(/App\.inviteComposer = \{ open: openInviteComposer/.test(compose), "exposed as App.inviteComposer.open");
  check(/App\.compose\.mount\(composerHost, \{ kind: "email" \}\)/.test(compose), "reuses App.compose (same toolbar/CTA/link)");
  check(/api\.appendHtml\(`<a href="\$\{INVITE_LINK_TOKEN\}">/.test(compose), "Insert-invite-link control drops the token in");
  check(/indexOf\(INVITE_LINK_TOKEN\) === -1[\s\S]*?doesn't include the invite link/.test(compose), "client blocks send when the token is missing (clear warning)");
  // The composer itself never POSTs — it delegates the actual send to opts.send,
  // so opening + abandoning creates nothing (create-on-send).
  check(!/portalApi|App\.api\(/.test(compose.slice(compose.indexOf("function openInviteComposer"), compose.indexOf("App.inviteComposer ="))), "composer does not create the invite itself (only opts.send does)");

  // ---------- (3) portal (Team & Permissions) uses it ----------
  console.log("\n(3) portal invite:");
  check(/id="nu-custom"[^>]*>Write custom email</.test(portal), "portal has a 'Write custom email' button");
  check(/We'll email them an invite link automatically — or write a custom email/.test(portal), "portal tagline updated");
  check(/id="nu-role"[^>]*style="flex:0 0 160px"/.test(portal), "role dropdown shortened");
  check(/#nu-custom"\)\.onclick[\s\S]*?App\.inviteComposer\.open\(\{[\s\S]*?App\.portalApi\("\/api\/users"[\s\S]*?customHtml/.test(portal), "custom button opens the shared composer and posts customHtml to /api/users");
  check(/id="nu-add"[^>]*>Send invite</.test(portal), "default 'Send invite' button still present (unchanged path)");

  // ---------- (4) master-hub (Users modal) uses it ----------
  console.log("\n(4) master-hub invite:");
  check(/id="cu-custom"[^>]*>Write custom email</.test(admin), "master modal has a 'Write custom email' button");
  check(/We'll email them an invite link automatically — or write a custom email/.test(admin), "master text updated (auto only if no custom)");
  check(/#cu-custom"\)\.onclick[\s\S]*?App\.inviteComposer\.open\(\{[\s\S]*?customHtml/.test(admin), "custom button opens the SAME shared composer");
  check(/\/api\/admin\/users"[\s\S]{0,200}?customHtml|customHtml[\s\S]{0,200}?\/api\/admin\/users/.test(admin) || /payload[\s\S]*?\/api\/admin\/users/.test(admin), "posts customHtml through the same admin/users + per-portal endpoints");

  // ---------- (5) server: same token + outbound path; create-on-send safe ----------
  console.log("\n(5) server endpoints:");
  check(/export async function sendCustomInvite/.test(inviteSvc), "sendCustomInvite added");
  check(/String\(rawHtml \|\| ""\)\.split\(INVITE_LINK_TOKEN\)\.join\(link\)/.test(inviteSvc), "every {{invite_link}} replaced with the real one-time link");
  check(/sendRichEmail\(\{[\s\S]*?fromEmail: env\.RESEND_FROM/.test(inviteSvc), "custom send uses the EXISTING outbound path (sendRichEmail / RESEND_FROM)");
  // both routes validate the token BEFORE createInvite (so a missing-link custom
  // request mints nothing), then branch default-vs-custom on the SAME link.
  for (const [nm, src] of [["api.ts", api], ["admin.ts", adminRoutes]] as const) {
    const checkIdx = src.indexOf("hasInviteLinkToken(customHtml)");
    const createIdx = src.indexOf("createInvite(");
    check(checkIdx !== -1 && createIdx !== -1 && checkIdx < createIdx, `${nm}: token check happens before createInvite (no half-created invite)`);
    check(/isCustom[\s\S]*?sendCustomInvite\([\s\S]*?: await sendInvite\(/.test(src), `${nm}: sends custom-or-default with the same minted link`);
  }

  // ---------- (6) Fields fix: stray empty-state line gone ----------
  console.log("\n(6) Fields empty-state:");
  check(!/No fields yet for this type/.test(portal), "the 'No fields yet for this type' line is removed");
  check(/if \(!fields\.length\) \{[\s\S]*?subtypesCard\(\)\); wrap\.appendChild\(statusesCard\(\)/.test(portal), "pipelines/stages still render when there are no custom fields");

  console.log("\n=====================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (custom invite + fields fix)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
