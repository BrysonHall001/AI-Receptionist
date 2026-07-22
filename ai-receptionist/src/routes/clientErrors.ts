// devtools-data — the client error-report endpoint. OPEN (a white-screen can happen
// before login), but hard rate-limited per IP and accepting only a tiny validated
// shape. attachUser has already run, so when a session exists the row is stamped
// with tenant + user; otherwise those stay null. Responds 204 always on accept and
// 429 on limit — never an error body a broken client could loop on.
import { Router, Request, Response } from "express";
import { captureError, clientErrorAllowed } from "../services/errorService";

export const clientErrorsRouter = Router();

clientErrorsRouter.post("/", (req: Request, res: Response) => {
  try {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    if (!clientErrorAllowed(ip)) { res.status(429).end(); return; }
    const b = (req.body || {}) as Record<string, unknown>;
    const u: any = req.user || null;
    captureError({
      source: "client",
      tenantId: (u && u.tenantId) || null,
      userId: (u && u.id) || null,
      userLabel: (u && (u.name || u.email)) || null,
      message: typeof b.message === "string" ? b.message : "(client error)",
      stack: typeof b.stack === "string" ? b.stack : null,
      route: typeof b.route === "string" ? b.route : null,
      userAgent: (req.headers["user-agent"] as string) || null,
      meta: b.meta && typeof b.meta === "object" ? b.meta : null,
    });
    res.status(204).end();
  } catch {
    // by contract this surface never errors loudly
    try { res.status(204).end(); } catch { /* nothing */ }
  }
});
