/**
 * Design Phase 7 — admin hub + reports + feedback on the design system; themeScene exemption.
 *
 * Proves:
 *  (1) admin.js carries no static inline styles — exactly 4 documented dynamics remain
 *      (status badges + info dot via the single-custom-property pattern).
 *  (2) reports.js and feedback.js are fully clean (0 inline sites), and the report wizard's
 *      show/hide plumbing uses the u-hidden class protocol.
 *  (3) admin surfaces use the shared component classes (card/btn/pill conventions).
 *  (4) themeScene.js is exempt via an EXPLICIT in-file marker that designAudit requires —
 *      marked, not silently skipped.
 *  (5) Seam: automations.js is DEFERRED to Phase 7b (140 sites, inventoried) — untouched,
 *      still counted, named here. (Phases 5b and 6b remain queued too: portal.js 171-of-196,
 *      communication.js 175.)
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

const PUB = resolve(__dirname, "../../public");
const INLINE = /\.style\.cssText\s*\+?=|\.style\.(?!cssText)[a-zA-Z]+\s*=[^=]|style="/g;
const hits = (s: string) => (s.match(INLINE) || []).length;

function main() {
  console.log("Design Phase 7 — admin hub + smalls");
  console.log("===================================");

  const admin = readFileSync(resolve(PUB, "js/admin.js"), "utf8");
  const reports = readFileSync(resolve(PUB, "js/reports.js"), "utf8");
  const feedback = readFileSync(resolve(PUB, "js/feedback.js"), "utf8");
  const scene = readFileSync(resolve(PUB, "js/themeScene.js"), "utf8");
  const autom = readFileSync(resolve(PUB, "js/automations.js"), "utf8");
  const audit = readFileSync(resolve(__dirname, "designAudit.ts"), "utf8");
  const css = readFileSync(resolve(PUB, "styles.css"), "utf8");

  console.log("\n(1) admin.js:");
  check(hits(admin) === 4, `exactly 4 documented dynamics (found ${hits(admin)})`);
  check((admin.match(/style="--badge-bg:/g) || []).length === 3, "3 status badges use the --badge-bg custom property");
  check((admin.match(/style="--dot:\$\{e\.dot\}"/g) || []).length === 1, "activity dot uses the --dot custom property");
  check(admin.includes('b.style.setProperty("--badge-bg"'), "DOM-built badge also goes through setProperty");
  check(!/#[0-9a-fA-F]{3,8}/.test(admin.split("\n").filter((l) => l.toLowerCase().includes("style")).join("\n")), "no raw hex in any style context in admin.js");

  console.log("\n(2) reports.js + feedback.js:");
  check(hits(reports) === 0, `reports.js fully clean (found ${hits(reports)})`);
  check(hits(feedback) === 0, `feedback.js fully clean (found ${hits(feedback)})`);
  check(reports.includes('classList.toggle("u-hidden"'), "report wizard show/hide uses the u-hidden protocol");
  check(reports.includes('td.style.setProperty("--hm-a"'), "heatmap intensity uses the custom-property pattern");
  check(css.includes("rgba(91,91,214,var(--hm-a, 0.08))"), "heatmap cell background reads --hm-a from the class");

  console.log("\n(3) shared components on admin surfaces:");
  check(admin.includes('"adm-badge"') && css.includes(".adm-badge {"), "unified admin status badge class exists and is used");
  check(admin.includes("adm-mode-pill"), "live/test mode pill on token classes");
  check(admin.includes('el("div", "card') || admin.includes('"card '), "admin panels use the shared card class");
  check(css.includes(".adm-minitag-danger { color: var(--on-accent); background: var(--red); }"), "danger minitag converged onto --red");

  console.log("\n(4) themeScene exemption — marked, not silent:");
  check(scene.startsWith("// <scene-exempt>"), "themeScene.js carries the <scene-exempt> marker at the top");
  check(audit.includes('src.includes("// <scene-exempt>")'), "designAudit honors ONLY the in-file marker");
  check(hits(scene) === 24, `scene inline styles still present and untouched (found ${hits(scene)}, expected 24 — they ARE the feature)`);

  console.log("\n(5) Seam — deferred work, named:");
  check(hits(autom) === 0, `automations.js completed by Phase 7b (2026-07-13): fully clean, 0 sites (found ${hits(autom)}); was 140 inventoried at the Phase-7 seam`);

  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exit(1);
}

main();
