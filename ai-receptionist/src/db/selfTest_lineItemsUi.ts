// Pure self-test (no DB) for the line_items frontend: money/total helpers (vm-loaded
// fields.js) + source assertions for the mini-table editor, list cell, and report wiring.
//
//   npx tsx src/db/selfTest_lineItemsUi.ts
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const fieldsSrc = readFileSync(resolve(__dirname, "../../public/js/fields.js"), "utf8");
const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const reports = readFileSync(resolve(__dirname, "../../public/js/reports.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

console.log("Line items — frontend helpers + wiring");
console.log("=====================================\n");

const sandbox: any = { window: { App: { util: { el: () => ({ appendChild() {} }), esc: (s: any) => s } } } };
vm.createContext(sandbox);
vm.runInContext(fieldsSrc, sandbox);
const F = sandbox.window.App.fields;

console.log("(1) helpers (behavioural):");
check(F.TYPE_LABELS.line_items === "Line items", '"Line items" is in TYPE_LABELS');
const rows = [{ description: "Labor", quantity: 2, unitPrice: 40 }, { description: "Part", quantity: 1, unitPrice: 450 }];
check(F.lineItemsTotal(rows) === 530, "TOTALS MATH: [{q:2,p:40},{q:1,p:450}] -> 530");
check(F.fmtMoney(530) === "$530.00", "money formats like the currency field ($530.00)");
check(F.lineItemsSummary(rows) === "2 items · $530.00", 'list summary is "2 items · $530.00"');
check(F.formatValue({ type: "line_items" }, rows) === "2 items · $530.00", "formatValue returns the summary");
check(F.lineItemsSummary([]) === "" && F.lineItemsTotal(null) === 0, "empty/odd values are safe (no throw, blank summary)");
check(F.lineItemsTotal([{ quantity: -3, unitPrice: -10 }, { quantity: 2, unitPrice: 25 }]) === 50, "negative qty/price treated as 0 in the total");

console.log("\n(2) editor is a repeating mini-table (fields.js):");
check(/def\.type === "line_items"/.test(fieldsSrc), "there is a line_items editor branch");
check(/"\+ Add row"/.test(fieldsSrc) && /work\.push\(\{ description: "", quantity: "", unitPrice: "" \}\)/.test(fieldsSrc), "an “+ Add row” control adds a blank row");
check(/li-row-total/.test(fieldsSrc) && /li-grand/.test(fieldsSrc), "each row shows a live line total and there's a grand total");
check(/\.filter\(\(r\) => !rowIsEmpty\(r\)\)/.test(fieldsSrc), "fully-empty rows are dropped when saving");
check(/def\.type === "line_items" \|\| def\.type === "formula"/.test(fieldsSrc), "line_items is a wide field row");

console.log("\n(3) list cell shows a summary + sorts by total (portal.js):");
check(/f\.type === "line_items"/.test(portal) && /App\.fields\.lineItemsSummary\(get\(r\)\)/.test(portal), "list cell renders the compact summary");
check(/type: "number", get: \(r\) => App\.fields\.lineItemsTotal\(get\(r\)\)/.test(portal), "the column sorts by the numeric total");

console.log("\n(4) reporting exposes the total as a number:");
check(/f\.type === "number" \|\| f\.type === "percent" \|\| f\.type === "line_items"/.test(reports), "line_items is offered as a numeric measure field");
check(/liLike\(v\) && App\.fields && App\.fields\.lineItemsTotal \? App\.fields\.lineItemsTotal\(v\)/.test(reports), "sum/avg measures use the line-items TOTAL");

console.log("\n(5) styles:");
check(/\.li-table \{[^}]*border-collapse: collapse/.test(css) && /\.form-line-items \{[^}]*overflow-x: auto/.test(css), "mini-table styles exist and scroll on narrow screens");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (line_items: mini-table editor; live totals; summary cell; numeric reporting)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
