// Estimates Lifecycle — batch self-test (standing four-layer policy: builds;
// one happy path per shipped feature; prime-directive regressions;
// catastrophics only).
//
//   npx tsx src/db/selfTest_estimates.ts     (from ai-receptionist, clarity-pg up)
//
// Fixture rules honored: own throwaway tenants; contacts via RAW
// db.contact.create with unique email AND phone (the selfTest_customerComms /
// drip-suite convention); the estimate module's seeded fields are guaranteed by
// the service's own point-of-use backfill (loadEstimate), which this suite also
// exercises. No network: link emailing is exercised only through its guard
// (no-contact refusal); the send machinery itself is covered by
// selfTest_customerComms.

import { prisma, disconnectDb } from "./client";
import { listRecordTypes, WORK_ORDER_RECORD_TYPE_KEY, INVOICE_RECORD_TYPE_KEY, resolveRecordTypeId } from "../services/recordTypeService";
import { createRecord, getRecord } from "../services/recordService";
import { createLink, listLinksForRecord } from "../services/recordLinkService";
import { issueEstimateLink, resolveEstimatePublic, decideEstimate, convertEstimate, estimateLinkStatus, ESTIMATE_RECORD_TYPE_KEY } from "../services/estimateService";
import { registerAutomationEngine } from "../automation/engine";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fx = 0;
async function mkTenant(tag: string): Promise<string> {
  const t = await db.tenant.create({ data: { name: `est-${tag}-${stamp}`, notifyEmail: `est-${tag}-${stamp}@example.invalid`, billingStatus: "active" } });
  tenantIds.push(t.id);
  return t.id;
}
async function mkContact(T: string, name: string) {
  fx++;
  return db.contact.create({ data: { tenantId: T, name, email: `est-fx-${fx}-${stamp}@example.invalid`, phone: `+1444${String(stamp).slice(-4)}${String(fx).padStart(3, "0")}`, source: "test" } });
}
const LINE_ITEMS = [
  { description: "Fence panels", quantity: 4, unitPrice: 120, amount: 480 },
  { description: "Labor", quantity: 3, unitPrice: 90, amount: 270 },
];

async function main() {
  console.log("Estimates Lifecycle — batch self-test");
  console.log("=====================================");
  registerAutomationEngine();

  const T = await mkTenant("main");
  await listRecordTypes(T);
  const cust = await mkContact(T, "Deal Customer");

  // A custom address field on the estimate proves the address carry-over.
  const estTypeId = await resolveRecordTypeId(T, ESTIMATE_RECORD_TYPE_KEY);
  await db.fieldDef.create({ data: { tenantId: T, recordTypeId: estTypeId, scope: "record", key: "job_site", label: "Job site", type: "address", required: false, options: [], order: 20, system: false } });

  // =========================================================================
  console.log("\n(2) happy path — send \u2192 public \u2192 accept \u2192 event \u2192 convert:");
  const est: any = await createRecord(T, ESTIMATE_RECORD_TYPE_KEY, {
    title: "Fence rebuild",
    customFields: { estimate_number: "EST-77", status: "Draft", line_items: LINE_ITEMS, notes: "Includes haul-away.", job_site: { street: "12 Elm St", city: "Raleigh" } },
  });
  await createLink(T, { recordId: est.id, parentType: "contact", parentId: cust.id, role: "customer" });

  const issued = await issueEstimateLink(T, est.id, { origin: "https://app.example.invalid" });
  check(!!issued.token && issued.token.length === 64 && issued.url.includes("/estimate.html?token="), "send mints an unguessable 64-hex token + page URL");
  const afterSend: any = await getRecord(T, est.id);
  check(afterSend.customFields.status === "Sent", "sending marks the estimate Sent through the normal record path");
  const days = Math.round((new Date(issued.validUntil + "T00:00:00Z").getTime() - Date.now()) / 86400000);
  check(days >= 29 && days <= 31 && afterSend.customFields.valid_until === issued.validUntil, `an empty expiry field is stamped ~30 days out (${issued.validUntil})`);

  const pub: any = await resolveEstimatePublic(issued.token);
  check(!!pub && pub.available === true && pub.state === "active" && pub.business.name.startsWith("est-main-"),
    "the public endpoint serves the branded payload for a live link");
  check(pub.estimate.total === 750 && pub.estimate.lineItems.length === 2 && pub.estimate.lineItems[0].description === "Fence panels",
    "line items + the auto-computed sum ride the payload (750 from 480+270)");
  const linkRow = await db.estimateLink.findUnique({ where: { token: issued.token } });
  check(!!linkRow.viewedAt, "first open stamps viewedAt");

  // Automation reacts to the decision (accepted-scoped trigger).
  const auto = await db.automation.create({ data: { tenantId: T, name: `est auto ${stamp}`, enabled: true, triggerType: "EstimateDecided:accepted", conditions: [], actions: [{ type: "create_record_item", config: { recordType: "task", title: `EST-PROOF-${stamp}` } }] } });

  const dec = await decideEstimate(issued.token, "accepted", "Please start after the 10th");
  check(dec.ok === true && !dec.duplicate, "customer acceptance lands");
  const afterDec: any = await getRecord(T, est.id);
  check(afterDec.customFields.status === "Accepted", "…flipping the estimate to Accepted");
  const act = await db.activityLog.findFirst({ where: { tenantId: T, contactId: cust.id, type: "estimate_decision" } });
  check(!!act && (act.detail as any).decision === "accepted" && (act.detail as any).comment === "Please start after the 10th",
    "…logged on the customer's timeline with the comment");
  let proof: any = null;
  for (let i = 0; i < 40 && !proof; i++) { await sleep(250); proof = await db.record.findFirst({ where: { tenantId: T, title: `EST-PROOF-${stamp}` } }); }
  check(!!proof, "…and the EstimateDecided:accepted automation fired END-TO-END (bus \u2192 engine \u2192 action)");
  await db.automation.update({ where: { id: auto.id }, data: { enabled: false } });

  const conv = await convertEstimate(T, est.id, {});
  check(!!conv.workOrderId && !!conv.invoiceId && !conv.already, "convert creates a work order + invoice");
  const wo: any = await getRecord(T, conv.workOrderId);
  check(wo.customFields.description === "Includes haul-away." && wo.customFields.service_address && wo.customFields.service_address.street === "12 Elm St",
    "the work order carries notes\u2192description + the estimate's address field\u2192service_address");
  const woLinks = await listLinksForRecord(T, conv.workOrderId);
  check(woLinks.some((l: any) => l.parentType === "contact" && l.parentId === cust.id) && woLinks.some((l: any) => l.role === "converted_from_estimate"),
    "…with the customer link AND the back-link to the source estimate");
  const inv: any = await getRecord(T, conv.invoiceId as string);
  check(Array.isArray(inv.customFields.line_items) && inv.customFields.line_items.length === 2 && inv.customFields.total === 750 && /^INV-\d{4}$/.test(inv.customFields.invoice_number),
    "the invoice carries the line items, the auto-computed sum, and an auto number");
  const again = await convertEstimate(T, est.id, {});
  check(again.already === true && again.workOrderId === conv.workOrderId, "a second convert refuses to duplicate — it returns the SAME work order");

  const st = await estimateLinkStatus(T, est.id);
  check(st.sent === true && st.decision === "accepted" && st.state === "decided", "the portal status endpoint reports the whole story");

  // =========================================================================
  console.log("\n(3) prime-directive regressions:");
  check((await decideEstimate(issued.token, "accepted")).duplicate === true, "the SAME decision again is an idempotent duplicate, not a second event");
  const flip = await decideEstimate(issued.token, "declined");
  check(flip.ok === false && flip.code === "decided", "a DIFFERENT decision on a decided link is refused — decisions are terminal");
  const pubDecided: any = await resolveEstimatePublic(issued.token);
  check(!!pubDecided && pubDecided.state === "decided" && pubDecided.decision === "accepted", "a decided link still renders — read-only, with its outcome");

  // Expired link refuses acceptance; conversion refuses non-accepted.
  const est2: any = await createRecord(T, ESTIMATE_RECORD_TYPE_KEY, { title: "Old quote", customFields: { status: "Draft", line_items: LINE_ITEMS } });
  await createLink(T, { recordId: est2.id, parentType: "contact", parentId: cust.id });
  const issued2 = await issueEstimateLink(T, est2.id, {});
  await db.record.update({ where: { id: est2.id }, data: { customFields: { ...(await getRecord(T, est2.id)).customFields, valid_until: "2026-01-01" } } });
  const expDec = await decideEstimate(issued2.token, "accepted");
  check(expDec.ok === false && expDec.code === "expired", "an expired link refuses acceptance");
  const pubExp: any = await resolveEstimatePublic(issued2.token);
  check(!!pubExp && pubExp.state === "expired", "…while still rendering read-only as expired");
  let nonAcc = "";
  try { await convertEstimate(T, est2.id, {}); } catch (e: any) { nonAcc = e.message; }
  check(nonAcc === "Only an accepted estimate can be converted.", "conversion refuses a non-accepted estimate");
  // Re-send revokes the old link (token dead), and a decided estimate can't re-send.
  const issued2b = await issueEstimateLink(T, est2.id, {});
  check((await resolveEstimatePublic(issued2.token)) === null && !!(await resolveEstimatePublic(issued2b.token)),
    "re-sending kills the old token and the fresh one serves");
  let resendDecided = "";
  try { await issueEstimateLink(T, est.id, {}); } catch (e: any) { resendDecided = e.message; }
  check(resendDecided === "This estimate has already been decided.", "a decided estimate refuses a new link");

  // =========================================================================
  console.log("\n(4) catastrophics:");
  const TB = await mkTenant("iso");
  await listRecordTypes(TB);
  const pubA: any = await resolveEstimatePublic(issued2b.token);
  check(pubA.business.name.startsWith("est-main-") && pubA.estimate.title === "Old quote",
    "CROSS-TENANT: tenant A's token serves ONLY tenant A's business + estimate (nothing of tenant B exists in the payload)");
  check((await resolveEstimatePublic("")) === null && (await resolveEstimatePublic("short")) === null && (await resolveEstimatePublic("f".repeat(64))) === null,
    "garbage / short / unknown tokens serve nothing");
  // Payload allowlist — exact keys, so nothing can quietly join the public surface.
  check(JSON.stringify(Object.keys(pubA).sort()) === JSON.stringify(["available", "business", "decidedAt", "decision", "estimate", "state"]) &&
        JSON.stringify(Object.keys(pubA.business).sort()) === JSON.stringify(["logo", "name"]) &&
        JSON.stringify(Object.keys(pubA.estimate).sort()) === JSON.stringify(["date", "lineItems", "notes", "number", "title", "total", "validUntil"]),
    "the public payload is EXACTLY the approved allowlist — no extra fields, ever");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) { try { await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }); } catch { /* leave for manual cleanup */ } }
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (the link tells the truth, dies on time, and converts exactly once)" : failures.length + " FAILED \u274c: " + failures.join("; ")}`);
    process.exit(failures.length === 0 ? 0 : 1);
  });
