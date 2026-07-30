// DEMO DATA SEEDER — the RECRUITMENT MARKETING profile.
//
// Same rules as the field-services profile (see demoSeeder.ts): everything is
// created through the real services, every id goes into the run ledger, comms
// are mock LOG ROWS only, and nothing is transmitted.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";

const db = prisma as any;
const DAY = 86400000;

const RM_CAPS = { candidates: 60, jobOpenings: 8, interviews: 25, calls: 15, comms: 20 };

// A realistic funnel: most people arrive and stall early; a few get hired.
const STAGE_WEIGHTS: Array<[string, number]> = [
  ["New lead", 0.34], ["Contacted", 0.2], ["Prescreened", 0.14], ["Interview scheduled", 0.12],
  ["Interviewed", 0.1], ["Submitted to client", 0.06], ["Hired", 0.03], ["Not a fit", 0.01],
];
// Paid channels dominate; referral and organic are the thin tail.
const SOURCE_WEIGHTS: Array<[string, number]> = [
  ["Indeed", 0.34], ["Facebook", 0.28], ["Google", 0.16], ["LinkedIn", 0.1], ["Referral", 0.07], ["Organic", 0.04], ["Other", 0.01],
];
function weighted(r: () => number, table: Array<[string, number]>): string {
  let x = r();
  for (const [value, w] of table) { if (x < w) return value; x -= w; }
  return table[0][0];
}

/** Turn a weight table into EXACT counts for n items (largest-remainder), so the shape is a
 *  guarantee instead of a likelihood.
 *
 *  Why this exists: the candidate stages used to be n independent weighted() draws. Over 60
 *  candidates the adjacent, similarly-weighted middle stages (Contacted .20, Prescreened .14,
 *  Interview scheduled .12) reorder often enough that roughly 1 seed in 125 produced demo
 *  data where "Interview scheduled" outnumbered "New lead" - which is not a funnel, and is
 *  not what this file's own summary line promises the owner. The weights were always the
 *  intent; allocating them as counts makes the intent true every time, for every demo
 *  tenant, not just in the test. At n = 60 this yields 20 / 12 / 8 / 7 / 6 / 4 / 2 / 1. */
function quotaBag(table: Array<[string, number]>, n: number): string[] {
  const rows = table.map(([value, w]) => ({ value, exact: w * n, count: Math.floor(w * n) }));
  let short = n - rows.reduce((sum, x) => sum + x.count, 0);
  const byRemainder = rows.slice().sort((a, b) => (b.exact - b.count) - (a.exact - a.count));
  for (let i = 0; short > 0; i++, short--) byRemainder[i % byRemainder.length].count++;
  const bag: string[] = [];
  for (const x of rows) for (let i = 0; i < x.count; i++) bag.push(x.value);
  return bag;
}
/** Draw one item out of a quota bag, consuming EXACTLY ONE random value - the same budget
 *  weighted() spent - so every downstream value in this seeder's sequence is unchanged. */
function takeOne(r: () => number, bag: string[], fallback: Array<[string, number]>): string {
  if (!bag.length) return weighted(r, fallback);
  return bag.splice(Math.floor(r() * bag.length), 1)[0];
}

const ROLES = ["Warehouse operative", "Class 2 driver", "Forklift operator", "Picker/packer", "Night-shift loader", "Production assistant", "Cleaning supervisor", "Delivery driver"];
const DEPTS = ["Logistics", "Production", "Facilities", "Transport"];
const CLIENTS = ["Northgate Foods", "Halloway Logistics", "Brightline Manufacturing", "Cedarworks Ltd"];
const CAMPAIGNS = ["Spring drivers push", "Warehouse always-on", "Night shift boost", "Referral drive"];
const FIRST = ["Avery", "Sam", "Kai", "Rowan", "Jules", "Morgan", "Devon", "Quinn", "Emerson", "Harper", "Reese", "Finley", "Marlowe", "Tatum", "Sasha", "Noor"];
const LAST = ["Lane", "Reyes", "Moss", "Okafor", "Delgado", "Nakamura", "Bishop", "Farrow", "Kowalski", "Ellery", "Vance", "Ibrahim"];

export async function seedRecruitmentMarketing(tenantId: string, r: () => number, led: any, notes: string[]): Promise<void> {
  const { createContact } = require("./contactService");
  const { createRecord } = require("./recordService");
  const { createLink } = require("./recordLinkService");
  const { listRecordTypes } = require("./recordTypeService");

  const types = await listRecordTypes(tenantId);
  const byKey: any = {};
  types.forEach((t: any) => { byKey[t.key] = t; });
  const job = byKey.job;
  const jobSub = (((job && job.subtypes) || [])[0] || {}).key || null;
  const booking = byKey.booking;
  // Bookings require a subtype (recordTypeService validates it), so take the
  // module's own first subtype rather than assuming a name.
  const bkSub = (((booking && booking.subtypes) || [])[0] || {}).key || null;
  const bkStages: string[] = (((booking && booking.recordStages) || []) as any[]).map((s: any) => s.key);
  const BS = (k: string) => (bkStages.includes(k) ? k : bkStages[0]);

  // --- job openings ---
  const jobs: any[] = [];
  for (let i = 0; i < RM_CAPS.jobOpenings; i++) {
    const role = ROLES[i % ROLES.length];
    const j = await createRecord(tenantId, "job", {
      title: role,
      ...(jobSub ? { subtypeKey: jobSub } : {}),
      customFields: {
        department: DEPTS[Math.floor(r() * DEPTS.length)],
        location: ["Leeds", "Sheffield", "Doncaster", "Wakefield"][Math.floor(r() * 4)],
        work_mode: "On-site",
        employment_type: r() < 0.6 ? "Full-time" : "Temp",
        pay_range: `\u00a3${11 + Math.floor(r() * 4)}\u2013\u00a3${15 + Math.floor(r() * 5)} per hour`,
        openings_count: 1 + Math.floor(r() * 4),
        client_or_hiring_manager: CLIENTS[Math.floor(r() * CLIENTS.length)],
        ad_campaign: CAMPAIGNS[Math.floor(r() * CAMPAIGNS.length)],
        target_start: new Date(Date.now() + Math.floor(r() * 40) * DAY).toISOString().slice(0, 10),
      },
    }, { source: "manual" });
    led.add("record", j.id); jobs.push(j);
    try { await db.record.update({ where: { id: j.id }, data: { createdAt: new Date(Date.now() - Math.floor(r() * 80) * DAY) } }); } catch { /* */ }
  }

  // --- candidates, spread over 90 days, funnel-shaped ---
  // The stages are allocated as exact quotas up front and then drawn at random from that
  // bag, so WHICH candidate lands in which stage still varies with the seed, but the SHAPE
  // does not. Sources stay independently weighted: their assertion has a wide margin
  // (paid .78 vs referral+organic .11) and a bit of jitter there reads as more lifelike.
  const stageBag = quotaBag(STAGE_WEIGHTS, RM_CAPS.candidates);
  const candidates: any[] = [];
  for (let i = 0; i < RM_CAPS.candidates; i++) {
    const name = `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
    const stage = takeOne(r, stageBag, STAGE_WEIGHTS);
    const source = weighted(r, SOURCE_WEIGHTS);
    const c = await createContact(tenantId, {
      name,
      phone: `+1555${String(Math.floor(1000000 + r() * 8999999)).slice(0, 7)}`,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.${Math.floor(r() * 9000 + 1000)}@example.invalid`,
      source: r() < 0.7 ? "lead_capture" : "manual",
      customFields: {
        candidate_source: source,
        candidate_stage: stage,
        role_interest: ROLES[Math.floor(r() * ROLES.length)],
        desired_pay: `\u00a3${12 + Math.floor(r() * 5)} per hour`,
        availability_date: new Date(Date.now() + Math.floor(r() * 30) * DAY).toISOString().slice(0, 10),
        prescreen_checks: r() < 0.4 ? ["Eligible to work", "Experience verified"] : [],
      },
    } as any);
    led.add("contact", c.id); candidates.push(c);
    try { await db.contact.update({ where: { id: c.id }, data: { createdAt: new Date(Date.now() - Math.floor(r() * 90) * DAY) } }); } catch { /* */ }
  }
  notes.push(`${RM_CAPS.candidates} candidates in a funnel shape (heaviest at New lead), sources weighted to Indeed/Facebook`);

  // --- interviews (the relabeled bookings), past and future, some cancelled ---
  for (let i = 0; i < RM_CAPS.interviews; i++) {
    const past = i < Math.floor(RM_CAPS.interviews * 0.6);
    const when = new Date(Date.now() + (past ? -Math.floor(r() * 60) : Math.floor(r() * 21)) * DAY);
    when.setUTCHours(10 + Math.floor(r() * 6), r() < 0.5 ? 0 : 30, 0, 0);
    const stage = past ? (r() < 0.72 ? BS("completed") : r() < 0.86 ? BS("no_show") : BS("cancelled")) : BS("confirmed");
    const iv = await createRecord(tenantId, "booking", {
      title: `Interview \u2014 ${ROLES[Math.floor(r() * ROLES.length)]}`,
      ...(bkSub ? { subtypeKey: bkSub } : {}),
      stageKey: stage,
      appointmentAt: when.toISOString(),
      allowClosed: true, allowOverlap: true,
    }, { source: "manual" });
    led.add("record", iv.id);
    const cand = candidates[Math.floor(r() * candidates.length)];
    await createLink(tenantId, { recordId: iv.id, parentType: "contact", parentId: cand.id }).catch(() => { /* */ });
    try { await db.record.update({ where: { id: iv.id }, data: { createdAt: new Date(when.getTime() - 3 * DAY) } }); } catch { /* */ }
  }

  // --- comms: mock LOG ROWS only ---
  for (let i = 0; i < RM_CAPS.comms; i++) {
    const c = candidates[Math.floor(r() * candidates.length)];
    const row = await db.emailLog.create({
      data: {
        tenantId, type: "single", status: "mock", toEmail: c.email, toName: c.name,
        subject: ["Thanks for your interest", "Your interview is booked", "Quick update on your application"][Math.floor(r() * 3)],
        contactId: c.id, createdAt: new Date(Date.now() - Math.floor(r() * 60) * DAY),
      },
    });
    led.add("emailLog", row.id);
  }

  // --- simulated calls (transport-free; their own rows land in the ledger) ---
  const { runSimulatedCall } = require("./simulationService");
  const snap = async () => ({
    contact: new Set((await db.contact.findMany({ where: { tenantId }, select: { id: true } })).map((x: any) => x.id)),
    record: new Set((await db.record.findMany({ where: { tenantId }, select: { id: true } })).map((x: any) => x.id)),
    emailLog: new Set((await db.emailLog.findMany({ where: { tenantId }, select: { id: true } })).map((x: any) => x.id)),
  });
  const before = await snap();
  for (let i = 0; i < RM_CAPS.calls; i++) {
    try {
      const call = await runSimulatedCall(tenantId, null);
      led.add("callSession", call.id, true);
      try { await db.callSession.update({ where: { id: call.id }, data: { createdAt: new Date(Date.now() - Math.floor(r() * 60) * DAY) } }); } catch { /* */ }
    } catch (err) { logger.error(`[seeder] simulated call: ${(err as Error).message}`); }
  }
  const after = await snap();
  for (const model of ["contact", "record", "emailLog"] as const) {
    for (const id of after[model]) if (!before[model].has(id)) led.add(model, id as string, true);
  }
}

export const RM_PROFILE_CAPS = RM_CAPS;
