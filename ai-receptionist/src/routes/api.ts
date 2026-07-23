import { Router, Request, Response, NextFunction } from "express";
import { audit } from "../services/auditService";
import { AUDIT_ACTIONS } from "../services/auditCatalog";
import multer from "multer";
import { extractDocuments, combineBlocks, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "../services/docExtractService";
import { organizeIntoSections, InstructionsParseError } from "../services/instructionsDocParseService";
import { requireAuth, resolveTenantScope, isAdminTier, requireRole } from "../middleware/auth";
import { setImpersonation, clearImpersonation, SESSION_COOKIE } from "../auth/session";
import { getStats, listCalls, getCall, listContacts, getContact, listDeletedContacts } from "../services/readModels";
import { runSimulatedCall } from "../services/simulationService";
import { findOpenSlots, getCalendarData } from "../services/availabilityService";
import { loadBookingConfig, saveBookingConfig } from "../services/bookingConfig";
import { listResources, createResource, updateResource, deleteResource, setResourceUser } from "../services/resourceService";
import { importContacts, updateContact, softDeleteContacts, restoreContacts, purgeExpiredContacts, createContact, bulkUpdateField, mergeContacts, generateDummyContact, getContactsMapData, getContactsCalendarData } from "../services/contactService";
import { listFields, createField, updateField, deleteField, reorderFields, setFieldSection } from "../services/fieldService";
import { listSections, createSection, renameSection, reorderSections, deleteSection } from "../services/fieldSectionService";
import { listRecordTypes, addStage, renameStage, reorderStages, deleteStage, addSubtype, renameSubtype, reorderSubtypes, deleteSubtype, setRecordTypeLabels, createRecordType, setPipelineEnabled, setModuleViews } from "../services/recordTypeService";
import { addRecordStatus, renameRecordStatus, reorderRecordStatuses, deleteRecordStatus } from "../services/recordTypeService";
import { listRecords, getRecord, createRecord, updateRecord, softDeleteRecords, bulkUpdateRecordField, generateDummyRecord, bulkCreateRecords, addRecordNote, listDeletedRecords, restoreRecords, purgeExpiredRecords, getModuleCalendarData, getModuleMapData } from "../services/recordService";
import { listLinksForRecord, listLinksForContact, createLink, updateLink, softDeleteLink } from "../services/recordLinkService";
import { listPipelineLinks } from "../services/pipelineService";
import { listTimeline, log as logActivity } from "../services/activityService";
import { sendRichEmail } from "../services/notificationService";
import { sendEmailBlast, listSends, listSendRecipients } from "../services/communicationService";
import { listSurveys, getSurvey, upsertSurvey, deleteSurvey, setSurveyStatus, duplicateSurvey } from "../services/surveyService";
import { aggregateResults, getResponseExport } from "../services/surveyResultsService";
import { listResponses, createRecipient } from "../services/surveyResponseService";
import { sendSurveyBlast, sendSurveyTest } from "../services/surveyBlastService";
import { listFeedback, getFeedbackTicket, createFeedbackTicket, addFeedbackMessage, resolveFeedbackTicket, restoreFeedbackTicket, deleteFeedbackTicket, listFeedbackExportRows, addFeedbackAttachments } from "../services/feedbackService";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from "../services/templateService";
import { sendSms } from "../services/smsService";
import { listDashboards, createDashboard, updateDashboard, deleteDashboard, getOrCreateHomeDashboard } from "../services/dashboardService";
import { listSavedFilters, createSavedFilter, deleteSavedFilter } from "../services/savedFilterService";
import { listAudiences, getAudience, createAudience, updateAudience, deleteAudience, resolveAudienceContacts, resolveAudiencesToContactIds } from "../services/audienceService";
import { listDrips, getDrip, createDrip, updateDrip, deleteDrip, validateDrip, setDripEnabled } from "../services/dripService";
import { listExports, createExport, createImportRecord, createBackupRecord, getExportCsv, getExportArtifact } from "../services/exportService";
import { listReports, getScheduledReport, upsertScheduledReport, setReportActive } from "../services/reportService";
import { runAndDeliverReport } from "../services/reportExecutor";
import { validateCadence, computeNextRunAt, describeCadence, currentAnchorWeekStart } from "../services/reportSchedule";
import { updatePortal, getPortal, setTenantLabels, setTenantNav, getPortalTheme, setPortalTheme, MASTER_DEFAULT_THEME } from "../services/portalService";
import { VOICE_OPTIONS, DEFAULT_VOICE_ID, isValidVoiceId } from "../config/voices";
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE, isValidTimezone } from "../config/timezones";
import { PRESETS, FONTS } from "../theme/themes";
import { createUser, listUsers, deleteUser, setPassword, publicUser, getContactColumns, setContactColumns, assignUserRole } from "../services/userService";
import { checkPassword } from "../auth/passwords";
import { can, getPermissionCatalog, permissionMatrixForRole, SYSTEM_ROLES, PER_PORTAL_SYSTEM_ROLES, AREA_SECTIONS, listPortalRoles, getPortalRole, createPortalRole, updatePortalRole, deletePortalRoleAndUnassign, effectiveMatrix } from "../services/permissionService";
import { permissionGate, lockGate } from "../middleware/permissionGate";
import { createInvite, inviteLink, sendInvite, sendCustomInvite, hasInviteLinkToken, listPendingInvitesAsUsers, revokeInvite } from "../services/inviteService";
import { listAutomations, getAutomation, createAutomation, updateAutomation, deleteAutomation, listRuns, listEvents, listManualAutomations } from "../services/automationService";
import { testRunAutomation, runManualAutomation, enrollAudienceInAutomation } from "../automation/engine";
import { listScheduledJobs, cancelScheduledJob, processDueJobs } from "../automation/scheduler";
import { loadFieldDefs, conditionFields } from "../automation/contactRow";
import { resolveMergeTags, contactMergeValues } from "../services/mergeTags";
import { validateWebhookUrl, sendWebhook, buildSamplePayload } from "../automation/webhook";
import { listEndpoints, createEndpoint, updateEndpoint, regenerateToken, deleteEndpoint, listCalls as listInboundCalls } from "../services/inboundService";
import { ACTION_TYPES } from "../automation/actions";
import { smsEnabled, geocodingEnabled } from "../config/env";
import { AUTOMATION_PRESETS, getPreset, PRESET_CATEGORIES } from "../automation/presets";
import { REPORT_PRESET_CATEGORIES, publicReportPresets, publicRecordTypePresets } from "../analytics/reportPresets";
import { analyzeFlowDefinition, applyFlowDefinition } from "../services/flowProvisioningService";
import { TRIGGERABLE_EVENT_TYPES, EVENT_TYPES } from "../events/types";
import { emitEvent } from "../events/bus";
import { prisma } from "../db/client";
import { listPresentMembers, stampHeartbeat, normalizeDotColor, setDotColor, getDotColor } from "../services/presenceService";
import { logger } from "../utils/logger";

// Authenticated, tenant-scoped surface for the portal dashboard.
import { listPortalCharges } from "../services/portalBillingService";

export const apiRouter = Router();
apiRouter.use(requireAuth);

// --- Batch C: VIEW-ONLY enforcement (single chokepoint). ----------------------
// When the session is in "view-as-user" impersonation, refuse every mutating
// request server-side; reads (GET/HEAD/OPTIONS) pass. This is the real protection
// (not UI hiding). It triggers ONLY for view-as-user mode, evaluated on the
// Batch A/B overlay (which is only ever set for a real super-admin). It does NOT
// touch act-as-type (Batch D). The impersonation control surface — especially the
// EXIT endpoint — is always exempt, so exit can never be blocked.
apiRouter.use((req: Request, res: Response, next: NextFunction) => {
  const imp = req.impersonation;
  if (!imp || imp.mode !== "view-as-user") return next();
  const m = (req.method || "").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next(); // reads allowed
  // Never block the impersonation endpoints (exit MUST always work; start/targets/
  // state are real-super-admin meta-ops, not tenant-data writes).
  if (/\/impersonation(\/|$|\?)/.test(req.originalUrl || req.url || "")) return next();
  res.status(403).json({ error: "Read-only: you’re viewing as another user and can’t make changes. Exit impersonation to act." });
});

// --- Batch 2: per-area permission ENFORCEMENT (single chokepoint). -------------
// Maps each request to an (area, right) and enforces can(). Additive on top of
// tenant scope. A no-op for OWNER/SUPER_ADMIN/AUDITOR/PORTAL_ADMIN (can()=true for
// them everywhere); applies the intended CLIENT_USER tightening. See permissionGate.
apiRouter.use(permissionGate);
apiRouter.use(lockGate); // owner page-lock: closes the ungated holes for locked pages

/** Resolve the tenant the request may read/write, or send 400 and return null. */
function tenantOr400(req: Request, res: Response): string | null {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) {
    res.status(400).json({ error: "No portal selected" });
    return null;
  }
  return tenantId;
}

/**
 * Gate the AI Receptionist / Calls feature. Returns true only when this portal
 * has receptionistEnabled = true; otherwise it has already sent a 403 and the
 * caller should return. This is the real enforcement layer: even if the nav item
 * is hidden, typing the /calls URL still can't pull call data when the feature
 * is off.
 */
async function receptionistOn(tenantId: string, res: Response): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if ((t as any)?.receptionistEnabled === true) return true;
  res.status(403).json({ error: "The AI Receptionist is not enabled for this portal." });
  return false;
}

// Action attribution. The id is ALWAYS the real user's, so an act-as-type session
// stamps honestly as the super-admin; the name is annotated "(acting as <ROLE>)"
// while impersonating. Routes call this instead of building the actor inline.
// audit-fixes: the ONE helper that captures the acting human's role for the trail.
// Hub humans keep their HUB role even while acting inside a portal (req.realUser wins);
// portal humans report their portal role, with custom roles as CUSTOM:<portalRoleId>
// (the viewer resolves names via the meta roster). Non-human actors never pass here.
function actorRoleOf(req: Request): string | null {
  const real: any = req.realUser || req.user;
  if (!real) return null;
  if (real.customRoleId) return "CUSTOM:" + real.customRoleId;
  return real.role || null;
}
function actorOf(req: Request) {
  const real = req.realUser || req.user;
  const imp = req.impersonation;
  let name = (real?.name || real?.email || "") as string;
  if (imp && imp.mode === "act-as-type") name += " (acting as " + imp.assumedRole + ")";
  return { id: real!.id, name, type: "user" as const, role: actorRoleOf(req) };
}

// Audit-trail helper: log a security/settings change as a tenant-scoped event,
// attributed to the acting user. Best-effort (never blocks the request). These
// types are NOT triggerable, so they mirror AiInstructionsUpdated — logged, with
// no automation firing. Subject defaults to the portal.
function auditEvent(req: Request, tenantId: string, type: string, payload: Record<string, any>, subject?: { type: "portal" | "user"; id: string }) {
  return emitEvent({ tenantId, type, actor: actorOf(req), subject: subject ?? { type: "portal", id: tenantId }, payload }).catch(() => { /* never block the request on audit logging */ });
}

// --- Impersonation: state + targets + start/exit. Real-super-admin gated. ---
// Enforcement IS live: view-as-user is read-only via the view-only guard above, and
// BOTH impersonation modes run with the assumed role's permissions — attachUser
// downgrades the effective req.user and the permissionGate independently resolves the
// assumed role from the overlay, so an impersonated session can't exceed that role.
apiRouter.get("/impersonation", async (req: Request, res: Response) => {
  if (!req.realUser || !isAdminTier(req.realUser.role)) {
    res.status(403).json({ error: "Super-admin only" });
    return;
  }
  const imp = req.impersonation || null;
  let targetName: string | null = null;
  let scopeTenantName: string | null = null;
  if (imp) {
    try {
      if (imp.targetUserId) {
        const u = await prisma.user.findUnique({ where: { id: imp.targetUserId } });
        targetName = u ? (u.name || u.email) : null;
      }
      if (imp.scopeTenantId) {
        const t = await prisma.tenant.findUnique({ where: { id: imp.scopeTenantId } });
        scopeTenantName = t ? (t as any).name : null;
      }
    } catch { /* names are cosmetic; ignore lookup errors */ }
  }
  res.json({
    impersonating: !!imp,
    real: { id: req.realUser.id, email: req.realUser.email, name: req.realUser.name, role: req.realUser.role },
    overlay: imp,
    targetName,
    scopeTenantName,
  });
});

// Targets for the dropdown. Scoped to the CURRENTLY-OPEN portal (passed as
// ?tenantId=…): returns only that portal's non-admin users, the system role types,
// and the portal's CUSTOM roles (id + name) as assumable types. No portal open ->
// no users and no custom roles. Still excludes owner/super-admin/auditor accounts.
apiRouter.get("/impersonation/targets", async (req: Request, res: Response) => {
  if (!req.realUser || !isAdminTier(req.realUser.role)) { res.status(403).json({ error: "Super-admin only" }); return; }
  const tenantId = String((req.query.tenantId ?? "") || "").trim();
  const scoped = tenantId ? ((await listUsers(tenantId)) as any[]) : [];
  const users = scoped.filter((u) => !isAdminTier(u.role));
  const customRoles = tenantId
    ? ((await listPortalRoles(tenantId)) as any[]).map((r) => ({ id: r.id, name: r.name }))
    : [];
  res.json({ users, roles: ["PORTAL_ADMIN", "CLIENT_USER"], customRoles });
});

// Start impersonation. Writes the overlay onto the REAL session. Gated to the real
// super-admin; never to the overlay.
// ---- Audit foundation (devtools batch 2): the DECLARATIVE route audit map. ----
// Structure/settings/bulk/export mutations are captured here — one middleware, data-
// driven, firing on response FINISH for 2xx only (zero latency added, and a failed
// request is never audited as a change). Per-item record/contact/communication events
// come from the event-bus subscriber; import counts + impersonation + auth have their
// own direct hooks. No route is captured twice.
const AUDIT_ROUTE_MAP: { m: string; re: RegExp; action: string; subjectType: string; label?: string }[] = [
  { m: "POST",   re: /^\/fields$/, action: AUDIT_ACTIONS.FIELD_CREATE, subjectType: "fieldDef" },
  { m: "PATCH",  re: /^\/fields\/[^/]+$/, action: AUDIT_ACTIONS.FIELD_UPDATE, subjectType: "fieldDef" },
  { m: "DELETE", re: /^\/fields\/[^/]+$/, action: AUDIT_ACTIONS.FIELD_DELETE, subjectType: "fieldDef" },
  { m: "POST",   re: /^\/fields\/reorder$/, action: AUDIT_ACTIONS.FIELD_UPDATE, subjectType: "fieldDef", label: "Field order" },
  { m: "POST",   re: /^\/fields\/[^/]+\/section$/, action: AUDIT_ACTIONS.SECTION_UPDATE, subjectType: "fieldDef" },
  { m: "POST",   re: /^\/field-sections/, action: AUDIT_ACTIONS.SECTION_UPDATE, subjectType: "fieldSection" },
  { m: "PATCH",  re: /^\/field-sections/, action: AUDIT_ACTIONS.SECTION_UPDATE, subjectType: "fieldSection" },
  { m: "DELETE", re: /^\/field-sections/, action: AUDIT_ACTIONS.SECTION_UPDATE, subjectType: "fieldSection" },
  { m: "POST",   re: /^\/record-types$/, action: AUDIT_ACTIONS.MODULE_CREATE, subjectType: "recordType" },
  { m: "POST",   re: /^\/record-types\/pipeline$/, action: AUDIT_ACTIONS.MODULE_UPDATE, subjectType: "recordType", label: "Pipeline switch" },
  { m: "POST",   re: /^\/record-types\/views$/, action: AUDIT_ACTIONS.VIEWS_UPDATE, subjectType: "recordType" },
  { m: "POST",   re: /^\/record-(stages|statuses|subtypes)\//, action: AUDIT_ACTIONS.STAGES_UPDATE, subjectType: "recordType" },
  { m: "POST",   re: /^\/labels$/, action: AUDIT_ACTIONS.TERMS_UPDATE, subjectType: "settings", label: "Pages & terms" },
  { m: "PATCH",  re: /^\/theme$/, action: AUDIT_ACTIONS.SETTINGS_APPEARANCE, subjectType: "settings", label: "Appearance" },
  { m: "POST",   re: /^\/account\/voice$/, action: AUDIT_ACTIONS.SETTINGS_AI, subjectType: "settings", label: "Voice mode" },
  { m: "POST",   re: /^\/integrations\//, action: AUDIT_ACTIONS.SETTINGS_INTEGRATIONS, subjectType: "settings" },
  { m: "POST",   re: /^\/portal-roles/, action: AUDIT_ACTIONS.SETTINGS_PERMISSIONS, subjectType: "settings" },
  { m: "PATCH",  re: /^\/portal-roles/, action: AUDIT_ACTIONS.SETTINGS_PERMISSIONS, subjectType: "settings" },
  { m: "DELETE", re: /^\/portal-roles/, action: AUDIT_ACTIONS.SETTINGS_PERMISSIONS, subjectType: "settings" },
  { m: "POST",   re: /^\/booking-config$/, action: AUDIT_ACTIONS.SETTINGS_SCHEDULING, subjectType: "settings", label: "Booking config" },
  { m: "POST",   re: /^\/resources$/, action: AUDIT_ACTIONS.SETTINGS_SCHEDULING, subjectType: "settings", label: "Resources" },
  { m: "PATCH",  re: /^\/resources\//, action: AUDIT_ACTIONS.SETTINGS_SCHEDULING, subjectType: "settings", label: "Resources" },
  { m: "DELETE", re: /^\/resources\//, action: AUDIT_ACTIONS.SETTINGS_SCHEDULING, subjectType: "settings", label: "Resources" },
  { m: "POST",   re: /^\/exports$/, action: AUDIT_ACTIONS.EXPORT_RUN, subjectType: "export" },
  { m: "POST",   re: /^\/contacts\/bulk-update$/, action: AUDIT_ACTIONS.BULK_UPDATE, subjectType: "contact" },
  { m: "POST",   re: /^\/records\/bulk-update$/, action: AUDIT_ACTIONS.BULK_UPDATE, subjectType: "record" },
];
apiRouter.use((req: Request, res: Response, next) => {
  res.on("finish", () => {
    try {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const hit = AUDIT_ROUTE_MAP.find((r) => r.m === req.method && r.re.test(req.path));
      if (!hit) return;
      const u: any = (req as any).user;
      audit({
        tenantId: (u && u.tenantId) || (req as any).impersonation?.scopeTenantId || null,
        actorType: "user",
        actorId: u?.id ?? null,
        actorLabel: (u && (u.name || u.email)) || "Unknown user",
        actorRole: actorRoleOf(req),
        action: hit.action,
        subjectType: hit.subjectType,
        subjectId: (req.params && (req.params as any).id) || null,
        subjectLabel: hit.label || (typeof req.body?.name === "string" ? req.body.name : typeof req.body?.label === "string" ? req.body.label : null),
        meta: hit.action === AUDIT_ACTIONS.EXPORT_RUN ? { rows: Number(req.body?.rowCount) || 0, dataType: req.body?.dataType || null } : hit.action === AUDIT_ACTIONS.BULK_UPDATE ? { count: Array.isArray(req.body?.ids) ? req.body.ids.length : 0, field: req.body?.field || null } : null,
      });
    } catch { /* the audit map must never break a response */ }
  });
  next();
});

apiRouter.post("/impersonation/start", async (req: Request, res: Response) => {
  if (!req.realUser || !isAdminTier(req.realUser.role)) { res.status(403).json({ error: "Super-admin only" }); return; }
  const token = req.cookies?.[SESSION_COOKIE];
  const body = (req.body ?? {}) as any;
  const mode = body.mode;
  try {
    if (mode === "view-as-user") {
      const targetUserId = String(body.targetUserId || "");
      if (!targetUserId) { res.status(400).json({ error: "targetUserId required" }); return; }
      // The open portal must be supplied, and the target must belong to it — this
      // closes the cross-portal case at the enforcement layer, not just the UI.
      const scopeTenantId = String(body.scopeTenantId || "");
      if (!scopeTenantId) { res.status(400).json({ error: "Open a portal first" }); return; }
      const target = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!target) { res.status(404).json({ error: "User not found" }); return; }
      if (isAdminTier((target as any).role)) { res.status(400).json({ error: "Cannot impersonate a super-admin or owner" }); return; }
      if (((target as any).tenantId ?? null) !== scopeTenantId) { res.status(400).json({ error: "That user isn’t in the open portal." }); return; }
      // If the target holds a CUSTOM role, carry it so the session resolves to EXACTLY
      // that role's permissions (base role stays the user's own; customRoleId drives can()).
      await setImpersonation(token, { mode: "view-as-user", targetUserId: target.id, assumedRole: (target as any).role, scopeTenantId: (target as any).tenantId ?? null, customRoleId: (target as any).customRoleId ?? null });
      { const real: any = req.realUser || req.user; audit({ tenantId: (target as any).tenantId ?? null, actorType: "user", actorId: real?.id ?? null, actorLabel: (real && (real.name || real.email)) || "Hub user", actorRole: real?.role ?? null, action: AUDIT_ACTIONS.IMPERSONATION_START, subjectType: "auth", subjectId: target.id, subjectLabel: (target as any).name || (target as any).email || null, meta: { mode: "view-as-user" } }); }
    } else if (mode === "act-as-type") {
      const scopeTenantId = String(body.scopeTenantId || "");
      if (!scopeTenantId) { res.status(400).json({ error: "Open a portal first" }); return; }
      const tenant = await prisma.tenant.findUnique({ where: { id: scopeTenantId } });
      if (!tenant) { res.status(404).json({ error: "Portal not found" }); return; }
      const customRoleId = String(body.customRoleId || "");
      if (customRoleId) {
        // Acting as a CUSTOM role: it must exist AND belong to the open portal.
        // getPortalRole is tenant-scoped, so a role from another portal returns null.
        const role = await getPortalRole(customRoleId, scopeTenantId);
        if (!role) { res.status(400).json({ error: "That role isn’t in the open portal." }); return; }
        // Custom roles ride on the CLIENT_USER base (mirrors how assigned users store them);
        // customRoleId is what makes can() resolve EXACTLY the role's permissions.
        await setImpersonation(token, { mode: "act-as-type", assumedRole: "CLIENT_USER", scopeTenantId, customRoleId: role.id, targetUserId: null });
      } else {
        const assumedRole = String(body.assumedRole || "");
        if (assumedRole !== "PORTAL_ADMIN" && assumedRole !== "CLIENT_USER") { res.status(400).json({ error: "assumedRole must be PORTAL_ADMIN or CLIENT_USER" }); return; }
        await setImpersonation(token, { mode: "act-as-type", assumedRole, scopeTenantId, customRoleId: null, targetUserId: null });
      }
    } else {
      res.status(400).json({ error: "mode must be view-as-user or act-as-type" }); return;
    }
  } catch (e) { res.status(500).json({ error: "Could not start impersonation" }); return; }
  res.json({ ok: true });
});

// Exit impersonation. GUARANTEED EXIT: authorized by the REAL super-admin and it
// IGNORES the overlay entirely, so no impersonation state can block it. (Later
// batches that block writes MUST whitelist this route.)
apiRouter.post("/impersonation/exit", async (req: Request, res: Response) => {
  if (!req.realUser || !isAdminTier(req.realUser.role)) { res.status(403).json({ error: "Super-admin only" }); return; }
  const token = req.cookies?.[SESSION_COOKIE];
  await clearImpersonation(token);
  { const real: any = req.realUser || req.user; audit({ tenantId: (req as any).impersonation?.scopeTenantId ?? null, actorType: "user", actorId: real?.id ?? null, actorLabel: (real && (real.name || real.email)) || "Hub user", actorRole: real?.role ?? null, action: AUDIT_ACTIONS.IMPERSONATION_END, subjectType: "auth" }); }
  res.json({ ok: true, impersonating: false });
});

apiRouter.get("/stats", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await getStats(tenantId));
});

// CLIENT-FACING billing: this portal user's OWN finalized bills only (tenant-scoped by
// tenantOr400; drafts + voided excluded; no cost/markup/breakdown/audit fields). Hidden when
// the operator locks the "#/billing" page (lockGate).
apiRouter.get("/portal-billing", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listPortalCharges(tenantId));
});

apiRouter.get("/calls", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!(await receptionistOn(tenantId, res))) return;
  res.json(await listCalls(tenantId));
});

apiRouter.get("/calls/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!(await receptionistOn(tenantId, res))) return;
  const call = await getCall(req.params.id, tenantId);
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(call);
});

apiRouter.get("/contacts", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listContacts(tenantId));
});

// ---- Map data for contacts (contacts-on-the-map): plot contacts via the cached ContactGeo
// coordinates. MUST be registered before "/contacts/:id" so "map" isn't read as an id
// (exactly like /contacts/deleted below). ----
apiRouter.get("/contacts/map", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try { res.json(await getContactsMapData(tenantId)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Calendar data for contacts (contacts-all-views): lay contacts out by a chosen date
// field, mirroring GET /records/calendar's shape. Registered BEFORE "/contacts/:id" so
// "calendar" isn't read as an id (like /contacts/map and /contacts/deleted). ----
apiRouter.get("/contacts/calendar", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const field = String(req.query.field ?? "");
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
      return;
    }
    res.json(await getContactsCalendarData(tenantId, field, from, to));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Recycle bin (soft-deleted contacts) ----
// MUST be registered before "/contacts/:id" so "deleted" isn't read as an id.
apiRouter.get("/contacts/deleted", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  // Lazy purge: anything past the 30-day window is permanently removed on load.
  await purgeExpiredContacts(tenantId);
  res.json(await listDeletedContacts(tenantId));
});

apiRouter.post("/contacts/bulk-delete", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ids = (req.body ?? {}).ids;
  const count = await softDeleteContacts(tenantId, Array.isArray(ids) ? ids : [], actorOf(req));
  res.json({ ok: true, count });
});

apiRouter.post("/contacts/restore", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ids = (req.body ?? {}).ids;
  const count = await restoreContacts(tenantId, Array.isArray(ids) ? ids : [], actorOf(req));
  res.json({ ok: true, count });
});

// Manual single create
apiRouter.post("/contacts", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, phone, email, intent, customFields } = (req.body ?? {}) as any;
  try {
    const c = await createContact(tenantId, { name, phone, email, intent, customFields, source: "manual" }, actorOf(req));
    res.json({ ok: true, id: c.id });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Mass-update one field across selected contacts
apiRouter.post("/contacts/bulk-update", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { ids, field, value } = (req.body ?? {}) as any;
  try {
    const count = await bulkUpdateField(tenantId, Array.isArray(ids) ? ids : [], String(field || ""), value, actorOf(req));
    res.json({ ok: true, count });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Merge contacts (losers -> survivor)
apiRouter.post("/contacts/merge", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { survivorId, loserIds, fieldValues } = (req.body ?? {}) as any;
  try {
    const survivor = await mergeContacts(tenantId, String(survivorId || ""), Array.isArray(loserIds) ? loserIds : [], fieldValues || {}, actorOf(req));
    res.json({ ok: true, id: survivor?.id });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Create a dummy contact (testing aid)
apiRouter.post("/contacts/dummy", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const c = await generateDummyContact(tenantId, actorOf(req));
    res.json({ ok: true, id: c.id });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.delete("/contacts/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  // Soft delete — moves the contact to the recycle bin, never erases it here.
  const count = await softDeleteContacts(tenantId, [req.params.id], actorOf(req));
  if (!count) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.json({ ok: true });
});

apiRouter.get("/contacts/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const contact = await getContact(req.params.id, tenantId);
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.json(contact);
});

apiRouter.post("/contacts/import", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const rows = (req.body?.rows ?? []) as any[];
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "No rows to import" });
    return;
  }
  try {
    const result = await importContacts(tenantId, rows, actorOf(req));
    // Import history (kind="import"), mirroring export history. Best-effort.
    try {
      await createImportRecord({ tenantId, dataType: "contact", name: "Contacts import", rowCount: result.imported + result.skipped, okCount: result.imported, failCount: result.skipped, createdById: req.user?.id ?? null });
    } catch { /* never fail the import on history write */ }
    audit({ tenantId, actorType: "user", actorId: req.user?.id ?? null, actorLabel: (req.user && ((req.user as any).name || (req.user as any).email)) || "Unknown user", actorRole: actorRoleOf(req), action: AUDIT_ACTIONS.IMPORT_RUN, subjectType: "import", subjectLabel: "Contacts import", meta: { imported: result.imported, skipped: result.skipped } });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.patch("/contacts/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, phone, email, intent, stageKey, customFields } = (req.body ?? {}) as any;
  try {
    await updateContact(req.params.id, tenantId, { name, phone, email, intent, stageKey, customFields }, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message.includes("Unique") ? "That phone number is already used by another contact" : (err as Error).message;
    res.status(400).json({ error: msg });
  }
});

apiRouter.get("/contacts/:id/timeline", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const items = await listTimeline(req.params.id, tenantId);
  if (!items) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.json(items);
});

apiRouter.post("/contacts/:id/email", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { subject, html } = (req.body ?? {}) as { subject?: string; html?: string };
  if (!subject || !subject.trim()) {
    res.status(400).json({ error: "A subject is required" });
    return;
  }
  const contact = await getContact(req.params.id, tenantId);
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  if (!contact.email) {
    res.status(400).json({ error: "This contact has no email address" });
    return;
  }
  try {
    // Resolve any merge tags against THIS contact (single transactional send — Part 3d).
    const mergeVals = contactMergeValues(contact, await loadFieldDefs(tenantId));
    const finalSubject = resolveMergeTags(subject, mergeVals);
    const finalHtml = resolveMergeTags(html || "", mergeVals);
    await sendRichEmail({ to: contact.email, subject: finalSubject, html: finalHtml, fromEmail: req.user!.email, fromName: req.user!.name }, {
      type: "single",
      tenantId,
      sentById: req.user!.id,
      contactId: req.params.id,
      toName: contact.name ?? null,
    });
    await logActivity({
      tenantId,
      contactId: req.params.id,
      type: "email_sent",
      summary: `Email sent: ${finalSubject}`,
      detail: { subject: finalSubject, to: contact.email, from: req.user!.email },
      actor: actorOf(req),
    });
    await emitEvent({ tenantId, type: EVENT_TYPES.EmailSent, actor: { type: "user", id: req.user!.id, name: req.user!.name || req.user!.email }, subject: { type: "contact", id: req.params.id }, payload: { subject: finalSubject, to: contact.email } });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Communication page — manual email blast. Reuses the SAME outbound path + role gate
// (contacts:edit, via permissionGate) as bulk-emailing from Contacts. The client sends
// the picker's resolved contact ids (+ optional excludes); the server re-resolves the
// emailable set, fans out sendRichEmail, and logs ONE CommunicationSend row.
apiRouter.post("/communication/email", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const body = (req.body ?? {}) as { subject?: string; html?: string; contactIds?: unknown; excludeIds?: unknown; extraEmails?: unknown };
  const subject = String(body.subject || "").trim();
  if (!subject) { res.status(400).json({ error: "A subject is required" }); return; }
  const contactIds = Array.isArray(body.contactIds) ? body.contactIds.map((x) => String(x)) : [];
  const excludeIds = Array.isArray(body.excludeIds) ? body.excludeIds.map((x) => String(x)) : [];
  const extraEmails = Array.isArray(body.extraEmails) ? body.extraEmails.map((x) => String(x)) : [];
  // Audiences resolve to their CURRENT matching contacts at SEND time (dynamic), unioned + de-duped
  // with any manually-picked contactIds. sendEmailBlast filters to emailable + de-dupes downstream.
  const audienceIds = Array.isArray((body as any).audienceIds) ? (body as any).audienceIds.map((x: any) => String(x)) : [];
  const fromAudiences = audienceIds.length ? (await resolveAudiencesToContactIds(tenantId, audienceIds)).contactIds : [];
  const allContactIds = Array.from(new Set([...contactIds, ...fromAudiences]));
  if (!allContactIds.length && !extraEmails.length) { res.status(400).json({ error: "No recipients selected" }); return; }
  try {
    const result = await sendEmailBlast({
      tenantId, subject, html: String(body.html || ""),
      contactIds: allContactIds, excludeIds, extraEmails,
      fromEmail: req.user!.email, fromName: req.user!.name,
      createdById: req.user!.id,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Sent log — this tenant's past email blasts (newest first, creator name + counts +
// subject/body for the detail view). Gated like the Email tab (contacts:edit).
apiRouter.get("/communication/sends", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listSends(tenantId));
});

// Per-recipient list for ONE past send, read from EmailLog (one row per address, with
// its real delivery status incl. "mock"). Tenant-scoped: the send must belong to this
// tenant. Returns 404 for a send that isn't this tenant's; [] means the send exists but
// predates recipient capture (the client shows the "not recorded" note).
apiRouter.get("/communication/sends/:id/recipients", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const rows = await listSendRecipients(tenantId, req.params.id);
  if (rows === null) { res.status(404).json({ error: "Send not found" }); return; }
  res.json(rows);
});

// ---- Surveys (Communication → Surveys) — builder CRUD ----
apiRouter.get("/surveys", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listSurveys(tenantId));
});

apiRouter.get("/surveys/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const survey = await getSurvey(tenantId, req.params.id);
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }
  res.json(survey);
});

apiRouter.post("/surveys", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const body = (req.body ?? {}) as any;
  try {
    const saved = await upsertSurvey({
      tenantId,
      id: body.id || null,
      name: body.name,
      description: body.description,
      status: body.status,
      mapTargetType: body.mapTargetType,
      questions: Array.isArray(body.questions) ? body.questions : [],
      createdById: req.user!.id,
    });
    res.json({ ok: true, ...saved });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.delete("/surveys/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ok = await deleteSurvey(tenantId, req.params.id);
  if (!ok) { res.status(404).json({ error: "Survey not found" }); return; }
  res.json({ ok: true });
});

// Minimal "view responses" so submissions are verifiable (full results view is later).
apiRouter.get("/surveys/:id/responses", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const rows = await listResponses(tenantId, req.params.id);
  if (rows === null) { res.status(404).json({ error: "Survey not found" }); return; }
  res.json(rows);
});

// Results view — summary + per-question breakdown (counts/%, rating avg, NPS score).
apiRouter.get("/surveys/:id/results", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const r = await aggregateResults(tenantId, req.params.id);
  if (!r) { res.status(404).json({ error: "Survey not found" }); return; }
  res.json(r);
});

// Flattened rows for the response export (the client builds CSV/xlsx + logs history,
// reusing the shared export machinery).
apiRouter.get("/surveys/:id/response-export", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const r = await getResponseExport(tenantId, req.params.id);
  if (!r) { res.status(404).json({ error: "Survey not found" }); return; }
  res.json(r);
});

// Duplicate a survey as a new draft (INSERT — never overwrites the source).
apiRouter.post("/surveys/:id/duplicate", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const r = await duplicateSurvey(tenantId, req.params.id, req.user!.id);
  if (!r) { res.status(404).json({ error: "Survey not found" }); return; }
  res.json({ ok: true, ...r });
});

// Lifecycle: activate / close / reopen. Does not delete responses.
apiRouter.patch("/surveys/:id/status", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const r = await setSurveyStatus(tenantId, req.params.id, String(((req.body ?? {}) as any).status || ""));
    if (!r) { res.status(404).json({ error: "Survey not found" }); return; }
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Mint a per-recipient tokenized link for one contact (personal link). The blast batch
// will mint these in bulk. Returns a ready-to-share URL built from the request origin.
apiRouter.post("/surveys/:id/recipients", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const contactId = ((req.body ?? {}) as any).contactId || null;
  const r = await createRecipient(tenantId, req.params.id, contactId);
  if (!r) { res.status(404).json({ error: "Survey not found" }); return; }
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json({ id: r.id, token: r.token, url: `${origin}/survey.html?token=${encodeURIComponent(r.token)}` });
});

// Send a survey to a chosen audience — each recipient gets their OWN per-recipient link.
apiRouter.post("/surveys/:id/send", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const body = (req.body ?? {}) as any;
  const subject = String(body.subject || "").trim();
  if (!subject) { res.status(400).json({ error: "A subject is required" }); return; }
  const contactIds = Array.isArray(body.contactIds) ? body.contactIds.map((x: any) => String(x)) : [];
  const excludeIds = Array.isArray(body.excludeIds) ? body.excludeIds.map((x: any) => String(x)) : [];
  // Audiences resolve to current matching contacts at SEND time, unioned + de-duped with any manual ids.
  const audienceIds = Array.isArray(body.audienceIds) ? body.audienceIds.map((x: any) => String(x)) : [];
  const fromAudiences = audienceIds.length ? (await resolveAudiencesToContactIds(tenantId, audienceIds)).contactIds : [];
  const allContactIds = Array.from(new Set([...contactIds, ...fromAudiences]));
  if (!allContactIds.length) { res.status(400).json({ error: "No recipients selected" }); return; }
  try {
    const result = await sendSurveyBlast({
      tenantId, surveyId: req.params.id, subject, html: String(body.html || ""),
      contactIds: allContactIds, excludeIds,
      fromEmail: req.user!.email, fromName: req.user!.name, createdById: req.user!.id,
      origin: `${req.protocol}://${req.get("host")}`,
    });
    res.json({ ok: true, recipientCount: result.recipientCount, sentCount: result.sentCount, failCount: result.failCount });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Send one preview copy to the current user (sample link), to eyeball before blasting.
apiRouter.post("/surveys/:id/send-test", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const body = (req.body ?? {}) as any;
  const subject = String(body.subject || "").trim();
  if (!subject) { res.status(400).json({ error: "A subject is required" }); return; }
  try {
    await sendSurveyTest({
      tenantId, surveyId: req.params.id, subject, html: String(body.html || ""),
      toEmail: req.user!.email, fromEmail: req.user!.email, fromName: req.user!.name,
      origin: `${req.protocol}://${req.get("host")}`, sampleName: req.user!.name,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/contacts/:id/text", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { body } = (req.body ?? {}) as { body?: string };
  if (!body || !body.trim()) {
    res.status(400).json({ error: "Message can't be empty" });
    return;
  }
  const contact = await getContact(req.params.id, tenantId);
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  if (!contact.phone) {
    res.status(400).json({ error: "This contact has no phone number" });
    return;
  }
  try {
    const portal = await prisma.tenant.findUnique({ where: { id: tenantId } });
    await sendSms({ to: contact.phone, body: body.trim(), from: portal?.phoneNumber });
    await logActivity({
      tenantId,
      contactId: req.params.id,
      type: "text_sent",
      summary: "Text message sent",
      detail: { to: contact.phone, body: body.trim() },
      actor: actorOf(req),
    });
    await emitEvent({ tenantId, type: EVENT_TYPES.SMSSent, actor: { type: "user", id: req.user!.id, name: req.user!.name || req.user!.email }, subject: { type: "contact", id: req.params.id }, payload: { to: contact.phone } });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Email/SMS templates (shared across the portal) ----
apiRouter.get("/templates", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const kind = (req.query.kind as string | undefined) || undefined;
  res.json(await listTemplates(tenantId, kind));
});

apiRouter.post("/templates", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, kind, subject, body, tag } = (req.body ?? {}) as any;
  if (!name || !name.trim()) {
    res.status(400).json({ error: "A template name is required" });
    return;
  }
  res.json(await createTemplate({ tenantId, name, kind, subject, body: body || "", tag: tag != null && String(tag).trim() ? String(tag).trim() : null, createdById: req.user!.id }));
});

apiRouter.patch("/templates/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, subject, body, tag } = (req.body ?? {}) as any;
  if (name != null && !String(name).trim()) { res.status(400).json({ error: "A template name is required" }); return; }
  const patch: any = { name, subject, body };
  if (tag !== undefined) patch.tag = tag != null && String(tag).trim() ? String(tag).trim() : null;
  const updated = await updateTemplate(req.params.id, tenantId, patch);
  if (!updated) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(updated);
});

apiRouter.delete("/templates/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ok = await deleteTemplate(req.params.id, tenantId);
  if (!ok) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ ok: true });
});

// ---- Dashboards / Reports (shared across the portal) ----

// Built-in report-widget presets ("templates") for the Analytics on-ramp. Static
// path is defined before "/dashboards/:id" so it's never mistaken for an id.
// Read-only; the internal `vertical` tag is stripped by publicReportPresets().
// Record-type templates (e.g. Equipment) are appended ONLY for the record types
// this portal actually has — so a portal without equipment never sees them.
apiRouter.get("/reports/presets", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const types = await listRecordTypes(tenantId).catch(() => []);
  const presentKeys = (types as any[]).map((t) => t.key);
  const presets = publicReportPresets().concat(publicRecordTypePresets(presentKeys));
  res.json({ categories: REPORT_PRESET_CATEGORIES, presets });
});

apiRouter.get("/dashboards", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listDashboards(tenantId));
});

// Dedicated home/overview dashboard for the main "Dashboard" screen (separate
// from the user-created Reports dashboards).
apiRouter.get("/dashboards/home", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await getOrCreateHomeDashboard(tenantId, req.user!.id));
});

apiRouter.post("/dashboards", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name } = (req.body ?? {}) as { name?: string };
  res.json(await createDashboard(tenantId, name || "Untitled dashboard", req.user!.id));
});

apiRouter.patch("/dashboards/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, widgets } = (req.body ?? {}) as any;
  try {
    res.json(await updateDashboard(req.params.id, tenantId, { name, widgets }, req.user!.role));
  } catch (err) {
    if ((err as any).code === "FORBIDDEN") { res.status(403).json({ error: (err as Error).message }); return; }
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.delete("/dashboards/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ok = await deleteDashboard(req.params.id, tenantId);
  if (!ok) { res.status(404).json({ error: "Dashboard not found" }); return; }
  res.json({ ok: true });
});

// ---- Per-user Contacts column layout (order + hidden); survives reloads ----
apiRouter.get("/account/contact-columns", async (req: Request, res: Response) => {
  res.json({ layout: await getContactColumns(req.user!.id) });
});

apiRouter.patch("/account/contact-columns", async (req: Request, res: Response) => {
  const layout = await setContactColumns(req.user!.id, (req.body ?? {}).layout ?? req.body);
  res.json({ layout });
});

// ---- AI Instructions (per-portal, client-editable; layered onto the AI prompt) ----
// Capability gate: currently ON for every portal. To later restrict to "AI-enabled"
// portals, replace `aiEnabled` with a real per-portal flag (e.g. portal.aiEnabled).
function aiInstructionsEditable(req: Request): boolean {
  const aiEnabled = true; // <- flip to a per-portal flag later to gate by capability
  return aiEnabled && req.user!.role !== "CLIENT_USER";
}

// Curated non-module knowledge sources for the "Pages" checklist. NOT registry-
// derived (pages are a hand-picked, non-uniform set) — add entries here as more
// page-level sources gain awareness support. `key` is what's stored/validated.
const AI_KNOWLEDGE_PAGE_SOURCES = [
  { key: "calls", label: "Calls", description: "The caller's prior call history (so a repeat caller can be recognized)." },
];
const AI_KNOWLEDGE_PAGE_KEYS = new Set(AI_KNOWLEDGE_PAGE_SOURCES.map((p) => p.key));

apiRouter.get("/account/ai-instructions", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const portal = await getPortal(tenantId);
  res.json({
    aiInstructions: (portal as any)?.aiInstructions ?? "",
    aiKnowledgeModules: Array.isArray((portal as any)?.aiKnowledgeModules) ? (portal as any).aiKnowledgeModules : [],
    aiKnowledgePages: Array.isArray((portal as any)?.aiKnowledgePages) ? (portal as any).aiKnowledgePages : [],
    // Curated non-module knowledge sources (the "Pages" checklist). Extensible;
    // Calls (prior call history) is the only source today.
    aiKnowledgePageOptions: AI_KNOWLEDGE_PAGE_SOURCES,
    editable: aiInstructionsEditable(req),
    // For the Receptionist-voice picker in the same panel:
    voiceId: (portal as any)?.voiceId ?? DEFAULT_VOICE_ID,
    voiceMode: (portal as any)?.voiceMode ?? "OFF",
    voiceOptions: VOICE_OPTIONS,
    // Per-business timezone picker (foundation only — nothing converts off this yet).
    timezone: (portal as any)?.timezone ?? DEFAULT_TIMEZONE,
    timezoneOptions: TIMEZONE_OPTIONS,
  });
});

apiRouter.patch("/account/ai-instructions", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!aiInstructionsEditable(req)) {
    res.status(403).json({ error: "You don't have permission to edit AI Instructions." });
    return;
  }
  const aiInstructions = String((req.body ?? {}).aiInstructions ?? "");
  try {
    await updatePortal(tenantId, { aiInstructions } as any);
    // Audit trail: record WHO changed it, WHEN, and for WHICH portal. Recorded as a
    // tenant-scoped domain event (subject = the portal). No automation triggers on it.
    await emitEvent({
      tenantId,
      type: EVENT_TYPES.AiInstructionsUpdated,
      actor: actorOf(req),
      subject: { type: "portal", id: tenantId },
      payload: { length: aiInstructions.length },
    });
    res.json({ ok: true, aiInstructions });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Save the "System knowledge" module selection — the record-type keys whose linked
// records a KNOWN caller brings into the receptionist's context. Validated against
// the portal's real, non-contact record types (contact is the caller, not a linked
// module); unknown/locked/contact keys are dropped. Same admin gate as Instructions.
apiRouter.patch("/account/ai-knowledge-modules", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!aiInstructionsEditable(req)) {
    res.status(403).json({ error: "You don't have permission to edit AI Receptionist settings." });
    return;
  }
  const raw = (req.body ?? {}).aiKnowledgeModules;
  const requested: string[] = Array.isArray(raw) ? raw.filter((k: any) => typeof k === "string") : [];
  // Keep only real, non-contact record types this portal actually has.
  const types = await listRecordTypes(tenantId).catch(() => [] as any[]);
  const valid = new Set((types as any[]).map((t) => t.key).filter((k) => k !== "contact"));
  const aiKnowledgeModules = Array.from(new Set(requested.filter((k) => valid.has(k))));
  try {
    await updatePortal(tenantId, { aiKnowledgeModules } as any);
    res.json({ ok: true, aiKnowledgeModules });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Save the "Pages" knowledge selection — curated non-module sources (e.g. Calls
// history). Validated against the fixed AI_KNOWLEDGE_PAGE_SOURCES list; unknown
// keys are dropped. Same admin gate as Instructions.
apiRouter.patch("/account/ai-knowledge-pages", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!aiInstructionsEditable(req)) {
    res.status(403).json({ error: "You don't have permission to edit AI Receptionist settings." });
    return;
  }
  const raw = (req.body ?? {}).aiKnowledgePages;
  const requested: string[] = Array.isArray(raw) ? raw.filter((k: any) => typeof k === "string") : [];
  const aiKnowledgePages = Array.from(new Set(requested.filter((k) => AI_KNOWLEDGE_PAGE_KEYS.has(k))));
  try {
    await updatePortal(tenantId, { aiKnowledgePages } as any);
    res.json({ ok: true, aiKnowledgePages });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Upload one or many documents (PDF/.docx/.xlsx/.csv/.txt/.zip), extract text, and use an AI pass
// to organize it into the portal's CURRENT instruction sections — returned as REVIEW suggestions.
// Nothing is saved here (the client applies into the editor, then the normal Save PATCH commits).
// Same gate as editing: aiInstructionsEditable (blocks CLIENT_USER). Files are parsed in memory
// and discarded — never written to disk or the DB.
const aiDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 40 },
}).array("files", MAX_FILES);

apiRouter.post("/account/ai-instructions/parse-docs", (req: Request, res: Response) => {
  if (!aiInstructionsEditable(req)) { res.status(403).json({ error: "You don't have permission to edit AI Instructions." }); return; }
  aiDocUpload(req, res, async (uploadErr: any) => {
    if (uploadErr) {
      const msg = uploadErr?.code === "LIMIT_FILE_SIZE" ? `Each file must be under ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`
        : uploadErr?.code === "LIMIT_FILE_COUNT" ? `Please upload at most ${MAX_FILES} files at once.`
        : (uploadErr.message || "Upload failed.");
      res.status(400).json({ error: msg });
      return;
    }
    const tenantId = resolveTenantScope(req);
    if (!tenantId) { res.status(400).json({ error: "No tenant in scope" }); return; }
    const files = ((req as any).files || []) as { originalname: string; buffer: Buffer }[];
    if (!files.length) { res.status(400).json({ error: "No files were uploaded." }); return; }
    const totalBytes = files.reduce((n, f) => n + (f.buffer?.length || 0), 0);
    if (totalBytes > MAX_TOTAL_BYTES) { res.status(400).json({ error: `Total upload must be under ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB.` }); return; }

    // Section names to fill = the portal's CURRENT sections (parsed from the stored field), so the
    // model fills exactly what the editor shows. Fall back to defaults for an empty field.
    const portal = await getPortal(tenantId);
    const stored = String((portal as any)?.aiInstructions ?? "");
    const sectionNames = parseSectionNames(stored);

    try {
      const { blocks, skipped } = await extractDocuments(files);
      if (!blocks.length) {
        res.status(400).json({ error: "Couldn't read any text from those files.", filesRead: [], filesSkipped: skipped });
        return;
      }
      const combined = combineBlocks(blocks);
      const suggestions = await organizeIntoSections(combined, sectionNames);
      res.json({ suggestions, filesRead: blocks.map((b) => b.filename), filesSkipped: skipped });
    } catch (err) {
      if (err instanceof InstructionsParseError) { res.status(502).json({ error: err.message }); return; }
      res.status(400).json({ error: (err as Error).message });
    }
  });
});

// Section names (from "## Name" headings) in a stored aiInstructions blob; defaults if none.
function parseSectionNames(text: string): string[] {
  const names: string[] = [];
  for (const line of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) names.push(m[1].trim());
  }
  return names.length ? names : ["Overview", "Services", "Pricing", "What we don't do", "FAQs", "Tone & personality"];
}
// Same editors as AI Instructions. Saves immediately. The value MUST be one of
// the five allowed voice IDs — anything else is rejected.
apiRouter.patch("/account/voice", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!aiInstructionsEditable(req)) {
    res.status(403).json({ error: "You don't have permission to change the receptionist voice." });
    return;
  }
  const voiceId = String((req.body ?? {}).voiceId ?? "");
  if (!isValidVoiceId(voiceId)) {
    res.status(400).json({ error: "Pick one of the available voices." });
    return;
  }
  try {
    const prevVoice = ((await getPortal(tenantId)) as any)?.voiceId ?? null;
    await updatePortal(tenantId, { voiceId } as any);
    auditEvent(req, tenantId, EVENT_TYPES.SettingChanged, { setting: "voice", old: prevVoice, new: voiceId });
    res.json({ ok: true, voiceId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Business timezone (foundation for future Google Calendar work) ----
// Same editors as the voice picker. Saves immediately. The value MUST be one of
// the allowed IANA zones (see src/config/timezones.ts) — anything else is
// rejected. NOTHING converts time off this yet; it is stored only.
export async function patchAccountTimezone(req: Request, res: Response) {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!aiInstructionsEditable(req)) {
    res.status(403).json({ error: "You don't have permission to change the business timezone." });
    return;
  }
  const timezone = String((req.body ?? {}).timezone ?? "");
  if (!isValidTimezone(timezone)) {
    res.status(400).json({ error: "Pick one of the available timezones." });
    return;
  }
  try {
    const prevTz = ((await getPortal(tenantId)) as any)?.timezone ?? null;
    await updatePortal(tenantId, { timezone } as any);
    auditEvent(req, tenantId, EVENT_TYPES.SettingChanged, { setting: "timezone", old: prevTz, new: timezone });
    res.json({ ok: true, timezone });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}
apiRouter.patch("/account/timezone", patchAccountTimezone);

// ---- Personal email signature ----
apiRouter.get("/account/signature", async (req: Request, res: Response) => {  const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { signature: true } });
  res.json({ signature: u?.signature ?? "" });
});

apiRouter.patch("/account/signature", async (req: Request, res: Response) => {
  const { signature } = (req.body ?? {}) as { signature?: string };
  await prisma.user.update({ where: { id: req.user!.id }, data: { signature: signature ?? "" } });
  res.json({ ok: true });
});

// ===========================================================================
// Presence ("who's online") — Google-Drive-style avatar dots, per portal.
// Only real portal MEMBERS (PORTAL_ADMIN / CLIENT_USER, incl. custom-role users
// whose base role is CLIENT_USER) ever appear. OWNER / SUPER_ADMIN / AUDITOR are
// excluded unconditionally by the role filter — so an admin, even while
// impersonating a member, never produces a dot (heartbeat keys off the REAL
// identity, whose row is admin-tier + tenantId null → never matches a portal query).
// Strictly per-tenant; exposes only name, first initial and color (no email/PII).
// ===========================================================================
apiRouter.post("/presence/heartbeat", async (req: Request, res: Response) => {
  await stampHeartbeat((req.realUser || req.user)!.id); // REAL identity — impersonation never records a dot
  res.json({ ok: true });
});

apiRouter.get("/presence", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) { res.json({ present: [] }); return; }
  // Stamp the caller first (REAL identity) so the self-view can never be empty due to
  // poll/heartbeat ordering. Admins have no member row/tenant match, so this is a no-op
  // for their visibility — they still never appear.
  await stampHeartbeat((req.realUser || req.user)!.id);
  res.json({ present: await listPresentMembers(tenantId) });
});

apiRouter.patch("/account/dot-color", async (req: Request, res: Response) => {
  const color = normalizeDotColor((req.body ?? {}).color);
  if (!color) { res.status(400).json({ error: "Please choose a valid color." }); return; }
  await setDotColor((req.realUser || req.user)!.id, color); // store on the REAL user
  res.json({ ok: true, color });
});

apiRouter.get("/account/dot-color", async (req: Request, res: Response) => {
  res.json(await getDotColor((req.realUser || req.user)!.id));
});

// ---- Custom fields (definitions are admin-managed; values editable by all) ----
function fieldsAdminOnly(req: Request, res: Response): boolean {
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Only admins can change fields" });
    return false;
  }
  return true;
}

apiRouter.get("/record-types", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listRecordTypes(tenantId));
});

// Create a user-defined module (record type). Same guard as field/module management
// (portal-admin and above — CLIENT_USER is rejected). The service generates a safe
// unique key, orders it after the last module, and seeds a default "Name" field.
apiRouter.post("/record-types", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  const label = String((req.body?.label ?? "")).trim();
  const labelPlural = String((req.body?.labelPlural ?? "")).trim();
  if (!label) { res.status(400).json({ error: "Module name is required" }); return; }
  try {
    const created = await createRecordType(tenantId, label, labelPlural || undefined);
    res.status(201).json(created);
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Could not create the module" });
  }
});

// ---- Per-portal display labels (the naming layer) -------------------------
// Single source the front-end's App.label() helper caches. Bundles:
//   types:   { <recordTypeKey>: {one, many} }  — straight from RecordType
//            label/labelPlural (so "contact"/"job" reflect live edits).
//   generic: the Tenant.labels override bag for non-record-type words
//            (e.g. "record","stage"); empty {} means use built-in defaults.
// Read-only; changes nothing. Foundation for later relabeling.
apiRouter.get("/labels", async (req: Request, res: Response) => {
  // Portal-scoped: a portal only ever gets its OWN labels (resolveTenantScope
  // ties to the signed-in user's tenant, or the selected portal for a super-
  // admin). If there's no portal in context (e.g. a super-admin who hasn't
  // picked one), return empty labels with 200 so the helper just uses English
  // defaults — never a 400/console error.
  const tenantId = resolveTenantScope(req);
  if (!tenantId) {
    res.json({ types: {}, generic: {}, nav: { order: [], hidden: [], labels: {} } });
    return;
  }
  const types: Record<string, { one: string; many: string }> = {};
  for (const rt of (await listRecordTypes(tenantId)) as any[]) {
    if (rt && rt.key) types[rt.key] = { one: rt.label, many: rt.labelPlural || rt.label };
  }
  const portal = await getPortal(tenantId);
  // Tenant.labels holds BOTH the generic noun overrides AND a reserved `nav` key.
  // Split them: `generic` is what App.label() reads (must NOT contain `nav`), and
  // `nav` is surfaced on its own for the nav renderer + the Settings editor.
  const allLabels = (portal && (portal as any).labels && typeof (portal as any).labels === "object") ? { ...(portal as any).labels } : {};
  const navRaw = allLabels.nav;
  delete allLabels.nav;
  const nav = navRaw && typeof navRaw === "object"
    ? {
        order: Array.isArray(navRaw.order) ? navRaw.order : [],
        hidden: Array.isArray(navRaw.hidden) ? navRaw.hidden : [],
        labels: navRaw.labels && typeof navRaw.labels === "object" ? navRaw.labels : {},
      }
    : { order: [], hidden: [], labels: {} };
  res.json({ types, generic: allLabels, nav });
});

// Save per-portal labels (the Labels editor). Portal-scoped + admin-only.
//   body: { types: { <recordTypeKey>: {one, many} }, generic: { <word>: {one, many} } }
// Record-type entries update that type's label/labelPlural; generic entries
// merge into Tenant.labels. Stable KEYS are never changed. Validation (non-blank,
// trimmed, both forms required) lives in the services and surfaces as a 400.
apiRouter.patch("/labels", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) {
    res.status(400).json({ error: "No portal in context" });
    return;
  }
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Not authorized to change labels" });
    return;
  }
  const body = (req.body ?? {}) as any;
  try {
    const types = body.types && typeof body.types === "object" ? body.types : {};
    for (const [key, v] of Object.entries(types) as [string, any][]) {
      if (!v) continue;
      await setRecordTypeLabels(tenantId, String(key), String(v.one ?? ""), String(v.many ?? ""));
    }
    if (body.generic && typeof body.generic === "object") {
      await setTenantLabels(tenantId, body.generic);
    }
    if (body.nav && typeof body.nav === "object") {
      await setTenantNav(tenantId, body.nav);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});


// ---- Field sections (display-only grouping of fields, per record type) ----
apiRouter.get("/field-sections", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const recordType = req.query.recordType ? String(req.query.recordType) : null;
  res.json(await listSections(tenantId, recordType));
});

apiRouter.post("/field-sections", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try {
    const { recordType, label } = (req.body ?? {}) as any;
    res.json(await createSection(tenantId, recordType ?? null, label));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.patch("/field-sections/reorder", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  await reorderSections(tenantId, (req.body?.orderedIds ?? []) as string[]);
  res.json({ ok: true });
});

apiRouter.patch("/field-sections/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { res.json(await renameSection(tenantId, req.params.id, (req.body ?? {}).label)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.delete("/field-sections/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { await deleteSection(tenantId, req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Job types (subtypes) + their pipelines, managed centrally per record type ----
// Action-based POSTs, admin-gated. Keys are stable: rename = label only,
// reorder = order only. Deleting a job type is blocked while jobs use it;
// deleting a stage is blocked while candidates of that type occupy it. No
// migration here — these rewrite the RecordType.subtypes JSON. Each returns the
// updated, serialized record type.
apiRouter.post("/record-subtypes/add", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, label } = (req.body ?? {}) as any; res.json(await addSubtype(tenantId, recordType, label)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/record-subtypes/rename", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, key, label } = (req.body ?? {}) as any; res.json(await renameSubtype(tenantId, recordType, key, label)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/record-subtypes/reorder", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, orderedKeys } = (req.body ?? {}) as any; res.json(await reorderSubtypes(tenantId, recordType, orderedKeys ?? [])); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/record-subtypes/delete", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, key } = (req.body ?? {}) as any; res.json(await deleteSubtype(tenantId, recordType, key)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// Stages live inside a job type's pipeline, so each call carries the subtypeKey.
apiRouter.post("/record-stages/add", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, subtypeKey, label } = (req.body ?? {}) as any; res.json(await addStage(tenantId, recordType, subtypeKey, label)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/record-stages/rename", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, subtypeKey, key, label } = (req.body ?? {}) as any; res.json(await renameStage(tenantId, recordType, subtypeKey, key, label)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/record-stages/reorder", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, subtypeKey, orderedKeys } = (req.body ?? {}) as any; res.json(await reorderStages(tenantId, recordType, subtypeKey, orderedKeys ?? [])); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/record-stages/delete", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, subtypeKey, key } = (req.body ?? {}) as any; res.json(await deleteStage(tenantId, recordType, subtypeKey, key)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// Turn a module's pipeline ON/OFF (Structure & behavior toggle). Non-destructive: OFF keeps
// all types/stages/statuses + record stage assignments and only hides the pipeline UI.
// Same module-management guard as the subtype/stage/status editors above.
apiRouter.post("/record-types/pipeline", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, enabled } = (req.body ?? {}) as any; res.json(await setPipelineEnabled(tenantId, recordType, !!enabled)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Per-module VIEWS config (which optional views the module offers on its list page).
// Availability is validated server-side from real data (Board needs a pipeline; Calendar
// needs a date field); the chosen calendar date field is resolved to a real field. Admin-gated.
apiRouter.post("/record-types/views", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try {
    const { recordType, enabledViews, calendarDateField } = (req.body ?? {}) as any;
    res.json(await setModuleViews(tenantId, recordType, { enabledViews, calendarDateField }));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Record-level STATUS editor (RecordType.recordStages). Distinct from the
// pipeline /record-stages routes above (those take a subtypeKey). Admin-gated.
// Delete runs the dual guard in the service and, when blocked, returns 409 with
// a structured blocker list (records + automations) for the in-app modal. ----
apiRouter.post("/record-statuses/add", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, label } = (req.body ?? {}) as any; res.json(await addRecordStatus(tenantId, recordType, label)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/record-statuses/rename", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, key, label } = (req.body ?? {}) as any; res.json(await renameRecordStatus(tenantId, recordType, key, label)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/record-statuses/reorder", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, orderedKeys } = (req.body ?? {}) as any; res.json(await reorderRecordStatuses(tenantId, recordType, orderedKeys ?? [])); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/record-statuses/delete", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try { const { recordType, key } = (req.body ?? {}) as any; res.json(await deleteRecordStatus(tenantId, recordType, key)); }
  catch (err) {
    const e = err as any;
    if (e && e.code === "STATUS_IN_USE") { res.status(409).json({ error: "STATUS_IN_USE", blockers: e.blockers }); return; }
    res.status(400).json({ error: (err as Error).message });
  }
});

// Assign a field to a section (display-only).
apiRouter.patch("/fields/:id/section", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try {
    const sectionId = (req.body ?? {}).sectionId ?? null;
    res.json(await setFieldSection(tenantId, req.params.id, sectionId ? String(sectionId) : null));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Records (generic record-type instances, e.g. Jobs) ----
apiRouter.get("/records", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const type = req.query.type ? String(req.query.type) : null;
  res.json(await listRecords(tenantId, type));
});

apiRouter.post("/records", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const { type, title, stageKey, subtypeKey, appointmentAt, endAt, customFields, allowOverlap, allowClosed, resourceId } = (req.body ?? {}) as any;
    res.json(await createRecord(tenantId, type ?? null, { title, stageKey, subtypeKey, appointmentAt, endAt, customFields, allowOverlap: allowOverlap === true, allowClosed: allowClosed === true, resourceId }, { source: "manual" }, actorOf(req)));
  } catch (err) {
    const code = (err as any).code;
    if (code === "overlap" || code === "closed") { res.status(409).json({ error: (err as Error).message, code }); return; }
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/records/bulk-delete", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ids = (req.body?.ids ?? []) as string[];
  try {
    const count = await softDeleteRecords(tenantId, ids, actorOf(req));
    res.json({ count });
  } catch (err) {
    const code = (err as any).code;
    if (code === "external_readonly") { res.status(403).json({ error: (err as Error).message, code }); return; }
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/records/bulk-update", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const { ids, field, value } = (req.body ?? {}) as any;
    const count = await bulkUpdateRecordField(tenantId, ids ?? [], field, value);
    res.json({ count });
  } catch (err) {
    const code = (err as any).code;
    if (code === "external_readonly") { res.status(403).json({ error: (err as Error).message, code }); return; }
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/records/dummy", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const { type } = (req.body ?? {}) as any;
    const rec = await generateDummyRecord(tenantId, type ?? null);
    res.json({ ok: true, id: rec.id });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/records/import", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const { type, rows } = (req.body ?? {}) as any;
    const result = await bulkCreateRecords(tenantId, type ?? null, rows ?? []);
    try {
      await createImportRecord({ tenantId, dataType: type || "record", name: `${type || "record"} import`, rowCount: result.imported + result.skipped, okCount: result.imported, failCount: result.skipped, createdById: req.user?.id ?? null });
    } catch { /* never fail the import on history write */ }
    audit({ tenantId, actorType: "user", actorId: req.user?.id ?? null, actorLabel: (req.user && ((req.user as any).name || (req.user as any).email)) || "Unknown user", actorRole: actorRoleOf(req), action: AUDIT_ACTIONS.IMPORT_RUN, subjectType: "import", subjectLabel: "Records import", meta: { imported: result.imported, skipped: result.skipped } });
    res.json(result);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Recycle bin (soft-deleted records) ----
// MUST be registered before "/records/:id" so "deleted" isn't read as an id.
apiRouter.get("/records/deleted", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  // Lazy purge: anything past the 30-day window is permanently removed on load.
  await purgeExpiredRecords(tenantId);
  res.json(await listDeletedRecords(tenantId));
});

apiRouter.post("/records/restore", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ids = (req.body ?? {}).ids;
  const count = await restoreRecords(tenantId, Array.isArray(ids) ? ids : [], actorOf(req));
  res.json({ ok: true, count });
});

// ---- Map data (Map view): plot records via the cached RecordGeo coordinates. MUST be
// registered before "/records/:id" so "map" isn't read as an id (like /records/deleted). ----
apiRouter.get("/records/map", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const type = req.query.type ? String(req.query.type) : null;
    if (!type) { res.status(400).json({ error: "type is required" }); return; }
    res.json(await getModuleMapData(tenantId, type));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.get("/records/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const includeDeleted = String((req.query.includeDeleted ?? "")) === "1" || String((req.query.includeDeleted ?? "")) === "true";
  try { res.json(await getRecord(tenantId, req.params.id, { includeDeleted })); }
  catch (err) { res.status(404).json({ error: (err as Error).message }); }
});

apiRouter.patch("/records/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const { title, stageKey, subtypeKey, appointmentAt, endAt, customFields, allowOverlap, allowClosed, resourceId } = (req.body ?? {}) as any;
    res.json(await updateRecord(tenantId, req.params.id, { title, stageKey, subtypeKey, appointmentAt, endAt, customFields, allowOverlap: allowOverlap === true, allowClosed: allowClosed === true, resourceId }));
  } catch (err) {
    const code = (err as any).code;
    if (code === "overlap" || code === "closed") { res.status(409).json({ error: (err as Error).message, code }); return; }
    if (code === "external_readonly") { res.status(403).json({ error: (err as Error).message, code }); return; }
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Availability (READ-ONLY) — computed open slots for a date + service.
// Look-only: returns the open slots the slot-finder computes from business hours
// minus busy times (from all calendar sources). No booking/write happens here.
apiRouter.get("/availability", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const date = String(req.query.date ?? "");
    const service = req.query.service ? String(req.query.service) : null;
    const resource = req.query.resource ? String(req.query.resource) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
      return;
    }
    res.json(await findOpenSlots(tenantId, date, service, resource));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Booking scheduling config (hours / durations / buffer). The editor reads
// the service LIST from the Booking record type (single source of truth on the
// Fields page) and only attaches a duration to each by stable key.
export async function getBookingConfigHandler(req: Request, res: Response) {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const config = await loadBookingConfig(tenantId);
    const types = await listRecordTypes(tenantId);
    const booking = (types || []).find((t: any) => t.key === "booking");
    const services = (((booking && booking.subtypes) || []) as any[])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((s) => ({ key: s.key, label: s.label }));
    // Additive: the business timezone now lives on the Bookings page. Same field
    // (tenant.timezone) and same WRITE path (PATCH /api/account/timezone) — these
    // are display-only. timezoneEditable mirrors the timezone PATCH gate
    // (aiInstructionsEditable: blocked for CLIENT_USER) so the Bookings picker can
    // render read-only for client users instead of 403-ing on save.
    const portal = await getPortal(tenantId);
    res.json({
      config,
      services,
      timezone: (portal as any)?.timezone ?? DEFAULT_TIMEZONE,
      timezoneOptions: TIMEZONE_OPTIONS,
      timezoneEditable: aiInstructionsEditable(req),
    });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
}
apiRouter.get("/booking-config", getBookingConfigHandler);

apiRouter.patch("/booking-config", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const saved = await saveBookingConfig(tenantId, req.body ?? {});
    auditEvent(req, tenantId, EVENT_TYPES.SettingChanged, { setting: "booking_hours" });
    res.json(saved);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Bookable RESOURCES (staff/stylist/technician/provider) ---------------
// Tenant-scoped, mirrors the booking-config scope guard. The configurable
// display label ("Barbers"/"Providers"/...) lives in the naming layer, not here.
apiRouter.get("/resources", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try { res.json(await listResources(tenantId)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/resources", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const { name, color, hours, durations, bufferMin } = (req.body ?? {}) as any;
    res.json(await createResource(tenantId, { name, color, hours, durations, bufferMin }));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.patch("/resources/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const { name, color, hours, durations, bufferMin, userId } = (req.body ?? {}) as any;
    // Resource <-> User link (Work Orders batch): userId present in the body
    // (including null to unlink) routes through the portal-scoped link setter;
    // everything else is the same update as before. Same audit row as any
    // resource edit (SETTINGS_SCHEDULING, matched by the /resources/ pattern).
    if (userId !== undefined) await setResourceUser(tenantId, req.params.id, userId);
    res.json(await updateResource(tenantId, req.params.id, { name, color, hours, durations, bufferMin }));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.delete("/resources/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try { res.json(await deleteResource(tenantId, req.params.id)); }
  catch (err) {
    // Block-with-count when bookings are still assigned (client shows the message).
    if ((err as any).code === "resource_in_use") { res.status(409).json({ error: (err as Error).message, code: "resource_in_use", count: (err as any).count }); return; }
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Calendar feed (READ-ONLY): bookings in [from, to) + open-hours for shading.
apiRouter.get("/bookings/calendar", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
      return;
    }
    res.json(await getCalendarData(tenantId, from, to));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Generic module calendar: lay ANY module's records on the calendar grid by its
// chosen date field. Same response shape as /bookings/calendar (so one renderer draws
// both), but with empty hours + no resources. Bookings keep /bookings/calendar above. ----
apiRouter.get("/records/calendar", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const type = String(req.query.type ?? "");
    const field = String(req.query.field ?? "");
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!type) { res.status(400).json({ error: "type is required" }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
      return;
    }
    res.json(await getModuleCalendarData(tenantId, type, field, from, to));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Record notes (Stage 2a) — internal notes on a record, shown on its page.
// Stored in the record's customFields.__activity (no migration). Tenant-scoped.
apiRouter.post("/records/:id/notes", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { text } = (req.body ?? {}) as { text?: string };
  if (!text || !String(text).trim()) { res.status(400).json({ error: "Note text is required" }); return; }
  try {
    await addRecordNote(tenantId, req.params.id, String(text).trim(), actorOf(req));
    res.json(await getRecord(tenantId, req.params.id));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ---- Record links (relationships between a parent and a record) ----
apiRouter.get("/records/:id/links", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try { res.json(await listLinksForRecord(tenantId, req.params.id)); }
  catch (err) { res.status(404).json({ error: (err as Error).message }); }
});

apiRouter.post("/records/:id/links", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const { parentType, parentId, contactId, role, stageKey } = (req.body ?? {}) as any;
    const link = await createLink(tenantId, { recordId: req.params.id, parentType: parentType || "contact", parentId: parentId || contactId, role, stageKey });
    res.json(link);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.patch("/record-links/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const { stageKey, role } = (req.body ?? {}) as any;
    res.json(await updateLink(tenantId, req.params.id, { stageKey, role }));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.delete("/record-links/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try { await softDeleteLink(tenantId, req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.get("/contacts/:id/links", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const type = req.query.type ? String(req.query.type) : null;
  res.json(await listLinksForContact(tenantId, req.params.id, type));
});

// ---- Pipeline / Funnel read model (records reporting). One row per active
// contact-in-a-policy link, with its current stage (key + label + pipeline
// order), the parent record's type/status/subtype, and the linked contact's
// fields - enough for the report engine to group/filter on all of them.
// Tenant-scoped like everything else; reads existing columns only. ----
apiRouter.get("/pipeline", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listPipelineLinks(tenantId));
});

apiRouter.get("/fields", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const recordType = req.query.recordType ? String(req.query.recordType) : null;
  res.json(await listFields(tenantId, recordType));
});

apiRouter.post("/fields", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try {
    const { label, type, required, options, formula, recordType, sectionId } = (req.body ?? {}) as any;
    res.json(await createField(tenantId, { label, type, required, options, formula, sectionId }, recordType ?? null));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.patch("/fields/reorder", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  const ids = (req.body?.orderedIds ?? []) as string[];
  const recordType = req.body?.recordType ? String(req.body.recordType) : null;
  await reorderFields(tenantId, ids, recordType);
  res.json({ ok: true });
});

apiRouter.patch("/fields/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try {
    const { label, type, required, options, formula } = (req.body ?? {}) as any;
    res.json(await updateField(tenantId, req.params.id, { label, type, required, options, formula }));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.delete("/fields/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try {
    await deleteField(tenantId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/simulate", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  try {
    const result = await runSimulatedCall(tenantId);
    res.json(result);
  } catch (err) {
    logger.error(`simulate failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---- Per-portal theme (Appearance). Branding belongs to the PORTAL: everyone
// who enters a portal sees its theme. Resolved by the tenant (via
// resolveTenantScope), never by user id. The master hub (no portal in context)
// returns a fixed default and cannot be themed. Only PORTAL_ADMIN/SUPER_ADMIN
// may save; CLIENT_USER can read but not change (enforced here, not just in UI). ----
apiRouter.get("/theme", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  // No portal in context (e.g. super-admin on the master hub): the fixed
  // default look, with presets/fonts so the picker still renders. Never a 400.
  if (!tenantId) {
    res.json({ theme: MASTER_DEFAULT_THEME, presets: PRESETS, fonts: FONTS });
    return;
  }
  res.json({ theme: await getPortalTheme(tenantId), presets: PRESETS, fonts: FONTS });
});

apiRouter.patch("/theme", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) {
    res.status(400).json({ error: "No portal selected" });
    return;
  }
  // Branding is an admin setting - same bar as the rest of portal Settings.
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Not authorized to change the portal theme" });
    return;
  }
  // sanitizeUserTheme (inside setPortalTheme) rejects anything that isn't a known
  // preset, a strict-hex + allow-listed-font custom, or a clean (length-capped,
  // escaped) name.
  const theme = await setPortalTheme(tenantId, (req.body ?? {}).theme ?? req.body);
  res.json({ theme });
});

// ---- Portal settings (PORTAL_ADMIN for own portal, SUPER_ADMIN anywhere) ----
export async function getSettingsHandler(req: Request, res: Response) {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const portal = await getPortal(tenantId);
  if (!portal) {
    res.status(404).json({ error: "Portal not found" });
    return;
  }
  // Geocoding status (Map view): a platform-wide, read-only flag from the server's
  // MAPBOX_TOKEN gate — same for every tenant, never exposes the token itself.
  res.json({ ...portal, geocoding: { enabled: geocodingEnabled() } });
}
apiRouter.get("/settings", getSettingsHandler);

apiRouter.patch("/settings", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Not authorized to change portal settings" });
    return;
  }
  const { name, notifyEmail } = (req.body ?? {}) as Record<string, any>;
  try {
    // Only name + notifyEmail are set from Business Profile now. greeting and
    // businessType are dead (not read anywhere) so they're no longer forwarded;
    // the phone number is set under Integrations (Twilio), not here. requireEmail
    // is hard-set and never accepted here.
    const updated = await updatePortal(tenantId, { name, notifyEmail });
    auditEvent(req, tenantId, EVENT_TYPES.SettingChanged, { setting: "business_info" });
    res.json({ ok: true, portal: { id: updated.id } });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Integrations tab edit paths (Twilio number + OpenAI on/off) ----
// "See" uses the existing ungated GET /api/settings (any portal user reads the
// values). "Edit" is gated to the admin tier — OWNER / SUPER_ADMIN / AUDITOR —
// per the Integrations permission matrix; PORTAL_ADMIN and CLIENT_USER are
// view-only and get a 403 here (the grayed-out UI is NOT the security boundary,
// this check is). Scoped to the Integrations tab ONLY: the existing
// PATCH /api/settings behavior is intentionally left unchanged.
function integrationsEditable(req: Request): boolean {
  return isAdminTier(req.user!.role);
}

export async function patchIntegrationsTwilio(req: Request, res: Response) {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!integrationsEditable(req)) { res.status(403).json({ error: "Not authorized to edit the Twilio number" }); return; }
  const phoneNumber = String((req.body ?? {}).phoneNumber ?? "").trim();
  try {
    await updatePortal(tenantId, { phoneNumber: phoneNumber || null });
    auditEvent(req, tenantId, EVENT_TYPES.IntegrationSettingChanged, { provider: "twilio", setting: "phone_number", value: phoneNumber ? "set" : "cleared" });
    res.json({ ok: true, phoneNumber: phoneNumber || null });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}
apiRouter.patch("/integrations/twilio", patchIntegrationsTwilio);

export async function patchIntegrationsOpenai(req: Request, res: Response) {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!integrationsEditable(req)) { res.status(403).json({ error: "Not authorized to change the AI receptionist" }); return; }
  const enabled = (req.body ?? {}).enabled === true;
  try {
    // Mirror the existing admin toggle (receptionistEnabled <-> voiceMode), but
    // PRESERVE an already-chosen voice mode (e.g. SMOOTH/premium) when turning
    // back on — only bump OFF up to the basic WALKIE mode so the line answers.
    const current = await getPortal(tenantId);
    const curMode = (current as any)?.voiceMode || "OFF";
    const voiceMode = enabled ? (curMode === "OFF" ? "WALKIE" : curMode) : "OFF";
    await updatePortal(tenantId, { receptionistEnabled: enabled, voiceMode });
    auditEvent(req, tenantId, EVENT_TYPES.IntegrationSettingChanged, { provider: "openai", setting: "receptionist_enabled", value: enabled });
    res.json({ ok: true, enabled });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}
apiRouter.patch("/integrations/openai", patchIntegrationsOpenai);

// ---- Users within the current portal (PORTAL_ADMIN manages their own) ----
apiRouter.get("/users", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  // Proof-wiring of the permission resolver (Batch 1). For every system role this is
  // identical to the old `role === "CLIENT_USER"` 403 (CLIENT_USER lacks users.view;
  // PORTAL_ADMIN/owner/super-admin/auditor have it). Custom roles flow through can().
  if (!(await can(req.user!, "users", "view"))) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  const users = (await listUsers(tenantId)) as any[];
  // Surface pending (invited, not-yet-accepted) teammates immediately, marked
  // "Pending"; they flip to normal users automatically once they accept.
  const pending = await listPendingInvitesAsUsers(tenantId);
  res.json([...pending, ...users]);
});

// Revoke a pending invite for this portal.
apiRouter.post("/invites/:inviteId/revoke", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  const ok = await revokeInvite(tenantId, req.params.inviteId);
  if (!ok) { res.status(404).json({ error: "Invite not found" }); return; }
  res.json({ ok: true });
});

apiRouter.post("/users", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  // Proof-wiring (Batch 1): identical to the old CLIENT_USER 403 for all system roles.
  if (!(await can(req.user!, "users", "edit"))) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  const { email, role, name, customHtml, customSubject } = (req.body ?? {}) as Record<string, string>;
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  // If the inviter wrote a custom email, it MUST contain the apply-link token —
  // checked BEFORE we mint anything so a missing-link request creates no invite.
  const isCustom = typeof customHtml === "string" && customHtml.trim().length > 0;
  if (isCustom && !hasInviteLinkToken(customHtml)) {
    res.status(400).json({ error: "Your email doesn't include the invite link — add it before sending." });
    return;
  }
  // role can be a system role (PORTAL_ADMIN/CLIENT_USER) or a per-portal custom role
  // id. A custom role invites at base CLIENT_USER + customRoleId (so deletion falls
  // them back to the restricted default). Admin tiers are never invitable here.
  let safeRole: "PORTAL_ADMIN" | "CLIENT_USER" = role === "PORTAL_ADMIN" ? "PORTAL_ADMIN" : "CLIENT_USER";
  let inviteCustomRoleId: string | null = null;
  if (role && role !== "PORTAL_ADMIN" && role !== "CLIENT_USER") {
    const cr = await getPortalRole(role, tenantId);
    if (cr) { safeRole = "CLIENT_USER"; inviteCustomRoleId = (cr as any).id; }
  }
  try {
    const invite = await createInvite({ email, role: safeRole, tenantId, name: name || null, createdById: req.user?.id ?? null, customRoleId: inviteCustomRoleId });
    auditEvent(req, tenantId, EVENT_TYPES.UserInvited, { email, role: inviteCustomRoleId ? "custom" : safeRole });
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.get("host") || "").trim();
    const link = inviteLink(proto + "://" + host, invite.token);
    const emailed = isCustom
      ? await sendCustomInvite({ email: invite.email, role: invite.role }, link, customHtml, customSubject, { sentById: req.user?.id ?? null, tenantId })
      : await sendInvite({ email: invite.email, role: invite.role }, link, { sentById: req.user?.id ?? null, tenantId });
    res.json({ invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }, link, emailed });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.delete("/users/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  if (req.params.id === req.user?.id) {
    res.status(400).json({ error: "You can't delete your own account" });
    return;
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target || target.tenantId !== tenantId) {
    res.status(404).json({ error: "User not found in this portal" });
    return;
  }
  try {
    await deleteUser(req.params.id, { id: req.user!.id, role: req.user!.role, name: req.user!.name ?? null });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Change an existing member's role (system or custom) — the Batch 5 assignment path.
// Cap #2 + tier clamping live in assignUserRole. users.edit gated.
apiRouter.patch("/users/:id/role", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!(await can(req.user!, "users", "edit"))) { res.status(403).json({ error: "Not authorized" }); return; }
  const { role } = (req.body ?? {}) as { role?: string };
  if (!role) { res.status(400).json({ error: "role is required" }); return; }
  try {
    const updated = await assignUserRole(req.params.id, tenantId, { id: req.user!.id, role: req.user!.role }, role);
    res.json({ ok: true, ...updated });
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});

// ---- Custom roles for the Permissions UI (Batch 4). Read needs users.view, writes
// need users.edit — i.e. owner/super-admin/auditor/portal-admin (matches Team).
// Server-enforced, not just UI-hidden; CLIENT_USER is blocked. Tenant-scoped.
apiRouter.get("/portal-roles", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!(await can(req.user!, "users", "view"))) { res.status(403).json({ error: "Not authorized" }); return; }
  const customRoles = await listPortalRoles(tenantId);
  // How many users are assigned to each custom role (so the UI can warn before delete).
  const counts: any[] = await (prisma as any).user.groupBy({ by: ["customRoleId"], where: { tenantId, customRoleId: { not: null } }, _count: { _all: true } }).catch(() => []);
  const countMap = new Map<string, number>();
  counts.forEach((c) => { if (c.customRoleId) countMap.set(c.customRoleId, c._count?._all ?? 0); });
  const customWithCounts = customRoles.map((r: any) => ({ ...r, assignedCount: countMap.get(r.id) || 0 }));
  const systemRoles = SYSTEM_ROLES.filter((s) => PER_PORTAL_SYSTEM_ROLES.includes(s.role)).map((s) => ({ role: s.role, label: s.label, ceiling: !!s.ceiling, permissions: permissionMatrixForRole(s.role) }));
  const myPermissions = await effectiveMatrix(req.user as any); // the creator's own level (the grant ceiling)
  res.json({ catalog: getPermissionCatalog(), sections: AREA_SECTIONS, systemRoles, customRoles: customWithCounts, myPermissions });
});

apiRouter.post("/portal-roles", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!(await can(req.user!, "users", "edit"))) { res.status(403).json({ error: "Not authorized" }); return; }
  const { name, permissions } = (req.body ?? {}) as { name?: string; permissions?: any };
  try {
    const ceiling = await effectiveMatrix(req.user as any);
    const role = await createPortalRole(tenantId, name || "", permissions || {}, ceiling);
    res.json(role);
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});

apiRouter.patch("/portal-roles/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!(await can(req.user!, "users", "edit"))) { res.status(403).json({ error: "Not authorized" }); return; }
  const existing = await getPortalRole(req.params.id, tenantId);
  if (!existing) { res.status(404).json({ error: "Role not found in this portal" }); return; }
  const { name, permissions } = (req.body ?? {}) as { name?: string; permissions?: any };
  try {
    const ceiling = await effectiveMatrix(req.user as any);
    const role = await updatePortalRole(req.params.id, tenantId, name || "", permissions || {}, ceiling);
    res.json(role);
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});

apiRouter.delete("/portal-roles/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!(await can(req.user!, "users", "edit"))) { res.status(403).json({ error: "Not authorized" }); return; }
  const r = await deletePortalRoleAndUnassign(req.params.id, tenantId);
  if (!r.deleted) { res.status(404).json({ error: "Role not found in this portal" }); return; }
  res.json({ ok: true, unassigned: r.unassigned });
});

// ---- Saved filters (shared across the portal's users) ----
apiRouter.get("/saved-filters", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const view = (req.query.view as string | undefined) || "contacts";
  res.json(await listSavedFilters(tenantId, view));
});

apiRouter.post("/saved-filters", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, view, definition } = (req.body ?? {}) as { name?: string; view?: string; definition?: unknown };
  if (!name || !name.trim()) {
    res.status(400).json({ error: "A name is required" });
    return;
  }
  const created = await createSavedFilter({ tenantId, name, view, definition, createdById: req.user!.id });
  res.json({ id: created.id, name: created.name, view: created.view, definition: created.definition ?? {} });
});

apiRouter.delete("/saved-filters/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ok = await deleteSavedFilter(req.params.id, tenantId);
  if (!ok) {
    res.status(404).json({ error: "Filter not found" });
    return;
  }  res.json({ ok: true });
});

// ---- Audiences (named, DYNAMIC contact filters; reuse SavedFilter view="audience") ----
// Gated to the communication area (view/create/edit/delete) by PERM_RULES, consistent with
// Templates/Surveys. Definitions store the same {rules, search} contacts-filter shape.
apiRouter.get("/audiences", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listAudiences(tenantId));
});

apiRouter.post("/audiences", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, definition } = (req.body ?? {}) as { name?: string; definition?: unknown };
  if (!name || !name.trim()) { res.status(400).json({ error: "An audience name is required" }); return; }
  res.json(await createAudience({ tenantId, name, definition: definition ?? {}, createdById: req.user!.id }));
});

apiRouter.patch("/audiences/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, definition } = (req.body ?? {}) as { name?: string; definition?: unknown };
  const patch: { name?: string; definition?: unknown } = {};
  if (typeof name === "string") patch.name = name;
  if ("definition" in (req.body ?? {})) patch.definition = definition ?? {};
  const ok = await updateAudience(req.params.id, tenantId, patch);
  if (!ok) { res.status(404).json({ error: "Audience not found" }); return; }
  res.json(await getAudience(req.params.id, tenantId));
});

apiRouter.delete("/audiences/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ok = await deleteAudience(req.params.id, tenantId);
  if (!ok) { res.status(404).json({ error: "Audience not found" }); return; }
  res.json({ ok: true });
});

// Current matching contacts for an audience (dynamic). Used by A2/Drips + the library count.
apiRouter.get("/audiences/:id/contacts", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const rows = await resolveAudienceContacts(tenantId, req.params.id);
  if (rows === null) { res.status(404).json({ error: "Audience not found" }); return; }
  res.json({ count: rows.length, contacts: rows });
});

// ---- Drips (visual builder, slice 1) — CRUD + graph save/restore. Gated to the communication
// area (view/create/edit/delete) by PERM_RULES, consistent with Templates/Surveys/Audiences.
apiRouter.get("/drips", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listDrips(tenantId));
});

apiRouter.post("/drips", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, graph } = (req.body ?? {}) as { name?: string; graph?: unknown };
  if (!name || !name.trim()) { res.status(400).json({ error: "A drip name is required" }); return; }
  res.json(await createDrip({ tenantId, name, graph, createdById: req.user!.id }));
});

apiRouter.get("/drips/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const d = await getDrip(req.params.id, tenantId);
  if (!d) { res.status(404).json({ error: "Drip not found" }); return; }
  res.json(d);
});

apiRouter.patch("/drips/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const body = (req.body ?? {}) as { name?: string; graph?: unknown; status?: string };
  const patch: { name?: string; graph?: unknown; status?: string } = {};
  if (typeof body.name === "string") patch.name = body.name;
  if ("graph" in body) patch.graph = body.graph;
  if (typeof body.status === "string") patch.status = body.status;
  const result = await updateDrip(req.params.id, tenantId, patch, req.user!.id);
  if (!result) { res.status(404).json({ error: "Drip not found" }); return; }
  res.json({ ...result.drip, warning: result.warning });
});

// Validate (compile check) without changing state — used to gate the Enable button + show errors.
apiRouter.post("/drips/:id/validate", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const result = await validateDrip(req.params.id, tenantId);
  if (result === null) { res.status(404).json({ error: "Drip not found" }); return; }
  res.json({ ok: result.ok, errors: result.errors });
});

// Activate: compile (must be valid) + enable the linked automation so it runs via the engine.
apiRouter.post("/drips/:id/activate", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const r = await setDripEnabled(req.params.id, tenantId, true, req.user!.id);
  if (r === null) { res.status(404).json({ error: "Drip not found" }); return; }
  if (!r.ok) { res.status(400).json({ error: "This drip has errors and can't be turned on.", errors: r.errors }); return; }
  res.json(r.drip);
});

apiRouter.post("/drips/:id/deactivate", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const r = await setDripEnabled(req.params.id, tenantId, false, req.user!.id);
  if (r === null) { res.status(404).json({ error: "Drip not found" }); return; }
  res.json(r.drip);
});

apiRouter.delete("/drips/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ok = await deleteDrip(req.params.id, tenantId);
  if (!ok) { res.status(404).json({ error: "Drip not found" }); return; }
  res.json({ ok: true });
});
apiRouter.get("/exports", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  // Per-page history is type-scoped: callers pass kind ("export"/"import") and the
  // page's dataType so each page sees only its own entries. No params = everything.
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const dataType = typeof req.query.dataType === "string" ? req.query.dataType : undefined;
  res.json(await listExports(tenantId, { kind, dataType }));
});

apiRouter.post("/exports", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, rowCount, fields, csv, dataType } = (req.body ?? {}) as { name?: string; rowCount?: number; fields?: unknown; csv?: string; dataType?: string };
  if (!name || !name.trim()) {
    res.status(400).json({ error: "An export name is required" });
    return;
  }
  if (typeof csv !== "string") {
    res.status(400).json({ error: "Nothing to export" });
    return;
  }
  const rec = await createExport({ tenantId, name, rowCount: rowCount || 0, fields, csv, dataType: dataType || null, createdById: req.user!.id });
  res.json(rec);
});

// Log that a full Data Backup happened. The backup file is assembled + downloaded
// CLIENT-side; this only records that it occurred (no file stored, no download).
apiRouter.post("/backups", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, rowCount } = (req.body ?? {}) as { name?: string; rowCount?: number };
  const rec = await createBackupRecord({ tenantId, name: (name && name.trim()) || "Data backup", rowCount: rowCount || 0, createdById: req.user!.id });
  res.json(rec);
});

apiRouter.get("/exports/:id/download", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  // Format-aware: plain exports return CSV text; report runs may return xlsx/zip
  // (base64 + ext + mime) so the client rebuilds the exact emailed file.
  const result = await getExportArtifact(req.params.id, tenantId);
  if (!result) {
    res.status(404).json({ error: "Export not found" });
    return;
  }
  res.json(result);
});

// ---- Scheduled Reports (Data Administration → Reports) ----
// Every saved report for this portal (active AND inactive), each joined with its
// latest ExportRecord run for the Rows + Download columns. Gated to settings_data
// (manage) by permissionGate — the same tier that sees Data Administration / exports.
// The Download button reuses GET /exports/:id/download with the run's exportRecordId.
apiRouter.get("/reports", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listReports(tenantId));
});

// Full saved report (definition + recipients + format) for the form's
// "Start from a saved report" prefill.
apiRouter.get("/reports/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const r = await getScheduledReport(tenantId, req.params.id);
  if (!r) { res.status(404).json({ error: "Report not found" }); return; }
  res.json(r);
});

// "Send now": save/update the report, then run it server-side, email it to all
// recipients, and log the run. Same role gate as exports (settings_data/manage).
apiRouter.post("/reports/run", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const body = (req.body || {}) as any;
  const name = String(body.name || "").trim();
  const format = body.format === "xlsx" ? "xlsx" : "csv";
  const definition = (body.definition && typeof body.definition === "object") ? body.definition : { types: {} };
  const recipients = Array.isArray(body.recipients)
    ? body.recipients.map((e: any) => String(e).trim()).filter(Boolean)
    : [];
  const emailBody = typeof body.emailBody === "string" ? body.emailBody : null;

  if (!name) { res.status(400).json({ error: "Report name is required." }); return; }
  const types = definition.types || {};
  const includedCount = Object.keys(types).filter((k) => Array.isArray(types[k]?.fields) && types[k].fields.length).length;
  if (!includedCount) { res.status(400).json({ error: "Select at least one field to include." }); return; }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!recipients.length || !recipients.every((e: string) => emailRe.test(e))) {
    res.status(400).json({ error: "Enter one or more valid recipient email addresses." });
    return;
  }

  const saved = await upsertScheduledReport({ tenantId, id: body.id || null, name, format, definition, recipients, emailBody, createdById: req.user!.id });
  try {
    const run = await runAndDeliverReport({ tenantId, reportId: saved.id, name, format, definition, recipients, emailBody, createdById: req.user!.id });
    res.json({ ok: true, reportId: saved.id, ...run });
  } catch (e) {
    res.status(500).json({ error: "Report run failed: " + (e as Error).message });
  }
});

// Save a report on a recurring SCHEDULE (does NOT run now). Stores mode:"recurring"
// + the cadence and computes the first nextRunAt in the portal's timezone. The
// 2-minute heartbeat then delivers it on cadence via the same executor "Send now" uses.
apiRouter.post("/reports/save", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const body = (req.body || {}) as any;
  const name = String(body.name || "").trim();
  const format = body.format === "xlsx" ? "xlsx" : "csv";
  const definition = (body.definition && typeof body.definition === "object") ? body.definition : { types: {} };
  const recipients = Array.isArray(body.recipients) ? body.recipients.map((e: any) => String(e).trim()).filter(Boolean) : [];
  const emailBody = typeof body.emailBody === "string" ? body.emailBody : null;

  if (!name) { res.status(400).json({ error: "Report name is required." }); return; }
  const types = definition.types || {};
  const includedCount = Object.keys(types).filter((k) => Array.isArray(types[k]?.fields) && types[k].fields.length).length;
  if (!includedCount) { res.status(400).json({ error: "Select at least one field to include." }); return; }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!recipients.length || !recipients.every((e: string) => emailRe.test(e))) {
    res.status(400).json({ error: "Enter one or more valid recipient email addresses." });
    return;
  }
  const v = validateCadence(body.cadence);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }

  const portal = await getPortal(tenantId);
  const zone = (portal as any)?.timezone || "America/New_York";
  // Stamp the phase anchor (week 1 = the week this schedule is saved, portal-local).
  const cadence = { ...v.cadence, anchorWeekStart: currentAnchorWeekStart(zone) };
  const nextRunAt = computeNextRunAt(cadence, new Date(), zone);
  if (!nextRunAt) { res.status(400).json({ error: "This schedule never lands on a valid time — check the days and times." }); return; }

  const saved = await upsertScheduledReport({ tenantId, id: body.id || null, name, format, definition, recipients, emailBody, mode: "recurring", cadence, nextRunAt, createdById: req.user!.id });
  res.json({ ok: true, reportId: saved.id, nextRunAt: nextRunAt.toISOString(), summary: describeCadence(cadence, zone) });
});

// Toggle a report's Active state (the list's Active/Inactive control). Reactivating
// a recurring report resumes it at the next future slot (no missed-run backlog).
apiRouter.patch("/reports/:id/active", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const active = (req.body || {}).active !== false;
  const updated = await setReportActive(tenantId, req.params.id, active);
  if (!updated) { res.status(404).json({ error: "Report not found" }); return; }
  res.json(updated);
});

// ---- Automations (event-driven workflows) ----
apiRouter.get("/automations", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const list: any[] = await listAutomations(tenantId);
  // Label automations generated by a drip with their source drip's name (for the badge + jump link).
  const dripIds = Array.from(new Set(list.map((a: any) => a.dripId).filter(Boolean)));
  if (dripIds.length) {
    const drips = await (prisma as any).drip.findMany({ where: { tenantId, id: { in: dripIds as string[] } }, select: { id: true, name: true } });
    const nameById = new Map(drips.map((d: any) => [d.id, d.name]));
    list.forEach((a: any) => { if (a.dripId && nameById.has(a.dripId)) a.dripName = nameById.get(a.dripId); });
  }
  res.json(list);
});

// Builder metadata: triggers, action types, condition fields, tag fields,
// templates and users for action config dropdowns.
apiRouter.get("/automations/meta", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const custom = await loadFieldDefs(tenantId);
  const fields = conditionFields(custom);
  const tagFields = custom.filter((f) => f.type === "multi_select");
  const templates = await listTemplates(tenantId);
  const users = await prisma.user.findMany({ where: { tenantId }, select: { id: true, name: true, email: true } });
  // Distinct relationship (pipeline) stages across this portal's record types,
  // for the optional "Stage changed → to <stage>" picker. Gathered from each
  // record type's own stages and each subtype's pipeline, deduped by stage key.
  // Generic on purpose (no record-type/"job" wording) so portals can relabel.
  const recordTypes = await listRecordTypes(tenantId);
  const stageMap = new Map<string, string>();
  for (const rt of recordTypes as any[]) {
    for (const s of (rt.stages || [])) if (s && s.key) stageMap.set(String(s.key), String(s.label ?? s.key));
    for (const st of (rt.subtypes || [])) for (const s of (st.stages || [])) if (s && s.key) stageMap.set(String(s.key), String(s.label ?? s.key));
  }
  const stages = Array.from(stageMap, ([key, label]) => ({ key, label }));
  // For the "Record updated / status changed" trigger: the fields a record
  // automation can scope to (Status + Title + record custom fields), and the
  // distinct Status values (record-level lifecycle stages) for value scoping.
  // Generic; never references "job".
  const recordTypeIds = (recordTypes as any[]).filter((rt) => rt.key !== "contact").map((rt) => rt.id);
  const recFieldDefs = recordTypeIds.length
    ? await prisma.fieldDef.findMany({ where: { tenantId, recordTypeId: { in: recordTypeIds } }, orderBy: { order: "asc" } })
    : [];
  const recFieldMap = new Map<string, string>();
  recFieldMap.set("status", "Status");
  recFieldMap.set("title", "Title");
  for (const d of recFieldDefs as any[]) if (d.key && !d.key.startsWith("__")) recFieldMap.set(String(d.key), String(d.label ?? d.key));
  const recordFields = Array.from(recFieldMap, ([key, label]) => ({ key, label }));
  const statusMap = new Map<string, string>();
  for (const rt of recordTypes as any[]) for (const s of (rt.recordStages || [])) if (s && s.key) statusMap.set(String(s.key), String(s.label ?? s.key));
  const recordStatuses = Array.from(statusMap, ([key, label]) => ({ key, label }));
  // Record CONDITION fields (with types) so the builder can offer a record
  // automation's OWN fields in the condition picker ("...only if Status = Open").
  // System fields are text; createdAt is a date; custom fields use their type.
  const recCondMap = new Map<string, { label: string; type: string }>();
  recCondMap.set("status", { label: "Status", type: "text" });
  recCondMap.set("title", { label: "Title", type: "text" });
  recCondMap.set("subtypeKey", { label: "Type", type: "text" });
  recCondMap.set("createdAt", { label: "Time created", type: "date" });
  // Booking columns (real Record columns; empty for non-booking types). "resource"
  // resolves to the staff name at evaluation time. appointmentAt is a date field —
  // see recordRow/evalRule for the wall-clock-safe comparison.
  recCondMap.set("appointmentAt", { label: "Appointment date/time", type: "date" });
  recCondMap.set("resource", { label: "Staff", type: "text" });
  for (const d of recFieldDefs as any[]) if (d.key && !String(d.key).startsWith("__")) recCondMap.set(String(d.key), { label: String(d.label ?? d.key), type: String(d.type || "text") });
  const recordConditionFields = Array.from(recCondMap, ([key, v]) => ({ key, label: v.label, type: v.type }));
  // Record TYPES (key + label + their statuses/subtypes) so the new record-acting
  // actions' config UIs can offer real pickers. Excludes the internal "contact"
  // type. Additive/display-only; no new data.
  const recordTypeOptions = (recordTypes as any[])
    .filter((rt) => rt.key !== "contact")
    .map((rt) => ({
      key: rt.key,
      label: rt.label || rt.key,
      statuses: ((rt.recordStages as any[]) || []).filter((s) => s && s.key).map((s) => ({ key: s.key, label: s.label ?? s.key })),
      subtypes: ((rt.subtypes as any[]) || []).filter((s) => s && s.key).map((s) => ({ key: s.key, label: s.label ?? s.key })),
    }));
  res.json({
    triggers: TRIGGERABLE_EVENT_TYPES,
    actions: ACTION_TYPES,
    fields,
    tagFields,
    stages,
    recordFields,
    recordConditionFields,
    recordStatuses,
    recordTypes: recordTypeOptions,
    templates: templates.map((t: any) => ({ id: t.id, name: t.name, kind: t.kind })),
    users: users.map((u: any) => ({ id: u.id, name: u.name || u.email })),
    // Audiences (for the "Enroll an audience" trigger + the "contact is in Audience X" condition)
    // and surveys (for the Send survey action) — so the wizard can offer these without extra calls.
    audiences: (await listAudiences(tenantId)).map((a: any) => ({ id: a.id, name: a.name })),
    surveys: (await listSurveys(tenantId)).map((s: any) => ({ id: s.id, name: s.name })),
  });
});

// ---- Automation presets (built-in flow templates) -------------------------
// These static paths are defined before any "/automations/:id" route so they
// are never mistaken for an automation id.

// List the built-in presets, each enriched with a per-portal field analysis so
// the library can preview which custom fields a preset expects and flag any
// that don't exist in this portal. Read-only: applies nothing.
apiRouter.get("/automations/presets", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const presets = [];
  for (const p of AUTOMATION_PRESETS) {
    if ((p as any).hidden) continue; // retired/wrong-vertical templates stay in code but off the UI
    const analysis = await analyzeFlowDefinition(tenantId, p.definition);
    // Does this preset include any texting step? (send_sms, or notify_business /
    // act_on_linked configured for SMS.) Used to surface a "text step hidden" note
    // while SMS_ENABLED is off — the preset itself is never modified.
    const acts: any[] = Array.isArray((p.definition as any).actions) ? (p.definition as any).actions : [];
    const hasSms = acts.some((a) =>
      a && (a.type === "send_sms"
        || (a.type === "notify_business" && (a.config?.channel === "sms" || a.config?.channel === "both"))
        || (a.type === "act_on_linked" && a.config?.subAction === "sms")));
    presets.push({
      key: p.key,
      name: p.name,
      description: p.description,
      category: p.category, // function-based grouping (shown in UI)
      // NOTE: p.vertical is intentionally NOT included — it's an internal-only
      // tag and must never reach the user-facing library.
      summary: p.summary,
      shape: p.shape,
      note: p.note ?? null,
      expected: analysis.expected,
      missing: analysis.missing,
      hasSms,
    });
  }
  res.json({ categories: PRESET_CATEGORIES, presets, smsEnabled: smsEnabled() });
});

// Apply one preset -> a NEW DRAFT (inactive) automation in the CURRENT portal,
// via the shared applyFlowDefinition() plumbing (the same the wizard will use).
// Never activates anything; returns the created draft + missing-field flags so
// the UI can open it in the builder and mark what needs attention.
apiRouter.post("/automations/presets/apply", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { key } = (req.body ?? {}) as { key?: string };
  const preset = getPreset(String(key || ""));
  if (!preset) {
    res.status(404).json({ error: "Unknown preset" });
    return;
  }
  try {
    const result = await applyFlowDefinition(tenantId, preset.definition, req.user!.id);
    res.json({
      automation: result.automation,
      expected: result.analysis.expected,
      missing: result.analysis.missing,
      nameChanged: result.nameChanged,
      requestedName: result.requestedName,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Apply an ASSEMBLED flow definition (from the branching wizard) -> a NEW DRAFT
// (inactive) automation in the CURRENT portal. This is a thin pass-through to
// the SAME applyFlowDefinition() the presets use — it does NOT reimplement the
// apply step; it just lets the wizard hand over a definition it built from the
// user's selections. Like everything else here, it never activates anything.
apiRouter.post("/automations/apply-flow", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { definition } = (req.body ?? {}) as { definition?: any };
  if (!definition || typeof definition !== "object" || typeof definition.triggerType !== "string" || !definition.triggerType) {
    res.status(400).json({ error: "A flow definition with a triggerType is required" });
    return;
  }
  const def = {
    name: typeof definition.name === "string" ? definition.name : "Wizard automation",
    triggerType: definition.triggerType,
    conditions: Array.isArray(definition.conditions) ? definition.conditions : [],
    actions: Array.isArray(definition.actions) ? definition.actions : [],
  };
  // Optional grouping token for a branching wizard pair. Ignored unless it's a
  // non-empty string; never affects execution.
  const pairId = typeof definition.pairId === "string" && definition.pairId ? definition.pairId : undefined;
  try {
    const result = await applyFlowDefinition(tenantId, def, req.user!.id, { pairId });
    res.json({
      automation: result.automation,
      expected: result.analysis.expected,
      missing: result.analysis.missing,
      nameChanged: result.nameChanged,
      requestedName: result.requestedName,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Enabled Manual-trigger flows for the current tenant (for the record's "Run
// automation" button). Defined before any "/automations/:id" route so it is not
// mistaken for an id.
apiRouter.get("/automations/manual", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listManualAutomations(tenantId));
});

// ---- Scheduled jobs (delays + date-relative schedules) ----
// List this tenant's job queue (pending/done/failed/canceled).
apiRouter.get("/automations/jobs", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listScheduledJobs(tenantId));
});

// Manual processor (super-admin only). Runs the daily sweep + executes due jobs
// for the current portal's tenant. This is the stand-in for the deployed host's
// automatic heartbeat; the same processDueJobs() is what a cron will call later.
apiRouter.post("/automations/jobs/process", async (req: Request, res: Response) => {
  if (!isAdminTier(req.user!.role)) { res.status(403).json({ error: "Super-admin only" }); return; }
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await processDueJobs(tenantId));
});

// Cancel a pending job before it runs.
apiRouter.post("/automations/jobs/:id/cancel", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ok = await cancelScheduledJob(req.params.id, tenantId);
  if (!ok) { res.status(400).json({ error: "Job not found or no longer pending" }); return; }
  res.json({ ok: true });
});

// Fire one sample webhook to a URL (the "Send test" button). Tenant-scoped:
// uses this tenant's field shape for the sample payload, runs the same SSRF
// check as the real action, and never echoes the secret header back.
apiRouter.post("/automations/webhook-test", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { url, headerName, headerValue } = (req.body ?? {}) as { url?: string; headerName?: string; headerValue?: string };
  const check = await validateWebhookUrl(String(url || ""));
  if (!check.ok) { res.json({ ok: false, blocked: true, reason: check.reason }); return; }
  const fieldDefs = await loadFieldDefs(tenantId);
  const payload = buildSamplePayload(tenantId, fieldDefs);
  const r = await sendWebhook({ url: String(url), headerName, headerValue, payload });
  if (r.outcome === "blocked") { res.json({ ok: false, blocked: true, reason: r.reason }); return; }
  res.json({ ok: r.outcome === "sent" && !!r.ok, outcome: r.outcome, status: r.status ?? null, host: check.host, warnHttp: !!check.warnHttp });
});

// ---- Inbound webhook endpoints (admin only; tenant-scoped) ----------------
function inboundAdminOnly(req: Request, res: Response): boolean {
  if (req.user!.role === "CLIENT_USER") { res.status(403).json({ error: "Only admins can manage inbound webhooks" }); return false; }
  return true;
}

apiRouter.get("/inbound", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res); if (!tenantId) return;
  if (!inboundAdminOnly(req, res)) return;
  res.json(await listEndpoints(tenantId));
});

apiRouter.post("/inbound", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res); if (!tenantId) return;
  if (!inboundAdminOnly(req, res)) return;
  try {
    const { name, mapping } = (req.body ?? {}) as { name?: string; mapping?: Record<string, string> };
    res.json(await createEndpoint(tenantId, { name, mapping, createdById: req.user!.id }));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.patch("/inbound/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res); if (!tenantId) return;
  if (!inboundAdminOnly(req, res)) return;
  try {
    const { name, mapping, enabled } = (req.body ?? {}) as any;
    res.json(await updateEndpoint(tenantId, req.params.id, { name, mapping, enabled }));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.post("/inbound/:id/regenerate", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res); if (!tenantId) return;
  if (!inboundAdminOnly(req, res)) return;
  try { res.json(await regenerateToken(tenantId, req.params.id)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.delete("/inbound/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res); if (!tenantId) return;
  if (!inboundAdminOnly(req, res)) return;
  try { res.json(await deleteEndpoint(tenantId, req.params.id)); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

apiRouter.get("/inbound/:id/calls", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res); if (!tenantId) return;
  if (!inboundAdminOnly(req, res)) return;
  res.json(await listInboundCalls(tenantId, req.params.id, Number(req.query.limit) || 50));
});

apiRouter.get("/automations/runs", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const automationId = (req.query.automationId as string | undefined) || undefined;
  res.json(await listRuns(tenantId, { automationId, limit: Number(req.query.limit) || 100 }));
});

apiRouter.get("/automations/events", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const type = (req.query.type as string | undefined) || undefined;
  res.json(await listEvents(tenantId, { type, limit: Number(req.query.limit) || 100 }));
});

apiRouter.post("/automations", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, triggerType, conditions, actions, enabled } = (req.body ?? {}) as any;
  res.json(await createAutomation(tenantId, { name, triggerType, conditions, actions, enabled }, req.user!.id));
});

apiRouter.patch("/automations/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, triggerType, conditions, actions, enabled } = (req.body ?? {}) as any;
  // Drip-generated automations are managed by their Drip (the source of truth). Block structural
  // edits here so a recompile can't silently overwrite them; only the on/off toggle is allowed
  // (and even that is best done from the drip). Editing content must happen in the Drip editor.
  const current = await (prisma as any).automation.findFirst({ where: { id: req.params.id, tenantId }, select: { dripId: true } });
  if (current?.dripId) {
    const structural = name !== undefined || triggerType !== undefined || conditions !== undefined || actions !== undefined;
    if (structural) { res.status(409).json({ error: "This automation is managed by a drip. Open the drip to edit it.", dripId: current.dripId, managedByDrip: true }); return; }
  }
  try {
    res.json(await updateAutomation(req.params.id, tenantId, { name, triggerType, conditions, actions, enabled }));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.delete("/automations/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ok = await deleteAutomation(req.params.id, tenantId);
  if (!ok) { res.status(404).json({ error: "Automation not found" }); return; }
  res.json({ ok: true });
});

apiRouter.post("/automations/:id/enroll", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const auto = await prisma.automation.findFirst({ where: { id: req.params.id, tenantId } });
  if (!auto) { res.status(404).json({ error: "Automation not found" }); return; }
  // Audience id: prefer the request body, else parse it from an "EnrollAudience:<id>" triggerType.
  let audienceId = typeof (req.body ?? {}).audienceId === "string" ? (req.body as any).audienceId : "";
  if (!audienceId && auto.triggerType.startsWith("EnrollAudience:")) audienceId = auto.triggerType.slice("EnrollAudience:".length);
  if (!audienceId) { res.status(400).json({ error: "Pick an audience to enroll." }); return; }
  try {
    const result = await enrollAudienceInAutomation(req.params.id, audienceId, tenantId);
    res.json(result); // { enrolled, contactIds, skipped }
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/automations/:id/test", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { contactId } = (req.body ?? {}) as { contactId?: string };
  if (!contactId) { res.status(400).json({ error: "A contactId is required" }); return; }
  try {
    const run = await testRunAutomation(req.params.id, contactId, tenantId);
    res.json(run);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Run a Manual-trigger flow on demand from a record. Tenant-scoped via
// tenantOr400; the engine additionally verifies the flow + contact belong to it
// and that the flow's trigger is "Manual" and enabled.
apiRouter.post("/automations/:id/run", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { contactId } = (req.body ?? {}) as { contactId?: string };
  if (!contactId) { res.status(400).json({ error: "A contactId is required" }); return; }
  try {
    const run = await runManualAutomation(req.params.id, contactId, tenantId);
    res.json(run);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Change own password ----
apiRouter.post("/account/password", async (req: Request, res: Response) => {
  const { password } = (req.body ?? {}) as { password?: string };
  const pw = checkPassword(String(password ?? ""), { email: req.user?.email });
  if (!pw.ok) {
    res.status(400).json({ error: pw.message });
    return;
  }
  await setPassword(req.user!.id, password!);
  res.json({ ok: true });
});

// ---- Feedback (per-portal / tenant-facing) ---------------------------------
// Visibility + permissions are enforced inside feedbackService (scope "portal").
// Submitting is limited to portal users (PORTAL_ADMIN / CLIENT_USER); OWNER and
// SUPER_ADMIN browsing a portal can view all of its tickets, reply, resolve,
// restore. A portal user only ever sees their own tickets and can never reach
// master-hub tickets.
function feedbackCtxPortal(req: Request): { scope: "portal"; tenantId: string | null; actor: typeof req.user } {
  return { scope: "portal", tenantId: resolveTenantScope(req), actor: req.user! };
}

apiRouter.get("/feedback", async (req: Request, res: Response) => {
  const ctx = feedbackCtxPortal(req);
  if (!ctx.tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  res.json(await listFeedback(ctx as any));
});

apiRouter.post("/feedback", async (req: Request, res: Response) => {
  const ctx = feedbackCtxPortal(req);
  if (!ctx.tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  const role = req.user!.role;
  if (role !== "PORTAL_ADMIN" && role !== "CLIENT_USER") {
    res.status(403).json({ error: "Only portal users can submit feedback here." });
    return;
  }
  const { problem, description, attachments } = (req.body ?? {}) as { problem?: string; description?: string; attachments?: unknown };
  try {
    res.json(await createFeedbackTicket(ctx as any, { problem: problem || "", description: description || "", attachments }));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

// Export reflects the EFFECTIVE role (impersonating a CLIENT_USER/PORTAL_ADMIN
// drops it). Master-hub export routes are already gated by the admin router.
apiRouter.get("/feedback/export-rows", requireRole("OWNER", "SUPER_ADMIN", "AUDITOR"), async (req: Request, res: Response) => {
  const ctx = feedbackCtxPortal(req);
  if (!ctx.tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  res.json(await listFeedbackExportRows(ctx as any));
});

apiRouter.get("/feedback/:id", async (req: Request, res: Response) => {
  const ctx = feedbackCtxPortal(req);
  if (!ctx.tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  const t = await getFeedbackTicket(req.params.id, ctx as any);
  if (!t) { res.status(404).json({ error: "Ticket not found" }); return; }
  res.json(t);
});

apiRouter.post("/feedback/:id/messages", async (req: Request, res: Response) => {
  const ctx = feedbackCtxPortal(req);
  if (!ctx.tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  const { body } = (req.body ?? {}) as { body?: string };
  try {
    res.json(await addFeedbackMessage(req.params.id, ctx as any, { body: body || "" }));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/feedback/:id/attachments", async (req: Request, res: Response) => {
  const ctx = feedbackCtxPortal(req);
  if (!ctx.tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  const { urls } = (req.body ?? {}) as { urls?: unknown };
  try {
    res.json(await addFeedbackAttachments(req.params.id, ctx as any, { urls }));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/feedback/:id/resolve", async (req: Request, res: Response) => {
  const ctx = feedbackCtxPortal(req);
  if (!ctx.tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  try {
    res.json(await resolveFeedbackTicket(req.params.id, ctx as any));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/feedback/:id/restore", async (req: Request, res: Response) => {
  const ctx = feedbackCtxPortal(req);
  if (!ctx.tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  try {
    res.json(await restoreFeedbackTicket(req.params.id, ctx as any));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});

// Permanently delete a resolved ticket. OWNER/SUPER_ADMIN only + resolved-only,
// both enforced inside deleteFeedbackTicket (scope "portal").
apiRouter.delete("/feedback/:id", async (req: Request, res: Response) => {
  const ctx = feedbackCtxPortal(req);
  if (!ctx.tenantId) { res.status(400).json({ error: "No portal selected" }); return; }
  try {
    res.json(await deleteFeedbackTicket(req.params.id, ctx as any));
  } catch (err) {
    res.status((err as any).status || 400).json({ error: (err as Error).message });
  }
});
