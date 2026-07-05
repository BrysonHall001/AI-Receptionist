// Drip service — visual builder + compile/activate. A Drip stores a graph of nodes + edges.
//   • Linear drip  -> one Automation (Drip.automationId), updated in place on edit (slice 2).
//   • Branched drip -> a PAIR of automations landed via the engine's applyFlowDefinition, sharing a
//     pairId (Drip.pairId); Drip.automationId points at the "if" half. Both carry dripId = drip.id
//     so the Automations screen can label + link them.
// Tenant-scoped throughout.
import { prisma } from "../db/client";
import { compileDrip, type CompileResult } from "./dripCompiler";
import { createAutomation, updateAutomation, deleteAutomation } from "./automationService";
import { applyFlowDefinition } from "./flowProvisioningService";
import { randomUUID } from "crypto";

const db = prisma as any;

export interface DripDTO {
  id: string; name: string; enabled: boolean; status: string; graph: any;
  automationId: string | null; pairId: string | null; createdAt: string; updatedAt: string;
}

function toDTO(d: any): DripDTO {
  return {
    id: d.id, name: d.name, enabled: !!d.enabled, status: d.status,
    graph: d.graph ?? { nodes: [], edges: [] },
    automationId: d.automationId ?? null, pairId: d.pairId ?? null,
    createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  };
}

function normalizeGraph(graph: any): { nodes: any[]; edges: any[] } {
  const nodesIn = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const nodes = nodesIn.map((n: any) => ({
    id: String(n?.id ?? ""), type: String(n?.type ?? ""),
    x: Number.isFinite(Number(n?.x)) ? Number(n.x) : 0,
    y: Number.isFinite(Number(n?.y)) ? Number(n.y) : 0,
    config: (n && typeof n.config === "object" && n.config) ? n.config : {},
  })).filter((n: any) => n.id && n.type);
  const ids = new Set(nodes.map((n: any) => n.id));
  const seen = new Set<string>();
  const edgesIn = graph && Array.isArray(graph.edges) ? graph.edges : [];
  const edges = edgesIn.map((e: any) => {
    const edge: any = { source: String(e?.source ?? ""), target: String(e?.target ?? "") };
    if (e?.branch === "if" || e?.branch === "otherwise") edge.branch = e.branch;
    return edge;
  }).filter((e: any) => {
    if (!e.source || !e.target || e.source === e.target) return false;
    if (!ids.has(e.source) || !ids.has(e.target)) return false;
    const k = e.source + ">" + e.target;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { nodes, edges };
}

export async function listDrips(tenantId: string): Promise<DripDTO[]> {
  const rows = await db.drip.findMany({ where: { tenantId }, orderBy: { updatedAt: "desc" } });
  return rows.map(toDTO);
}
export async function getDrip(id: string, tenantId: string): Promise<DripDTO | null> {
  const d = await db.drip.findUnique({ where: { id } });
  if (!d || d.tenantId !== tenantId) return null;
  return toDTO(d);
}
export async function createDrip(input: { tenantId: string; name: string; graph?: unknown; createdById?: string | null }): Promise<DripDTO> {
  const d = await db.drip.create({ data: { tenantId: input.tenantId, name: input.name.trim(), graph: normalizeGraph(input.graph) as any, createdById: input.createdById ?? null } });
  return toDTO(d);
}
export async function validateDrip(id: string, tenantId: string): Promise<CompileResult | null> {
  const d = await db.drip.findUnique({ where: { id } });
  if (!d || d.tenantId !== tenantId) return null;
  return compileDrip(d.graph);
}

// Remove every automation currently linked to this drip (the single one and/or both halves of a
// pair), so recompiles never leave orphans and linear<->branched transitions stay clean.
async function clearLinkedAutomations(drip: any, tenantId: string): Promise<void> {
  const ids = new Set<string>();
  if (drip.automationId) ids.add(drip.automationId);
  if (drip.pairId) { const pair = await db.automation.findMany({ where: { tenantId, pairId: drip.pairId } }); pair.forEach((a: any) => ids.add(a.id)); }
  const byDrip = await db.automation.findMany({ where: { tenantId, dripId: drip.id } });
  byDrip.forEach((a: any) => ids.add(a.id));
  for (const id of ids) { try { await deleteAutomation(id, tenantId); } catch {} }
}

// Compile + land the automation(s). Returns { ok, errors, automationId, pairId }. `enable` sets the
// automation(s)' enabled flag. Recreates cleanly on every call.
async function syncAutomation(drip: any, tenantId: string, enable: boolean, createdById?: string | null): Promise<{ ok: boolean; errors: any[]; automationId: string | null; pairId: string | null }> {
  const compiled = compileDrip(drip.graph);
  if (!compiled.ok) return { ok: false, errors: compiled.errors, automationId: drip.automationId ?? null, pairId: drip.pairId ?? null };

  if (compiled.kind === "linear" && compiled.automation) {
    const payload = { name: drip.name, triggerType: compiled.automation.triggerType, conditions: compiled.automation.conditions, actions: compiled.automation.actions, enabled: enable, dripId: drip.id };
    // Reuse the existing single automation in place when there is one (and no stale pair).
    let automationId = (!drip.pairId && drip.automationId) ? (drip.automationId as string) : null;
    if (automationId) {
      const existing = await db.automation.findUnique({ where: { id: automationId } });
      if (!existing || existing.tenantId !== tenantId) automationId = null;
    }
    if (automationId) { await updateAutomation(automationId, tenantId, payload); }
    else { await clearLinkedAutomations(drip, tenantId); const a = await createAutomation(tenantId, payload, createdById); automationId = a.id; }
    return { ok: true, errors: [], automationId, pairId: null };
  }

  // Branched: land a fresh pair via the engine's applyFlowDefinition (draft), then set enabled +
  // dripId. Recreate each time so edits never duplicate.
  await clearLinkedAutomations(drip, tenantId);
  const pairId = "pair_" + randomUUID();
  const ifRes = await applyFlowDefinition(tenantId, { name: `${drip.name} (if)`, triggerType: compiled.ifDef!.triggerType, conditions: compiled.ifDef!.conditions, actions: compiled.ifDef!.actions }, createdById, { pairId });
  const elseRes = await applyFlowDefinition(tenantId, { name: `${drip.name} (otherwise)`, triggerType: compiled.elseDef!.triggerType, conditions: compiled.elseDef!.conditions, actions: compiled.elseDef!.actions }, createdById, { pairId });
  await updateAutomation(ifRes.automation.id, tenantId, { enabled: enable, dripId: drip.id });
  await updateAutomation(elseRes.automation.id, tenantId, { enabled: enable, dripId: drip.id });
  return { ok: true, errors: [], automationId: ifRes.automation.id, pairId };
}

export async function updateDrip(
  id: string, tenantId: string,
  patch: { name?: string; graph?: unknown; status?: string },
  createdById?: string | null,
): Promise<{ drip: DripDTO; warning?: string } | null> {
  const existing = await db.drip.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return null;
  const data: Record<string, unknown> = {};
  if (typeof patch.name === "string" && patch.name.trim()) data.name = patch.name.trim();
  if ("graph" in patch) data.graph = normalizeGraph(patch.graph) as any;
  if (typeof patch.status === "string") data.status = patch.status;
  let d = await db.drip.update({ where: { id }, data });

  let warning: string | undefined;
  // Keep linked automation(s) in sync whenever the drip already has one (i.e. it's been compiled).
  if (d.automationId || d.pairId) {
    const sync = await syncAutomation(d, tenantId, !!d.enabled, createdById);
    if (sync.ok) {
      d = await db.drip.update({ where: { id }, data: { automationId: sync.automationId, pairId: sync.pairId } });
    } else if (d.enabled) {
      await clearLinkedAutomations(d, tenantId);
      d = await db.drip.update({ where: { id }, data: { enabled: false, status: "draft", automationId: null, pairId: null } });
      warning = "Saved, but the changes made this drip invalid, so it was turned off. Fix the errors to re-enable it.";
    } else {
      // Was linked but now invalid and already off — drop the stale link.
      await clearLinkedAutomations(d, tenantId);
      d = await db.drip.update({ where: { id }, data: { automationId: null, pairId: null } });
    }
  }
  return { drip: toDTO(d), warning };
}

export async function setDripEnabled(id: string, tenantId: string, enabled: boolean, createdById?: string | null): Promise<{ ok: boolean; errors: any[]; drip: DripDTO } | null> {
  const existing = await db.drip.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return null;

  if (!enabled) {
    // Disable any linked automation(s).
    if (existing.automationId) { try { await updateAutomation(existing.automationId, tenantId, { enabled: false }); } catch {} }
    if (existing.pairId) { const pair = await db.automation.findMany({ where: { tenantId, pairId: existing.pairId } }); for (const a of pair) { try { await updateAutomation(a.id, tenantId, { enabled: false }); } catch {} } }
    const d = await db.drip.update({ where: { id }, data: { enabled: false, status: "draft" } });
    return { ok: true, errors: [], drip: toDTO(d) };
  }

  const sync = await syncAutomation(existing, tenantId, true, createdById);
  if (!sync.ok) return { ok: false, errors: sync.errors, drip: toDTO(existing) };
  const d = await db.drip.update({ where: { id }, data: { enabled: true, status: "active", automationId: sync.automationId, pairId: sync.pairId } });
  return { ok: true, errors: [], drip: toDTO(d) };
}

export async function deleteDrip(id: string, tenantId: string): Promise<boolean> {
  const existing = await db.drip.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return false;
  await clearLinkedAutomations(existing, tenantId);
  await db.drip.delete({ where: { id } });
  return true;
}
