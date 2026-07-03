import { Router, Request, Response, NextFunction } from "express";
import { requireRole } from "../middleware/auth";
import { listPortals, getPortal, createPortal, updatePortal } from "../services/portalService";
import { createUser, listUsers, deleteUser, publicUser, updateUserName } from "../services/userService";
import { createInvite, listPendingInvites, listPendingInvitesAsUsers, revokeInvite, sendInvite, sendCustomInvite, hasInviteLinkToken, inviteLink } from "../services/inviteService";
import { prisma } from "../db/client";
import { listFeedback, getFeedbackTicket, createFeedbackTicket, addFeedbackMessage, resolveFeedbackTicket, restoreFeedbackTicket, deleteFeedbackTicket, listFeedbackExportRows, listAllFeedbackExportRows, addFeedbackAttachments } from "../services/feedbackService";
import { createExport, listMasterExports, getMasterExportCsv } from "../services/exportService";
import { listChangeLog } from "../services/changelogService";
import { listAllEmailLogs } from "../services/emailLogService";
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
  const { name, notifyEmail, lockedPages } = (req.body ?? {}) as Record<string, any>;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    // Only name + (optional) notifyEmail are collected at creation now. Business type,
    // phone, greeting, and the identity rule are no longer set here (dead/decoupled or
    // set later under Integrations); requireEmail is hard-set true and not accepted.
    // lockedPages (owner page-lock) may be set atomically at creation.
    const portal = await createPortal({ name, notifyEmail: notifyEmail || "", lockedPages });
    logger.info(`Portal created: ${portal.name} (${portal.id})`);
    res.json(portal);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

adminRouter.patch("/portals/:id", async (req: Request, res: Response) => {
  try {
    // Whitelist updatable fields. requireEmail (the old identity rule) is no longer
    // accepted anywhere — it's hard-set true. businessType/greeting are dead and dropped.
    const b = (req.body ?? {}) as Record<string, any>;
    const data: any = {};
    for (const k of ["name", "phoneNumber", "notifyEmail", "status", "lockedPages"]) {
      if (b[k] !== undefined) data[k] = b[k];
    }
    // Voice mode is the authoritative 3-way choice. Validate it server-side and
    // keep the receptionistEnabled boolean mirror in sync (= mode != OFF). If an
    // old client sends only the boolean, map it onto a voiceMode for consistency.
    if (typeof b.voiceMode === "string") {
      const vm = b.voiceMode.toUpperCase();
      if (!["OFF", "WALKIE", "SMOOTH"].includes(vm)) {
        res.status(400).json({ error: "voiceMode must be OFF, WALKIE, or SMOOTH" });
        return;
      }
      data.voiceMode = vm;
      data.receptionistEnabled = vm !== "OFF";
    } else if (typeof b.receptionistEnabled === "boolean") {
      data.receptionistEnabled = b.receptionistEnabled;
      data.voiceMode = b.receptionistEnabled ? "WALKIE" : "OFF";
    }
    const portal = await updatePortal(req.params.id, data);
    res.json(portal);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

adminRouter.get("/users", async (req: Request, res: Response) => {
  const tenantId = (req.query.tenantId as string | undefined) || undefined;
  const users = (await listUsers(tenantId)) as any[];
  // The master Users page manages the operator team only — Owner, Super Admin,
  // and Auditor (portal-less accounts). Portal-scoped users (Portal Admin /
  // Client User) belong to each portal's own Users list and must NOT appear in
  // the master view. (If a specific portal is ever requested here, return that
  // portal's users unchanged — defensive; the master page never passes one.)
  const MASTER_ROLES = ["OWNER", "SUPER_ADMIN", "AUDITOR"];
  const accepted = tenantId ? users : users.filter((u) => MASTER_ROLES.includes(u.role));
  // Also surface pending (invited, not-yet-accepted) accounts immediately, marked
  // "Pending". Master scope = tenantId null. They flip to normal users on accept.
  const pending = await listPendingInvitesAsUsers(tenantId ?? null);
  res.json([...pending, ...accepted]);
});

// Revoke a pending master invite (Super Admin / Auditor; tenantId null).
adminRouter.post("/invites/:inviteId/revoke", async (req: Request, res: Response) => {
  const ok = await revokeInvite(null, req.params.inviteId);
  if (!ok) { res.status(404).json({ error: "Invite not found" }); return; }
  res.json({ ok: true });
});

adminRouter.post("/users", async (req: Request, res: Response) => {
  const { email, role, name, customHtml, customSubject } = (req.body ?? {}) as Record<string, string>;
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
  // Custom email must carry the apply-link token — validated BEFORE minting so a
  // missing-link request creates no invite.
  const isCustom = typeof customHtml === "string" && customHtml.trim().length > 0;
  if (isCustom && !hasInviteLinkToken(customHtml)) {
    res.status(400).json({ error: "Your email doesn't include the invite link — add it before sending." });
    return;
  }
  try {
    // Create an invite (no portal). The person sets their own password via the
    // link; the typed name is carried on the invite and applied at activation.
    const invite = await createInvite({ email, role: role as any, tenantId: null, name: name || null, createdById: req.user?.id ?? null });
    const link = inviteLink(requestOrigin(req), invite.token);
    const emailed = isCustom
      ? await sendCustomInvite({ email: invite.email, role: invite.role }, link, customHtml, customSubject)
      : await sendInvite({ email: invite.email, role: invite.role }, link);
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
    // `emailed` reports whether delivery actually succeeded so callers (e.g. the
    // tenant-create wizard) can warn when the invite record exists but no email went out.
    res.json({ invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }, link, emailed });
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

// ---- Feedback (master-hub / admin-facing) ----------------------------------
// This whole router is already gated to OWNER / SUPER_ADMIN / AUDITOR and blocks
// impersonating super-admins. All three roles can submit, view EACH OTHER's
// tickets, and reply; only the OWNER can resolve or restore. These tickets have
// no tenantId, so portal users can never see them (and these never show portal
// tickets). Permission details live in feedbackService (scope "master").
function feedbackCtxMaster(req: Request): { scope: "master"; actor: typeof req.user } {
  return { scope: "master", actor: req.user! };
}

adminRouter.get("/feedback", async (req: Request, res: Response) => {
  res.json(await listFeedback(feedbackCtxMaster(req) as any));
});

adminRouter.post("/feedback", async (req: Request, res: Response) => {
  const { problem, description, attachments } = (req.body ?? {}) as { problem?: string; description?: string; attachments?: unknown };
  try {
    res.json(await createFeedbackTicket(feedbackCtxMaster(req) as any, { problem: problem || "", description: description || "", attachments }));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

// Export rows for the master-hub's OWN tickets (one row per reply). Master roles.
adminRouter.get("/feedback/export-rows", async (req: Request, res: Response) => {
  res.json(await listFeedbackExportRows(feedbackCtxMaster(req) as any));
});

// Export rows across ALL portals + the master hub (Portal column per row; capped).
adminRouter.get("/feedback/export-rows-all", async (req: Request, res: Response) => {
  res.json(await listAllFeedbackExportRows(req.user!));
});

// Master-hub export history (no single portal). Shared by the master-local and
// all-portals export popups; gated to master roles by the admin router above.
adminRouter.get("/exports", async (_req: Request, res: Response) => {
  res.json(await listMasterExports());
});

adminRouter.post("/exports", async (req: Request, res: Response) => {
  const { name, rowCount, fields, csv, scope } = (req.body ?? {}) as { name?: string; rowCount?: number; fields?: unknown; csv?: string; scope?: string };
  if (!name || !name.trim()) { res.status(400).json({ error: "An export name is required" }); return; }
  if (typeof csv !== "string") { res.status(400).json({ error: "Nothing to export" }); return; }
  const rec = await createExport({ tenantId: null, scope: scope === "all" ? "all" : "master", name, rowCount: rowCount || 0, fields, csv, createdById: req.user!.id });
  res.json(rec);
});

adminRouter.get("/exports/:id/download", async (req: Request, res: Response) => {
  const result = await getMasterExportCsv(req.params.id);
  if (!result) { res.status(404).json({ error: "Export not found" }); return; }
  res.json(result);
});

adminRouter.get("/feedback/:id", async (req: Request, res: Response) => {
  const t = await getFeedbackTicket(req.params.id, feedbackCtxMaster(req) as any);
  if (!t) { res.status(404).json({ error: "Ticket not found" }); return; }
  res.json(t);
});

adminRouter.post("/feedback/:id/messages", async (req: Request, res: Response) => {
  const { body } = (req.body ?? {}) as { body?: string };
  try {
    res.json(await addFeedbackMessage(req.params.id, feedbackCtxMaster(req) as any, { body: body || "" }));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

adminRouter.post("/feedback/:id/attachments", async (req: Request, res: Response) => {
  const { urls } = (req.body ?? {}) as { urls?: unknown };
  try {
    res.json(await addFeedbackAttachments(req.params.id, feedbackCtxMaster(req) as any, { urls }));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

adminRouter.post("/feedback/:id/resolve", async (req: Request, res: Response) => {
  try {
    res.json(await resolveFeedbackTicket(req.params.id, feedbackCtxMaster(req) as any));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

adminRouter.post("/feedback/:id/restore", async (req: Request, res: Response) => {
  try {
    res.json(await restoreFeedbackTicket(req.params.id, feedbackCtxMaster(req) as any));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

// Permanently delete a resolved master-hub ticket. The router allows auditors in,
// so gate THIS route to OWNER/SUPER_ADMIN (auditors never delete); deleteFeedbackTicket
// re-checks the same rule + resolved-only as defense in depth.
adminRouter.delete("/feedback/:id", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try {
    res.json(await deleteFeedbackTicket(req.params.id, feedbackCtxMaster(req) as any));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

// Product-level Change Log (read-only). Gated by the router-level
// requireRole(OWNER, SUPER_ADMIN, AUDITOR) above — the same master-hub tier used
// everywhere else here. The app reads these rows from the DB; it never reads git.
adminRouter.get("/changelog", async (_req: Request, res: Response) => {
  try {
    res.json(await listChangeLog());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Cross-tenant Email deliverability feed for the master-hub Email page. The whole router
// is already gated to OWNER/SUPER_ADMIN/AUDITOR; this per-route requireRole tightens it to
// OWNER/SUPER_ADMIN only (auditors don't get the cross-tenant email view).
adminRouter.get("/email-logs", requireRole("OWNER", "SUPER_ADMIN"), async (_req: Request, res: Response) => {
  try {
    res.json(await listAllEmailLogs());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
