import crypto from "crypto";
import { prisma } from "../db/client";
import { hashPassword } from "../auth/passwords";
import { Role } from "../middleware/auth";

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string | null;
  role: Role;
  tenantId?: string | null;
}

export async function createUser(input: CreateUserInput) {
  const passwordHash = await hashPassword(input.password);
  return prisma.user.create({
    data: {
      email: input.email.trim().toLowerCase(),
      passwordHash,
      name: input.name ?? null,
      role: input.role,
      tenantId: input.tenantId ?? null,
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

export async function deleteUser(id: string) {
  return prisma.user.delete({ where: { id } });
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
    tenantId: u.tenantId ?? null,
    tenantName: u.tenant?.name ?? null,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
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
