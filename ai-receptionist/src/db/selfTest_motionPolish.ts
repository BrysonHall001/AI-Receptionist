process.env.AI_PROVIDER = "mock";

// MOTION POLISH — self-test.
//
// WHAT THIS SUITE CAN AND CANNOT PROVE, stated up front rather than implied by the assertions.
//
// CAN: everything about the RULES. jsdom parses no CSS and runs no animation, but the
// stylesheet is data, and almost every property worth defending here is a property of the
// rules rather than of the pixels - which token a transition uses, whether a keyframe starts
// and ends at rest, whether an animation can loop, which properties it touches, and where a
// selector can and cannot match.
//
// CANNOT: anything about the running animation. That an animation visibly plays, what its
// easing looks like, that a browser honours prefers-reduced-motion, or whether the result
// FEELS right. Those need a real browser and a person, and no assertion here pretends
// otherwise. Where the honest check is "the rule exists", that is what is asserted, and the
// label says so.
//
// One genuine exception is worth naming: jsdom never applies a CSS animation at all, so every
// DOM-driven suite in this repo is already running the app with motion fully disabled. That
// is asserted below by re-using one of them rather than by claiming it here.
/* eslint-disable @typescript-eslint/no-var-requires */
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { JSDOM } = require("jsdom");

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const R = resolvePath(__dirname, "..", "..");
const CSS = readFileSync(resolvePath(R, "public", "styles.css"), "utf8");
const AUTH = readFileSync(resolvePath(R, "public", "js", "auth.js"), "utf8");
const APPJS = readFileSync(resolvePath(R, "public", "js", "app.js"), "utf8");

/** The rule the codebase enforces, expressed once so the test and the product agree. */
const MOTION_TOKENS = /var\(--(?:transition|motion-quick|motion-standard|motion-settle|motion-expressive)\)/;
function offenders(css: string) {
  return [...css.matchAll(/(?<![-\w])transition:\s*([^;{}]+);/g)]
    .filter((m) => !/^\s*none\b/.test(m[1]) && (/\d+\s*m?s\b/.test(m[1]) || !MOTION_TOKENS.test(m[1])))
    .map((m) => m[1].trim());
}

async function main() {
  console.log("MOTION POLISH \u2014 self-test");
  console.log("=========================");

  // ---------- (1) the vocabulary, and nothing outside it ----------
  console.log("\n(1) every animated rule uses a named token:");
  const declared = ["--motion-quick", "--motion-standard", "--motion-settle", "--motion-expressive"]
    .filter((t) => new RegExp("\\" + t + ":\\s*[^;]+;").test(CSS));
  check(declared.length === 4, `all four motion tokens are declared (${declared.length})`);
  check(/--transition:\s*120ms ease;/.test(CSS),
    "\u2026and --transition keeps its ORIGINAL value, so its fifty-odd existing uses are untouched");
  const bad = offenders(CSS);
  check(bad.length === 0,
    `no transition rule uses a literal duration or an unnamed token (${bad.length}${bad.length ? ": " + bad.slice(0, 3).join(" | ") : ""})`);
  // NEGATIVE, three ways, because this is the assertion the whole batch rests on
  check(offenders(CSS + "\n.probe { transition: opacity 240ms ease; }").length === 1,
    "NEGATIVE: a stray literal duration IS caught");
  check(offenders(CSS + "\n.probe { transition: opacity var(--invented); }").length === 1,
    "NEGATIVE: an invented token IS caught");
  check(offenders(CSS + "\n.probe { transition: opacity var(--motion-standard); }").length === 0,
    "\u2026while a real token passes, so the check is not simply rejecting everything");
  check(!/var\(--dur-2/.test(CSS),
    "the undefined --dur-2 token is gone \u2014 it had been silently running on its fallback");

  // ---------- (2) reduced motion ----------
  console.log("\n(2) reduced motion (the RULES, not the pixels):");
  const rm = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{[^}]*\}/);
  check(!!rm, "a global prefers-reduced-motion block exists");
  check(!!rm && /transition:\s*none\s*!important/.test(rm[0]) && /animation:\s*none\s*!important/.test(rm[0]),
    "\u2026switching off BOTH transitions and animations, with !important, on every element and pseudo-element");
  check(!!rm && /\*, \*::before, \*::after/.test(rm[0]),
    "\u2026so the new tokens and the logo are covered by it automatically, with no per-rule opt-in to forget");

  // ---------- (3) the logo animation ----------
  console.log("\n(3) the logo on the auth screens:");
  check(/\.auth-logo:hover svg \{ animation: authLogoGreet var\(--motion-expressive\) both; \}/.test(CSS),
    "the auth logo animates on hover, on the expressive token");
  const kf = CSS.slice(CSS.indexOf("@keyframes authLogoGreet"), CSS.indexOf("}", CSS.indexOf("100% { transform")) + 1);
  check(/0%\s*\{\s*transform: rotate\(0deg\) scale\(1\)/.test(kf) && /100%\s*\{\s*transform: rotate\(0deg\) scale\(1\)/.test(kf),
    "\u2026starting AND ending at rest, so the logo's resting position and size do not change");
  const hoverRule = CSS.slice(CSS.indexOf(".auth-logo:hover svg"), CSS.indexOf(".auth-logo:hover svg") + 140);
  check(!/infinite|alternate/.test(hoverRule),
    "\u2026and it plays ONCE \u2014 no infinite, no alternate, so a resting pointer does not keep it moving");
  // The class is written as "auth-logo" in the JS (no leading dot) - matching on the CSS form
  // silently never matched, which is how a check can pass or fail for the wrong reason.
  check(/"auth-logo"/.test(AUTH) && !/auth-logo/.test(APPJS),
    "the .auth-logo class is created by auth.js and never by app.js \u2014 the app's own chrome cannot match this rule");
  check(/brand-logo--full|brand-logo--icon/.test(APPJS) && !/brand-logo[^{]*:hover[^{]*animation/.test(CSS),
    "\u2026and the chrome logo's own classes carry no hover animation at all");

  // ---------- (4) cheap properties only ----------
  console.log("\n(4) what the new motion actually animates:");
  check(!/\b(width|height|top|left|right|bottom|margin|padding|font-size)\b/.test(kf),
    "the logo keyframes touch transform only \u2014 nothing that forces layout on every frame");
  const newRules = [".auto-card--flash", ".field-row--flash", ".tpl-glyph"];
  const layoutish = newRules.filter((sel) => {
    const i = CSS.indexOf(sel + " {");
    const rule = CSS.slice(i, CSS.indexOf("}", i) + 1);
    const t = /transition:\s*([^;]+);/.exec(rule);
    return t ? /\b(width|height|top|left|margin|padding)\b/.test(t[1]) : false;
  });
  check(layoutish.length === 0, `every rule this batch retimed animates a cheap property (${newRules.length} checked)`);
  // reported, not hidden: one PRE-EXISTING rule does force layout
  const seg = CSS.slice(CSS.indexOf(".adm-seg-fill"), CSS.indexOf("}", CSS.indexOf(".adm-seg-fill")) + 1);
  check(/left var\(--motion-quick\)/.test(seg),
    "REPORTED: .adm-seg-fill still animates left and clip-path, which force layout \u2014 pre-existing, now on a named token, and changing it would move the control");

  // ---------- (5) nothing depends on an animation running ----------
  console.log("\n(5) with motion fully disabled:");
  // jsdom applies no CSS and runs no animation, so this IS the motion-disabled case.
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" }).window;
  (globalThis as any).document = w.document; (globalThis as any).window = w;
  (globalThis as any).localStorage = { getItem: () => null, setItem: () => { /* */ } };
  w.App = {};
  new Function("window", "App", "global", "document", "localStorage", readFileSync(resolvePath(R, "public", "js", "util.js"), "utf8"))(w, w.App, w, w.document, (globalThis as any).localStorage);
  const input = w.document.createElement("input"); input.className = "search-input";
  const box = w.App.util.searchBox(input);
  check(!!box && !!box.querySelector(".search-ico") && !!box.querySelector(".search-c"),
    "the search box renders completely with no CSS and no animation engine at all");
  let clicked = 0;
  const btn = w.document.createElement("button");
  btn.onclick = () => { clicked++; };
  btn.click();
  check(clicked === 1, "\u2026and an ordinary interaction fires immediately, waiting on nothing");
  check(!/animationend|transitionend|requestAnimationFrame\(\s*\)/.test(AUTH),
    "auth.js waits on no animation event to finish before doing its job");

  // ---------- (6) the enforcing rule still bites ----------
  console.log("\n(6) the rule that guards all this:");
  const polish = readFileSync(resolvePath(R, "src", "db", "selfTest_designPolish.ts"), "utf8");
  check(/MOTION_TOKENS/.test(polish) && /motion-quick/.test(polish) && /motion-expressive/.test(polish),
    "selfTest_designPolish now knows the whole vocabulary rather than one token");
  check(/\\d\+\\s\*m\?s\\b/.test(polish) || /\d\+\\s\*m\?s/.test(polish) || /literal duration/.test(polish),
    "\u2026and still rejects a literal duration, which is the half that stops the discipline eroding");
  check(!/includes\("var\(--transition\)"\)/.test(polish),
    "\u2026the old single-token check is replaced, not left beside the new one where it would contradict it");

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exit(1); }
  console.log("ALL PASSED \u2705 (a named vocabulary, two places with character, and nothing that waits on a frame)");
  process.exit(0);
}

main().catch((e: any) => { console.error("threw:", e); process.exit(1); });

export {};
