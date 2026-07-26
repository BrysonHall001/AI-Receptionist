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

export interface TemplateFieldTweak {
  /** Module key the tweak lands on (must be a registry key). */
  moduleKey: string;
  /** A fieldService.createField input — the REAL creation path, full validation. */
  field: { label: string; type: string; required?: boolean; options?: any };
}

/** Content-pack HOOKS (D2). The SHAPE ships now; every template ships them
 *  EMPTY. A later batch fills them; the engine already carries them so packs
 *  need no schema change. */
export interface TemplateHooks {
  dashboards: unknown[];
  analytics: unknown[];
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
    hooks: { ...EMPTY_HOOKS },
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
    // Hooks ship EMPTY — nothing to apply until a content-pack batch fills them.
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
