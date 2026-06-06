import { Router, Request, Response } from "express";
import { requireAuth, resolveTenantScope } from "../middleware/auth";
import { getStats, listCalls, getCall, listContacts, getContact, listDeletedContacts } from "../services/readModels";
import { runSimulatedCall } from "../services/simulationService";
import { importContacts, updateContact, softDeleteContacts, restoreContacts, purgeExpiredContacts, createContact, bulkUpdateField, mergeContacts, generateDummyContact } from "../services/contactService";
import { listFields, createField, updateField, deleteField, reorderFields } from "../services/fieldService";
import { listTimeline, log as logActivity } from "../services/activityService";
import { sendRichEmail } from "../services/notificationService";
import { listTemplates, createTemplate, deleteTemplate } from "../services/templateService";
import { sendSms } from "../services/smsService";
import { listDashboards, createDashboard, updateDashboard, deleteDashboard, getOrCreateHomeDashboard } from "../services/dashboardService";
import { listSavedFilters, createSavedFilter, deleteSavedFilter } from "../services/savedFilterService";
import { listExports, createExport, getExportCsv } from "../services/exportService";
import { updatePortal, getPortal } from "../services/portalService";
import { PRESETS, FONTS } from "../theme/themes";
import { createUser, listUsers, deleteUser, setPassword, publicUser, getUserTheme, setUserTheme, getContactColumns, setContactColumns } from "../services/userService";
import { listAutomations, getAutomation, createAutomation, updateAutomation, deleteAutomation, listRuns, listEvents, listManualAutomations } from "../services/automationService";
import { testRunAutomation, runManualAutomation } from "../automation/engine";
import { listScheduledJobs, cancelScheduledJob, processDueJobs } from "../automation/scheduler";
import { loadFieldDefs, conditionFields } from "../automation/contactRow";
import { validateWebhookUrl, sendWebhook, buildSamplePayload } from "../automation/webhook";
import { listEndpoints, createEndpoint, updateEndpoint, regenerateToken, deleteEndpoint, listCalls as listInboundCalls } from "../services/inboundService";
import { ACTION_TYPES } from "../automation/actions";
import { AUTOMATION_PRESETS, getPreset, PRESET_CATEGORIES } from "../automation/presets";
import { analyzeFlowDefinition, applyFlowDefinition } from "../services/flowProvisioningService";
import { TRIGGERABLE_EVENT_TYPES, EVENT_TYPES } from "../events/types";
import { emitEvent } from "../events/bus";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";

// Authenticated, tenant-scoped surface for the portal dashboard.
export const apiRouter = Router();
apiRouter.use(requireAuth);

/** Resolve the tenant the request may read/write, or send 400 and return null. */
function tenantOr400(req: Request, res: Response): string | null {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) {
    res.status(400).json({ error: "No portal selected" });
    return null;
  }
  return tenantId;
}

apiRouter.get("/stats", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await getStats(tenantId));
});

apiRouter.get("/calls", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listCalls(tenantId));
});

apiRouter.get("/calls/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
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
  const count = await softDeleteContacts(tenantId, Array.isArray(ids) ? ids : []);
  res.json({ ok: true, count });
});

apiRouter.post("/contacts/restore", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ids = (req.body ?? {}).ids;
  const count = await restoreContacts(tenantId, Array.isArray(ids) ? ids : []);
  res.json({ ok: true, count });
});

// Manual single create
apiRouter.post("/contacts", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, phone, email, intent, customFields } = (req.body ?? {}) as any;
  try {
    const c = await createContact(tenantId, { name, phone, email, intent, customFields }, { id: req.user!.id, name: req.user!.name || req.user!.email, type: "user" });
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
    const count = await bulkUpdateField(tenantId, Array.isArray(ids) ? ids : [], String(field || ""), value, { id: req.user!.id, name: req.user!.name || req.user!.email, type: "user" });
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
    const survivor = await mergeContacts(tenantId, String(survivorId || ""), Array.isArray(loserIds) ? loserIds : [], fieldValues || {}, { id: req.user!.id, name: req.user!.name || req.user!.email, type: "user" });
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
    const c = await generateDummyContact(tenantId, { id: req.user!.id, name: req.user!.name || req.user!.email, type: "user" });
    res.json({ ok: true, id: c.id });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.delete("/contacts/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  // Soft delete — moves the contact to the recycle bin, never erases it here.
  const count = await softDeleteContacts(tenantId, [req.params.id]);
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
    const result = await importContacts(tenantId, rows, { id: req.user!.id, name: req.user!.name || req.user!.email, type: "user" });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.patch("/contacts/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, phone, email, intent, customFields } = (req.body ?? {}) as any;
  try {
    await updateContact(req.params.id, tenantId, { name, phone, email, intent, customFields }, { id: req.user!.id, name: req.user!.name || req.user!.email, type: "user" });
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
    await sendRichEmail({ to: contact.email, subject, html: html || "", fromEmail: req.user!.email, fromName: req.user!.name });
    await logActivity({
      tenantId,
      contactId: req.params.id,
      type: "email_sent",
      summary: `Email sent: ${subject.trim()}`,
      detail: { subject: subject.trim(), to: contact.email, from: req.user!.email },
      actor: { id: req.user!.id, name: req.user!.name || req.user!.email, type: "user" },
    });
    await emitEvent({ tenantId, type: EVENT_TYPES.EmailSent, actor: { type: "user", id: req.user!.id, name: req.user!.name || req.user!.email }, subject: { type: "contact", id: req.params.id }, payload: { subject: subject.trim(), to: contact.email } });
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
      actor: { id: req.user!.id, name: req.user!.name || req.user!.email, type: "user" },
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
  const { name, kind, subject, body } = (req.body ?? {}) as any;
  if (!name || !name.trim()) {
    res.status(400).json({ error: "A template name is required" });
    return;
  }
  res.json(await createTemplate({ tenantId, name, kind, subject, body: body || "", createdById: req.user!.id }));
});

apiRouter.delete("/templates/:id", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const ok = await deleteTemplate(req.params.id, tenantId);
  if (!ok) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ ok: true });
});

// ---- Dashboards / Reports (shared across the portal) ----
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
    res.json(await updateDashboard(req.params.id, tenantId, { name, widgets }));
  } catch (err) {
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

// ---- Personal email signature ----
apiRouter.get("/account/signature", async (req: Request, res: Response) => {  const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { signature: true } });
  res.json({ signature: u?.signature ?? "" });
});

apiRouter.patch("/account/signature", async (req: Request, res: Response) => {
  const { signature } = (req.body ?? {}) as { signature?: string };
  await prisma.user.update({ where: { id: req.user!.id }, data: { signature: signature ?? "" } });
  res.json({ ok: true });
});

// ---- Custom fields (definitions are admin-managed; values editable by all) ----
function fieldsAdminOnly(req: Request, res: Response): boolean {
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Only admins can change fields" });
    return false;
  }
  return true;
}

apiRouter.get("/fields", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listFields(tenantId));
});

apiRouter.post("/fields", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  try {
    const { label, type, required, options, formula } = (req.body ?? {}) as any;
    res.json(await createField(tenantId, { label, type, required, options, formula }));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.patch("/fields/reorder", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (!fieldsAdminOnly(req, res)) return;
  const ids = (req.body?.orderedIds ?? []) as string[];
  await reorderFields(tenantId, ids);
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

// ---- Per-user theme (Appearance). Personal to each account, independent of
// portal context. Every authenticated user controls their own theme. ----
apiRouter.get("/theme", async (req: Request, res: Response) => {
  res.json({ theme: await getUserTheme(req.user!.id), presets: PRESETS, fonts: FONTS });
});

apiRouter.patch("/theme", async (req: Request, res: Response) => {
  // sanitizeUserTheme rejects anything that isn't a known preset, a strict-hex
  // + allow-listed-font custom, or a clean (length-capped, escaped) name.
  const theme = await setUserTheme(req.user!.id, (req.body ?? {}).theme ?? req.body);
  res.json({ theme });
});

// ---- Portal settings (PORTAL_ADMIN for own portal, SUPER_ADMIN anywhere) ----
apiRouter.get("/settings", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const portal = await getPortal(tenantId);
  if (!portal) {
    res.status(404).json({ error: "Portal not found" });
    return;
  }
  res.json(portal);
});

apiRouter.patch("/settings", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Not authorized to change portal settings" });
    return;
  }
  const { name, businessType, phoneNumber, notifyEmail, greeting } = (req.body ?? {}) as Record<string, any>;
  try {
    // NOTE: the email/phone identity rule (requireEmail) is intentionally NOT
    // accepted here. It can only be changed by a SUPER_ADMIN via /api/admin/portals.
    const updated = await updatePortal(tenantId, { name, businessType, phoneNumber, notifyEmail, greeting });
    res.json({ ok: true, portal: { id: updated.id } });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- Users within the current portal (PORTAL_ADMIN manages their own) ----
apiRouter.get("/users", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  res.json(await listUsers(tenantId));
});

apiRouter.post("/users", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  const { email, password, name, role } = (req.body ?? {}) as Record<string, string>;
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  // Portal admins may only create users inside their own portal, never super admins.
  const safeRole = role === "PORTAL_ADMIN" ? "PORTAL_ADMIN" : "CLIENT_USER";
  try {
    const user = await createUser({ email, password, name: name || null, role: safeRole, tenantId });
    res.json(publicUser(user));
  } catch (err) {
    const msg = (err as Error).message.includes("Unique") ? "That email is already in use" : (err as Error).message;
    res.status(400).json({ error: msg });
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
  await deleteUser(req.params.id);
  res.json({ ok: true });
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
  }
  res.json({ ok: true });
});

// ---- Export history (snapshots) ----
apiRouter.get("/exports", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listExports(tenantId));
});

apiRouter.post("/exports", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const { name, rowCount, fields, csv } = (req.body ?? {}) as { name?: string; rowCount?: number; fields?: unknown; csv?: string };
  if (!name || !name.trim()) {
    res.status(400).json({ error: "An export name is required" });
    return;
  }
  if (typeof csv !== "string") {
    res.status(400).json({ error: "Nothing to export" });
    return;
  }
  const rec = await createExport({ tenantId, name, rowCount: rowCount || 0, fields, csv, createdById: req.user!.id });
  res.json(rec);
});

apiRouter.get("/exports/:id/download", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  const result = await getExportCsv(req.params.id, tenantId);
  if (!result) {
    res.status(404).json({ error: "Export not found" });
    return;
  }
  res.json(result);
});

// ---- Automations (event-driven workflows) ----
apiRouter.get("/automations", async (req: Request, res: Response) => {
  const tenantId = tenantOr400(req, res);
  if (!tenantId) return;
  res.json(await listAutomations(tenantId));
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
  res.json({
    triggers: TRIGGERABLE_EVENT_TYPES,
    actions: ACTION_TYPES,
    fields,
    tagFields,
    templates: templates.map((t: any) => ({ id: t.id, name: t.name, kind: t.kind })),
    users: users.map((u: any) => ({ id: u.id, name: u.name || u.email })),
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
    const analysis = await analyzeFlowDefinition(tenantId, p.definition);
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
    });
  }
  res.json({ categories: PRESET_CATEGORIES, presets });
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
  try {
    const result = await applyFlowDefinition(tenantId, def, req.user!.id);
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
  if (req.user!.role !== "SUPER_ADMIN") { res.status(403).json({ error: "Super-admin only" }); return; }
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
  if (!password || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  await setPassword(req.user!.id, password);
  res.json({ ok: true });
});
