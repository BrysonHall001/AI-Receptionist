// Customer Comms — batch self-test.
//
//   npx tsx src/db/selfTest_customerComms.ts     (from ai-receptionist, clarity-pg up)
//
// Proves, per the approved batch contract:
//  (1) TRIGGER EXTENSION — AppointmentReminder's optional module segment: an
//      hour-granularity work-order trigger enqueues in-window, NOT out-of-window,
//      NOT for terminal statuses, NOT twice (dedupe), and NEVER cross-module
//      (a segment-less trigger stays bookings-only, byte-compatible; the
//      :work_order trigger never touches bookings). Day-granular RecordDateReached
//      FieldDef flows are regression-proven unchanged.
//  (2) MESSAGE THE CUSTOMER — real (mock-transport) send to the record's linked
//      contact from a record-subject automation; SKIPPED (never failed, never
//      silent) for no linked contact / no phone / SMS master gate off — with
//      nothing transmitted and the skip reason in the run log.
//  (3) MERGE TAGS — {{business}}/{{technician}}/{{service}}(label!)/
//      {{appointment}}/{{appointment_end}} render through the one wall-clock
//      formatter and degrade gracefully ({{technician|fallback}}, absent endAt).
//  (4) ON MY WAY — sends + logs (contact activity with omwRecordId + record-note
//      breadcrumb), double-tap refused (once per day), permission-refused for a
//      records-view-only role (right + gate mapping source-grounded), and every
//      can't-send case is a specific friendly error. Per the approved design the
//      send is self-contained (server-fixed copy) — no listener required, so
//      there is no "no listener" failure mode to no-op.
//  (5) LIBRARY, NOT BAKED IN — a fresh tenant and an untouched working tenant
//      have ZERO of the five flows; applying each preset creates a DISABLED
//      draft; once enabled, each runs end-to-end in mock mode; the record_type
//      condition keeps other modules out (negative).
//  (6) ANALYTICS — the approved per-record visibility: every customer send tied
//      to a record leaves a note breadcrumb ON that record (asserted).
//  (7) Prior suites run alongside in the build block.

import { prisma, disconnectDb } from "./client";
import { readFileSync } from "fs";
import { resolve } from "path";
import { listRecordTypes, WORK_ORDER_RECORD_TYPE_KEY, BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { createRecord, updateRecord, notifyOnMyWay } from "../services/recordService";
import { createResource } from "../services/resourceService";
import { createLink } from "../services/recordLinkService";
import { registerAutomationEngine } from "../automation/engine";
import { runAppointmentReminderSweep, runRecordDateSweep, processDueJobs, fmtApptWall } from "../automation/scheduler";
import { AUTOMATION_PRESETS, getPreset } from "../automation/presets";
import { applyFlowDefinition } from "../services/flowProvisioningService";
import { can, createPortalRole } from "../services/permissionService";
import { env, smsEnabled, useMockSms } from "../config/env";

const db = prisma as any;
const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wall = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString().slice(0, 16);

async function mkTenant(tag: string): Promise<string> {
  const t = await db.tenant.create({ data: { name: `cc-${tag}-${stamp}`, notifyEmail: `cc-${tag}-${stamp}@example.invalid`, billingStatus: "active" } });
  tenantIds.push(t.id);
  return t.id;
}
const linkContactToRecord = (T: string, contactId: string, recordId: string) => createLink(T, { recordId, parentType: "contact", parentId: contactId });
// Contact fixtures go through RAW db.contact.create — the house convention in the
// automation/drip/audience suites — so the suite is robust to the createContact
// service guards (email is ALWAYS required there, required custom fields are
// enforced, etc.) while still letting negatives craft a contact with no phone
// or no email deliberately. Every fixture gets a UNIQUE email + phone by default.
let fxSeq = 0;
async function mkContact(T: string, name: string, opts: { phone?: string | null; email?: string | null } = {}) {
  fxSeq++;
  const phone = opts.phone === undefined ? `+1555${String(stamp).slice(-4)}${String(fxSeq).padStart(3, "0")}` : opts.phone;
  const email = opts.email === undefined ? `cc-fx-${fxSeq}-${stamp}@example.invalid` : opts.email;
  return db.contact.create({ data: { tenantId: T, name, phone, email, source: "test" } });
}
async function noteTexts(recordId: string): Promise<string[]> {
  const r = await db.record.findFirst({ where: { id: recordId } });
  return (((r?.customFields || {}).__activity || []) as any[]).map((a) => String(a.text || ""));
}
async function jobsFor(autoId: string): Promise<any[]> {
  return db.scheduledJob.findMany({ where: { automationId: autoId } });
}
async function waitRun(autoId: string, extraWhere: any = {}): Promise<any> {
  for (let i = 0; i < 40; i++) { const r = await db.automationRun.findFirst({ where: { automationId: autoId, ...extraWhere }, orderBy: { createdAt: "desc" } }); if (r) return r; await sleep(250); }
  return null;
}

// The SMS gate + mock flags are read from `env` on EVERY send, so the suite can
// exercise both sides deterministically. We only force the gate ON while the
// transport is MOCK (never risking a real Twilio send), and always restore.
const originalSms = env.SMS_ENABLED;
function forceSms(on: boolean) { (env as any).SMS_ENABLED = on ? "true" : "false"; }

async function main() {
  console.log("Customer Comms — batch self-test");
  console.log("================================");
  check(useMockSms() === true, `SMS transport is MOCK in this environment (real-credentials runs must not force the gate) — gate currently ${smsEnabled() ? "on" : "off"}`);
  if (!useMockSms()) throw new Error("Refusing to run send tests against real SMS credentials");
  forceSms(true);

  registerAutomationEngine();
  const T = await mkTenant("main");
  await listRecordTypes(T);
  const tech = await createResource(T, { name: `CC Tech ${stamp}` });

  // =========================================================================
  console.log("\n(1) trigger extension — module segment, windows, dedupe, no cross-module:");
  const cNear = await mkContact(T, "Near Customer");
  const woNear: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Near job", subtypeKey: "repair", appointmentAt: wall(90 * 60000), endAt: wall(150 * 60000), resourceId: tech.id, customFields: {} });
  await linkContactToRecord(T, cNear.id, woNear.id);
  const woFar: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Far job", subtypeKey: "repair", appointmentAt: wall(10 * 86400000), customFields: {} });
  await linkContactToRecord(T, cNear.id, woFar.id);
  const woGone: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Called-off job", subtypeKey: "repair", stageKey: "cancelled", appointmentAt: wall(90 * 60000), customFields: {} });
  await linkContactToRecord(T, cNear.id, woGone.id);
  const bkNear: any = await createRecord(T, BOOKING_RECORD_TYPE_KEY, { title: "Near booking", subtypeKey: (await db.recordType.findFirst({ where: { tenantId: T, key: "booking" } })).subtypes[0].key, appointmentAt: wall(90 * 60000), allowClosed: true, allowOverlap: true, customFields: {} } as any);
  await linkContactToRecord(T, cNear.id, bkNear.id);

  const aWo = await db.automation.create({ data: { tenantId: T, name: `cc wo-remind ${stamp}`, enabled: true, triggerType: "AppointmentReminder:2:hours:before:work_order", conditions: [], actions: [{ type: "message_linked_contact", config: { channel: "sms", body: "{{business}}: {{technician|our technician}} for {{record_title}} at {{appointment}}." } }] } });
  const aBk = await db.automation.create({ data: { tenantId: T, name: `cc bk-remind ${stamp}`, enabled: true, triggerType: "AppointmentReminder:2:hours:before", conditions: [], actions: [{ type: "create_note", config: { text: "booking reminder for {{record_title}}" } }] } });

  await runAppointmentReminderSweep(T);
  await runAppointmentReminderSweep(T); // second pass proves dedupe
  const woJobs = await jobsFor(aWo.id);
  const bkJobs = await jobsFor(aBk.id);
  check(woJobs.length === 1, `work-order trigger enqueued exactly ONCE in-window across two sweeps (got ${woJobs.length}) — dedupe + out-of-window + terminal all held`);
  check(woJobs.every((j) => j.dedupeKey.includes(woNear.id)) && !woJobs.some((j) => j.dedupeKey.includes(woFar.id)) && !woJobs.some((j) => j.dedupeKey.includes(woGone.id)),
    "…and only the in-window, non-terminal work order is the subject (NEGATIVE ×2: 10-days-out and a called-off one excluded)");
  check(!woJobs.some((j) => j.dedupeKey.includes(bkNear.id)), "NEGATIVE: the :work_order trigger never enqueues for a booking");
  check(bkJobs.length === 1 && bkJobs[0].dedupeKey.includes(bkNear.id) && !bkJobs.some((j) => j.dedupeKey.includes(woNear.id)),
    "NEGATIVE: the segment-less trigger stays bookings-only (byte-compatible), never touching work orders");

  // Day-granular FieldDef regression: the equipment-style RecordDateReached flow
  // is untouched by the reminder extension.
  const eq: any = await createRecord(T, "equipment", { title: "CC Pump", customFields: { next_service_due: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) } });
  await linkContactToRecord(T, cNear.id, eq.id);
  const aEq = await db.automation.create({ data: { tenantId: T, name: `cc eq ${stamp}`, enabled: true, triggerType: "RecordDateReached:equipment:next_service_due:7:days:before", conditions: [], actions: [{ type: "create_note", config: { text: "service due for {{record_title}}" } }] } });
  await runRecordDateSweep(T);
  check((await jobsFor(aEq.id)).length === 1, "REGRESSION: a days-based FieldDef RecordDateReached flow still enqueues exactly as before");

  // =========================================================================
  console.log("\n(2) message the customer — real mock sends + clean skips:");
  const aMsg = await db.automation.create({ data: { tenantId: T, name: `cc msg ${stamp}`, enabled: true, triggerType: "RecordUpdated:status=in_progress", conditions: [], actions: [{ type: "message_linked_contact", config: { channel: "sms", body: "{{business}} | {{technician|our technician}} | {{service}} | {{appointment}} | end:{{appointment_end|none}} | x:{{made_up_tag|whatever}}" } }] } });
  await updateRecord(T, woNear.id, { stageKey: "in_progress" });
  const runMsg = await waitRun(aMsg.id);
  check(!!runMsg && runMsg.status === "success" && (runMsg.results as any[])[0]?.type === "message_linked_contact" && (runMsg.results as any[])[0]?.status === "success",
    "record-subject automation SENT to the linked customer (mock transport, run green)");
  const actNear = await db.activityLog.findFirst({ where: { tenantId: T, contactId: cNear.id, type: "text_sent", detail: { path: ["fromRecord"], equals: woNear.id } }, orderBy: { createdAt: "desc" } });
  check(!!actNear, "…logged on the contact's timeline with the source record attached");
  check((await noteTexts(woNear.id)).some((t) => t.startsWith("Texted customer")), "…and the record itself carries the breadcrumb note");

  // Skips (never failed, never silent):
  const woNobody: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Nobody linked", subtypeKey: "repair", customFields: {} });
  await updateRecord(T, woNobody.id, { stageKey: "in_progress" });
  const runNobody = await (async () => { for (let i = 0; i < 40; i++) { const r = await db.automationRun.findMany({ where: { automationId: aMsg.id }, orderBy: { createdAt: "desc" } }); const hit = r.find((x: any) => (x.results as any[])?.[0]?.detail === "No linked customer on this record"); if (hit) return hit; await sleep(250); } return null; })();
  check(!!runNobody && (runNobody.results as any[])[0]?.status === "skipped", "NEGATIVE: no linked contact -> SKIPPED with the explicit reason (not failed, not silent)");

  const cNoPhone = await mkContact(T, "No Phone", { phone: null, email: `np-${stamp}@example.invalid` });
  const woNoPhone: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "No phone", subtypeKey: "repair", customFields: {} });
  await linkContactToRecord(T, cNoPhone.id, woNoPhone.id);
  await updateRecord(T, woNoPhone.id, { stageKey: "in_progress" });
  const runNoPhone = await (async () => { for (let i = 0; i < 40; i++) { const r = await db.automationRun.findMany({ where: { automationId: aMsg.id }, orderBy: { createdAt: "desc" } }); const hit = r.find((x: any) => String((x.results as any[])?.[0]?.detail || "").includes("has no phone")); if (hit) return hit; await sleep(250); } return null; })();
  check(!!runNoPhone && (runNoPhone.results as any[])[0]?.status === "skipped", "NEGATIVE: linked contact without a phone -> SKIPPED with the reason");

  // SMS master gate OFF: nothing transmitted, skip is explicit, run stays green.
  forceSms(false);
  const before = await db.activityLog.count({ where: { tenantId: T, type: "text_sent" } });
  const woGate: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Gated", subtypeKey: "repair", customFields: {} });
  await linkContactToRecord(T, cNear.id, woGate.id);
  await updateRecord(T, woGate.id, { stageKey: "in_progress" });
  const runGate = await (async () => { for (let i = 0; i < 40; i++) { const r = await db.automationRun.findMany({ where: { automationId: aMsg.id }, orderBy: { createdAt: "desc" } }); const hit = r.find((x: any) => String((x.results as any[])?.[0]?.detail || "").includes("SMS gate")); if (hit) return hit; await sleep(250); } return null; })();
  check(!!runGate && (runGate.results as any[])[0]?.status === "skipped", "NEGATIVE: SMS master gate off -> SKIPPED, logged as such in the run");
  check((await db.activityLog.count({ where: { tenantId: T, type: "text_sent" } })) === before, "…and NOTHING was transmitted or activity-logged as sent");
  forceSms(true);

  // =========================================================================
  console.log("\n(3) merge tags — wall-clock formatting + graceful degradation:");
  const portalName = `cc-main-${stamp}`;
  const woRow = await db.record.findFirst({ where: { id: woNear.id } });
  const expectApptStr = fmtApptWall(new Date(woRow.appointmentAt));
  const expectEndStr = fmtApptWall(new Date(woRow.endAt));
  const bodySent = String((actNear?.detail as any)?.body || "");
  check(bodySent.includes(portalName), `{{business}} rendered the portal name`);
  check(bodySent.includes(`CC Tech ${stamp}`), "{{technician}} rendered the assigned staff name");
  check(bodySent.includes("| Repair |"), "{{service}} rendered the subtype LABEL (raw-key bug fixed)");
  check(bodySent.includes(expectApptStr), `{{appointment}} used the one wall-clock formatter (${expectApptStr})`);
  check(bodySent.includes(`end:${expectEndStr}`), "{{appointment_end}} rendered the real end");
  check(bodySent.includes("x:whatever"), "NEGATIVE: an UNKNOWN tag with a fallback degrades to the fallback by the same rule");
  check(!bodySent.includes("{{"), "…and no raw {{...}} was ever transmitted to the customer");
  // Graceful: unassigned + no end -> pipe fallbacks, never blank-weird or "null".
  // woGate ran with the gate OFF (skipped) — rerun its send with the gate on for the graceful assert.
  await updateRecord(T, woGate.id, { stageKey: "scheduled" });
  await updateRecord(T, woGate.id, { stageKey: "in_progress" });
  const actGrace2 = await (async () => { for (let i = 0; i < 40; i++) { const a = await db.activityLog.findFirst({ where: { tenantId: T, type: "text_sent", detail: { path: ["fromRecord"], equals: woGate.id } } }); if (a) return a; await sleep(250); } return null; })();
  const gb = String((actGrace2?.detail as any)?.body || "");
  check(gb.includes("our technician") && gb.includes("end:none") && !gb.includes("null") && !gb.includes("{{"),
    `graceful degradation: {{technician|our technician}} + {{appointment_end|none}} fall back cleanly, no raw tags, no "null" (got: "${gb.slice(0, 90)}…")`);

  // TEMPLATE/RESOLVER AGREEMENT — this batch's copy and the resolver disagreed
  // once; prove they can't disagree silently again. Every {{tag}} in every
  // template this batch ships (the five library entries + the on-my-way server
  // copy) must (a) parse under the ONE resolver's own regex and (b) name a key
  // the sending context actually provides.
  console.log("\n(3b) shipped-template audit — every tag resolvable, source-grounded:");
  const RESOLVABLE = new Set([
    "name", "first_name", "last_name", "phone", "email", "intent", // contact tokens (templateContext)
    "record_title", "record_type", "appointment", "appointment_time", "appointment_end",
    "technician", "service", "business", // record/reminder extraTokens (engine + injector)
    "new_stage", "old_stage", "changed_field", "new_value", "old_value",
  ]);
  const TAG_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|[^}]*)?\}\}/g;
  const LOOSE_RE = /\{\{[^}]*\}\}/g; // anything brace-shaped, incl. malformed
  const offenders: string[] = [];
  const KEYS5 = ["wo_visit_reminder_day", "wo_visit_reminder_2h", "wo_request_received", "wo_review_ask", "wo_stale_request_nudge"];
  for (const k of KEYS5) {
    for (const a of getPreset(k)!.definition.actions as any[]) {
      for (const fld of ["body", "html", "subject", "text"]) {
        const tpl = String((a.config || {})[fld] || "");
        const wellFormed = (tpl.match(TAG_RE) || []).join("");
        const loose = (tpl.match(LOOSE_RE) || []).join("");
        if (wellFormed.length !== loose.length) offenders.push(`${k}.${fld}: malformed tag the resolver can't parse`);
        let m: RegExpExecArray | null; TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(tpl))) { if (!RESOLVABLE.has(m[1])) offenders.push(`${k}.${fld}: unresolvable {{${m[1]}}}`); }
      }
    }
  }
  const omwSrc = readFileSync(resolve(__dirname, "../services/recordService.ts"), "utf8");
  const omwTplM = /resolveMergeTags\("([^"]+)"/.exec(omwSrc);
  check(!!omwTplM, "the on-my-way copy resolves through the ONE resolver (source-grounded)");
  if (omwTplM) {
    let m: RegExpExecArray | null; TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(omwTplM[1]))) { if (!RESOLVABLE.has(m[1])) offenders.push(`on-my-way: unresolvable {{${m[1]}}}`); }
  }
  check(offenders.length === 0, `every shipped template's tags are well-formed and resolvable (${offenders.length ? "OFFENDERS: " + offenders.join("; ") : "5 presets + on-my-way audited"})`);

  // =========================================================================
  console.log("\n(4) on my way — send, idempotence, permission, friendly refusals:");
  const omw1 = await notifyOnMyWay(T, woNear.id, { id: "cc-user", name: "CC Dispatcher" });
  check(omw1.sent === true && omw1.to === cNear.phone, "one tap sends to the linked customer");
  const omwAct = await db.activityLog.findFirst({ where: { tenantId: T, contactId: cNear.id, type: "text_sent", detail: { path: ["omwRecordId"], equals: woNear.id } } });
  check(!!omwAct && String((omwAct.detail as any).via) === "on_my_way", "…logged with the on-my-way marker + record id");
  check((await noteTexts(woNear.id)).some((t) => t.startsWith("On-my-way text sent")), "…and the record carries the breadcrumb");
  let dbl = ""; try { await notifyOnMyWay(T, woNear.id, { id: "cc-user", name: "CC Dispatcher" }); } catch (e: any) { dbl = e.message; }
  check(dbl === "An on-my-way text already went out for this record today.", `NEGATIVE: double-tap refused — once per record per day (got: "${dbl}")`);
  let noC = ""; try { await notifyOnMyWay(T, woNobody.id, { id: "u", name: "U" }); } catch (e: any) { noC = e.message; }
  check(noC.includes("nobody to text"), "NEGATIVE: no linked customer -> specific friendly refusal");
  let noP = ""; try { await notifyOnMyWay(T, woNoPhone.id, { id: "u", name: "U" }); } catch (e: any) { noP = e.message; }
  check(noP.includes("has no phone number"), "NEGATIVE: no phone -> specific friendly refusal");
  forceSms(false);
  let gOff = ""; try { await notifyOnMyWay(T, woFar.id, { id: "u", name: "U" }); } catch (e: any) { gOff = e.message; }
  check(gOff.includes("Texting is turned off"), "NEGATIVE: SMS gate off -> refused BEFORE any send");
  forceSms(true);
  const viewRole = await createPortalRole(T, `cc viewonly ${stamp}`, { records: { view: true, edit: false } });
  const viewer = { id: "cc-viewer", role: "CLIENT_USER", tenantId: T, customRoleId: viewRole.id };
  check((await can(viewer, "records", "edit")) === false, "NEGATIVE: a records-view-only role lacks the edit right the route demands");
  const gateSrc = readFileSync(resolve(__dirname, "../middleware/permissionGate.ts"), "utf8");
  check(/\{ m: "POST", re: \/\^\\\/records\\\/\[\^\/\]\+\\\/notify-on-my-way\$\/, area: "records", right: "edit" \}/.test(gateSrc),
    "…and permissionGate maps the on-my-way route to records/edit (source-grounded) -> a view-only tap is refused server-side");
  // Approved design: the send is self-contained server copy (no event listener
  // required), so "no automation listening" simply cannot strand the button.

  // =========================================================================
  console.log("\n(5) library — not baked in; five drafts; each runs end-to-end:");
  const Tz = await mkTenant("fresh");
  await listRecordTypes(Tz);
  const zTech = await createResource(Tz, { name: `Z Tech ${stamp}` });
  const zc = await mkContact(Tz, "Z Customer", { email: `z-${stamp}@example.invalid` });
  const seedWo: any = await createRecord(Tz, WORK_ORDER_RECORD_TYPE_KEY, { title: "Z warmup", subtypeKey: "repair", customFields: {} });
  check((await db.automation.count({ where: { tenantId: Tz } })) === 0 && (await db.scheduledJob.count({ where: { tenantId: Tz } })) === 0,
    "NOT-BAKED-IN PROOF: a fresh tenant that creates records has ZERO automations and ZERO queued jobs");
  const mainCount = await db.automation.count({ where: { tenantId: T } });
  check(mainCount === 4, `…and the untouched working tenant has exactly the 4 flows this suite itself created (got ${mainCount}) — none appeared on their own`);

  const KEYS = ["wo_visit_reminder_day", "wo_visit_reminder_2h", "wo_request_received", "wo_review_ask", "wo_stale_request_nudge"];
  check(KEYS.every((k) => !!getPreset(k)) && AUTOMATION_PRESETS.filter((p) => KEYS.includes(p.key)).length === 5, "all five entries exist in the catalog");
  const applied: Record<string, any> = {};
  for (const k of KEYS) { applied[k] = (await applyFlowDefinition(Tz, getPreset(k)!.definition, null)).automation; }
  check(Object.values(applied).every((a: any) => a.enabled === false), "applying creates DISABLED drafts (opt-in twice over)");
  await db.automation.updateMany({ where: { tenantId: Tz }, data: { enabled: true } });

  // P1 + P2: a work order 2h out is inside BOTH reminder windows.
  const zWo: any = await createRecord(Tz, WORK_ORDER_RECORD_TYPE_KEY, { title: "Z visit", subtypeKey: "repair", appointmentAt: wall(2 * 3600000), resourceId: zTech.id, customFields: {} });
  await linkContactToRecord(Tz, zc.id, zWo.id);
  await processDueJobs(Tz); // sweep + execute
  const zTexts = await db.activityLog.findMany({ where: { tenantId: Tz, contactId: zc.id, type: "text_sent" } });
  check(zTexts.length >= 2, `P1 + P2 (visit reminders): both queued AND executed in mock mode (${zTexts.length} texts logged)`);
  check((await noteTexts(zWo.id)).filter((t) => t.startsWith("Texted customer")).length >= 2, "…each leaving its breadcrumb on the work order");

  // P3: fires on creation; with no contact linked yet it must SKIP politely.
  const p3run = await waitRun(applied["wo_request_received"].id);
  check(!!p3run && p3run.matched === true && (p3run.results as any[])[0]?.type === "message_linked_contact",
    "P3 (request received): fired end-to-end on work-order creation");
  const zTask: any = await createRecord(Tz, "task", { title: "Z not a work order", customFields: {} });
  await sleep(1500);
  const p3taskRun = await db.automationRun.findFirst({ where: { automationId: applied["wo_request_received"].id, matched: false } });
  check(!!p3taskRun, "NEGATIVE: the record_type condition keeps other modules out (a task creation matched:false)");

  // P4: completed with a linked, emailable contact -> email sent + breadcrumb.
  await updateRecord(Tz, zWo.id, { stageKey: "completed" });
  const p4run = await waitRun(applied["wo_review_ask"].id, { matched: true });
  check(!!p4run && p4run.status === "success" && (p4run.results as any[])[0]?.status === "success", "P4 (review ask): completion emailed the customer (run green)");
  check((await noteTexts(zWo.id)).some((t) => t.startsWith("Emailed customer")), "…with its breadcrumb on the work order");

  // P5: 3-day-old untouched requests nudge the business — both the explicitly
  // first-status one AND the stage-less one (API-created records carry no stage
  // until someone moves them; the fixed condition covers both by stable key /
  // emptiness, never labels). The moved-on record must NOT match.
  const woKeyed: any = await createRecord(Tz, WORK_ORDER_RECORD_TYPE_KEY, { title: "Z keyed request", subtypeKey: "repair", stageKey: "new_request", customFields: {} });
  await linkContactToRecord(Tz, zc.id, woKeyed.id);
  await db.record.update({ where: { id: seedWo.id }, data: { createdAt: new Date(Date.now() - 4 * 86400000) } });
  await linkContactToRecord(Tz, zc.id, seedWo.id);
  await db.record.update({ where: { id: woKeyed.id }, data: { createdAt: new Date(Date.now() - 4 * 86400000) } });
  await db.record.update({ where: { id: zWo.id }, data: { createdAt: new Date(Date.now() - 4 * 86400000) } });
  await runRecordDateSweep(Tz);
  const p5jobs = await jobsFor(applied["wo_stale_request_nudge"].id);
  check(p5jobs.some((j) => j.dedupeKey.includes(woKeyed.id)),
    "P5 HALF A1: the untouched request in its first status (stable KEY match) queued the nudge");
  check(p5jobs.some((j) => j.dedupeKey.includes(seedWo.id)),
    "P5 HALF A2: the untouched STAGE-LESS request (no status yet) queued the nudge");
  check(!p5jobs.some((j) => j.dedupeKey.includes(zWo.id)),
    "P5 HALF B: the moved-on record did NOT queue (status condition excludes it)");

  // =========================================================================
  console.log("\n(6) analytics — the approved per-record visibility:");
  const trail = await noteTexts(zWo.id);
  check(trail.filter((t) => t.startsWith("Texted customer") || t.startsWith("Emailed customer")).length >= 3,
    `every customer send about the record is countable ON the record (${trail.length} activity notes) — the approved breadcrumb surface`);
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    (env as any).SMS_ENABLED = originalSms; // always restore the gate
    if (tenantIds.length) { try { await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }); } catch { /* leave for manual cleanup */ } }
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (the journey is opt-in end to end: triggers know their module, sends know their gate, skips say why, and the record remembers who was told)" : failures.length + " FAILED \u274c: " + failures.join("; ")}`);
    process.exit(failures.length === 0 ? 0 : 1);
  });
