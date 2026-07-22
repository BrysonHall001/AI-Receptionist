// devtools-data — inbound webhook capture (the Webhook inspector's data layer).
// Discipline identical to the audit + error foundations: capture is fire-and-forget
// and can NEVER throw or block a webhook response; excerpts are REDACTED (no auth
// tokens, no signatures, no secrets, NO MESSAGE BODIES) and truncated; retention is
// a bounded hourly prune. One Express recorder middleware serves every mount.
import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

let _prisma: any = null;
function db(): any { if (!_prisma) _prisma = require("../db/client").prisma; return _prisma; }

// ---------------- named constants ----------------
export const WEBHOOK_RETENTION_DAYS = 14;
export const WEBHOOK_PRUNE_BATCH = 500;
export const WEBHOOK_PRUNE_MAX_BATCHES = 14;
export const WEBHOOK_EXCERPT_MAX = 2048; // ~2KB redacted excerpt

// Redaction: credential-ish keys AND message-content keys both vanish. The excerpt
// exists to answer "what kind of thing arrived", never "what did it say".
const REDACT_KEY = /token|signature|auth|secret|password|api[-_]?key|credential/i;
const CONTENT_KEY = /^body$|^text$|^html$|transcript|speechresult|^message$|^content$|recordingurl/i;

export function redactPayload(input: unknown): string | null {
  try {
    let obj: any = input;
    if (obj === undefined || obj === null) return null;
    if (Buffer.isBuffer(obj)) {
      try { obj = JSON.parse(obj.toString("utf8")); }
      catch { return `(raw payload, ${obj.length} bytes — not excerpted)`; }
    }
    if (typeof obj === "string") {
      try { obj = JSON.parse(obj); }
      catch { return `(string payload, ${obj.length} chars — not excerpted)`; }
    }
    const walk = (v: any, depth: number): any => {
      if (depth > 4 || v === null || typeof v !== "object") return v;
      if (Array.isArray(v)) return v.slice(0, 20).map((x) => walk(x, depth + 1));
      const out: any = {};
      for (const k of Object.keys(v).slice(0, 40)) {
        if (REDACT_KEY.test(k) || CONTENT_KEY.test(k)) { out[k] = "[redacted]"; continue; }
        out[k] = walk(v[k], depth + 1);
      }
      return out;
    };
    const s = JSON.stringify(walk(obj, 0));
    return s.length > WEBHOOK_EXCERPT_MAX ? s.slice(0, WEBHOOK_EXCERPT_MAX) + "\u2026[truncated]" : s;
  } catch { return null; }
}

export interface WebhookEventInput {
  provider: "twilio" | "google" | "stripe" | "other";
  endpoint: string;
  tenantId?: string | null;
  outcome: "ok" | "fail";
  httpStatus: number;
  latencyMs: number;
  summary: string;
  payload?: unknown;   // redacted + excerpted here — raw never persists
  error?: string | null;
}

type Writer = (data: any) => Promise<unknown>;
let writer: Writer | null = null;
export function _setWebhookWriterForTests(w: Writer | null): void { writer = w; }

/** Fire-and-forget. NEVER throws, NEVER blocks the webhook response. */
export function captureWebhook(evt: WebhookEventInput): void {
  try {
    const data = {
      provider: evt.provider,
      endpoint: String(evt.endpoint).slice(0, 300),
      tenantId: evt.tenantId ?? null,
      outcome: evt.outcome === "fail" ? "fail" : "ok",
      httpStatus: Number.isFinite(evt.httpStatus) ? evt.httpStatus : 0,
      latencyMs: Number.isFinite(evt.latencyMs) ? Math.max(0, Math.round(evt.latencyMs)) : 0,
      summary: String(evt.summary || "(webhook)").slice(0, 300),
      payloadExcerpt: redactPayload(evt.payload),
      error: evt.error ? String(evt.error).slice(0, 1000) : null,
    };
    void Promise.resolve()
      .then(() => (writer ? writer(data) : db().webhookEvent.create({ data })))
      .catch((e: unknown) => logger.warn(`[webhooks] capture dropped (never blocks): ${(e as Error).message}`));
  } catch (e) {
    try { logger.warn(`[webhooks] capture dropped (sync): ${(e as Error).message}`); } catch { /* silent */ }
  }
}

// Human one-liners for known endpoints; anything else self-describes.
function summarize(provider: string, path: string): string {
  const p = path.toLowerCase();
  if (provider === "twilio" && p.includes("voice")) return "Inbound call webhook";
  if (provider === "twilio" && p.includes("sms")) return "Inbound SMS webhook";
  if (provider === "twilio" && p.includes("status")) return "Call/message status callback";
  if (provider === "twilio" && p.includes("relay")) return "ConversationRelay voice session webhook";
  if (provider === "stripe") return "Stripe billing event";
  if (p.includes("resend")) return "Email delivery report (Resend)";
  if (p.includes("/in")) return "Custom inbound ingest webhook";
  return `${provider} webhook`;
}

/** ONE recorder middleware for every webhook mount: measures latency, records on
 *  response finish (outcome from status), redacts the body. Wholly try/caught —
 *  if the recorder itself breaks, the webhook flows on untouched. */
export function webhookRecorder(provider: WebhookEventInput["provider"]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    try {
      const t0 = Date.now();
      res.on("finish", () => {
        try {
          captureWebhook({
            provider,
            endpoint: (req.baseUrl || "") + (req.path || ""),
            tenantId: ((req as any).tenantId as string) || null, // ingest routes that resolve a tenant may stamp req.tenantId
            outcome: res.statusCode < 400 ? "ok" : "fail",
            httpStatus: res.statusCode,
            latencyMs: Date.now() - t0,
            summary: summarize(provider, (req.baseUrl || "") + (req.path || "")),
            payload: (req as any).body,
            error: res.statusCode < 400 ? null : `HTTP ${res.statusCode}`,
          });
        } catch { /* recorder never interferes */ }
      });
    } catch { /* recorder never interferes */ }
    next();
  };
}

// ---------------- retention (rides the hourly ops sweep) ----------------
export async function runWebhookPruneSweep(now: Date = new Date()): Promise<{ deleted: number }> {
  const res = { deleted: 0 };
  try {
    const cutoff = new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * 24 * 60 * 60_000);
    for (let i = 0; i < WEBHOOK_PRUNE_MAX_BATCHES; i++) {
      const batch = await db().webhookEvent.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: WEBHOOK_PRUNE_BATCH });
      if (!batch.length) break;
      await db().webhookEvent.deleteMany({ where: { id: { in: batch.map((b: any) => b.id) } } });
      res.deleted += batch.length;
      if (batch.length < WEBHOOK_PRUNE_BATCH) break;
    }
  } catch (e) {
    logger.warn(`[webhooks] prune sweep skipped: ${(e as Error).message}`);
  }
  return res;
}
