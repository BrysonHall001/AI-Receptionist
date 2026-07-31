// TENANT TEMPLATES (batch: tenant-templates-1) — code-shipped DECLARATIVE
// templates for tenant creation. Data, not code: a template describes what a
// new tenant starts as; it never becomes a parallel creation flow. Application
// is TWO-PHASE:
//   client phase — the create-tenant wizard PREFILLS its checkboxes from the
//     template (pages/modules); the hub admin can override anything before
//     Finish, and the CHECKBOXES ALWAYS WIN (they're submitted as-is);
//   server phase — applyTemplateAtCreation() applies everything that is NOT a
//     checkbox (AI settings, field tweaks, future content-pack hooks), riding
//     the EXISTING createPortal path.
// Templates are constants (tenants never edit them) validated at module load,
// the module-registry pattern.
import { logger } from "../utils/logger";
import { prisma } from "../db/client";

export interface TemplateFieldTweak {
  /** Module key the tweak lands on (must be a registry key). */
  moduleKey: string;
  /** A fieldService.createField input — the REAL creation path, full validation. */
  field: { label: string; type: string; required?: boolean; options?: any };
}

/** Content-pack HOOKS (D2). The SHAPE ships now; every template ships them
 *  EMPTY. A later batch fills them; the engine already carries them so packs
 *  need no schema change. */
/** One seeded dashboard: the reserved home row ("__home__") or a named
 *  analytics dashboard. Widgets are the EXACT reports.js widget JSON — no new
 *  widget types, no server-side execution; dashboards are just data. */
export interface TemplateDashboardSeed { name: string; widgets: unknown[] }

export interface TemplateHooks {
  dashboards: TemplateDashboardSeed[];   // the home row's widgets
  analytics: TemplateDashboardSeed[];    // named analytics dashboards
  libraryFlavor: string | null;
  commDrafts: unknown[];
  aiInstructionSections: unknown[];
}

export interface TenantTemplate {
  key: string;
  /** Builder-only, both OPTIONAL so a blueprint saved before they existed still validates.
   *  moduleOrder: the nav order a new tenant starts with.
   *  newModules:  modules a new tenant should be CREATED with, beyond the system set. */
  moduleOrder?: string[];
  /** Per-module views and pipeline, keyed by module key. Builder-only and OPTIONAL, so a
   *  blueprint saved before this batch simply has none. Every field mirrors a RecordType
   *  column, so a template-made pipeline is the same structure a hand-built one is. */
  moduleViews?: Record<string, {
    enabledViews?: string[];
    pipelineEnabled?: boolean;
    calendarDateField?: string | null;
    calendarLanes?: boolean;
    calendarTray?: boolean;
    subtypes?: Array<{ key?: string; label: string }>;
    stages?: Array<{ key?: string; label: string }>;
    recordStages?: Array<{ key?: string; label: string }>;
  }>;
  newModules?: Array<{ key: string; label: string; labelPlural?: string }>;
  label: string;
  description: string;
  /** Page hrefs the wizard should UNCHECK (prefill only — the admin can re-check). */
  pagesOffPrefill: string[];
  /** Module keys the wizard should UNCHECK (prefill only — the admin can re-check). */
  modulesHiddenPrefill: string[];
  /** null = leave the hub voice picker's choice alone (every template today). */
  aiVoiceMode: string | null;
  /** null = leave the column default ("booking"). Stored as-is; batch-20's
   *  read-time degrade rule makes a hidden target safe automatically. */
  aiSchedulingTarget: string | null;
  /** null = leave the column default (true). */
  aiIntake: boolean | null;
  fieldTweaks: TemplateFieldTweak[];
  /** CREATE-UI-2: per-template PAGE LABEL OVERRIDES (href -> label), applied at
   *  creation through the EXISTING Settings->Labels mechanism (labels.nav.labels)
   *  and served to the wizard for live row-title swaps. Both shipped templates
   *  carry NONE — capability only, proven by a test fixture. */
  pageLabelOverrides: Record<string, string>;
  /** RM-1: templates that OFFER the create-card "Custom-configure Learning
   *  Center?" checkbox (persisted as Tenant.customLearningCenter; the variant
   *  itself ships per-template in its own batch). */
  customLcOffer: boolean;
  /** RM-1: template-scoped module RELABELS applied at creation through the
   *  stock-label-only pattern (batch-8 precedent: only rows still on the
   *  stock label are touched — at creation that's all of them; keys, tests,
   *  and every other tenant's labels are never touched). */
  moduleRelabels: Record<string, { label: string; labelPlural: string }>;
  hooks: TemplateHooks;
}

const EMPTY_HOOKS: TemplateHooks = { dashboards: [], analytics: [], libraryFlavor: null, commDrafts: [], aiInstructionSections: [] };

export const TENANT_TEMPLATES: TenantTemplate[] = [
  {
    key: "general",
    label: "General",
    // ROW ANATOMY: the old copy claimed "everything-on" while this same template carries a
    // Service Plans exception three lines below. The LABEL was the thing that was wrong -
    // the prefill is deliberate and stays.
    description: "A plain starting point \u2014 no industry setup, with every module on except Service Plans.",
    // PRIME DIRECTIVE: byte-identical to today. No prefill, no server phase
    // beyond stamping the key: creating with General (or touching nothing)
    // produces the exact same tenant state as before this batch.
    pagesOffPrefill: [],
    modulesHiddenPrefill: ["service_plan"],   // a maintenance membership is a trade concept, not a general one
    aiVoiceMode: null,
    aiSchedulingTarget: null,
    aiIntake: null,
    fieldTweaks: [],
    pageLabelOverrides: {},
    customLcOffer: false,
    moduleRelabels: {},
    hooks: { ...EMPTY_HOOKS },
  },
  {
    // AI RECEPTIONIST ONLY - a business that wants nothing but the phone answered.
    // Pure DATA: no new creation path, no branch in createPortal. The wizard prefills
    // from the arrays below and the operator's checkboxes still win at submit.
    key: "ai_receptionist",
    label: "AI Receptionist Only",
    description: "Just the phone answered \u2014 calls, contacts and a dashboard, nothing else.",
    // Analytics, Automations and Communication are off: nothing feeds them. Learning
    // Center stays ON because this template ships its own custom one and a locked page
    // would mean there is none. Billing stays ON - a tenant that cannot see its own
    // plan raises a support call the first time it wants to upgrade. Feedback stays ON
    // because it is a SUPPORT TICKET channel, not a module surface: it posts
    // { problem, description, attachments } and has no relationship to record types.
    // This is the least hand-held customer on the platform; leaving it no way to report
    // a problem would be the wrong trade.
    pagesOffPrefill: ["#/reports", "#/automations", "#/communication"],
    // Contacts is core and its checkbox is disabled in the wizard, so it can never be
    // switched off. Every other system module goes.
    modulesHiddenPrefill: ["job", "booking", "equipment", "invoice", "vehicle", "property", "product", "estimate", "task", "service_plan", "work_order"],
    aiVoiceMode: null, // the hub picker still decides
    // With booking and work_order both hidden the AI has nothing to schedule into, so
    // naming a target would be a lie. Safe either way: callOrchestrator resolves a
    // hidden/locked/non-capable target to "none" at READ time (and counts nav-hidden as
    // hidden), so this cannot produce a broken receptionist.
    aiSchedulingTarget: null,
    aiIntake: null,
    // The whole job of a receptionist-only business: who called, what about, and how and
    // when to get back to them. Four fields, each a real fieldService.createField input.
    fieldTweaks: [
      { moduleKey: "contact", field: { label: "Best time to call", type: "single_select", options: ["Morning", "Afternoon", "Evening", "Any"] } },
      { moduleKey: "contact", field: { label: "Preferred contact method", type: "single_select", options: ["Phone", "Text", "Email"] } },
      { moduleKey: "contact", field: { label: "Reason for calling", type: "text" } },
      { moduleKey: "contact", field: { label: "Callback promised by", type: "datetime" } },
    ],
    pageLabelOverrides: {},
    customLcOffer: true,
    moduleRelabels: {},
    hooks: { ...EMPTY_HOOKS },
  },
  {
    key: "field_services",
    label: "Field Services",
    description: "For trades: calls become work orders, scheduled to techs, flowing to estimates and invoices.",
    pagesOffPrefill: [], // all pages on
    modulesHiddenPrefill: ["job", "booking", "vehicle", "property"],
    aiVoiceMode: null, // the hub picker still decides
    aiSchedulingTarget: "work_order",
    aiIntake: true,
    // AUDIT VERDICT (R1): the kept modules' seeds are already field-service-sane
    // (Products ships sku/price/unit/category; Work Orders ships priority/
    // service_address/photos; etc). Zero tweaks warranted — the MECHANISM below
    // is live and suite-proven with a synthetic tweak.
    fieldTweaks: [],
    pageLabelOverrides: {},
    // TENANT TEMPLATES 2 — the Field Services CONTENT PACK. Every widget below
    // is the reports.js JSON shape verbatim (type/source/measure/groupBy/
    // filters incl. the real "today" and "previous" rule ops); every source and
    // field is a shipped seed. Names in plain owner language.
    customLcOffer: true,
    moduleRelabels: {},
    hooks: {
      dashboards: [
        {
          name: "__home__",
          widgets: [
            { id: "fs_home_new_requests", title: "New requests", type: "kpi", source: "work_order", measure: { op: "count" }, groupBy: [], series: [], filters: [{ field: "stageKey", op: "is", value: "new_request", conj: "AND" }] },
            { id: "fs_home_today", title: "Today's schedule", type: "list", source: "work_order", measure: { op: "count" }, groupBy: [], series: [], columns: ["title", "appointmentAt", "resource", "stageKey"], filters: [{ field: "appointmentAt", op: "today", value: "", conj: "AND" }] },
            { id: "fs_home_by_status", title: "Jobs by status", type: "pie", source: "work_order", measure: { op: "count" }, groupBy: [{ key: "stageKey" }], series: [], filters: [] },
            { id: "fs_home_invoiced", title: "Invoiced (last 30 days)", type: "kpi", source: "invoice", measure: { op: "sum", field: "total" }, groupBy: [], series: [], filters: [{ field: "invoice_date", op: "previous", value: 30, unit: "days", conj: "AND" }] },
          ],
        },
      ],
      analytics: [
        {
          name: "Operations",
          widgets: [
            { id: "fs_ops_requests_week", title: "Requests over time", type: "line", source: "work_order", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "week" }], series: [], filters: [] },
            { id: "fs_ops_by_status", title: "Jobs by status", type: "pie", source: "work_order", measure: { op: "count" }, groupBy: [{ key: "stageKey" }], series: [], filters: [] },
            { id: "fs_ops_by_type", title: "Jobs by type", type: "bar", source: "work_order", measure: { op: "count" }, groupBy: [{ key: "subtypeKey" }], series: [], filters: [] },
            { id: "fs_ops_completed_week", title: "Completed jobs by week (created date)", type: "line", source: "work_order", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "week" }], series: [], filters: [{ field: "stageKey", op: "is", value: "completed", conj: "AND" }] },
          ],
        },
        {
          name: "Revenue",
          widgets: [
            { id: "fs_rev_invoiced_month", title: "Invoiced over time", type: "line", source: "invoice", measure: { op: "sum", field: "total" }, groupBy: [{ key: "invoice_date", date: "month" }], series: [], filters: [] },
            { id: "fs_rev_paid_vs_out", title: "Paid vs outstanding", type: "pie", source: "invoice", measure: { op: "count" }, groupBy: [{ key: "status" }], series: [], filters: [] },
            { id: "fs_plan_renewals", title: "Plan renewals by month", type: "bar", source: "service_plan", measure: { op: "count" }, groupBy: [{ key: "renewal_date", date: "month" }], series: [], filters: [{ field: "stageKey", op: "is", value: "active", conj: "AND" }] },
            { id: "fs_rev_by_method", title: "Invoices by payment method", type: "pie", source: "invoice", measure: { op: "count" }, groupBy: [{ key: "payment_method" }], series: [], filters: [] },
          ],
        },
        {
          name: "Customers & Calls",
          widgets: [
            { id: "fs_cc_calls_week", title: "Calls over time", type: "line", source: "calls", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "week" }], series: [], filters: [] },
            { id: "fs_cc_calls_outcome", title: "Calls by outcome", type: "pie", source: "calls", measure: { op: "count" }, groupBy: [{ key: "status" }], series: [], filters: [] },
            { id: "fs_cc_new_contacts", title: "New contacts over time", type: "line", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "week" }], series: [], filters: [] },
          ],
        },
      ],
      libraryFlavor: "field_services", // curation key -> LIBRARY_FLAVORS (presets.ts)
      // Comm drafts: templateService rows (inert by nature — nothing fires a
      // template) + ONE survey in its real "draft" status. Merge tags limited
      // to the batch-10 catalog's always-resolvable set ({{name}}/{{first_name}}/
      // {{business}} + contact basics) — asserted by the suite.
      commDrafts: [
        { kind: "email", name: "Visit confirmation", subject: "You're on the schedule — see you soon", body: "<p>Hi {{first_name}},</p><p>Just confirming your upcoming visit from {{business}}. If the time no longer works, reply here or give us a call and we'll move it.</p><p>— {{business}}</p>" },
        { kind: "email", name: "Estimate follow-up", subject: "Any questions about your estimate?", body: "<p>Hi {{first_name}},</p><p>Wanted to check in on the estimate we sent over. Happy to walk through it, adjust anything, or get you on the schedule — whatever's easiest.</p><p>— {{business}}</p>" },
        { kind: "email", name: "Thanks after completion", subject: "Thanks from {{business}}", body: "<p>Hi {{first_name}},</p><p>Thanks for having us out — the job's wrapped up. If anything doesn't look right, reply here and we'll make it right.</p><p>— {{business}}</p>" },
        { kind: "survey", name: "How did we do?", description: "A quick check-in after a visit.", questions: [
          { type: "rating", label: "How would you rate the visit overall?", required: true },
          { type: "yes_no", label: "Was everything left clean and working?" },
          { type: "long_text", label: "Anything we could do better?" },
        ] },
      ],
      // ONE seeded AI Instructions section (the "## <Name>" sectioned-editor
      // format). A SCAFFOLD the owner edits — phrased to COMPOSE with the
      // built-in prompt: it reinforces the never-promise rules (prices/exact
      // arrival times) and never contradicts the booking/intake/target blocks.
      aiInstructionSections: [
        {
          name: "Industry context",
          body: [
            "We are a field-service business. Edit this section so the receptionist knows the basics:",
            "- What we do: (e.g. heating, cooling, and water heater service and installs)",
            "- Service area: (e.g. the greater Raleigh area)",
            "- Emergencies: (e.g. no-heat, no-cooling, or active leaks are urgent — gather the details and mark it an emergency; we triage those first)",
            "- Never promise exact prices or exact arrival times — the office confirms both.",
          ].join("\n"),
        },
      ],
    },
  },
  {
    key: "recruitment_marketing",
    label: "Recruitment Marketing",
    description: "For recruiters: ad clicks become candidates, nurtured into booked interviews.",
    // RM-1: pages ALL on; only the recruiting spine visible — Contacts
    // (relabeled Candidates at creation, R4), Job Openings, and Bookings kept
    // VISIBLE as "Interviews" (the approved Option 1: batch-20's fail-safe
    // degrades a hidden scheduling target to "none" — callOrchestrator.ts
    // resolveSchedulingTarget — so the AI's interview book needs the module in
    // the nav; the relabel makes it read right).
    pagesOffPrefill: [],
    modulesHiddenPrefill: ["work_order", "equipment", "estimate", "invoice", "vehicle", "property", "product", "task", "service_plan"],
    aiVoiceMode: null, // the hub segmented control decides, as always
    aiSchedulingTarget: "booking", // = Interviews after the R3 relabel
    aiIntake: false, // service-request intake is an FS concept
    // The ATS-lite field sets (RM-1 Part D). Keys derive from labels via the
    // field service's slugify (snake_case): "Candidate source" ->
    // candidate_source, etc. Seeded in this order; every one an ordinary,
    // owner-editable field afterward. Types verified against FIELD_TYPES.
    fieldTweaks: [
      { moduleKey: "contact", field: { label: "Candidate source", type: "single_select", options: ["Facebook", "Google", "Indeed", "LinkedIn", "Referral", "Organic", "Other"] } },
      { moduleKey: "contact", field: { label: "Role interest", type: "text" } },
      { moduleKey: "contact", field: { label: "Candidate stage", type: "single_select", options: ["New lead", "Contacted", "Prescreened", "Interview scheduled", "Interviewed", "Submitted to client", "Hired", "Not a fit"] } },
      { moduleKey: "contact", field: { label: "Prescreen checks", type: "multi_select", options: ["Valid license", "Eligible to work", "Experience verified", "Availability confirmed", "Background check passed"] } },
      { moduleKey: "contact", field: { label: "Resume link", type: "url" } },
      { moduleKey: "contact", field: { label: "LinkedIn URL", type: "url" } },
      { moduleKey: "contact", field: { label: "Desired pay", type: "text" } },
      { moduleKey: "contact", field: { label: "Availability date", type: "date" } },
      { moduleKey: "job", field: { label: "Department", type: "text" } },
      { moduleKey: "job", field: { label: "Location", type: "text" } },
      { moduleKey: "job", field: { label: "Work mode", type: "single_select", options: ["On-site", "Remote", "Hybrid"] } },
      { moduleKey: "job", field: { label: "Employment type", type: "single_select", options: ["Full-time", "Part-time", "Contract", "Temp"] } },
      { moduleKey: "job", field: { label: "Pay range", type: "text" } },
      { moduleKey: "job", field: { label: "Openings count", type: "number" } },
      { moduleKey: "job", field: { label: "Client or hiring manager", type: "text" } },
      { moduleKey: "job", field: { label: "Ad campaign", type: "text" } },
      { moduleKey: "job", field: { label: "Target start", type: "date" } },
    ],
    pageLabelOverrides: {},
    customLcOffer: true,
    // The approved Interviews resolution (Option 1): Bookings VISIBLE,
    // relabeled at creation; the AI books interviews into it natively.
    moduleRelabels: {
      booking: { label: "Interview", labelPlural: "Interviews" },
      contact: { label: "Candidate", labelPlural: "Candidates" },
    },
    // RM-2 fills these; the shape ships EMPTY exactly like FS did pre-pack.
    // RM-2 — the RECRUITMENT MARKETING CONTENT PACK (the batch-22 hook engine,
    // byte-identical mechanism). Every widget uses a REAL type (kpi/list/pie/
    // line/bar), a REAL source (contacts/booking/calls), and KEYED fields
    // (candidate_source etc — RM-1's seeded FieldDefs; relabels never break
    // them). Date rules limited to the REAL ops (is/today/previous — no
    // "upcoming" op exists, so the interviews widget is a last-7-days window,
    // titled honestly).
    hooks: {
      ...EMPTY_HOOKS,
      libraryFlavor: "recruitment_marketing", // curation key -> LIBRARY_FLAVORS (presets.ts)
      dashboards: [
        {
          name: "__home__",
          widgets: [
            { id: "rm_home_new_candidates", title: "New candidates this week", type: "kpi", source: "contacts", measure: { op: "count" }, groupBy: [], series: [], filters: [{ field: "createdAt", op: "previous", value: 7, unit: "days", conj: "AND" }] },
            { id: "rm_home_by_source", title: "Candidates by source", type: "pie", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "candidate_source" }], series: [], filters: [] },
            { id: "rm_home_interviews", title: "Interviews (last 7 days)", type: "kpi", source: "booking", measure: { op: "count" }, groupBy: [], series: [], filters: [{ field: "appointmentAt", op: "previous", value: 7, unit: "days", conj: "AND" }] },
            { id: "rm_home_pipeline", title: "Pipeline snapshot", type: "pie", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "candidate_stage" }], series: [], filters: [] },
            { id: "rm_home_hired", title: "Hired candidates", type: "kpi", source: "contacts", measure: { op: "count" }, groupBy: [], series: [], filters: [{ field: "candidate_stage", op: "is", value: "Hired", conj: "AND" }] },
          ],
        },
      ],
      // Part C — three seeded ANALYTICS dashboards (names exactly as the
      // owner quoted them). No funnel type exists, so the conversions are
      // separate counted KPIs (flagged at R1) — but the client engine DOES
      // ship a real HEATMAP (reports.js kind "heatmap": groupBy × series
      // matrix), so "source × stage" is a first-class widget after all.
      // "Cancelled interviews" is real: booking record stages seed a
      // "cancelled" key (recordTypeService DEFAULT_BOOKING_RECORD_STAGES).
      analytics: [
        {
          name: "Candidate pipeline",
          widgets: [
            { id: "rm_pipe_stage_dist", title: "Candidates by stage", type: "pie", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "candidate_stage" }], series: [], filters: [] },
            { id: "rm_pipe_new_week", title: "New candidates per week", type: "line", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "week" }], series: [], filters: [] },
            { id: "rm_pipe_flow_time", title: "Pipeline over time (by week added)", type: "stacked", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "week" }], series: [{ key: "candidate_stage" }], filters: [] },
            { id: "rm_pipe_conv_new", title: "New leads (count)", type: "kpi", source: "contacts", measure: { op: "count" }, groupBy: [], series: [], filters: [{ field: "candidate_stage", op: "is", value: "New lead", conj: "AND" }] },
            { id: "rm_pipe_conv_interviewed", title: "Interviewed (count)", type: "kpi", source: "contacts", measure: { op: "count" }, groupBy: [], series: [], filters: [{ field: "candidate_stage", op: "is", value: "Interviewed", conj: "AND" }] },
          ],
        },
        {
          name: "Where candidates come from",
          widgets: [
            { id: "rm_src_over_time", title: "Candidates by source over time", type: "stacked", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "week" }], series: [{ key: "candidate_source" }], filters: [] },
            { id: "rm_src_share", title: "Source share", type: "pie", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "candidate_source" }], series: [], filters: [] },
            { id: "rm_src_stage_matrix", title: "Source × stage", type: "heatmap", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "candidate_source" }], series: [{ key: "candidate_stage" }], filters: [] },
            { id: "rm_src_hires", title: "Hires by source (the ad-ROI view)", type: "bar", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "candidate_source" }], series: [], filters: [{ field: "candidate_stage", op: "is", value: "Hired", conj: "AND" }] },
          ],
        },
        {
          name: "Interviews & calls",
          widgets: [
            { id: "rm_int_per_week", title: "Interviews per week", type: "line", source: "booking", measure: { op: "count" }, groupBy: [{ key: "appointmentAt", date: "week" }], series: [], filters: [] },
            { id: "rm_int_calls_week", title: "AI calls per week", type: "line", source: "calls", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "week" }], series: [], filters: [] },
            { id: "rm_int_cancelled", title: "Cancelled interviews", type: "kpi", source: "booking", measure: { op: "count" }, groupBy: [], series: [], filters: [{ field: "stageKey", op: "is", value: "cancelled", conj: "AND" }] },
            { id: "rm_int_no_show", title: "No-shows", type: "kpi", source: "booking", measure: { op: "count" }, groupBy: [], series: [], filters: [{ field: "stageKey", op: "is", value: "no_show", conj: "AND" }] },
          ],
        },
      ],
      // Part E1 — three email templates + ONE survey, created INACTIVE/draft
      // through templateService/surveyService. Merge tags limited to the ones
      // that actually resolve for contacts ({{name}}, {{business}},
      // {{appointment}} on appointment sends) — no invented tags.
      commDrafts: [
        { kind: "email", name: "Candidate welcome", subject: "Thanks for your interest, {{first_name}}", body: "<p>Hi {{first_name}},</p><p>Thanks for reaching out to {{business}} \u2014 we've got your details and a recruiter will follow up shortly. If there's a particular role or shift you're after, just reply here and tell us.</p><p>\u2014 {{business}}</p>" },
        { kind: "email", name: "Interview confirmation", subject: "Your interview is booked", body: "<p>Hi {{first_name}},</p><p>You're confirmed \u2014 we'll send the time, the address, and anything to bring. If the slot stops working, reply here and we'll move it.</p><p>\u2014 {{business}}</p>" },
        { kind: "email", name: "Post-interview thank you", subject: "Thanks for your time, {{first_name}}", body: "<p>Hi {{first_name}},</p><p>Thanks for interviewing with us. We're reviewing with the team and will come back to you with next steps shortly. Questions in the meantime? Just reply.</p><p>\u2014 {{business}}</p>" },
        { kind: "survey", name: "How was the process?", description: "A quick check-in with candidates about how hiring felt.", questions: [
          { type: "rating", label: "How would you rate the process overall?", required: true },
          { type: "yes_no", label: "Did you hear back as quickly as you expected?" },
          { type: "yes_no", label: "Was the role described accurately?" },
          { type: "long_text", label: "Anything we could do better?" },
        ] },
      ],
      // Part E2 — ONE seeded AI Instructions section (the "## <Name>"
      // sectioned-editor format). A SCAFFOLD the owner edits, phrased to
      // COMPOSE with the built-in prompt: it never contradicts the booking /
      // scheduling-target blocks (RM books interviews natively) and adds the
      // recruiting never-promise rules.
      aiInstructionSections: [
        {
          name: "Recruiting context",
          body: [
            "We are a recruitment marketing agency. Edit this section so the receptionist knows the basics:",
            "- What we recruit for: (e.g. warehouse, driving, and light-industrial roles across the region)",
            "- How candidates reach us: (usually an ad or an interest form, so most callers are asking about a role they saw)",
            "- Interviews: book callers into an interview slot and confirm the time back to them.",
            "- Never promise a job offer, a pay rate, a start date, or name a client company unless we've told you to.",
            "- Tone: warm and plain \u2014 candidates are job hunting, so be encouraging and never pushy.",
          ].join("\n"),
        },
      ],
    },
  },
  // ==========================================================================
  // FOOD SERVICE — the fifth first-class template (restaurants, caterers, food
  // trucks). Built in CODE alongside the other four, not on the builder screen,
  // because it carries the things the builder deliberately cannot: its own
  // automation-library flavour, its own Learning Center pack, its own dashboards
  // and a bespoke glyph.
  //
  // RELABELS, NOT NEW MODULES. A reservation IS a booking (a time and a party),
  // a menu item IS a product (Products already ships sku/price/unit/category),
  // a catering quote IS an estimate. Inventing system modules for these would be
  // a far larger commitment for no capability. The one genuine gap is a takeaway
  // ORDER; estimates carry it acceptably (line items, totals) and a real Orders
  // module belongs in its own batch rather than smuggled into this one.
  {
    key: "food_service",
    label: "Food Service",
    description: "For restaurants, caterers and food trucks: calls become reservations and catering quotes, with a menu behind them.",
    pagesOffPrefill: [], // all pages on
    // A kitchen dispatches nothing: no work orders, no equipment fleet, no
    // vehicles or properties, no recruiting pipeline, no service plans.
    modulesHiddenPrefill: ["work_order", "equipment", "vehicle", "property", "job", "service_plan"],
    aiVoiceMode: null, // the hub picker still decides
    aiSchedulingTarget: "booking", // = Reservations after the relabel below
    // FALSE, and this is the settings-level difference between this receptionist
    // and a contractor's: a restaurant's phone takes a reservation or answers a
    // question. It does not triage a fault, which is what service-request intake
    // is for.
    aiIntake: false,
    fieldTweaks: [
      { moduleKey: "booking", field: { label: "Party size", type: "number" } },
      { moduleKey: "booking", field: { label: "Seating preference", type: "single_select", options: ["No preference", "Indoors", "Outdoors", "Bar", "Quiet table", "Accessible"] } },
      { moduleKey: "booking", field: { label: "Occasion", type: "single_select", options: ["None", "Birthday", "Anniversary", "Business", "Celebration", "Other"] } },
      { moduleKey: "contact", field: { label: "Allergies", type: "multi_select", options: ["Peanuts", "Tree nuts", "Dairy", "Eggs", "Gluten", "Shellfish", "Fish", "Soy", "Sesame"] } },
      { moduleKey: "contact", field: { label: "Dietary notes", type: "text" } },
      { moduleKey: "estimate", field: { label: "Headcount", type: "number" } },
      { moduleKey: "estimate", field: { label: "Service style", type: "single_select", options: ["Drop-off", "Buffet", "Plated", "Family style", "Food truck", "Cocktail"] } },
      { moduleKey: "estimate", field: { label: "Event date", type: "date" } },
    ],
    pageLabelOverrides: {},
    customLcOffer: true,
    moduleRelabels: {
      booking: { label: "Reservation", labelPlural: "Reservations" },
      product: { label: "Menu item", labelPlural: "Menu" },
      estimate: { label: "Catering quote", labelPlural: "Catering quotes" },
      task: { label: "Prep task", labelPlural: "Prep tasks" },
    },
    hooks: {
      // The home row, in the order someone running a service actually looks:
      // what is happening today, then how the week is filling, then the money
      // waiting on a decision, then the phone.
      dashboards: [
        {
          name: "__home__",
          widgets: [
            { id: "food_home_today", title: "Today's reservations", type: "list", source: "booking", measure: { op: "count" }, groupBy: [], series: [], columns: ["title", "appointmentAt", "stageKey"], filters: [{ field: "appointmentAt", op: "today", value: "", conj: "AND" }] },
            { id: "food_home_week_covers", title: "Reservations this week", type: "kpi", source: "booking", measure: { op: "count" }, groupBy: [], series: [], filters: [{ field: "appointmentAt", op: "previous", value: "7", conj: "AND" }] },
            { id: "food_home_quotes", title: "Catering quotes by stage", type: "pie", source: "estimate", measure: { op: "count" }, groupBy: [{ key: "stageKey" }], series: [], filters: [] },
            { id: "food_home_calls", title: "Calls answered (last 7 days)", type: "kpi", source: "calls", measure: { op: "count" }, groupBy: [], series: [], filters: [{ field: "createdAt", op: "previous", value: "7", conj: "AND" }] },
          ],
        },
      ],
      analytics: [
        {
          name: "Covers & reservations",
          widgets: [
            { id: "food_an_res_by_day", title: "Reservations by day", type: "bar", source: "booking", measure: { op: "count" }, groupBy: [{ key: "appointmentAt" }], series: [], filters: [] },
            { id: "food_an_party", title: "Average party size", type: "kpi", source: "booking", measure: { op: "avg", field: "party_size" }, groupBy: [], series: [], filters: [] },
            { id: "food_an_occasion", title: "Reservations by occasion", type: "pie", source: "booking", measure: { op: "count" }, groupBy: [{ key: "occasion" }], series: [], filters: [] },
          ],
        },
        {
          name: "Catering",
          widgets: [
            { id: "food_an_quote_value", title: "Quoted value by stage", type: "bar", source: "estimate", measure: { op: "sum", field: "total" }, groupBy: [{ key: "stageKey" }], series: [], filters: [] },
            { id: "food_an_service_style", title: "Jobs by service style", type: "pie", source: "estimate", measure: { op: "count" }, groupBy: [{ key: "service_style" }], series: [], filters: [] },
          ],
        },
      ],
      libraryFlavor: "food_service",
      commDrafts: [],
      aiInstructionSections: [],
    },
  },
];

export function getTemplate(key?: string | null): TenantTemplate | null {
  if (!key) return null;
  return TENANT_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** Boot-time validation: template constants must be internally coherent. Throws
 *  on developer error (a bad template must never ship silently). */
export function validateTemplates(registryKeys: string[]): void {
  const seen = new Set<string>();
  for (const t of TENANT_TEMPLATES) {
    if (!t.key || seen.has(t.key)) throw new Error(`tenant template key invalid/duplicate: "${t.key}"`);
    seen.add(t.key);
    for (const k of t.modulesHiddenPrefill) if (!registryKeys.includes(k)) throw new Error(`template "${t.key}" hides unknown module "${k}"`);
    for (const tw of t.fieldTweaks) if (!registryKeys.includes(tw.moduleKey)) throw new Error(`template "${t.key}" tweaks unknown module "${tw.moduleKey}"`);
    for (const k of Object.keys(t.moduleRelabels || {})) if (!registryKeys.includes(k)) throw new Error(`template "${t.key}" relabels unknown module "${k}"`);
    for (const href of Object.keys(t.pageLabelOverrides || {})) if (!/^#\//.test(href)) throw new Error(`template "${t.key}" label-override key "${href}" is not an href`);
    if (!t.hooks || !Array.isArray(t.hooks.dashboards)) throw new Error(`template "${t.key}" missing the hook shape`);
  }
  if (!seen.has("general")) throw new Error("the general template must exist");
}

/** SERVER PHASE — everything that isn't a wizard checkbox. Runs INSIDE tenant
 *  creation (createPortal), after the row exists. Field tweaks go through the
 *  REAL field service (validation, audit) and require the module seeded first;
 *  templates WITHOUT tweaks trigger zero extra queries (General's creation is
 *  byte-identical by construction). Never throws — a template problem logs
 *  loudly and leaves a working tenant (the wizard's collect-don't-explode rule). */
export async function applyTemplateAtCreation(tenantId: string, template: TenantTemplate): Promise<void> {
  try {
    if (template.fieldTweaks.length) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { listRecordTypes } = require("./recordTypeService");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createField } = require("./fieldService");
      await listRecordTypes(tenantId); // seed the modules the tweaks land on
      for (const tw of template.fieldTweaks) {
        try {
          // RM-1: seed-only-if-ABSENT by derived key (createField suffixes
          // duplicates rather than skipping — the guard keeps collisions with
          // stock fields from double-creating; owners' fields are never touched).
          const derivedKey = String(tw.field.label).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { resolveRecordTypeId } = require("./recordTypeService");
          const rtId = await resolveRecordTypeId(tenantId, tw.moduleKey);
          const already = await (prisma as any).fieldDef.findFirst({ where: { tenantId, recordTypeId: rtId, key: derivedKey }, select: { id: true } });
          if (already) continue;
          await createField(tenantId, tw.field as any, tw.moduleKey);
        } catch (e) {
          logger.error(`[templates] tweak "${tw.field.label}" on ${tw.moduleKey} failed for ${tenantId}: ${(e as Error).message}`);
        }
      }
    }
    // ---- BUILDER: modules the template declares that do not exist yet ----
    // Created through the REAL record-type service, so they are ordinary modules with their
    // own page, fields and permissions - exactly what "+ Add module" promises.
    const newModules = (template as any).newModules || [];
    // THE SERVER RE-DERIVES THE KEY from the label, so the key a blueprint stores is a
    // PREDICTION, not an instruction. Everything below keys off what was actually created:
    // the de-duplication check, and the nav order written afterwards. Trusting the blueprint's
    // key would silently order a module that does not exist under that name.
    const createdKeyFor: Record<string, string> = {};
    if (newModules.length) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createRecordType, listRecordTypes: listRT } = require("./recordTypeService");
      for (const m of newModules) {
        const before = new Set(((await listRT(tenantId)) || []).map((t: any) => t.key));
        // A module whose LABEL already exists is not created twice.
        const already = ((await listRT(tenantId)) || []).find((t: any) => String(t.label || "").toLowerCase() === String(m.label || "").toLowerCase());
        if (already) { createdKeyFor[m.key] = already.key; continue; }
        try {
          const made = await createRecordType(tenantId, m.label, m.labelPlural);
          const key = (made && made.key) || ((await listRT(tenantId)) || []).map((t: any) => t.key).find((k: string) => !before.has(k));
          if (key) createdKeyFor[m.key] = key;
        } catch (e) { logger.warn(`template ${template.key}: could not create module ${m.label}: ${(e as Error).message}`); }
      }
    }

    // ---- BUILDER: the nav ORDER a new tenant starts with ----
    // Written into the SAME labels.nav JSON the Pages editor uses, so it is an ordinary
    // reorder the owner can change afterwards - not a second mechanism.
    const moduleOrder = (template as any).moduleOrder || [];
    if (moduleOrder.length) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { recordTypeHref } = require("./recordTypeService");
        const row: any = await (prisma as any).tenant.findUnique({ where: { id: tenantId }, select: { labels: true } });
        const labels = (row && row.labels) || {};
        const nav = labels.nav || {};
        await (prisma as any).tenant.update({
          where: { id: tenantId },
          // Map through the ACTUAL created keys, and drop anything that was not created.
          data: { labels: { ...labels, nav: { ...nav, order: moduleOrder.map((k: string) => createdKeyFor[k] || k).map((k: string) => recordTypeHref(k)), hidden: nav.hidden || [], labels: nav.labels || {} } } },
        });
      } catch (e) { logger.warn(`template ${template.key}: could not set module order: ${(e as Error).message}`); }
    }

    // ---- BUILDER: per-module VIEWS and PIPELINE ----
    // Written straight onto the record type, because every one of these is a RecordType
    // column. That is what makes a template-made pipeline identical to a hand-built one -
    // there is no separate representation to drift.
    const moduleViews = (template as any).moduleViews || {};
    if (Object.keys(moduleViews).length) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { listRecordTypes: listRT2 } = require("./recordTypeService");
      const live = (await listRT2(tenantId)) || [];
      for (const [k, cfg] of Object.entries(moduleViews as Record<string, any>)) {
        const key = createdKeyFor[k] || k;
        const rt = live.find((t: any) => t.key === key);
        if (!rt || !cfg) continue;
        const data: any = {};
        if (Array.isArray(cfg.enabledViews)) data.enabledViews = cfg.enabledViews;
        if (typeof cfg.pipelineEnabled === "boolean") data.pipelineEnabled = cfg.pipelineEnabled;
        if (cfg.calendarDateField !== undefined) data.calendarDateField = cfg.calendarDateField;
        if (typeof cfg.calendarLanes === "boolean") data.calendarLanes = cfg.calendarLanes;
        if (typeof cfg.calendarTray === "boolean") data.calendarTray = cfg.calendarTray;
        // The three lists are stored as-is; each entry gets a key derived from its label the
        // same way the tenant screen derives one, so the shapes match exactly.
        const withKeys = (rows: any[]) => (rows || []).filter((r) => r && r.label).map((r) => ({
          key: r.key || String(r.label).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40),
          label: String(r.label),
        }));
        if (Array.isArray(cfg.subtypes)) data.subtypes = withKeys(cfg.subtypes);
        if (Array.isArray(cfg.stages)) data.stages = withKeys(cfg.stages);
        if (Array.isArray(cfg.recordStages)) data.recordStages = withKeys(cfg.recordStages);
        if (!Object.keys(data).length) continue;
        try { await (prisma as any).recordType.update({ where: { id: rt.id }, data }); }
        catch (e) { logger.warn(`template ${template.key}: could not configure ${key}: ${(e as Error).message}`); }
      }
    }

    // ---- RM-1: template-scoped module RELABELS (stock-label-only) ----
    const relabels = Object.entries(template.moduleRelabels || {});
    if (relabels.length) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { listRecordTypes, SYSTEM_RECORD_TYPES } = require("./recordTypeService");
      await listRecordTypes(tenantId); // ensure the rows exist
      for (const [key, to] of relabels) {
        try {
          const stock = (SYSTEM_RECORD_TYPES.find((d: any) => d.key === key) || {}).defaults || {};
          // The batch-8 guard: only a row STILL ON the stock label is touched.
          await prisma.recordType.updateMany({
            where: { tenantId, key, label: String(stock.label || "") },
            data: { label: to.label, labelPlural: to.labelPlural },
          });
        } catch (e) {
          logger.error(`[templates] relabel "${key}" failed for ${tenantId}: ${(e as Error).message}`);
        }
      }
    }
    // ---- CONTENT PACK: dashboards (tenant-templates-2) ----
    // Rides dashboardService only. Idempotent: the home row is filled ONLY when
    // empty; a named dashboard is skipped when one with that name exists.
    const dashSeeds = [...(template.hooks.dashboards || []), ...(template.hooks.analytics || [])];
    if (dashSeeds.length) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dashSvc = require("./dashboardService");
      for (const seed of dashSeeds) {
        try {
          if (seed.name === "__home__") {
            const home = await dashSvc.getOrCreateHomeDashboard(tenantId, null);
            const cur = Array.isArray(home.widgets) ? home.widgets : [];
            if (cur.length === 0) await dashSvc.updateDashboard(home.id, tenantId, { widgets: seed.widgets });
          } else {
            const existing = (await dashSvc.listDashboards(tenantId)).find((d: any) => d.name === seed.name);
            if (!existing) {
              const d = await dashSvc.createDashboard(tenantId, seed.name, null);
              await dashSvc.updateDashboard(d.id, tenantId, { widgets: seed.widgets });
            }
          }
        } catch (e) {
          logger.error(`[templates] dashboard seed "${seed.name}" failed for ${tenantId}: ${(e as Error).message}`);
        }
      }
    }
    // ---- CONTENT PACK: communication drafts (email templates + one survey) ----
    // templateService/surveyService only. Idempotent by NAME per kind.
    for (const d of (template.hooks.commDrafts || []) as any[]) {
      try {
        if (d.kind === "survey") {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { listSurveys, upsertSurvey } = require("./surveyService");
          const existing = (await listSurveys(tenantId)).find((sv: any) => sv.name === d.name);
          if (!existing) await upsertSurvey({ tenantId, name: d.name, description: d.description ?? null, status: "draft", mapTargetType: "contact", questions: d.questions || [] });
        } else {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { listTemplates, createTemplate } = require("./templateService");
          const existing = (await listTemplates(tenantId)).find((t: any) => t.name === d.name && (t.kind || "email") === d.kind);
          if (!existing) await createTemplate({ tenantId, name: d.name, kind: d.kind, subject: d.subject ?? null, body: d.body ?? "" });
        }
      } catch (e) {
        logger.error(`[templates] comm draft "${d.name}" failed for ${tenantId}: ${(e as Error).message}`);
      }
    }

    // ---- CONTENT PACK: AI Instructions sections ----
    // Appends "## <Name>" sections to the ONE stored aiInstructions field (the
    // sectioned-editor format). Idempotent by heading; never rewrites what an
    // owner typed.
    const aiSections = (template.hooks.aiInstructionSections || []) as any[];
    if (aiSections.length) {
      try {
        const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiInstructions: true } as any });
        let text = String((row as any)?.aiInstructions || "");
        let changed = false;
        for (const sec of aiSections) {
          const heading = "## " + String(sec.name || "").trim();
          if (!heading.slice(3).trim()) continue;
          if (new RegExp("^##\\s*" + heading.slice(3).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "m").test(text)) continue;
          text = (text.trim() ? text.replace(/\s+$/, "") + "\n\n" : "") + heading + "\n" + String(sec.body || "").trim() + "\n";
          changed = true;
        }
        if (changed) await prisma.tenant.update({ where: { id: tenantId }, data: { aiInstructions: text } as any });
      } catch (e) {
        logger.error(`[templates] AI section seed failed for ${tenantId}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    logger.error(`[templates] applying "${template.key}" to ${tenantId} failed: ${(e as Error).message}`);
  }
}

// Boot-time self-check (runs on first load — always after the registry module
// exists, since this module is only ever loaded lazily by the creation path or
// the suite). A bad template constant fails FAST and loudly.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SYSTEM_RECORD_TYPES } = require("./recordTypeService");
validateTemplates(SYSTEM_RECORD_TYPES.map((d: { key: string }) => d.key));

// ===========================================================================
// TEMPLATE BUILDER (part 1) — code templates and BUILT templates, one shape.
// ===========================================================================
//
// The four built-ins above stay exactly as they are. Everything here is ADDITIVE: a built
// template is a TenantTemplateRow whose `spec` is the same object shape, and the resolver
// hands both kinds to the same downstream code, which cannot tell them apart.
//
// WHY getTemplate() BELOW IS UNCHANGED AND SYNCHRONOUS: eleven self-tests call it directly,
// and so do several places that only ever want a built-in. Making it async would have churned
// all of them for no gain. The DB-aware resolver is a SEPARATE async function, and only the
// four production call sites that must see built templates use it.

/** Keys that a built template may never take. */
export function reservedTemplateKeys(): string[] {
  return TENANT_TEMPLATES.map((t) => t.key);
}

/** "Food Service" -> "food_service". Stable: the key never changes once saved. */
export function slugTemplateKey(label: string): string {
  return String(label || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "template";
}

/**
 * A built template's spec, normalised into the SAME shape a code template has.
 *
 * Anything missing falls back to the empty/neutral value, so a spec saved by an older
 * version of the builder still produces a valid template rather than throwing downstream.
 *
 * ON HOOKS, FOR WHOEVER PICKS THIS UP NEXT: hooks are DATA, not functions. They are plain
 * JSON - widget definitions with ids, sources and filters - so a built template COULD carry
 * dashboards, analytics and comm drafts. It does not yet because nothing on the builder
 * screen authors them, which is a deferred SCOPE CHOICE and not a technical limit. Do not
 * rediscover this the hard way: the storage is already shaped to hold them.
 *
 * libraryFlavor IS THE EXCEPTION and the one genuinely code-bound field. It names a curation
 * that lives in src/automation/presets.ts, so it is validated against LIBRARY_FLAVORS here
 * and offered as a PICKER on the screen. It must never become free text: an invented key
 * would silently do nothing at all.
 */
export function specToTemplate(row: { key: string; label: string; description: string; spec: any }): TenantTemplate {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isLibraryFlavor } = require("../automation/presets");
  const s = (row.spec || {}) as any;
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const obj = (v: any) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return {
    key: row.key,
    label: row.label,
    description: row.description,
    pagesOffPrefill: arr(s.pagesOffPrefill),
    modulesHiddenPrefill: arr(s.modulesHiddenPrefill),
    aiVoiceMode: s.aiVoiceMode ?? null,
    aiSchedulingTarget: s.aiSchedulingTarget ?? null,
    aiIntake: s.aiIntake ?? null,
    fieldTweaks: arr(s.fieldTweaks),
    pageLabelOverrides: obj(s.pageLabelOverrides),
    customLcOffer: !!s.customLcOffer,
    moduleRelabels: obj(s.moduleRelabels),
    // BUILDER-ONLY AND CONDITIONAL. These keys appear only when the blueprint actually
    // declares them, so a template that declares neither comes out with EXACTLY the key set a
    // code template has - which is the "nothing downstream can tell them apart" guarantee, and
    // it is asserted. Every consumer reads them as `|| []`, so a template that DOES declare
    // one is still indistinguishable in behaviour.
    ...(arr(s.moduleOrder).length ? { moduleOrder: arr(s.moduleOrder) } : {}),
    ...(s.moduleViews && Object.keys(obj(s.moduleViews)).length ? { moduleViews: obj(s.moduleViews) } : {}),
    ...(arr(s.newModules).filter((m: any) => m && m.key && m.label).length
      ? { newModules: arr(s.newModules).filter((m: any) => m && m.key && m.label) } : {}),
    hooks: {
      ...EMPTY_HOOKS,
      // Validated, never trusted: anything that is not a real flavour becomes null, which
      // applyLibraryFlavor already treats as "no curation".
      libraryFlavor: isLibraryFlavor(s.libraryFlavor) ? String(s.libraryFlavor) : null,
    },
  } as TenantTemplate;
}

/**
 * THE ONE RESOLVER. Code first, then the table.
 *
 * Code wins on a collision, always - a built row can never shadow a built-in, and the builder
 * refuses such a key at save time so the situation should not arise. Belt and braces, because
 * a shadowed built-in would silently change what every tenant made from it receives.
 */
export async function resolveTemplate(key: string | null | undefined): Promise<TenantTemplate | null> {
  if (!key) return null;
  const built = getTemplate(key);
  if (built) return built;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prisma } = require("../db/client");
    // NO deletedAt FILTER, on purpose. "Deleted" means no longer available to USE - it does
    // not mean erased. A tenant created from this template still resolves it, so its
    // automation-library ordering and Learning Center variant keep working exactly as before
    // the deletion. Adding a filter here would silently change an existing tenant.
    const row = await (prisma as any).tenantTemplateRow.findUnique({ where: { key: String(key) } });
    return row ? specToTemplate(row) : null;
  } catch { return null; }
}

/** Every template the wizard should offer: the four built-ins, then the built ones. */
export async function listAllTemplates(): Promise<TenantTemplate[]> {
  const out: TenantTemplate[] = [...TENANT_TEMPLATES];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prisma } = require("../db/client");
    // DELETED ROWS ARE HIDDEN HERE and only here. resolveTemplate below deliberately still
    // finds them, so a tenant created from a deleted template carries on exactly as it is.
    const rows = await (prisma as any).tenantTemplateRow.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
    const reserved = new Set(reservedTemplateKeys());
    for (const r of rows) if (!reserved.has(r.key)) out.push(specToTemplate(r));
  } catch { /* no table yet, or no database: the built-ins alone are a valid answer */ }
  return out;
}
