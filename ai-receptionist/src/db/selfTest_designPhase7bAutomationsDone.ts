/**
 * Design Phase 7b — automations.js migration COMPLETE.
 *
 * Proves:
 *  (1) automations.js has ZERO inline-style sites — not even dynamics. Finding worth
 *      stating plainly: the spec anticipated positional drag/connector dynamics here, but
 *      the actual flow canvas lives in drips.js (its 17 documented dynamics are covered by
 *      selfTest_designPhase6Comms); automations' flow PREVIEW renders through static classes.
 *      No email-destined markup is built here either.
 *  (2) The preview mechanism is intact in source (renderPreview present, wired to the FP
 *      module) — behavior is covered by selfTest_flowPreview, run alongside this test.
 *  (3) Migrated visibility toggles have both sides of the u-hidden protocol; no double-class
 *      attributes; status chips converged onto token classes.
 *
 * No DB required.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

let failures = 0;
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

function main() {
  console.log("Design Phase 7b — automations.js done");
  console.log("=====================================");
  const s = readFileSync(resolve(__dirname, "../../public/js/automations.js"), "utf8");
  const css = readFileSync(resolve(__dirname, "../../public/styles.css"), "utf8");
  const hits = s.match(/\.style\.cssText\s*\+?=|\.style\.(?!cssText)[a-zA-Z]+\s*=[^=]|style="/g) || [];

  console.log("\n(1) zero inline sites:");
  check(hits.length === 0, `automations.js fully clean — 0 static AND 0 dynamic (found ${hits.length}); the flow canvas's dynamics live in drips.js`);
  check(!/<!DOCTYPE|<table|mso-|buildButtonHtml/.test(s), "no email-destined markup built here");

  console.log("\n(2) preview mechanism intact:");
  check(s.includes("renderPreview") && s.includes("previewNode"), "renderPreview + previewNode wiring present");
  check(s.includes('previewNode.classList.add("u-hidden")') && s.includes('previewNode.classList.remove("u-hidden")'), "preview show/hide via u-hidden, both sides");

  console.log("\n(3) toggles, chips, hygiene:");
  check(s.includes('valInp.classList.toggle("u-hidden", noValueOp(cond.op))'), "condition value input toggle migrated with its site");
  check(s.includes('chip.classList.add(a.enabled ? "chip-on" : "chip-off")'), "drip-managed status chip on token classes");
  check(css.includes(".chip-on { background: var(--green-soft); color: var(--green); }"), "chip-on converged onto the green token pair");
  check(s.includes("pair-pill pair-pill-info"), "drip-source pill on the accent token pair");
  const doubles = s.match(/<[a-z]+[^>]*class="[^"]*"[^>]*class="/g) || [];
  check(doubles.length === 0, `zero double-class tags (found ${doubles.length})`);

  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exit(1);
}

main();
