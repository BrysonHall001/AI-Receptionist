import { Router, Request, Response, NextFunction } from "express";
import { startCall, handleTurn, finalizeCall } from "../services/callOrchestrator";
import { env, isProduction } from "../config/env";
import { logger } from "../utils/logger";

// JSON-based mirror of the call pipeline. Used by the simulation script and for
// driving a full call without a real phone (LAYER 7).
export const internalRouter = Router();

// These endpoints can create calls/contacts and spend AI/SMS credits, so in
// production they are locked behind a shared secret. Locally (dev) they stay
// open so `npm run simulate` keeps working with no setup.
internalRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (!isProduction()) return next();
  if (!env.INTERNAL_API_SECRET) {
    logger.warn("Blocked /internal request: INTERNAL_API_SECRET is not set in production.");
    res.status(403).json({ error: "Internal endpoints are disabled." });
    return;
  }
  if (req.header("x-internal-secret") !== env.INTERNAL_API_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
});

internalRouter.post("/call/start", async (req: Request, res: Response) => {
  const { callSid, from, to } = (req.body ?? {}) as Record<string, string>;
  if (!callSid || !from) {
    res.status(400).json({ error: "callSid and from are required" });
    return;
  }
  try {
    const result = await startCall({ callSid, from, to: to ?? null });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

internalRouter.post("/call/update", async (req: Request, res: Response) => {
  const { callSid, speech } = (req.body ?? {}) as Record<string, string>;
  if (!callSid) {
    res.status(400).json({ error: "callSid is required" });
    return;
  }
  try {
    const result = await handleTurn({ callSid, speech: speech ?? "" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

internalRouter.post("/call/end", async (req: Request, res: Response) => {
  const { callSid } = (req.body ?? {}) as Record<string, string>;
  if (!callSid) {
    res.status(400).json({ error: "callSid is required" });
    return;
  }
  try {
    await finalizeCall(callSid, "COMPLETED");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
