// Self-test — 3B email deliverability: Svix signature verification, the Resend
// delivery-event state machine (ordering + terminal-state guards), and structural
// wiring (raw-body public webhook, optional secret, OWNER/SUPER_ADMIN gating, dashboard).
//
//   npx tsx src/db/selfTest_emailDeliverability.ts
//
// The DB section uses ONE temporary EmailLog row cluster and cleans up after.

import { readFileSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";
import { prisma, disconnectDb } from "./client";
import { verifyResendSignature } from "../routes/resendWebhook";
import { applyResendEvent, listGroupedEmailSends, listEmailSendRecipients } from "../services/emailLogService";

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;

// Build a valid Svix signature for a payload with a given secret + timestamp.
function sign(payload: string, secret: string, id: string, ts: number): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${payload}`, "utf8").digest("base64");
  return "v1," + sig;
}

async function main() {
  console.log("3B — Email deliverability (signature + events + wiring)");
  console.log("======================================================");

  // ---------- (1) Svix signature algorithm correctness (non-circular, official vector) ----------
  console.log("(1) Svix HMAC scheme matches the published test vector:");
  {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
    const ts = "1614265330";
    const payload = '{"test": 2432232314}';
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const got = "v1," + crypto.createHmac("sha256", key).update(`${id}.${ts}.${payload}`, "utf8").digest("base64");
    check(got === "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=", "HMAC-SHA256 over id.timestamp.rawBody equals Svix's documented signature");
  }

  // ---------- (2) verifyResendSignature behavior (fresh timestamp within tolerance) ----------
  console.log("\n(2) verifyResendSignature accepts good, rejects tampered/stale/missing:");
  {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const id = "msg_test";
    const now = Math.floor(Date.now() / 1000);
    const payload = '{"type":"email.delivered","data":{"email_id":"em_x"}}';
    const good = sign(payload, secret, id, now);
    const H = (sig: string, ts: number = now, mid: string = id) => ({ "svix-id": mid, "svix-timestamp": String(ts), "svix-signature": sig });

    check(verifyResendSignature(payload, H(good), secret) === true, "valid signature passes");
    check(verifyResendSignature(payload + " ", H(good), secret) === false, "tampered body fails");
    check(verifyResendSignature(payload, H("v1,AAAA"), secret) === false, "wrong signature fails");
    check(verifyResendSignature(payload, H(good), "whsec_" + Buffer.from("different-key").toString("base64")) === false, "wrong secret fails");
    check(verifyResendSignature(payload, { "svix-id": id, "svix-signature": good } as any, secret) === false, "missing svix-timestamp fails");
    check(verifyResendSignature(payload, H(good, now - 60 * 20), secret) === false, "stale timestamp (20 min) fails tolerance check");
    // multiple space-separated tokens: one valid among junk still passes (key rotation)
    check(verifyResendSignature(payload, H("v1,deadbeef " + good), secret) === true, "one valid token among several passes (rotation)");
    check(verifyResendSignature(payload, H(good), "") === false, "empty secret fails");
  }

  // ---------- (3) applyResendEvent state machine (DB) ----------
  console.log("\n(3) delivery-event state machine (ordering + terminal guards):");
  let dbOk = true;
  const MID = "em_selftest_3b_" + Date.now();
  let logId: string | null = null;
  try {
    const row = await db.emailLog.create({ data: { type: "single", toEmail: "d@example.invalid", subject: "s", status: "sent", providerMessageId: MID } });
    logId = row.id;
    const at = (min: number) => new Date(Date.now() + min * 60000).toISOString();
    const ev = (type: string, mins: number, extra: any = {}) => ({ type, created_at: at(mins), data: { email_id: MID, ...extra } });
    const reload = async () => db.emailLog.findUnique({ where: { id: logId } });

    check((await applyResendEvent(ev("email.delivered", 1))) === "updated", "delivered event applies");
    let r = await reload();
    check(r.deliveryStatus === "delivered" && !!r.lastEventAt, "-> deliveryStatus 'delivered', lastEventAt set");

    check((await applyResendEvent(ev("email.opened", 2))) === "updated", "opened event applies (later)");
    r = await reload();
    check(r.deliveryStatus === "opened" && !!r.openedAt, "-> deliveryStatus 'opened', openedAt set");

    check((await applyResendEvent(ev("email.clicked", 3))) === "updated", "clicked event applies (later)");
    r = await reload();
    check(r.deliveryStatus === "clicked", "-> deliveryStatus 'clicked'");

    // Out-of-order: an OLDER delivered event must NOT regress clicked.
    check((await applyResendEvent(ev("email.delivered", 0))) === "ignored", "older (out-of-order) event is ignored");
    r = await reload();
    check(r.deliveryStatus === "clicked", "-> deliveryStatus still 'clicked' (no regress from stale event)");

    // Bounce wins (terminal), carries a detail.
    check((await applyResendEvent(ev("email.bounced", 4, { bounce: { type: "Permanent", subType: "General", message: "mailbox not found" } }))) === "updated", "bounced event applies");
    r = await reload();
    check(r.deliveryStatus === "bounced" && /mailbox not found/.test(r.deliveryDetail || ""), "-> deliveryStatus 'bounced' + deliveryDetail captured");

    // A later opened after bounced must NOT overwrite the terminal state.
    check((await applyResendEvent(ev("email.opened", 5))) === "updated", "post-bounce opened still processed");
    r = await reload();
    check(r.deliveryStatus === "bounced", "-> terminal 'bounced' NOT overwritten by a later open");

    // A later delivered after bounced must NOT overwrite either.
    await applyResendEvent(ev("email.delivered", 6));
    r = await reload();
    check(r.deliveryStatus === "bounced", "-> terminal 'bounced' NOT overwritten by a later delivered");

    // Unknown email_id -> graceful no_match.
    check((await applyResendEvent({ type: "email.delivered", created_at: at(1), data: { email_id: "em_does_not_exist" } })) === "no_match", "unknown email_id -> no_match (ignored gracefully)");
    // Unknown type -> ignored.
    check((await applyResendEvent({ type: "email.unknown", created_at: at(1), data: { email_id: MID } })) === "ignored", "unknown event type -> ignored");
    // Missing email_id -> ignored.
    check((await applyResendEvent({ type: "email.delivered", data: {} } as any)) === "ignored", "missing email_id -> ignored");
  } catch (e) {
    dbOk = false;
    console.log("   (DB section skipped/failed: " + (e as Error).message + ")");
    failures.push("DB section error: " + (e as Error).message);
  } finally {
    if (logId) { try { await db.emailLog.delete({ where: { id: logId } }); } catch {} }
  }

  // ---------- (3b) Level-1 grouping + Level-2 recipient lookup (DB) ----------
  console.log("\n(3b) send grouping (Level 1) + per-send recipients (Level 2):");
  const GTAG = "grp_" + Date.now();
  const cid = "cs_" + GTAG;
  const madeIds: string[] = [];
  try {
    // A blast: 3 recipients sharing one communicationSendId.
    for (let i = 0; i < 3; i++) {
      const row = await db.emailLog.create({ data: { type: "email_blast", toEmail: `b${i}.${GTAG}@example.invalid`, subject: "Blast " + GTAG, status: "mock", communicationSendId: cid } });
      madeIds.push(row.id);
    }
    // Two one-off sends (no communicationSendId) -> each its own single-recipient send.
    const single1 = await db.emailLog.create({ data: { type: "password_reset", toEmail: `s1.${GTAG}@example.invalid`, subject: "Reset " + GTAG, status: "sent" } });
    const single2 = await db.emailLog.create({ data: { type: "call_summary", toEmail: `s2.${GTAG}@example.invalid`, subject: "Call " + GTAG, status: "sent" } });
    madeIds.push(single1.id, single2.id);

    const groups = await listGroupedEmailSends();
    const mine = groups.filter((g: any) => String(g.subject || "").includes(GTAG) || g.groupKey === "send:" + cid || g.groupKey === "single:" + single1.id || g.groupKey === "single:" + single2.id);
    check(mine.length === 3, `3 send-groups for this batch: 1 blast + 2 one-offs (got ${mine.length})`);
    const blast = mine.find((g: any) => g.groupKey === "send:" + cid);
    check(!!blast && blast.recipientCount === 3, "blast collapses to ONE row with recipientCount 3");
    const singles = mine.filter((g: any) => g.groupKey.startsWith("single:"));
    check(singles.length === 2 && singles.every((g: any) => g.recipientCount === 1), "each one-off send is a single-recipient group (recipientCount 1)");

    const blastRecips = await listEmailSendRecipients("send:" + cid);
    check(blastRecips.length === 3, `Level 2: blast group returns its 3 recipients (got ${blastRecips.length})`);
    const singleRecips = await listEmailSendRecipients("single:" + single1.id);
    check(singleRecips.length === 1 && singleRecips[0].toEmail.includes(GTAG), "Level 2: a single-recipient send returns a ONE-row recipient list (not skipped)");
    check((await listEmailSendRecipients("send:cs_does_not_exist")).length === 0, "Level 2: unknown group -> empty list (graceful)");
  } catch (e) {
    console.log("   (grouping DB section failed: " + (e as Error).message + ")");
    failures.push("grouping DB section error: " + (e as Error).message);
  } finally {
    for (const id of madeIds) { try { await db.emailLog.delete({ where: { id } }); } catch {} }
  }

  // ---------- (4) structural wiring ----------
  console.log("\n(4) structural wiring (raw webhook, optional secret, gating, dashboard):");
  const appTs = read("../app.ts");
  check(/express\.raw\([\s\S]*?\/webhooks\/resend|\/webhooks\/resend[\s\S]*?express\.raw/.test(appTs) || (has(appTs, '"/webhooks/resend"') && has(appTs, "express.raw")), "app.ts mounts /webhooks/resend with express.raw");
  const rawIdx = appTs.indexOf("/webhooks/resend");
  const jsonIdx = appTs.indexOf("express.json");
  check(rawIdx !== -1 && jsonIdx !== -1 && rawIdx < jsonIdx, "raw webhook is mounted BEFORE the global express.json parser");
  check(rawIdx < appTs.indexOf("app.use(attachUser"), "webhook is mounted before attachUser middleware (NOT behind auth)");

  const hook = read("../routes/resendWebhook.ts");
  check(has(hook, "env.RESEND_WEBHOOK_SECRET"), "webhook reads env.RESEND_WEBHOOK_SECRET");
  check(has(hook, "svix-id") && has(hook, "svix-timestamp") && has(hook, "svix-signature"), "verifies the three svix-* headers");
  check(has(hook, "status(200)") && has(hook, "no_secret"), "unset secret -> 200 no-op");
  check(has(hook, "status(400)"), "invalid signature -> 400");
  check(has(hook, "timingSafeEqual"), "uses constant-time signature comparison");

  const envTs = read("../config/env.ts");
  check(/RESEND_WEBHOOK_SECRET:\s*z\.string\(\)\.default\(""\)/.test(envTs), "RESEND_WEBHOOK_SECRET is OPTIONAL (default \"\") — app still boots without it");

  const adminTs = read("../routes/admin.ts");
  check(/email-logs"[\s\S]*?requireRole\("OWNER", "SUPER_ADMIN"\)/.test(adminTs), "/email-logs endpoint is gated requireRole(OWNER, SUPER_ADMIN)");

  const appJs = read("../../public/js/app.js");
  check(has(appJs, '["#/admin/email", "Email"]'), "app.js ADMIN_NAV includes the Email item");
  check(has(appJs, 'it[0] !== "#/admin/email"') && has(appJs, 'me.role === "OWNER" || me.role === "SUPER_ADMIN"'), "Email nav item hidden from non-OWNER/SUPER_ADMIN");
  check(has(appJs, '"#/admin/email": "Email"'), "titleMap has Email");
  check(has(appJs, 'path === "/admin/email" ? "email"'), "router dispatches /admin/email");

  const adminJs = read("../../public/js/admin.js");
  const sliceFn = (name: string, until: string) => { const i = adminJs.indexOf(name); if (i === -1) return ""; const j = adminJs.indexOf(until, i + name.length); return adminJs.slice(i, j === -1 ? undefined : j); };
  check(has(adminJs, 'if (v === "email") return renderEmail()'), "admin render() dispatches to renderEmail");

  // LEVEL 1 — one row per SEND, no Type column, click -> recipient list (not detail).
  const lvl1 = sliceFn("async function renderEmail(", "async function renderEmailRecipients");
  check(has(lvl1, "/api/admin/email-logs") && has(lvl1, "App.table.mount("), "Level 1 renders grouped sends via App.table");
  check(has(lvl1, "onRowClick: (r) => renderEmailRecipients(r)"), "Level 1 row click opens the recipient list (Level 2), not detail");
  check(has(lvl1, "rowId: (r) => r.groupKey"), "Level 1 rows keyed by send groupKey");
  for (const col of ['"Date"', '"Tenant"', '"Sent by"', '"Subject"', '"Recipients"', '"Status"']) {
    check(has(lvl1, "label: " + col), `Level 1 column present: ${col}`);
  }
  check(!has(lvl1, 'label: "Type"'), "Level 1 has NO Type column (removed)");
  check(!has(lvl1, 'label: "To"'), "Level 1 has NO per-recipient To column (grouped now)");
  check(has(lvl1, "recipient") && has(lvl1, "recipientCount"), "Level 1 Status is a simple recipient-count summary");

  // LEVEL 2 — recipient list for one send; always shown; click -> detail (Level 3).
  const lvl2 = sliceFn("async function renderEmailRecipients", "// LEVEL 3");
  check(has(adminJs, "async function renderEmailRecipients"), "Level 2 renderEmailRecipients exists");
  check(has(lvl2, "/api/admin/email-logs/recipients?group=") && has(lvl2, "encodeURIComponent(group.groupKey)"), "Level 2 fetches recipients for the send group");
  check(has(lvl2, "onRowClick: (r) => renderEmailDetail(r, () => renderEmailRecipients(group))"), "Level 2 row click opens detail with Back-to-recipients");
  check(has(lvl2, '"\\u2190 Back to Email"'), "Level 2 has Back to Email");

  // LEVEL 3 — detail unchanged; back goes to recipients; Type still shown on the record.
  check(has(adminJs, "function renderEmailDetail(r, onBack)"), "Level 3 detail takes an onBack (Back to recipients)");
  check(has(adminJs, "Back to recipients"), "Level 3 back label is 'Back to recipients' when drilled in");
  check(has(adminJs, 'line("Type"'), "Level 3 detail STILL shows Type (only the column was removed)");
  check(has(adminJs, "Delivery status") && has(adminJs, "Last event") && has(adminJs, "Opened at"), "Level 3 detail shows delivery status + timestamps");
  check(has(adminJs, "badge-failed") && has(adminJs, "bounced") && has(adminJs, "complained"), "bounced/complained/failed render visually distinct (red)");

  // Backend: grouped feed + per-send recipients, both OWNER/SUPER_ADMIN gated.
  check(/email-logs"[\s\S]*?requireRole\("OWNER", "SUPER_ADMIN"\)[\s\S]*?listGroupedEmailSends/.test(adminTs), "Level 1 endpoint returns grouped sends, OWNER/SUPER_ADMIN gated");
  check(/email-logs\/recipients"[\s\S]*?requireRole\("OWNER", "SUPER_ADMIN"\)[\s\S]*?listEmailSendRecipients/.test(adminTs), "Level 2 recipients endpoint gated OWNER/SUPER_ADMIN");
  const svc = read("../services/emailLogService.ts");
  check(has(svc, "listGroupedEmailSends") && has(svc, 'r.communicationSendId ? `send:') && has(svc, '`single:${r.id}`'), "grouping keys by communicationSendId; ungrouped rows are single-recipient sends");

  const envExample = read("../../.env.example");
  check(has(envExample, "RESEND_WEBHOOK_SECRET"), ".env.example documents RESEND_WEBHOOK_SECRET");

  console.log("\n======================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (email deliverability)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
