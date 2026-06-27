// Batch self-test — Email composer (shared App.compose). The interactive bits are
// visual, but the SERIALIZATION + link-source logic are pure functions we can assert.
// Loads compose.js standalone (browser IIFE) with a stubbed App, like the table.js tests.
//
//   npx tsx src/db/selfTest_composer.ts

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
function unesc(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");
}

function main() {
  console.log("Email composer — serialization + link source");
  console.log("============================================");

  // Stub the globals compose.js expects at load time.
  (globalThis as any).App = { util: { el: () => ({}), esc: escHtml, toast: () => {} } };
  const code = readFileSync(resolve(__dirname, "../../public/js/compose.js"), "utf8");
  // eslint-disable-next-line no-eval
  (0, eval)(code);
  const compose = (globalThis as any).App.compose;
  check(!!compose && typeof compose.buildButtonHtml === "function", "compose.js loaded and exposes buildButtonHtml");

  // ---------- (1) CTA button serialization ----------
  console.log("\n(1) CTA button serializes to inline-styled HTML:");
  const cfg = { text: "Take the survey", url: "https://x.test/go", fill: "#3aa675", color: "#ffffff", border: "#1a1a1e", radius: 20, font: "georgia" };
  const html: string = compose.buildButtonHtml(cfg);
  check(/^<a /.test(html) && html.includes('href="https://x.test/go"'), "renders an <a> with the link URL");
  check(html.includes('style="') && html.includes("background:#3aa675") && html.includes("color:#ffffff"), "uses INLINE styles (email-safe) with the chosen colors");
  check(html.includes("border:1px solid #1a1a1e") && html.includes("border-radius:20px"), "inline outline color + corner roundness present");
  check(html.includes("font-family:Georgia"), "chosen preset font applied inline");
  check(html.includes('class="cta-btn"') && html.includes("data-cta="), "carries the cta-btn marker + data-cta config for editing");
  check(html.includes(">Take the survey</a>"), "button text present");

  // ---------- (2) round-trips through save -> reload (config preserved in data-cta) ----------
  console.log("\n(2) round-trip (config survives in the HTML):");
  const m = /data-cta="([^"]*)"/.exec(html);
  let parsed: any = null;
  try { parsed = JSON.parse(unesc(m ? m[1] : "{}")); } catch { parsed = null; }
  check(!!parsed && parsed.url === cfg.url && parsed.fill === cfg.fill && parsed.radius === 20 && parsed.font === "georgia", "data-cta decodes back to the same button config");
  // re-serializing the parsed config reproduces the same markup (stable round-trip)
  check(compose.buildButtonHtml(parsed) === html, "re-serialize(parse(html)) === html (stable round-trip)");

  // ---------- (3) survey link source: token vs public ----------
  console.log("\n(3) survey link source:");
  check(compose.SURVEY_LINK_TOKEN === "{{survey_link}}", "the merge token constant is {{survey_link}}");
  const survey = { id: "s1", name: "NPS", publicId: "abc123" };
  check(compose.surveyLinkValue(survey, "token", "https://app.test") === "{{survey_link}}", "per-recipient context inserts the MERGE TOKEN (not a static URL)");
  check(compose.surveyLinkValue(survey, "public", "https://app.test") === "https://app.test/survey.html?s=abc123", "non-personalizing context falls back to the survey's public link");

  // ---------- (4) mount inventory ----------
  console.log("\n(4) App.compose mount inventory:");
  const sites: string[] = compose.MOUNT_SITES || [];
  sites.forEach((s) => console.log("     • " + s));
  check(Array.isArray(sites) && sites.length >= 5, "a mount inventory is published");
  check(sites.some((s) => /Automations/.test(s)) && sites.some((s) => /Templates/.test(s)) && sites.some((s) => /Compose/.test(s)), "inventory covers the key send sites");

  // ---------- (5) propagation: send sites route through the shared component ----------
  console.log("\n(5) propagation (no forked editors):");
  const read = (p: string) => readFileSync(resolve(__dirname, "../../public/js/" + p), "utf8");
  check(/App\.compose\.mount\(/.test(read("automations.js")), "Automations email action mounts App.compose");
  check(/App\.compose\.mount\(/.test(read("communication.js")), "Communication / Templates / Surveys mount App.compose");
  check(/App\.compose\.mount\(/.test(read("portal.js")), "Contacts email + signature mount App.compose");
  check(/surveyLinkMode: "token"/.test(read("communication.js")), "survey-send composer requests per-recipient token mode");

  console.log("\n============================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (composer)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
