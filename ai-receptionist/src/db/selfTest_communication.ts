// Batch self-test — Communication page (nav/permission, audience math, send record,
// role gate), on the REAL engine.
//
//   npx tsx src/db/selfTest_communication.ts
//
// SAFETY: one TEMPORARY tenant, deleted at the end. No real email (mock forced on).

import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { can, NAV_VIEW_AREAS, AREAS } from "../services/permissionService";
import { resolveEmailableRecipients, sendEmailBlast } from "../services/communicationService";
import { env } from "../config/env";

const db = prisma as any;
const T_NAME = "__SELFTEST_COMMUNICATION__";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  console.log("Communication — nav / audience / send record / gate");
  console.log("===================================================");
  (env as any).EMAIL_PROVIDER = "mock";

  // ---------- (1) nav + permission wiring ----------
  console.log("(1) nav + permission:");
  const area = AREAS.find((a) => a.key === "communication");
  check(!!area && area.label === "Communication", "AREAS has a 'communication' area labeled \"Communication\"");
  check(NAV_VIEW_AREAS.indexOf("communication") !== -1, "NAV_VIEW_AREAS includes 'communication' (flows into me.permView)");
  check((await can({ role: "OWNER" } as any, "communication", "view")) === true, "communication:view resolves true for OWNER via can()");
  check((await can({ role: "CLIENT_USER" } as any, "communication", "view")) === true, "communication:view resolves true for CLIENT_USER (readonly area)");
  // Default nav label is "Communication" and label-agnostic (no record-type label key).
  const appJs = readFileSync(resolve(__dirname, "../../public/js/app.js"), "utf8");
  check(appJs.includes('["#/communication", "Communication"]'), "PORTAL_NAV default label is \"Communication\" (renamable, no fixed label key)");

  // ---------- (2) audience math via the REAL App.table.pipeline ----------
  console.log("\n(2) audience resolution (real pipeline — matching − excluded, emailable only):");
  (globalThis as any).App = { util: {} };
  // eslint-disable-next-line no-eval
  (0, eval)(readFileSync(resolve(__dirname, "../../public/js/table.js"), "utf8"));
  const pipeline = (globalThis as any).App.table.pipeline as (rows: any[], cols: any[], st: any) => any[];
  const cols = [
    { key: "name", type: "text", get: (r: any) => r.name, text: (r: any) => r.name || "" },
    { key: "email", type: "text", get: (r: any) => r.email, text: (r: any) => r.email || "" },
    { key: "city", type: "text", get: (r: any) => r.city, text: (r: any) => r.city || "" },
  ];
  const people = [
    { id: "a", name: "Ada", email: "ada@x.com", city: "Austin" },
    { id: "b", name: "Ben", email: "", city: "Austin" },          // Austin but NO email
    { id: "c", name: "Cy", email: "cy@x.com", city: "Austin" },
    { id: "d", name: "Di", email: "di@x.com", city: "Denver" },   // wrong city
    { id: "e", name: "Eve", email: "eve@x.com", city: "Austin" },
  ];
  const rules = [{ field: "city", op: "is", value: "Austin" }];
  const matched = pipeline(people, cols, { rules });
  const emailable = matched.filter((p: any) => p.email && p.email.trim());
  const excluded = new Set(["c"]);
  const recipients = emailable.filter((p: any) => !excluded.has(p.id));
  check(matched.length === 4, "rule 'city is Austin' matches 4 (a,b,c,e)");
  check(emailable.length === 3, "non-emailable (Ben) dropped -> 3 emailable");
  check(recipients.length === 2 && recipients.every((p: any) => p.id !== "c"), "minus excluded (Cy) -> 2 recipients");

  // ---------- (3) send record + server resolver (DB) ----------
  let tId: string | null = null;
  const beforeSends = await db.communicationSend.count();
  try {
    const tenant = await db.tenant.create({ data: { name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = tenant.id;
    const tenantId: string = tenant.id;
    const mk = async (name: string, email: string | null, phone: string) =>
      (await db.contact.create({ data: { tenantId, name, email, phone, source: "web" } })).id;
    const id1 = await mk("Ada", "ada@example.invalid", "+1");
    const id2 = await mk("Ben", null, "+2");            // no email
    const id3 = await mk("Cy", "cy@example.invalid", "+3");
    const id4 = await mk("Di", "di@example.invalid", "+4");

    console.log("\n(3a) server resolver drops non-emailable + excluded:");
    const resolved = await resolveEmailableRecipients(tenantId, [id1, id2, id3, id4], [id4]);
    check(resolved.length === 2, "4 ids, 1 has no email, 1 excluded -> 2 resolved");
    check(resolved.every((r: any) => r.email) && !resolved.some((r: any) => r.id === id2 || r.id === id4), "resolved set excludes the no-email and the excluded contact");

    console.log("\n(3b) a blast writes ONE CommunicationSend row with correct counts:");
    const res = await sendEmailBlast({
      tenantId, subject: "Hello all", html: "<p>Hi</p>",
      contactIds: [id1, id2, id3], // id2 has no email -> dropped to 2 recipients
      fromEmail: "agent@example.invalid", fromName: "Agent", createdById: "user-123",
    });
    check(res.recipientCount === 2 && res.sentCount === 2 && res.failCount === 0, `recipientCount/sentCount = 2/2, fail 0 (got ${res.recipientCount}/${res.sentCount}/${res.failCount})`);
    const rows = await db.communicationSend.findMany({ where: { tenantId } });
    check(rows.length === 1, "exactly one CommunicationSend row written");
    check(rows[0].channel === "email" && rows[0].subject === "Hello all" && rows[0].recipientCount === 2 && rows[0].sentCount === 2 && rows[0].createdById === "user-123", "row has correct channel/subject/counts/createdById");

    // ---------- (4) role gate ----------
    console.log("\n(4) role gate (same as bulk-email = contacts:edit):");
    check((await can({ role: "CLIENT_USER" } as any, "contacts", "edit")) === false, "CLIENT_USER cannot contacts:edit -> blocked from the send endpoint");
    check((await can({ role: "OWNER" } as any, "contacts", "edit")) === true, "OWNER can contacts:edit -> allowed to send");
  } catch (e) {
    console.error("\nUNEXPECTED ERROR:", e);
    failures.push("unexpected error: " + (e as Error).message);
  } finally {
    console.log("\nCleaning up the temporary tenant…");
    if (tId) {
      try { await db.communicationSend.deleteMany({ where: { tenantId: tId } }); await db.tenant.delete({ where: { id: tId } }); }
      catch (e) { console.error("cleanup failed", e); failures.push("cleanup failed"); }
    }
    try { await db.tenant.deleteMany({ where: { name: T_NAME } }); } catch {}
  }

  const afterSends = await db.communicationSend.count();
  check(afterSends === beforeSends, `CommunicationSend rows unchanged outside the temp tenant (${beforeSends} -> ${afterSends})`);

  console.log("\n===================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (communication)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  await disconnectDb();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
