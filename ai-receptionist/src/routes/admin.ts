import { Router, Request, Response, NextFunction } from "express";
import { requireRole } from "../middleware/auth";
import { listPortals, getPortal, createPortal, updatePortal } from "../services/portalService";
import { createUser, listUsers, deleteUser, publicUser, updateUserName } from "../services/userService";
import { createInvite, listPendingInvites, revokeInvite, sendInvite, inviteLink } from "../services/inviteService";
import { getAppSetting, setAppSetting, INVITE_SENDER_EMAIL_KEY } from "../services/appSettingService";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";

// Master (SUPER_ADMIN) surface: manage all portals and all users.
export const adminRouter = Router();
adminRouter.use(requireRole("OWNER", "SUPER_ADMIN", "AUDITOR"));
// Batch B lockout: an impersonating super-admin must NOT reach the master hub
// (no creating portals/users while "acting as" someone). Evaluated on the overlay
// presence (req.impersonation is only ever set for a real super-admin).
adminRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (req.impersonation) {
    res.status(403).json({ error: "Exit impersonation mode to use the master admin." });
    return;
  }
  next();
});

adminRouter.get("/portals", async (_req: Request, res: Response) => {
  res.json(await listPortals());
});

adminRouter.get("/portals/:id", async (req: Request, res: Response) => {
  const p = await getPortal(req.params.id);
  if (!p) {
    res.status(404).json({ error: "Portal not found" });
    return;
  }
  res.json(p);
});

adminRouter.post("/portals", async (req: Request, res: Response) => {
  const { name, businessType, phoneNumber, notifyEmail, greeting, requireEmail } = (req.body ?? {}) as Record<string, any>;
  if (!name || !notifyEmail) {
    res.status(400).json({ error: "name and notifyEmail are required" });
    return;
  }
  try {
    const portal = await createPortal({ name, businessType, phoneNumber: phoneNumber || null, notifyEmail, greeting, requireEmail: requireEmail !== false });
    logger.info(`Portal created: ${portal.name} (${portal.id})`);
    res.json(portal);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

adminRouter.patch("/portals/:id", async (req: Request, res: Response) => {
  try {
    // Whitelist updatable fields. requireEmail (the identity rule) is settable
    // here because this whole router is SUPER_ADMIN-only.
    const b = (req.body ?? {}) as Record<string, any>;
    const data: any = {};
    for (const k of ["name", "businessType", "phoneNumber", "notifyEmail", "greeting", "status"]) {
      if (b[k] !== undefined) data[k] = b[k];
    }
    if (typeof b.requireEmail === "boolean") data.requireEmail = b.requireEmail;
    if (typeof b.receptionistEnabled === "boolean") data.receptionistEnabled = b.receptionistEnabled;
    const portal = await updatePortal(req.params.id, data);
    res.json(portal);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

adminRouter.get("/users", async (req: Request, res: Response) => {
  const tenantId = (req.query.tenantId as string | undefined) || undefined;
  res.json(await listUsers(tenantId));
});

adminRouter.post("/users", async (req: Request, res: Response) => {
  const { email, role, name } = (req.body ?? {}) as Record<string, string>;
  if (!email || !role) {
    res.status(400).json({ error: "email and role are required" });
    return;
  }
  // The master form may ONLY invite top-tier, portal-less accounts: a Super Admin
  // or an Auditor. OWNER is never creatable here (granted only by the make-owner
  // script). Portal roles are invited from each portal's own "Users" button.
  if (role !== "SUPER_ADMIN" && role !== "AUDITOR") {
    res.status(400).json({ error: "This form can only create a Super Admin or an Auditor." });
    return;
  }
  try {
    // Create an invite (no portal). The person sets their own password via the
    // link; the typed name is carried on the invite and applied at activation.
    const invite = await createInvite({ email, role: role as any, tenantId: null, name: name || null, createdById: req.user?.id ?? null });
    const link = inviteLink(requestOrigin(req), invite.token);
    const emailed = await sendInvite({ email: invite.email, role: invite.role }, link);
    // `link` is always returned so it can be copied while email delivery is limited.
    res.json({ invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }, link, emailed });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

adminRouter.delete("/users/:id", async (req: Request, res: Response) => {
  if (req.params.id === req.user?.id) {
    res.status(400).json({ error: "You can't delete your own account" });
    return;
  }
  try {
    await deleteUser(req.params.id, { id: req.user!.id, role: req.user!.role });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Item 2: edit a user's name --------------------------------------------
// Permission (SERVER-ENFORCED): an OWNER may rename anyone; everyone else may
// rename ONLY their own account. Hiding the pencil in the UI is not enough.
adminRouter.patch("/users/:id/name", async (req: Request, res: Response) => {
  const isOwner = req.user?.role === "OWNER";
  const isSelf = req.params.id === req.user?.id;
  if (!isOwner && !isSelf) {
    res.status(403).json({ error: "You can only edit your own name." });
    return;
  }
  const name = typeof (req.body ?? {}).name === "string" ? (req.body.name as string) : "";
  try {
    const user = await updateUserName(req.params.id, name);
    res.json(publicUser(user));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Item 1: master "invite sender email" setting --------------------------
// READ: any master-hub user (this whole router is OWNER/SUPER_ADMIN/AUDITOR).
adminRouter.get("/settings/invite-sender", async (_req: Request, res: Response) => {
  const email = (await getAppSetting(INVITE_SENDER_EMAIL_KEY)) || "";
  res.json({ email });
});

// SAVE: OWNER ONLY (server-enforced — an Auditor/Super-Admin is refused here even
// though the rest of the master hub is open to them).
adminRouter.put("/settings/invite-sender", async (req: Request, res: Response) => {
  if (req.user?.role !== "OWNER") {
    res.status(403).json({ error: "Only an owner can change the invite sender email." });
    return;
  }
  const raw = typeof (req.body ?? {}).email === "string" ? (req.body.email as string).trim() : "";
  if (raw && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    res.status(400).json({ error: "Please enter a valid email address." });
    return;
  }
  await setAppSetting(INVITE_SENDER_EMAIL_KEY, raw);
  res.json({ email: raw });
});

// Confirm a phone number isn't already attached to another portal.
adminRouter.get("/check-phone", async (req: Request, res: Response) => {
  const phone = (req.query.phone as string | undefined) || "";
  if (!phone) {
    res.json({ available: true });
    return;
  }
  const existing = await prisma.tenant.findUnique({ where: { phoneNumber: phone } });
  res.json({ available: !existing });
});

// ---- Portal setup invites (super-admin) ------------------------------------
// The setup flow's "Add users" step. Creating an invite stores a single-use,
// expiring token and (today) "sends" it by logging the link; the link is returned
// so the UI can show it for copy/paste. Role/tenant live on the server-side invite.

function requestOrigin(req: Request): string {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "").trim();
  return proto + "://" + host;
}

// List pending invites for a portal (no tokens exposed).
adminRouter.get("/portals/:id/invites", async (req: Request, res: Response) => {
  res.json(await listPendingInvites(req.params.id));
});

// Create an invite for { email, role } in this portal, then "send" it (mock = log).
adminRouter.post("/portals/:id/invites", async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    res.status(404).json({ error: "Portal not found" });
    return;
  }
  const { email, role } = (req.body ?? {}) as { email?: string; role?: string };
  try {
    const invite = await createInvite({
      email: String(email || ""),
      role: role === "PORTAL_ADMIN" ? "PORTAL_ADMIN" : "CLIENT_USER",
      tenantId,
      createdById: req.user?.id ?? null,
    });
    const link = inviteLink(requestOrigin(req), invite.token);
    const emailed = await sendInvite({ email: invite.email, role: invite.role }, link);
    logger.info(`Invite created for ${invite.email} -> portal ${tenantId} (emailed: ${emailed})`);
    // `link` is returned ONLY because email is mocked, so the super-admin can copy
    // it to test. With real email this field would simply stop being returned.
    res.json({ invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }, link });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Revoke a pending invite.
adminRouter.post("/portals/:id/invites/:inviteId/revoke", async (req: Request, res: Response) => {
  const ok = await revokeInvite(req.params.id, req.params.inviteId);
  if (!ok) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  res.json({ ok: true });
});
