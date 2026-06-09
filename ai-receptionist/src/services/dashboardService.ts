import { prisma } from "../db/client";

// The main "Dashboard" screen (portal home) gets its own dedicated dashboard,
// kept separate from the user-created dashboards shown on the Reports page.
// We mark it with a reserved name sentinel + order -1 so we don't need a schema
// migration. It is always hidden from listDashboards(), can't be renamed to/from
// the sentinel, and can't be deleted.
export const HOME_DASHBOARD_NAME = "__home__";
export const HOME_DASHBOARD_LABEL = "Overview";

function serialize(d: any) {
  const isHome = d.name === HOME_DASHBOARD_NAME;
  return {
    id: d.id,
    name: isHome ? HOME_DASHBOARD_LABEL : d.name,
    isHome,
    widgets: d.widgets ?? [],
    order: d.order,
    createdAt: d.createdAt.toISOString(),
  };
}

// Report-page dashboards only — the home dashboard is intentionally excluded.
export async function listDashboards(tenantId: string) {
  const rows = await prisma.dashboard.findMany({
    where: { tenantId, name: { not: HOME_DASHBOARD_NAME } },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(serialize);
}

// Fetch (or lazily create) the dedicated home/overview dashboard for a tenant.
export async function getOrCreateHomeDashboard(tenantId: string, createdById?: string | null) {
  const existing = await prisma.dashboard.findFirst({
    where: { tenantId, name: HOME_DASHBOARD_NAME },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return serialize(existing);
  const d = await prisma.dashboard.create({
    data: {
      tenantId,
      name: HOME_DASHBOARD_NAME,
      widgets: [] as any,
      order: -1,
      createdById: createdById ?? null,
    },
  });
  return serialize(d);
}

export async function createDashboard(tenantId: string, name: string, createdById?: string | null) {
  let clean = (name ?? "").trim() || "Untitled dashboard";
  // Never let a user create something that collides with the reserved home name.
  if (clean === HOME_DASHBOARD_NAME) clean = "Untitled dashboard";
  const max = await prisma.dashboard.aggregate({ where: { tenantId }, _max: { order: true } });
  const d = await prisma.dashboard.create({
    data: { tenantId, name: clean, widgets: [] as any, order: Math.max(0, (max._max.order ?? -1) + 1), createdById: createdById ?? null },
  });
  return serialize(d);
}

export async function updateDashboard(id: string, tenantId: string, data: { name?: string; widgets?: unknown }, actorRole?: string | null) {
  const d = await prisma.dashboard.findUnique({ where: { id } });
  if (!d || d.tenantId !== tenantId) throw new Error("Dashboard not found");
  const isHome = d.name === HOME_DASHBOARD_NAME;
  // The Home Dashboard is shared per-portal; only admins may edit it.
  if (isHome && actorRole === "CLIENT_USER") { const e: any = new Error("Only admins can edit the Home Dashboard"); e.code = "FORBIDDEN"; throw e; }
  const patch: any = {};
  // The home dashboard keeps its sentinel name; ignore rename attempts on it and
  // block anyone else from adopting the reserved name.
  if (data.name != null && !isHome) {
    const next = data.name.trim();
    if (next && next !== HOME_DASHBOARD_NAME) patch.name = next;
  }
  if (data.widgets != null) patch.widgets = data.widgets as any;
  const updated = await prisma.dashboard.update({ where: { id }, data: patch });
  return serialize(updated);
}

export async function deleteDashboard(id: string, tenantId: string): Promise<boolean> {
  const d = await prisma.dashboard.findUnique({ where: { id } });
  if (!d || d.tenantId !== tenantId) return false;
  if (d.name === HOME_DASHBOARD_NAME) return false; // never delete the home dashboard
  await prisma.dashboard.delete({ where: { id } });
  return true;
}
