// Self-test: charge exports. Proves the portal (client-facing) export is client-safe (no cost/
// breakdown leak) and excludes drafts/void, and that the export history plumbing works for the
// master (all-tenants, dataType-tagged) and per-tenant operator exports (history + download +
// tenant scoping).  npx tsx src/db/selfTest_chargeExports.ts
import { prisma, disconnectDb } from "./client";
import { portalChargeExportRows, PORTAL_CHARGE_EXPORT_FIELDS, FORBIDDEN_PORTAL_CHARGE_KEYS } from "../services/chargeExportService";
import { createExport, listMasterExports, listExports, getExportArtifact } from "../services/exportService";
import { createCharge, approveCharge, voidCharge, recordPayment } from "../services/chargeService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const D = (s: string) => new Date(s + "T00:00:00.000Z");
const A = { id: null as any, name: "Op" };

async function main() {
  console.log("charge exports\n==============");
  const ids: string[] = [];
  try {
    const t = (await db.tenant.create({ data: { name: "Acme", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(t);
    const t2 = (await db.tenant.create({ data: { name: "Beta", billingStatus: "paid", notifyEmail: "" } })).id; ids.push(t2);

    // A draft (excluded), an approved+note, a paid, a void (excluded).
    await createCharge(t, { periodStart: D("2026-06-01"), periodEnd: D("2026-06-30"), amount: 10, breakdown: { flatFee: 5, passthroughBaseCost: 3, markupPct: 20, usageSnapshot: { calls: 9 } }, status: "draft" });
    const appr = await createCharge(t, { periodStart: D("2026-05-01"), periodEnd: D("2026-05-31"), amount: 100, breakdown: { flatFee: 40, passthroughBaseCost: 50, markupPct: 20 }, notes: "Thanks!", dueDate: D("2026-09-15"), status: "draft" });
    await approveCharge(appr.id, A);
    const paid = await createCharge(t, { periodStart: D("2026-04-01"), periodEnd: D("2026-04-30"), amount: 25, breakdown: {}, status: "draft" });
    await approveCharge(paid.id, A); await recordPayment(paid.id, { amount: 25, method: "manual" }, A);
    const voided = await createCharge(t, { periodStart: D("2026-03-01"), periodEnd: D("2026-03-31"), amount: 99, breakdown: {}, status: "draft" });
    await approveCharge(voided.id, A); await voidCharge(voided.id, A);

    console.log("(1) portal export is CLIENT-SAFE + correct field set:");
    const ex = await portalChargeExportRows(t);
    check(ex.fields.join(",") === PORTAL_CHARGE_EXPORT_FIELDS.join(","), "fields = Period, Amount, Currency, Status, Due date, Paid date, Note");
    check(ex.rows.length === 2, "excludes draft + void (only approved + paid returned)");
    const keys = new Set<string>(); ex.rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
    const leaked = FORBIDDEN_PORTAL_CHARGE_KEYS.filter((f) => Array.from(keys).some((k) => k.toLowerCase().includes(f.toLowerCase())));
    check(leaked.length === 0, "no cost/markup/breakdown/usage/audit/tenantId/stripeId keys" + (leaked.length ? " (leaked: " + leaked.join(",") + ")" : ""));
    check(JSON.stringify(ex.rows).indexOf("markupPct") === -1 && JSON.stringify(ex.rows).indexOf("passthrough") === -1, "serialized rows contain no markup/passthrough anywhere");
    const apprRow = ex.rows.find((r) => r.Amount === 100)!;
    check(!!apprRow && apprRow.Note === "Thanks!" && apprRow.Status === "Due" && apprRow.Currency === "USD", "approved row: Note + Status Due + Currency");
    const paidRow = ex.rows.find((r) => r.Amount === 25)!;
    check(!!paidRow && paidRow.Status === "Paid" && !!paidRow["Paid date"], "paid row: Status Paid + Paid date");

    console.log("\n(2) master (all-tenants) export history is dataType-tagged:");
    const m = await createExport({ tenantId: null, scope: "all", dataType: "charge", name: "All charges Q2", rowCount: 3, fields: ["Tenant", "Amount"], csv: "Tenant,Amount\nAcme,100\n" });
    const chargeHist = await listMasterExports({ kind: "export", dataType: "charge" });
    check(chargeHist.some((r: any) => r.id === m.id), "charge export shows in master history filtered by dataType=charge");
    const contactHist = await listMasterExports({ kind: "export", dataType: "contact" });
    check(!contactHist.some((r: any) => r.id === m.id), "charge export does NOT show under dataType=contact");

    console.log("\n(3) per-tenant operator export: history + download + scoping:");
    const pe = await createExport({ tenantId: t, dataType: "charge", name: "Acme charges", rowCount: 2, fields: ["Amount"], csv: "Amount\n100\n25\n" });
    const tHist = await listExports(t, { kind: "export", dataType: "charge" });
    check(tHist.some((r: any) => r.id === pe.id), "per-tenant charge export shows in listExports(tenantId)");
    const dl = await getExportArtifact(pe.id, t);
    check(!!dl && dl.csv.indexOf("100") !== -1, "download returns the CSV for the owning tenant");
    const wrong = await getExportArtifact(pe.id, t2);
    check(wrong === null, "another tenant canNOT download it (tenant-scoped)");
  } catch (e) {
    console.log("   (error: " + (e as Error).message + ")"); fails++;
  } finally {
    for (const id of ids) {
      try { await db.exportRecord.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.billingAuditLog.deleteMany({ where: { tenantId: id } }); } catch {}
      try { const cs = await db.charge.findMany({ where: { tenantId: id }, select: { id: true } }); for (const c of cs) await db.payment.deleteMany({ where: { chargeId: c.id } }); } catch {}
      try { await db.charge.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
    try { await db.exportRecord.deleteMany({ where: { name: { in: ["All charges Q2"] } } }); } catch {}
  }
  console.log("\n==============");
  console.log(fails === 0 ? "ALL PASSED \u2705  (charge exports)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
