import { Router, Request, Response } from "express";
import { prisma } from "../db/client";
import { rateLimit } from "../middleware/rateLimit";
import { getValidInvite, acceptInvite } from "../services/inviteService";
import { createSession, setSessionCookie } from "../auth/session";

// PUBLIC, no-login surface. Mounted at /invites. Everything here is gated ONLY by
// the secret invite token; role + tenant are read from the stored invite on the
// server and are never accepted from the request body. Rate-limited to blunt any
// token guessing (the token itself is 256-bit, so guessing is already infeasible).
export const inviteRouter = Router();

const inviteLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyFn: (req: Request) => "invite:" + (req.ip || "unknown"),
  message: "Too many attempts. Please wait a moment and try again.",
});

const GENERIC = "This invite link is invalid or has expired.";

// Validate a token and return ONLY what the invitee needs to see (their email +
// the portal name + their role). Missing / expired / used all return the same
// generic 404 — no information leak about which invites exist.
inviteRouter.get("/:token", inviteLimiter, async (req: Request, res: Response) => {
  const inv = await getValidInvite(req.params.token);
  if (!inv) {
    res.status(404).json({ error: GENERIC });
    return;
  }
  let portalName = "your workspace";
  try {
    const t = await prisma.tenant.findUnique({ where: { id: inv.tenantId } });
    if (t) portalName = (t as any).name || portalName;
  } catch {
    /* name is cosmetic */
  }
  res.json({ email: inv.email, role: inv.role, portalName });
});

// Accept: set a password, which creates + activates the account for the invite's
// role + tenant, consumes the token (single-use), and logs the new user in by
// issuing a normal session cookie (reusing the same session path as login).
inviteRouter.post("/:token/accept", inviteLimiter, async (req: Request, res: Response) => {
  const password = String((req.body ?? {}).password ?? "");
  const result = await acceptInvite(req.params.token, password);
  if (!result.ok) {
    if (result.reason === "weak") {
      res.status(400).json({ error: result.message || "Please choose a stronger password." });
      return;
    }
    if (result.reason === "exists") {
      res.status(409).json({ error: "An account for this email already exists — please sign in instead." });
      return;
    }
    res.status(400).json({ error: GENERIC });
    return;
  }
  const token = await createSession(result.user.id);
  setSessionCookie(res, token);
  res.json({ ok: true });
});
