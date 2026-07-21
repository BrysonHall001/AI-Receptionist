import { Router, Request, Response, NextFunction } from "express";
import { audit } from "../services/auditService";
import { AUDIT_ACTIONS } from "../services/auditCatalog";
import { requireRole } from "../middleware/auth";
import { listPortals, getPortal, createPortal, updatePortal, isBillingStatus, BILLING_STATUSES } from "../services/portalService";
import { systemRecordTypeOptions } from "../services/recordTypeService";
import { createUser, listUsers, deleteUser, publicUser, updateUserName } from "../services/userService";
import { createInvite, listPendingInvites, listPendingInvitesAsUsers, revokeInvite, sendInvite, sendCustomInvite, hasInviteLinkToken, inviteLink } from "../services/inviteService";
import { prisma } from "../db/client";
import { listFeedback, getFeedbackTicket, createFeedbackTicket, addFeedbackMessage, resolveFeedbackTicket, restoreFeedbackTicket, deleteFeedbackTicket, listFeedbackExportRows, listAllFeedbackExportRows, addFeedbackAttachments } from "../services/feedbackService";
import { createExport, listMasterExports, getMasterExportCsv, listExports, getExportArtifact } from "../services/exportService";
import { listChangeLog } from "../services/changelogService";
import { listGroupedEmailSends, listEmailSendRecipients } from "../services/emailLogService";
import { getBillingRates, updateBillingRates } from "../services/billingRateService";
import { aggregateTenant, aggregateAll, aggregateAllRows, isBucket, parseDate, type Bucket } from "../services/usageAggregationService";
import { portfolioRows, chargeRows } from "../services/billingSourceService";
import { listBillingDashboards, createBillingDashboard, renameBillingDashboard, updateBillingDashboardWidgets, deleteBillingDashboard, reorderBillingDashboards } from "../services/billingDashboardService";
import { getBillingConfig, updateBillingConfig } from "../services/billingConfigService";
import { computeSuggestedCharge } from "../services/chargeComputeService";
import { listCharges, listAllCharges, getCharge, createCharge, updateCharge, setChargeStatus, voidCharge, recordPayment, approveCharge } from "../services/chargeService";
import { verifyPassword } from "../auth/passwords";
import { ensureStripeCustomer } from "../services/stripeCustomerService";
import { StripeNotConfiguredError, isStripeConfigured, isStripeTestMode, stripeMode } from "../services/stripeService";
import { createInvoiceForCharge, sendInvoiceForCharge } from "../services/stripeInvoiceService";
import { markChargePaidManually } from "../services/chargeService";
import { getChargeAudit, getTermsAudit } from "../services/billingAuditService";
import { getBillingNotifyConfig, updateBillingNotifyConfig } from "../services/billingNotifyConfigService";
import { runBillingAutomationSweep } from "../services/billingSweepService";
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

// Record-type section options for the "which sections show" picker in the create-
// tenant form. Derived from the system record-type registry, so a future type
// appears here automatically. Contact is core (togglable:false). Portal-independent.
// Defined BEFORE "/portals/:id" so it's never mistaken for a portal id.
adminRouter.get("/portals/record-type-options", async (_req: Request, res: Response) => {
  res.json({ options: systemRecordTypeOptions() });
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
  const { name, notifyEmail, lockedPages, billingStatus, hiddenRecordTypes } = (req.body ?? {}) as Record<string, any>;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  // Billing status is REQUIRED at creation (no default) and must be a known value.
  if (!isBillingStatus(billingStatus)) {
    res.status(400).json({ error: "billingStatus is required and must be one of: " + BILLING_STATUSES.join(", ") });
    return;
  }
  try {
    // Only name + (optional) notifyEmail are collected at creation now. Business type,
    // phone, greeting, and the identity rule are no longer set here (dead/decoupled or
    // set later under Integrations); requireEmail is hard-set true and not accepted.
    // lockedPages (owner page-lock) may be set atomically at creation.
    const portal = await createPortal({ name, notifyEmail: notifyEmail || "", lockedPages, billingStatus, hiddenRecordTypes });
    { const u: any = (req as any).realUser || (req as any).user; audit({ tenantId: portal.id, actorType: "user", actorId: u?.id ?? null, actorLabel: (u && (u.name || u.email)) || "Hub user", action: AUDIT_ACTIONS.HUB_TENANT_CREATE, subjectType: "tenant", subjectId: portal.id, subjectLabel: portal.name }); }
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
    // Billing status is editable later (same OWNER/SUPER_ADMIN/AUDITOR master-hub gate as
    // other tenant edits). Validate against the allowed set when provided.
    if (b.billingStatus !== undefined) {
      if (!isBillingStatus(b.billingStatus)) {
        res.status(400).json({ error: "billingStatus must be one of: " + BILLING_STATUSES.join(", ") });
        return;
      }
      data.billingStatus = b.billingStatus;
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
    { const u: any = (req as any).realUser || (req as any).user;
      const suspended = data.billingStatus !== undefined && String(data.billingStatus).toUpperCase().includes("SUSPEND");
      audit({ tenantId: req.params.id, actorType: "user", actorId: u?.id ?? null, actorLabel: (u && (u.name || u.email)) || "Hub user", action: suspended ? AUDIT_ACTIONS.HUB_TENANT_SUSPEND : AUDIT_ACTIONS.HUB_SETTINGS_UPDATE, subjectType: "tenant", subjectId: req.params.id, subjectLabel: (portal as any)?.name || null, meta: data.billingStatus !== undefined ? { billingStatus: data.billingStatus } : null }); }
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
      ? await sendCustomInvite({ email: invite.email, role: invite.role }, link, customHtml, customSubject, { sentById: req.user?.id ?? null, tenantId: null })
      : await sendInvite({ email: invite.email, role: invite.role }, link, { sentById: req.user?.id ?? null, tenantId: null });
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
    const emailed = await sendInvite({ email: invite.email, role: invite.role }, link, { sentById: req.user?.id ?? null, tenantId });
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
adminRouter.get("/exports", async (req: Request, res: Response) => {
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const dataType = typeof req.query.dataType === "string" ? req.query.dataType : undefined;
  res.json(await listMasterExports({ kind, dataType }));
});

adminRouter.post("/exports", async (req: Request, res: Response) => {
  const { name, rowCount, fields, csv, scope, dataType } = (req.body ?? {}) as { name?: string; rowCount?: number; fields?: unknown; csv?: string; scope?: string; dataType?: string };
  if (!name || !name.trim()) { res.status(400).json({ error: "An export name is required" }); return; }
  if (typeof csv !== "string") { res.status(400).json({ error: "Nothing to export" }); return; }
  const rec = await createExport({ tenantId: null, scope: scope === "all" ? "all" : "master", name, rowCount: rowCount || 0, fields, csv, dataType: dataType || null, createdById: req.user!.id });
  res.json(rec);
});

adminRouter.get("/exports/:id/download", async (req: Request, res: Response) => {
  const result = await getMasterExportCsv(req.params.id);
  if (!result) { res.status(404).json({ error: "Export not found" }); return; }
  res.json(result);
});

// Per-tenant export history/save/download for the master-hub per-tenant Charges section (Task 2).
// Scoped to a specific tenant so exports land in — and download from — that tenant's history
// (listExports(tenantId)). Master-role gated by the admin router.
adminRouter.get("/exports/tenant/:tenantId", async (req: Request, res: Response) => {
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const dataType = typeof req.query.dataType === "string" ? req.query.dataType : undefined;
  res.json(await listExports(req.params.tenantId, { kind, dataType }));
});

adminRouter.post("/exports/tenant/:tenantId", async (req: Request, res: Response) => {
  const { name, rowCount, fields, csv, dataType } = (req.body ?? {}) as { name?: string; rowCount?: number; fields?: unknown; csv?: string; dataType?: string };
  if (!name || !name.trim()) { res.status(400).json({ error: "An export name is required" }); return; }
  if (typeof csv !== "string") { res.status(400).json({ error: "Nothing to export" }); return; }
  const rec = await createExport({ tenantId: req.params.tenantId, name, rowCount: rowCount || 0, fields, csv, dataType: dataType || null, createdById: req.user!.id });
  res.json(rec);
});

adminRouter.get("/exports/tenant/:tenantId/:id/download", async (req: Request, res: Response) => {
  const result = await getExportArtifact(req.params.id, req.params.tenantId);
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

// Editable cost rates (OWNER/SUPER_ADMIN only). GET returns the current rates (creating
// the singleton on first access); PUT updates any subset. No $ math here yet — storage
// + edit only.
adminRouter.get("/billing-rates", requireRole("OWNER", "SUPER_ADMIN"), async (_req: Request, res: Response) => {
  try {
    res.json(await getBillingRates());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

adminRouter.put("/billing-rates", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try {
    res.json(await updateBillingRates((req.body ?? {}) as Record<string, unknown>));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Usage + estimated cost aggregation (OWNER/SUPER_ADMIN). `bucket` = day|week|month|year;
// `from`/`to` are optional YYYY-MM-DD (default to the data's own range). Returns raw units
// AND computed $ per bucket, plus range totals.
function readBucket(req: Request): Bucket {
  const b = req.query.bucket;
  return isBucket(b) ? b : "day";
}
// Macro across ALL tenants (+ per-tenant breakdown for the range).
adminRouter.get("/usage", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try {
    res.json(await aggregateAll(parseDate(req.query.from), parseDate(req.query.to), readBucket(req)));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
// One tenant over a range.
adminRouter.get("/usage/tenant/:tenantId", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try {
    res.json(await aggregateTenant(req.params.tenantId, parseDate(req.query.from), parseDate(req.query.to), readBucket(req)));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Per-tenant, per-bucket usage rows for the master-hub "usage" widget source (rows carry the
// tenant NAME so name-based widget filters work). All tenants; OWNER/SUPER_ADMIN only.
adminRouter.get("/usage/rows", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await aggregateAllRows(parseDate(req.query.from), parseDate(req.query.to), readBucket(req))); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Billing reporting sources for widgets.
// portfolio: one row per tenant (all tenants) over a range — usage + est cost + billed/paid/outstanding.
adminRouter.get("/billing/portfolio", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await portfolioRows(parseDate(req.query.from), parseDate(req.query.to))); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
// charges: one row per charge over a range — all tenants (macro) or a single tenant (?tenantId=).
adminRouter.get("/billing/charges-source", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try {
    const tenantId = typeof req.query.tenantId === "string" && req.query.tenantId ? req.query.tenantId : null;
    res.json(await chargeRows(parseDate(req.query.from), parseDate(req.query.to), tenantId));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Global billing dashboards (OWNER/SUPER_ADMIN). GET returns a scope's widget layout (seeded
// with defaults on first access); PATCH replaces it — same { widgets } contract the reports
// editor already uses, so its save logic is reused as-is. scope ∈ tenant_drilldown | macro.
// Shared billing dashboards (OWNER/SUPER_ADMIN). A SET of named dashboards: list / create /
// rename+update-widgets / delete / reorder. Rendered in both Overview and tenant panels.
adminRouter.get("/billing-dashboards", requireRole("OWNER", "SUPER_ADMIN"), async (_req: Request, res: Response) => {
  try { res.json(await listBillingDashboards()); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
adminRouter.post("/billing-dashboards", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.status(201).json(await createBillingDashboard((req.body ?? {}).name)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
adminRouter.post("/billing-dashboards/reorder", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await reorderBillingDashboards((req.body ?? {}).ids)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
adminRouter.patch("/billing-dashboards/:id", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  const body = req.body ?? {};
  try {
    if ("widgets" in body) { res.json(await updateBillingDashboardWidgets(req.params.id, body.widgets)); return; }
    if ("name" in body) { res.json(await renameBillingDashboard(req.params.id, body.name)); return; }
    res.status(400).json({ error: "nothing to update" });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
adminRouter.delete("/billing-dashboards/:id", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await deleteBillingDashboard(req.params.id)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Billing ledger (OWNER/SUPER_ADMIN): per-portal terms, charges, payments ----

// Per-tenant billing terms (config). Seeded on first read.
const billingActor = (req: Request) => ({ id: req.user?.id ?? null, name: req.user?.name || req.user?.email || "Unknown" });

adminRouter.get("/billing-config/:tenantId", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await getBillingConfig(req.params.tenantId)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
adminRouter.get("/billing-config/:tenantId/audit", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await getTermsAudit(req.params.tenantId)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Link a tenant/portal to a Stripe customer (idempotent). OWNER/SUPER_ADMIN only.
adminRouter.post("/tenants/:tenantId/stripe-customer", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try {
    const result = await ensureStripeCustomer(req.params.tenantId);
    res.json(result);
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) { res.status(400).json({ error: err.message, notConfigured: true }); return; }
    res.status(400).json({ error: (err as Error).message });
  }
});

// Global Stripe connection status (for enabling/disabling invoice UI).
adminRouter.get("/stripe/status", requireRole("OWNER", "SUPER_ADMIN"), (_req: Request, res: Response) => {
  res.json({ configured: isStripeConfigured(), testMode: isStripeTestMode(), mode: stripeMode() });
});

// Mark a charge paid manually (paid outside Stripe). OWNER/SUPER_ADMIN only.
adminRouter.post("/charges/:id/mark-paid", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await markChargePaidManually(req.params.id, billingActor(req))); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// Create/retry the Stripe invoice for an approved charge.
adminRouter.post("/charges/:id/invoice", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await createInvoiceForCharge(req.params.id, billingActor(req))); }
  catch (err) {
    if (err instanceof StripeNotConfiguredError) { res.status(400).json({ error: err.message, notConfigured: true }); return; }
    res.status(400).json({ error: (err as Error).message });
  }
});

// Email the finalized invoice to the customer (explicit action).
adminRouter.post("/charges/:id/invoice/send", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await sendInvoiceForCharge(req.params.id, billingActor(req))); }
  catch (err) {
    if (err instanceof StripeNotConfiguredError) { res.status(400).json({ error: err.message, notConfigured: true }); return; }
    res.status(400).json({ error: (err as Error).message });
  }
});
adminRouter.patch("/billing-config/:tenantId", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await updateBillingConfig(req.params.tenantId, req.body ?? {}, billingActor(req))); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// Suggested charge for a period (Task 3) — powers the "suggest amount" button; editable before save.
adminRouter.post("/charges/suggest/:tenantId", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  const { periodStart, periodEnd } = req.body ?? {};
  if (!periodStart || !periodEnd) { res.status(400).json({ error: "periodStart and periodEnd are required" }); return; }
  try { res.json(await computeSuggestedCharge(req.params.tenantId, new Date(periodStart), new Date(periodEnd))); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// All charges across every portal (master-hub central table). OWNER/SUPER_ADMIN only.
adminRouter.get("/charges/all", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { const limit = req.query.limit ? Number(req.query.limit) : undefined; res.json(await listAllCharges(limit)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// List a tenant's charges (+ payments + ledger totals) / create a charge.
adminRouter.get("/charges/tenant/:tenantId", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await listCharges(req.params.tenantId)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
adminRouter.post("/charges/tenant/:tenantId", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.status(201).json(await createCharge(req.params.tenantId, req.body ?? {}, billingActor(req))); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// Single charge: get / edit / set status / void / record a payment.
adminRouter.get("/charges/:id", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { const c = await getCharge(req.params.id); if (!c) { res.status(404).json({ error: "not found" }); return; } res.json(c); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
adminRouter.get("/charges/:id/audit", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await getChargeAudit(req.params.id)); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
adminRouter.patch("/charges/:id", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await updateCharge(req.params.id, req.body ?? {}, billingActor(req))); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
adminRouter.post("/charges/:id/status", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await setChargeStatus(req.params.id, (req.body ?? {}).status, billingActor(req))); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
adminRouter.post("/charges/:id/void", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await voidCharge(req.params.id, billingActor(req))); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
adminRouter.post("/charges/:id/approve", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try {
    // Password confirmation gate: re-verify the acting user's password before approving.
    const password = (req.body ?? {}).password;
    if (!password || typeof password !== "string") { res.status(400).json({ error: "Password confirmation required" }); return; }
    const me = req.user?.id ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { passwordHash: true } }) : null;
    if (!me || !(await verifyPassword(password, me.passwordHash))) { res.status(401).json({ error: "Password confirmation failed" }); return; }
    res.json(await approveCharge(req.params.id, billingActor(req)));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
adminRouter.post("/charges/:id/payments", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.status(201).json(await recordPayment(req.params.id, req.body ?? {}, billingActor(req))); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// Approval-notification settings (global).
adminRouter.get("/billing-notify-config", requireRole("OWNER", "SUPER_ADMIN"), async (_req: Request, res: Response) => {
  try { res.json(await getBillingNotifyConfig()); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
adminRouter.patch("/billing-notify-config", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  try { res.json(await updateBillingNotifyConfig(req.body ?? {})); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// Manual trigger for the billing automation sweep (auto-draft + reminders) — for testing/ops.
adminRouter.post("/billing/run-sweep", requireRole("OWNER", "SUPER_ADMIN"), async (_req: Request, res: Response) => {
  try { res.json(await runBillingAutomationSweep()); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// LEVEL 1 — cross-tenant Email feed, ONE ROW PER SEND (grouped by communicationSendId;
// one-off sends are groups of one). The whole router is already OWNER/SUPER_ADMIN/AUDITOR;
// this per-route requireRole tightens it to OWNER/SUPER_ADMIN only.
adminRouter.get("/email-logs", requireRole("OWNER", "SUPER_ADMIN"), async (_req: Request, res: Response) => {
  try {
    res.json(await listGroupedEmailSends());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// LEVEL 2 — the per-recipient EmailLog rows for ONE send group. `group` is
// "send:<communicationSendId>" or "single:<emailLogId>" (from the Level-1 rows). Same
// OWNER/SUPER_ADMIN gating as the grouped feed.
adminRouter.get("/email-logs/recipients", requireRole("OWNER", "SUPER_ADMIN"), async (req: Request, res: Response) => {
  const group = typeof req.query.group === "string" ? req.query.group : "";
  if (!group) {
    res.status(400).json({ error: "group is required" });
    return;
  }
  try {
    res.json(await listEmailSendRecipients(group));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
