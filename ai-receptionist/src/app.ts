import fs from "fs";
import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import { attachUser } from "./middleware/auth";
import { twilioRouter } from "./routes/twilioWebhooks";
import { conversationRelayRouter } from "./routes/conversationRelayWebhook";
import { resendWebhookRouter } from "./routes/resendWebhook";
import { stripeWebhookRouter } from "./routes/stripeWebhook";
import { internalRouter } from "./routes/internal";
import { inboundRouter } from "./routes/inbound";
import { inviteRouter } from "./routes/invites";
import { surveyRouter } from "./routes/surveyPublic";
import { authRouter } from "./routes/auth";
import { clientErrorsRouter } from "./routes/clientErrors";
import { captureError } from "./services/errorService";
import { webhookRecorder } from "./services/webhookService";
import { adminRouter } from "./routes/admin";
import { apiRouter } from "./routes/api";
import { googleRouter } from "./routes/google";
import { registerAutomationEngine } from "./automation/engine";
import { isProduction } from "./config/env";

export function createApp(): express.Express {
  const app = express();

  // Behind a hosting platform's HTTPS proxy in production: trust it so secure
  // cookies are set correctly and req.ip reflects the real client (for rate
  // limiting and Twilio signature URL building).
  if (isProduction()) app.set("trust proxy", 1);

  // Subscribe the automation engine to the event bus (idempotent).
  registerAutomationEngine();

  // Resend delivery webhook — MUST see the RAW request body for Svix signature
  // verification, so it is mounted with express.raw BEFORE the global urlencoded/JSON
  // parsers below. Public (no auth), like the Twilio webhooks.
  app.use("/webhooks/resend", express.raw({ type: "*/*" }), webhookRecorder("other"), resendWebhookRouter); // devtools-data: capture (Resend = provider "other")
  // Stripe payment webhook — same RAW-body requirement for signature verification.
  app.use("/webhooks/stripe", express.raw({ type: "*/*" }), webhookRecorder("stripe"), stripeWebhookRouter); // devtools-data: capture

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: "2mb" })); // imports can be largish
  app.use(cookieParser());
  app.use(attachUser); // sets req.user when a valid session cookie is present

  const publicDir = path.resolve(process.cwd(), "public");
  app.use(
    express.static(publicDir, {
      setHeaders(res, filePath) {
        // Never let the browser serve a stale shell or stale portal code: index.html
        // is uncacheable, and JS/CSS must revalidate so fixes show up on reload
        // without a hard refresh.
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-store");
        } else if (/\.(?:js|css)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // PUBLIC Quick-Reference Guide download. No authentication: it is mounted here,
  // outside every auth-gated router, so anyone with the link can fetch it (auditor
  // invites now link to this instead of carrying a PDF attachment). It streams the
  // repo file at request time, so swapping the guide later is just "replace
  // assets/Clarity_QRG.pdf and redeploy" — no code change. A missing file returns a
  // clean 404 rather than crashing the request.
  //   Live URL: https://clarity.vaala.io/quick-reference-guide.pdf
  app.get("/quick-reference-guide.pdf", (_req, res) => {
    const pdfPath = path.resolve(process.cwd(), "assets", "Clarity_QRG.pdf");
    fs.stat(pdfPath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.status(404).type("text/plain").send("Quick-Reference Guide not found.");
        return;
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(stats.size));
      res.setHeader("Content-Disposition", 'inline; filename="Clarity-Quick-Reference-Guide.pdf"');
      const stream = fs.createReadStream(pdfPath);
      stream.on("error", () => {
        if (!res.headersSent) res.status(404).type("text/plain").send("Quick-Reference Guide not found.");
        else res.destroy();
      });
      stream.pipe(res);
    });
  });

  // Telephony (unauthenticated by nature)
  app.use("/webhooks/twilio", webhookRecorder("twilio"), twilioRouter); // devtools-data: capture
  // SECOND, PARALLEL voice path (ConversationRelay + ElevenLabs). Separate mount
  // so the existing /webhooks/twilio path is untouched. See the router for how
  // to point your Twilio number at it for testing.
  app.use("/webhooks/relay", webhookRecorder("twilio"), conversationRelayRouter); // devtools-data: capture (ConversationRelay rides Twilio)
  app.use("/internal", internalRouter);
  app.use("/hooks/in", webhookRecorder("other"), inboundRouter); // PUBLIC inbound webhook ingest (tenant from token); devtools-data: capture
  app.use("/invites", inviteRouter); // PUBLIC account-activation surface (gated by invite token only)
  app.use("/survey", surveyRouter); // PUBLIC survey response surface (gated by survey token / publicId only)

  // devtools-data: client error reports (open surface — a white-screen can precede
  // login — but per-IP rate-limited and shape-validated inside; MUST sit before the
  // auth-gated /api catch-all).
  app.use("/api/client-errors", clientErrorsRouter);

  // Auth (login/forgot/reset are open; /me reads the session)
  app.use("/api/auth", authRouter);
  // Master portal surface (SUPER_ADMIN only — enforced inside the router)
  app.use("/api/admin", adminRouter);
  // Google Calendar OAuth (read-only) — auth + non-CLIENT_USER enforced inside.
  // MUST be mounted before the catch-all /api router so its paths match first.
  app.use("/api/google", googleRouter);
  // Portal dashboard surface (requires auth — enforced inside the router)
  app.use("/api", apiRouter);

  // devtools-data: the final error middleware — the SERVER-SIDE capture hook. Every
  // handled route still responds via its own try/catch (behavior unchanged); anything
  // that THROWS past those lands here: captured (fire-and-forget) + a clean 500.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, req: any, res: any, _next: any) => {
    try {
      const u: any = req.user || null;
      captureError({
        source: "server",
        tenantId: (u && u.tenantId) || null,
        userId: (u && u.id) || null,
        userLabel: (u && (u.name || u.email)) || null,
        message: (err && err.message) || "Unhandled server error",
        stack: (err && err.stack) || null,
        route: `${req.method} ${req.path}`,
        userAgent: (req.headers && req.headers["user-agent"]) || null,
      });
    } catch { /* capture never blocks the response */ }
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal error" });
  });

  // SPA fallback for client-side routes.
  app.get("*", (req, res, next) => {
    const p = req.path;
    if (p.startsWith("/api") || p.startsWith("/webhooks") || p.startsWith("/internal") || p === "/healthz") {
      return next();
    }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
