import { Router, Request, Response } from "express";
import { rateLimit } from "../middleware/rateLimit";
import { resolveContext, publicPayload, submitSurvey } from "../services/surveyResponseService";

// PUBLIC, no-login surface. Mounted at /survey. Identity is the token (per-recipient)
// or publicId (anonymous) in the link; tenant + contact are resolved SERVER-SIDE from
// the stored row and are NEVER read from the request body. Rate-limited.
export const surveyRouter = Router();

const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyFn: (req: Request) => "survey:" + (req.ip || "unknown"),
  message: "Too many attempts. Please wait a moment and try again.",
});

const UNAVAILABLE = "This survey isn't available.";

// Resolve a link to its public questions (no portal data beyond the survey itself).
surveyRouter.get("/resolve", limiter, async (req: Request, res: Response) => {
  const token = (req.query.token as string) || "";
  const publicId = (req.query.s as string) || "";
  const ctx = await resolveContext({ token, publicId });
  if (!ctx) { res.status(404).json({ available: false, error: UNAVAILABLE }); return; }
  res.json(publicPayload(ctx));
});

// Submit answers. contactId is NEVER taken from the body — only the token/publicId.
surveyRouter.post("/submit", limiter, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as any;
  const result = await submitSurvey({ token: body.token, publicId: body.s, answers: body.answers });
  if (!result.ok) {
    const status = result.code === "unavailable" ? 404 : result.code === "inactive" ? 409 : 400;
    res.status(status).json({ ok: false, error: result.message || UNAVAILABLE });
    return;
  }
  res.json({ ok: true, duplicate: !!result.duplicate });
});
