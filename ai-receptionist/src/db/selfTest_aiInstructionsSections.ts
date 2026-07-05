// Self-test: AI-instructions section parse/compile round-trip + preservation. Pure logic (no DB),
// mirroring public/js/portal.js aiParseSections/aiCompileSections so the compiled single field the
// AI reads always round-trips and legacy single-blob instructions are never lost.
//   npx tsx src/db/selfTest_aiInstructionsSections.ts
const DEFAULTS = ["Overview", "Services", "Pricing", "What we don't do", "FAQs", "Tone & personality"];
const HEAD = /^##\s+(.+?)\s*$/;
type Section = { name: string; body: string };

function parse(text: string): Section[] {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const sections: { name: string; body: string[] }[] = [];
  let cur: { name: string; body: string[] } | null = null;
  const preamble: string[] = [];
  for (const line of lines) {
    const m = line.match(HEAD);
    if (m) { if (cur) sections.push(cur); cur = { name: m[1].trim(), body: [] }; }
    else if (cur) cur.body.push(line);
    else preamble.push(line);
  }
  if (cur) sections.push(cur);
  const out: Section[] = sections.map((s) => ({ name: s.name, body: s.body.join("\n").replace(/^\n+|\n+$/g, "") }));
  const preText = preamble.join("\n").trim();
  if (preText) {
    const ov = out.find((s) => s.name.toLowerCase() === "overview");
    if (ov) ov.body = (preText + (ov.body ? "\n\n" + ov.body : "")).trim();
    else out.unshift({ name: "Overview", body: preText });
  }
  return out.length ? out : DEFAULTS.map((n) => ({ name: n, body: "" }));
}
function compile(sections: Section[]): string {
  return sections.map((s) => {
    const body = String(s.body || "").replace(/^\n+|\n+$/g, "");
    return "## " + String(s.name || "").trim() + (body ? "\n\n" + body : "");
  }).join("\n\n").trim() + "\n";
}

let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }

console.log("ai instructions sections\n========================");
const secs: Section[] = [{ name: "Overview", body: "We do X" }, { name: "Services", body: "A\nB" }, { name: "Pricing", body: "" }];
check(JSON.stringify(parse(compile(secs))) === JSON.stringify(secs), "round-trips parse(compile(x)) === x");
const leg = parse("legacy blob, no markers");
check(leg.length === 1 && leg[0].name === "Overview" && leg[0].body === "legacy blob, no markers", "no-marker legacy text preserved under Overview");
const pre = parse("intro\n## Services\n\ndetail");
check(pre.length === 2 && pre[0].name === "Overview" && pre[0].body === "intro" && pre[1].name === "Services" && pre[1].body === "detail", "preamble kept + sections parsed");
check(parse("").length === 6 && parse("   \n  ").length === 6, "empty/whitespace -> 6 default sections");
const withMarkers = "## A\n\nfoo\n\n## B\n\nbar\nbaz";
check(JSON.stringify(parse(withMarkers)) === JSON.stringify([{ name: "A", body: "foo" }, { name: "B", body: "bar\nbaz" }]), "existing marked content parses to its sections");
// reorder/rename/remove via array ops still recompile cleanly
const reordered = [secs[1], secs[0]];
check(parse(compile(reordered))[0].name === "Services", "reordered sections recompile in new order");

console.log("\n========================");
console.log(fails === 0 ? "ALL PASSED \u2705  (ai instructions sections)" : `${fails} FAILED \u274c`);
process.exit(fails === 0 ? 0 : 1);
