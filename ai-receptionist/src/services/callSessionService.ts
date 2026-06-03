import { prisma } from "../db/client";
import { CallState } from "../callflow/stateMachine";
import { Extracted } from "../ai/schema";
import { TranscriptTurn } from "../utils/transcript";

export async function createCallSession(params: {
  callSid: string;
  tenantId: string;
  fromNumber: string;
  toNumber?: string | null;
}) {
  return prisma.callSession.create({
    data: {
      callSid: params.callSid,
      tenantId: params.tenantId,
      fromNumber: params.fromNumber,
      toNumber: params.toNumber ?? null,
      status: "GREETING",
    },
  });
}

export async function getCallSession(callSid: string) {
  return prisma.callSession.findUnique({ where: { callSid } });
}

/**
 * Patch a call session. Only provided fields are written; absent fields are
 * left unchanged. JSON columns are cast at the boundary so we don't depend on
 * Prisma's generated input-namespace types (which keeps this file portable).
 */
export async function updateCallSession(
  callSid: string,
  data: {
    status?: CallState;
    transcript?: TranscriptTurn[];
    extracted?: Extracted;
    turnCount?: number;
    emptyCount?: number;
  },
) {
  return prisma.callSession.update({
    where: { callSid },
    data: {
      ...(data.status ? { status: data.status } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(data.transcript ? { transcript: data.transcript as any } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(data.extracted ? { extracted: data.extracted as any } : {}),
      ...(typeof data.turnCount === "number" ? { turnCount: data.turnCount } : {}),
      ...(typeof data.emptyCount === "number" ? { emptyCount: data.emptyCount } : {}),
    },
  });
}

/**
 * Atomically claim finalization. Returns true only for the FIRST caller to move
 * the row out of the not-yet-finalized state. This prevents a double email
 * under the call-end race (conversation COMPLETED vs. Twilio status webhook).
 */
export async function claimFinalization(
  callSid: string,
  finalState: "COMPLETED" | "FAILED",
): Promise<boolean> {
  const res = await prisma.callSession.updateMany({
    where: { callSid, finalizedAt: null },
    data: { status: finalState, finalizedAt: new Date() },
  });
  return res.count === 1;
}

export async function markEmailSent(callSid: string) {
  return prisma.callSession.update({ where: { callSid }, data: { emailSentAt: new Date() } });
}

export async function linkContact(callSid: string, contactId: string) {
  return prisma.callSession.update({ where: { callSid }, data: { contactId } });
}
