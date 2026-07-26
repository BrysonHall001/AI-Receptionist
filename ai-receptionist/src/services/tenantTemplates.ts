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
  hooks: TemplateHooks;
}

const EMPTY_HOOKS: TemplateHooks = { dashboards: [], analytics: [], libraryFlavor: null, commDrafts: [], aiInstructionSections: [] };

export const TENANT_TEMPLATES: TenantTemplate[] = [
  {
    key: "general",
    label: "General",
    description: "A blank, everything-on workspace \u2014 exactly what Create has always made.",
    // PRIME DIRECTIVE: byte-identical to today. No prefill, no server phase
    // beyond stamping the key: creating with General (or touching nothing)
    // produces the exact same tenant state as before this batch.
    pagesOffPrefill: [],
    modulesHiddenPrefill: [],
    aiVoiceMode: null,
    aiSchedulingTarget: null,
    aiIntake: null,
    fieldTweaks: [],
    pageLabelOverrides: {},
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
          await createField(tenantId, tw.field as any, tw.moduleKey);
        } catch (e) {
          logger.error(`[templates] tweak "${tw.field.label}" on ${tw.moduleKey} failed for ${tenantId}: ${(e as Error).message}`);
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
