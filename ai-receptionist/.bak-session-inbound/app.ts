import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import { attachUser } from "./middleware/auth";
import { twilioRouter } from "./routes/twilioWebhooks";
import { internalRouter } from "./routes/internal";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { apiRouter } from "./routes/api";
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

  // Telephony (unauthenticated by nature)
  app.use("/webhooks/twilio", twilioRouter);
  app.use("/internal", internalRouter);

  // Auth (login/forgot/reset are open; /me reads the session)
  app.use("/api/auth", authRouter);
  // Master portal surface (SUPER_ADMIN only — enforced inside the router)
  app.use("/api/admin", adminRouter);
  // Portal dashboard surface (requires auth — enforced inside the router)
  app.use("/api", apiRouter);

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
