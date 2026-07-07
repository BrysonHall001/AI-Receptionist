// Regression guard (pure). The frontend sets many inline styles from JS using
// CSS custom properties, e.g. `background:var(--panel-2)`. If a referenced token
// name is misspelled or doesn't exist (e.g. the old `var(--surface-2,#eef2ff)` /
// `var(--accent-weak,#eef)`), the browser silently uses the hardcoded LIGHT
// fallback — which becomes invisible light-text-on-light-fill on dark themes.
// That was the cause of the unreadable Drips builder nodes and section tabs.
//
// This test parses every theme token DEFINED in public/styles.css, scans every
// var(--x) REFERENCED in public/js/*.js, and FAILS LOUDLY naming any token that
// isn't defined, so a future edit can't reintroduce a hardcoded off-theme fallback.
//
//   npx tsx src/db/selfTest_themeTokenRefs.ts
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const pub = resolve(__dirname, "../../public");
const css = readFileSync(resolve(pub, "styles.css"), "utf8");
const defined = new Set<string>();
for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);

// Non-theme CSS vars that JS legitimately defines/uses inline and are not theme tokens.
const ALLOW = new Set<string>(["--fun", "--l", "--t", "--d", "--x", "--y", "--dur", "--i", "--r", "--delay", "--tx", "--ty"]);

const offenders: string[] = [];
for (const f of readdirSync(resolve(pub, "js")).filter((f) => f.endsWith(".js"))) {
  const s = readFileSync(resolve(pub, "js", f), "utf8");
  const seen = new Set<string>();
  for (const m of s.matchAll(/var\((--[\w-]+)/g)) {
    const tok = m[1];
    if (defined.has(tok) || ALLOW.has(tok) || seen.has(tok)) continue;
    seen.add(tok);
    offenders.push(`${f}: var(${tok}) is not a defined theme token (would fall back to a hardcoded, off-theme color)`);
  }
}

console.log("Frontend theme-token reference guard\n====================================");
console.log(`  ${defined.size} theme tokens defined in styles.css; scanned public/js/*.js for var(--*) references.`);
if (offenders.length) {
  console.log(`\n${offenders.length} FAILED \u274c`);
  for (const o of offenders) console.log("  \u2717 " + o);
  process.exit(1);
}
console.log("\nALL PASSED \u2705 (every var(--token) in frontend JS resolves to a real theme token)");
process.exit(0);
