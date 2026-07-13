// Self-test — runtime CDN libraries vendored locally. File/source assertions only (no DB):
//
//   npx tsx src/db/selfTest_vendoredLibs.ts
//
// Proves:
//  (1) All four vendored files (plus the Quill theme css) exist under public/js/vendor/ and are
//      non-trivially sized (>10 KB).
//  (2) ZERO third-party CDN references (cdnjs / unpkg / jsdelivr) remain anywhere in public/.
//  (3) index.html references the local paths, and the script ORDER is unchanged from the CDN
//      days: xlsx, jszip, quill, chart — all before the app's own scripts (globals first).
//  (4) Version pinning: each vendored file embeds its expected version string (all four do —
//      quill 1.3.7, xlsx 0.18.5, jszip 3.10.1, chart.js 4.4.1; the quill snow css does too).
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const base = resolve(__dirname, "../..");
const pub = join(base, "public");
const V = join(pub, "js/vendor");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

console.log("Vendored runtime libraries — local, pinned, CDN-free");
console.log("====================================================");

// ---- (1) files exist, non-trivially sized ----
console.log("\n(1) vendored files present and sized:");
const FILES: [string, number, string, string][] = [
  ["quill/quill.min.js", 10240, "1.3.7", "Quill editor"],
  ["quill/quill.snow.css", 10240, "1.3.7", "Quill snow theme css"],
  ["xlsx/xlsx.full.min.js", 10240, "0.18.5", "SheetJS (Excel import/export)"],
  ["jszip/jszip.min.js", 10240, "3.10.1", "JSZip"],
  ["chartjs/chart.umd.js", 10240, "4.4.1", "Chart.js (already-minified UMD dist)"],
];
for (const [rel, min, _v, label] of FILES) {
  let size = 0;
  try { size = statSync(join(V, rel)).size; } catch {}
  check(size > min, `${label} at js/vendor/${rel} (${size} bytes > ${min})`);
}

// ---- (2) zero CDN references anywhere in public/ ----
console.log("\n(2) no third-party CDN references remain:");
const offenders: string[] = [];
for (const p of walk(pub)) {
  if (!/\.(html|js|css)$/.test(p)) continue;
  if (p.startsWith(V)) continue; // vendored dists may mention hosts in comments/sourcemap URLs
  const src = readFileSync(p, "utf8");
  if (/cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net/.test(src)) offenders.push(p.slice(pub.length + 1));
}
check(offenders.length === 0, `no cdnjs/unpkg/jsdelivr references in public/ (found: ${JSON.stringify(offenders)})`);

// ---- (3) index.html local refs + preserved order ----
console.log("\n(3) index.html references + load order:");
const html = readFileSync(join(pub, "index.html"), "utf8");
check(html.includes('<link rel="stylesheet" href="/js/vendor/quill/quill.snow.css" />'), "the Quill theme css loads from the local vendor path");
const iX = html.indexOf('<script src="/js/vendor/xlsx/xlsx.full.min.js"></script>');
const iZ = html.indexOf('<script src="/js/vendor/jszip/jszip.min.js"></script>');
const iQ = html.indexOf('<script src="/js/vendor/quill/quill.min.js"></script>');
const iC = html.indexOf('<script src="/js/vendor/chartjs/chart.umd.js"></script>');
const iApp = html.indexOf('<script src="/js/util.js"></script>');
check(iX > 0 && iZ > iX && iQ > iZ && iC > iQ, "script order unchanged: xlsx, jszip, quill, chart (same as the CDN days)");
check(iApp > iC, "all four load BEFORE the app's own scripts (globals exist first)");

// ---- (4) version pinning via embedded markers ----
console.log("\n(4) pinned versions embedded in the dists:");
for (const [rel, _min, version, label] of FILES) {
  let ok = false;
  try { ok = readFileSync(join(V, rel), "utf8").includes(version); } catch {}
  check(ok, `${label} embeds its pinned version ${version}`);
}

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (four libraries local + pinned; zero runtime CDN dependency)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
