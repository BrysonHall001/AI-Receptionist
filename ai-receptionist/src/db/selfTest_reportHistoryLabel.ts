// Batch self-test — Import/Export History labeling for report-sourced rows.
//
//   npx tsx src/db/selfTest_reportHistoryLabel.ts
//
// dataHistoryWhat lives in the portal client (public/js/portal.js). Rather than
// reimplement it, this test EXTRACTS the real function source from that file and
// evaluates it, then asserts the labels — so it tracks the shipped code. No DB.

import { readFileSync } from "fs";
import { resolve } from "path";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

// Pull "function dataHistoryWhat(r, typeLabels) { … }" out of portal.js by brace-matching.
function extractFn(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`could not find ${signature} in portal.js`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error("unbalanced braces extracting function");
}

function main() {
  console.log("Import/Export History — report-row labeling");
  console.log("===========================================");

  const portalPath = resolve(__dirname, "../../public/js/portal.js");
  const src = readFileSync(portalPath, "utf8");
  const fnSrc = extractFn(src, "function dataHistoryWhat(r, typeLabels)");
  // eslint-disable-next-line no-new-func
  const dataHistoryWhat = new Function(`${fnSrc}; return dataHistoryWhat;`)() as (r: any, t: any) => string;

  const labels = { contact: "Contacts", booking: "Bookings" };

  console.log("(report rows):");
  check(dataHistoryWhat({ kind: "report", dataType: "contact" }, labels) === "Contacts · Report", "single-source report -> \"<Type> · Report\"");
  check(dataHistoryWhat({ kind: "report", dataType: "booking" }, labels) === "Bookings · Report", "single-source report uses the type label");
  check(dataHistoryWhat({ kind: "report", dataType: null }, labels) === "Report", "multi-source report (no dataType) -> just \"Report\"");
  check(dataHistoryWhat({ kind: "report" }, labels) === "Report", "report with undefined dataType -> just \"Report\"");

  console.log("\n(unchanged for import/export/backup):");
  check(dataHistoryWhat({ kind: "import", dataType: "contact" }, labels) === "Contacts · Import", "import row unchanged");
  check(dataHistoryWhat({ kind: "export", dataType: "booking" }, labels) === "Bookings · Export", "export row unchanged");
  check(dataHistoryWhat({ kind: "export", dataType: null }, labels) === "Other · Export", "export with no dataType -> \"Other · Export\"");
  check(dataHistoryWhat({ kind: "backup" }, labels) === "Full backup", "backup row unchanged");

  console.log("\n===========================================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED ✅  (report history label)");
  else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
