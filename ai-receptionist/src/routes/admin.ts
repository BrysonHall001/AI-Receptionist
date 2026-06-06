import { Router, Request, Response } from "express";
import { requireRole } from "../middleware/auth";
import { listPortals, getPortal, createPortal, updatePortal } from "../services/portalService";
import { createUser, listUsers, deleteUser, publicUser } from "../services/userService";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";

// Master (SUPER_ADMIN) surface: manage all portals and all users.
export const adminRouter = Router();
adminRouter.use(requireRole("SUPER_ADMIN"));

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
  const { email, password, name, role, tenantId } = (req.body ?? {}) as Record<string, string>;
  if (!email || !password || !role) {
    res.status(400).json({ error: "email, password, and role are required" });
    return;
  }
  if ((role === "PORTAL_ADMIN" || role === "CLIENT_USER") && !tenantId) {
    res.status(400).json({ error: "This role must be assigned to a portal" });
    return;
  }
  try {
    const user = await createUser({
      email,
      password,
      name: name || null,
      role: role as any,
      tenantId: role === "SUPER_ADMIN" ? null : tenantId,
    });
    res.json(publicUser(user));
  } catch (err) {
    const msg = (err as Error).message.includes("Unique") ? "That email is already in use" : (err as Error).message;
    res.status(400).json({ error: msg });
  }
});

adminRouter.delete("/users/:id", async (req: Request, res: Response) => {
  if (req.params.id === req.user?.id) {
    res.status(400).json({ error: "You can't delete your own account" });
    return;
  }
  try {
    await deleteUser(req.params.id);
    res.json({ ok: true });
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
