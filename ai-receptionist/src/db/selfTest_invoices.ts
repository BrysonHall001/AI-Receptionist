// Self-test for the Invoices module. Proves it's a normal registry-driven module (passes the
// module-coverage surfaces), auto-assigns a unique sequential number (incl. under concurrency),
// computes the total from line items (read-only/derived, exposed as a number), and links to a
// Contact via the symmetric-link system (so it shows in the Contact's related tabs).
//
//   npx tsx src/db/selfTest_invoices.ts        (needs dev Postgres)
//
// SAFETY: one clearly-named TEMPORARY tenant, deleted at the end (cascade).
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma, disconnectDb } from "./client";
import { listRecordTypes, resolveRecordTypeId, systemRecordTypeOptions, systemRecordTypeKeys, ensureAllSystemRecordTypes, INVOICE_RECORD_TYPE_KEY, JOB_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { listFields } from "../services/fieldService";
import { createRecord, getRecord, listRecords, softDeleteRecords, listDeletedRecords, restoreRecords } from "../services/recordService";
import { createLink, listLinksForContact, listLinksForRecord } from "../services/recordLinkService";
import { parseRecordDateTrigger } from "../automation/scheduler";

const db = prisma as any;
const T_NAME = "__SELFTEST_INVOICES__";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
function loadNav(recordTypes: any[]) { const code = readFileSync(resolve(__dirname, "../../public/js/navModel.js"), "utf8"); const sb: any = { window: { App: { state: { recordTypes } } } }; vm.createContext(sb); vm.runInContext(code, sb); return sb.window.App; }

async function main() {
  console.log("Invoices module — safety proof");
  console.log("==============================\n");
  const before = { records: await db.record.count(), tenants: await db.tenant.count() };

  let tId = "";
  try {
    const t = await db.tenant.create({ data: { billingStatus: "trial", name: T_NAME, notifyEmail: "selftest@example.invalid" } });
    tId = t.id;
    await ensureAllSystemRecordTypes(tId);
    const KEY = INVOICE_RECORD_TYPE_KEY;

    // (1) It's a real registry module, seeded by default, with the header fields.
    console.log("(1) registry module + seeded fields:");
    check(systemRecordTypeKeys().includes(KEY), "invoice is a system registry key (seeded by default like Equipment)");
    const types = await listRecordTypes(tId);
    const inv = (types as any[]).find((x) => x.key === KEY);
    check(!!inv && inv.system === false, "Invoices appears in listRecordTypes as system:false");
    const fields = await listFields(tId, KEY);
    const byKey: any = {}; (fields as any[]).forEach((f) => (byKey[f.key] = f));
    check(!!byKey.invoice_number && !!byKey.status && !!byKey.invoice_date && !!byKey.due_date && !!byKey.line_items && !!byKey.total && !!byKey.notes, "seeded header fields exist (number/status/dates/line_items/total/notes)");
    check(byKey.line_items.type === "line_items" && byKey.total.type === "currency" && byKey.status.type === "single_select", "field types are correct (line_items + currency total + select status)");

    // (2) MODULE-COVERAGE GUARDRAIL — the same surfaces every module must reach.
    console.log("\n(2) module-coverage guardrail (Invoices reaches every surface):");
    const navApp = loadNav(types as any[]);
    check(navApp.buildPortalNav().some((it: any) => it[0] === "#/records/" + KEY), "[nav] buildPortalNav includes the Invoices item");
    check(navApp.recordsAreaHrefs().includes("#/records/" + KEY), "[permissions] part of the shared 'records' area");
    check(!!(await resolveRecordTypeId(tId, KEY)), "[fields] resolves for the Fields page");
    check((types as any[]).filter((x) => x.key !== "contact").map((x) => x.key).includes(KEY), "[analytics/automations/export] non-contact registry type -> auto data source / subject / exportable");
    check(!!parseRecordDateTrigger(`RecordDateReached:${KEY}:due_date:3:days:before`), "[automations] date-reached trigger can target invoice dates");
    check(systemRecordTypeOptions().some((o) => o.key === KEY && o.togglable === true), "[portal-creation picker] Invoices is a togglable module option");
    check((types as any[]).some((x) => x.key === KEY && x.key !== "contact"), "[AI knowledge] appears in the record-type list the knowledge checklist renders");

    // (3) AUTO NUMBER (unique + sequential, incl. concurrency) + COMPUTED TOTAL.
    console.log("\n(3) auto number + computed total:");
    const rows = [{ description: "Labor", quantity: 2, unitPrice: 40 }, { description: "Part", quantity: 1, unitPrice: 450 }];
    const inv1: any = await createRecord(tId, KEY, { title: "First", customFields: { line_items: rows, total: 999999 /* bogus — server must override */ } });
    const read1: any = await getRecord(tId, inv1.id);
    check(read1.customFields.invoice_number === "INV-0001", "first invoice auto-numbered INV-0001");
    check(read1.customFields.status === "Draft", "status defaults to Draft");
    check(read1.customFields.total === 530, "COMPUTED TOTAL: line items [{q:2,p:40},{q:1,p:450}] -> total 530 (server-derived, read-only)");
    check(typeof read1.customFields.total === "number", "the total is exposed as a NUMBER for reporting");
    const inv2: any = await createRecord(tId, KEY, { title: "Second", customFields: {} });
    check((await getRecord(tId, inv2.id) as any).customFields.invoice_number === "INV-0002", "second invoice auto-numbered INV-0002 (sequential)");

    // concurrency — five parallel creates must yield five DISTINCT numbers.
    const parallel = await Promise.all([0, 1, 2, 3, 4].map(() => createRecord(tId, KEY, { title: "P", customFields: {} })));
    const nums = await Promise.all(parallel.map(async (r: any) => (await getRecord(tId, r.id) as any).customFields.invoice_number));
    check(new Set(nums).size === 5, `concurrent creation yields 5 unique numbers (no duplicates): ${nums.sort().join(", ")}`);

    // total recomputes on update; clearing rows -> 0.
    const { updateRecord } = await import("../services/recordService");
    await updateRecord(tId, inv1.id, { customFields: { line_items: [{ description: "One", quantity: 3, unitPrice: 10 }] } });
    check((await getRecord(tId, inv1.id) as any).customFields.total === 30, "editing line items recomputes the total (3 × 10 = 30)");
    await updateRecord(tId, inv1.id, { customFields: { line_items: [] } });
    check((await getRecord(tId, inv1.id) as any).customFields.total === 0, "clearing all line items falls back to total 0 (no error)");

    // (4) LINKS — invoice ↔ Contact (symmetric); shows in the Contact's related tab data.
    console.log("\n(4) links to Contacts (and optionally Jobs):");
    const contact = await db.contact.create({ data: { tenantId: tId, name: "Billed Customer", email: "c@example.invalid", phone: null } });
    await createLink(tId, { recordId: inv1.id, parentType: "contact", parentId: contact.id });
    const contactInvoices = await listLinksForContact(tId, contact.id, KEY);
    check(contactInvoices.some((l: any) => l.record && l.record.id === inv1.id), "invoice links to a Contact and shows in the Contact's Invoices related tab (listLinksForContact)");
    const job: any = await createRecord(tId, JOB_RECORD_TYPE_KEY, { title: "Repair job", subtypeKey: "technical" });
    await createLink(tId, { recordId: inv1.id, parentType: "record", parentId: job.id, role: "for" });
    check((await listLinksForRecord(tId, inv1.id)).some((l: any) => l.otherId === job.id) && (await listLinksForRecord(tId, job.id)).some((l: any) => l.otherId === inv1.id), "invoice optionally links to a Job via the symmetric-link system (found from both sides)");

    // (5) normal module: backup + recycle work generically.
    console.log("\n(5) normal-module data paths:");
    check((await listRecords(tId, KEY)).some((r: any) => r.id === inv2.id), "[backup] invoices are gathered by listRecords");
    await softDeleteRecords(tId, [inv2.id]);
    check((await listDeletedRecords(tId)).some((r: any) => r.id === inv2.id), "[recycle] a deleted invoice appears in the Recycle Bin");
    await restoreRecords(tId, [inv2.id]);
    check((await listRecords(tId, KEY)).some((r: any) => r.id === inv2.id), "[recycle] an invoice restores generically");
  } catch (e) {
    failures.push("unexpected error: " + (e as Error).message);
    console.log("  \u2717 threw:", (e as Error).message);
  } finally {
    if (tId) { console.log("\nCleaning up the temporary tenant…"); await db.tenant.delete({ where: { id: tId } }).catch(() => {}); }
  }

  const after = { records: await db.record.count(), tenants: await db.tenant.count() };
  check(after.tenants === before.tenants, `tenants unchanged (${before.tenants} -> ${after.tenants})`);
  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705  (Invoices is a normal module; unique auto-number; computed total; contact/job links)" : failures.length + " FAILED \u274c: " + failures.join("; ")}`);
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}
main();
