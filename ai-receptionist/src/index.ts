import { env } from "./config/env"; // validates env on import; crashes if missing
import { createApp } from "./app";
import { connectDb, disconnectDb } from "./db/client";
import { logger } from "./utils/logger";

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
