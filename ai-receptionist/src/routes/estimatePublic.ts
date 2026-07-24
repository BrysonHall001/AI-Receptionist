import { Router, Request, Response } from "express";
import { rateLimit } from "../middleware/rateLimit";
import { resolveEstimatePublic, decideEstimate } from "../services/estimateService";

// Estimates Lifecycle batch. PUBLIC, no-login surface mounted at /estimate —
// the survey-page precedent verbatim: identity is the token in the link; tenant
// + record + contact resolve SERVER-SIDE from the stored row and are NEVER read
// from the request; rate-limited; the payload is a strict allowlist of the
// estimate's own content + business identity (see resolveEstimatePublic).
// NO payment collection anywhere on this surface.
export const estimateRouter = Router();

const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyFn: (req: Request) => "estimate:" + (req.ip || "unknown"),
  message: "Too many attempts. Please wait a moment and try again.",
});

const UNAVAILABLE = "This estimate isn't available.";

estimateRouter.get("/resolve", limiter, async (req: Request, res: Response) => {
  const payload = await resolveEstimatePublic((req.query.token as string) || "");
  if (!payload) { res.status(404).json({ available: false, error: UNAVAILABLE }); return; }
  res.json(payload);
});

estimateRouter.post("/decide", limiter, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as any;
  const result = await decideEstimate(body.token, body.decision, body.comment);
  if (!result.ok) {
    const status = result.code === "unavailable" ? 404 : result.code === "decided" || result.code === "expired" ? 409 : 400;
    res.status(status).json({ ok: false, error: result.message || UNAVAILABLE });
    return;
  }
  res.json({ ok: true, duplicate: !!result.duplicate });
});
