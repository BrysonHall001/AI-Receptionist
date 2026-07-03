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
  // Non-status fields are written unconditionally (they're safe to update at any
  // time, e.g. appending a transcript turn).
  const base: Record<string, unknown> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(data.transcript ? { transcript: data.transcript as any } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(data.extracted ? { extracted: data.extracted as any } : {}),
    ...(typeof data.turnCount === "number" ? { turnCount: data.turnCount } : {}),
    ...(typeof data.emptyCount === "number" ? { emptyCount: data.emptyCount } : {}),
  };
  if (Object.keys(base).length > 0) {
    await prisma.callSession.update({ where: { callSid }, data: base });
  }

  // STATUS IS GUARDED: only move a call that has NOT been finalized. This stops a
  // late or concurrent turn (the walkie call-end race: a turn still in flight when
  // the hang-up status callback finalizes the call) from reverting a
  // COMPLETED/FAILED row back to an "in progress" status. Without this, a
  // finalized walkie call could display as "In progress" even though finalize ran.
  if (data.status) {
    await prisma.callSession.updateMany({
      where: { callSid, finalizedAt: null },
      data: { status: data.status },
    });
  }
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

// Accumulate OpenAI token usage onto the call (summed across turns) + record the model.
// Best-effort: callers wrap this so usage capture can NEVER break a call.
export async function addCallUsage(
  callSid: string,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  llmModel?: string | null,
) {
  await prisma.callSession.update({
    where: { callSid },
    data: {
      promptTokens: { increment: Math.max(0, Math.trunc(usage.promptTokens || 0)) },
      completionTokens: { increment: Math.max(0, Math.trunc(usage.completionTokens || 0)) },
      totalTokens: { increment: Math.max(0, Math.trunc(usage.totalTokens || 0)) },
      ...(llmModel ? { llmModel } : {}),
    } as any,
  });
}

// Store the billable call duration (whole seconds). Uses updateMany so it is a safe no-op if
// the row is absent, and can run STANDALONE (independent of finalize) any number of times —
// last write wins, so Twilio's authoritative CallDuration overwrites any earlier fallback.
export async function setCallDuration(callSid: string, durationSeconds: number) {
  await prisma.callSession.updateMany({
    where: { callSid },
    data: { durationSeconds: Math.max(0, Math.trunc(durationSeconds)) } as any,
  });
}

export async function linkContact(callSid: string, contactId: string) {
  return prisma.callSession.update({ where: { callSid }, data: { contactId } });
}

/**
 * Persist the backend-owned booking commitment captured when the AI calls the
 * confirm_booking tool. Written by handleTurn (the SOLE session writer) so it
 * never races the per-turn update. appointmentAt is the zoneless wall-clock
 * string ("YYYY-MM-DDTHH:MM") stored verbatim — no timezone conversion. Cast to
 * `any` so this compiles before `prisma generate` adds the new columns (same
 * pattern as the rest of the codebase's `prisma as any`).
 */
export async function setCommittedBooking(
  callSid: string,
  committedResourceId: string | null,
  committedAppointmentAt: string | null,
) {
  return (prisma as any).callSession.update({
    where: { callSid },
    data: { committedResourceId, committedAppointmentAt },
  });
}
