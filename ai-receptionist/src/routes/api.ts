import { Router, Request, Response } from "express";
import { requireAuth, resolveTenantScope } from "../middleware/auth";
import { getStats, listCalls, getCall, listContacts, getContact } from "../services/readModels";
import { runSimulatedCall } from "../services/simulationService";
import { importContacts, updateContact } from "../services/contactService";
import { listFields, createField, updateField, deleteField, reorderFields } from "../services/fieldService";
import { listSavedFilters, createSavedFilter, deleteSavedFilter } from "../services/savedFilterService";
import { listExports, createExport, getExportCsv } from "../services/exportService";
import { updatePortal, getPortal } from "../services/portalService";
import { createUser, listUsers, deleteUser, setPassword, publicUser } from "../services/userService";
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
    const result = await importContacts(tenantId, rows);
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
    await updateContact(req.params.id, tenantId, { name, phone, email, intent, customFields });
    res.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message.includes("Unique") ? "That phone number is already used by another contact" : (err as Error).message;
    res.status(400).json({ error: msg });
  }
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
  const { name, businessType, phoneNumber, notifyEmail, greeting } = (req.body ?? {}) as Record<string, string>;
  try {
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
