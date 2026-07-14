/**
 * Design Phase 6b — communication.js migration COMPLETE.
 *
 * Proves:
 *  (1) communication.js has ZERO static inline styles; exactly 1 sanctioned dynamic remains
 *      (survey results bar via the --pw custom property). This file contains NO email-markup
 *      builders — the email-exempt regions live in compose.js (buildButtonHtml + header image),
 *      inventoried in Phase 6; both are re-asserted here.
 *  (2) Email protection: buildButtonHtml still emits inline-styled markup, byte-identical to
 *      the Phase-6 snapshot; the header-image insert region still carries its inline style.
 *  (3) Migrated visibility toggles have both sides of the u-hidden protocol; no double-class
 *      attributes in built HTML strings.
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
  console.log("Design Phase 6b — communication.js done");
  console.log("=======================================");
  const PUB = resolve(__dirname, "../../public");
  const s = readFileSync(resolve(PUB, "js/communication.js"), "utf8");
  const compose = readFileSync(resolve(PUB, "js/compose.js"), "utf8");
  const INLINE = /\.style\.cssText\s*\+?=|\.style\.(?!cssText)[a-zA-Z]+\s*=[^=]|style="/g;
  const hits = s.match(INLINE) || [];

  console.log("\n(1) zero statics; 1 itemized dynamic:");
  check(hits.length === 1, `exactly 1 inline site (found ${hits.length})`);
  check(s.includes('style="--pw:${Math.max(0, Math.min(100, pct))}%"'), "the one dynamic is the survey results bar via --pw (sanctioned pattern)");
  const emailish = /<!DOCTYPE|<table|mso-|wrapEmail|renderEmailBody/.test(s);
  check(!emailish, "communication.js builds no email markup (exempt regions correctly live in compose.js)");

  console.log("\n(2) email protection (compose.js regions from Phase 6):");
  const regions = compose.match(/\/\/ <email-html>[\s\S]*?\/\/ <\/email-html>/g) || [];
  check(regions.length === 2, `both email-exempt regions still marked (found ${regions.length})`);
  (globalThis as any).App = { util: { el: () => ({}), esc: (x: unknown) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"), toast: () => {} } };
  // eslint-disable-next-line no-eval
  (0, eval)(compose);
  const out: string = (globalThis as any).App.compose.buildButtonHtml({ text: "Snapshot", url: "https://x.test/snap", fill: "#3aa675", color: "#ffffff", border: "#1a1a1e", radius: 20, font: "georgia" });
  const SNAPSHOT = `<a href="https://x.test/snap" target="_blank" rel="noopener noreferrer" class="cta-btn" data-cta="{&quot;text&quot;:&quot;Snapshot&quot;,&quot;url&quot;:&quot;https://x.test/snap&quot;,&quot;fill&quot;:&quot;#3aa675&quot;,&quot;color&quot;:&quot;#ffffff&quot;,&quot;border&quot;:&quot;#1a1a1e&quot;,&quot;radius&quot;:20,&quot;font&quot;:&quot;georgia&quot;}" style="display:inline-block;background:#3aa675;color:#ffffff;border:1px solid #1a1a1e;border-radius:20px;padding:10px 18px;font-family:Georgia, serif;font-weight:600;font-size:14px;text-decoration:none;line-height:1.2">Snapshot</a>`;
  check(out.includes('style="'), "email CTA still inline-styled");
  check(out === SNAPSHOT, "email CTA BYTE-IDENTICAL to the Phase-6 snapshot");
  check(regions.some((r) => r.includes("email-header-img") && r.includes('style="max-width:100%"')), "header-image insert still inline-styled inside its marked region");

  console.log("\n(3) toggle pairs + no double-class:");
  const pairs: Array<[string, string, string]> = [
    ["addMatchBtn", '"btn btn-ghost btn-sm u-hidden", "+ Check matching"', 'addMatchBtn.classList.toggle("u-hidden", !has)'],
    ["newBtn (templates)", '"btn btn-ghost btn-sm u-hidden", "New template"', 'newBtn.classList.toggle("u-hidden", !t)'],
    ["newBtn (surveys)", '"btn btn-ghost btn-sm u-hidden", "New survey"', 'newBtn.classList.toggle("u-hidden", !survey)'],
    ["tabStrip", "tabStrip", 'tabStrip.classList.toggle("u-hidden", !open)'],
    ["results view", 'card.classList.toggle("u-hidden", v === "results")', 'resultsCard.classList.toggle("u-hidden", v !== "results")'],
    ["mapWarn", 'mapWarn.classList.remove("u-hidden")', 'mapWarn.classList.add("u-hidden")'],
    ["jbNote", "jbNote", 'jbNote.classList.toggle("u-hidden", !(rt === "job" || rt === "booking"))'],
    ["shareWrap", 'shareWrap.classList.remove("u-hidden")', 'shareWrap.classList.add("u-hidden")'],
    ["sendSurveyBtn", 'sendSurveyBtn.classList.remove("u-hidden")', 'sendSurveyBtn.classList.add("u-hidden")'],
  ];
  for (const [name, a, b] of pairs) check(s.includes(a) && s.includes(b), `${name}: both sides present`);
  const doubles = s.match(/<[a-z]+[^>]*class="[^"]*"[^>]*class="/g) || [];
  check(doubles.length === 0, `zero double-class tags (found ${doubles.length})`);

  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exit(1);
}

main();
