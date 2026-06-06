// Flow provisioning — the single, reusable "apply a flow definition -> a new
// DRAFT automation in the builder" step.
//
// This is deliberately INDEPENDENT of the presets UI: it takes a plain
// FlowDefinition (name + trigger + conditions + actions) and creates an
// inactive automation from it using the EXISTING automations schema and the
// EXISTING createAutomation() service. Nothing here references presets, so the
// later branching wizard can build a FlowDefinition in memory and call
// applyFlowDefinition() to land its result the exact same way.
//
// Guarantees this function is responsible for:
//   1. DRAFT ONLY. The automation is always created with enabled:false. The
//      automation engine and the daily scheduled-job sweep both query
//      `enabled:true` only, so an applied flow can NEVER fire on its own until
//      a human turns it on in the builder.
//   2. Tenant-scoped. Everything is written under the tenantId it is given;
//      callers resolve that from the auth scope.
//   3. Re-apply safety. Applying the same definition twice makes a distinctly
//      named copy ("Name (2)") instead of overwriting anything.
//   4. Missing-field safety. It reports which custom fields the definition
//      references that don't exist in this portal, WITHOUT erroring, so the UI
//      can flag them. It never assumes a custom field exists.
//   5. Comms-safe. It only writes a DB row; it never calls Resend/Twilio, so an
//      un-deployed comms channel cannot cause an error on apply.

import { prisma } from "../db/client";
import { createAutomation } from "./automationService";
import { loadFieldDefs, SYSTEM_FIELDS } from "../automation/contactRow";

const db = prisma as any;

// A flow definition is the minimal, schema-aligned description of an automation.
// It matches what createAutomation()/the builder already accept.
export interface FlowDefinition {
  name: string;
  triggerType: string;
  conditions?: any[];
  actions?: { type: string; config?: Record<string, any> }[];
}

export interface FieldExpectation {
  key: string;
  label: string; // the portal's field label if present, else the raw key
  present: boolean;
}

export interface FlowAnalysis {
  expected: FieldExpectation[]; // every custom field the definition references
  missing: FieldExpectation[]; // the subset not present in this portal
}

export interface ApplyResult {
  automation: any; // the serialized DRAFT automation (enabled:false)
  analysis: FlowAnalysis;
  requestedName: string;
  nameChanged: boolean; // true if the name was suffixed to avoid a duplicate
}

// Standard fields that are guaranteed to exist on every contact in every portal.
// Anything outside this set is a per-portal custom field that may be absent.
const STANDARD_KEYS = new Set<string>([...SYSTEM_FIELDS.map((f) => f.key), "createdAt"]);

/**
 * Collect the CUSTOM field keys a definition depends on (system fields are
 * filtered out, since they always exist). Looks in the trigger (FieldChanged /
 * Scheduled encode a field key in the string), the conditions, and the actions.
 */
export function referencedFieldKeys(def: FlowDefinition): string[] {
  const keys = new Set<string>();
  const add = (k: any) => {
    if (k && typeof k === "string") keys.add(k);
  };

  const tt = def.triggerType || "";
  if (tt.indexOf("FieldChanged:") === 0) add(tt.slice("FieldChanged:".length));
  else if (tt.indexOf("Scheduled:") === 0) add(tt.slice("Scheduled:".length).split(":")[0]);

  for (const r of def.conditions || []) add(r && (r as any).field);

  for (const a of def.actions || []) {
    const c = (a && a.config) || {};
    if (a.type === "update_field" || a.type === "add_tag" || a.type === "remove_tag") add(c.field);
    if (a.type === "compute_field") {
      add(c.source);
      add(c.dest);
    }
    if (a.type === "create_record" || a.type === "update_record") {
      for (const v of Array.isArray(c.values) ? c.values : []) add(v && v.field);
    }
    if (a.type === "search_records") {
      for (const r of Array.isArray(c.conditions) ? c.conditions : []) add(r && r.field);
    }
  }

  return [...keys].filter((k) => !STANDARD_KEYS.has(k));
}

/**
 * Compare a definition's referenced custom fields against the fields that
 * actually exist in this portal. Pure read; writes nothing.
 */
export async function analyzeFlowDefinition(tenantId: string, def: FlowDefinition): Promise<FlowAnalysis> {
  const custom = await loadFieldDefs(tenantId); // [{ key, label, type }]
  const byKey = new Map(custom.map((f) => [f.key, f]));
  const expected: FieldExpectation[] = referencedFieldKeys(def).map((key) => {
    const f = byKey.get(key);
    return { key, label: f ? f.label : key, present: !!f };
  });
  return { expected, missing: expected.filter((e) => !e.present) };
}

/** Preview a definition without applying it (alias for analyze). */
export async function previewFlowDefinition(tenantId: string, def: FlowDefinition): Promise<FlowAnalysis> {
  return analyzeFlowDefinition(tenantId, def);
}

/**
 * Find a name not already used by an automation in this tenant. If "Name" is
 * taken, returns "Name (2)", then "Name (3)", and so on — never overwrites.
 */
export async function uniqueAutomationName(tenantId: string, base: string): Promise<string> {
  const name = (base || "Untitled automation").trim() || "Untitled automation";
  const existing = await db.automation.findMany({ where: { tenantId }, select: { name: true } });
  const taken = new Set<string>(existing.map((a: any) => a.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

/**
 * THE reusable step. Apply a flow definition -> a new DRAFT automation for the
 * given tenant, returning the created record plus the missing-field analysis.
 * Always inactive (enabled:false). The presets routes call this; the future
 * wizard will call this too.
 */
export async function applyFlowDefinition(
  tenantId: string,
  def: FlowDefinition,
  createdById?: string | null,
): Promise<ApplyResult> {
  const requestedName = (def.name || "Untitled automation").trim() || "Untitled automation";
  const name = await uniqueAutomationName(tenantId, requestedName);
  const analysis = await analyzeFlowDefinition(tenantId, def);

  // enabled:false is the load-bearing guarantee here — see the file header.
  const automation = await createAutomation(
    tenantId,
    {
      name,
      triggerType: def.triggerType,
      conditions: (def.conditions ?? []) as any,
      actions: (def.actions ?? []) as any,
      enabled: false,
    },
    createdById ?? null,
  );

  return { automation, analysis, requestedName, nameChanged: name !== requestedName };
}
