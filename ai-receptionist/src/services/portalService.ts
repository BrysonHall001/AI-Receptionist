import { prisma } from "../db/client";

export async function listPortals() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { callSessions: true, contacts: true, users: true } } },
  });
  return tenants.map((t: any) => ({
    id: t.id,
    name: t.name,
    businessType: t.businessType,
    phoneNumber: t.phoneNumber,
    notifyEmail: t.notifyEmail,
    greeting: t.greeting,
    status: t.status,
    requireEmail: (t as any).requireEmail !== false,
    calls: t._count?.callSessions ?? 0,
    contacts: t._count?.contacts ?? 0,
    users: t._count?.users ?? 0,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function getPortal(id: string) {
  const t = await prisma.tenant.findUnique({ where: { id } });
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    businessType: t.businessType,
    phoneNumber: t.phoneNumber,
    notifyEmail: t.notifyEmail,
    greeting: t.greeting,
    labels: (t as any).labels ?? {},
    status: t.status,
    requireEmail: (t as any).requireEmail !== false,
    createdAt: t.createdAt.toISOString(),
  };
}

// Merge generic-word overrides (e.g. "record","stage") into Tenant.labels.
// Portal-scoped (only this tenant's row). Both forms required per word. Stable
// keys aren't involved — this is display words only.
export async function setTenantLabels(
  tenantId: string,
  generic: Record<string, { one?: string; many?: string }>
) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw new Error("Portal not found");
  const current = (t as any).labels && typeof (t as any).labels === "object" ? { ...(t as any).labels } : {};
  for (const [k, v] of Object.entries(generic || {})) {
    const one = String((v && v.one) || "").trim();
    const many = String((v && v.many) || "").trim();
    if (!one || !many) throw new Error(`Both singular and plural are required for "${k}"`);
    current[k] = { one, many };
  }
  await prisma.tenant.update({ where: { id: tenantId }, data: { labels: current } as any });
  return current;
}

// Per-portal left-nav config, stored as a reserved `nav` key INSIDE Tenant.labels
// (so there's no schema change / no migration). Shape:
//   { order: string[], hidden: string[], labels: { [href]: string } }
// - order:  preferred nav item order, by href ("#/calls", ...). Unknown/new hrefs
//           simply fall back to their default position on the client.
// - hidden: hrefs the portal has hidden. Home Dashboard (#/dashboard) can NEVER be
//           hidden, so it's stripped here defensively even if a client sends it.
// - labels: per-href display overrides for the fixed nav items (Calls/Reports/etc.).
//           A blank value means "use the built-in default", so we just don't store it.
// This is the single source of truth the later per-row nav menu will read/write too.
export const NAV_HOME_HREF = "#/dashboard";
export async function setTenantNav(
  tenantId: string,
  nav: { order?: string[]; hidden?: string[]; labels?: Record<string, string> }
) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw new Error("Portal not found");
  const current = (t as any).labels && typeof (t as any).labels === "object" ? { ...(t as any).labels } : {};
  const order = Array.isArray(nav.order) ? nav.order.filter((h) => typeof h === "string") : [];
  const hidden = (Array.isArray(nav.hidden) ? nav.hidden.filter((h) => typeof h === "string") : [])
    .filter((h) => h !== NAV_HOME_HREF);
  const labels: Record<string, string> = {};
  if (nav.labels && typeof nav.labels === "object") {
    for (const [href, val] of Object.entries(nav.labels)) {
      const s = String(val == null ? "" : val).trim();
      if (s) labels[href] = s;
    }
  }
  current.nav = { order, hidden, labels };
  await prisma.tenant.update({ where: { id: tenantId }, data: { labels: current } as any });
  return current.nav;
}

export async function createPortal(input: {
  name: string;
  businessType?: string;
  phoneNumber?: string | null;
  notifyEmail: string;
  greeting?: string;
  requireEmail?: boolean;
}) {
  return prisma.tenant.create({
    data: {
      name: input.name,
      businessType: input.businessType || "general business",
      phoneNumber: input.phoneNumber || null,
      notifyEmail: input.notifyEmail,
      greeting: input.greeting || "Thank you for calling. How can I help you today?",
      requireEmail: input.requireEmail !== false,
    } as any,
  });
}

export async function updatePortal(
  id: string,
  data: Partial<{ name: string; businessType: string; phoneNumber: string | null; notifyEmail: string; greeting: string; status: "ACTIVE" | "SUSPENDED"; requireEmail: boolean }>,
) {
  return prisma.tenant.update({ where: { id }, data: data as any });
}

// ---- Per-portal theme (branding) -------------------------------------------
// One theme per portal: everyone who enters the portal sees it. Stored on the
// existing Tenant.theme JSON column in the modern {active, customs} shape and
// validated by the shared sanitizer (so only known-good presets/hex/fonts can
// ever be saved). The master hub (no portal in context) uses a fixed default
// and has no editable theme. Replaces the old per-user theme path.
import { sanitizeUserTheme, UserTheme, DEFAULT_USER_THEME } from "../theme/themes";

// What the master hub (no portal selected) renders.
export const MASTER_DEFAULT_THEME: UserTheme = { ...DEFAULT_USER_THEME };

export async function getPortalTheme(tenantId: string): Promise<UserTheme> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) return { ...MASTER_DEFAULT_THEME };
  const raw = (t as any).theme;
  // Only honor a real saved theme (modern shape); anything else -> default look.
  if (!raw || typeof raw !== "object" || !(raw as any).active) {
    return { ...MASTER_DEFAULT_THEME };
  }
  return sanitizeUserTheme(raw);
}

export async function setPortalTheme(tenantId: string, input: unknown): Promise<UserTheme> {
  const clean = sanitizeUserTheme(input);
  await prisma.tenant.update({ where: { id: tenantId }, data: { theme: clean as any } });
  return clean;
}
