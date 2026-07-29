// FORCE the mock AI engine (offline + deterministic) — the standing
// require-order pattern: tsx hoists `import`, so everything below loads via
// require() AFTER this override.
process.env.AI_PROVIDER = "mock";

// HUB POLISH 3 — TENANT DETAIL PANELS + PANELS-VIEW ACTIONS — self-test.
// Five layers:
//   builds        — the changelog row landed once, idempotently;
//   stylesheet    — the equal-height mechanism, the shared save-button floor and the
//                   horizontal action row are DECLARED (align-items:start gone, the 420px
//                   ceiling moved from the list to the card, width:100% replaced by a
//                   square min-width, flex-wrap kept);
//   happy paths   — both panels render the same anatomy with the same fill class and the
//                   same save-button class list; "Save page access" is disabled until a
//                   page is toggled and disabled again after a successful save; the three
//                   panel actions are siblings in one wrapper between the name and the
//                   status pill, all the same size;
//   regressions   — the PATCH payload is still exactly { lockedPages: [...] } against
//                   /api/admin/portals/:id, page locking still 403s end-to-end through the
//                   real lockGate, delete still demands the typed name, and SUSPEND STILL
//                   HAS NO TYPED INPUT (a regression guard, not a feature);
//   navigation    — the card body still opens the detail page, an action button does not.
//
// MEASUREMENT NOTE (stated plainly): JSDOM has no layout engine. getBoundingClientRect()
// returns zeros and offsetHeight is 0, so NOTHING in this file measures a rendered pixel
// and no pixel number below was observed. Following the precedent in the header of
// selfTest_notifUiFit.ts, every place the spec asked for a "measurement" is substituted by
// the equivalent STRUCTURAL assertion: the CSS declarations that govern panel height,
// button width and the action row; the class lists on the elements those rules select; and
// the DOM order of the card's children. The card-height figures in the computed-layout
// report are ARITHMETIC DERIVED FROM CSS DECLARATIONS, and the tokens that arithmetic
// rests on (--control-h-sm, --sp-2, --sp-4) are asserted here so the numbers cannot drift
// silently. They are labelled derived, not measured.
// Harness copied from selfTest_hubUiConsistency.ts.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { listRecordTypes } = require("../services/recordTypeService");
const { createApp } = require("../app");
const { createSession } = require("../auth/session");
const { lockGate } = require("../middleware/permissionGate");
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

// Record every request a DOM makes, so the save button's PATCH can be inspected for its
// EXACT payload shape without stubbing the network away.
function recordFetch(w: any) {
  const calls: any[] = [];
  const orig = w.fetch;
  w.fetch = (input: any, init: any = {}) => {
    calls.push({ url: typeof input === "string" ? input : (input && input.url), method: (init && init.method) || "GET", body: init && init.body });
    return orig(input, init);
  };
  return calls;
}

// Drive the REAL lockGate, exactly as selfTest_permissionsEnforcement does: a tenant-scoped
// user against an ungated endpoint that the Feedback page governs. This reads the stored
// lockedPages through the live service + cache, so it is a true end-to-end check.
async function lockDrive(tenantId: string, path: string): Promise<{ allowed: boolean; status: number | null }> {
  let nexted = false;
  const req: any = { method: "GET", path, user: { id: "u", email: "u@x", name: "U", role: "PORTAL_ADMIN", tenantId, customRoleId: null } };
  const res: any = { statusCode: null as number | null, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
  await lockGate(req, res, () => { nexted = true; });
  return { allowed: nexted, status: res.statusCode };
}
// until() cannot poll an async probe (a Promise is always truthy), so the lock gets its own
// awaited retry loop — the cache bust is asynchronous relative to the PATCH response.
async function untilLock(tenantId: string, want: "open" | "locked", ms = 8000): Promise<any> {
  const t0 = Date.now();
  for (;;) {
    const r = await lockDrive(tenantId, "/feedback");
    if (want === "locked" ? r.status === 403 : r.allowed === true) return r;
    if (Date.now() - t0 > ms) return r;
    await sleep(150);
  }
}

// The one rule body a selector owns, so an assertion can prove a declaration is ABSENT.
const ruleBody = (css: string, sel: string) => {
  const i = css.indexOf(sel + " {");
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i) + 1);
};

async function main() {
  console.log("HUB POLISH 3 — TENANT DETAIL PANELS + PANELS-VIEW ACTIONS — self-test");
  console.log("=====================================================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const cssSrc = readFileSync(join(PUB, "styles.css"), "utf8");
  const admSrc = readFileSync(join(PUB, "js", "admin.js"), "utf8");
  const owner = await db.user.create({ data: { email: `hp3-own-${stamp}@example.invalid`, name: "O", role: "OWNER", passwordHash: "x" } });
  const ownerTok = await createSession(owner.id);
  const report: string[] = [];

  // ---------- (1) builds ----------
  console.log("\n(1) builds:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-hub-polish-3-20260729" } });
  check(!!cl && cl.id === "cl_hub_polish_3_20260729" && cl.type === "Improvement", "the changelog row landed (idempotent migration, ON CONFLICT DO NOTHING)");
  const clAll = await db.changeLogEntry.findMany({ where: { commitSha: "batch-hub-polish-3-20260729" } });
  check(clAll.length === 1, "…exactly once, so re-running the migration cannot duplicate it");
  // VOCABULARY LAW. The term is assembled from fragments and never spelled out, because
  // selfTest_demoTenantSafety greps every src/**/*.ts for it and exempts only ITSELF - a
  // suite that named the banned word would become an offender. Worth asserting here anyway:
  // that scan covers .ts and public/js only, so changelog SQL copy is otherwise unchecked.
  const BANNED_TERM = "work" + "space";
  check(!new RegExp(BANNED_TERM, "i").test(String((cl && cl.description) || "")),
    "VOCABULARY LAW: the changelog entry says TENANT throughout, never the banned product term");

  // ---------- (2) stylesheet: the declared mechanisms ----------
  console.log("\n(2) stylesheet \u2014 the declarations that govern height, width and the row:");
  const gridRule = ruleBody(cssSrc, ".adm-mp-grid");
  check(!!gridRule && !/align-items:\s*start/.test(gridRule),
    ".adm-mp-grid no longer declares align-items: start \u2014 the grid's default stretch now gives BOTH panels the row height");
  check(cssSrc.includes(".adm-mp-panel { min-width: 0; display: flex; flex-direction: column; }"),
    "\u2026each panel is a flex column, so its card can be the flexing child");
  check(cssSrc.includes(".adm-mp-card { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; max-height: 420px; }"),
    "the card fills the panel (flex: 1 1 auto; min-height: 0) and owns the 420px ceiling");
  const listRule = ruleBody(cssSrc, ".adm-mp-list");
  check(!!listRule && /flex:\s*1 1 auto/.test(listRule) && /min-height:\s*0/.test(listRule) && /overflow-y:\s*auto/.test(listRule),
    "the LIST is the flexing child, so spare height becomes scroll area instead of dead space");
  check(!/max-height/.test(listRule),
    "\u2026and the 420px ceiling has MOVED OFF the list \u2014 on the list it also capped the shorter panel, so Pages could never grow to absorb Modules' extra foot line");
  check(cssSrc.includes("--btn-w-mp-save: 22ch;") && cssSrc.includes(".adm-mp-save { min-width: var(--btn-w-mp-save); }"),
    "the shared save-button FLOOR exists as a token + one rule (content-sized ch, not a fixed px width)");
  const stackRule = ruleBody(cssSrc, ".adm-actions-stack");
  check(/flex-direction:\s*row/.test(stackRule) && /flex-wrap:\s*wrap/.test(stackRule),
    ".adm-actions-stack declares flex-direction: row AND keeps flex-wrap (RATCHET: actionsRowNoWrap)");
  const stackBtnRule = ruleBody(cssSrc, ".adm-actions-stack .btn");
  check(/min-width:\s*var\(--control-h-sm\)/.test(stackBtnRule) && !/width:\s*100%/.test(stackBtnRule),
    "\u2026and width: 100% (only ever \u201cequal\u201d because the parent was a column) is replaced by an explicit square min-width");
  check(!/\.adm-head \{/.test(cssSrc) && !/adm-head"/.test(admSrc),
    "the .adm-head wrapper is gone from both the stylesheet and the builder \u2014 no dead rule left behind");
  const t2Rule = ruleBody(cssSrc, ".adm-t2");
  check(t2Rule.includes("padding: 4px 8px; line-height: 1; min-width: 0; font-size: var(--text-base);"),
    "SHARED COMPONENT UNTOUCHED: .adm-t2 (used by the table view too) is byte-identical");
  // the tokens the report's arithmetic rests on
  check(cssSrc.includes("--control-h-sm: 30px;") && cssSrc.includes("--sp-2: 8px;") && cssSrc.includes("--sp-4: 16px;"),
    "the tokens the derived height arithmetic rests on are unchanged (30 / 8 / 16)");
  check(/\.adm-title \{[^}]*white-space: nowrap[^}]*overflow: hidden[^}]*text-overflow: ellipsis/.test(cssSrc),
    "VISUAL QUALITY: .adm-title finally pairs nowrap with its long-declared ellipsis (RATCHET: nowrapNoEllipsis satisfied)");

  // ---------- (3) DOM: the tenant detail panels ----------
  console.log("\n(3) DOM \u2014 tenant detail: two panels, one section:");
  const t: any = await createPortal({ name: `hp3-det-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(t.id);
  await listRecordTypes(t.id);
  const wd = bootDom(base, ownerTok);
  const calls = recordFetch(wd);
  await until(() => wd.App.state && wd.App.state.me);
  const D$ = (sel: string) => Array.from(wd.document.querySelectorAll(sel)) as any[];
  wd.location.hash = "#/admin/portals"; wd.dispatchEvent(new wd.Event("hashchange"));
  const rowBtn = await until(() => Array.from(wd.document.querySelectorAll("button, a, tr")).find((x: any) => (x.textContent || "").includes(t.name)));
  check(!!rowBtn, "the fixture tenant is in the list");
  (rowBtn as any).click();
  await until(() => D$(".adm-mp-panel").length === 2);
  await until(() => D$(".adm-mp-row").length > 0);
  const panels = D$(".adm-mp-panel");
  const pagesPanel = panels.find((p: any) => /Pages/.test((p.querySelector(".adm-mp-h") || {}).textContent || ""));
  const modsPanel = panels.find((p: any) => /Modules/.test((p.querySelector(".adm-mp-h") || {}).textContent || ""));
  check(!!pagesPanel && !!modsPanel, "both panels render (Pages | Modules)");
  const pagesCard = pagesPanel.querySelector(".card");
  const modsCard = modsPanel.querySelector(".card");
  check(pagesCard.classList.contains("adm-mp-card") && modsCard.classList.contains("adm-mp-card"),
    "BOTH cards carry the same fill class (.adm-mp-card) \u2014 it used to be on Modules only");
  const shape = (p: any) => Array.from(p.children).map((c: any) => c.tagName.toLowerCase() + "." + String(c.className).split(" ")[0]).join(" > ");
  const firstChild = (host: any) => (Array.from(host.children) as any[])[0];
  check(shape(pagesPanel) === shape(modsPanel) && firstChild(pagesCard).classList.contains("adm-hint") && firstChild(modsCard).classList.contains("adm-hint"),
    `CARD TOPS: the description now sits INSIDE each card, so only the single-line h3 is above it \u2014 identical panel anatomy (${shape(pagesPanel)})`);
  const pagesSave = Array.from(pagesCard.querySelectorAll("button")).find((b: any) => b.textContent.includes("Save page access")) as any;
  const modsSave = Array.from(modsCard.querySelectorAll("button")).find((b: any) => b.textContent.includes("Save module access")) as any;
  check(!!pagesSave && !!modsSave && pagesSave.className === modsSave.className,
    `both save buttons carry an IDENTICAL class list (${pagesSave.className})`);
  check(pagesSave.classList.contains("adm-mp-save") && modsSave.classList.contains("adm-mp-save"),
    "\u2026including the shared min-width class, so the two buttons cannot differ in width again");
  check(pagesSave.lastElementChild === null && pagesSave === pagesCard.lastElementChild && modsSave === modsCard.lastElementChild,
    "\u2026and each save is its card's LAST child, pinned below the flexing list (no dead space above it)");

  // ---------- (4) disabled-until-dirty + the exact PATCH payload ----------
  console.log("\n(4) \u201cSave page access\u201d \u2014 disabled until dirty, same write as before:");
  check(pagesSave.disabled === true, "disabled === true on FIRST RENDER (nothing is dirty yet)");
  const feedbackRow = D$(".adm-row3").find((r: any) => /Feedback/.test(((r.querySelector(".adm-rowname") || {}).textContent) || ""));
  check(!!feedbackRow, "the Feedback page row is present in the checklist");
  const fbBox = feedbackRow.querySelector("input");
  fbBox.checked = false; fbBox.dispatchEvent(new wd.Event("change"));
  await sleep(60);
  check(pagesSave.disabled === false, "disabled === false after a page checkbox is toggled");
  fbBox.checked = true; fbBox.dispatchEvent(new wd.Event("change"));
  await sleep(60);
  check(pagesSave.disabled === true, "\u2026and toggling it BACK is not dirty (order-insensitive set comparison, not a counter)");
  fbBox.checked = false; fbBox.dispatchEvent(new wd.Event("change"));
  await sleep(60);
  const before = await lockDrive(t.id, "/feedback");
  check(before.allowed === true && before.status === null, "END-TO-END baseline: the Feedback endpoint is OPEN before the lock");
  calls.length = 0;
  pagesSave.click();
  const patch = await until(() => calls.find((c: any) => c.method === "PATCH" && /\/api\/admin\/portals\//.test(String(c.url))));
  check(!!patch, "saving issues a PATCH to /api/admin/portals/:id");
  const payload = patch ? JSON.parse(String(patch.body)) : {};
  check(Object.keys(payload).length === 1 && Array.isArray(payload.lockedPages),
    `EXACT payload shape: { lockedPages: [\u2026] } and nothing else (keys: ${Object.keys(payload).join(",")})`);
  check(payload.lockedPages.includes("#/feedback"), "\u2026carrying the locked page's href, exactly as it did before this batch");
  check(String(patch.url).endsWith(`/api/admin/portals/${t.id}`), "\u2026against the tenant's own endpoint (unchanged URL)");
  const afterLock = await untilLock(t.id, "locked");
  check(afterLock.status === 403 && afterLock.allowed === false,
    "END-TO-END: the server now 403s the locked page through the real lockGate");
  // Checked only AFTER the server has demonstrably committed, so this proves the button did
  // not re-enable itself on success (the old code set disabled = false here).
  check(pagesSave.disabled === true, "the button returns to DISABLED after a successful save");
  fbBox.checked = true; fbBox.dispatchEvent(new wd.Event("change"));
  await sleep(60);
  check(pagesSave.disabled === false, "unticking\u2192reticking re-dirties the button");
  pagesSave.click();
  const afterUnlock = await untilLock(t.id, "open");
  check(afterUnlock.allowed === true, "END-TO-END: unlocking returns the page \u2014 page locking still works both ways");
  check(pagesSave.disabled === true, "\u2026and the button is disabled again after that save too");
  freeze(wd); await sleep(120);

  // ---------- (5) DOM: the panels-view action row ----------
  console.log("\n(5) DOM \u2014 panels view: three actions in a horizontal row:");
  const td: any = await createPortal({ name: `hp3-susp-${stamp}`, billingStatus: "trial" } as any);
  cleanup.push(td.id);
  await db.tenant.update({ where: { id: td.id }, data: { status: "SUSPENDED" } });
  const wp = bootDom(base, ownerTok);
  await until(() => wp.App.state && wp.App.state.me);
  wp.localStorage.setItem("adminview:tenants", "panel");
  const P$ = (sel: string) => Array.from(wp.document.querySelectorAll(sel)) as any[];
  wp.location.hash = "#/admin/portals"; wp.dispatchEvent(new wp.Event("hashchange"));
  await until(() => P$(".tenants-panel-card").length > 0);
  const card = await until(() => P$(".tenants-panel-card").find((c: any) => (c.textContent || "").includes(t.name)));
  check(!!card, "the Panels view renders a card per tenant");
  const actions = card.querySelector(".adm-actions-stack");
  check(!!actions && actions.parentElement === card, "the action wrapper is a DIRECT CHILD of the card (the old head/openWrap nesting is gone)");
  const kids = Array.from(card.children) as any[];
  check(kids.indexOf(actions) === kids.findIndex((k: any) => k.classList.contains("adm-title")) + 1,
    "\u2026positioned immediately AFTER the tenant name");
  check(!!actions.nextElementSibling && !!actions.nextElementSibling.querySelector(".badge"),
    "\u2026and immediately BEFORE the status pill");
  const btns = Array.from(actions.children) as any[];
  check(btns.length === 3 && btns.every((b: any) => b.tagName === "BUTTON"),
    "the three action buttons are SIBLINGS in that one wrapper");
  check(btns.map((b: any) => b.getAttribute("data-act")).join("|") === "open|suspend|delete",
    "\u2026in the table view's order: open, suspend, delete");
  check(btns[0].classList.contains("btn-primary") && btns[1].classList.contains("btn-ghost") && btns[2].classList.contains("btn-danger"),
    "\u2026with the table view's variants: primary, ghost, danger");
  check(btns.every((b: any) => b.classList.contains("adm-t2") && b.classList.contains("btn-sm")),
    "\u2026all three carrying the SAME size-governing classes (.btn-sm + .adm-t2), squared by .adm-actions-stack .btn");
  check(new Set(btns.map((b: any) => b.className)).size === 3 && new Set(btns.map((b: any) => b.className.replace(/btn-(primary|ghost|danger)|t-\w+/g, "").replace(/\s+/g, " ").trim())).size === 1,
    "\u2026differing only in variant and hook class \u2014 nothing else can make one wider than another");

  // the shows("actions") gate
  const wg = bootDom(base, ownerTok);
  await until(() => wg.App.state && wg.App.state.me);
  wg.localStorage.setItem("adminview:tenants", "panel");
  wg.localStorage.setItem("panelfields:tenants", JSON.stringify({ hidden: ["actions"] }));
  wg.location.hash = "#/admin/portals"; wg.dispatchEvent(new wg.Event("hashchange"));
  await until(() => Array.from(wg.document.querySelectorAll(".tenants-panel-card")).length > 0);
  check(wg.document.querySelectorAll(".adm-title").length > 0 && wg.document.querySelectorAll(".adm-actions-stack").length === 0,
    "the shows(\u201cactions\u201d) gate is preserved: hiding Actions in \u201cManage panels\u201d still removes the whole row");
  freeze(wg);

  // ---------- (6) confirmations ----------
  console.log("\n(6) confirmations \u2014 unchanged, asserted as regression guards:");
  // A SUSPENDED tenant, because confirmDeleteTenant also blocks a real ACTIVE tenant
  // ("suspend it first") — with that gate satisfied the typed name is the only lock left,
  // which is precisely what this asserts.
  const suspCard = await until(() => P$(".tenants-panel-card").find((c: any) => (c.textContent || "").includes(td.name)));
  check(!!suspCard, "the suspended fixture tenant has a panel too");
  const delBtn = suspCard.querySelector('[data-act="delete"]');
  delBtn.click();
  const delModal = await until(() => wp.document.querySelector(".adm-del-modal"));
  check(!!delModal, "delete opens its confirmation modal from the PANEL card (same delegated handler as the table)");
  const delInput = delModal.querySelector(".adm-del-input");
  const delGo = delModal.querySelector(".adm-del-actions .btn-danger");
  check(!!delInput && delGo.disabled === true, "\u2026the confirm button is DISABLED until the typed name matches");
  delInput.value = td.name.slice(0, -1); delInput.dispatchEvent(new wp.Event("input"));
  check(delGo.disabled === true, "\u2026a MISMATCH keeps it disabled");
  delInput.value = td.name; delInput.dispatchEvent(new wp.Event("input"));
  check(delGo.disabled === false, "\u2026and only an exact match enables it");
  (delModal.querySelector(".adm-del-actions .btn-ghost") as any).click();
  await until(() => !wp.document.querySelector(".adm-del-modal"));
  const activeCard = P$(".tenants-panel-card").find((c: any) => (c.textContent || "").includes(t.name));
  (activeCard.querySelector('[data-act="suspend"]') as any).click();
  const suspModal = await until(() => wp.document.querySelector(".adm-susp-modal"));
  check(!!suspModal, "suspend opens the LIGHT confirmation");
  check(suspModal.querySelectorAll("input").length === 0 && suspModal.querySelectorAll("textarea").length === 0,
    "\u2026with NO typed input of any kind \u2014 suspend did not gain a confirmation it never had");
  check(!!suspModal.querySelector(".adm-susp-list") && suspModal.querySelectorAll(".adm-susp-list li").length >= 5,
    "\u2026still the plain confirm with its bulleted consequence list");
  check(P$(".adm-mp-panel").length === 0, "NAVIGATION: clicking an action button did NOT reach the detail renderer");
  (suspModal.querySelector(".adm-del-actions .btn-ghost") as any).click();
  await until(() => !wp.document.querySelector(".adm-susp-modal"));

  // ---------- (7) navigation from the card body ----------
  console.log("\n(7) navigation \u2014 the body still opens the tenant:");
  const bodyTarget = activeCard.querySelector(".adm-stats") || activeCard.querySelector(".adm-title");
  bodyTarget.click();
  const reached = await until(() => P$(".adm-mp-panel").length === 2);
  check(!!reached, "clicking the card BODY reaches renderTenantDetail (the guard only skips controls)");
  freeze(wp); await sleep(120);

  // ---------- computed-layout report ----------
  console.log("\n  \u2500\u2500 computed-layout report \u2500\u2500");
  console.log("  (structural + ARITHMETIC DERIVED FROM CSS \u2014 jsdom paints nothing; no pixel below was measured)");
  console.log(`  panel height  \u2014 governs: ${ruleBody(cssSrc, ".adm-mp-grid").replace(/\s+/g, " ")}`);
  console.log(`                  ${ruleBody(cssSrc, ".adm-mp-card").replace(/\s+/g, " ")}`);
  console.log(`                  ${ruleBody(cssSrc, ".adm-mp-list").replace(/\s+/g, " ")}`);
  console.log(`  button width  \u2014 governs: .adm-mp-save { min-width: var(--btn-w-mp-save) } = 22ch; both buttons carry "${pagesSave.className}"`);
  console.log(`  action row    \u2014 governs: ${ruleBody(cssSrc, ".adm-actions-stack").replace(/\s+/g, " ")}`);
  console.log(`                  ${ruleBody(cssSrc, ".adm-actions-stack .btn").replace(/\s+/g, " ")}`);
  console.log(`  card children \u2014 ${kids.map((k: any) => "." + (String(k.className).split(" ").pop() || "?")).join(" \u2192 ")}`);
  report.push("  DERIVED card height, panels view (all fields shown), from the declarations above \u2014 NOT measured:");
  report.push("    before: padding 2\u00d714 + head max(title 21, stack [3\u00d730 + 2\u00d78] = 106) + pill 24 + aiwrap 59 + stats 18 + 3 gaps \u00d78 = 259px");
  report.push("    after:  padding 2\u00d716 + title 21 + row [1\u00d730] + pill 24 + aiwrap 60 + stats 18 + 4 gaps \u00d78 = 217px");
  report.push("    delta:  \u221242px per panel (~16%). Structural saving is 47px; 5px goes back into the two token corrections (14px\u2192--sp-4 padding, 3px\u2192--sp-1 gap).");
  report.push("  DERIVED card-top offset removed: the two hints are 360 and 367 chars in a 6fr and a 4fr column \u2014 \u22482 lines \u00d7 18px \u2248 36px of misalignment, eliminated by moving each hint inside its card.");
  report.forEach((l) => console.log(l));

  await db.user.delete({ where: { id: owner.id } }).catch(() => { /* */ });
  server.close();
  for (const x of cleanup) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (the two panels read as one section, the two save buttons match, and the panel actions sit in a row under the name)");
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
