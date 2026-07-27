// EMERGENT LAYER 2 — THE ACTION REGISTRY.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a suggestion never writes configuration.
// Every action here is a thin wrapper over the SAME service function the normal
// UI calls, so accepting a suggestion runs the same validation, the same
// permission checks, and emits the same audit events as doing it by hand. If an
// action can't be expressed as a call to an existing service, it doesn't ship.
//
//   create_field       -> fieldService#createField        (Modules & Fields' own writer)
//   apply_preset_draft -> flowProvisioningService#applyFlowDefinition (lands DISABLED)
//   hide_module        -> portalService#setTenantNav      (the reversible nav-hide)
//   none               -> informational only; no writer at all
import { Right } from "./permissionService";

export interface ActionContext { tenantId: string; userId: string; role: string; customRoleId?: string | null }
export interface ActionResult { ok: true; outcome: string; link?: string | null }

export interface ActionDef {
  type: string;
  /** The concrete verb the card's primary button shows. */
  verb: string;
  requiredArea: string | null;
  requiredRight: Right;
  /** Returns an error string when the params are unusable. */
  validate: (params: any) => string | null;
  /** Calls an EXISTING service. Never touches the DB directly. */
  run: (ctx: ActionContext, params: any) => Promise<ActionResult>;
}

const ACTIONS: ActionDef[] = [
  {
    type: "create_field",
    verb: "Add the field",
    requiredArea: "records",
    requiredRight: "edit",
    validate: (p) => {
      if (!p || typeof p.label !== "string" || !p.label.trim()) return "A field label is required.";
      if (typeof p.moduleKey !== "string" || !p.moduleKey.trim()) return "A module is required.";
      if (p.type && typeof p.type !== "string") return "Invalid field type.";
      return null;
    },
    run: async (ctx, p) => {
      // The module must actually EXIST for this tenant. resolveRecordTypeId
      // falls back to Contacts for an unknown key (its long-standing
      // behaviour), so without this check a stale suggestion could land a field
      // on the wrong module. Validation is the registry's job — a read, never
      // a write.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { listRecordTypes } = require("./recordTypeService");
      const types = await listRecordTypes(ctx.tenantId);
      if (!(types as any[]).some((t: any) => t.key === String(p.moduleKey))) throw new Error("That module no longer exists.");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createField } = require("./fieldService");
      const f = await createField(ctx.tenantId, { label: String(p.label).trim(), type: String(p.type || "text") } as any, String(p.moduleKey));
      return { ok: true, outcome: `Added “${f.label}” to ${p.moduleLabel || p.moduleKey}`, link: "#/settings/fields" };
    },
  },
  {
    type: "apply_preset_draft",
    verb: "Create the draft",
    requiredArea: "automations",
    requiredRight: "edit",
    validate: (p) => (p && typeof p.presetKey === "string" && p.presetKey.trim() ? null : "A library recipe is required."),
    run: async (ctx, p) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getPreset } = require("../automation/presets");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { applyFlowDefinition } = require("./flowProvisioningService");
      const preset = getPreset(String(p.presetKey));
      if (!preset) throw new Error("That recipe no longer exists.");
      await applyFlowDefinition(ctx.tenantId, preset.definition, ctx.userId);
      // applyFlowDefinition creates flows DISABLED — accepting a suggestion can
      // never switch automation on, only put a draft in front of the owner.
      return { ok: true, outcome: `Created the draft “${preset.definition.name}” — switched off until you say so`, link: "#/automations" };
    },
  },
  {
    type: "hide_module",
    verb: "Hide it",
    requiredArea: "records",
    requiredRight: "edit",
    validate: (p) => (p && typeof p.href === "string" && p.href.startsWith("#/") ? null : "A module is required."),
    run: async (ctx, p) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { setTenantNav, getPortal } = require("./portalService");
      const portal: any = await getPortal(ctx.tenantId);
      const nav = ((portal && portal.labels) || {}).nav || {};
      const hidden: string[] = Array.isArray(nav.hidden) ? nav.hidden.slice() : [];
      if (!hidden.includes(p.href)) hidden.push(p.href);
      await setTenantNav(ctx.tenantId, { order: Array.isArray(nav.order) ? nav.order : [], hidden, labels: nav.labels || {} });
      return { ok: true, outcome: `Hid ${p.moduleLabel || p.href} — turn it back on any time in Settings`, link: "#/settings/fields" };
    },
  },
  {
    type: "none",
    verb: "Got it",
    requiredArea: null,
    requiredRight: "view",
    validate: () => null,
    run: async () => ({ ok: true, outcome: "Noted", link: null }),
  },
];

const BY_TYPE = new Map<string, ActionDef>(ACTIONS.map((a) => [a.type, a]));
export function getAction(type: string): ActionDef | null { return BY_TYPE.get(String(type)) || null; }
export function actionTypes(): string[] { return ACTIONS.map((a) => a.type); }
export { ACTIONS as SUGGESTION_ACTIONS };
