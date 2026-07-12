// Pure self-test (no DB) for the generic "Related" tabs UI on the Contact page.
//
//   npx tsx src/db/selfTest_relatedTabs.ts
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

const portal = readFileSync(resolve(__dirname, "../../public/js/portal.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");
// Scope most checks to the Related-area function so we're asserting the new code.
const relStart = portal.indexOf("async function mountContactRelated");
const relEnd = portal.indexOf("function moduleHasStages(t)");
const REL = portal.slice(relStart, relEnd);

console.log("Related tabs — generic per-module UI");
console.log("===================================\n");

console.log("(A) old hardcoded stacked cards are gone:");
check(!/linked-jobs-card/.test(portal) && !/linked-equipment-card/.test(portal), "no hardcoded Linked Jobs / Equipment cards remain");
check(!/\+ Add equipment/.test(portal), "the equipment-only '+ Add equipment' button is gone");
check(/el\("div", "card related-card"\)/.test(portal) && /mountContactRelated\(relTabsBar, relBody, id, c\)/.test(portal), "the contact page mounts a single generic Related area");

console.log("\n(A2) tabs are GENERIC (one per module, not hardcoded Jobs/Equipment):");
check(/await App\.portalApi\("\/api\/record-types"\)/.test(REL), "tabs are derived from /api/record-types");
check(/t\.key !== "contact" && !App\.isRecordTypeLocked\(t\.key\) && !App\.isNavHidden/.test(REL), "every visible non-contact module gets a tab (filter, not a hardcoded key list)");
check(!/=== "job"|=== "equipment"/.test(REL), "no hardcoded job/equipment special-casing in the tab builder");
check(/navPos\[App\.recordTypeHref\(a\.key\)\]/.test(REL), "tabs are ordered by nav order (so a new module slots in)");
check(/buildContactRelatedPane\(pane, type, contactId, contactObj\)/.test(REL), "each tab renders a generic module pane");

console.log("\n(B) universal link bar on EVERY tab (search existing + create new):");
check(/el\("input", "input link-search"\)/.test(REL), "every pane has a search-to-link input");
check(/related-create-btn/.test(REL) && /openCreateRecord\(type\.key, f, type, \{ linkContactId: contactId/.test(REL), "every pane has a create-new-and-link button");
check(/"\/api\/records\/" \+ r\.id \+ "\/links"[\s\S]{0,160}parentType: "contact", parentId: contactId/.test(REL), "search result links the existing record to this contact (symmetric link endpoint)");
check(/allRecs = await App\.portalApi\("\/api\/records\?type=" \+ encodeURIComponent\(type\.key\)\)/.test(REL) || /"\/api\/records\?type=" \+ encodeURIComponent\(type\.key\)/.test(REL), "search source is the module's own records list (generic)");

console.log("\n(C) List/Board toggle ONLY when the module has stages (config-driven):");
check(/const hasStages = moduleHasStages\(type\)/.test(REL), "board availability is decided by moduleHasStages(type)");
check(/if \(hasStages\) \{[\s\S]{0,400}?seg-btn seg-on", "List"[\s\S]{0,200}?"Board"/.test(REL), "the List|Board toggle is only built when hasStages");
check(/function renderView\(\) \{ if \(hasStages && view === "board"\) renderBoard\(\); else renderList\(\); \}/.test(REL), "board view is unreachable without stages (List only otherwise)");
check(/if \(hasStages\) \{\s*const stageSel/.test(REL), "the per-row stage dropdown only shows for staged modules");
// moduleHasStages itself is config-driven (stages / subtypes[].stages), not hardcoded keys.
const mhs = portal.slice(portal.indexOf("function moduleHasStages(t)"), portal.indexOf("function moduleHasStages(t)") + 260);
check(/Array\.isArray\(t\.stages\) && t\.stages\.length/.test(mhs) && /st\.stages/.test(mhs) && !/=== "job"/.test(mhs), "moduleHasStages reads pipeline config (stages / subtypes[].stages), not hardcoded keys");

console.log("\n(D) kanban stage movement preserved (same endpoints):");
check(/const board = el\("div", "kanban"\)/.test(REL) && /el\("div", "swimlanes"\)/.test(REL), "board renders the kanban swimlanes (as the Jobs board did)");
check(/"\/api\/record-links\/" \+ lk\.id, \{ method: "PATCH", body: JSON\.stringify\(\{ stageKey: newStage \}\) \}/.test(REL), "dragging a card PATCHes the link stageKey (unchanged behavior)");
check(/"\/api\/record-links\/" \+ lk\.id, \{ method: "DELETE" \}/.test(REL), "unlink still soft-deletes the link");

console.log("\n(E) styles:");
check(/\.related-tabs \{[^}]*overflow-x: auto/.test(css), "related tabs scroll horizontally on narrow screens");
check(/\.related-pane \.link-add \{[^}]*flex-wrap: wrap/.test(css), "the link bar wraps gracefully");

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (generic per-module tabs; universal link bar; board only with stages)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
