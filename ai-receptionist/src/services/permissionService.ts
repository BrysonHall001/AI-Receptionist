import { prisma } from "../db/client";

// ===========================================================================
// Permission foundation (Batch 1 — server-only, no UI, no enforcement rollout).
//
// This is the single source of truth for "may this user do X in area Y" on the
// PORTAL side. Batch 1 only DEFINES the model; it is wired into a couple of proof
// routes but is otherwise dormant (system roles resolve to exactly today's
// behavior, so nothing changes until the Batch 2 rollout).
// ===========================================================================

export type Right = "view" | "edit" | "delete" | "manage";

// Each area declares a KIND, which fixes the rights it supports — so we never
// pretend a read-only page has "delete", or that a settings pane is view/edit/delete.
type AreaKind = "data" | "readonly" | "settings" | "users";

// `section` groups areas into the collapsible blocks the Permissions UI renders.
interface AreaDef { key: string; label: string; kind: AreaKind; section: string; }

function rightsForKind(kind: AreaKind): Right[] {
  switch (kind) {
    case "data": return ["view", "edit", "delete"];
    case "readonly": return ["view"];
    case "settings": return ["manage"];
    case "users": return ["view", "edit", "delete"];
  }
}

// The permissionable areas. Settings sub-areas mirror the Settings SECTIONS list.
// (Record types are one "records" area for now; Batch 2 may split per type.)
export const AREAS: AreaDef[] = [
  // ---- Data (view / edit / delete) ----
  { key: "contacts", label: "Contacts", kind: "data", section: "Data" },
  { key: "records", label: "Records (Jobs / Bookings / custom)", kind: "data", section: "Data" },
  { key: "automations", label: "Automations", kind: "data", section: "Data" },
  // ---- Read-only (view only) ----
  { key: "dashboard", label: "Dashboard", kind: "readonly", section: "Operations" },
  { key: "calls", label: "Calls", kind: "readonly", section: "Operations" },
  { key: "reports", label: "Reports", kind: "readonly", section: "Operations" },
  { key: "learn", label: "Learning Center", kind: "readonly", section: "Operations" },
  // ---- Settings sub-areas (single Manage right each) ----
  { key: "settings_general", label: "General", kind: "settings", section: "Settings" },
  { key: "settings_appearance", label: "Appearance", kind: "settings", section: "Settings" },
  { key: "settings_leadcapture", label: "Lead capture", kind: "settings", section: "Settings" },
  { key: "settings_scheduling", label: "Scheduling", kind: "settings", section: "Settings" },
  { key: "settings_resources", label: "Resources", kind: "settings", section: "Settings" },
  { key: "settings_integrations", label: "Integrations", kind: "settings", section: "Settings" },
  { key: "settings_data", label: "Data Administration", kind: "settings", section: "Settings" },
  { key: "settings_labels", label: "Labels", kind: "settings", section: "Settings" },
  { key: "settings_fields", label: "Fields", kind: "settings", section: "Settings" },
  // ---- User management (its own shape: view team / change roles / remove) ----
  { key: "users", label: "User management", kind: "users", section: "Admin" },
];

// The section order the Permissions UI renders (collapsible blocks).
export const AREA_SECTIONS = ["Data", "Operations", "Settings", "Admin"];

const AREA_BY_KEY = new Map<string, AreaDef>(AREAS.map((a) => [a.key, a]));

// The areas whose VIEW right backs a sidebar item, so the client menu can derive
// from real permissions (Batch 3). Fields and Feedback are always-visible on the
// client (their page-load isn't permission-gated / Feedback has its own role logic),
// and Dashboard is never hideable — so the client handles those three specially.
export const NAV_VIEW_AREAS = ["contacts", "records", "automations", "calls", "reports", "learn", "dashboard"];

export type Permissions = Record<string, Partial<Record<Right, boolean>>>;

// ---------------------------------------------------------------------------
// The super-admin CEILING = the maximum portal permission set. A super-admin has
// full control of every portal area, so the ceiling grants every catalog right.
// No custom role may exceed this (Cap #1). Computing it from the catalog keeps it
// honest: if a future area reserved a right above super-admin, it would simply be
// left out of the catalog and thus out of the ceiling.
// ---------------------------------------------------------------------------
export const CEILING: Permissions = (() => {
  const c: Permissions = {};
  for (const a of AREAS) {
    c[a.key] = {};
    for (const r of rightsForKind(a.kind)) c[a.key][r] = true;
  }
  return c;
})();

function ceilingAllows(area: string, right: Right): boolean {
  return CEILING[area]?.[right] === true;
}

// ---------------------------------------------------------------------------
// System-role permission maps — encode TODAY's reality precisely.
//   OWNER / SUPER_ADMIN / AUDITOR  -> full portal control (everything).
//   PORTAL_ADMIN                   -> full portal control too (the difference vs.
//                                     super-admin is master-hub / any-tenant /
//                                     acting-on-super-admins, none of which are
//                                     portal AREA rights — those live elsewhere).
//   CLIENT_USER                    -> INTENDED restricted set (see note below).
// ---------------------------------------------------------------------------
function isTopTier(role: string): boolean {
  return role === "OWNER" || role === "SUPER_ADMIN" || role === "AUDITOR";
}

// IMPORTANT — CLIENT_USER tightening (deliberate). Today the server does NOT gate
// portal DATA crud by role, so a CLIENT_USER can read/write/delete data the menu
// merely hides. The INTENDED CLIENT_USER is view-only: it may VIEW data + read-only
// areas, and nothing else (no edit/delete, no settings, no user management). This is
// only DEFINED here in Batch 1; it takes effect when enforcement is rolled out in
// Batch 2. Tune this set before that rollout if you want client users to keep some
// edit rights.
function systemCan(role: string, area: string, right: Right): boolean {
  const def = AREA_BY_KEY.get(area);
  if (!def) return false;                                   // unknown area -> deny
  if (!rightsForKind(def.kind).includes(right)) return false; // unsupported right -> deny

  if (isTopTier(role)) return true;          // OWNER / SUPER_ADMIN / AUDITOR: full
  if (role === "PORTAL_ADMIN") return true;  // full portal control (matches today)
  if (role === "CLIENT_USER") {
    return right === "view" && (def.kind === "data" || def.kind === "readonly");
  }
  return false;
}

// Drop anything a stored permission set isn't allowed to hold: unknown areas,
// unsupported rights, non-true values, and (defense in depth) anything above the
// ceiling. Used at CHECK time so a tampered/over-privileged DB row still can't
// grant more than the ceiling.
export function capToCeiling(perms: any): Permissions {
  const out: Permissions = {};
  if (!perms || typeof perms !== "object" || Array.isArray(perms)) return out;
  for (const [area, rights] of Object.entries(perms)) {
    const def = AREA_BY_KEY.get(area);
    if (!def || !rights || typeof rights !== "object") continue;
    const allowed = rightsForKind(def.kind);
    for (const [r, val] of Object.entries(rights as Record<string, unknown>)) {
      if (val === true && allowed.includes(r as Right) && ceilingAllows(area, r as Right)) {
        (out[area] ||= {})[r as Right] = true;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE RESOLVER. The one function that answers "may this user do X in area Y".
//   - System role (no customRoleId): built-in map = today's behavior (no DB hit).
//   - Custom role (customRoleId set): the role's STORED permissions, re-intersected
//     with the ceiling at check time. Falls back to the base system role if the
//     custom role is missing or belongs to another tenant.
// ---------------------------------------------------------------------------
export interface PermUser {
  id?: string;
  role: string;
  tenantId?: string | null;
  customRoleId?: string | null;
}

export async function can(user: PermUser | null | undefined, area: string, right: Right): Promise<boolean> {
  if (!user || !user.role) return false;
  if (!user.customRoleId) return systemCan(user.role, area, right);

  const role = await prisma.portalRole.findUnique({ where: { id: user.customRoleId } } as any).catch(() => null);
  // Missing role, or assigned across tenants -> ignore it, fall back to base role.
  if (!role || (user.tenantId && (role as any).tenantId !== user.tenantId)) {
    return systemCan(user.role, area, right);
  }
  const capped = capToCeiling((role as any).permissions);
  return capped[area]?.[right] === true;
}

// ---------------------------------------------------------------------------
// Cap #1 (save-time): validate a proposed custom-role permission set. Always rejects
// unknown areas, area-unsupported rights, and non-boolean values. When a `ceiling`
// matrix is supplied (the creating user's OWN effective permissions), every granted
// right must also be within it — you can grant up to what you have, never more. When
// no ceiling is supplied, the structural catalog is the only limit (used by internal
// callers/tests; routes always pass the creator's matrix).
// ---------------------------------------------------------------------------
export function validateCustomRolePermissions(perms: any, ceiling?: Permissions): { ok: boolean; error?: string } {
  if (!perms || typeof perms !== "object" || Array.isArray(perms)) {
    return { ok: false, error: "permissions must be an object" };
  }
  for (const [area, rights] of Object.entries(perms)) {
    const def = AREA_BY_KEY.get(area);
    if (!def) return { ok: false, error: `unknown area "${area}"` };
    if (!rights || typeof rights !== "object" || Array.isArray(rights)) {
      return { ok: false, error: `permissions for "${area}" must be an object` };
    }
    const allowed = rightsForKind(def.kind);
    for (const [r, val] of Object.entries(rights as Record<string, unknown>)) {
      if (!allowed.includes(r as Right)) {
        return { ok: false, error: `area "${area}" does not support right "${r}"` };
      }
      if (typeof val !== "boolean") {
        return { ok: false, error: `right "${area}.${r}" must be true or false` };
      }
      if (val === true) {
        if (!ceilingAllows(area, r as Right)) {
          return { ok: false, error: `right "${area}.${r}" isn't grantable for that area` };
        }
        if (ceiling && ceiling[area]?.[r as Right] !== true) {
          return { ok: false, error: `right "${area}.${r}" exceeds your own permission level` };
        }
      }
    }
  }
  return { ok: true };
}

// Create a custom role. `ceiling` (the creating user's own effective matrix) caps
// what may be granted — see validateCustomRolePermissions.
export async function createPortalRole(tenantId: string, name: string, permissions: any, ceiling?: Permissions) {
  const clean = (name || "").trim();
  if (!clean) throw new Error("Role name is required");
  const v = validateCustomRolePermissions(permissions, ceiling);
  if (!v.ok) throw new Error(v.error || "Invalid permissions");
  return prisma.portalRole.create({ data: { tenantId, name: clean, permissions } } as any);
}

export async function updatePortalRole(id: string, tenantId: string, name: string, permissions: any, ceiling?: Permissions) {
  const clean = (name || "").trim();
  if (!clean) throw new Error("Role name is required");
  const v = validateCustomRolePermissions(permissions, ceiling);
  if (!v.ok) throw new Error(v.error || "Invalid permissions");
  return prisma.portalRole.update({ where: { id }, data: { tenantId, name: clean, permissions } } as any);
}

// The full effective permission matrix for ANY user (system or custom role) — used as
// the creator's-own-level ceiling and sent to the UI so it can grey cells the creator
// can't grant. For a custom-role user it's the role's stored set, capped to the catalog.
export async function effectiveMatrix(user: PermUser | null | undefined): Promise<Permissions> {
  if (user?.customRoleId) {
    const role: any = await prisma.portalRole.findUnique({ where: { id: user.customRoleId } } as any).catch(() => null);
    if (role && (!user.tenantId || role.tenantId === user.tenantId)) {
      const capped = capToCeiling(role.permissions);
      const m: Permissions = {};
      for (const a of AREAS) { m[a.key] = {}; for (const r of rightsForKind(a.kind)) m[a.key][r] = capped[a.key]?.[r] === true; }
      return m;
    }
  }
  return permissionMatrixForRole(user?.role || "");
}

// ===========================================================================
// Batch 4 — read models + CRUD for the Permissions UI.
// ===========================================================================

// The rights catalog the UI renders: every area with its supported rights + the
// collapsible section it belongs to. Read-only areas expose only "view", settings
// only "manage", etc., so the UI greys the N/A cells. Because the super-admin ceiling
// is the FULL catalog, an area's supported rights ARE its ceiling — the greyed N/A
// cells are exactly the cells no role (custom or system) can ever be granted.
export function getPermissionCatalog() {
  return AREAS.map((a) => ({ key: a.key, label: a.label, kind: a.kind, section: a.section, rights: rightsForKind(a.kind) }));
}

// The full permission matrix for a SYSTEM role (for read-only reference display in
// the UI). Computed with the SAME systemCan the server enforces with.
export function permissionMatrixForRole(role: string): Permissions {
  const m: Permissions = {};
  for (const a of AREAS) {
    m[a.key] = {};
    for (const r of rightsForKind(a.kind)) m[a.key][r] = systemCan(role, a.key, r);
  }
  return m;
}

// The system roles shown (read-only) in the role list, in display order. Super Admin
// is flagged as the ceiling.
export const SYSTEM_ROLES: Array<{ role: string; label: string; ceiling?: boolean }> = [
  { role: "OWNER", label: "Owner" },
  { role: "SUPER_ADMIN", label: "Super Admin", ceiling: true },
  { role: "AUDITOR", label: "Auditor" },
  { role: "PORTAL_ADMIN", label: "Portal Admin" },
  { role: "CLIENT_USER", label: "Client User" },
];

// The system roles shown in an INDIVIDUAL portal's Permissions reference list. Owner /
// Super Admin / Auditor are cross-portal/global tiers and don't belong in a single
// portal's list. This is DISPLAY-ONLY: it does not affect who can create roles or the
// cap/ceiling logic, which is driven by each creating user's own effective permissions
// (effectiveMatrix). An owner/super-admin acting in the portal still creates roles and
// grants up to their level even though they aren't listed here.
export const PER_PORTAL_SYSTEM_ROLES = ["PORTAL_ADMIN", "CLIENT_USER"];

export async function listPortalRoles(tenantId: string) {
  return prisma.portalRole.findMany({ where: { tenantId }, orderBy: { name: "asc" } } as any);
}

export async function getPortalRole(id: string, tenantId: string) {
  const r: any = await prisma.portalRole.findUnique({ where: { id } } as any).catch(() => null);
  if (!r || r.tenantId !== tenantId) return null; // tenant-scoped: never touch another portal's role
  return r;
}

// Delete a custom role. Any user currently assigned to it falls back to their base
// system role (customRoleId -> null) — a safe default, never an escalation, since the
// base enum role is unchanged. Returns how many users were unassigned.
export async function deletePortalRoleAndUnassign(id: string, tenantId: string): Promise<{ deleted: boolean; unassigned: number }> {
  const role = await getPortalRole(id, tenantId);
  if (!role) return { deleted: false, unassigned: 0 };
  const r = await prisma.user.updateMany({ where: { tenantId, customRoleId: id } as any, data: { customRoleId: null } as any });
  await prisma.portalRole.delete({ where: { id } } as any);
  return { deleted: true, unassigned: (r as any)?.count ?? 0 };
}
