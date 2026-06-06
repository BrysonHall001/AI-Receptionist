import { Router, Request, Response } from "express";
import { rateLimit } from "../middleware/rateLimit";
import { ingest } from "../services/inboundService";

// PUBLIC, unauthenticated-by-design endpoint. External systems POST a lead here.
// Security lives in the service: the tenant is derived ONLY from the :token,
// the body cannot choose a tenant, and every call is logged. Here we add the
// public-edge protections: per-token rate limiting and a payload-size cap.
export const inboundRouter = Router();

const MAX_BYTES = 32 * 1024; // 32kb per request (plenty for a lead; blocks abuse)

// 60 requests/minute per token (falls back to IP if the token is missing).
const inboundLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyFn: (req: Request) => "inbound:" + (req.params.token || req.ip || "unknown"),
  message: "Too many requests to this endpoint. Please slow down.",
});

inboundRouter.post("/:token", inboundLimiter, async (req: Request, res: Response) => {
  // Reject oversized payloads early (the global json limit is 2mb; this is tighter).
  const declared = Number(req.headers["content-length"] || 0);
  if (declared && declared > MAX_BYTES) { res.status(413).json({ error: "Payload too large" }); return; }
  if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > MAX_BYTES) { res.status(413).json({ error: "Payload too large" }); return; }

  const sourceIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
  const result = await ingest(req.params.token, req.body, sourceIp);
  res.status(result.status).json(result.body);
});
