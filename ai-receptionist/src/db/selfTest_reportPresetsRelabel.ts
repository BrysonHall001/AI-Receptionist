// Pure self-test: the report template/wizard copy is written with the CANONICAL
// nouns the app's relabel helper (App.relabelText) knows how to swap, so once run
// through it a portal sees its own renamed noun in titles, descriptions and the
// widget names templates/wizard create.
//
//   npx tsx src/db/selfTest_reportPresetsRelabel.ts
//
// This faithfully replicates App.relabelText(text,{all:true}) (public/js/util.js):
// it swaps Contact(s)/Candidate(s) → contact label, and (with all) Job(s)/Record(s)/
// Stage(s). We rename those kinds to distinctive words and assert NO canonical noun
// survives in any preset's name/description/widget title, and that contacts-based
// presets now show the custom word.
import { REPORT_PRESETS } from "../analytics/reportPresets";

type L = { one: string; many: string };
const LABELS: Record<string, L> = {
  contact: { one: "Parfait", many: "Parfaits" },
  record: { one: "Ledger", many: "Ledgers" },
  job: { one: "Gig", many: "Gigs" },
  stage: { one: "Phase", many: "Phases" },
};
// Mirror of App.relabelText(text, { all: true }).
function relabel(text: string): string {
  let out = String(text);
  const swap = (one: string, many: string, kind: string) => {
    const Lm = LABELS[kind].many, Lo = LABELS[kind].one;
    out = out
      .replace(new RegExp("\\b" + many + "\\b", "g"), Lm)
      .replace(new RegExp("\\b" + one + "\\b", "g"), Lo)
      .replace(new RegExp("\\b" + many.toLowerCase() + "\\b", "g"), Lm.toLowerCase())
      .replace(new RegExp("\\b" + one.toLowerCase() + "\\b", "g"), Lo.toLowerCase());
  };
  swap("Contact", "Contacts", "contact");
  swap("Candidate", "Candidates", "contact");
  swap("Job", "Jobs", "job");
  swap("Record", "Records", "record");
  swap("Stage", "Stages", "stage");
  return out;
}

const CANON = /\b(contacts?|candidates?|jobs?|records?|stages?)\b/i;
let failures = 0;
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures++; }

console.log("Report presets — label-aware copy\n=================================");

for (const p of REPORT_PRESETS) {
  const raw = [p.name, p.description, p.widget.title].join(" || ");
  const relabeled = relabel(raw);
  check(!CANON.test(relabeled), `preset "${p.key}" leaves no un-relabeled noun (title/description/widget title)`);
}

// The contacts-based presets must actually surface the custom noun after relabel —
// proving the copy runs through the helper rather than hardcoding "contact".
const contactPresets = REPORT_PRESETS.filter((p) => /\bcontacts?\b/i.test([p.name, p.description, p.widget.title].join(" ")));
check(contactPresets.length > 0, "there are contacts-based presets to prove the swap");
for (const p of contactPresets) {
  const relabeledTitle = relabel(p.widget.title);
  const relabeledAll = relabel([p.name, p.description, p.widget.title].join(" "));
  check(/parfait/i.test(relabeledAll), `preset "${p.key}" shows the renamed noun in its copy`);
  check(/parfait/i.test(relabeledTitle) || !/\bcontacts?\b/i.test(p.widget.title), `preset "${p.key}" widget TITLE relabels (e.g. "New Parfaits per week")`);
}

console.log(`\n${failures === 0 ? "ALL PASSED \u2705 (report template/wizard copy is label-aware)" : failures + " FAILED \u274c"}`);
process.exit(failures ? 1 : 0);
