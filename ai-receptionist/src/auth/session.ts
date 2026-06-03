import crypto from "crypto";
import { Response } from "express";
import { env } from "../config/env";
import { prisma } from "../db/client";

export const SESSION_COOKIE = "air_session";

function ttlMs(): number {
  return env.SESSION_TTL_HOURS * 60 * 60 * 1000;
}

/** Create a DB-backed session and return its opaque token. */
export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { token, userId, expiresAt: new Date(Date.now() + ttlMs()) },
  });
  return token;
}

/** Resolve a session token to its user, or null if missing/expired. */
export async function getUserForToken(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { token } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.delete({ where: { token } }).catch(() => undefined);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE === "true",
    maxAge: ttlMs(),
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
