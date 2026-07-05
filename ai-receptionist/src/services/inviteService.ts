import crypto from "crypto";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { createUser } from "./userService";
import { emitEvent } from "../events/bus";
import { EVENT_TYPES } from "../events/types";
import { sendRichEmail } from "./notificationService";
import { resolveMergeTags } from "./mergeTags";
import { env } from "../config/env";
import { MASTER_HUB_NAME } from "../config/masterHub";

// The Quick-Reference Guide is no longer emailed as an attachment. It is served
// at a public, same-domain URL instead (GET /quick-reference-guide.pdf, wired up
// in src/app.ts), which streams the repo file assets/Clarity_QRG.pdf. To swap the
// guide later, replace that single file and redeploy — no code change, and invites
// carry no attachment at all.

// The Prisma client is regenerated (with the Invite model) by the migration step.
// Until the person runs that, we reach the table via a cast so the build still
// type-checks; after `prisma generate` this is just the normal client.
const db = prisma as any;

const INVITE_TTL_DAYS = 7;
// Roles that may be invited. OWNER is intentionally NOT here — owner is granted
// only by the make-owner script, never via an invite or any create form.
type InviteRole = "PORTAL_ADMIN" | "CLIENT_USER" | "SUPER_ADMIN" | "AUDITOR";

// One plain-English sentence per role, used in the invite email.
const ROLE_BLURB: Record<string, string> = {
  SUPER_ADMIN: "full administrative access across the whole system",
  AUDITOR: "temporary reviewer access that expires 3 days after you sign in",
  PORTAL_ADMIN: "access to manage this business's CRM",
  CLIENT_USER: "access to this business's CRM",
};

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
/**
 * Send the invite email via Resend (the same path as other real emails). Returns
 * true if it was sent, false if delivery failed/was limited. IMPORTANT: it never
 * throws — a failed send must not break user creation. The caller still returns
 * the activation link so it can be copied manually. Going live with real delivery
 * to everyone is a config change only: set RESEND_FROM to a verified domain.
 */
export async function sendInvite(
  invite: { email: string; role?: string },
  link: string,
  meta?: { sentById?: string | null; tenantId?: string | null },
): Promise<boolean> {
  const blurb = ROLE_BLURB[invite.role || ""] || "access to the CRM";
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2430">
      <h2 style="margin:0 0 12px">You've been invited to Clarity CRM</h2>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.5">You've been given ${blurb}.</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5">Click below to set your password and finish setting up your account.</p>
      <p style="margin:0 0 24px">
        <a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:15px">Set your password</a>
      </p>
      <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5">If the button doesn't work, paste this link into your browser:<br>${link}</p>
    </div>`;
  try {
    await sendRichEmail({
      to: invite.email,
      subject: "You're invited to Clarity CRM",
      html,
      fromEmail: env.RESEND_FROM, // send address is RESEND_FROM (no Reply-To set)
      // Master-hub sends (no tenant) carry the master-hub label as their sender identity.
      fromName: meta?.tenantId ? null : MASTER_HUB_NAME,
    }, {
      // Stamp who sent it (and the tenant, if any) so the master-hub Email log shows
      // "Sent by" and a Tenant instead of blanks. Both null for a master-scope invite
      // sent by no specific user — the log falls back to the master-hub name.
      type: "invite",
      sentById: meta?.sentById ?? null,
      tenantId: meta?.tenantId ?? null,
    });
    return true;
  } catch (err) {
    logger.warn(`Invite email to ${invite.email} could not be sent (delivery limited until a domain is verified): ${(err as Error).message}`);
    return false;
  }
}

/** The merge token the inviter places in a custom email; replaced with the real
 *  one-time apply link at send. Mirrors public/js/compose.js INVITE_LINK_TOKEN. */
export const INVITE_LINK_TOKEN = "{{invite_link}}";

/** True if a custom invite body actually contains the apply-link merge token. */
export function hasInviteLinkToken(html: string | null | undefined): boolean {
  return typeof html === "string" && html.includes(INVITE_LINK_TOKEN);
}

/**
 * Send a CUSTOM invitation email written by the inviter. Identical outbound path to
 * sendInvite (Resend, RESEND_FROM, no attachment) — the ONLY differences are the
 * caller-supplied subject/body and that every {{invite_link}} is replaced with the
 * SAME real one-time link the default email would have used. Never throws.
 */
export async function sendCustomInvite(
  invite: { email: string; role?: string },
  link: string,
  rawHtml: string,
  subject?: string | null,
  meta?: { sentById?: string | null; tenantId?: string | null },
): Promise<boolean> {
  // Replace EVERY occurrence of the token with the real link (href, button URL, or
  // inline text — wherever the writer placed it).
  const linked = String(rawHtml || "").split(INVITE_LINK_TOKEN).join(link);
  // An invitee is not a contact, so any personalization merge tags have no values —
  // collapse them to their fallback (or nothing). Never leak a raw {{token}}.
  const html = resolveMergeTags(linked, {});
  const finalSubject = resolveMergeTags((subject && subject.trim()) || "You're invited to Clarity CRM", {});
  try {
    await sendRichEmail({
      to: invite.email,
      subject: finalSubject,
      html,
      fromEmail: env.RESEND_FROM,
      fromName: meta?.tenantId ? null : MASTER_HUB_NAME,
    }, {
      type: "invite",
      sentById: meta?.sentById ?? null,
      tenantId: meta?.tenantId ?? null,
    });
    return true;
  } catch (err) {
    logger.warn(`Custom invite email to ${invite.email} could not be sent (delivery limited until a domain is verified): ${(err as Error).message}`);
    return false;
  }
}

/**
 * Create a single-use, expiring invite for { email, role } scoped to a tenant.
 * Any earlier still-open invite for the same email+tenant is superseded so there
 * is only ever one live link per invitee. Returns the stored invite row.
 */
export async function createInvite(input: {
  email: string;
  role: InviteRole;
  tenantId: string | null;
  name?: string | null;
  createdById?: string | null;
  customRoleId?: string | null;
}) {
  const email = normEmail(input.email);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("A valid email address is required");
  // Never invitable: OWNER (granted only by the make-owner script). The calling
  // routes further restrict which roles each form may invite.
  const allowed = ["PORTAL_ADMIN", "CLIENT_USER", "SUPER_ADMIN", "AUDITOR"];
  if (!allowed.includes(input.role)) {
    throw new Error("That role can't be invited");
  }
  // Don't invite an email that already has an account.
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) throw new Error("A user with that email already exists");

  // Supersede any prior still-open invite for this email in this scope (portal, or
  // the no-portal scope for super-admin/auditor invites).
  await db.invite.updateMany({
    where: { email, tenantId: input.tenantId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = crypto.randomBytes(32).toString("hex"); // 256-bit, unguessable
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400000);
  return db.invite.create({
    data: { token, email, name: input.name ?? null, role: input.role, tenantId: input.tenantId, expiresAt, createdById: input.createdById ?? null, customRoleId: input.customRoleId ?? null },
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

/**
 * Pending invites (sent, not yet accepted, not expired) shaped like user rows so
 * they can be merged into the user lists with a "Pending" badge. tenantId null =
 * master-scope invites (Super Admin / Auditor). When an invite is accepted it is
 * marked used and a real User row is created, so it automatically stops appearing
 * here and shows up as a normal (accepted) user instead — the status flips on its
 * own with no extra step.
 */
export async function listPendingInvitesAsUsers(tenantId: string | null) {
  const rows = await db.invite.findMany({
    where: { tenantId: tenantId ?? null, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: { tenant: true },
  });
  return rows.map((r: any) => ({
    id: `invite:${r.id}`,
    inviteId: r.id,
    email: r.email,
    name: r.name ?? null,
    role: r.role,
    tenantId: r.tenantId ?? null,
    tenantName: r.tenant?.name ?? null,
    lastLoginAt: null,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    pending: true,
  }));
}

/** Revoke a pending invite (tenant-scoped). Consuming it = it can never be used. */
export async function revokeInvite(tenantId: string | null, id: string): Promise<boolean> {
  const inv = await db.invite.findUnique({ where: { id } });
  if (!inv || (inv.tenantId ?? null) !== (tenantId ?? null) || inv.usedAt) return false;
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

  const user = await createUser({ email: inv.email, password, name: inv.name ?? null, role: inv.role, tenantId: inv.tenantId, customRoleId: (inv as any).customRoleId ?? null });
  // Audit: a user joined (accepted an invite). Tenant-scoped, so only for portal
  // invites (master-scope super-admin/auditor invites have no tenant). Attributed
  // to the new user; records the role granted and who invited them. Log-only.
  if (inv.tenantId) {
    void emitEvent({
      tenantId: inv.tenantId,
      type: EVENT_TYPES.UserCreated,
      actor: { id: user.id, name: user.name ?? null, type: "user" },
      subject: { type: "user", id: user.id },
      payload: { email: user.email, role: user.role, invited_by: inv.createdById ?? null },
    }).catch(() => { /* never block invite acceptance on audit */ });
  }
  return { ok: true, user: { id: user.id } };
}
