// DEMO SEEDER — the EMERGENT-LAYER pass.
//
// THE RULE THIS FILE EXISTS TO KEEP: the seeder never inserts a Notification or
// a Suggestion row. Everything the bell shows must arrive through the SAME
// producer a live event would use, and everything the Suggestions tab shows
// must come from a real detector sweep. A path that can't produce is a bug to
// fix, not to fake.
//
// So this module: creates real tenant USERS (so emissions have recipients),
// then drives real service paths — lead capture, booking created + cancelled,
// a genuinely misconfigured automation, an import, a feedback reply, a failed
// call — spreading their timestamps so the feed reads like a week of work.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";

const db = prisma as any;
const DAY = 86400000;
const HOUR = 3600000;

export interface SeededUser { id: string; email: string; name: string; role: string }

/** 3 real users: an owner-equivalent and two staff. NO invite emails are sent —
 *  the rows are created directly, exactly as the seeder does everything else. */
export async function seedTenantUsers(tenantId: string, led: any): Promise<SeededUser[]> {
  const wanted = [
    { name: "Dana Whitfield", role: "PORTAL_ADMIN" },
    { name: "Marcus Feld", role: "CLIENT_USER" },
    { name: "Priya Raman", role: "CLIENT_USER" },
  ];
  const out: SeededUser[] = [];
  // Emails are globally unique, so the address carries the tenant: seeding a
  // SECOND tenant must give it its own people, not silently reuse the first
  // one's (which would leave the new tenant with nobody to notify — the very
  // bug this batch exists to fix).
  const suffix = tenantId.slice(-6).toLowerCase();
  for (const w of wanted) {
    const email = `${w.name.toLowerCase().replace(/[^a-z]+/g, ".")}.${suffix}@example.invalid`;
    const existing = await db.user.findFirst({ where: { email, tenantId } });
    if (existing) { out.push(existing as SeededUser); continue; }
    const u = await db.user.create({
      data: {
        email, name: w.name, role: w.role, tenantId,
        // A demo login nobody can use: the hash is not a valid bcrypt digest,
        // so password auth can never succeed for these accounts.
        passwordHash: "demo-seeded-account-no-login",
      },
    });
    led.add("user", u.id);
    out.push(u as SeededUser);
  }
  return out;
}

/**
 * Drive the REAL producer paths. Each call below is the same function the UI
 * (or a live webhook) calls; the notification is emitted by the existing
 * producer, not by us.
 */
/** Ids that appeared while the producers ran. We did NOT insert these rows —
 *  the producers and the detector sweep did — but this run caused them, so the
 *  ledger owns them and Wipe can put the tenant back exactly as it was. */
async function ledgerDownstream(tenantId: string, led: any, before: Record<string, Set<string>>): Promise<void> {
  for (const model of ["notification", "suggestion", "emailLog"] as const) {
    const now = await db[model].findMany({ where: { tenantId }, select: { id: true } });
    for (const row of now) if (!before[model].has(row.id)) led.add(model, row.id, true);
  }
}
async function snapshotDownstream(tenantId: string): Promise<Record<string, Set<string>>> {
  const out: any = {};
  for (const model of ["notification", "suggestion", "emailLog"] as const) {
    out[model] = new Set((await db[model].findMany({ where: { tenantId }, select: { id: true } })).map((x: any) => x.id));
  }
  return out;
}

export async function seedRealEvents(tenantId: string, users: SeededUser[], led: any, notes: string[], actingUserId?: string | null): Promise<Record<string, boolean>> {
  const downstreamBefore = await snapshotDownstream(tenantId);
  const fired: Record<string, boolean> = {};
  // The bus-driven producers (lead captured, booking created/cancelled) only
  // exist if the subscriber is registered. index.ts does that at boot, but the
  // registration is idempotent, so asserting it here makes the seeder
  // self-sufficient in any process that calls it.
  try { require("./notificationSubscriber").registerNotificationSubscriber(); } catch { /* already on */ }
  const { createContact, importContacts } = require("./contactService");
  const { createRecord, updateRecord } = require("./recordService");
  const { createLink } = require("./recordLinkService");
  const { listRecordTypes } = require("./recordTypeService");

  const types = await listRecordTypes(tenantId);
  const byKey: any = {};
  types.forEach((t: any) => { byKey[t.key] = t; });

  // (1) LEAD CAPTURED — a contact arriving from a form, through createContact
  //     with the source a real submission carries. The ContactCreated event is
  //     emitted by the service; notificationSubscriber turns it into the
  //     lead_captured notification.
  try {
    const c = await createContact(tenantId, {
      name: "Tessa Bright", phone: "+15550123987", email: `tessa.bright.${Date.now()}@example.invalid`,
      source: "lead_capture",
    } as any);
    led.add("contact", c.id);
    fired.lead_captured = true;
  } catch (err) { logger.error(`[seeder] lead capture: ${(err as Error).message}`); }

  // (2) BOOKING CREATED, then (3) CANCELLED — both through the record services,
  //     so BookingCreated and BookingStatusChanged fire for real.
  try {
    const bk = byKey.booking;
    if (bk) {
      const sub = ((bk.subtypes || [])[0] || {}).key;
      const stages: string[] = ((bk.recordStages || []) as any[]).map((s: any) => s.key);
      const when = new Date(Date.now() + 2 * DAY);
      when.setUTCHours(14, 0, 0, 0);
      const contact = await db.contact.findFirst({ where: { tenantId }, select: { id: true } });
      const rec = await createRecord(tenantId, "booking", {
        title: "Site visit", ...(sub ? { subtypeKey: sub } : {}),
        appointmentAt: when.toISOString(), allowClosed: true, allowOverlap: true,
      }, { source: "manual" });
      led.add("record", rec.id);
      if (contact) await createLink(tenantId, { recordId: rec.id, parentType: "contact", parentId: contact.id }); // fires BookingCreated
      fired.booking_created = true;
      const cancelKey = stages.includes("cancelled") ? "cancelled" : stages[stages.length - 1];
      await updateRecord(tenantId, rec.id, { stageKey: cancelKey, allowClosed: true, allowOverlap: true }); // fires BookingStatusChanged
      fired.booking_cancelled = true;
    }
  } catch (err) { logger.error(`[seeder] booking create/cancel: ${(err as Error).message}`); }

  // (4) AUTOMATION FAILED — a genuinely misconfigured flow (a survey step with
  //     no survey chosen), run through the engine's real manual-run path. The
  //     action fails, writeRun records a failed run, and the existing producer
  //     emits automation_failed. Nothing is faked.
  try {
    const { createAutomation } = require("./automationService");
    const { runManualAutomation } = require("../automation/engine");
    const contact = await db.contact.findFirst({ where: { tenantId, email: { not: null } }, select: { id: true } });
    if (contact) {
      const auto = await createAutomation(tenantId, {
        name: "Post-visit survey (needs attention)",
        triggerType: "Manual",
        enabled: true,
        conditions: [],
        actions: [{ type: "send_survey", config: { subject: "How did we do?" } }], // no survey selected -> fails
      } as any, users[0] ? users[0].id : null);
      led.add("automation", auto.id);
      await runManualAutomation(auto.id, contact.id, tenantId);
      fired.automation_failed = true;
    }
  } catch (err) { logger.error(`[seeder] automation failure path: ${(err as Error).message}`); }

  // (5) IMPORT COMPLETE — the real import service (which now owns the producer,
  //     so this is the same choke point the UI's import uses).
  try {
    const rows = [
      { name: "Imported One", email: `imported.one.${Date.now()}@example.invalid`, phone: "+15550771001" },
      { name: "Imported Two", email: `imported.two.${Date.now()}@example.invalid`, phone: "+15550771002" },
      { name: "Imported Three", email: `imported.three.${Date.now()}@example.invalid`, phone: "+15550771003" },
    ];
    const before = new Set((await db.contact.findMany({ where: { tenantId }, select: { id: true } })).map((x: any) => x.id));
    await importContacts(tenantId, rows as any);
    const after = await db.contact.findMany({ where: { tenantId }, select: { id: true } });
    after.forEach((x: any) => { if (!before.has(x.id)) led.add("contact", x.id); });
    fired.import_complete = true;
  } catch (err) { logger.error(`[seeder] import: ${(err as Error).message}`); }

  // (6) FEEDBACK REPLY — one seeded user raises a ticket, another replies. The
  //     reply producer notifies the AUTHOR only.
  try {
    if (users.length >= 2) {
      const { createFeedbackTicket, addFeedbackMessage } = require("./feedbackService");
      const ctxOf = (u: any, scope = "portal") => ({ scope, tenantId, actor: { id: u.id, role: u.role, tenantId: u.tenantId ?? tenantId, name: u.name, email: u.email } });
      const ticket = await createFeedbackTicket(ctxOf(users[1]), { problem: "Calendar", description: "The week view starts on the wrong day for me." });
      led.add("feedbackTicket", ticket.id);
      // WHO may reply is the app's own rule: inside a portal only OWNER /
      // SUPER_ADMIN answer someone else's ticket (feedbackService#canReply), so
      // the reply comes from a real hub account — exactly as it would live.
      // A PORTAL_ADMIN replying here would be refused, and rightly.
      // THE PERSON WHO PRESSED SEED answers it — they reached this tool through
      // the hub, so they are an OWNER/SUPER_ADMIN by construction. Falling back
      // to any hub account keeps direct calls (tests, CLI) working; a database
      // with no hub account at all simply can't drive this path, and says so
      // rather than inventing an account with hub powers.
      const acting = actingUserId
        ? await db.user.findFirst({ where: { id: actingUserId, role: { in: ["OWNER", "SUPER_ADMIN"] } }, select: { id: true, role: true, name: true, email: true, tenantId: true } })
        : null;
      const responder = acting || await db.user.findFirst({ where: { role: { in: ["OWNER", "SUPER_ADMIN"] } }, select: { id: true, role: true, name: true, email: true, tenantId: true } });
      if (responder) {
        await addFeedbackMessage(ticket.id, ctxOf(responder), { body: "Thanks \u2014 we've changed your week start in Settings." });
        fired.feedback_reply = true;
      } else {
        logger.warn("[seeder] no hub account exists to answer the demo feedback ticket \u2014 feedback_reply not driven (the ticket itself is still there)");
      }
    }
  } catch (err) { logger.error(`[seeder] feedback reply: ${(err as Error).message}`); }

  // (7) MISSED / FAILED CALL — the orchestrator's real abnormal-end path.
  try {
    const { failCall } = require("./callOrchestrator");
    const call = await db.callSession.findFirst({ where: { tenantId }, select: { callSid: true } });
    if (call) { await failCall(call.callSid, "no-answer"); fired.call_missed_or_failed = true; }
  } catch (err) { logger.error(`[seeder] failed call: ${(err as Error).message}`); }

  // Spread the emitted notifications across recent days, and leave the older
  // half already read, so the feed shows a plausible mix rather than a wall of
  // identical timestamps. (Read state is per user and set here directly on the
  // rows the PRODUCERS created — no row is invented.)
  // The bus dispatches subscribers on setImmediate AFTER its caller returned,
  // so give the last emissions a moment to land before spreading timestamps.
  await new Promise((res) => setTimeout(res, 600));
  const emitted = await db.notification.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, category: true, title: true, link: true } });
  // Spread by EVENT, not by row: one thing happened at one moment, and the
  // three people who were told about it were told at the same time. (Read state
  // still varies per person — that's the point of per-user read state.)
  const groups = new Map<string, any[]>();
  for (const n of emitted) {
    const key = `${n.category}|${n.title}|${n.link || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }
  const keys = Array.from(groups.keys());
  let g = 0;
  for (const key of keys) {
    const rows = groups.get(key)!;
    const age = (keys.length - g) * 8 * HOUR + (g % 3) * HOUR;
    const when = new Date(Date.now() - age);
    let k = 0;
    for (const n of rows) {
      // Older events are mostly read; the newest are not. Within one event,
      // one recipient lags behind the others — a real inbox, not a uniform one.
      const isRead = g < Math.floor(keys.length / 2) && k < rows.length - 1;
      await db.notification.update({
        where: { id: n.id },
        data: { createdAt: when, ...(isRead ? { readAt: new Date(when.getTime() + 2 * HOUR) } : {}) },
      });
      k += 1;
    }
    g += 1;
  }
  await ledgerDownstream(tenantId, led, downstreamBefore);
  notes.push(`real producer paths driven: ${Object.keys(fired).filter((k) => fired[k]).join(", ") || "none"} (${emitted.length} notification rows, all emitted by producers)`);
  return fired;
}

/**
 * AGE a seeded tenant past the unused-module detector's 30-day floor.
 *
 * GUARD (the owner's amendment): this refuses unless the tenant has a
 * DemoSeedRun ledger row — i.e. unless the seeder itself created that data.
 * A tenant nobody seeded can never be aged by this function, and the change
 * is recorded on the run so it is visible afterwards.
 */
export async function ageSeededTenant(tenantId: string, runId: string, days = 200): Promise<boolean> {
  const run = await db.demoSeedRun.findFirst({ where: { id: runId, tenantId } });
  if (!run) {
    logger.warn(`[seeder] refusing to age tenant ${tenantId}: no seed-run ledger for it`);
    return false;
  }
  const agedTo = new Date(Date.now() - days * DAY);
  await db.tenant.update({ where: { id: tenantId }, data: { createdAt: agedTo } });
  await db.demoSeedRun.update({ where: { id: run.id }, data: { counts: { ...(run.counts || {}), __agedTenantTo: agedTo.toISOString() } } });
  return true;
}
