// Pure frontend self-test (no DB) for the Currency/File rendering + drag-to-create +
// independent-scroll wiring. Behavioural check of formatValue (vm-loaded fields.js)
// plus source/CSS assertions for the editor branches and Task 2/3 plumbing.
//
//   npx tsx src/db/selfTest_currencyFileDnd.ts
import vm from "vm";
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const fieldsSrc = readFileSync(resolve(__dirname, "../../public/js/fields.js"), "utf8");
const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

console.log("Currency + File rendering / drag / scroll");
console.log("=========================================\n");

// Behavioural: load App.fields and exercise formatValue.
const sandbox: any = { window: { App: { util: { el: () => ({ appendChild() {} }), esc: (s: any) => s } } } };
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(fieldsSrc, sandbox);
const F = sandbox.window.App.fields;
console.log("(1) labels + formatValue:");
check(F.TYPE_LABELS.currency === "Currency" && F.TYPE_LABELS.file === "File", "Currency + File appear in TYPE_LABELS");
const expMoney = "$" + (1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
check(F.formatValue({ type: "currency" }, 1234.5) === expMoney, "currency formats as money (" + expMoney + ")");
check(F.formatValue({ type: "currency" }, "") === "" && F.formatValue({ type: "currency" }, null) === "", "empty currency shows blank");
check(F.formatValue({ type: "file" }, { name: "spec.pdf", data: "data:x" }) === "spec.pdf", "file shows its filename");
check(F.formatValue({ type: "file" }, null) === "", "empty file shows blank");

console.log("\n(2) editors (fields.js):");
check(/def\.type === "file"/.test(fieldsSrc) && /form-file-link/.test(fieldsSrc), "file editor renders a download/open link");
check(/def\.type === "currency"/.test(fieldsSrc) && /form-currency/.test(fieldsSrc) && /"form-prefix", "\$"/.test(fieldsSrc), "currency editor shows a $ prefix");
check(/def\.type === "textarea" \|\| def\.type === "multi_select" \|\| def\.type === "image" \|\| def\.type === "file" \|\| def\.type === "address" \|\| def\.type === "line_items" \|\| def\.type === "formula"/.test(fieldsSrc), "file is a wide field row");

console.log("\n(3) drag-from-library create (Task 2):");
check(/item\.draggable = true;/.test(portal) && /mfLibraryDragType = t;/.test(portal), "library items are draggable and carry their type");
check(/async function createFieldFromLibrary\(type, sectionId\)/.test(portal), "a create-from-library helper exists");
check(/"\/api\/fields", \{ method: "POST", body: JSON\.stringify\(\{ recordType: selectedKey, label, type, sectionId: sectionId \|\| null \}\) \}/.test(portal), "drop posts createField with recordType + type + sectionId + default label");
check(/if \(!mfLibraryDragType\) return;[\s\S]*?field-list--drop/.test(portal), "section lists highlight + accept a library drag");
check(/openFieldModal\(created, selectedKey\)/.test(portal), "after creating, the field's Edit dialog opens to name it");
check(!/Drag-and-drop is coming soon/.test(portal), "the old 'coming soon' hint is gone");
check(/Drag a field type onto a section to add it/.test(portal), "the description explains drag-to-create");

console.log("\n(4) reorder still distinct + list cells:");
check(/document\.querySelector\("\.field-row\.dragging"\)/.test(portal), "field reorder still keyed off .field-row.dragging (separate from library drag)");
check(/f\.type === "file"[\s\S]*?cell-link/.test(portal), "list/table renders a file as a download link");
check(/f\.type === "currency"[\s\S]*?App\.fields\.formatValue/.test(portal), "list/table renders currency via formatValue");

console.log("\n(5) independent scroll (Task 3) + CSS:");
check(/const scroll = el\("div", "mf-fields-scroll"\)/.test(portal), "the sections/fields list is wrapped in a scroll container");
check(/\.mf-fields-scroll \{ flex: 1 1 auto; min-height: 0; overflow-y: auto/.test(css) && !/\.mf-fields-scroll \{[^}]*max-height: calc\(100vh/.test(css), "mf-fields-scroll fills its column and scrolls (the old viewport max-height cap is gone — space pass)");
check(/\.field-list--drop \{/.test(css), "drop-target highlight style exists");
check(/\.form-currency \{/.test(css) && /\.form-file \{/.test(css) && /\.cell-link \{/.test(css), "currency/file/cell-link styles exist");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (currency/file render; drag-to-create; independent scroll)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
