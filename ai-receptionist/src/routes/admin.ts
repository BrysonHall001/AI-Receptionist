import { Router, Request, Response, NextFunction } from "express";
import { audit } from "../services/auditService";
import { AUDIT_ACTION_VALUES, AUDIT_ACTION_GROUPS, AUDIT_RETENTION } from "../services/auditCatalog";
import { queryAuditEvents } from "../services/auditQueryService";
import { getHealthSnapshot, runHealthChecks, runSingleCheck, getHealthHistory, HEALTH_CHECK_KEYS, HEALTH_HISTORY_LIMIT } from "../services/healthService";
import { env } from "../config/env";
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
import { rateLimit } from "../middleware/rateLimit";
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

// Deleting a template is password-confirmed, so the confirmation is guessable and must be
// throttled - the same shape the account-sensitive routes use.
const templateDeleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  keyFn: (req: any) => `${req.ip}:${(req.user && req.user.id) || "anon"}`,
  message: "Too many attempts. Please wait a few minutes and try again.",
});
const templateDeleteIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 40,
  message: "Too many attempts from this connection. Please wait and try again.",
});
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

// ============================ TEMPLATE BUILDER (part 1) ============================
// Built templates are rows; the four built-ins stay in code. Everything here is gated by the
// router-level requireRole("OWNER","SUPER_ADMIN","AUDITOR") at the top of this file - the
// same gate Developer Tools already sits behind. No second gate is invented.

/**
 * The built templates, for the builder's own list - plus the automation-library flavours the
 * picker may offer. The OPTIONS ARE SERVED, never hardcoded on the screen: a flavour is the
 * one code-bound thing a template carries, so the list has to come from the code that owns it
 * or the two drift.
 */
adminRouter.get("/template-rows", async (_req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { libraryFlavorOptions } = require("../automation/presets");
  const rows = await (prisma as any).tenantTemplateRow.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
  res.json({ rows, flavors: libraryFlavorOptions() });
});

/**
 * Save a built template - create when there is no id, update when there is.
 *
 * THE KEY IS SET ONCE, at creation, and never changes: it is what a created tenant stores in
 * templateKey, so renaming a template must not orphan the tenants made from it. Editing the
 * label afterwards changes the words, not the identity.
 */
adminRouter.post("/template-rows", async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { reservedTemplateKeys, slugTemplateKey } = require("../services/tenantTemplates");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isLibraryFlavor } = require("../automation/presets");
  const { id, label, description, spec } = (req.body ?? {}) as Record<string, any>;
  const clean = String(label || "").trim();
  if (!clean) { res.status(400).json({ error: "Give the template a name." }); return; }
  // REFUSED AT THE DOOR, not silently dropped. An invented flavour would do nothing at all,
  // so the person deserves to be told rather than to wonder why their library looks ordinary.
  const flavor = (spec || {}).libraryFlavor;
  if (flavor != null && flavor !== "" && !isLibraryFlavor(flavor)) {
    res.status(400).json({ error: "That automation library isn't one we offer." });
    return;
  }
  try {
    if (id) {
      const existing = await (prisma as any).tenantTemplateRow.findUnique({ where: { id: String(id) } });
      if (!existing) { res.status(404).json({ error: "That template no longer exists." }); return; }
      const updated = await (prisma as any).tenantTemplateRow.update({
        where: { id: String(id) },
        data: { label: clean, description: String(description || ""), spec: spec || {} },
      });
      res.json({ row: updated });
      return;
    }
    const key = slugTemplateKey(clean);
    if (reservedTemplateKeys().includes(key)) {
      res.status(409).json({ error: `"${clean}" clashes with a built-in template. Pick a different name.` });
      return;
    }
    if (await (prisma as any).tenantTemplateRow.findUnique({ where: { key } })) {
      res.status(409).json({ error: `You already have a template called "${clean}". Pick a different name.` });
      return;
    }
    const created = await (prisma as any).tenantTemplateRow.create({
      data: { key, label: clean, description: String(description || ""), spec: spec || {}, createdById: (req.user as any)?.id ?? null },
    });
    res.json({ row: created });
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});

/**
 * DELETE A BUILT TEMPLATE - soft, password-confirmed, and impossible for a built-in.
 *
 * THE BUILT-IN REFUSAL IS SERVER-SIDE AND UNCONDITIONAL. The screen hides the "x" on the four
 * code templates, but a hidden control is not a rule: this checks the key against
 * reservedTemplateKeys() no matter what arrives, so a hand-made request cannot delete one.
 *
 * The password gate follows the pattern used by /account/mfa/disable rather than the older
 * charge-approval one: password + rate limit + an audit row identical to a failed sign-in.
 * The charge route re-verifies a password but does neither of the other two, and a delete
 * deserves all three.
 */
adminRouter.post("/template-rows/:id/delete", templateDeleteIpLimiter, templateDeleteLimiter, async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { reservedTemplateKeys } = require("../services/tenantTemplates");
  const { password } = (req.body ?? {}) as { password?: string };

  const row = await (prisma as any).tenantTemplateRow.findUnique({ where: { id: String(req.params.id) } });
  if (!row || row.deletedAt) { res.status(404).json({ error: "That template no longer exists." }); return; }
  // Belt and braces: a row can only exist with a non-reserved key, but the check is cheap and
  // this is the endpoint that must never remove a built-in.
  if (reservedTemplateKeys().includes(row.key)) {
    res.status(400).json({ error: "Built-in templates can't be deleted." });
    return;
  }
  if (!password || typeof password !== "string") { res.status(400).json({ error: "Password confirmation required" }); return; }
  const me = req.user?.id ? await prisma.user.findUnique({ where: { id: req.user.id } }) : null;
  if (!me || !(await verifyPassword(password, me.passwordHash))) {
    // The SAME audit action a failed sign-in writes, so a run of these is visible in one place.
    audit({ tenantId: null, actorType: "user", actorId: me?.id ?? null, actorLabel: me?.email ?? "unknown",
      action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED, subjectType: "auth", meta: { ip: req.ip || null, at: "template-delete" } });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  await (prisma as any).tenantTemplateRow.update({
    where: { id: row.id },
    data: { deletedAt: new Date(), deletedById: me.id },
  });
  audit({ tenantId: null, actorType: "user", actorId: me.id, actorLabel: me.name || me.email,
    action: AUDIT_ACTIONS.TEMPLATE_DELETED, subjectType: "template", subjectId: row.id,
    meta: { key: row.key, label: row.label } });
  res.json({ ok: true });
});

// TENANT TEMPLATES: the wizard's template cards (one truth — the constants).
adminRouter.get("/tenant-templates", async (_req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { listAllTemplates } = require("../services/tenantTemplates");
  const TENANT_TEMPLATES = await listAllTemplates();
  // CREATE-UI-2: fieldTweaks (labels per module) + pageLabelOverrides ride the
  // payload so the wizard swaps chips + row titles LIVE on a card click.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { reservedTemplateKeys: reserved } = require("../services/tenantTemplates");
  const builtIns = new Set(reserved());
  res.json({ templates: TENANT_TEMPLATES.map((t: any) => ({
    // The client must never infer "built-in" from position in the list. It is stated.
    builtIn: builtIns.has(t.key),
    // The chosen library icon, when a built template has one. A code template never does, so
    // this is always absent for the five and their bespoke glyphs resolve exactly as before.
    icon: (t as any).icon || null,
    key: t.key, label: t.label, description: t.description,
    pagesOffPrefill: t.pagesOffPrefill, modulesHiddenPrefill: t.modulesHiddenPrefill,
    pageLabelOverrides: t.pageLabelOverrides || {},
    customLcOffer: t.customLcOffer === true,
    fieldTweaks: (t.fieldTweaks || []).reduce((acc: any, tw: any) => { (acc[tw.moduleKey] = acc[tw.moduleKey] || []).push(String(tw.field.label)); return acc; }, {}),
  })) });
});

adminRouter.get("/portals/:id", async (req: Request, res: Response) => {
  const p = await getPortal(req.params.id);
  if (!p) {
    res.status(404).json({ error: "Portal not found" });
    return;
  }
  res.json(p);
});

// HUB-UI Part C4: the tenant's LIVE module picture for the detail page —
// READ ONLY. Rides the SAME serializers the portal's Modules & Fields uses
// (listRecordTypes + listFields), so custom modules, custom fields, renamed
// labels, and deletions all appear by construction. Tenant-scoped by the :id
// param and gated by the router's existing OWNER/SUPER_ADMIN/AUDITOR guard.
// There is NO companion writer: module visibility is a portal-side decision.
adminRouter.get("/portals/:id/modules", async (req: Request, res: Response) => {
  const tenantId = String(req.params.id || "");
  const p = await getPortal(tenantId);
  if (!p) { res.status(404).json({ error: "Portal not found" }); return; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listRecordTypes, recordTypeHref } = require("../services/recordTypeService");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listFields } = require("../services/fieldService");
    const types = await listRecordTypes(tenantId);
    const navHidden: string[] = Array.isArray((((p as any).labels || {}).nav || {}).hidden) ? ((p as any).labels.nav.hidden as string[]) : [];
    const locked: string[] = Array.isArray((p as any).lockedPages) ? ((p as any).lockedPages as string[]) : [];
    const modules = [];
    for (const t of types as any[]) {
      const fields = await listFields(tenantId, t.key);
      const href = recordTypeHref(t.key); // the SAME nav-href convention the portal uses
      const recordCount = await (prisma as any).record.count({ where: { tenantId, recordTypeId: t.id, deletedAt: null } }).catch(() => 0);
      modules.push({
        key: t.key,
        label: t.label,
        labelPlural: t.labelPlural,
        href,
        system: t.system === true,
        visible: !navHidden.includes(href) && !locked.includes(href),
        navHidden: navHidden.includes(href),   // switched off here (reversible from this panel)
        pageLocked: locked.includes(href),     // locked under Pages — a different control
        recordCount,                           // what the hide confirmation quotes
        fields: (fields as any[]).map((f: any) => String(f.label)),
      });
    }
    res.json({ modules });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

adminRouter.post("/portals", async (req: Request, res: Response) => {
  const { name, notifyEmail, lockedPages, billingStatus, hiddenRecordTypes, template, isDemo } = (req.body ?? {}) as Record<string, any>;
  // TENANT TEMPLATES: an unknown key is a client bug — reject loudly.
  if (template != null) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveTemplate } = require("../services/tenantTemplates");
    if (!(await resolveTemplate(String(template)))) { res.status(400).json({ error: "Unknown template." }); return; }
  }
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
    const portal = await createPortal({ name, notifyEmail: notifyEmail || "", lockedPages, billingStatus, hiddenRecordTypes, template: template != null ? String(template) : null, customLearningCenter: (req.body || {}).customLearningCenter === true, isDemo: isDemo === true });
    { const u: any = (req as any).realUser || (req as any).user; audit({ tenantId: portal.id, actorType: "user", actorId: u?.id ?? null, actorLabel: (u && (u.name || u.email)) || "Hub user", actorRole: u?.role ?? null, action: AUDIT_ACTIONS.HUB_TENANT_CREATE, subjectType: "tenant", subjectId: portal.id, subjectLabel: portal.name }); }
    logger.info(`Portal created: ${portal.name} (${portal.id})`);
    res.json(portal);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// The DEMO FLAG toggle, deliberately its own endpoint with its own typed
// confirmation rather than a field on the general PATCH: switching it OFF while
// seeded rows exist changes what the operator can still clean up.
adminRouter.post("/portals/:id/demo-flag", async (req: Request, res: Response) => {
  const tenantId = String(req.params.id || "");
  const p: any = await getPortal(tenantId);
  if (!p) { res.status(404).json({ error: "Tenant not found" }); return; }
  const b2 = (req.body ?? {}) as any;
  if (String(b2.confirm || "").trim() !== String(p.name || "").trim()) { res.status(400).json({ error: "Type the tenant's name exactly to confirm." }); return; }
  const next = b2.isDemo === true;
  const db2 = prisma as any;
  // How many rows a seed run still owns here — the number the warning quotes.
  const runs = await db2.demoSeedRun.findMany({ where: { tenantId, wipedAt: null }, select: { ids: true } });
  const seededRows = runs.reduce((n: number, r: any) => n + (Array.isArray(r.ids) ? r.ids.length : 0), 0);
  await db2.tenant.update({ where: { id: tenantId }, data: { isDemo: next } });
  {
    const u: any = (req as any).realUser || (req as any).user;
    audit({ tenantId, actorType: "user", actorId: u?.id ?? null, actorLabel: (u && (u.name || u.email)) || "Hub user", actorRole: u?.role ?? null,
      action: AUDIT_ACTIONS.HUB_SETTINGS_UPDATE, subjectType: "tenant", subjectId: tenantId, subjectLabel: p.name, meta: { isDemo: next, seededRows } });
  }
  res.json({ ok: true, isDemo: next, seededRows });
});

adminRouter.get("/portals/:id/demo-flag", async (req: Request, res: Response) => {
  const tenantId = String(req.params.id || "");
  const p: any = await getPortal(tenantId);
  if (!p) { res.status(404).json({ error: "Tenant not found" }); return; }
  const db2 = prisma as any;
  const runs = await db2.demoSeedRun.findMany({ where: { tenantId, wipedAt: null }, select: { ids: true } });
  const seededRows = runs.reduce((n: number, r: any) => n + (Array.isArray(r.ids) ? r.ids.length : 0), 0);
  res.json({ isDemo: p.isDemo === true, seededRows });
});

adminRouter.patch("/portals/:id", async (req: Request, res: Response) => {
  // Any status change takes effect at once (the suspension gate caches for a
  // few seconds; a resumed tenant should not wait for it to expire).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  try { require("../services/tenantSuspensionService").forgetTenantStatus(String(req.params.id || "")); } catch { /* */ }
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
      audit({ tenantId: req.params.id, actorType: "user", actorId: u?.id ?? null, actorLabel: (u && (u.name || u.email)) || "Hub user", actorRole: u?.role ?? null, action: suspended ? AUDIT_ACTIONS.HUB_TENANT_SUSPEND : AUDIT_ACTIONS.HUB_SETTINGS_UPDATE, subjectType: "tenant", subjectId: req.params.id, subjectLabel: (portal as any)?.name || null, meta: data.billingStatus !== undefined ? { billingStatus: data.billingStatus } : null }); }
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

// ---- Developer Tools batch 3: the Audit Log query API (READ-ONLY by design —
// retention alone removes rows; no mutation endpoints exist). Gated by the same
// router-level requireRole(OWNER, SUPER_ADMIN, AUDITOR) + impersonation lockout as
// every sibling admin endpoint. Cursor pagination (createdAt desc, id desc — stable
// under insertion); filters ride the DT-2 indexes ([status, createdAt] for the
// default view, [tenantId, createdAt], [action]).
// System Health (audit-fixes-health batch): serve the CACHED snapshot (running one
// if the cache is cold), and a recheck trigger that returns fresh results. Same
// router-level hub gate as every sibling. Read-only + side-effect-free beyond pings.
adminRouter.get("/health", async (_req: Request, res: Response) => {
  try {
    res.json(getHealthSnapshot() || await runHealthChecks());
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
adminRouter.post("/health/recheck", async (_req: Request, res: Response) => {
  try {
    res.json(await runHealthChecks());
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Health v2: expanded-panel data for ONE check — current cache entry, the in-memory
// recent-checks buffer (newest first, bounded), and cheap per-tile extras (reads
// only; no provider pings beyond what the check itself makes on recheck).
adminRouter.get("/health/detail/:check", async (req: Request, res: Response) => {
  try {
    const key = String(req.params.check);
    if (!HEALTH_CHECK_KEYS.includes(key)) { res.status(404).json({ error: "unknown check" }); return; }
    const snap = getHealthSnapshot();
    let current: any = null;
    if (snap) for (const g of Object.values(snap.groups)) if ((g as any)[key]) current = (g as any)[key];
    const extras: Record<string, unknown> = {};
    if (key === "twilio") {
      extras.phoneNumber = env.TWILIO_PHONE_NUMBER || null;
      extras.webhookNote = "Inbound call + SMS webhooks are configured on this number in the Twilio console.";
    }
    if (key === "automations") {
      try { extras.recentFailures = await (prisma as any).automationRun.findMany({ where: { status: "failed", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, automationName: true, contactName: true, createdAt: true } }); } catch { extras.recentFailures = []; }
    }
    if (key === "dripQueue") {
      try { extras.recentFailures = await (prisma as any).scheduledJob.findMany({ where: { status: "failed", updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, automationName: true, contactName: true, dueAt: true, error: true } }); } catch { extras.recentFailures = []; }
    }
    res.json({ key, current, history: getHealthHistory(key), historyLimit: HEALTH_HISTORY_LIMIT, extras });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// panels-v3 Tier-B: per-tenant CONFIGURATION for infra tiles with a real tenant
// dimension. All grounded reads: Tenant.phoneNumber/voiceMode/billingStatus/
// stripeCustomerId, GoogleConnection.status/lastSyncedAt/lastSyncError,
// ResourceCalendarMap counts, latest Charge per tenant. Read-only; fixed query
// count (never per-tenant loops).
adminRouter.get("/health/tenant-config/:check", async (req: Request, res: Response) => {
  try {
    const key = String(req.params.check);
    const tenants = await (prisma as any).tenant.findMany({ select: { id: true, name: true, phoneNumber: true, voiceMode: true, billingStatus: true, stripeCustomerId: true }, orderBy: { name: "asc" } });
    if (key === "twilio") {
      // Webhook OK?: the latest inbound twilio delivery outcome PER TENANT where the
      // capture resolved one; platform-level deliveries (null tenantId) can't be
      // attributed, so unattributed tenants honestly show "—".
      const latest: any[] = await (prisma as any).$queryRawUnsafe(`
        SELECT DISTINCT ON ("tenantId") "tenantId", outcome, "createdAt"
        FROM "WebhookEvent" WHERE provider = 'twilio' AND "tenantId" IS NOT NULL
        ORDER BY "tenantId", "createdAt" DESC`);
      const byTenant: Record<string, any> = {};
      latest.forEach((l: any) => { byTenant[l.tenantId] = l; });
      res.json({ rows: tenants.map((t: any) => ({ tenantId: t.id, tenant: t.name, phoneNumber: t.phoneNumber || null, voiceMode: t.voiceMode || "OFF", webhookOutcome: byTenant[t.id] ? byTenant[t.id].outcome : null, webhookAt: byTenant[t.id] ? byTenant[t.id].createdAt : null })) });
      return;
    }
    if (key === "google") {
      const [conns, maps] = await Promise.all([
        (prisma as any).googleConnection.findMany({ select: { tenantId: true, status: true, lastSyncedAt: true, lastSyncError: true } }),
        (prisma as any).resourceCalendarMap.groupBy({ by: ["tenantId"], _count: { _all: true } }),
      ]);
      const cByT: Record<string, any> = {}; conns.forEach((c: any) => { cByT[c.tenantId] = c; });
      const mByT: Record<string, number> = {}; maps.forEach((m: any) => { mByT[m.tenantId] = m._count._all; });
      res.json({ rows: tenants.map((t: any) => ({ tenantId: t.id, tenant: t.name, connected: !!cByT[t.id], status: cByT[t.id] ? cByT[t.id].status : null, calendars: mByT[t.id] || 0, lastSyncedAt: cByT[t.id] ? cByT[t.id].lastSyncedAt : null, lastSyncError: cByT[t.id] ? cByT[t.id].lastSyncError : null })) });
      return;
    }
    if (key === "stripe") {
      const latest: any[] = await (prisma as any).$queryRawUnsafe(`
        SELECT DISTINCT ON ("tenantId") "tenantId", status, amount, "createdAt"
        FROM "Charge" ORDER BY "tenantId", "createdAt" DESC`);
      const byTenant: Record<string, any> = {};
      latest.forEach((l: any) => { byTenant[l.tenantId] = l; });
      res.json({ rows: tenants.map((t: any) => ({ tenantId: t.id, tenant: t.name, billingStatus: t.billingStatus || null, hasStripeCustomer: !!t.stripeCustomerId, lastChargeStatus: byTenant[t.id] ? byTenant[t.id].status : null, lastChargeAt: byTenant[t.id] ? byTenant[t.id].createdAt : null })) });
      return;
    }
    res.status(404).json({ error: "no tenant config for this check" });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// panels-v3: per-tenant rollups. Each check maps to ONE raw grouped-aggregate
// (GROUPING SETS ((tenantId), ()) => tenant rows + the grand-total row together).
// Read-only; window = 24h | 7d where the tile is windowed; names joined after.
const ROLLUP_WINDOW_MS: Record<string, number> = { "24h": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000 };
export const ROLLUP_SQL: Record<string, { windowed: boolean; sql: (since: Date) => { text: string; params: any[] } }> = { // exported for the panels-v3 self-test (DB-driven rollup correctness)
  failedLogins: { windowed: true, sql: (since) => ({ text: `
    SELECT "tenantId", COUNT(*)::int AS failed, COUNT(DISTINCT "actorId")::int AS users,
           COUNT(DISTINCT (meta->>'ip'))::int AS ips, MAX("createdAt") AS latest, GROUPING("tenantId")::int AS istotal
    FROM "AuditEvent" WHERE action = 'auth.login_failed' AND "createdAt" >= $1
    GROUP BY GROUPING SETS (("tenantId"), ())`, params: [since] }) },
  automations: { windowed: true, sql: (since) => ({ text: `
    SELECT "tenantId", COUNT(*) FILTER (WHERE status = 'failed')::int AS failed, COUNT(*)::int AS total,
           MAX("createdAt") FILTER (WHERE status = 'failed') AS latest, GROUPING("tenantId")::int AS istotal
    FROM "AutomationRun" WHERE "createdAt" >= $1
    GROUP BY GROUPING SETS (("tenantId"), ())`, params: [since] }) },
  dripQueue: { windowed: true, sql: (since) => ({ text: `
    SELECT "tenantId", COUNT(*) FILTER (WHERE status = 'pending' AND "dueAt" < NOW() - INTERVAL '10 minutes')::int AS overdue,
           COUNT(*) FILTER (WHERE status = 'failed' AND "updatedAt" >= $1)::int AS failed,
           MAX("updatedAt") AS latest, GROUPING("tenantId")::int AS istotal
    FROM "ScheduledJob" WHERE (status = 'pending' AND "dueAt" < NOW() - INTERVAL '10 minutes') OR (status = 'failed' AND "updatedAt" >= $1)
    GROUP BY GROUPING SETS (("tenantId"), ())`, params: [since] }) },
  geoQueue: { windowed: false, sql: () => ({ text: `
    SELECT "tenantId", COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           MIN("createdAt") FILTER (WHERE status = 'pending') AS oldest, GROUPING("tenantId")::int AS istotal
    FROM (SELECT "tenantId", status, "createdAt" FROM "ContactGeo" WHERE status IN ('pending','failed')
          UNION ALL SELECT "tenantId", status, "createdAt" FROM "RecordGeo" WHERE status IN ('pending','failed')) g
    GROUP BY GROUPING SETS (("tenantId"), ())`, params: [] }) },
  webhooks: { windowed: true, sql: (since) => ({ text: `
    SELECT "tenantId", COUNT(*)::int AS deliveries, COUNT(*) FILTER (WHERE outcome = 'fail')::int AS failures,
           MAX("createdAt") FILTER (WHERE outcome = 'fail') AS latest, GROUPING("tenantId")::int AS istotal
    FROM "WebhookEvent" WHERE "createdAt" >= $1
    GROUP BY GROUPING SETS (("tenantId"), ())`, params: [since] }) },
  errors: { windowed: true, sql: (since) => ({ text: `
    SELECT "tenantId", COUNT(*) FILTER (WHERE source = 'client')::int AS client, COUNT(*) FILTER (WHERE source = 'server')::int AS server,
           MAX("createdAt") AS latest, GROUPING("tenantId")::int AS istotal
    FROM "ErrorEvent" WHERE "createdAt" >= $1
    GROUP BY GROUPING SETS (("tenantId"), ())`, params: [since] }) },
  auditSweep: { windowed: false, sql: () => ({ text: `
    SELECT "tenantId", COUNT(*) FILTER (WHERE status = 'active')::int AS active,
           COUNT(*) FILTER (WHERE status = 'pending_deletion')::int AS pending,
           MIN("createdAt") FILTER (WHERE status = 'pending_deletion') AS oldest, GROUPING("tenantId")::int AS istotal
    FROM "AuditEvent" GROUP BY GROUPING SETS (("tenantId"), ())`, params: [] }) },
};
adminRouter.get("/health/rollup/:check", async (req: Request, res: Response) => {
  try {
    const key = String(req.params.check);
    const def = ROLLUP_SQL[key];
    if (!def) { res.status(404).json({ error: "no rollup for this check" }); return; }
    const win = def.windowed ? (String(req.query.window || "24h") === "7d" ? "7d" : "24h") : null;
    const since = new Date(Date.now() - (win ? ROLLUP_WINDOW_MS[win] : 0));
    const { text, params } = def.sql(since);
    const raw: any[] = await (prisma as any).$queryRawUnsafe(text, ...params);
    const tn: Record<string, string> = {};
    (await (prisma as any).tenant.findMany({ select: { id: true, name: true } })).forEach((t: any) => { tn[t.id] = t.name; });
    const num = (v: any) => (typeof v === "bigint" ? Number(v) : v);
    const rows: any[] = [];
    let total: any = null;
    for (const r of raw) {
      const o: any = {};
      for (const k of Object.keys(r)) o[k] = num(r[k]);
      if (o.istotal === 1) { delete o.istotal; delete o.tenantId; total = o; continue; }
      delete o.istotal;
      o.tenant = o.tenantId ? tn[o.tenantId] || "(deleted tenant)" : null; // null tenantId => platform-level
      rows.push(o);
    }
    rows.sort((a, b) => String(a.tenant || "\uffff").localeCompare(String(b.tenant || "\uffff")));
    res.json({ rows, total: total || {}, window: win });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// DEMO TENANTS — the demo-data table's single source. One query per model,
// never N+1 from the client.
adminRouter.get("/demo-tenants", async (_req: Request, res: Response) => {
  try {
    const tenants = await (prisma as any).tenant.findMany({
      where: { isDemo: true },
      select: { id: true, name: true, templateKey: true, status: true },
      orderBy: { name: "asc" },
    });
    const ids = tenants.map((t: any) => t.id);
    const runs = ids.length
      ? await (prisma as any).demoSeedRun.findMany({ where: { tenantId: { in: ids } }, orderBy: { createdAt: "desc" } })
      : [];
    const byTenant = new Map<string, any[]>();
    for (const r of runs) {
      if (!byTenant.has(r.tenantId)) byTenant.set(r.tenantId, []);
      byTenant.get(r.tenantId)!.push(r);
    }
    const out = tenants.map((t: any) => {
      const mine = byTenant.get(t.id) || [];
      // The SAME rule the wipe path uses: un-wiped runs with ledgered ids.
      const live = mine.filter((r: any) => !r.wipedAt && Array.isArray(r.ids) && r.ids.length > 0);
      const last = mine[0] || null;
      const lastDone = mine.find((r: any) => !r.wipedAt && Array.isArray(r.ids) && r.ids.length > 0) || null;
      const rowsSeeded = live.reduce((n: number, r: any) => n + (Array.isArray(r.ids) ? r.ids.length : 0), 0);
      return {
        id: t.id, name: t.name, template: t.templateKey || null, status: t.status || null,
        seeded: live.length > 0,
        rowsSeeded,
        lastSeededAt: lastDone ? lastDone.createdAt : null,
        activeRun: mine.find((r: any) => r.status === "running") || null,
        lastRun: last ? { id: last.id, profile: last.profile, counts: last.counts, createdAt: last.createdAt, status: last.status || null, error: last.error || null, wipedAt: last.wipedAt } : null,
      };
    });
    res.json({ tenants: out });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// MODULE VISIBILITY from the hub. Hiding a module is now only possible here
// (the portal has no such control, and hidden modules are absent from its
// Modules & Fields entirely), so this endpoint owns BOTH directions. It writes
// through setTenantNav — the same service the create wizard and the portal's
// own nav editor use — and audits either way.
adminRouter.post("/portals/:id/modules/:key/visibility", async (req: Request, res: Response) => {
  const tenantId = String(req.params.id || "");
  const key = String(req.params.key || "");
  const visible = (req.body ?? {}).visible === true;
  const p: any = await getPortal(tenantId);
  if (!p) { res.status(404).json({ error: "Tenant not found" }); return; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listRecordTypes, recordTypeHref } = require("../services/recordTypeService");
    const types = await listRecordTypes(tenantId);
    const type = (types as any[]).find((t: any) => t.key === key);
    if (!type) { res.status(404).json({ error: "That module doesn't exist in this tenant." }); return; }
    const href = recordTypeHref(key);
    const nav = ((p.labels || {}).nav || {}) as any;
    const hidden: string[] = Array.isArray(nav.hidden) ? nav.hidden.slice() : [];
    const at = hidden.indexOf(href);
    if (visible && at !== -1) hidden.splice(at, 1);
    if (!visible && at === -1) hidden.push(href);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setTenantNav } = require("../services/portalService");
    await setTenantNav(tenantId, { order: Array.isArray(nav.order) ? nav.order : [], hidden, labels: nav.labels || {} });
    {
      const u: any = (req as any).realUser || (req as any).user;
      audit({
        tenantId, actorType: "user", actorId: u?.id ?? null, actorLabel: (u && (u.name || u.email)) || "Hub user", actorRole: u?.role ?? null,
        action: AUDIT_ACTIONS.HUB_SETTINGS_UPDATE, subjectType: "module", subjectId: key, subjectLabel: type.labelPlural || type.label,
        meta: { visible, href, via: "hub-modules-panel" },
      });
    }
    res.json({ ok: true, key, visible });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// TENANT DELETION. Typed name confirmation is enforced HERE (the service is
// also callable by tooling); the demo/suspended guard lives in the service so
// it cannot be bypassed by a different caller.
adminRouter.delete("/portals/:id", async (req: Request, res: Response) => {
  const tenantId = String(req.params.id || "");
  const p: any = await getPortal(tenantId);
  if (!p) { res.status(404).json({ error: "Tenant not found" }); return; }
  const confirm = String(((req.body ?? {}) as any).confirm || (req.query as any).confirm || "").trim();
  if (confirm !== String(p.name || "").trim()) { res.status(400).json({ error: "Type the tenant's name exactly to confirm." }); return; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { deleteTenantCompletely } = require("../services/tenantDeletionService");
    const u: any = (req as any).realUser || (req as any).user;
    res.json(await deleteTenantCompletely(tenantId, { id: u?.id ?? null, name: u?.name ?? null, email: u?.email ?? null, role: u?.role ?? null }));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// DEMO DATA SEEDER (dev tool) — same placement and gating as the suggestions
// controls below: hub router = requireRole(OWNER/SUPER_ADMIN/AUDITOR) +
// impersonation lockout. Both mutating calls demand the tenant's NAME typed
// back, so a mis-click can't fill (or empty) the wrong tenant.
adminRouter.get("/portals/:id/demo-data", async (req: Request, res: Response) => {
  const tenantId = String(req.params.id || "");
  const p = await getPortal(tenantId);
  if (!p) { res.status(404).json({ error: "Portal not found" }); return; }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { listDemoRuns, DEMO_PROFILE_CAPS } = require("../services/demoSeeder");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { RM_PROFILE_CAPS } = require("../services/demoSeederRm");
  res.json({ tenantName: (p as any).name, runs: await listDemoRuns(tenantId), caps: { field_services: DEMO_PROFILE_CAPS.field_services, recruitment_marketing: RM_PROFILE_CAPS } });
});
adminRouter.post("/portals/:id/demo-data/seed", async (req: Request, res: Response) => {
  const tenantId = String(req.params.id || "");
  const p: any = await getPortal(tenantId);
  if (!p) { res.status(404).json({ error: "Portal not found" }); return; }
  const b2 = (req.body ?? {}) as any;
  if (String(b2.confirm || "").trim() !== String(p.name || "").trim()) { res.status(400).json({ error: "Type the tenant's name exactly to confirm." }); return; }
  if (p.isDemo !== true) { res.status(400).json({ error: "That tenant is not marked as a demo tenant. Demo data can only be seeded into a demo tenant." }); return; }
  const profile = b2.profile === "recruitment_marketing" ? "recruitment_marketing" : "field_services";
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { seedDemoData, VOLUMES } = require("../services/demoSeeder");
  const seedOpts = {
    profile,
    seed: typeof b2.seed === "string" && b2.seed.trim() ? b2.seed.trim() : undefined,
    runSweep: b2.runSweep !== false,
    // The acting hub admin answers the demo feedback ticket (the app's own
    // canReply rule), so the reply producer runs without hunting the database.
    actingUserId: req.user?.id ?? null,
    // Continuous now: a number is a multiplier, a legacy name still works.
    volume: (b2.volume === undefined || b2.volume === null) ? "small" : (isFinite(Number(b2.volume)) ? Number(b2.volume) : String(b2.volume)),
    windowDays: Number(b2.windowDays || 90),
    allowTemplateMismatch: b2.allowTemplateMismatch === true,
  };
  // EVERY volume runs in the background now. The ledger row is written before
  // any data, so the caller can watch a real run rather than an optimistic
  // guess, and a failure marks the row (keeping its ids, so it stays wipeable).
  try {
    void seedDemoData(tenantId, seedOpts).catch(async (err: Error) => {
      logger.error(`[seeder] background run failed: ${err.message}`);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { failDemoRun } = require("../services/demoSeeder");
      const last = await (prisma as any).demoSeedRun.findFirst({ where: { tenantId, status: "running" }, orderBy: { createdAt: "desc" }, select: { id: true } });
      if (last) await failDemoRun(last.id, err.message);
    });
    res.json({ started: true, async: true, message: "Seeding started." });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
adminRouter.post("/portals/:id/demo-data/wipe", async (req: Request, res: Response) => {
  const tenantId = String(req.params.id || "");
  const p: any = await getPortal(tenantId);
  if (!p) { res.status(404).json({ error: "Portal not found" }); return; }
  const b2 = (req.body ?? {}) as any;
  if (String(b2.confirm || "").trim() !== String(p.name || "").trim()) { res.status(400).json({ error: "Type the tenant's name exactly to confirm." }); return; }
  if (p.isDemo !== true) { res.status(400).json({ error: "That tenant is not marked as a demo tenant. Mark it as demo to manage its demo data." }); return; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { wipeDemoData } = require("../services/demoSeeder");
    res.json(await wipeDemoData(tenantId, b2.runId || null));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// EMERGENT LAYER 2 — devtools control for suggestions. Matches the sibling
// dummy-data pattern (api.ts POST /records/dummy): a dev-only seeder plus, here,
// an on-demand sweep so the detectors can be exercised without waiting 24h.
// Hub-admin gated by this router's requireRole + impersonation lockout.
adminRouter.post("/portals/:id/suggestions/seed", async (req: Request, res: Response) => {
  const tenantId = String(req.params.id || "");
  const p = await getPortal(tenantId);
  if (!p) { res.status(404).json({ error: "Portal not found" }); return; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listRecordTypes } = require("../services/recordTypeService");
    const types = await listRecordTypes(tenantId);
    const wo = (types as any[]).find((t: any) => t.key === "work_order") || (types as any[])[0];
    const db2 = prisma as any;
    const made: string[] = [];
    // (1) repeated phrase: six records over six days carrying the same wording
    for (let i = 0; i < 6; i++) {
      await db2.record.create({ data: { tenantId, recordTypeId: wo.id, title: `Sample job ${i + 1}`, customFields: { detail: `gate code needed on arrival ${i + 1}` }, createdAt: new Date(Date.now() - i * 86400000) } });
    }
    made.push("repeated wording (6 records)");
    // (2) stage stall: a clutch of records parked in one status
    const stages: any[] = Array.isArray(wo.recordStages) ? wo.recordStages : [];
    if (stages.length > 1) {
      // The stalled batch must be OLD *relative to* a moving batch — otherwise
      // nothing is slower than anything else and the detector rightly stays quiet.
      for (let i = 0; i < 8; i++) {
        await db2.record.create({ data: { tenantId, recordTypeId: wo.id, title: `Parked ${i + 1}`, stageKey: stages[1].key, createdAt: new Date(Date.now() - 50 * 86400000), updatedAt: new Date(Date.now() - 50 * 86400000) } });
      }
      for (let i = 0; i < 14; i++) {
        await db2.record.create({ data: { tenantId, recordTypeId: wo.id, title: `Moving ${i + 1}`, stageKey: stages[0].key, createdAt: new Date(Date.now() - 5 * 86400000), updatedAt: new Date(Date.now() - 2 * 86400000) } });
      }
      made.push(`stalled status “${stages[1].label}” (8 parked vs 14 moving)`);
    }
    // (3) unused module: nothing to seed — an untouched module IS the finding.
    made.push("unused modules (whatever this tenant already has)");
    res.json({ ok: true, seeded: made });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
adminRouter.post("/portals/:id/suggestions/run", async (req: Request, res: Response) => {
  const tenantId = String(req.params.id || "");
  const p = await getPortal(tenantId);
  if (!p) { res.status(404).json({ error: "Portal not found" }); return; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runDetectorSweep } = require("../detectors");
    res.json({ ok: true, counters: await runDetectorSweep(new Date(), tenantId) });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// devtools-data: the ErrorEvent surface — read-only, capped, filtered like its audit
// sibling (source, tenant, day-inclusive dates, q over message/route). Newest first.
adminRouter.get("/errors", async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(parseInt(q.limit || "300", 10) || 300, 1), 500);
    const where: any = {};
    if (q.source === "client" || q.source === "server") where.source = q.source;
    if (q.tenantId) where.tenantId = q.tenantId;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) { const t = new Date(q.to); t.setHours(23, 59, 59, 999); where.createdAt.lte = t; }
    }
    if (q.q && q.q.trim()) {
      const needle = q.q.trim();
      where.OR = [
        { message: { contains: needle, mode: "insensitive" } },
        { route: { contains: needle, mode: "insensitive" } },
      ];
    }
    const rows = await (prisma as any).errorEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
    const tn: Record<string, string> = {};
    (await (prisma as any).tenant.findMany({ select: { id: true, name: true } })).forEach((t: any) => { tn[t.id] = t.name; });
    res.json({ rows: rows.map((r: any) => ({ ...r, tenant: r.tenantId ? tn[r.tenantId] || "" : "" })) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// devtools-data: the WebhookEvent surface — read-only, capped, filtered like Errors
// (provider, outcome, tenant, day-inclusive dates, q over summary/endpoint).
adminRouter.get("/webhook-events", async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(parseInt(q.limit || "300", 10) || 300, 1), 500);
    const where: any = {};
    if (q.provider && ["twilio", "google", "stripe", "other"].includes(q.provider)) where.provider = q.provider;
    if (q.outcome === "ok" || q.outcome === "fail") where.outcome = q.outcome;
    if (q.tenantId) where.tenantId = q.tenantId;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) { const t = new Date(q.to); t.setHours(23, 59, 59, 999); where.createdAt.lte = t; }
    }
    if (q.q && q.q.trim()) {
      const needle = q.q.trim();
      where.OR = [
        { summary: { contains: needle, mode: "insensitive" } },
        { endpoint: { contains: needle, mode: "insensitive" } },
      ];
    }
    const rows = await (prisma as any).webhookEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
    const tn: Record<string, string> = {};
    (await (prisma as any).tenant.findMany({ select: { id: true, name: true } })).forEach((t: any) => { tn[t.id] = t.name; });
    res.json({ rows: rows.map((r: any) => ({ ...r, tenant: r.tenantId ? tn[r.tenantId] || "" : "" })) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// devtools-data: underlying ROWS for the data-backed panels (geocode + drip queues).
// Cheap reads with tenant names joined in; no mutation surface.
adminRouter.get("/health/rows/geoQueue", async (_req: Request, res: Response) => {
  try {
    const tn: Record<string, string> = {};
    (await (prisma as any).tenant.findMany({ select: { id: true, name: true } })).forEach((t: any) => { tn[t.id] = t.name; });
    const pick = { id: true, tenantId: true, status: true, lastError: true, fieldKey: true, updatedAt: true } as any;
    const [cg, rg] = await Promise.all([
      (prisma as any).contactGeo.findMany({ where: { status: { in: ["pending", "failed"] } }, select: { ...pick, contact: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 300 }),
      (prisma as any).recordGeo.findMany({ where: { status: { in: ["pending", "failed"] } }, select: { ...pick, record: { select: { title: true } } }, orderBy: { updatedAt: "desc" }, take: 300 }),
    ]);
    const rows = cg.map((r: any) => ({ id: r.id, kind: "contact", tenantId: r.tenantId, tenant: tn[r.tenantId] || "", label: (r.contact && r.contact.name) || "", fieldKey: r.fieldKey || "", status: r.status, error: r.lastError || "", updatedAt: r.updatedAt }))
      .concat(rg.map((r: any) => ({ id: r.id, kind: "record", tenantId: r.tenantId, tenant: tn[r.tenantId] || "", label: (r.record && r.record.title) || "", fieldKey: r.fieldKey || "", status: r.status, error: r.lastError || "", updatedAt: r.updatedAt })));
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
adminRouter.get("/health/rows/dripQueue", async (_req: Request, res: Response) => {
  try {
    const tn: Record<string, string> = {};
    (await (prisma as any).tenant.findMany({ select: { id: true, name: true } })).forEach((t: any) => { tn[t.id] = t.name; });
    const now = Date.now();
    const rows = (await (prisma as any).scheduledJob.findMany({
      where: { OR: [{ status: "failed", updatedAt: { gte: new Date(now - 24 * 60 * 60_000) } }, { status: "pending", dueAt: { lt: new Date(now - 10 * 60_000) } }] },
      select: { id: true, tenantId: true, automationName: true, contactName: true, dueAt: true, status: true, error: true },
      orderBy: { dueAt: "desc" }, take: 300,
    })).map((r: any) => ({ ...r, tenant: tn[r.tenantId] || "" }));
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Health v2: re-run ONE check (user-initiated; the sweep cadence is untouched).
adminRouter.post("/health/recheck/:check", async (req: Request, res: Response) => {
  try {
    const c = await runSingleCheck(String(req.params.check));
    if (!c) { res.status(404).json({ error: "unknown check" }); return; }
    res.json({ check: c, history: getHealthHistory(String(req.params.check)) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

adminRouter.get("/audit-events/meta", async (_req: Request, res: Response) => {
  // customRoles: id -> name roster so the viewer can render CUSTOM:<id> actorRoles.
  let customRoles: Record<string, string> = {};
  try {
    const roles = await (prisma as any).portalRole.findMany({ select: { id: true, name: true } });
    roles.forEach((r: any) => { customRoles[r.id] = r.name; });
  } catch { /* the roster is a nicety; the viewer falls back to "Custom role" */ }
  res.json({ actions: AUDIT_ACTION_VALUES, groups: AUDIT_ACTION_GROUPS, retention: AUDIT_RETENTION, customRoles });
});

adminRouter.get("/audit-events", async (req: Request, res: Response) => {
  try {
    res.json(await queryAuditEvents(req.query as Record<string, string | undefined>));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
