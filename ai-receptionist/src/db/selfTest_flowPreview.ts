// Batch C1 Pass 2 self-test — protects the live-preview ASSEMBLY + incomplete-
// state wording against silent drift.
//
//   npx tsx src/db/selfTest_flowPreview.ts
//
// It imports the SAME pure module the browser uses (public/js/flowPreview.js)
// and feeds it known "parts" (the already-resolved When text, condition texts,
// action texts) — including every incomplete case from the spec — then asserts
// the assembled structure + sentence.
//
// WHAT THIS PROVES: the ordering, the placeholders, and the incomplete-state
// behavior (no trigger / trigger param missing / partial conditions / no
// actions) are exactly as intended, and can't change without this test failing.
// WHAT IT DOES NOT PROVE: the WORDING of individual triggers/conditions/actions
// (triggerLabel/condText/actionSummary) — those live in the browser bundle, are
// unchanged, and are shared with the wizard; verify those by clicking.
//
// No database, no DOM — pure assertions.

export {}; // mark as a module so top-level names don't collide with other scripts

/* eslint-disable @typescript-eslint/no-var-requires */
const path = require("path");
const FP = require(path.join(__dirname, "../../public/js/flowPreview.js"));

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

function main() {
  console.log("Batch C1 Pass 2 — flow-preview assembly self-test");
  console.log("=================================================");

  // (a) No trigger -> neutral placeholder, never a broken sentence.
  console.log("(a) no trigger chosen:");
  let m = FP.flowModel({ when: "", conditions: [], actions: [] });
  check(m.placeholder === true, "model marked as placeholder");
  check(FP.flowSummary({ when: "" }) === "Pick a trigger to see a preview.", "summary is the neutral placeholder");

  // (b) Trigger + no conditions + no actions -> "won't do anything".
  console.log("(b) trigger but no conditions and no actions:");
  m = FP.flowModel({ when: "Contact created", conditions: [], actions: [] });
  check(m.placeholder === false && m.whenLine === "Contact created", "When line set");
  check(m.runsEveryTime === true, "no conditions => runs every time");
  check(m.noActions === true, "no actions flagged");
  check(/won't do anything/.test(FP.flowSummary({ when: "Contact created" })), "summary says it won't do anything yet");

  // (c) Full: trigger + conditions + actions -> complete sentence in order.
  console.log("(c) trigger + conditions + actions:");
  const full = { when: "Stage changed → to Hired", conditions: ["Status is Open"], actions: ["Send an email", "Add an internal note"] };
  m = FP.flowModel(full);
  check(m.runsEveryTime === false && m.conditionLines.length === 1, "condition carried through");
  check(m.noActions === false && m.actionLines.length === 2, "actions carried through");
  check(
    FP.flowSummary(full) === "When Stage changed → to Hired, only if Status is Open, then Send an email, then Add an internal note.",
    "summary assembles When / only if / then in order"
  );

  // (d) Scoped trigger chosen but its required param missing -> visibly incomplete.
  console.log("(d) trigger param not set yet (e.g. Scheduled with no date field):");
  m = FP.flowModel({ when: "3 days before — choose a date field", whenIncomplete: true, conditions: [], actions: ["Send an email"] });
  check(m.triggerIncomplete === true, "triggerIncomplete flag surfaced (UI marks it '(incomplete)')");
  check(/choose a date field/.test(m.whenLine), "When line shows a blank slot, not a fake value");

  // (e) Conditions present but partial -> complete ones shown, partial ones counted.
  console.log("(e) partial conditions are not rendered as complete:");
  m = FP.flowModel({ when: "Contact created", conditions: ["Email is not empty"], incompleteConditions: 2, actions: ["Send an email"] });
  check(m.conditionLines.length === 1, "only complete conditions are shown");
  check(m.incompleteConditions === 2, "incomplete conditions are counted (UI shows 'N still being filled in')");
  check(m.runsEveryTime === false, "having a complete condition is not 'runs every time'");

  // (f) Blank/whitespace pieces are ignored (defensive).
  console.log("(f) blank/whitespace pieces are ignored:");
  m = FP.flowModel({ when: "Contact created", conditions: ["", "   ", "Name contains A"], actions: ["", "Send an email"] });
  check(m.conditionLines.length === 1 && m.actionLines.length === 1, "empty strings filtered out");

  console.log("\n=================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
