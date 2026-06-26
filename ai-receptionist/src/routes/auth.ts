import { Router, Request, Response } from "express";
import { prisma } from "../db/client";
import { verifyPassword } from "../auth/passwords";
import { createSession, destroySession, setSessionCookie, clearSessionCookie, SESSION_COOKIE } from "../auth/session";
import { createResetToken, consumeResetToken, publicUser, accountInactive } from "../services/userService";
import { sendPlainEmail } from "../services/notificationService";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { rateLimit } from "../middleware/rateLimit";
import { can, NAV_VIEW_AREAS } from "../services/permissionService";

export const authRouter = Router();

// Throttle credential-guessing. Keyed by IP+email for login so one attacker
// can't grind a single account, with a looser IP-only cap on reset endpoints.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `${req.ip}:${String((req.body && req.body.email) || "").toLowerCase()}`,
  message: "Too many login attempts. Please wait a few minutes and try again.",
});
// Broader cap per IP so rotating the email can't bypass the per-account limit.
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  keyFn: (req) => req.ip || "unknown",
  message: "Too many login attempts from this connection. Please wait and try again.",
});
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });

authRouter.post("/login", loginIpLimiter, loginLimiter, async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (accountInactive(user)) {
    res.status(403).json({ error: "This account has expired." });
    return;
  }
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", async (req: Request, res: Response) => {
  await destroySession(req.cookies?.[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // Batch D2 (UI stage): return the EFFECTIVE identity (req.user). For everyone who
  // isn't acting-as-type, req.user IS the real user, so this is unchanged for them.
  // During act-as-type it carries the effective role + pinned tenant, so the whole
  // UI renders as that role. The persistent banner + Exit (driven by the server's
  // /api/impersonation, which checks the REAL identity) stay on top regardless.
  //
  // Batch 3 (nav reconciliation): also send the per-area VIEW map the sidebar derives
  // from, computed by the SAME resolver the server enforces with. For system roles
  // every nav area is true (so menus are unchanged); custom roles get a correct menu
  // automatically. Cosmetic nav-hide is applied separately on the client.
  const permView: Record<string, boolean> = {};
  for (const area of NAV_VIEW_AREAS) permView[area] = await can(req.user as any, area, "view");
  res.json({ user: { ...req.user, permView } });
});

authRouter.post("/forgot", resetLimiter, async (req: Request, res: Response) => {
  const { email } = (req.body ?? {}) as { email?: string };
  if (email) {
    const result = await createResetToken(email);
    if (result) {
      const link = `${env.APP_BASE_URL}/#/reset?token=${result.token}`;
      try {
        await sendPlainEmail(email, "Reset your password", `Use this link to reset your password:\n\n${link}\n\nThis link expires in 1 hour.`);
      } catch (err) {
        logger.error(`reset email failed: ${(err as Error).message}`);
      }
      logger.info(`Password reset link for ${email}: ${link}`);
    }
  }
  // Always succeed, to avoid leaking which emails exist.
  res.json({ ok: true });
});

authRouter.post("/reset", resetLimiter, async (req: Request, res: Response) => {
  const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
  if (!token || !password || password.length < 8) {
    res.status(400).json({ error: "A valid token and a password (8+ chars) are required" });
    return;
  }
  const ok = await consumeResetToken(token, password);
  if (!ok) {
    res.status(400).json({ error: "This reset link is invalid or has expired" });
    return;
  }
  res.json({ ok: true });
});
