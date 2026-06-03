import { Router, Request, Response } from "express";
import { startCall, handleTurn, finalizeCall } from "../services/callOrchestrator";

// JSON-based mirror of the call pipeline. Used by the simulation script and for
// driving a full call without a real phone (LAYER 7).
export const internalRouter = Router();

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
