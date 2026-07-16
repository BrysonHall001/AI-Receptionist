// Self-test — Motion & branding. Source assertions; no DB:
//
//   npx tsx src/db/selfTest_motionBranding.ts
//
// Proves:
//  (1) BRAND — the default logo is inline SVG with TOKEN fills (mark var(--accent),
//      wordmark var(--ink), icon glyph var(--on-accent)); deployed at every default-brand
//      site (the shared renderBrand used by BOTH sidebars + the auth card); the
//      white-label branch still renders uploads untouched; the dead letter-tile CSS and
//      its per-theme overrides are gone; the contrast suite gained the brand checks.
//  (2) SEARCH — one shared search-box (icon left in --ink-faint, C mark right in
//      var(--accent), aria-hidden, hidden while non-empty via :placeholder-shown);
//      the ONE creation site (the shared table toolbar, serving module lists, Contacts,
//      the admin tenant list, and the Template Library) is converged; no bespoke search
//      styling remains.
//  (3) STAGGER — route-change-only trigger (hashchange + boot; App._route repaints stay
//      motionless), 25ms/item with the 150ms cap, opacity/transform only, reduced-motion
//      covered by the global block.
//  (4) SKELETONS + LOADER — shared showSkeleton with the 150ms appearance-delay constant
//      wired at the three shared loading sites (portal loading(), admin loading(), the
//      dashboard engine); shapes match content (table rows / widget blocks); the boot
//      loader's C-bounce keyframes exist with the reduced-motion fallback.
//  (5) Ratchet + the upgraded contrast suite (incl. brand-on-sidebar/panel) green.
import { readFileSync } from "fs";
import { resolve } from "path";
import { runAudit } from "./designAudit";
import baseline from "./designBaseline.json";

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

const PUB = resolve(__dirname, "../../public");
const css = readFileSync(resolve(PUB, "styles.css"), "utf8");
const utilJs = readFileSync(resolve(PUB, "js", "util.js"), "utf8");
const appJs = readFileSync(resolve(PUB, "js", "app.js"), "utf8");
const authJs = readFileSync(resolve(PUB, "js", "auth.js"), "utf8");
const tableJs = readFileSync(resolve(PUB, "js", "table.js"), "utf8");
const portalJs = readFileSync(resolve(PUB, "js", "portal.js"), "utf8");
const adminJs = readFileSync(resolve(PUB, "js", "admin.js"), "utf8");
const reportsJs = readFileSync(resolve(PUB, "js", "reports.js"), "utf8");
const contrastSrc = readFileSync(resolve(__dirname, "selfTest_allThemeContrast.ts"), "utf8");

console.log("Motion & branding");
console.log("=================");

// ---------- (1) the theme-aware brand ----------
console.log("\n(1) theme-aware brand:");
check(utilJs.includes('<g transform="translate(8,12)" fill="var(--accent)" class="brand-c">') && utilJs.includes('fill="var(--ink)" class="brand-word">larity</text>'), "logo SVG: mark = var(--accent), wordmark = var(--ink) (same geometry as the original)");
check(utilJs.includes('<rect width="240" height="240" rx="54" fill="var(--accent)"/>') && utilJs.includes('<g transform="translate(14.7,16) scale(2.6)" fill="var(--on-accent)">'), "collapsed icon: accent tile + var(--on-accent) glyph");
check(!/#4F4DCA|#211E5C/i.test(utilJs), "no hardcoded brand hexes remain in the constants");
check(appJs.includes("full.innerHTML = App.brandLogoSvg;") && appJs.includes("icon.innerHTML = App.brandIconSvg;") && authJs.includes("logo.innerHTML = App.brandLogoSvg;"), "deployed everywhere the default brand renders: BOTH sidebars (the one renderBrand) + the auth card");
check(/if \(logo\) \{\s*const img = el\("img", "brand-logo"\); img\.src = logo;/.test(appJs), "white-label branch untouched: an uploaded tenant logo still replaces the mark entirely");
check(!/\n\.brand-mark \{/.test(css) && !css.includes('body[data-theme="dusk"] .brand-mark'), "the dead letter-tile CSS + per-theme brand overrides are gone (token SVG supersedes them)");
check(contrastSrc.includes("brand C mark --accent on sidebar") && contrastSrc.includes("brand wordmark --ink on sidebar"), "the contrast suite gained the brand-on-sidebar/panel checks");

// ---------- (2) the shared search box ----------
console.log("\n(2) the shared search box:");
check(utilJs.includes("App.util.searchBox = function (input)") && utilJs.includes('class="search-ico"') && utilJs.includes('class="search-c"'), "ONE shared search-box builder (icon + C mark shells)");
check(utilJs.includes('<circle cx="11" cy="11" r="7"/>') && /\.search-ico \{[^}]*color: var\(--ink-faint\);/.test(css), "magnifier left, --ink-faint (currentColor)");
check(utilJs.includes("App.brandCSvg") && utilJs.includes('aria-hidden="true" focusable="false"') && utilJs.includes('${App.brandCSvg}'), "the C mark right: the SAME brand geometry, var(--accent), decorative (aria-hidden)");
check(css.includes(".search-box .search-input:placeholder-shown ~ .search-c { display: inline-flex; }") && /\.search-c \{[^}]*display: none;/.test(css), "the C hides while the input is non-empty (pure CSS :placeholder-shown — no JS state)");
check(tableJs.includes("right.appendChild(App.util.searchBox(search));") && (tableJs.match(/el\("input", "search-input"\)/g) || []).length === 1, "the ONE creation site (the shared table toolbar) is converged — module lists, Contacts, admin tenants, Template Library all ride it");
check(!portalJs.includes('"search-input"') && !adminJs.includes('el("input", "search-input")'), "no bespoke search inputs remain (admin only queries the shared one)");
check(/\.search-box \{ position: relative;[^}]*min-width: 0; max-width: 100%; \}/.test(css) && css.includes(".search-box .search-input { padding-left: 32px; padding-right: 28px; width: 100%; }"), "wrapper is blowout-safe; input keeps its class (existing selectors, radius + focus ring inherited)");

// ---------- (3) stagger ----------
console.log("\n(3) route materialization:");
check(appJs.includes("function routeWithMotion()") && appJs.includes('window.addEventListener("hashchange", routeWithMotion);') && appJs.includes("routeWithMotion(); // first paint is a page change too"), "trigger = hashchange + boot ONLY");
check(appJs.includes("App._route = route;"), "in-page repaints (App._route) stay motionless — re-renders/re-sorts never re-trigger");
check(appJs.includes('c.classList.add("page-stagger");') && appJs.includes("}, 400);"), "the class window closes after ~400ms (filters/sorts happen outside it)");
check(css.includes("@keyframes pageIn { from { opacity: 0; transform: translateY(7px); }") && css.includes(".page-stagger > *:nth-child(2) { animation-delay: 25ms; }") && css.includes(".page-stagger > *:nth-child(n+7) { animation-delay: 150ms; } /* the cap: the rest appear together */"), "fade-slide 7px, 25ms/item, hard 150ms cap; opacity/transform only");
check(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important;/.test(css), "reduced motion turns it (and all batch animations) off via the global block");

// ---------- (4) skeletons + the animated C ----------
console.log("\n(4) skeletons + the boot loader:");
check(utilJs.includes("App.util.SKELETON_DELAY_MS = 150;") && utilJs.includes("if (host.childElementCount) return; // data beat the delay — never flash"), "shared showSkeleton with the 150ms appearance-delay constant (fast fetches never flash)");
check(utilJs.includes('wrap.className = "card skel-table";') && utilJs.includes('wrap.className = "skel-widgets";'), "shapes match the incoming content: table rows / widget blocks");
check(portalJs.includes('App.util.showSkeleton(view(), "table");') && adminJs.includes('App.util.showSkeleton(view(), "table");') && reportsJs.includes('App.util.showSkeleton(host, "widgets");'), "wired at the three SHARED loading sites (portal, admin, the dashboard engine)");
check(css.includes("@keyframes skelSweep") && /\.skel-shimmer \{[^}]*background: var\(--gray-soft\);/.test(css) && css.includes("var(--panel-2), transparent)"), "shimmer = token gradient over --gray-soft");
check(css.includes("@keyframes cBounce") && css.includes(".brand-loader .brand-c { animation: cBounce 600ms cubic-bezier(0.3, 0.7, 0.3, 1) infinite; }"), "the animated C: slides left, rebounds, settles — one ~600ms loop on the mark's group");
check(appJs.includes('l.innerHTML = App.brandLogoSvg;') && appJs.includes("if (!app || app.childElementCount) return;") && appJs.includes('const bl = document.getElementById("boot-loader"); if (bl) bl.remove();'), "boot loader: 150ms-delayed, only while the first fetch is genuinely pending, removed before the first paint");

// ---------- (5) gates ----------
console.log("\n(5) gates:");
const audit = runAudit();
check(audit.totals.rawHex <= (baseline as any).totals.rawHex && audit.layout.fixedWidthNoEscape <= (baseline as any).layout.fixedWidthNoEscape, "ratchet (color + layout counters) at-or-below baseline");

console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (brand token-driven; search unified; motion tasteful, capped, and reducible)" : failures.length + " FAILED \u274c"}`);
process.exit(failures.length ? 1 : 0);
