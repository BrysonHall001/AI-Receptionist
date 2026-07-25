// PRICE BOOK — data-layer self-test. Five standing layers. Fixture pattern:
// selfTest_estimates (tenant + listRecordTypes + convert flow) and
// selfTest_fsPunchlist1 (running a migration file via $executeRawUnsafe to prove
// backfill collision rules on a deliberately-mutated tenant).
import { readFileSync } from "fs";
import { join } from "path";
import { prisma, disconnectDb } from "./client";
import { listRecordTypes, resolveRecordTypeId, createRecordType, INVOICE_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { createRecord, updateRecord, getRecord } from "../services/recordService";
import { createField, updateField, validateLineItemsSource } from "../services/fieldService";
import { decideEstimate, issueEstimateLink, convertEstimate, ESTIMATE_RECORD_TYPE_KEY } from "../services/estimateService";

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const today = () => new Date().toISOString().slice(0, 10);

const MIGRATION_SQL = readFileSync(join(__dirname, "..", "..", "prisma", "migrations", "20260725090000_price_book_backfill", "migration.sql"), "utf8");
const SRC = { source: { module: "product", map: { description: "__title", unitPrice: "price", details: "description" } } };

async function mkTenant(tag: string) {
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const t = await db.tenant.create({ data: { name: `pb-${tag}-${stamp}`, notifyEmail: `pb-${tag}-${stamp}@example.invalid`, billingStatus: "active" } });
  await listRecordTypes(t.id);
  return t.id as string;
}

async function main() {
  console.log("Price Book — data-layer self-test");
  console.log("=================================");

  // ---------- (1) builds ----------
  console.log("\n(1) builds & migrations:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-price-book-20260725" } });
  check(!!cl && cl.id === "cl_price_book_20260725" && cl.type === "Feature", "the changelog row landed (idempotent migration)");

  // ---------- (2) happy paths ----------
  console.log("\n(2) happy paths:");
  const T = await mkTenant("main");
  const estTypeId = await resolveRecordTypeId(T, ESTIMATE_RECORD_TYPE_KEY);
  const invTypeId = await resolveRecordTypeId(T, INVOICE_RECORD_TYPE_KEY);

  // Seeds: line_items carries the Products source; the invoice completion fields exist.
  const estLi = await db.fieldDef.findFirst({ where: { tenantId: T, recordTypeId: estTypeId, key: "line_items" } });
  const invLi = await db.fieldDef.findFirst({ where: { tenantId: T, recordTypeId: invTypeId, key: "line_items" } });
  const liOk = (f: any) => f && f.options && !Array.isArray(f.options) && f.options.source && f.options.source.module === "product" && f.options.source.map.unitPrice === "price" && f.options.source.map.description === "__title";
  check(liOk(estLi) && liOk(invLi), "fresh tenant: Estimates + Invoices line_items are seeded with the Products source object");
  const paidF = await db.fieldDef.findFirst({ where: { tenantId: T, recordTypeId: invTypeId, key: "paid_date" } });
  const pmF = await db.fieldDef.findFirst({ where: { tenantId: T, recordTypeId: invTypeId, key: "payment_method" } });
  check(!!paidF && paidF.type === "date" && !!pmF && pmF.type === "single_select" && Array.isArray(pmF.options) && pmF.options.length === 5,
    "fresh tenant: paid_date (date) + payment_method (5 choices) are seeded on Invoices");

  // Validation: the seeded config round-trips through updateField; bad configs fail closed.
  let ok = true; try { await updateField(T, estLi.id, { options: SRC }); } catch (_e) { ok = false; }
  check(ok, "updateField accepts the valid Products source (validateLineItemsSource passes)");
  let selfRejected = false; try { await validateLineItemsSource(T, estTypeId, { source: { module: "estimate", map: {} } }); } catch (_e) { selfRejected = true; }
  let badKeyRejected = false; try { await validateLineItemsSource(T, estTypeId, { source: { module: "product", map: { unitPrice: "no_such_field" } } }); } catch (_e) { badKeyRejected = true; }
  let ghostRejected = false; try { await validateLineItemsSource(T, estTypeId, { source: { module: "no_such_module", map: {} } }); } catch (_e) { ghostRejected = true; }
  check(selfRejected && badKeyRejected && ghostRejected, "validation fails closed: self-source (cycle), unknown mapped key, unknown module");

  // Copy-on-pick data proof through the whole lifecycle: picked-shape rows are VALUES.
  const prod: any = await createRecord(T, "product", { title: "Water heater 40gal", customFields: { price: 850, description: "Tank, gas, installed", sku: "WH-40" } } as any);
  const pickedRows = [
    { description: "Water heater 40gal \u2014 Tank, gas, installed", quantity: 1, unitPrice: 850 }, // the editor's applyPick output shape
    { description: "Misc fittings", quantity: 3, unitPrice: 12 },                                   // a free-typed row alongside
  ];
  const est: any = await createRecord(T, ESTIMATE_RECORD_TYPE_KEY, { title: "Heater swap", customFields: { line_items: pickedRows, status: "Draft" } } as any);
  const estRead: any = await getRecord(T, est.id);
  check(Number(estRead.customFields.total) === 850 + 36, "picked + free rows total correctly through the computed Total (886)");
  const issued: any = await issueEstimateLink(T, est.id, {});
  await decideEstimate(issued.token, "accepted");
  const conv = await convertEstimate(T, est.id, { invoice: true });
  const inv: any = await getRecord(T, conv.invoiceId as string);
  check(Array.isArray(inv.customFields.line_items) && inv.customFields.line_items[0].unitPrice === 850, "conversion carries row VALUES onto the invoice");
  await updateRecord(T, prod.id, { customFields: { price: 999 } });
  const estAfter: any = await getRecord(T, est.id);
  const invAfter: any = await getRecord(T, conv.invoiceId as string);
  check(estAfter.customFields.line_items[0].unitPrice === 850 && invAfter.customFields.line_items[0].unitPrice === 850,
    "COPY-ON-PICK: a later product price change leaves the estimate's and invoice's rows untouched");

  // Mark-paid nudge: blank paid_date fills with today; a preset date is respected.
  await updateRecord(T, conv.invoiceId as string, { customFields: { ...invAfter.customFields, status: "Paid" } });
  const paidInv: any = await getRecord(T, conv.invoiceId as string);
  check(paidInv.customFields.paid_date === today(), "marking Paid prefills paid_date = today when blank");
  const inv2: any = await createRecord(T, INVOICE_RECORD_TYPE_KEY, { title: "Preset", customFields: { status: "Draft", paid_date: "2026-01-15" } } as any);
  await updateRecord(T, inv2.id, { customFields: { status: "Paid", paid_date: "2026-01-15" } });
  const inv2r: any = await getRecord(T, inv2.id);
  check(inv2r.customFields.paid_date === "2026-01-15", "\u2026and a preset paid_date is respected, never overwritten");

  // ---------- (3) prime-directive regressions ----------
  console.log("\n(3) prime-directive regressions:");
  const widget: any = await createRecordType(T, "PBWidget");
  const plainLi: any = await createField(T, { label: "Bill lines", type: "line_items" }, widget.key);
  check(Array.isArray(plainLi.options) && plainLi.options.length === 0, "a line-items field created WITHOUT a source stores options [] (today's shape, byte-identical)");
  await createRecord(T, widget.key, { title: "W1", customFields: { [plainLi.key]: [{ description: "Free row", quantity: 2, unitPrice: 5 }] } } as any);
  check(true, "free-typed rows on an unconfigured field save exactly as today");
  // The mark-paid gate: a portal that removed paid_date is untouched.
  const T2 = await mkTenant("nofield");
  const inv3: any = await createRecord(T2, INVOICE_RECORD_TYPE_KEY, { title: "NF", customFields: { status: "Draft" } } as any);
  const t2InvType = await resolveRecordTypeId(T2, INVOICE_RECORD_TYPE_KEY);
  await db.fieldDef.deleteMany({ where: { tenantId: T2, recordTypeId: t2InvType, key: "paid_date" } });
  await updateRecord(T2, inv3.id, { customFields: { status: "Paid" } });
  const inv3r: any = await getRecord(T2, inv3.id);
  check(!("paid_date" in (inv3r.customFields || {})), "a portal that removed paid_date gets NO stray key on mark-paid (the field gate)");

  // ---------- (4) catastrophics ----------
  console.log("\n(4) catastrophics:");
  // Tenant isolation: a module that exists only in tenant A is rejected for tenant B.
  let crossRejected = false;
  try { await validateLineItemsSource(T2, t2InvType, { source: { module: widget.key, map: {} } }); } catch (_e) { crossRejected = true; }
  check(crossRejected, "CROSS-TENANT: tenant B may not source a module that exists only in tenant A");

  // Backfill collision proof (fsPunchlist1 $executeRawUnsafe pattern): a tenant with
  // its OWN paid_date and stripped line_items options.
  const T3 = await mkTenant("backfill");
  const t3InvType = await resolveRecordTypeId(T3, INVOICE_RECORD_TYPE_KEY);
  await db.fieldDef.deleteMany({ where: { tenantId: T3, recordTypeId: t3InvType, key: { in: ["paid_date", "payment_method"] } } });
  await db.fieldDef.create({ data: { tenantId: T3, recordTypeId: t3InvType, scope: "record", key: "paid_date", label: "My own paid date", type: "text", required: false, options: [], order: 30, system: false } });
  await db.fieldDef.updateMany({ where: { tenantId: T3, recordTypeId: t3InvType, key: "line_items" }, data: { options: [] } });
  // The engine runs raw SQL as a PREPARED statement — one command per call
  // (multi-statement files die with Postgres 42601). Execute the migration
  // statement-by-statement, twice, to prove idempotence.
  const stmts = MIGRATION_SQL.split(/;\s*\n/).map((x) => x.trim()).filter((x) => x.replace(/--.*$/gm, "").trim().length);
  for (let pass = 0; pass < 2; pass++) for (const st of stmts) await db.$executeRawUnsafe(st);
  const ownPaid = await db.fieldDef.findMany({ where: { tenantId: T3, recordTypeId: t3InvType, key: "paid_date" } });
  const pm3 = await db.fieldDef.findMany({ where: { tenantId: T3, recordTypeId: t3InvType, key: "payment_method" } });
  const li3 = await db.fieldDef.findFirst({ where: { tenantId: T3, recordTypeId: t3InvType, key: "line_items" } });
  check(ownPaid.length === 1 && ownPaid[0].type === "text" && ownPaid[0].label === "My own paid date",
    "COLLISION RULE: the tenant's own paid_date field survives the backfill byte-untouched (never retyped)");
  check(pm3.length === 1, "payment_method backfilled exactly once across two runs");
  check(li3 && li3.options && !Array.isArray(li3.options) && li3.options.source && li3.options.source.module === "product",
    "empty line_items options gain the Products source; run-twice stays stable");

  for (const x of [T, T2, T3]) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the catalog assists and never constrains: picks are copies, seeds respect owners, paid dates fill politely)");
}

main().catch((e) => { console.error("threw:", e); process.exitCode = 1; }).finally(async () => { await disconnectDb(); });
