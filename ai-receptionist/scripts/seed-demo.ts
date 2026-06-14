/**
 * Demo-portal seed: "Summit Home Services" (HVAC / plumbing / home repair).
 *
 * Creates ONE new, self-contained portal populated with realistic-looking data
 * for marketing screenshots — calls (with natural AI transcripts), contacts,
 * jobs, automations, a reports dashboard, and a strong AI-instructions example.
 *
 * SAFE: it only creates a brand-new tenant and rows under it. It never touches
 * any other portal. Because every child table cascades on Tenant delete, the
 * whole demo can be removed in one step.
 *
 * Usage (Render Shell, from the app folder):
 *   npx tsx scripts/seed-demo.ts          # create + populate the demo portal
 *   npx tsx scripts/seed-demo.ts --fresh  # delete an existing demo first, then re-seed
 *   npx tsx scripts/seed-demo.ts --clean  # delete the demo portal and ALL its data
 *
 * Needs the database reachable (same env as the app). No migration required
 * beyond what the app already runs — it uses existing tables only.
 */
import { prisma, disconnectDb } from "../src/db/client";

const PORTAL_NAME = "Summit Home Services";
const AREA = ["919", "984"]; // Raleigh–Durham area codes, for believable local numbers

// ---------- small helpers ----------------------------------------------------
function daysAgo(n: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, Math.floor(Math.random() * 60), 0);
  return d;
}
let phoneSeq = 1000;
function phone(): string {
  const area = AREA[Math.floor(Math.random() * AREA.length)];
  const mid = 200 + Math.floor(Math.random() * 700);
  const last = String(phoneSeq++).padStart(4, "0");
  return `+1${area}${mid}${last}`;
}
function fmtPhone(p: string): string {
  // +19195551234 -> (919) 555-1234  (for natural reading in transcripts)
  const d = p.replace(/^\+1/, "");
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
let sidSeq = 1;
function callSid(): string { return `CADEMO${Date.now().toString(36)}${(sidSeq++).toString().padStart(4, "0")}`; }
const at = (base: Date, addSec: number) => new Date(base.getTime() + addSec * 1000).toISOString();
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

// ---------- people ------------------------------------------------------------
const PEOPLE: { name: string; email: string }[] = [
  { name: "Sarah Whitfield", email: "sarah.whitfield@gmail.com" },
  { name: "Marcus Bell", email: "marcus.bell84@gmail.com" },
  { name: "Priya Nair", email: "priya.nair@outlook.com" },
  { name: "David Coleman", email: "dcoleman.home@gmail.com" },
  { name: "Emily Tran", email: "emily.tran@yahoo.com" },
  { name: "Robert Jansen", email: "rob.jansen@gmail.com" },
  { name: "Latoya Simmons", email: "latoya.simmons@gmail.com" },
  { name: "Greg Patterson", email: "g.patterson@outlook.com" },
  { name: "Hannah Brooks", email: "hannah.brooks@gmail.com" },
  { name: "Daniel Okafor", email: "daniel.okafor@gmail.com" },
  { name: "Megan Russo", email: "megan.russo@yahoo.com" },
  { name: "Anthony Pruitt", email: "tony.pruitt@gmail.com" },
  { name: "Christine Lau", email: "christine.lau@gmail.com" },
  { name: "Brian Mercer", email: "brian.mercer@outlook.com" },
  { name: "Jasmine Ford", email: "jasmine.ford@gmail.com" },
  { name: "Kevin Delgado", email: "kevin.delgado@gmail.com" },
  { name: "Olivia Hartman", email: "olivia.hartman@gmail.com" },
  { name: "Samuel Reyes", email: "sam.reyes@yahoo.com" },
  { name: "Nina Kowalski", email: "nina.kowalski@gmail.com" },
  { name: "Trevor Boyd", email: "trevor.boyd@outlook.com" },
  { name: "Alicia Monroe", email: "alicia.monroe@gmail.com" },
  { name: "Patrick Nguyen", email: "patrick.nguyen@gmail.com" },
  { name: "Diane Carver", email: "diane.carver@yahoo.com" },
  { name: "Marcus Webb", email: "marcus.webb@gmail.com" },
  { name: "Renee Foster", email: "renee.foster@gmail.com" },
  { name: "Hector Alvarez", email: "hector.alvarez@gmail.com" },
];

const STREETS = ["Oak St", "Maple Ave", "Birchwood Dr", "Hillcrest Rd", "Sycamore Ln", "Brookhaven Ct", "Linden Way", "Pinecrest Dr", "Magnolia St", "Crabtree Rd", "Glenwood Ave", "Falls River Dr", "Riley Hill Rd", "Wakefield Pines Dr"];
function address(): string { return `${1000 + Math.floor(Math.random() * 8000)} ${pick(STREETS)}`; }

// ---------- call scenarios (reason + transcript builder) ----------------------
type Turn = { role: "assistant" | "caller"; text: string };
interface Scenario { intent: string; urgent: boolean; build: (name: string, callback: string) => Turn[]; }

const GREETING = "Thank you for calling Summit Home Services, this is the front desk. How can I help you today?";

const SCENARIOS: Scenario[] = [
  {
    intent: "AC not cooling — requesting same-day service",
    urgent: true,
    build: (name, cb) => [
      { role: "assistant", text: GREETING },
      { role: "caller", text: "Hi, my air conditioner is running but it's just blowing warm air. The house is getting really hot." },
      { role: "assistant", text: "I'm sorry to hear that — no cooling on a day like this is no fun. I can get a technician out to you. Is this something you'd need handled today?" },
      { role: "caller", text: "Yes, as soon as possible. It's almost 80 inside." },
      { role: "assistant", text: "Understood, I'll flag this as urgent. Can I start with your name?" },
      { role: "caller", text: `It's ${name}.` },
      { role: "assistant", text: "Thanks. And the best callback number in case the technician needs to reach you?" },
      { role: "caller", text: cb },
      { role: "assistant", text: "Perfect. What's the service address?" },
      { role: "caller", text: address() },
      { role: "assistant", text: `Got it, ${name.split(" ")[0]}. I've marked this as a same-day cooling issue and our dispatcher will call shortly with an arrival window. Is there anything else I can note for the technician?` },
      { role: "caller", text: "Just that the upstairs is the worst. Thank you!" },
      { role: "assistant", text: "Will do. Hang tight — we'll have someone out to you soon." },
    ],
  },
  {
    intent: "Water heater leaking from the bottom",
    urgent: true,
    build: (name, cb) => [
      { role: "assistant", text: GREETING },
      { role: "caller", text: "There's water all around my water heater in the garage. It looks like it's leaking from the bottom." },
      { role: "assistant", text: "Okay, let's get that taken care of before it gets worse. If you can safely reach the shutoff valve on the cold-water line above the heater, turning it clockwise will stop the flow. Are you able to do that?" },
      { role: "caller", text: "Yeah, I think I just turned it off." },
      { role: "assistant", text: "Great, that'll help a lot. I'll get a technician scheduled. May I have your name?" },
      { role: "caller", text: name },
      { role: "assistant", text: "Thank you. What's the best number to reach you?" },
      { role: "caller", text: cb },
      { role: "assistant", text: "And the address where the water heater is located?" },
      { role: "caller", text: address() },
      { role: "assistant", text: "Perfect. Do you happen to know roughly how old the unit is? It helps the technician bring the right parts." },
      { role: "caller", text: "Maybe ten or eleven years?" },
      { role: "assistant", text: `Noted — at that age we'll have a replacement option ready just in case. I've logged everything, ${name.split(" ")[0]}, and dispatch will follow up with timing.` },
    ],
  },
  {
    intent: "Furnace making a loud noise",
    urgent: false,
    build: (name, cb) => [
      { role: "assistant", text: GREETING },
      { role: "caller", text: "My furnace started making this loud rattling sound whenever it kicks on. It's still heating, but the noise is concerning." },
      { role: "assistant", text: "I appreciate you calling before it turns into something bigger. A rattle like that is often a loose panel or a blower issue — definitely worth a look. Would you like me to set up a diagnostic visit?" },
      { role: "caller", text: "Yes please." },
      { role: "assistant", text: "Wonderful. Can I get your name?" },
      { role: "caller", text: name },
      { role: "assistant", text: "And the best callback number?" },
      { role: "caller", text: cb },
      { role: "assistant", text: "Got it. What address are we coming to?" },
      { role: "caller", text: address() },
      { role: "assistant", text: `Thanks, ${name.split(" ")[0]}. Since it's still heating, I'll schedule this as a standard visit rather than an emergency — does a weekday morning work for you?` },
      { role: "caller", text: "Mornings are great." },
      { role: "assistant", text: "Perfect, I'll note a morning preference. Our team will confirm the exact day and time shortly." },
    ],
  },
  {
    intent: "Kitchen drain clogged and backing up",
    urgent: false,
    build: (name, cb) => [
      { role: "assistant", text: GREETING },
      { role: "caller", text: "My kitchen sink is completely clogged. Water just sits there and won't drain." },
      { role: "assistant", text: "That's a common one and usually a quick fix for our team. Have you put anything like grease or coffee grounds down recently, just so I can note it?" },
      { role: "caller", text: "Probably some grease, yeah." },
      { role: "assistant", text: "Good to know — I'll pass that along. Let me get you on the schedule. What's your name?" },
      { role: "caller", text: name },
      { role: "assistant", text: "And a good callback number?" },
      { role: "caller", text: cb },
      { role: "assistant", text: "What's the service address?" },
      { role: "caller", text: address() },
      { role: "assistant", text: `Thanks, ${name.split(" ")[0]}. I've got a kitchen-drain clog logged for you. Dispatch will reach out with the earliest available window.` },
    ],
  },
  {
    intent: "Quote for a bathroom remodel",
    urgent: false,
    build: (name, cb) => [
      { role: "assistant", text: GREETING },
      { role: "caller", text: "I'm planning to redo my master bathroom and wanted to get a quote on the plumbing work." },
      { role: "assistant", text: "Exciting project! We'd love to help. Are you looking at moving any fixtures — like relocating the shower or vanity — or keeping everything in place?" },
      { role: "caller", text: "Mostly the same layout, but a new walk-in shower instead of the tub." },
      { role: "assistant", text: "A tub-to-shower conversion, perfect. I'll have an estimator reach out to schedule a walkthrough. Can I get your name?" },
      { role: "caller", text: name },
      { role: "assistant", text: "And the best number and a good time to reach you?" },
      { role: "caller", text: `${cb}, afternoons are best.` },
      { role: "assistant", text: "Great — afternoons noted. What's the project address?" },
      { role: "caller", text: address() },
      { role: "assistant", text: `Thank you, ${name.split(" ")[0]}. I've logged a bathroom-remodel estimate request. Our estimator will confirm pricing after seeing the space — they'll be in touch to set up the visit.` },
    ],
  },
  {
    intent: "No hot water in the house",
    urgent: true,
    build: (name, cb) => [
      { role: "assistant", text: GREETING },
      { role: "caller", text: "We've got no hot water at all this morning. Cold showers for everybody." },
      { role: "assistant", text: "Oh no — let's fix that quickly. Is your water heater gas or electric, if you know?" },
      { role: "caller", text: "It's gas, I think." },
      { role: "assistant", text: "Okay. Sometimes the pilot goes out; either way a technician can sort it fast. I'll get you scheduled today. Your name?" },
      { role: "caller", text: name },
      { role: "assistant", text: "Best callback number?" },
      { role: "caller", text: cb },
      { role: "assistant", text: "And the address?" },
      { role: "caller", text: address() },
      { role: "assistant", text: `Thanks, ${name.split(" ")[0]} — I've flagged this as a same-day no-hot-water call. Dispatch will call you right back with an arrival time.` },
    ],
  },
  {
    intent: "Thermostat replacement / smart thermostat install",
    urgent: false,
    build: (name, cb) => [
      { role: "assistant", text: GREETING },
      { role: "caller", text: "I bought a smart thermostat and I'd rather have a pro install it. Do you do that?" },
      { role: "assistant", text: "We do — smart thermostat installs are quick for our techs, and they'll make sure it's wired and configured correctly with your system. Which model did you get, out of curiosity?" },
      { role: "caller", text: "A Nest." },
      { role: "assistant", text: "Great choice. Let me set up the install. Can I have your name?" },
      { role: "caller", text: name },
      { role: "assistant", text: "And the best callback number?" },
      { role: "caller", text: cb },
      { role: "assistant", text: "What's the address for the install?" },
      { role: "caller", text: address() },
      { role: "assistant", text: `Perfect, ${name.split(" ")[0]}. I've logged a Nest thermostat installation. We'll reach out to confirm a convenient window.` },
    ],
  },
  {
    intent: "AC maintenance / seasonal tune-up",
    urgent: false,
    build: (name, cb) => [
      { role: "assistant", text: GREETING },
      { role: "caller", text: "I'd like to get my AC tuned up before summer really hits." },
      { role: "assistant", text: "Smart move — a tune-up keeps it efficient and helps catch small issues early. I can schedule a maintenance visit for you. May I get your name?" },
      { role: "caller", text: name },
      { role: "assistant", text: "And a good callback number?" },
      { role: "caller", text: cb },
      { role: "assistant", text: "What address is the system at?" },
      { role: "caller", text: address() },
      { role: "assistant", text: "Is this the only system, or do you have more than one unit?" },
      { role: "caller", text: "Just the one." },
      { role: "assistant", text: `Got it, ${name.split(" ")[0]} — one system, seasonal tune-up. We'll be in touch with available dates.` },
    ],
  },
  {
    intent: "Garbage disposal jammed and humming",
    urgent: false,
    build: (name, cb) => [
      { role: "assistant", text: GREETING },
      { role: "caller", text: "My garbage disposal just hums and won't spin. I think it's jammed." },
      { role: "assistant", text: "That hum usually means it's stuck rather than dead — good news, often repairable. Please don't keep flipping the switch, as that can burn out the motor. I'll get a technician scheduled. Your name?" },
      { role: "caller", text: name },
      { role: "assistant", text: "Best number to reach you?" },
      { role: "caller", text: cb },
      { role: "assistant", text: "And the service address?" },
      { role: "caller", text: address() },
      { role: "assistant", text: `Thanks, ${name.split(" ")[0]}. I've logged a jammed-disposal repair and noted not to run it until we're there. Dispatch will follow up with timing.` },
    ],
  },
  {
    intent: "Burst pipe — water spreading fast (emergency)",
    urgent: true,
    build: (name, cb) => [
      { role: "assistant", text: GREETING },
      { role: "caller", text: "A pipe burst under my sink and water is going everywhere — I need someone now!" },
      { role: "assistant", text: "Okay, stay with me — first, can you shut off the water? There's usually a valve under the sink, or your main shutoff where the water enters the house. Turning it clockwise stops the flow." },
      { role: "caller", text: "Okay… got the one under the sink. It slowed down a lot." },
      { role: "assistant", text: "Great job, that's exactly right. I'm marking this as an emergency and getting our on-call technician moving. Your name?" },
      { role: "caller", text: name },
      { role: "assistant", text: "Best callback number?" },
      { role: "caller", text: cb },
      { role: "assistant", text: "And the address?" },
      { role: "caller", text: address() },
      { role: "assistant", text: `Thank you, ${name.split(" ")[0]}. Help is on the way — our dispatcher will call you in the next few minutes with the technician's ETA. Try to keep towels down and stay clear of any outlets near the water.` },
    ],
  },
];

// ---------- jobs --------------------------------------------------------------
const JOB_SUBTYPES = [
  { key: "hvac", label: "HVAC", order: 0, stages: [
    { key: "scheduled", label: "Scheduled", order: 0 },
    { key: "in_progress", label: "In progress", order: 1 },
    { key: "completed", label: "Completed", order: 2 },
    { key: "invoiced", label: "Invoiced", order: 3 },
  ] },
  { key: "plumbing", label: "Plumbing", order: 1, stages: [
    { key: "scheduled", label: "Scheduled", order: 0 },
    { key: "in_progress", label: "In progress", order: 1 },
    { key: "completed", label: "Completed", order: 2 },
    { key: "invoiced", label: "Invoiced", order: 3 },
  ] },
  { key: "repair", label: "Home repair", order: 2, stages: [
    { key: "scheduled", label: "Scheduled", order: 0 },
    { key: "in_progress", label: "In progress", order: 1 },
    { key: "completed", label: "Completed", order: 2 },
    { key: "invoiced", label: "Invoiced", order: 3 },
  ] },
];
const JOB_RECORD_STAGES = [
  { key: "new_request", label: "New request", order: 0 },
  { key: "scheduled", label: "Scheduled", order: 1 },
  { key: "in_progress", label: "In progress", order: 2 },
  { key: "completed", label: "Completed", order: 3 },
  { key: "invoiced", label: "Invoiced", order: 4 },
];

// ---------- AI instructions ---------------------------------------------------
const AI_INSTRUCTIONS = `You are the virtual receptionist for Summit Home Services, a licensed and insured HVAC, plumbing, and home-repair company serving the Raleigh–Durham area.

HOURS
• Mon–Sat, 7:00am–7:00pm.
• 24/7 emergency service for no-heat, no-cooling, major leaks, burst pipes, and no-water situations.

SERVICES
• HVAC: AC repair & installation, heating/furnace repair, thermostat installs, seasonal tune-ups.
• Plumbing: water heater repair & replacement, drain cleaning, leak detection, faucet/toilet/garbage-disposal repair.
• Remodels: bathroom and kitchen plumbing for renovations.

ON EVERY CALL, CAPTURE
1. Caller's full name.
2. Best callback number.
3. Service address.
4. A short description of the problem.
Always ask whether it's an emergency (no heat/cooling, active leak, no water) and flag urgent/same-day requests clearly.

HOW TO HANDLE
• Be warm, calm, and professional. Use the caller's first name once you have it.
• For emergencies: reassure the caller, give a simple safety step if relevant (e.g. shut off the water), and collect address + callback number first so we can dispatch fast.
• For quotes/estimates: capture the project scope and the best time to reach them; let them know an estimator will confirm pricing after a walkthrough.
• Offer the earliest available appointment window.
• Never quote exact prices — a technician confirms pricing on site.
• Close by confirming what happens next and thanking the caller by name.`;

// ---------- reports dashboard widgets -----------------------------------------
function reportWidgets() {
  return [
    { id: "w_total_calls", title: "Total calls", type: "kpi", source: "calls", measure: { op: "count" }, groupBy: [], series: [], filters: [], ch: "s" },
    { id: "w_leads", title: "Leads captured", type: "kpi", source: "contacts", measure: { op: "count" }, groupBy: [], series: [], filters: [], ch: "s" },
    { id: "w_calls_over_time", title: "Calls over time", type: "line", source: "calls", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "day" }], series: [], filters: [], ch: "m" },
    { id: "w_calls_by_status", title: "Call outcomes", type: "pie", source: "calls", measure: { op: "count" }, groupBy: [{ key: "status" }], series: [], filters: [], ch: "m" },
    { id: "w_jobs_by_type", title: "Jobs by service type", type: "bar", source: "job", measure: { op: "count" }, groupBy: [{ key: "subtypeKey" }], series: [], filters: [], ch: "m" },
    { id: "w_jobs_by_status", title: "Jobs by status", type: "bar", source: "job", measure: { op: "count" }, groupBy: [{ key: "stageKey" }], series: [], filters: [], ch: "m" },
  ];
}

// ---------- automations -------------------------------------------------------
function automations(): { name: string; triggerType: string; enabled: boolean; conditions: any[]; actions: any[]; createdAt: Date }[] {
  return [
    { name: "Email me every new lead", triggerType: "ContactCreated", enabled: true, conditions: [], actions: [{ type: "send_email", subject: "New lead from your AI receptionist" }], createdAt: daysAgo(40, 9) },
    { name: "Text new callers a booking link", triggerType: "ContactCreated", enabled: true, conditions: [], actions: [{ type: "send_sms" }], createdAt: daysAgo(38, 14) },
    { name: "Tag urgent calls for same-day dispatch", triggerType: "ContactCreated", enabled: true, conditions: [], actions: [{ type: "add_tag", value: "Urgent" }], createdAt: daysAgo(33, 11) },
    { name: "Send review request when a job is completed", triggerType: "RecordUpdated", enabled: true, conditions: [], actions: [{ type: "send_email", subject: "How did we do?" }], createdAt: daysAgo(27, 16) },
    { name: "Follow up with quote leads after 24 hours", triggerType: "ContactCreated", enabled: false, conditions: [], actions: [{ type: "send_sms" }], createdAt: daysAgo(20, 10) },
    { name: "Notify office when a job moves to In progress", triggerType: "RecordUpdated", enabled: true, conditions: [], actions: [{ type: "send_email", subject: "Job started" }], createdAt: daysAgo(14, 13) },
    { name: "Add 'Maintenance plan' tag after tune-up", triggerType: "RecordUpdated", enabled: false, conditions: [], actions: [{ type: "add_tag", value: "Maintenance plan" }], createdAt: daysAgo(8, 15) },
  ];
}

// ---------- delete (clean) ----------------------------------------------------
async function cleanDemo(): Promise<number> {
  const existing = await prisma.tenant.findMany({ where: { name: PORTAL_NAME } });
  for (const t of existing) {
    await prisma.tenant.delete({ where: { id: t.id } }); // cascades to all child rows
  }
  return existing.length;
}

// ---------- seed --------------------------------------------------------------
async function seed(fresh: boolean): Promise<void> {
  if (fresh) {
    const removed = await cleanDemo();
    if (removed) console.log(`Removed ${removed} existing "${PORTAL_NAME}" portal(s) before re-seeding.`);
  } else {
    const exists = await prisma.tenant.findFirst({ where: { name: PORTAL_NAME } });
    if (exists) {
      console.log(`A portal named "${PORTAL_NAME}" already exists (id ${exists.id}).`);
      console.log(`Run with --fresh to replace it, or --clean to remove it.`);
      return;
    }
  }

  // 1) The portal (receptionist ON, smooth voice, AI instructions filled in).
  const tenant = await prisma.tenant.create({
    data: {
      name: PORTAL_NAME,
      businessType: "home services (HVAC, plumbing, repair)",
      notifyEmail: "dispatch@summithomeservices.com",
      greeting: "Thanks for calling Summit Home Services. How can we help you today?",
      aiInstructions: AI_INSTRUCTIONS,
      requireEmail: true,
      receptionistEnabled: true,
      voiceMode: "SMOOTH",
    } as any,
  });
  const tenantId = tenant.id;
  console.log(`Created portal "${PORTAL_NAME}" (id ${tenantId}).`);

  // 2) Record types: contact (system) + job (home-services pipeline). Creating
  //    "job" now means the app's lazy provisioner won't overwrite it with the
  //    generic recruiting stages.
  await prisma.recordType.create({
    data: { tenantId, key: "contact", label: "Contact", labelPlural: "Contacts", system: true, stages: [], recordStages: [], subtypes: [], order: 0 } as any,
  });
  const jobType = await prisma.recordType.create({
    data: { tenantId, key: "job", label: "Job", labelPlural: "Jobs", system: false, stages: [], recordStages: JOB_RECORD_STAGES as any, subtypes: JOB_SUBTYPES as any, order: 1 } as any,
  });

  // Two custom job fields so the Jobs table shows Address + Estimate columns.
  await prisma.fieldDef.create({ data: { tenantId, recordTypeId: jobType.id, scope: "record", key: "address", label: "Address", type: "text", order: 0 } as any });
  await prisma.fieldDef.create({ data: { tenantId, recordTypeId: jobType.id, scope: "record", key: "estimate", label: "Estimate", type: "text", order: 1 } as any });

  // 3) Contacts + calls. Each call is tied to a contact and carries a realistic
  //    transcript + extracted lead info, spread over the last ~6 weeks.
  const contactsCreated: { id: string; name: string; phone: string; email: string; intent: string }[] = [];
  const totalCalls = 26;
  for (let i = 0; i < totalCalls; i++) {
    const person = PEOPLE[i % PEOPLE.length];
    const scn = SCENARIOS[i % SCENARIOS.length];
    const ph = phone();
    // Spread across the last 42 days; a few land "today" so the dashboard's
    // today/this-week stats are non-zero.
    const dayOffset = i < 3 ? 0 : Math.floor((i / totalCalls) * 41) + Math.floor(Math.random() * 3);
    const hour = 8 + Math.floor(Math.random() * 10);
    const created = daysAgo(dayOffset, hour, Math.floor(Math.random() * 59));

    const contact = await prisma.contact.create({
      data: {
        tenantId, name: person.name, phone: ph, email: person.email,
        intent: scn.intent, createdAt: created, updatedAt: created,
      } as any,
    });
    contactsCreated.push({ id: contact.id, name: person.name, phone: ph, email: person.email, intent: scn.intent });

    const turns = scn.build(person.name, fmtPhone(ph));
    const transcript = turns.map((t, idx) => ({ role: t.role, text: t.text, at: at(created, idx * 12) }));

    // Most calls completed; a couple left mid-conversation as "in progress".
    const inProgress = i === 5 || i === 17;
    const status = inProgress ? "COLLECTING_INFO" : "COMPLETED";
    const finalizedAt = inProgress ? null : new Date(created.getTime() + turns.length * 12000);

    await prisma.callSession.create({
      data: {
        callSid: callSid(), tenantId, contactId: contact.id,
        fromNumber: ph, toNumber: "+19195550100",
        status: status as any,
        transcript: transcript as any,
        extracted: { name: person.name, intent: scn.intent, phone: ph, email: person.email } as any,
        turnCount: turns.length,
        finalizedAt: finalizedAt as any,
        emailSentAt: inProgress ? null : finalizedAt as any,
        createdAt: created, updatedAt: finalizedAt || created,
      } as any,
    });
  }
  console.log(`Seeded ${totalCalls} calls + ${contactsCreated.length} contacts (with transcripts).`);

  // 4) Jobs — records of type "job", tied to contacts, across pipeline stages.
  const jobBlueprints: { subtype: "hvac" | "plumbing" | "repair"; stage: string; title: (addr: string, who: string) => string; estimate: string }[] = [
    { subtype: "hvac", stage: "completed", title: (a, w) => `AC repair – ${w} residence`, estimate: "$420" },
    { subtype: "plumbing", stage: "scheduled", title: (a) => `Water heater replacement – ${a}`, estimate: "$1,850" },
    { subtype: "hvac", stage: "in_progress", title: (a) => `Furnace diagnostic – ${a}`, estimate: "$160" },
    { subtype: "plumbing", stage: "completed", title: (a) => `Kitchen drain clearing – ${a}`, estimate: "$195" },
    { subtype: "repair", stage: "new_request", title: (a) => `Bathroom remodel estimate – ${a}`, estimate: "TBD" },
    { subtype: "hvac", stage: "invoiced", title: (a, w) => `AC tune-up – ${w} residence`, estimate: "$129" },
    { subtype: "plumbing", stage: "in_progress", title: (a) => `Garbage disposal repair – ${a}`, estimate: "$240" },
    { subtype: "hvac", stage: "scheduled", title: (a) => `Thermostat install (Nest) – ${a}`, estimate: "$185" },
    { subtype: "plumbing", stage: "completed", title: (a) => `Burst pipe repair – ${a}`, estimate: "$610" },
    { subtype: "hvac", stage: "completed", title: (a, w) => `No-cooling service call – ${w} residence`, estimate: "$310" },
    { subtype: "repair", stage: "invoiced", title: (a) => `Faucet replacement – ${a}`, estimate: "$220" },
    { subtype: "plumbing", stage: "scheduled", title: (a) => `Leak detection – ${a}`, estimate: "$150" },
    { subtype: "hvac", stage: "new_request", title: (a) => `System replacement quote – ${a}`, estimate: "TBD" },
    { subtype: "repair", stage: "in_progress", title: (a) => `Toilet repair – ${a}`, estimate: "$175" },
  ];
  for (let i = 0; i < jobBlueprints.length; i++) {
    const b = jobBlueprints[i];
    const contact = contactsCreated[i % contactsCreated.length];
    const addr = address();
    const who = contact.name.split(" ").slice(-1)[0];
    const created = daysAgo(Math.floor((i / jobBlueprints.length) * 38) + 2, 9 + (i % 8));
    const record = await prisma.record.create({
      data: {
        tenantId, recordTypeId: jobType.id,
        title: b.title(addr, who),
        subtypeKey: b.subtype, stageKey: b.stage,
        customFields: { address: addr, estimate: b.estimate } as any,
        createdAt: created, updatedAt: created,
      } as any,
    });
    // Link the job to its contact (relationship stage mirrors the job stage).
    await prisma.recordLink.create({
      data: {
        tenantId, recordId: record.id, parentType: "contact", parentId: contact.id,
        role: "primary", stageKey: b.stage, createdAt: created, updatedAt: created,
      } as any,
    });
  }
  console.log(`Seeded ${jobBlueprints.length} jobs (linked to contacts).`);

  // 5) Automations.
  for (const a of automations()) {
    await prisma.automation.create({
      data: { tenantId, name: a.name, triggerType: a.triggerType, enabled: a.enabled, conditions: a.conditions as any, actions: a.actions as any, createdAt: a.createdAt, updatedAt: a.createdAt } as any,
    });
  }
  console.log(`Seeded ${automations().length} automations.`);

  // 6) Reports dashboard (Home dashboard renders live; this gives the Reports
  //    page a populated analytics view).
  await prisma.dashboard.create({
    data: { tenantId, name: "Operations overview", widgets: reportWidgets() as any, order: 0 } as any,
  });
  console.log(`Seeded reports dashboard "Operations overview".`);

  console.log(`\nDone. Open the master hub → Portals → "${PORTAL_NAME}" to view the demo.`);
}

// ---------- entry -------------------------------------------------------------
(async () => {
  const arg = process.argv[2];
  try {
    if (arg === "--clean") {
      const n = await cleanDemo();
      console.log(n ? `Deleted ${n} "${PORTAL_NAME}" portal(s) and all their data.` : `No "${PORTAL_NAME}" portal found.`);
    } else {
      await seed(arg === "--fresh");
    }
  } catch (err) {
    console.error(`Seed error: ${(err as Error).message}`);
    await disconnectDb();
    process.exit(1);
  }
  await disconnectDb();
})();
