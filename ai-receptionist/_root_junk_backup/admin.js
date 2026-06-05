import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import { attachUser } from "./middleware/auth";
import { twilioRouter } from "./routes/twilioWebhooks";
import { internalRouter } from "./routes/internal";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { apiRouter } from "./routes/api";

export function createApp(): express.Express {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: "2mb" })); // imports can be largish
  app.use(cookieParser());
  app.use(attachUser); // sets req.user when a valid session cookie is present

  const publicDir = path.resolve(process.cwd(), "public");
  app.use(express.static(publicDir));

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
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
