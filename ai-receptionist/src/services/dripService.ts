// Drip service — the VISUAL layer of the drag-and-drop campaign builder. A Drip stores a `graph`
// of freely-positioned nodes ({ id, type, x, y, config }); a later slice compiles it into an
// Automation (automationId). This slice is CRUD + graph save/restore only. Tenant-scoped.
import { prisma } from "../db/client";

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
    graph: d.graph ?? { nodes: [] },
    automationId: d.automationId ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

// Normalize a graph to { nodes: [{ id, type, x, y, config }] } — defensive so a malformed payload
// can never corrupt the stored shape (positions coerced to numbers, config kept as an object).
function normalizeGraph(graph: any): { nodes: any[] } {
  const nodesIn = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const nodes = nodesIn.map((n: any) => ({
    id: String(n?.id ?? ""),
    type: String(n?.type ?? ""),
    x: Number.isFinite(Number(n?.x)) ? Number(n.x) : 0,
    y: Number.isFinite(Number(n?.y)) ? Number(n.y) : 0,
    config: (n && typeof n.config === "object" && n.config) ? n.config : {},
  })).filter((n: any) => n.id && n.type);
  return { nodes };
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

// Update name and/or graph (and optional status/enabled). Tenant-scoped. Returns null if not found.
export async function updateDrip(
  id: string,
  tenantId: string,
  patch: { name?: string; graph?: unknown; status?: string; enabled?: boolean },
): Promise<DripDTO | null> {
  const existing = await db.drip.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return null;
  const data: Record<string, unknown> = {};
  if (typeof patch.name === "string" && patch.name.trim()) data.name = patch.name.trim();
  if ("graph" in patch) data.graph = normalizeGraph(patch.graph) as any;
  if (typeof patch.status === "string") data.status = patch.status;
  if (typeof patch.enabled === "boolean") data.enabled = patch.enabled;
  const d = await db.drip.update({ where: { id }, data });
  return toDTO(d);
}

export async function deleteDrip(id: string, tenantId: string): Promise<boolean> {
  const existing = await db.drip.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return false;
  await db.drip.delete({ where: { id } });
  return true;
}
