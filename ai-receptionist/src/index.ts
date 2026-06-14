import { env } from "./config/env"; // validates env on import; crashes if missing
import { createApp } from "./app";
import { connectDb, disconnectDb } from "./db/client";
import { logger } from "./utils/logger";
import { ensureInboundStatusCallback } from "./telephony/provisionStatusCallback";
import { attachConversationRelay } from "./telephony/conversationRelayWs";
import { sweepStaleCalls } from "./services/callOrchestrator";

// Safety net: a single in-flight request's unexpected error must NEVER take down
// the whole server for every tenant. Node's default is to crash the process on an
// unhandled promise rejection — that's what turned one duplicate-seed error into a
// site-wide 502. We log loudly and keep serving instead. This is defense-in-depth:
// the known offender (the record-type seeders) is also fixed to not throw on the
// duplicate-seed race, so this guard should rarely fire. We deliberately do NOT
// exit here, because staying up for all other users is the priority.
process.on("unhandledRejection", (reason: unknown) => {
  const detail = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logger.error(`Unhandled promise rejection (server kept alive): ${detail}`);
});
process.on("uncaughtException", (err: Error) => {
  logger.error(`Uncaught exception (server kept alive): ${err.stack || err.message}`);
});

async function main(): Promise<void> {
  await connectDb();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`AI Receptionist server listening on :${env.PORT}`);
  });

  // Attach the ConversationRelay WebSocket to the SAME HTTP server. This handles
  // the wss:// upgrade for the new, parallel voice path. It only claims the
  // /relay path; all other traffic (HTTP routes, the old webhook path) is
  // unaffected.
  attachConversationRelay(server);

  // Ensure Twilio POSTs every call's end (including plain caller hang-ups) to
  // /webhooks/twilio/status, without depending on the Twilio Console. Best-effort
  // and fire-and-forget: it never blocks or crashes startup (see the module for
  // its safety/idempotency properties).
  void ensureInboundStatusCallback();

  // Safety-net finalizer: every 60s, finalize any call left "in progress" with no
  // recent activity (e.g. a walkie caller who hung up mid-conversation and whose
  // Twilio status callback never landed). unref() so it never holds the process
  // open during shutdown.
  const sweepTimer = setInterval(() => {
    void sweepStaleCalls();
  }, 60_000);
  sweepTimer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}; shutting down…`);
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${(err as Error).message}`);
  process.exit(1);
});
