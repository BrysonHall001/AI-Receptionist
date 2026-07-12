// Pure self-test (no DB) for the Invoices UI + wiring: the read-only computed total in the
// editor, and the registry/counter/total plumbing (source assertions).
//
//   npx tsx src/db/selfTest_invoicesUi.ts
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const fields = readFileSync(resolve(__dirname, "../../public/js/fields.js"), "utf8");
const rtSvc = readFileSync(resolve(__dirname, "../../src/services/recordTypeService.ts"), "utf8");
const recSvc = readFileSync(resolve(__dirname, "../../src/services/recordService.ts"), "utf8");
const schema = readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8");

console.log("Invoices — computed-total UI + wiring");
console.log("=====================================\n");

console.log("(1) computed Total is read-only + derived from line items (fields.js):");
check(/const liKey = \(allFields\.find\(\(f\) => f\.type === "line_items"\) \|\| \{\}\)\.key;/.test(fields), "the editor finds the line_items field");
check(/def\.type === "currency" && def\.key === "total" && liKey/.test(fields), "a currency field keyed \"total\" becomes the computed field when line items exist");
check(/const t = lineItemsTotal\(values\[liKey\]\); values\[def\.key\] = t; node\.textContent = fmtMoney\(t\)/.test(fields), "the total is derived live from the line items (read-only, not an input)");
check(/node = el\("div", "form-static form-computed-total"\)/.test(fields), "the total renders as static/read-only (no free-typed number)");

console.log("\n(2) Invoices is a registry module seeded like Equipment (recordTypeService):");
check(/export const INVOICE_RECORD_TYPE_KEY = "invoice";/.test(rtSvc), "INVOICE_RECORD_TYPE_KEY defined");
check(/key: INVOICE_RECORD_TYPE_KEY, label: "Invoice", labelPlural: "Invoices"[\s\S]{0,120}onCreate: ensureInvoiceDefaultFields/.test(rtSvc), "invoice is in SYSTEM_RECORD_TYPES with a default-fields seeder");
check(/key: "line_items", label: "Line items", type: "line_items"/.test(rtSvc) && /key: "total", label: "Total", type: "currency"/.test(rtSvc) && /key: "status"[\s\S]{0,80}\["Draft", "Sent", "Paid", "Void"\]/.test(rtSvc), "seeded fields include line_items, a currency total, and Draft/Sent/Paid/Void status");

console.log("\n(3) auto number + computed total + status default (recordService):");
check(/model Counter \{/.test(schema) && /@@unique\(\[tenantId, key\]\)/.test(schema), "a per-tenant Counter model exists");
check(/INSERT INTO "Counter"[\s\S]{0,220}ON CONFLICT \("tenantId", "key"\) DO UPDATE SET "value" = "Counter"\."value" \+ 1[\s\S]{0,40}RETURNING "value"/.test(recSvc), "nextCounter increments atomically (race-safe, no duplicate numbers)");
check(/cf\.invoice_number = "INV-" \+ String\(n\)\.padStart\(4, "0"\)/.test(recSvc), "invoice number is a zero-padded INV- sequence");
check(/if \(statusDef && !String\(cf\.status \|\| ""\)\.trim\(\)\) cf\.status = "Draft"/.test(recSvc), "status defaults to Draft on create");
check(/return \{ \.\.\.customFields, \[totalDef\.key\]: sumLineItems\(customFields\[liDef\.key\]\) \}/.test(recSvc), "server derives the total from line items (source of truth = the rows)");
check(/customFields = await applyComputedTotal\(tenantId, recordTypeId, customFields\)/.test(recSvc) && /data\.customFields = await applyComputedTotal\(tenantId, existing\.recordTypeId, data\.customFields\)/.test(recSvc), "computed total runs on BOTH create and update");
check(/rtKey !== INVOICE_RECORD_TYPE_KEY\) return customFields/.test(recSvc), "invoice-number/status defaults are scoped to the invoice type (other modules untouched)");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (computed read-only total; registry module; atomic auto-number)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
