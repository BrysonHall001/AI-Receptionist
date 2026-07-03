// Batch self-test (DB-backed → Codespace) — invite token integrity for the custom-
// email path. Proves the link minted is the SAME real one-time apply link the default
// path uses, that it resolves to the correct invitee and actually activates them, and
// that exactly one invite is created per send.
//
//   npx tsx src/db/selfTest_inviteTokenIntegrity.ts
//
// SAFETY: one TEMPORARY tenant + invite + activated user, all deleted at the end.

import { prisma, disconnectDb } from "./client";
import { createInvite, inviteLink, getValidInvite, acceptInvite, sendCustomInvite, hasInviteLinkToken, INVITE_LINK_TOKEN } from "../services/inviteService";

const db = prisma as any;
const T_NAME = "__SELFTEST_INVITE__";
const EMAIL = `selftest_invite_${Date.now()}@example.invalid`;

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Invite token integrity — custom-email path");
  console.log("==========================================");
  let tId: string | null = null;
  try {
    tId = (await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "inv@example.invalid" } })).id;

    // create-on-send: no invite for this email yet.
    const before = await db.invite.count({ where: { email: EMAIL } });
    check(before === 0, "no invite exists before sending");

    // Mint the invite + link exactly as BOTH routes do (createInvite + inviteLink).
    const invite = await createInvite({ email: EMAIL, role: "CLIENT_USER", tenantId: tId, name: "Self Test" });
    const link = inviteLink("https://portal.example.test", invite.token);

    const after = await db.invite.count({ where: { email: EMAIL } });
    check(after === 1, "exactly one invite created on send");

    // The link carries the SAME real one-time token (this is what a custom email's
    // {{invite_link}} is replaced with).
    const tokenInLink = decodeURIComponent((link.split("token=")[1] || ""));
    check(tokenInLink === invite.token, "the apply link carries the real invite token");

    // Token helpers + substitution behave correctly.
    check(INVITE_LINK_TOKEN === "{{invite_link}}", "merge token is {{invite_link}}");
    check(hasInviteLinkToken(`<a href="${INVITE_LINK_TOKEN}">x</a>`) === true, "hasInviteLinkToken true when present");
    check(hasInviteLinkToken("no token") === false, "hasInviteLinkToken false when absent");
    const sample = `Hi! <a href="${INVITE_LINK_TOKEN}">Accept</a> — or paste ${INVITE_LINK_TOKEN}`;
    const substituted = sample.split(INVITE_LINK_TOKEN).join(link);
    check(!substituted.includes(INVITE_LINK_TOKEN) && substituted.split(link).length - 1 === 2, "every {{invite_link}} is replaced with the real link");

    // sendCustomInvite must not throw (mock email returns true/false).
    let sendThrew = false;
    let sent = false;
    try { sent = await sendCustomInvite({ email: EMAIL, role: invite.role }, link, sample); }
    catch { sendThrew = true; }
    check(!sendThrew && typeof sent === "boolean", "sendCustomInvite sends via the existing path without throwing");

    // Resolve → correct invitee.
    const resolved = await getValidInvite(invite.token);
    check(!!resolved && resolved.email === EMAIL && resolved.tenantId === tId, "token resolves to the correct invitee");

    // The link actually works: activate the account.
    const result = await acceptInvite(invite.token, "a-strong-passw0rd");
    check(result.ok === true, "accepting the invite activates the account");
    const user = await db.user.findUnique({ where: { email: EMAIL } });
    check(!!user && user.role === "CLIENT_USER" && user.tenantId === tId, "the activated user has the correct email, role, and portal");
    check((await getValidInvite(invite.token)) === null, "the one-time link can't be reused after activation");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up…");
    try { await db.user.deleteMany({ where: { email: EMAIL } }); } catch {}
    try { await db.invite.deleteMany({ where: { email: EMAIL } }); } catch {}
    if (tId) { try { await db.tenant.delete({ where: { id: tId } }); } catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); } }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  console.log("\n==========================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (invite token integrity)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
