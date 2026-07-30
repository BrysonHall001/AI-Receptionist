process.env.AI_PROVIDER = "mock";

// AI RECEPTIONIST ONLY TEMPLATE + MODULE VISIBILITY — self-test.
//
// Written under the standing test policy: behaviour and computable invariants, no
// source-text pins except where a string IS the product.
//
// The centre of gravity is deliberately NOT the template. It is the owner's actual
// question: when a template switches a module off, does it stay off EVERYWHERE? Three
// surfaces were leaking (the permissions matrix, notification preferences, and the Labels
// noun editor) and each had its own private spelling of the visibility rule. So the biggest
// section below drives the REAL client gate for a simulated receptionist-only tenant, and
// the ratchet at the end freezes the number of hand-rolled gates at zero so a seventh
// spelling cannot be written by accident.
//
// MEASUREMENT NOTE: jsdom has no layout engine, so the alignment section asserts the CSS
// declarations and the absence of the compensating values — never rendered geometry.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { TENANT_TEMPLATES, getTemplate } = require("../services/tenantTemplates");
const { SYSTEM_RECORD_TYPES } = require("../services/recordTypeService");
const { NOTIFICATION_CATEGORIES } = require("../services/inAppNotificationService");
const { JSDOM } = require("jsdom");
const { readFileSync } = require("fs");
const { join, resolve } = require("path");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const PUB = resolve(__dirname, "..", "..", "public");
const cleanup: string[] = [];

/** A live App with the visibility helpers loaded from the REAL app.js, standing in for a
 *  tenant whose nav hides the given hrefs. This is the gate every surface consults. */
function gateFor(hiddenHrefs: string[], lockedPages: string[] = []) {
  const dom = new JSDOM("<body></body>", { runScripts: "outside-only" });
  const w: any = dom.window;
  w.App = {
    state: { me: { lockedPages }, recordTypes: (SYSTEM_RECORD_TYPES as any[]).map((d) => ({ key: d.key, label: d.defaults.label, labelPlural: d.defaults.labelPlural })) },
    navConfig: () => ({ hidden: hiddenHrefs, order: [], labels: {} }),
    recordTypeHref: (k: string) => (k === "contact" ? "#/contacts" : k === "job" ? "#/jobs" : k === "booking" ? "#/bookings" : "#/records/" + k),
    recordsAreaHrefs: () => (SYSTEM_RECORD_TYPES as any[]).map((d) => d.key).filter((k: string) => k !== "contact").map((k: string) => (k === "job" ? "#/jobs" : k === "booking" ? "#/bookings" : "#/records/" + k)),
  };
  const src = readFileSync(join(PUB, "js", "app.js"), "utf8");
  // take only the visibility block - the rest of app.js boots a router we do not want here
  const start = src.indexOf("  App.isPageLocked = function (href)");
  const end = src.indexOf("  // Display text for a nav item");
  w.eval("(function(){ var App = window.App;\n" + src.slice(start, end) + "\n})();");
  return w.App;
}

async function main() {
  console.log("AI RECEPTIONIST ONLY TEMPLATE + MODULE VISIBILITY — self-test");
  console.log("============================================================");
  const stamp = Date.now();
  const tpl = getTemplate("ai_receptionist");
  const allKeys = (SYSTEM_RECORD_TYPES as any[]).map((d) => d.key);

  // ---------- (1) the template, as data ----------
  console.log("\n(1) the template:");
  check(!!tpl && TENANT_TEMPLATES[1] && TENANT_TEMPLATES[1].key === "ai_receptionist",
    "it exists and sits second, between General and Field Services");
  check(allKeys.filter((k: string) => !tpl.modulesHiddenPrefill.includes(k)).join() === "contact",
    `contacts is the ONLY module left on (${tpl.modulesHiddenPrefill.length} of ${allKeys.length} hidden)`);
  check(JSON.stringify(tpl.pagesOffPrefill.slice().sort()) === JSON.stringify(["#/automations", "#/communication", "#/reports"]),
    "dashboard, calls, learning centre, billing and feedback are all left ON");
  check(tpl.aiSchedulingTarget === null && tpl.aiIntake === null,
    "no scheduling target and no intake \u2014 there is nothing to schedule into");

  // ---------- (2) what it actually CREATES ----------
  console.log("\n(2) creating a tenant from it:");
  const t: any = await createPortal({ name: `air-${stamp}`, billingStatus: "trial", template: "ai_receptionist", hiddenRecordTypes: tpl.modulesHiddenPrefill, lockedPages: tpl.pagesOffPrefill } as any);
  cleanup.push(t.id);
  const fresh = await db.tenant.findUnique({ where: { id: t.id } });
  const navHidden: string[] = (((fresh.labels || {}).nav || {}).hidden) || [];
  const expectHidden = tpl.modulesHiddenPrefill.map((k: string) => (k === "job" ? "#/jobs" : k === "booking" ? "#/bookings" : "#/records/" + k));
  check(expectHidden.every((h: string) => navHidden.includes(h)) && navHidden.length === expectHidden.length,
    `every switched-off module is hidden on the tenant, and nothing else is (${navHidden.length} hrefs)`);
  check(!navHidden.includes("#/contacts"), "contacts is not hidden \u2014 it is core and its checkbox is disabled");
  const rts = await db.recordType.findMany({ where: { tenantId: t.id }, select: { key: true } });
  check(rts.length === allKeys.length,
    `all ${allKeys.length} modules still EXIST on the tenant (${rts.length}) \u2014 hidden is not deleted, so switching one back on restores it`);

  // ---------- (3) the operator's checkboxes still win ----------
  console.log("\n(3) an override beats the template:");
  const o: any = await createPortal({ name: `air-ovr-${stamp}`, billingStatus: "trial", template: "ai_receptionist", hiddenRecordTypes: ["job"], lockedPages: [] } as any);
  cleanup.push(o.id);
  const oFresh = await db.tenant.findUnique({ where: { id: o.id } });
  const oHidden: string[] = (((oFresh.labels || {}).nav || {}).hidden) || [];
  check(oHidden.length === 1 && oHidden[0] === "#/jobs",
    `ticking modules back on overrides the template's eleven \u2014 only what was submitted is hidden (${oHidden.join(", ") || "none"})`);

  // ---------- (4) the other three templates are unchanged ----------
  console.log("\n(4) the other three templates:");
  for (const key of ["general", "field_services", "recruitment_marketing"]) {
    const tt = getTemplate(key);
    const made: any = await createPortal({ name: `air-${key}-${stamp}`, billingStatus: "trial", template: key, hiddenRecordTypes: tt.modulesHiddenPrefill, lockedPages: tt.pagesOffPrefill } as any);
    cleanup.push(made.id);
    const f = await db.tenant.findUnique({ where: { id: made.id } });
    const nh: string[] = (((f.labels || {}).nav || {}).hidden) || [];
    const want = tt.modulesHiddenPrefill.map((k: string) => (k === "job" ? "#/jobs" : k === "booking" ? "#/bookings" : "#/records/" + k));
    check(nh.length === want.length && want.every((h: string) => nh.includes(h)),
      `${key} still creates exactly what it created before (${nh.length} hidden)`);
  }

  // ---------- (5) THE LEAK AUDIT: does a switched-off module stay off EVERYWHERE? ----------
  console.log("\n(5) a switched-off module, across every surface that could offer it:");
  const gate = gateFor(expectHidden);
  const visible = gate.visibleRecordTypes().map((x: any) => x.key);
  check(visible.join() === "contact",
    `THE helper every surface calls offers only contacts (${visible.join(", ")})`);
  check(gate.isAreaUnavailable("records") === true,
    "PERMISSIONS MATRIX: the records area is unavailable, so a switched-off module can no longer be granted \u2014 it used to ask about page LOCKS only, and hiding is a different fact");
  check(gate.isAreaUnavailable("contacts") === false,
    "\u2026while contacts, which this tenant does have, is still grantable");
  const cats = (NOTIFICATION_CATEGORIES as any[]).filter((c) => !c.requiredArea || !gate.isAreaUnavailable(c.requiredArea)).map((c) => c.key);
  check(!cats.includes("booking_created") && !cats.includes("booking_cancelled"),
    "NOTIFICATION PREFERENCES: booking alerts are no longer offered to a tenant with no bookings");
  check(cats.includes("call_missed_or_failed") && cats.includes("lead_captured") && cats.includes("feedback_reply"),
    `\u2026while the ones it can actually receive remain (${cats.join(", ")})`);
  check(gate.isModuleHidden("work_order") === true && gate.isModuleHidden("contact") === false,
    "LABELS / terminology: the noun editor's source now offers only modules the tenant has");

  // NEGATIVE — prove the gate is actually consulted rather than the answer being constant
  console.log("\n(6) negative \u2014 switch one back on and every surface offers it again:");
  const back = gateFor(expectHidden.filter((h: string) => h !== "#/bookings"));
  const backVisible = back.visibleRecordTypes().map((x: any) => x.key);
  check(backVisible.includes("booking") && backVisible.includes("contact") && backVisible.length === 2,
    `turning bookings back on makes it visible again (${backVisible.join(", ")}) \u2014 the surfaces read the gate, they do not hardcode an answer`);
  check(back.isAreaUnavailable("records") === false,
    "\u2026and the records area becomes grantable again on the permissions screen");
  const backCats = (NOTIFICATION_CATEGORIES as any[]).filter((c) => !c.requiredArea || !back.isAreaUnavailable(c.requiredArea)).map((c) => c.key);
  check(backCats.includes("booking_created"), "\u2026and booking alerts reappear in notification preferences");

  // ---------- (7) the convergence ratchet ----------
  console.log("\n(7) one rule, one spelling \u2014 frozen:");
  const jsFiles = ["portal.js", "automations.js", "reports.js", "learn.js", "fields.js", "communication.js", "drips.js", "compose.js"];
  const handRolled: string[] = [];
  for (const f of jsFiles) {
    const src = readFileSync(join(PUB, "js", f), "utf8");
    src.split("\n").forEach((ln: string, i: number) => {
      // a hand-rolled gate = combining the primitives itself instead of calling the helper
      if (/isRecordTypeLocked[\s\S]{0,80}?(isNavHidden|isModuleHidden)/.test(ln) || /isAreaLocked\(/.test(ln)) handRolled.push(`${f}:${i + 1}`);
    });
  }
  check(handRolled.length === 0,
    handRolled.length === 0
      ? "no surface combines the visibility primitives by hand \u2014 they all call App.visibleRecordTypes / isAreaUnavailable, so a seventh private spelling cannot appear unnoticed"
      : `HAND-ROLLED VISIBILITY GATES: ${handRolled.join(", ")} \u2014 call the helper instead`);

  // ---------- (8) the create screen's alignment ----------
  console.log("\n(8) the create screen's description text:");
  const css = readFileSync(join(PUB, "styles.css"), "utf8");
  const rule = (sel: string) => { const i = css.indexOf("\n" + sel + " {"); return i < 0 ? "" : css.slice(i + 1, css.indexOf("}", i) + 1); };
  check(/align-items: center/.test(rule(".adm-ai-row")) && /margin-top: 0/.test(rule(".adm-ai-row .adm-seg")),
    "the row centres its columns and zeroes the control's stray top margin \u2014 alignment by layout");
  check(!/padding-top/.test(rule(".adm-ai-right")) && !/margin-top/.test(rule(".adm-ai-div")),
    "the 26px that faked the alignment is gone");
  check(!/padding-top|margin-top/.test(rule(".adm-demo-row .adm-ai-right")) && !css.includes(".adm-demo-row .adm-ai-div"),
    "and the demo row's two compensating numbers are gone with it \u2014 centring does not care what scale the control renders at");

  for (const id of cleanup) { await db.tenant.delete({ where: { id } }).catch(() => { /* best-effort */ }); }
  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (a receptionist-only tenant, and a module that stays off everywhere)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => { console.error("threw:", e); await disconnectDb().catch(() => { /* */ }); process.exit(1); });

export {};
