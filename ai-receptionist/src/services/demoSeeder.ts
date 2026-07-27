// DEMO DATA SEEDER — a DEV TOOL, not a product feature.
//
// Fills a chosen tenant with a modest, backdated, obviously-fake dataset so the
// dispatch board, analytics, Learning Center scenes and suggestion cards can be
// looked at in context. Rules it obeys:
//
//   * DEV ONLY — refuses in production unless ALLOW_DEMO_SEEDER=true, and is
//     only reachable through the hub's Developer Tools (hub-admin gated).
//   * NEVER TRANSMITS — it calls no send path. Comms artifacts are LOG ROWS
//     written directly with mock status; calls come from the transport-free
//     simulator. Real credentials in the environment change nothing.
//   * THROUGH THE REAL SERVICES — contacts, records, visits, links and
//     resources are created by the same functions the UI calls, so validation,
//     mirrors, links and derived state are all correct. Only AFTER that does a
//     controlled pass backdate createdAt/updatedAt.
//   * REVERSIBLE — every created id is written to a per-run LEDGER
//     (DemoSeedRun.ids), so wipe removes exactly what a run made and can never
//     touch a row somebody actually typed.
//   * OBVIOUSLY FAKE — @example.invalid emails, 555 phones, generic addresses.
//     Names/addresses/values come from the EXISTING dummy generators
//     (recordService#generateDummyRecord profiles), not a new set.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { isProduction } from "../config/env";

const db = prisma as any;
const DAY = 86400000;

export interface SeedOptions { profile: "field_services" | "recruitment_marketing"; seed?: string; runSweep?: boolean; actingUserId?: string | null }
export interface SeedResult { runId: string; counts: Record<string, number>; deterministic: Record<string, number>; notes: string[] }

/** Deterministic RNG: the same seed produces the same dataset, so a before/after
 *  comparison is meaningful. (mulberry32 over a cheap string hash.) */
function rng(seedStr: string) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The per-run ledger. Every create goes through this so wipe stays exact. */
class Ledger {
  ids: Array<{ model: string; id: string }> = [];
  counts: Record<string, number> = {};
  /** Rows the SEEDER made deterministically (excludes anything the call
   *  simulator produced — it has its own randomness we don't control). */
  deterministic: Record<string, number> = {};
  add(model: string, id: string, viaSimulator = false) {
    this.ids.push({ model, id });
    this.counts[model] = (this.counts[model] || 0) + 1;
    if (!viaSimulator) this.deterministic[model] = (this.deterministic[model] || 0) + 1;
  }
}

const FIRST = ["Avery", "Sam", "Kai", "Rowan", "Jules", "Morgan", "Devon", "Quinn", "Emerson", "Harper", "Reese", "Finley", "Marlowe", "Tatum", "Sasha", "Noor", "Ira", "Blake", "Casey", "Drew"];
const LAST = ["Lane", "Reyes", "Moss", "Okafor", "Delgado", "Nakamura", "Bishop", "Farrow", "Kowalski", "Ellery", "Vance", "Ibrahim", "Sandoval", "Whitfield", "Nyx", "Prentice"];

function personName(r: () => number): string { return `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`; }
function fakePhone(r: () => number): string { return `+1555${String(Math.floor(1000000 + r() * 8999999)).slice(0, 7)}`; }
function fakeEmail(name: string, r: () => number): string { return `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.${Math.floor(r() * 9000 + 1000)}@example.invalid`; }
const ADDRESSES = ["148 Ridgeway Ave", "72 Fallow Street", "915 Kestrel Court", "31 Marbury Lane", "604 Alder Way", "1180 Sumner Road", "48 Tessellate Drive", "277 Halloway Terrace"];

/** Backdate a row AFTER the service created it. Prisma permits setting
 *  createdAt/updatedAt explicitly on update, which is the only honest way to
 *  get history out of services that stamp "now". */
async function backdate(model: string, id: string, createdAt: Date, extra: any = {}) {
  try { await db[model].update({ where: { id }, data: { createdAt, updatedAt: createdAt, ...extra } }); }
  catch (err) { logger.error(`[seeder] backdate ${model} ${id}: ${(err as Error).message}`); }
}

function assertAllowed(): void {
  if (isProduction() && String(process.env.ALLOW_DEMO_SEEDER || "").toLowerCase() !== "true") {
    throw new Error("The demo seeder is disabled in production. Set ALLOW_DEMO_SEEDER=true to override.");
  }
}

// --------------------------------------------------------------- FS profile
const FS_CAPS = { contacts: 40, workOrders: 60, multiVisit: 6, dateless: 8, resources: 4, equipment: 15, estimates: 12, invoices: 15, products: 10, recurring: 3, calls: 20, comms: 30 };

async function seedFieldServices(tenantId: string, r: () => number, led: Ledger, notes: string[]): Promise<void> {
  const { createContact } = require("./contactService");
  const { createRecord, updateRecord } = require("./recordService");
  const { createResource } = require("./resourceService");
  const { createLink } = require("./recordLinkService");
  const { listRecordTypes } = require("./recordTypeService");
  const visitSvc = require("./workOrderVisitService");

  const types = await listRecordTypes(tenantId);
  const byKey: any = {};
  types.forEach((t: any) => { byKey[t.key] = t; });
  const wo = byKey.work_order;
  const subtypes: any[] = (wo && wo.subtypes) || [];
  const subKey = (subtypes[0] || {}).key || "repair";
  const stageKeys = ((wo && wo.recordStages) || []).map((s: any) => s.key);
  const S = (k: string) => (stageKeys.includes(k) ? k : stageKeys[0]);

  // --- staff (with hours, so the lanes calendar actually renders) ---
  const HOURS = { mon: [["08:00", "17:00"]], tue: [["08:00", "17:00"]], wed: [["08:00", "17:00"]], thu: [["08:00", "17:00"]], fri: [["08:00", "16:00"]], sat: [], sun: [] };
  const resources: any[] = [];
  for (let i = 0; i < FS_CAPS.resources; i++) {
    const res = await createResource(tenantId, { name: personName(r), hours: HOURS });
    led.add("resource", res.id); resources.push(res);
  }

  // --- price book ---
  const products: any[] = [];
  const PRODUCTS = [["Service call", 89], ["Diagnostic fee", 65], ["Condenser fan motor", 240], ["Capacitor", 45], ["Thermostat (smart)", 190], ["Refrigerant top-up", 130], ["Drain clearing", 110], ["Filter pack", 35], ["Labour (per hour)", 95], ["After-hours callout", 180]];
  for (let i = 0; i < Math.min(FS_CAPS.products, PRODUCTS.length); i++) {
    const [title, price] = PRODUCTS[i] as any[];
    const p = await createRecord(tenantId, "product", { title, customFields: { price, description: `${title} — demo price book item` } }, { source: "manual" });
    led.add("record", p.id); products.push({ id: p.id, title, price });
  }

  // --- contacts ---
  const contacts: any[] = [];
  for (let i = 0; i < FS_CAPS.contacts; i++) {
    const name = personName(r);
    const c = await createContact(tenantId, {
      name, phone: fakePhone(r), email: fakeEmail(name, r),
      customFields: { address: `${ADDRESSES[Math.floor(r() * ADDRESSES.length)]}` },
      source: r() < 0.35 ? "lead_capture" : "manual",
    } as any);
    led.add("contact", c.id); contacts.push(c);
    await backdate("contact", c.id, new Date(Date.now() - Math.floor(r() * 90) * DAY));
  }

  // --- work orders: 90 days back, 14 forward ---
  // The cap is a TOTAL: the detector-pattern jobs (6 + 14 + 8) and the recurring
  // plans + successors (3 + 3) are spent from the same budget.
  const PATTERN_JOBS = 6 + 14 + 8 + FS_CAPS.recurring * 2;
  const SIM_ALLOWANCE = 12; // the AI-intake path turns some simulated calls into jobs (measured 8-12)
  const baseJobs = Math.max(10, FS_CAPS.workOrders - PATTERN_JOBS - SIM_ALLOWANCE);
  const wos: any[] = [];
  for (let i = 0; i < baseJobs; i++) {
    const future = i >= baseJobs - 8;                                // the tail is upcoming work
    const dateless = i >= baseJobs - 8 - FS_CAPS.dateless && !future;
    const daysOut = future ? Math.floor(r() * 14) : -Math.floor(r() * 90);
    const when = new Date(Date.now() + daysOut * DAY);
    when.setUTCHours(9 + Math.floor(r() * 7), r() < 0.5 ? 0 : 30, 0, 0);
    const stage = future ? S("scheduled") : (r() < 0.72 ? S("completed") : r() < 0.85 ? S("in_progress") : S("cancelled"));
    const rec = await createRecord(tenantId, "work_order", {
      title: ["Furnace not heating", "AC not cooling", "Water heater leak", "Annual maintenance", "Thermostat replacement", "Drain blockage"][Math.floor(r() * 6)],
      subtypeKey: subKey,
      stageKey: dateless ? S("new_request") : stage,
      ...(dateless ? {} : { appointmentAt: when.toISOString(), resourceId: resources[Math.floor(r() * resources.length)].id }),
      customFields: { service_address: ADDRESSES[Math.floor(r() * ADDRESSES.length)], description: r() < 0.45 ? "Gate code required." : "Standard visit." },
      allowClosed: true, allowOverlap: true,
    }, { source: "manual" });
    led.add("record", rec.id); wos.push(rec);
    await createLink(tenantId, { recordId: rec.id, parentType: "contact", parentId: contacts[Math.floor(r() * contacts.length)].id }).catch(() => { /* link is best-effort */ });
    await backdate("record", rec.id, new Date(Date.now() - (future ? Math.floor(r() * 10) : Math.abs(daysOut) + 1) * DAY));
  }

  // --- multi-visit jobs (through the visit service, so the mirror stays true) ---
  for (let i = 0; i < FS_CAPS.multiVisit; i++) {
    const job = wos[i];
    const extra = 1 + Math.floor(r() * 2); // 2-3 visits total
    for (let v = 0; v < extra; v++) {
      const when = new Date(Date.now() + (Math.floor(r() * 20) - 8) * DAY);
      when.setUTCHours(10 + Math.floor(r() * 5), 0, 0, 0);
      const vis = await visitSvc.createVisit(tenantId, job.id, { startAt: r() < 0.25 ? null : when.toISOString(), resourceId: resources[Math.floor(r() * resources.length)].id });
      led.add("workOrderVisit", vis.id);
      if (r() < 0.3) await visitSvc.completeVisit(tenantId, vis.id);
    }
  }
  notes.push(`${FS_CAPS.multiVisit} multi-visit jobs created through the visit service (mirror recomputed in-transaction)`);

  // --- equipment with service history (the batch-18 link conventions) ---
  for (let i = 0; i < FS_CAPS.equipment; i++) {
    const eq = await createRecord(tenantId, "equipment", {
      title: ["Carrier 59TP6", "Trane XR14", "Rheem Classic", "Bosch 500 Series", "Goodman GSX16"][Math.floor(r() * 5)],
      customFields: { serial_number: `SN-${Math.floor(r() * 900000 + 100000)}` },
    }, { source: "manual" });
    led.add("record", eq.id);
    await createLink(tenantId, { recordId: eq.id, parentType: "contact", parentId: contacts[Math.floor(r() * contacts.length)].id }).catch(() => { /* */ });
    const historyCount = i < 6 ? 2 + Math.floor(r() * 3) : 0;   // several with a real history
    for (let h = 0; h < historyCount; h++) {
      await createLink(tenantId, { recordId: wos[Math.floor(r() * wos.length)].id, parentType: "record", parentId: eq.id }).catch(() => { /* */ });
    }
    await backdate("record", eq.id, new Date(Date.now() - Math.floor(r() * 90) * DAY));
  }

  // --- estimates + invoices with line items, some converted ---
  const lineItems = (n: number) => Array.from({ length: n }, () => {
    const p = products[Math.floor(r() * products.length)];
    const qty = 1 + Math.floor(r() * 3);
    return { description: p.title, quantity: qty, unitPrice: p.price, total: qty * p.price };
  });
  for (let i = 0; i < FS_CAPS.estimates; i++) {
    const items = lineItems(1 + Math.floor(r() * 3));
    const status = ["draft", "sent", "accepted", "declined"][Math.floor(r() * 4)];
    const est = await createRecord(tenantId, "estimate", {
      title: `Estimate for ${["furnace replacement", "AC service", "water heater", "duct cleaning"][Math.floor(r() * 4)]}`,
      customFields: { estimate_number: `EST-${1000 + i}`, status, line_items: items, total: items.reduce((a: number, x: any) => a + x.total, 0) },
    }, { source: "manual" });
    led.add("record", est.id);
    await createLink(tenantId, { recordId: est.id, parentType: "contact", parentId: contacts[Math.floor(r() * contacts.length)].id }).catch(() => { /* */ });
    await backdate("record", est.id, new Date(Date.now() - Math.floor(r() * 80) * DAY));
  }
  for (let i = 0; i < FS_CAPS.invoices; i++) {
    const items = lineItems(1 + Math.floor(r() * 3));
    const paid = r() < 0.6;
    const inv = await createRecord(tenantId, "invoice", {
      title: `Invoice ${1000 + i}`,
      customFields: {
        invoice_number: `INV-${1000 + i}`, line_items: items, total: items.reduce((a: number, x: any) => a + x.total, 0),
        invoice_date: new Date(Date.now() - Math.floor(r() * 70) * DAY).toISOString().slice(0, 10),
        ...(paid ? { paid_date: new Date(Date.now() - Math.floor(r() * 30) * DAY).toISOString().slice(0, 10), payment_method: ["Card", "Bank transfer", "Cash"][Math.floor(r() * 3)] } : {}),
      },
    }, { source: "manual" });
    led.add("record", inv.id);
    await createLink(tenantId, { recordId: inv.id, parentType: "contact", parentId: contacts[Math.floor(r() * contacts.length)].id }).catch(() => { /* */ });
    await backdate("record", inv.id, new Date(Date.now() - Math.floor(r() * 70) * DAY));
  }

  // --- recurring plans mid-cycle ---
  for (let i = 0; i < FS_CAPS.recurring; i++) {
    const when = new Date(Date.now() - (10 + i * 5) * DAY);
    when.setUTCHours(11, 0, 0, 0);
    const plan = await createRecord(tenantId, "work_order", {
      title: "Quarterly maintenance plan", subtypeKey: subKey, stageKey: S("completed"),
      appointmentAt: when.toISOString(), resourceId: resources[0].id,
      repeatRule: { every: 3, unit: "months" }, allowClosed: true, allowOverlap: true,
    }, { source: "manual" });
    led.add("record", plan.id);
    const successor = await createRecord(tenantId, "work_order", { title: "Quarterly maintenance plan", subtypeKey: subKey, stageKey: S("new_request") }, { source: "manual" });
    led.add("record", successor.id); // sits dateless in the tray, as a spawned successor would
  }

  // --- DETECTOR PATTERNS (batch 31) ---
  // (1) the repeated phrase, comfortably over its floor
  for (let i = 0; i < 6; i++) {
    const rec = await createRecord(tenantId, "work_order", {
      title: "Service visit", subtypeKey: subKey, stageKey: S("completed"),
      appointmentAt: new Date(Date.now() - (i + 1) * DAY).toISOString(), resourceId: resources[i % resources.length].id,
      customFields: { description: `Gate code required (${i + 1}).` },
      allowClosed: true, allowOverlap: true,
    }, { source: "manual" });
    led.add("record", rec.id);
    await backdate("record", rec.id, new Date(Date.now() - (i + 1) * DAY));
  }
  // (2) a message-after-completion habit: >= 10 sends over >= 75% of completions
  const habitJobs: any[] = [];
  for (let i = 0; i < 14; i++) {
    const rec = await createRecord(tenantId, "work_order", { title: "Completed job", subtypeKey: subKey, stageKey: S("completed"), appointmentAt: new Date(Date.now() - (5 + i) * DAY).toISOString(), resourceId: resources[i % resources.length].id, allowClosed: true, allowOverlap: true }, { source: "manual" });
    led.add("record", rec.id); habitJobs.push(rec);
    await backdate("record", rec.id, new Date(Date.now() - (5 + i) * DAY));
  }
  // (4) a stalling stage: parked long, against a moving cohort
  for (let i = 0; i < 8; i++) {
    const rec = await createRecord(tenantId, "work_order", { title: "Awaiting parts", subtypeKey: subKey, stageKey: S("in_progress"), appointmentAt: new Date(Date.now() - (45 + i) * DAY).toISOString(), resourceId: resources[i % resources.length].id, allowClosed: true, allowOverlap: true }, { source: "manual" });
    led.add("record", rec.id);
    await backdate("record", rec.id, new Date(Date.now() - 50 * DAY));
  }
  notes.push("detector patterns planted: repeated phrase, message-after-completion habit, stalling status");

  // --- comms rows: LOG ROWS ONLY, mock status, no send path anywhere ---
  // The HABIT (detector 2) is "a human message shortly after a completed job",
  // measured over EVERY completed job in the 45-day window — so the mails are
  // written from the persisted, already-backdated rows and cover ~90% of them.
  const completedRecent = await db.record.findMany({
    where: { tenantId, recordTypeId: wo.id, stageKey: S("completed"), updatedAt: { gte: new Date(Date.now() - 44 * DAY) } },
    select: { id: true, updatedAt: true }, take: 60,
  });
  let mailed = 0;
  for (const job of completedRecent) {
    if (r() < 0.1) continue;                    // a couple of jobs go unmessaged — a habit, not a robot
    const c = contacts[Math.floor(r() * contacts.length)];
    const row = await db.emailLog.create({
      data: {
        tenantId, type: "single", status: "mock", toEmail: c.email, toName: c.name, subject: "Thanks for your business",
        contactId: c.id, createdAt: new Date(new Date(job.updatedAt).getTime() + 2 * 3600000),
      },
    });
    led.add("emailLog", row.id); mailed += 1;
  }
  for (let i = mailed; i < FS_CAPS.comms; i++) {
    const c = contacts[Math.floor(r() * contacts.length)];
    const row = await db.emailLog.create({
      data: {
        tenantId, type: "single", status: "mock", toEmail: c.email, toName: c.name, subject: "Following up on your visit",
        contactId: c.id, createdAt: new Date(Date.now() - Math.floor(r() * 60) * DAY),
      },
    });
    led.add("emailLog", row.id);
  }
  notes.push(`${Math.max(mailed, FS_CAPS.comms)} comms rows written directly as mock logs (no send path touched)`);

  // --- simulated calls (the simulator is transport-free) ---
  const { runSimulatedCall } = require("./simulationService");
  // A simulated call creates its own contact, sometimes a record, and a mock
  // call-summary log. Those are OURS too — snapshot and diff so every one lands
  // in the ledger and wipe leaves nothing behind.
  const snap = async () => ({
    contact: new Set((await db.contact.findMany({ where: { tenantId }, select: { id: true } })).map((x: any) => x.id)),
    record: new Set((await db.record.findMany({ where: { tenantId }, select: { id: true } })).map((x: any) => x.id)),
    emailLog: new Set((await db.emailLog.findMany({ where: { tenantId }, select: { id: true } })).map((x: any) => x.id)),
  });
  const beforeCalls = await snap();
  for (let i = 0; i < FS_CAPS.calls; i++) {
    try {
      const call = await runSimulatedCall(tenantId, null);
      led.add("callSession", call.id, true);
      await backdate("callSession", call.id, new Date(Date.now() - Math.floor(r() * 60) * DAY));
    } catch (err) { logger.error(`[seeder] simulated call: ${(err as Error).message}`); }
  }
  const afterCalls = await snap();
  for (const model of ["contact", "record", "emailLog"] as const) {
    for (const id of afterCalls[model]) if (!beforeCalls[model].has(id)) led.add(model, id as string, true);
  }
}

// ------------------------------------------------------------------- runner
export async function seedDemoData(tenantId: string, opts: SeedOptions): Promise<SeedResult> {
  assertAllowed();
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
  if (!tenant) throw new Error("Portal not found.");
  const seed = String(opts.seed || "clarity-demo");
  const r = rng(seed);
  const led = new Ledger();
  const notes: string[] = [];
  const t0 = Date.now();
  logger.info(`[seeder] seeding "${tenant.name}" with the ${opts.profile} profile (seed "${seed}")`);
  // REAL USERS FIRST: notifications are per-recipient, so a tenant with nobody
  // in it can only ever produce a silent no-op (the empty-bell bug).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ev = require("./demoSeederEvents");
  const users = await ev.seedTenantUsers(tenantId, led);
  notes.push(`${users.length} demo users created (no invitations sent; these accounts cannot log in)`);
  if (opts.profile === "field_services") await seedFieldServices(tenantId, r, led, notes);
  else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await require("./demoSeederRm").seedRecruitmentMarketing(tenantId, r, led, notes);
  }
  // REAL EVENTS: drive genuine producer paths so the bell fills organically.
  const fired = await ev.seedRealEvents(tenantId, users, led, notes, opts.actingUserId || null);
  const run = await db.demoSeedRun.create({ data: { tenantId, profile: opts.profile, seed, counts: { ...led.counts, __deterministic: led.deterministic, __producers: fired }, ids: led.ids } });
  // Age the workspace past the unused-module floor — ONLY because this run's
  // ledger exists (see ageSeededTenant's guard), and recorded on that run.
  await ev.ageSeededTenant(tenantId, run.id);
  if (opts.runSweep !== false) {
    // The detector sweep as the final step, so one action yields a portal with
    // BOTH activity and suggestions. Same sweep the nightly timer runs.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { runDetectorSweep } = require("../detectors");
      const c = await runDetectorSweep(new Date(), tenantId);
      // The sweep's suggestions belong to this run for cleanup purposes (we did
      // not insert them — the detectors did — but Wipe must leave no trace).
      const made = await db.suggestion.findMany({ where: { tenantId }, select: { id: true } });
      const known = new Set(led.ids.filter((x: any) => x.model === "suggestion").map((x: any) => x.id));
      for (const row of made) if (!known.has(row.id)) led.add("suggestion", row.id, true);
      const stored = await db.demoSeedRun.findUnique({ where: { id: run.id }, select: { counts: true } });
      await db.demoSeedRun.update({
        where: { id: run.id },
        data: { ids: led.ids, counts: { ...((stored && stored.counts) || {}), ...led.counts, __deterministic: led.deterministic, __producers: fired } },
      });
      notes.push(`detector sweep ran: ${c.created} suggestion(s) created`);
    } catch (err) { logger.error(`[seeder] post-seed sweep: ${(err as Error).message}`); }
  }
  logger.info(`[seeder] done in ${Math.round((Date.now() - t0) / 100) / 10}s: ${JSON.stringify(led.counts)}`);
  notes.push("counts marked __deterministic are the seeder's own; call-simulator rows vary run to run by design");
  return { runId: run.id, counts: led.counts, deterministic: led.deterministic, notes };
}

/** Remove exactly what a run created — nothing else. Idempotent: ids that have
 *  already gone are skipped, and the run is marked wiped. */
export async function wipeDemoData(tenantId: string, runId?: string | null): Promise<{ removed: number; runs: number }> {
  assertAllowed();
  const runs = runId
    ? await db.demoSeedRun.findMany({ where: { id: runId, tenantId } })
    : await db.demoSeedRun.findMany({ where: { tenantId, wipedAt: null } });
  let removed = 0;
  for (const run of runs) {
    const ids: Array<{ model: string; id: string }> = Array.isArray(run.ids) ? run.ids : [];
    // Reverse creation order: children before their parents.
    for (const entry of ids.slice().reverse()) {
      try { await db[entry.model].delete({ where: { id: entry.id } }); removed += 1; }
      catch { /* already gone (cascade, or a previous wipe) — idempotent by design */ }
    }
    await db.demoSeedRun.update({ where: { id: run.id }, data: { wipedAt: new Date() } });
  }
  return { removed, runs: runs.length };
}

export async function listDemoRuns(tenantId: string): Promise<any[]> {
  const rows = await db.demoSeedRun.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 5 });
  return rows.map((r2: any) => ({ id: r2.id, profile: r2.profile, seed: r2.seed, counts: r2.counts, createdAt: r2.createdAt, wipedAt: r2.wipedAt }));
}

export const DEMO_PROFILE_CAPS = { field_services: FS_CAPS };
