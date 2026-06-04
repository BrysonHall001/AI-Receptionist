import { Request, Response, NextFunction } from "express";

/**
 * A tiny in-memory rate limiter — no external dependencies, so it works with the
 * existing install. It throttles repeated requests from the same key (default:
 * client IP) within a rolling window. State lives in this process and resets on
 * restart, which is fine for blocking password-guessing; for multi-server
 * deployments later, swap the Map for a shared store (e.g. Redis).
 */
interface Hit {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
  message?: string;
}

export function rateLimit(opts: RateLimitOptions) {
  const hits = new Map<string, Hit>();
  const keyFn = opts.keyFn ?? ((req: Request) => req.ip || "unknown");

  // Periodically drop expired entries so the map can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, opts.windowMs).unref?.();
  void sweep;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFn(req);
    const now = Date.now();
    const existing = hits.get(key);
    if (!existing || existing.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    existing.count += 1;
    if (existing.count > opts.max) {
      const retrySec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retrySec));
      res.status(429).json({ error: opts.message || "Too many attempts. Please wait and try again." });
      return;
    }
    next();
  };
}
