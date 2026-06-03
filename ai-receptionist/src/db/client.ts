import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

/** Single shared Prisma client for the whole process. */
export const prisma = new PrismaClient();

export async function connectDb(): Promise<void> {
  await prisma.$connect();
  logger.info("Database connected");
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
