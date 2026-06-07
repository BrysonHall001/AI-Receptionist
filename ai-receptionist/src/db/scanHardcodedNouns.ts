// Coverage scanner for the relabeling effort.
//
//   npx tsx src/db/scanHardcodedNouns.ts            (run from the ai-receptionist folder)
//
// WHAT IT DOES: scans the UI JS + the automations text files for LEFTOVER
// hardcoded user-facing system nouns — Contact(s)/Job(s)/Record(s)/Stage(s)/
// Candidate(s) — that are NOT yet routed through App.label(). It prints a
// file+line+snippet list grouped by area, per-area counts, and a grand total.
// This is the BASELINE today; as we relabel area-by-area later, the total drops
// toward zero. It changes NOTHING — pure read-only scan, no DB, no writes.
//
// HOW IT TELLS DISPLAY TEXT FROM CODE (the tricky part):
//   - It only looks INSIDE quoted strings ('…', "…", `…`). Bare code (variable
//     names, object keys) is ignored.
//   - Word boundaries (\b) mean glued identifiers like recordType, contactId,
//     StageHistory never match — only the standalone words do.
//   - A bare lowercase word that is the WHOLE string (e.g. "contact", "job") is
//     treated as a stable KEY/identifier value and skipped (these must NOT be
//     renamed). A Capitalized word ("Contacts" in the nav) IS display text and
//     is flagged. Lowercase words inside a multi-word phrase ("No contacts yet")
//     are prose and ARE flagged.
//   - Strings that look like paths/URLs (contain "/" e.g. "/api/contacts") are
//     skipped.
//   - Any line that already calls App.label( is considered done and skipped.
//   - Comment lines (// or *) are skipped.
//   - A tunable IGNORE list (below) lets us silence any known false positives.

import * as fs from "fs";
import * as path from "path";

// ---- Tunable: known false positives to silence (regex tested against the line).
const IGNORE: RegExp[] = [
  // Add patterns here if the scanner flags something that should be left alone.
  // Example: /someVariableName/,
];

const NOUNS = /\b(contacts?|jobs?|records?|stages?|candidates?)\b/gi;
const STRINGS = /'[^']*'|"[^"]*"|`[^`]*`/g;
const STABLE_KEYS = new Set(["contact", "contacts", "job", "jobs", "record", "records", "stage", "stages", "candidate", "candidates"]);

const ROOT = process.cwd();
const UI_DIR = path.join(ROOT, "public", "js");
const SRC_TEXT_FILES = ["src/events/types.ts", "src/automation/actions.ts", "src/automation/presets.ts"].map((p) => path.join(ROOT, p));
const SELF = "scanHardcodedNouns.ts";

function areaFor(file: string, noun: string): string {
  const base = path.basename(file);
  const n = noun.toLowerCase();
  if (base === "app.js") return "nav + page titles";
  if (base === "portal.js") return /contact/.test(n) ? "contacts pages" : "jobs / records pages";
  if (base === "automations.js" || base === "flowPreview.js" || base === "types.ts" || base === "actions.ts" || base === "presets.ts") return "automations";
  if (base === "learn.js") return "learning center";
  if (base === "admin.js") return "create-portal / admin";
  return "other UI";
}

type Hit = { area: string; file: string; line: number; noun: string; snippet: string };

function scanFile(file: string, hits: Hit[]) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return; }
  const rel = path.relative(ROOT, file);
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return; // comment
    if (raw.indexOf("App.label(") !== -1) return; // already routed through the helper
    if (IGNORE.some((re) => re.test(raw))) return;
    const strings = raw.match(STRINGS) || [];
    for (const lit of strings) {
      const content = lit.slice(1, -1);
      if (content.indexOf("/") !== -1) continue; // path/URL-like
      let m: RegExpExecArray | null;
      NOUNS.lastIndex = 0;
      const seen = new Set<string>();
      while ((m = NOUNS.exec(content)) !== null) {
        const word = m[0];
        const lower = word.toLowerCase();
        const isLower = word === lower;
        const bareKey = isLower && STABLE_KEYS.has(content.trim().toLowerCase()); // whole string is just the key
        if (bareKey) continue;
        // lowercase word only counts as prose if the string has other content (a space)
        if (isLower && content.trim().indexOf(" ") === -1) continue;
        const tag = lower + "@" + (m.index || 0);
        if (seen.has(tag)) continue;
        seen.add(tag);
        hits.push({ area: areaFor(file, word), file: rel, line: i + 1, noun: word, snippet: trimmed.slice(0, 100) });
      }
    }
  });
}

function main() {
  const hits: Hit[] = [];
  // UI JS (skip .bak backups, the infra helper file, and this scanner's siblings)
  let uiFiles: string[] = [];
  try { uiFiles = fs.readdirSync(UI_DIR).filter((f) => f.endsWith(".js") && !f.endsWith(".bak") && f !== "util.js"); } catch {}
  for (const f of uiFiles) scanFile(path.join(UI_DIR, f), hits);
  for (const f of SRC_TEXT_FILES) scanFile(f, hits);

  // Group + print
  const byArea = new Map<string, Hit[]>();
  for (const h of hits) { if (!byArea.has(h.area)) byArea.set(h.area, []); byArea.get(h.area)!.push(h); }
  const AREA_ORDER = ["nav + page titles", "contacts pages", "jobs / records pages", "automations", "learning center", "create-portal / admin", "other UI"];
  const areas = Array.from(byArea.keys()).sort((a, b) => AREA_ORDER.indexOf(a) - AREA_ORDER.indexOf(b));

  console.log("Hardcoded-noun coverage scan");
  console.log("============================");
  console.log("(Leftover user-facing Contact/Job/Record/Stage/Candidate not yet using App.label())\n");

  for (const area of areas) {
    const list = byArea.get(area)!;
    console.log(`── ${area}  (${list.length}) ──`);
    for (const h of list) console.log(`   ${h.file}:${h.line}  [${h.noun}]  ${h.snippet}`);
    console.log("");
  }

  console.log("Per-area totals:");
  for (const area of AREA_ORDER) {
    const n = byArea.get(area)?.length || 0;
    if (n) console.log(`   ${String(n).padStart(4)}  ${area}`);
  }
  console.log("   ----");
  console.log(`   ${String(hits.length).padStart(4)}  GRAND TOTAL (baseline)\n`);
  console.log("This is the baseline. As each area is relabeled to use App.label(), re-run");
  console.log("this and watch its count fall to 0. Nothing was changed by this scan.");
}

main();
