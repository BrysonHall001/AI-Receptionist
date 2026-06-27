// Batch self-test — Composer round 2: continue-numbering removed, Send-to-top, typed
// chips, checkbox recipient source, preload-as-checked, deep-link. Mostly DOM/visual, so
// this loads compose.js standalone (regression) and statically verifies the client wiring.
//
//   npx tsx src/db/selfTest_composerR2.ts

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}
function escHtml(s: any): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
}

function main() {
  console.log("Email composer round 2 — 1… removed, chips, checkboxes");
  console.log("======================================================");

  const compose = readFileSync(resolve(__dirname, "../../public/js/compose.js"), "utf8");
  const comm = readFileSync(resolve(__dirname, "../../public/js/communication.js"), "utf8");

  // ---------- (1) continue-numbering removed at the source ----------
  console.log("(1) continue-numbering removed:");
  check(!/continueNumbering/.test(compose), "no continueNumbering function/handler remains");
  check(!/ql-continue/.test(compose), "no '1…' (ql-continue) toolbar button remains");
  check(/class="ql-list" value="ordered"/.test(compose) && /class="ql-list" value="bullet"/.test(compose), "regular ordered/unordered list buttons still present");

  // ---------- (2) compose.js still loads + CTA button serializes (regression) ----------
  console.log("\n(2) composer still works:");
  (globalThis as any).App = { util: { el: () => ({}), esc: escHtml, toast: () => {} } };
  // eslint-disable-next-line no-eval
  (0, eval)(compose);
  const C = (globalThis as any).App.compose;
  check(!!C && typeof C.buildButtonHtml === "function", "compose.js loads and exposes its API");
  const html = C.buildButtonHtml({ text: "Go", url: "https://x.test", fill: "#5b5bd6", color: "#fff", border: "#fff", radius: 8, font: "arial" });
  check(/^<a /.test(html) && html.includes('href="https://x.test"') && html.includes("border-radius:8px"), "CTA button still serializes to inline-styled HTML");
  const sites: string[] = C.MOUNT_SITES || [];
  sites.forEach((s) => console.log("     • " + s));
  check(sites.length >= 5, "mount inventory still published (1… removal propagates to all)");

  // ---------- (3) typed emails are removable chips ----------
  console.log("\n(3) typed-email chips:");
  check(/state\.typed/.test(comm) && /function commitTyped\(\)/.test(comm), "typed addresses are committed into chips (state.typed)");
  check(/el\("span", "chip"\)/.test(comm) && /chip-x/.test(comm), "chips render with an ✕ remove control");
  check(/state\.typed = state\.typed\.filter\(\(a\) => a !== addr\)/.test(comm), "clicking ✕ removes just that address");
  check(/EMAIL_RE\.test\(t\)/.test(comm), "invalid typed addresses are flagged, not added");

  // ---------- (4) checkbox recipient source + union ----------
  console.log("\n(4) checkbox source + union:");
  check(/aud-ck/.test(comm) && /state\.checked/.test(comm), "table rows have checkboxes feeding state.checked");
  check(/Select all \$\{all\.length\}/.test(comm) || /Select all /.test(comm), "a select-all control is present");
  check(/if \(state\.checked\.size\) base = base\.filter\(\(c\) => state\.checked\.has\(c\.id\)\)/.test(comm), "checked rows present → only checked from the table source (else all matching)");
  check(/return base\.filter\(\(c\) => !state\.excluded\.has\(c\.id\)\)/.test(comm), "per-row exclude still subtracts");
  check(/getTypedEmails\(\)/.test(comm) && /getRecipientIds\(\)/.test(comm), "union exposed via getRecipientIds (contacts) + getTypedEmails (chips)");

  // ---------- (5) Send button at the top of the compose panel ----------
  console.log("\n(5) Send at top:");
  check(/const sendBtn = el\("button", "btn btn-primary", "Send email"\);[\s\S]{0,200}headRow\.appendChild\(headLeft\); headRow\.appendChild\(sendWrap\)/.test(comm), "Send button sits in the New email panel header (top), not the bottom");
  check(/sendCount/.test(comm) && /recipient/.test(comm), "a live recipient count sits with the Send button");

  // ---------- (6) preload pre-checks + deep-link ----------
  console.log("\n(6) preload + deep-link:");
  check(/checked: new Set\(Array\.isArray\(opts\.preloadIds\) \? opts\.preloadIds : \[\]\)/.test(comm), "preloaded contacts start checkbox-selected");
  check(/pendingPreload = Array\.isArray\(ids\)/.test(comm) && /App\.go\("#\/communication"\)/.test(comm), "Contacts 'Email selected' deep-links into this composer with preload");

  console.log("\n======================================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (composer round 2)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
