// Drip service — the VISUAL layer of the drag-and-drop campaign builder + slice-2 compile/activate.
// A Drip stores a `graph` of nodes + edges; the compiler turns a valid LINEAR graph into a real
// Automation (Drip.automationId) that runs through the existing engine. Tenant-scoped throughout.
import { prisma } from "../db/client";
import { compileDrip, type CompileResult } from "./dripCompiler";
import { createAutomation, updateAutomation, deleteAutomation } from "./automationService";

const db = prisma as any;

export interface DripDTO {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  graph: any;
  automationId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDTO(d: any): DripDTO {
  return {
    id: d.id,
    name: d.name,
    enabled: !!d.enabled,
    status: d.status,
    graph: d.graph ?? { nodes: [], edges: [] },
    automationId: d.automationId ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

// Normalize a graph to { nodes:[{id,type,x,y,config}], edges:[{source,target}] } — defensive so a
// malformed payload can't corrupt stored shape. Edges to/from unknown nodes and self/dupe edges
// are dropped.
function normalizeGraph(graph: any): { nodes: any[]; edges: any[] } {
  const nodesIn = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const nodes = nodesIn.map((n: any) => ({
    id: String(n?.id ?? ""),
    type: String(n?.type ?? ""),
    x: Number.isFinite(Number(n?.x)) ? Number(n.x) : 0,
    y: Number.isFinite(Number(n?.y)) ? Number(n.y) : 0,
    config: (n && typeof n.config === "object" && n.config) ? n.config : {},
  })).filter((n: any) => n.id && n.type);
  const ids = new Set(nodes.map((n: any) => n.id));
  const seen = new Set<string>();
  const edgesIn = graph && Array.isArray(graph.edges) ? graph.edges : [];
  const edges = edgesIn.map((e: any) => ({ source: String(e?.source ?? ""), target: String(e?.target ?? "") }))
    .filter((e: any) => {
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
  const d = await db.drip.create({
    data: {
      tenantId: input.tenantId,
      name: input.name.trim(),
      graph: normalizeGraph(input.graph) as any,
      createdById: input.createdById ?? null,
    },
  });
  return toDTO(d);
}

// Validate + compile without changing anything (frontend gating).
export async function validateDrip(id: string, tenantId: string): Promise<CompileResult | null> {
  const d = await db.drip.findUnique({ where: { id } });
  if (!d || d.tenantId !== tenantId) return null;
  return compileDrip(d.graph);
}

// Create or update the linked Automation from the drip's current graph. Keeps the name in sync and
// the automation's enabled flag matching `enable`. Returns { ok, errors, automationId }.
async function syncAutomation(drip: any, tenantId: string, enable: boolean, createdById?: string | null): Promise<{ ok: boolean; errors: any[]; automationId: string | null }> {
  const compiled = compileDrip(drip.graph);
  if (!compiled.ok || !compiled.automation) return { ok: false, errors: compiled.errors, automationId: drip.automationId ?? null };
  const payload = {
    name: drip.name,
    triggerType: compiled.automation.triggerType,
    conditions: compiled.automation.conditions,
    actions: compiled.automation.actions,
    enabled: enable,
  };
  let automationId = drip.automationId as string | null;
  if (automationId) {
    // Update existing — but if it was deleted out from under us, recreate.
    const existing = await db.automation.findUnique({ where: { id: automationId } });
    if (existing && existing.tenantId === tenantId) { await updateAutomation(automationId, tenantId, payload); }
    else { const a = await createAutomation(tenantId, payload, createdById); automationId = a.id; }
  } else {
    const a = await createAutomation(tenantId, payload, createdById);
    automationId = a.id;
  }
  return { ok: true, errors: [], automationId };
}

// Update name/graph. If the drip is already linked to an automation (compiled before), recompile +
// update it so an ACTIVE drip's automation stays in sync. If a graph edit makes it invalid, the
// linked automation is disabled and the drip is turned off (an invalid drip can't run).
export async function updateDrip(
  id: string,
  tenantId: string,
  patch: { name?: string; graph?: unknown; status?: string; enabled?: boolean },
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
  // Keep a linked automation in sync (name + recompiled graph) whenever the drip already has one.
  if (d.automationId) {
    const sync = await syncAutomation(d, tenantId, !!d.enabled, createdById);
    if (sync.ok) {
      if (typeof patch.name === "string") { /* name synced via payload */ }
    } else if (d.enabled) {
      // Edit broke a running drip — disable it and its automation.
      if (d.automationId) { try { await updateAutomation(d.automationId, tenantId, { enabled: false }); } catch {} }
      d = await db.drip.update({ where: { id }, data: { enabled: false, status: "draft" } });
      warning = "Saved, but the changes made this drip invalid, so it was turned off. Fix the errors to re-enable it.";
    }
  }
  return { drip: toDTO(d), warning };
}

// Enable: compile (must be valid) + create/update the linked automation ENABLED, mark drip active.
// Returns { ok, errors, drip }. A drip that fails validation cannot be enabled.
export async function setDripEnabled(id: string, tenantId: string, enabled: boolean, createdById?: string | null): Promise<{ ok: boolean; errors: any[]; drip: DripDTO } | null> {
  const existing = await db.drip.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return null;

  if (!enabled) {
    if (existing.automationId) { try { await updateAutomation(existing.automationId, tenantId, { enabled: false }); } catch {} }
    const d = await db.drip.update({ where: { id }, data: { enabled: false, status: "draft" } });
    return { ok: true, errors: [], drip: toDTO(d) };
  }

  const sync = await syncAutomation(existing, tenantId, true, createdById);
  if (!sync.ok) return { ok: false, errors: sync.errors, drip: toDTO(existing) };
  const d = await db.drip.update({ where: { id }, data: { enabled: true, status: "active", automationId: sync.automationId } });
  return { ok: true, errors: [], drip: toDTO(d) };
}

export async function deleteDrip(id: string, tenantId: string): Promise<boolean> {
  const existing = await db.drip.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return false;
  // Clean up the linked automation so no orphan keeps running.
  if (existing.automationId) { try { await deleteAutomation(existing.automationId, tenantId); } catch {} }
  await db.drip.delete({ where: { id } });
  return true;
}
