/**
 * Design Phase 6 — comms cluster (compose.js + drips.js) on the design system.
 *
 * Proves:
 *  (1) compose.js app-UI carries ZERO static inline styles — the only inline styles left
 *      live inside `// <email-html> … // </email-html>` marker regions (outbound email markup,
 *      which MUST stay inline because email clients don't load stylesheets).
 *  (2) Email-output protection: buildButtonHtml still emits inline-styled HTML, and its
 *      output is BYTE-IDENTICAL to the pre-batch snapshot for a fixed config.
 *  (3) drips.js is clean of static inline styles; exactly 17 documented dynamic sites remain
 *      (flow-canvas geometry engine + single-custom-property color plumbing).
 *  (4) The designAudit email-html marker mechanism actually strips marked regions.
 *  (5) Seam: communication.js is DEFERRED to Phase 6b (175 sites, inventoried) — untouched
 *      this batch, still counted in the baseline, named here so it can't read as "done".
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

function stripEmail(src: string): string {
  return src.replace(/\/\/ <email-html>[\s\S]*?\/\/ <\/email-html>/g, "");
}
function hits(src: string): number {
  return (src.match(INLINE) || []).length;
}

function main() {
  console.log("Design Phase 6 — comms cluster");
  console.log("==============================");

  const compose = readFileSync(resolve(PUB, "js/compose.js"), "utf8");
  const drips = readFileSync(resolve(PUB, "js/drips.js"), "utf8");
  const comm = readFileSync(resolve(PUB, "js/communication.js"), "utf8");
  const audit = readFileSync(resolve(__dirname, "designAudit.ts"), "utf8");

  console.log("\n(1) compose.js app-UI is clean; email regions are marker-wrapped:");
  const composeApp = stripEmail(compose);
  check(hits(composeApp) === 0, `zero inline-style sites outside email-html markers (found ${hits(composeApp)})`);
  const emailRegions = compose.match(/\/\/ <email-html>[\s\S]*?\/\/ <\/email-html>/g) || [];
  check(emailRegions.length === 2, `exactly 2 email-html regions (buildButtonHtml + header-image insert), found ${emailRegions.length}`);
  check(emailRegions.some((r) => r.includes("function buildButtonHtml")), "buildButtonHtml lives inside a marker region");
  check(emailRegions.some((r) => r.includes("email-header-img")), "header-image insert lives inside a marker region");
  check(emailRegions.every((r) => r.includes('style=') || r.includes(".style.")), "marked regions genuinely contain inline styles (exemption is load-bearing, not decorative)");

  console.log("\n(2) Email output still inline-styled and byte-identical:");
  (globalThis as any).App = {
    util: {
      el: () => ({}),
      esc: (x: unknown) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
      toast: () => {},
    },
  };
  // eslint-disable-next-line no-eval
  (0, eval)(compose);
  const api = (globalThis as any).App.compose;
  check(typeof api?.buildButtonHtml === "function", "compose.js loads and exposes buildButtonHtml");
  const out: string = api.buildButtonHtml({ text: "Snapshot", url: "https://x.test/snap", fill: "#3aa675", color: "#ffffff", border: "#1a1a1e", radius: 20, font: "georgia" });
  check(out.includes('style="') && out.includes("background:#3aa675") && out.includes("border-radius:20px"), "email CTA still uses INLINE styles (exemption respected, not steamrolled)");
  // Pre-batch snapshot, captured from the untouched Phase-5a compose.js with this exact config:
  const SNAPSHOT = `<a href="https://x.test/snap" target="_blank" rel="noopener noreferrer" class="cta-btn" data-cta="{&quot;text&quot;:&quot;Snapshot&quot;,&quot;url&quot;:&quot;https://x.test/snap&quot;,&quot;fill&quot;:&quot;#3aa675&quot;,&quot;color&quot;:&quot;#ffffff&quot;,&quot;border&quot;:&quot;#1a1a1e&quot;,&quot;radius&quot;:20,&quot;font&quot;:&quot;georgia&quot;}" style="display:inline-block;background:#3aa675;color:#ffffff;border:1px solid #1a1a1e;border-radius:20px;padding:10px 18px;font-family:Georgia, serif;font-weight:600;font-size:14px;text-decoration:none;line-height:1.2">Snapshot</a>`;
  check(out === SNAPSHOT, "buildButtonHtml output is BYTE-IDENTICAL to the pre-batch snapshot");

  console.log("\n(3) drips.js: clean, with exactly the documented flow-canvas dynamics:");
  const dHits = hits(drips);
  check(dHits === 17, `exactly 17 dynamic inline sites (found ${dHits}) — the flow-canvas engine`);
  check((drips.match(/card\.style\.left = node\.x \+ "px"/g) || []).length === 3 + 2, "node geometry via style.left/top on the three card builders + _moveTo x2");
  check((drips.match(/style="--node-accent:\$\{m\.accent\}"/g) || []).length === 4, "handle colors use the single-custom-property pattern (--node-accent x4)");
  check(drips.includes("surface.style.transform = `translate("), "pan/zoom transform documented dynamic present");
  check(drips.includes('statusPill.className = "pill success"') && drips.includes('statusPill.className = "pill pill-muted"'), "drip status pills unified onto .pill variants");
  const hexOnStyleLines = drips.split("\n").filter((l) => /#[0-9a-fA-F]{3,8}/.test(l) && l.toLowerCase().includes("style"));
  check(hexOnStyleLines.length === 0, "no raw hex remains in any style context (node-palette DATA colors are allowed and flow through --node-accent)");

  console.log("\n(4) Audit marker mechanism:");
  check(audit.includes("stripEmailHtmlRegions"), "designAudit.ts has stripEmailHtmlRegions()");
  check(audit.includes("src = stripEmailHtmlRegions(src);"), "counters run on email-stripped source");

  console.log("\n(5) Seam — deferred to Phase 6b (named, not hidden):");
  const cHits = hits(comm);
  check(cHits === 1, `communication.js completed by Phase 6b (2026-07-13): 1 sanctioned dynamic remains (survey results bar --pw); was 175 inventoried at the Phase-6 seam (found ${cHits})`);

  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exit(1);
}

main();
