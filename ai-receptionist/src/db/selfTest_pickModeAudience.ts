// Batch self-test — Surveys master-detail layout + email audience PICK-MODE. Both are
// DOM/visual, so this statically pins the wiring (the numeric union/dedup is also proven
// server-side by selfTest_audienceEmails). Runs anywhere (no DB).
//
//   npx tsx src/db/selfTest_pickModeAudience.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

function main() {
  console.log("Surveys master-detail + email audience pick-mode");
  console.log("================================================");
  const comm = readFileSync(resolve(__dirname, "../../public/js/communication.js"), "utf8");
  const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");

  // ---------- PART 1: surveys master-detail ----------
  console.log("(1) surveys master-detail layout:");
  check(/"card survey-master"/.test(comm) && /"survey-detail"/.test(comm) && /"survey-split"/.test(comm), "two-pane split: library (master) + workspace (detail)");
  check(/\.survey-split\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*2fr\)/.test(css), "left ~1/3, right ~2/3 grid");
  check(/@media \(max-width: 900px\) \{ \.survey-split \{ grid-template-columns: 1fr; \}/.test(css), "stacks on a narrow viewport");
  check(/\[\["build", "Build"\], \["results", "Results"\]\]/.test(comm), "right-pane tab strip is ONLY Build/Results (no dead New tab)");
  check(!/\[\["new", "New Survey"\], \["build", "Build"\], \["results", "Results"\]\]/.test(comm), "old 3-tab New/Build/Results strip is gone");
  check(/const open = !!state\.id;.*\n\s*tabStrip\.style\.display = open \? "" : "none";/.test(comm), "tabs hidden in create mode, shown when a survey is open");
  check(/newSurveyBtn\.onclick = \(\) => setView\("new"\);/.test(comm), "'+ New survey' returns to a blank create form");

  // ---------- PART 2: pick-mode audience ----------
  console.log("\n(2) email audience pick-mode:");
  check(/checked: new Set\(Array\.isArray\(opts\.preloadIds\) \? opts\.preloadIds : \[\]\)/.test(comm), "selection starts EMPTY (only preloaded ids pre-checked)");
  check(/function contactRecipients\(\) \{ return emailableAll\(\)\.filter\(\(c\) => state\.checked\.has\(c\.id\)\); \}/.test(comm), "resolved contacts = checked ∩ emailable (no 'all matching' fallback)");
  check(!/state\.excluded/.test(comm), "exclude-mode removed entirely (unchecking is the removal)");
  check(/matches\.forEach\(\(c\) => state\.checked\.add\(c\.id\)\)/.test(comm), "applying a criteria filter CHECKS the matching rows (bulk add)");
  check(/addMatchBtn\.style\.display = has \? "" : "none"/.test(comm), "criteria add-button only appears when a rule is set");
  check(/recipient\$\{c\.total === 1 \? "" : "s"\} selected/.test(comm), "count line reads 'X recipients selected' (pick-mode truth)");
  check(/No one is added until you pick them/.test(comm), "audience description describes pick-mode (not 'everyone matching')");
  check(!/previewToggle|previewBox|renderPreview/.test(comm), "old compact exclude-mode preview removed");
  // typed pills ∪ checked, de-duped:
  check(/state\.typed\.forEach\(\(e\) => \{ const lo = e\.toLowerCase\(\); if \(EMAIL_RE\.test\(e\) && !contactEmails\.has\(lo\) && !seen\.has\(lo\)\)/.test(comm), "typed pills de-duped against checked contacts (union, once)");
  check(/el\("span", "chip"\)/.test(comm) && /chip-x/.test(comm), "typed addresses remain removable pills");

  // ---------- PART 3: empty guard + propagation + deep-link ----------
  console.log("\n(3) empty guard, propagation, deep-link:");
  check(/sendBtn\.disabled = c\.total === 0;/.test(comm), "Send is disabled at zero recipients");
  check(/Add at least one recipient/.test(comm), "clear 'add at least one recipient' messaging");
  check(/No one is emailed until you add them/.test(comm), "email compose intro rewritten for pick-mode");
  // Survey send reuses the SAME picker (so it's pick-mode too) and guards empty:
  check(/App\.audiencePicker\.mount\(audienceHost, \{\}\)/.test(comm) && /No emailable recipients in this audience/.test(comm), "survey blast reuses the pick-mode picker and blocks an empty send");
  check(/pendingPreload = Array\.isArray\(ids\)/.test(comm), "Contacts 'Email selected' deep-link preloads ids → they arrive pre-checked");

  console.log("\n================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (master-detail + pick-mode)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
