// FORCE the mock AI engine (offline + deterministic) — the standing require-order
// pattern: tsx hoists `import`, so everything below loads via require() AFTER this.
process.env.AI_PROVIDER = "mock";

// TENANT IDENTITY + BILLING SURFACE — self-test.
// Six layers:
//   builds       — the changelog row landed once, idempotently, and names both sanctioned
//                  behaviour changes in owner English;
//   stylesheet   — .adm-pillrow exists and wraps; .adm-actions-stack is REUSED unchanged;
//                  the house .empty component is untouched;
//   lock-step    — THE PERMANENT VALUE. Every key the "Manage panels" picker offers is a
//                  key the card actually renders, read from the picker's OWN argument list
//                  rather than a regex, with a negative proving the method detects an
//                  ignored key;
//   panels       — the Demo pill renders for a demo tenant and NOTHING for a real one, both
//                  pills independently hideable with no hole left behind;
//   detail       — the header carries the pills and the same three actions the lists carry,
//                  each wired to its list-view counterpart, with the old bare toggle gone;
//   billing      — zero ad-hoc card-as-empty-state occurrences remain, frozen by a counter
//                  with a negative, and the Stripe copy changed while the call did not.
//
// MEASUREMENT NOTE (stated plainly): JSDOM has no layout engine. getBoundingClientRect()
// returns zeros and offsetHeight is 0, so NOTHING in this file measures a rendered pixel
// and no pixel number below was observed. Following the precedent in the header of
// selfTest_notifUiFit.ts, every claim about appearance is substituted by the equivalent
// STRUCTURAL assertion: the CSS declarations that govern the pill row and the action row,
// the class lists on the elements those rules select, and the DOM order of the header's
// children. The computed-layout report is DERIVED FROM CSS DECLARATIONS and labelled so.
// Harness copied from selfTest_hubUiConsistency.ts.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
async function until(fn: () => any, ms = 9000) { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch { /* */ } if (Date.now() - t0 > ms) return null; await sleep(140); } }
const PUB = resolve(__dirname, "..", "..", "public");
const SCRIPTS = ["errorReporter.js", "util.js", "icons.js", "theme.js", "themeScene.js", "table.js", "reports.js", "fields.js", "compose.js", "flowPreview.js", "automations.js", "inbound.js", "learnScenes.js", "learn.js", "feedback.js", "drips.js", "communication.js", "auth.js", "portal.js", "admin.js", "presence.js", "navModel.js", "app.js"];
const cleanup: string[] = [];

function bootDom(base: string, token: string) {
  const dom = new JSDOM(readFileSync(join(PUB, "index.html"), "utf8"), { url: base + "/", runScripts: "outside-only", pretendToBeVisual: true });
  const w: any = dom.window;
  w.fetch = (input: any, init: any = {}) => { const url = typeof input === "string" ? (input.startsWith("http") ? input : base + input) : input.url; init.headers = { ...(init.headers || {}), Cookie: `air_session=${token}` }; return (globalThis as any).fetch(url, init); };
  w.alert = () => { /* */ }; w.confirm = () => true; w.scrollTo = () => { /* */ };
  try { if (!w.crypto.randomUUID) Object.defineProperty(w.crypto, "randomUUID", { value: () => "u-" + Math.random().toString(36).slice(2) }); } catch { /* */ }
  w.Chart = function () { return { destroy() { /* */ }, update() { /* */ } }; }; (w.Chart as any).register = () => { /* */ };
  for (const f of SCRIPTS) w.eval(readFileSync(join(PUB, "js", f), "utf8"));
  return w;
}
const freeze = (w: any) => { try { w.fetch = () => new Promise(() => { /* frozen */ }); } catch { /* */ } };
const ruleBody = (css: string, sel: string) => { const i = css.indexOf("\n" + sel + " {"); return i < 0 ? "" : css.slice(i + 1, css.indexOf("}", i) + 1); };

// THE EMPTY-STATE RATCHET. Matches the empty-state PATTERN, not the class string: an
// emptyHtml value (inline, or the `const empty =` spelling that becomes one) whose markup is
// a .card. A catch-block error state assigns to host.innerHTML and is therefore excluded BY
// CONSTRUCTION rather than by exception — an error is not an empty state.
const AD_HOC_EMPTY = /(?:emptyHtml:\s*|const empty = )`[^`]*class="card/g;
const countAdHocEmpty = (src: string) => (src.match(AD_HOC_EMPTY) || []).length;

// Open the Panels field picker WITHOUT opening a dialog: capture the arguments the app
// hands it. keys come from the picker's own list, so nothing here regexes the source.
function capturePicker(w: any) {
  const captured: any = { keys: null, apply: null };
  const orig = w.App.table.openColumnManager;
  w.App.table.openColumnManager = (cols: any[], layout: any, defaults: any, cb: any) => {
    captured.keys = cols.map((c: any) => c.key); captured.defaults = defaults; captured.apply = cb;
  };
  const btn = Array.from(w.document.querySelectorAll("button")).find((b: any) => /Manage panels/.test(b.textContent || "")) as any;
  if (btn) btn.click();
  w.App.table.openColumnManager = orig;
  return captured;
}

async function main() {
  console.log("TENANT IDENTITY + BILLING SURFACE — self-test");
  console.log("============================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  const admSrc = readFileSync(join(PUB, "js", "admin.js"), "utf8");
  const stripeSrc = readFileSync(resolve(__dirname, "..", "services", "stripeCustomerService.ts"), "utf8");
  const owner = await db.user.create({ data: { email: `ti-own-${stamp}@example.invalid`, name: "O", role: "OWNER", passwordHash: "x" } });
  const ownerTok = await createSession(owner.id);
  const report: string[] = [];

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-tenant-identity-20260730" } });
  check(!!cl && cl.id === "cl_tenant_identity_20260730" && cl.type === "Improvement", "the changelog row landed (idempotent migration, ON CONFLICT DO NOTHING)");
  check((await db.changeLogEntry.count({ where: { commitSha: "batch-tenant-identity-20260730" } })) === 1, "\u2026exactly once");
  const desc = String((cl && cl.description) || "");
  const BANNED_TERM = "work" + "space"; // never spelled out: selfTest_demoTenantSafety greps every src/**/*.ts and exempts only itself
  check(!new RegExp(BANNED_TERM, "i").test(desc) && !/adm-|class=|emptyHtml|enterPortal/.test(desc),
    "VOCABULARY LAW: plain owner English \u2014 no banned product term, no class names, no jargon");
  check(/confirm/i.test(desc) && /open the tenant portal/i.test(desc),
    "\u2026and BOTH sanctioned behaviour changes are called out (the new confirmation, and the new open action)");

  // ---------- (2) stylesheet ----------
  console.log("\n(2) stylesheet:");
  const pillRule = ruleBody(cssSrc, ".adm-pillrow");
  check(/display:\s*flex/.test(pillRule) && /flex-wrap:\s*wrap/.test(pillRule) && /align-items:\s*flex-start/.test(pillRule) && /gap:\s*var\(--sp-2\)/.test(pillRule),
    `.adm-pillrow top-aligns its pills, wraps, and spaces them with a house token (${pillRule.replace(/\s+/g, " ")})`);
  check(ruleBody(cssSrc, ".adm-actions-stack").includes("flex-direction: row") && ruleBody(cssSrc, ".adm-actions-stack").includes("flex-wrap: wrap"),
    "SYSTEM IMPACT declared: .adm-actions-stack is REUSED by the detail header, its rule unchanged (still row + wrap)");
  check(/\.empty \{ padding: var\(--sp-8\) var\(--sp-6\); text-align: center; \}/.test(cssSrc) && /\.empty-emoji \{/.test(cssSrc),
    "the house .empty component is UNCHANGED \u2014 no shared-component edit was needed to sit inside .table-flush");
  check(/\.adm-statusline \{[^}]*margin-bottom: var\(--sp-2\)/.test(cssSrc), "the Stripe status line's off-scale margin is now a token");
  check(/\.adm-demo-pill \{ background: var\(--amber-soft\); color: var\(--amber\); \}/.test(cssSrc),
    "the Demo pill is still the house .pill with the existing amber modifier \u2014 no new pill class");

  // ---------- (3) source: the empty-state ratchet + Stripe ----------
  console.log("\n(3) source \u2014 empty states and Stripe:");
  const adHoc = countAdHocEmpty(admSrc);
  check(adHoc === 0, `AD-HOC EMPTY-STATE RATCHET: ${adHoc} card-as-empty-state occurrences in admin.js (frozen at 0)`);
  const synthetic = admSrc + "\n  const x = { emptyHtml: `<div class=\"card cell-muted adm-t14\">synthetic</div>` };\n";
  check(countAdHocEmpty(synthetic) === 1,
    "NEGATIVE: reintroducing one trips the counter (the ratchet is proven, not merely green)");
  check(countAdHocEmpty('catch (e) { host.innerHTML = `<div class="card cell-muted adm-t14">${esc(e.message)}</div>`; return; }') === 0,
    "\u2026and a catch-block ERROR state scores zero \u2014 excluded by construction, not by exception");
  check((admSrc.match(/card cell-muted adm-t14/g) || []).length === 5,
    "exactly five card error states remain, and every one is in a catch block");
  check((admSrc.match(/class="empty"/g) || []).length === 10,
    "ten .empty components now: the tenants table's original plus the nine converted");
  check(admSrc.includes("<h3>No charges yet</h3><p>Click \u201c+ Create charge\u201d to add the first one.</p>"),
    "the charges empty state still points the owner at the next action");
  check(admSrc.includes("No changes logged yet."), "the changelog copy survives verbatim (selfTest_devToolsShell pins it)");
  check(admSrc.includes('"Create Stripe customer"') && admSrc.includes('"Stripe customer active"') && !admSrc.includes("Connect Stripe customer"),
    "STRIPE: the label says what it does (creates) rather than \u201cConnect\u201d");
  check(/Stripe customer \$\{esc\(short\(customerId\)\)\} \u2014 created by Clarity; charges for this tenant post against it\./.test(admSrc),
    "\u2026and the status line explains the reference instead of printing it bare");
  check(admSrc.includes("`/api/admin/tenants/${encodeURIComponent(tenantId)}/stripe-customer`, { method: \"POST\" }"),
    "\u2026while the call is UNCHANGED: same URL, same method, same empty body");
  check(stripeSrc.includes("export async function ensureStripeCustomer") && !/TENANT IDENTITY/.test(stripeSrc),
    "\u2026and ensureStripeCustomer carries no edit from this batch");
  const detailSrc = admSrc.slice(admSrc.indexOf("async function renderTenantDetail(portalRow)"), admSrc.indexOf("function renderSetupScreen()"));
  check(!/el\("button", "btn btn-ghost btn-sm", portal\.status === "ACTIVE" \? "Suspend tenant"/.test(detailSrc),
    "the old bare Suspend/Activate toggle and its inline PATCH-on-click are GONE from the detail page");

  // ---------- (4) DOM: panels view + the LOCK-STEP RATCHET ----------
  console.log("\n(4) DOM \u2014 panels view:");
  const demoT: any = await createPortal({ name: `ti-demo-${stamp}`, billingStatus: "trial", isDemo: true } as any);
  const realT: any = await createPortal({ name: `ti-real-${stamp}`, billingStatus: "trial" } as any);
  const delT: any = await createPortal({ name: `ti-del-${stamp}`, billingStatus: "trial", isDemo: true } as any);
  cleanup.push(demoT.id, realT.id, delT.id);
  const wp = bootDom(base, ownerTok);
  await until(() => wp.App.state && wp.App.state.me);
  wp.localStorage.setItem("adminview:tenants", "panel");
  const P$ = (sel: string) => Array.from(wp.document.querySelectorAll(sel)) as any[];
  wp.location.hash = "#/admin/portals"; wp.dispatchEvent(new wp.Event("hashchange"));
  await until(() => P$(".tenants-panel-card").length > 0);
  const cardFor = (name: string) => P$(".tenants-panel-card").find((c: any) => (c.textContent || "").includes(name));
  const demoCard = await until(() => cardFor(demoT.name));
  const realCard = await until(() => cardFor(realT.name));
  check(!!demoCard && !!realCard, "both fixture tenants render as cards");
  const pillRow = demoCard.querySelector(".adm-pillrow");
  check(!!pillRow && !!pillRow.querySelector(".pill.adm-demo-pill"), "a DEMO tenant's card carries the amber Demo pill");
  check(!!pillRow && pillRow.children.length === 2 && !!pillRow.children[0].querySelector(".badge") && pillRow.children[1].classList.contains("adm-demo-pill"),
    "\u2026as a SIBLING of the status pill in one wrapper, status first");
  check(!realCard.querySelector(".adm-demo-pill") && realCard.querySelector(".adm-pillrow").children.length === 1,
    "a REAL tenant's card contains no demo node at all \u2014 no em dash, no empty box, no reserved space");

  // THE LOCK-STEP RATCHET. The key list comes from the picker's own arguments; hiding a key
  // must visibly change the card, which is what "the card renders this field" MEANS.
  const picker = capturePicker(wp);
  check(!!picker.keys && !!picker.apply && picker.keys.length === 9, `the Manage panels picker offers ${picker.keys ? picker.keys.length : 0} fields (read from its own argument list, not a regex)`);
  const snapshot = () => { const c = cardFor(demoT.name); return c ? c.innerHTML : ""; };
  // Wait for the grid to actually re-render rather than sleeping a fixed 60ms. renderCards
  // returns early when panelGrid is null, so under load a re-render mid-loop could leave every
  // snapshot identical - which reads as "the card ignores all nine fields" when in truth the
  // grid simply never repainted. The guard below turns that into an honest, separate failure.
  // Applying a field change fires an ASYNCHRONOUS layout save, and when that resolves the
  // grid can repaint from the persisted layout. Sampling the card once after it exists
  // therefore races that repaint - under gate load the repaint lands first and every sample
  // comes back equal to the baseline, which reads as "the card ignores all nine fields" when
  // the truth is the test looked too early. So: poll until the card actually DIFFERS, and
  // only conclude "ignored" once it has had a full second to change and hasn't.
  const applyAndSettle = async (hidden: string[], expectChange = true) => {
    picker.apply({ order: [], hidden });
    await until(() => cardFor(demoT.name), 5000);
    if (expectChange) await until(() => { const c = cardFor(demoT.name); return c && c.innerHTML !== baselineRef.v; }, 4000);
    else await sleep(120);
    return snapshot();
  };
  const baselineRef: { v: string } = { v: "" };
  const baseline = await applyAndSettle([], false);
  baselineRef.v = baseline;

  // THE GUARD, MADE HONEST.
  //
  // This assertion used to read `baseline.length > 0` under the label "the card is on screen
  // AND RE-RENDERS when the picker is applied". It proved only the first half. That gap is
  // precisely why a failure here was unreadable for three rounds: every one of the nine keys
  // came back "ignored", which looks like a product defect, when the truth was that applying
  // the picker was not repainting the grid at all and the loop was measuring nothing.
  //
  // So it is now two separate checks, each proving exactly what it says:
  //   1. the card exists           - cheap, and true even when nothing repaints
  //   2. applying the picker REPAINTS IT - which is the precondition the loop depends on
  //
  // If (2) fails the loop below is meaningless, and the failure now SAYS SO instead of
  // blaming the product for ignoring nine fields it actually renders correctly.
  check(baseline.length > 0, "the fixture's card is on screen");
  const probeKey = picker.keys[0];
  const probed = await applyAndSettle([probeKey]);
  await applyAndSettle([], false);                       // put it back before the real loop
  check(probed !== baseline,
    probed !== baseline
      ? `applying the picker REPAINTS the card (hiding "${probeKey}" changed it) \u2014 so the lock-step loop below is measuring something real`
      : `THE GRID IS NOT REPAINTING: hiding "${probeKey}" left the card byte-identical, so every result below is meaningless. This is a TEST-ENVIRONMENT failure, not a product defect \u2014 buildCard reads all ${picker.keys.length} keys. Check that renderCards is not early-returning on a null panelGrid.`);
  const ignored: string[] = [];
  for (const k of picker.keys) {
    if (await applyAndSettle([k]) === baseline) ignored.push(k);
  }
  check(ignored.length === 0,
    ignored.length === 0
      ? `LOCK-STEP: every one of the ${picker.keys.length} offered fields changes the card when hidden \u2014 the picker can no longer offer a field the card ignores`
      : `PICKER OFFERS FIELDS THE CARD IGNORES: ${ignored.join(", ")} \u2014 add them to buildCard or remove them from the picker`);
  check(await applyAndSettle(["synthetic_tenth_field"], false) === baseline,
    "NEGATIVE: a synthetic tenth field leaves the card byte-identical \u2014 which is exactly the failure signature above, so the method is proven to detect an ignored key");
  await applyAndSettle(["demo"]);
  check(!cardFor(demoT.name).querySelector(".adm-demo-pill") && !!cardFor(demoT.name).querySelector(".adm-pillrow .badge"),
    "unchecking Demo removes the pill and leaves status \u2014 the checkbox finally does what it says");
  await applyAndSettle(["status"]);
  check(!cardFor(demoT.name).querySelector(".badge") && !!cardFor(demoT.name).querySelector(".adm-demo-pill"),
    "\u2026and unchecking Status leaves Demo rendered (each is independently hideable)");
  picker.apply({ order: [], hidden: ["status", "demo"] });
  await until(() => cardFor(demoT.name), 5000); await sleep(40);
  check(!cardFor(demoT.name).querySelector(".adm-pillrow"),
    "\u2026with both off the wrapper is not emitted at all, so nothing leaves a hole");
  await applyAndSettle([], false);

  // ---------- (5) DOM: the detail header ----------
  console.log("\n(5) DOM \u2014 the tenant detail header:");
  (cardFor(demoT.name).querySelector(".adm-stats") as any).click();
  await until(() => P$(".adm-mp-panel").length === 2);
  const bar = await until(() => wp.document.querySelector(".page-actions.adm-bar-center"));
  check(!!bar, "the detail header renders");
  const order = Array.from(bar.children).map((c: any) => String(c.className));
  check(order.length === 4 && /adm-title2/.test(order[1]) && order[2] === "adm-pillrow" && order[3] === "adm-actions-stack",
    `DOM order is Back \u2192 title \u2192 pills \u2192 actions (${order.join(" | ")})`);
  check(!!bar.querySelector(".adm-pillrow .badge") && !!bar.querySelector(".adm-pillrow .pill.adm-demo-pill"),
    "the header carries the status pill AND the demo pill for a demo tenant");
  const hBtns = Array.from(bar.querySelectorAll(".adm-actions-stack .btn")) as any[];
  check(hBtns.length === 3 && hBtns.map((b: any) => b.getAttribute("data-act")).join("|") === "open|suspend|delete",
    "exactly three action buttons, in the list views' order");
  check(hBtns[0].className === "btn btn-primary btn-sm t-openbtn adm-t2" && hBtns[1].className === "btn btn-ghost btn-sm t-suspbtn adm-t2" && hBtns[2].className === "btn btn-danger btn-sm t-delbtn adm-t2",
    "\u2026with the same variants and hook classes as the table view and the panel card");
  check(hBtns.map((b: any) => b.textContent).join("") === "\u2197\u23f8\u2715" && hBtns[1].getAttribute("aria-label") === "Suspend tenant",
    "\u2026the same glyphs and aria-labels");
  check(!Array.from(bar.querySelectorAll("button")).some((b: any) => /^(Suspend|Activate) tenant$/.test((b.textContent || "").trim())),
    "the old bare toggle is absent from the header (asserted by label)");
  check(/open the tenant portal itself/.test(wp.document.body.textContent || ""), "the caption now says the page can open the portal");

  // WIRING: suspend reaches the LIGHT confirm and gains no typed input.
  hBtns[1].click();
  const susp = await until(() => wp.document.querySelector(".adm-susp-modal"));
  check(!!susp, "suspend reaches the light confirmation \u2014 the page did NOT have one before this batch");
  check(susp.querySelectorAll("input").length === 0 && susp.querySelectorAll("textarea").length === 0,
    "\u2026with NO typed input (regression guard: suspend must not gain a typed confirmation)");
  (susp.querySelector(".adm-del-actions .btn-ghost") as any).click();
  await until(() => !wp.document.querySelector(".adm-susp-modal"));
  // WIRING: open reaches enterPortal (asserted by the state it sets synchronously).
  const portalCtxBefore = wp.App.state.currentPortalId;
  hBtns[0].click();
  await sleep(150);
  check(portalCtxBefore !== demoT.id && wp.App.state.currentPortalId === demoT.id,
    "open reaches enterPortal(portal) \u2014 the hub took the tenant's portal context only after the click");
  freeze(wp); await sleep(120);

  // ---------- (6) DOM: delete leaves for the LIST ----------
  console.log("\n(6) DOM \u2014 delete keeps its typed-name confirmation and returns to the list:");
  const wd = bootDom(base, ownerTok);
  await until(() => wd.App.state && wd.App.state.me);
  const D$ = (sel: string) => Array.from(wd.document.querySelectorAll(sel)) as any[];
  wd.location.hash = "#/admin/portals"; wd.dispatchEvent(new wd.Event("hashchange"));
  const delRow = await until(() => Array.from(wd.document.querySelectorAll("tr")).find((r: any) => (r.textContent || "").includes(delT.name)));
  (delRow as any).click();
  await until(() => D$(".adm-mp-panel").length === 2);
  const dBar = await until(() => wd.document.querySelector(".page-actions.adm-bar-center"));
  (dBar.querySelector('[data-act="delete"]') as any).click();
  const dModal = await until(() => wd.document.querySelector(".adm-del-modal"));
  check(!!dModal, "delete from the detail header opens the same confirmation the lists use");
  const dInput = dModal.querySelector(".adm-del-input");
  const dGo = dModal.querySelector(".adm-del-actions .btn-danger");
  check(!!dInput && dGo.disabled === true, "\u2026the confirm button is disabled until the typed name matches");
  dInput.value = delT.name.slice(0, -1); dInput.dispatchEvent(new wd.Event("input"));
  check(dGo.disabled === true, "\u2026a mismatch keeps it disabled");
  dInput.value = delT.name; dInput.dispatchEvent(new wd.Event("input"));
  check(dGo.disabled === false, "\u2026and only an exact match enables it");
  dGo.click();
  const backToList = await until(() => D$(".adm-mp-panel").length === 0 && (D$(".tenants-panel-card").length > 0 || D$("table tbody tr").length > 0));
  check(!!backToList, "on confirm the LIST renderer is reached, not the detail renderer \u2014 there is no tenant left to render");
  check((await db.tenant.count({ where: { id: delT.id } })) === 0, "\u2026and the tenant is actually gone");
  freeze(wd); await sleep(120);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  console.log("  (structural + declarations \u2014 jsdom paints nothing; no pixel below was measured)");
  console.log(`  detail header group \u2014 ${order.join("  \u2192  ")}`);
  console.log(`  pill row            \u2014 ${ruleBody(cssSrc, ".adm-pillrow").replace(/\s+/g, " ")}`);
  console.log(`  action row (reused) \u2014 ${ruleBody(cssSrc, ".adm-actions-stack").replace(/\s+/g, " ")}`);
  console.log(`  action button size  \u2014 ${ruleBody(cssSrc, ".adm-actions-stack .btn").replace(/\s+/g, " ")}`);
  console.log(`  empty state         \u2014 ${ruleBody(cssSrc, ".empty").replace(/\s+/g, " ")}`);
  report.push("  DERIVED, not measured: the header's trailing groups cannot spread because .adm-title2 declares flex: 1 and .page-actions declares justify-content: flex-end; both groups are single flex items, and .page-actions declares flex-wrap: wrap, so at a narrow width they wrap as WHOLE UNITS rather than a button dropping out of view.");
  report.push("  DERIVED, not measured: the charges empty state was a .card (18px padding) inside tableWrap inside the mount container inside .card.adm-card10 (18px padding) \u2014 a bordered box inside a bordered box. .empty declares padding and text-align only, no border and no background, so one panel is all that renders now.");
  report.forEach((l) => console.log(l));

  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* already deleted by the test, or best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (a tenant reads the same everywhere, and the picker can no longer offer a field the card ignores)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
