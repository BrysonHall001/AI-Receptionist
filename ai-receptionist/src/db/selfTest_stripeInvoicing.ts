// Self-test: Stripe invoicing on approve. Stripe is MOCKED — never hits the live API.
//   npx tsx src/db/selfTest_stripeInvoicing.ts
import { prisma, disconnectDb } from "./client";
import * as stripeSvc from "../services/stripeService";
import { createInvoiceForCharge, sendInvoiceForCharge } from "../services/stripeInvoiceService";
import { createCharge, approveCharge } from "../services/chargeService";
import { getChargeAudit } from "../services/billingAuditService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");
const ALICE = { id: "u_inv", name: "Alice" };

// Build a mock Stripe client. Counters let us assert call counts / idempotency.
function makeMock(opts: { finalizeThrows?: boolean } = {}) {
  const counts = { customer: 0, item: 0, invoice: 0, finalize: 0, send: 0 };
  let seq = 0;
  const client: any = {
    customers: { create: async (a: any) => { counts.customer++; return { id: "cus_" + (++seq), name: a.name, email: a.email }; } },
    invoiceItems: { create: async () => { counts.item++; return { id: "ii_" + (++seq) }; } },
    invoices: {
      create: async () => { counts.invoice++; return { id: "in_" + (++seq) }; },
      finalizeInvoice: async (id: string) => { counts.finalize++; if (opts.finalizeThrows) throw new Error("stripe finalize boom"); return { id, status: "open", hosted_invoice_url: "https://pay.stripe.test/" + id }; },
      sendInvoice: async (id: string) => { counts.send++; return { id, status: "open", hosted_invoice_url: "https://pay.stripe.test/" + id }; },
    },
  };
  return { client, counts };
}
function configure(client: any) { (stripeSvc as any); const { env } = require("../config/env"); (env as any).STRIPE_SECRET_KEY = "sk_test_mock"; stripeSvc.__setStripeClientForTest(client); }
function unconfigure() { const { env } = require("../config/env"); (env as any).STRIPE_SECRET_KEY = ""; stripeSvc.__setStripeClientForTest(null); }

async function main() {
  console.log("stripe invoicing\n================");
  const ids: string[] = [];
  try {
    const tId = (await db.tenant.create({ data: { name: "Acme Corp", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(tId);

    // (1) Approve with Stripe UNCONFIGURED -> approved, no invoice, no crash.
    console.log("(1) approve without Stripe:");
    unconfigure();
    const A = await createCharge(tId, { periodStart: D("2026-06-01"), periodEnd: D("2026-06-30"), amount: 100, breakdown: {}, status: "draft" });
    const aApproved = await approveCharge(A.id, ALICE);
    check(aApproved.status === "approved" && aApproved.stripeInvoiceId === null, "approve succeeds, invoice fields null when Stripe unconfigured");
    let retryErr = ""; try { await createInvoiceForCharge(A.id, ALICE); } catch (e) { retryErr = (e as Error).message; }
    check(/not configured/i.test(retryErr), "retry create errors clearly when unconfigured");

    // (2) Configure mock -> create invoice for the approved charge + idempotency.
    console.log("\n(2) create invoice (mock):");
    const m = makeMock(); configure(m.client);
    const r1 = await createInvoiceForCharge(A.id, ALICE);
    check(r1.created === true && !!r1.charge.stripeInvoiceId && /pay.stripe.test/.test(r1.charge.stripeInvoiceUrl) && r1.charge.stripeInvoiceStatus === "open", "invoice created + id/url/status stored");
    check(m.counts.item === 1 && m.counts.invoice === 1 && m.counts.finalize === 1, "invoice item + invoice + finalize each called once");
    check((await getChargeAudit(A.id)).some((x: any) => x.action === "invoice_created"), "invoice_created logged to audit");
    const r2 = await createInvoiceForCharge(A.id, ALICE);
    check(r2.created === false && m.counts.invoice === 1, "idempotent: no second invoice created");

    // (3) Approve WITH Stripe configured -> auto-creates invoice.
    console.log("\n(3) approve auto-creates invoice:");
    const B = await createCharge(tId, { periodStart: D("2026-07-01"), periodEnd: D("2026-07-31"), amount: 50, breakdown: {}, status: "draft" });
    const bApproved = await approveCharge(B.id, ALICE);
    check(!!bApproved.stripeInvoiceId && bApproved.stripeInvoiceStatus === "open", "approve auto-created the invoice");

    // (4) Approve stays successful even if invoice creation throws.
    console.log("\n(4) approve resilient to invoice failure:");
    const mBoom = makeMock({ finalizeThrows: true }); configure(mBoom.client);
    const C = await createCharge(tId, { periodStart: D("2026-08-01"), periodEnd: D("2026-08-31"), amount: 25, breakdown: {}, status: "draft" });
    const cApproved = await approveCharge(C.id, ALICE);
    check(cApproved.status === "approved" && cApproved.stripeInvoiceId === null, "charge approved despite Stripe failure (invoice null, ret/retryable)");

    // (5) Send invoice.
    console.log("\n(5) send invoice:");
    configure(m.client);
    const sent = await sendInvoiceForCharge(A.id, ALICE);
    check(sent.sent === true && m.counts.send === 1, "sendInvoice called");
    check((await getChargeAudit(A.id)).some((x: any) => x.action === "invoice_sent"), "invoice_sent logged to audit");
    let sendErr = ""; try { await sendInvoiceForCharge(C.id, ALICE); } catch (e) { sendErr = (e as Error).message; }
    check(/no invoice to send/i.test(sendErr), "send errors clearly when there's no invoice");

    // (6) Cannot invoice a draft.
    console.log("\n(6) guardrails:");
    const Dr = await createCharge(tId, { periodStart: D("2026-09-01"), periodEnd: D("2026-09-30"), amount: 10, breakdown: {}, status: "draft" });
    let draftErr = ""; try { await createInvoiceForCharge(Dr.id, ALICE); } catch (e) { draftErr = (e as Error).message; }
    check(/must be approved/i.test(draftErr), "cannot create an invoice for a draft charge");
  } catch (e) {
    console.log("   (DB error: " + (e as Error).message + ")"); fails++;
  } finally {
    unconfigure();
    for (const id of ids) {
      try { await db.billingAuditLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { const cs = await db.charge.findMany({ where: { tenantId: id }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.billingConfig.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (stripe invoicing)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
