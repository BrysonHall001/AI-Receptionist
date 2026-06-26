import crypto from "crypto";
import { prisma } from "../db/client";
import { emitEvent } from "../events/bus";
import { EVENT_TYPES } from "../events/types";
import { hashPassword } from "../auth/passwords";
import { Role } from "../middleware/auth";
import { getPortalRole } from "./permissionService";

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string | null;
  role: Role;
  tenantId?: string | null;
  customRoleId?: string | null;
}

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/** True if the account may not be used: hard-disabled or past its expiry. */
export function accountInactive(u: { disabled?: boolean | null; expiresAt?: Date | string | null }): boolean {
  if (u.disabled) return true;
  if (u.expiresAt && new Date(u.expiresAt).getTime() < Date.now()) return true;
  return false;
}

export async function createUser(input: CreateUserInput) {
  const passwordHash = await hashPassword(input.password);
  // AUDITOR accounts are temporary testers — auto-expire 3 days after creation.
  const expiresAt = input.role === "AUDITOR" ? new Date(Date.now() + THREE_DAYS_MS) : null;
  return prisma.user.create({
    data: {
      email: input.email.trim().toLowerCase(),
      passwordHash,
      name: input.name ?? null,
      role: input.role,
      tenantId: input.tenantId ?? null,
      customRoleId: input.customRoleId ?? null,
      expiresAt,
    },
  });
}

export async function listUsers(tenantId?: string | null) {
  const where = tenantId ? { tenantId } : {};
  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { tenant: true },
  });
  return users.map((u: any) => publicUser(u));
}

/**
 * Delete a user, enforcing tier-protection on the SERVER (so no route can bypass
 * it). `actor` is who is requesting the deletion (their id + role).
 *  - An OWNER can never be deleted by anyone.
 *  - A SUPER_ADMIN can be deleted only by an OWNER.
 *  - You can't delete your own account.
 * Rules fail closed: if the actor is unknown, only ordinary users can be removed.
 */
/** Update a user's display name. Permission is enforced by the caller (route). */
export async function updateUserName(id: string, name: string | null) {
  return prisma.user.update({ where: { id }, data: { name: name && name.trim() ? name.trim() : null } });
}

/**
 * Cap #2 — tier protection for ALL user-management actions (delete / role change /
 * impersonate). No actor below super-admin tier may act on a super-admin-tier user.
 * Generalizes the rules that previously lived inline in deleteUser; the "delete"
 * messages are kept byte-identical, so existing behavior is unchanged. Custom roles
 * route through here too: a custom-role actor's `role` is its BASE enum role
 * (CLIENT_USER / PORTAL_ADMIN, never OWNER), so it is automatically blocked from
 * acting on OWNER / SUPER_ADMIN targets. Fails closed.
 */
export type UserAction = "delete" | "role" | "impersonate";
export function assertCanActOnUser(
  actor: { id: string; role: string } | undefined,
  target: { id: string; role: string },
  action: UserAction,
): void {
  if (target.role === "OWNER") {
    if (action === "delete") throw new Error("An owner account can't be deleted.");
    if (actor?.role !== "OWNER") throw new Error("Only an owner can manage an owner account.");
  }
  if (target.role === "SUPER_ADMIN" && actor?.role !== "OWNER") {
    throw new Error(
      action === "delete"
        ? "Only an owner can delete a super-admin."
        : "Only an owner can manage a super-admin.",
    );
  }
}

export async function deleteUser(id: string, actor?: { id: string; role: string; name?: string | null }) {
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new Error("User not found");
  if (actor && actor.id === id) throw new Error("You can't delete your own account");
  assertCanActOnUser(actor, { id: target.id, role: target.role }, "delete");
  const deleted = await prisma.user.delete({ where: { id } });
  // Audit: a user lost access. Tenant-scoped (portal users only), attributed to the
  // admin who removed them. Log-only — no automation fires. Best-effort.
  if (target.tenantId) {
    void emitEvent({
      tenantId: target.tenantId,
      type: EVENT_TYPES.UserDeleted,
      actor: { type: "user", id: actor?.id ?? null, name: actor?.name ?? null },
      subject: { type: "user", id: target.id },
      payload: { email: target.email, role: target.role },
    }).catch(() => { /* never block the delete on audit */ });
  }
  return deleted;
}

// Assign a user's role — the Batch 5 "edit a user's permissions" mechanism. Reuses
// the Cap #2 tier guard (a sub-super-admin actor can't touch a super-admin-tier user)
// and clamps what can be granted: only CLIENT_USER / PORTAL_ADMIN, or a per-portal
// CUSTOM role (which sets base CLIENT_USER + customRoleId, so the fallback on role
// deletion is the restricted default). Admin-tier roles can never be granted here, so
// no one can elevate a user above what a portal admin may grant. A custom role is
// tenant-scoped and already ceiling-capped (validated on save), so this can't exceed it.
export async function assignUserRole(
  targetId: string,
  tenantId: string,
  actor: { id: string; role: string },
  role: string,
): Promise<{ id: string; role: string; customRoleId: string | null }> {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.tenantId !== tenantId) throw new Error("User not found in this portal");
  if (actor.id === targetId) throw new Error("You can't change your own role");
  assertCanActOnUser(actor, { id: target.id, role: target.role }, "role");

  let baseRole: string;
  let customRoleId: string | null;
  if (role === "CLIENT_USER" || role === "PORTAL_ADMIN") {
    baseRole = role; customRoleId = null;
  } else if (role === "OWNER" || role === "SUPER_ADMIN" || role === "AUDITOR") {
    throw new Error("That role can't be granted here");
  } else {
    const cr = await getPortalRole(role, tenantId); // tenant-scoped custom role
    if (!cr) throw new Error("Unknown role");
    baseRole = "CLIENT_USER"; customRoleId = (cr as any).id;
  }
  const updated: any = await prisma.user.update({ where: { id: targetId }, data: { role: baseRole as any, customRoleId } as any });
  return { id: updated.id, role: updated.role, customRoleId: updated.customRoleId ?? null };
}

export async function setPassword(userId: string, password: string) {
  const passwordHash = await hashPassword(password);
  return prisma.user.update({ where: { id: userId }, data: { passwordHash, resetToken: null, resetTokenExpiry: null } });
}

export async function createResetToken(email: string): Promise<{ token: string; userId: string } | null> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return null;
  const token = crypto.randomBytes(24).toString("hex");
  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken: token, resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) },
  });
  return { token, userId: user.id };
}

export async function consumeResetToken(token: string, newPassword: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { resetToken: token } });
  if (!user || !user.resetTokenExpiry || user.resetTokenExpiry.getTime() < Date.now()) return false;
  await setPassword(user.id, newPassword);
  return true;
}

export function publicUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    customRoleId: u.customRoleId ?? null,
    tenantId: u.tenantId ?? null,
    tenantName: u.tenant?.name ?? null,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    expiresAt: u.expiresAt ? new Date(u.expiresAt).toISOString() : null,
    disabled: !!u.disabled,
    createdAt: u.createdAt.toISOString(),
  };
}

// NOTE: Theme is now PER-PORTAL branding, not a per-user preference. The old
// getUserTheme/setUserTheme path was removed; theme lives on Tenant.theme and is
// handled by getPortalTheme/setPortalTheme in portalService.ts. The User.themePrefs
// column is left in place (dormant) and is no longer read or written.

// ---- Per-user Contacts column layout (stored on User.contactColumns JSON) ----
const COL_KEY_RE = /^[a-zA-Z0-9_.:-]{1,64}$/;

export interface ContactColumnLayout {
  order: string[];
  hidden: string[];
}

function sanitizeLayout(input: any): ContactColumnLayout {
  const o = input && typeof input === "object" ? input : {};
  const clean = (arr: any) =>
    (Array.isArray(arr) ? arr : [])
      .filter((k) => typeof k === "string" && COL_KEY_RE.test(k))
      .slice(0, 100);
  return { order: clean(o.order), hidden: clean(o.hidden) };
}

export async function getContactColumns(userId: string): Promise<ContactColumnLayout> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return sanitizeLayout(user ? (user as any).contactColumns : null);
}

export async function setContactColumns(userId: string, input: unknown): Promise<ContactColumnLayout> {
  const clean = sanitizeLayout(input);
  await prisma.user.update({ where: { id: userId }, data: { contactColumns: clean as any } });
  return clean;
}
