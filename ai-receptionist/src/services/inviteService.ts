import crypto from "crypto";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { createUser } from "./userService";

// The Prisma client is regenerated (with the Invite model) by the migration step.
// Until the person runs that, we reach the table via a cast so the build still
// type-checks; after `prisma generate` this is just the normal client.
const db = prisma as any;

const INVITE_TTL_DAYS = 7;
type InviteRole = "PORTAL_ADMIN" | "CLIENT_USER";

function normEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

/** Build the public invite link for a token from the request's origin. */
export function inviteLink(origin: string, token: string): string {
  return origin.replace(/\/+$/, "") + "/invite.html?token=" + encodeURIComponent(token);
}

/**
 * THE SINGLE SWITCH for going live with real email. Today email is mocked, so we
 * just log the link (and the caller also shows it in the UI for copy/paste). To
 * send for real later, replace the log line below with your email send — and
 * NOTHING else in the flow changes. This is the only place that "sends".
 */
export async function sendInvite(invite: { email: string }, link: string): Promise<void> {
  logger.info(`[mock] invite email would be sent to ${invite.email}: ${link}`);
  // --- GO LIVE: replace the log above with a real send, e.g. ---
  // await sendRichEmail({ to: invite.email, subject: "You've been invited",
  //   html: `<p>Set up your account:</p><p><a href="${link}">${link}</a></p>`, ... });
}

/**
 * Create a single-use, expiring invite for { email, role } scoped to a tenant.
 * Any earlier still-open invite for the same email+tenant is superseded so there
 * is only ever one live link per invitee. Returns the stored invite row.
 */
export async function createInvite(input: {
  email: string;
  role: InviteRole;
  tenantId: string;
  createdById?: string | null;
}) {
  const email = normEmail(input.email);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("A valid email address is required");
  if (input.role !== "PORTAL_ADMIN" && input.role !== "CLIENT_USER") {
    throw new Error("Role must be PORTAL_ADMIN or CLIENT_USER");
  }
  // Don't invite an email that already has an account.
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) throw new Error("A user with that email already exists");

  // Supersede any prior still-open invite for this email in this portal.
  await db.invite.updateMany({
    where: { email, tenantId: input.tenantId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = crypto.randomBytes(32).toString("hex"); // 256-bit, unguessable
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400000);
  return db.invite.create({
    data: { token, email, role: input.role, tenantId: input.tenantId, expiresAt, createdById: input.createdById ?? null },
  });
}

/** Pending (unused, unexpired) invites for a portal — for the setup UI. No tokens. */
export async function listPendingInvites(tenantId: string) {
  const rows = await db.invite.findMany({
    where: { tenantId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r: any) => ({ id: r.id, email: r.email, role: r.role, expiresAt: r.expiresAt, createdAt: r.createdAt }));
}

/** Revoke a pending invite (tenant-scoped). Consuming it = it can never be used. */
export async function revokeInvite(tenantId: string, id: string): Promise<boolean> {
  const inv = await db.invite.findUnique({ where: { id } });
  if (!inv || inv.tenantId !== tenantId || inv.usedAt) return false;
  await db.invite.update({ where: { id }, data: { usedAt: new Date() } });
  return true;
}

/**
 * Resolve a token to a still-valid invite, or null. Returns null for missing,
 * expired, OR already-used tokens — the caller must NOT distinguish these to the
 * public (no information leak about which invites exist).
 */
export async function getValidInvite(token: string) {
  if (!token || typeof token !== "string") return null;
  const inv = await db.invite.findUnique({ where: { token } });
  if (!inv) return null;
  if (inv.usedAt) return null;
  if (new Date(inv.expiresAt).getTime() < Date.now()) return null;
  return inv;
}

export type AcceptResult =
  | { ok: true; user: { id: string } }
  | { ok: false; reason?: "weak" | "exists" };

/**
 * Activate an account from an invite. SERVER-AUTHORITATIVE: role + tenant + email
 * come ONLY from the stored invite, never from caller input. Single-use is enforced
 * atomically (the guarded updateMany only succeeds once), so a double-submit or race
 * cannot activate twice.
 */
export async function acceptInvite(token: string, password: string): Promise<AcceptResult> {
  const inv = await getValidInvite(token);
  if (!inv) return { ok: false };
  if (!password || String(password).length < 8) return { ok: false, reason: "weak" };

  // Refuse if the email somehow already has an account (don't consume the invite).
  const existing = await prisma.user.findUnique({ where: { email: inv.email } });
  if (existing) return { ok: false, reason: "exists" };

  // Atomically consume: this only flips usedAt for an invite that is STILL unused,
  // so concurrent accepts can't both pass.
  const consumed = await db.invite.updateMany({ where: { id: inv.id, usedAt: null }, data: { usedAt: new Date() } });
  if (!consumed.count) return { ok: false }; // lost the race — already used

  const user = await createUser({ email: inv.email, password, name: null, role: inv.role, tenantId: inv.tenantId });
  return { ok: true, user: { id: user.id } };
}
