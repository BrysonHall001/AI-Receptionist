import { env } from "../config/env";
import { logger } from "../utils/logger";
import { prisma } from "../db/client";
import { runAITurn, AIEngineError, ChatCaller } from "../ai/engine";
import { Extracted } from "../ai/schema";
import { resolveNextState, isTerminal, CallState } from "../callflow/stateMachine";
import { appendTurn, toOpenAIMessages, TranscriptTurn } from "../utils/transcript";
import {
  createCallSession,
  getCallSession,
  updateCallSession,
  claimFinalization,
  markEmailSent,
  linkContact,
} from "./callSessionService";
import { createOrUpdateContact, phoneFromExtracted } from "./contactService";
import { sendCallSummaryEmail } from "./notificationService";
import { createBookingFromCall } from "./bookingCaptureService";
import { buildHoursContext } from "./availabilityService";

export interface TurnResult {
  messageToSpeak: string;
  state: CallState;
  done: boolean;
}

/** Resolve the tenant for a called number, falling back to the first tenant. */
export async function resolveTenantId(toNumber?: string | null): Promise<string | null> {
  if (toNumber) {
    const matched = await prisma.tenant.findUnique({ where: { phoneNumber: toNumber } });
    if (matched) return matched.id;
  }
  const first = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  return first?.id ?? null;
}

/** LAYER 2/5: create the call session and produce the deterministic greeting. */
export async function startCall(params: {
  callSid: string;
  from: string;
  to?: string | null;
  tenantId?: string | null;
}): Promise<TurnResult> {
  const existing = await getCallSession(params.callSid);
  if (existing) {
    // Duplicate inbound webhook for a known call -> idempotent re-greet.
    const tenant = await prisma.tenant.findUnique({ where: { id: existing.tenantId } });
    const msg = tenant?.greeting ?? "Hello, how can I help you?";
    const state = existing.status as CallState;
    return { messageToSpeak: msg, state, done: isTerminal(state) };
  }

  const tenantId = params.tenantId || (await resolveTenantId(params.to));
  if (!tenantId) throw new Error("No tenant configured. Run `npm run seed` first.");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  await createCallSession({
    callSid: params.callSid,
    tenantId,
    fromNumber: params.from,
    toNumber: params.to ?? null,
  });
  const transcript = appendTurn([], "assistant", tenant.greeting);
  await updateCallSession(params.callSid, { transcript, status: "GREETING" });

  logger.info(`Call ${params.callSid} started for tenant ${tenantId}`);
  return { messageToSpeak: tenant.greeting, state: "GREETING", done: false };
}

/** LAYER 2/3: process one caller utterance through the AI + state machine. */
/** Replace the most recent assistant turn's text with what the caller actually
 *  heard before barging in (plus a marker). Immutable; returns a new array. */
function correctLastAssistant(transcript: TranscriptTurn[], heard: string): TranscriptTurn[] {
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === "assistant") {
      const copy = transcript.slice();
      copy[i] = { ...copy[i], text: `${heard} …[caller interrupted]` };
      return copy;
    }
  }
  return transcript;
}

export async function handleTurn(params: { callSid: string; speech: string; onLookupStart?: () => void; chat?: ChatCaller; interruptedHeard?: string | null }): Promise<TurnResult> {
  const session = await getCallSession(params.callSid);
  if (!session) {
    // Unknown call -> start one so we never drop a caller.
    return startCall({ callSid: params.callSid, from: "unknown", to: null });
  }

  const state = session.status as CallState;
  if (isTerminal(state)) {
    return { messageToSpeak: "Thanks again, goodbye.", state, done: true };
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: session.tenantId } });
  let transcript = session.transcript as unknown as TranscriptTurn[];
  let extracted = session.extracted as unknown as Extracted;
  let emptyCount = session.emptyCount;

  // If the caller barged in over the previous reply, correct the transcript so the
  // model sees only what the caller actually HEARD — otherwise it thinks it said a
  // whole reply the caller never heard, and loses the thread. handleTurn is the
  // SOLE writer of the call session, so this update is race-free.
  const heard = (params.interruptedHeard ?? "").trim();
  if (heard.length > 0) {
    transcript = correctLastAssistant(transcript, heard);
  }

  const speech = (params.speech ?? "").trim();

  // Timeout / no-speech handling (LAYER 2).
  if (speech.length === 0) {
    emptyCount += 1;
    if (emptyCount >= env.MAX_EMPTY_TURNS) {
      transcript = appendTurn(transcript, "system", "Caller silent; ending call.");
      await updateCallSession(params.callSid, { transcript, emptyCount });
      await finalizeCall(params.callSid, "COMPLETED");
      return { messageToSpeak: "I didn't catch anything, so I'll let you go. Goodbye.", state: "COMPLETED", done: true };
    }
  } else {
    emptyCount = 0;
    transcript = appendTurn(transcript, "caller", speech);
  }

  // Hard cap on conversation length to avoid runaway loops.
  if (session.turnCount >= env.MAX_TURNS) {
    await updateCallSession(params.callSid, { transcript });
    await finalizeCall(params.callSid, "COMPLETED");
    return {
      messageToSpeak: "Thanks, I have what I need. Someone will follow up shortly. Goodbye.",
      state: "COMPLETED",
      done: true,
    };
  }

  let aiMessage: string;
  let nextState: CallState;
  try {
    // Static, wall-clock-correct hours injected so the AI can STATE hours rather
    // than disclaim them. Best-effort: never block a turn if it can't be built.
    let hoursSummary = "";
    try {
      hoursSummary = await buildHoursContext(tenant.id);
    } catch (e) {
      logger.warn(`[orchestrator] buildHoursContext failed: ${(e as Error).message}`);
    }
    const ai = await runAITurn({
      tenantId: tenant.id,
      context: {
        businessName: tenant.name,
        businessType: tenant.businessType,
        currentState: state,
        alreadyExtracted: extracted,
        callerPhone: session.fromNumber,
        aiInstructions: (tenant as any).aiInstructions ?? "",
        currentDate: new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
        hoursSummary,
      },
      history: toOpenAIMessages(transcript),
      latestCallerUtterance: speech,
    }, { onLookupStart: params.onLookupStart, chat: params.chat });
    aiMessage = ai.message_to_speak;
    extracted = mergeExtracted(extracted, ai.extracted, session.fromNumber);
    nextState = resolveNextState(state, ai.state_update as CallState);
  } catch (err) {
    // FAILURE RECOVERY (LAYER 2/13): never crash the call; persist partial data.
    logger.error(`AI failed on ${params.callSid}: ${(err as Error).message}`);
    aiMessage = "Sorry, I'm having trouble right now. I've noted your call and someone will follow up shortly.";
    nextState = "COLLECTING_INFO";

    if (err instanceof AIEngineError && session.turnCount >= 2) {
      // Repeated AI failure -> give up gracefully but still persist + notify.
      transcript = appendTurn(transcript, "assistant", aiMessage);
      await updateCallSession(params.callSid, {
        transcript,
        extracted,
        emptyCount,
        turnCount: session.turnCount + 1,
      });
      await finalizeCall(params.callSid, "COMPLETED");
      return { messageToSpeak: aiMessage + " Goodbye.", state: "COMPLETED", done: true };
    }
  }

  transcript = appendTurn(transcript, "assistant", aiMessage);
  await updateCallSession(params.callSid, {
    transcript,
    extracted,
    status: nextState,
    emptyCount,
    turnCount: session.turnCount + 1,
  });

  if (isTerminal(nextState)) {
    await finalizeCall(params.callSid, "COMPLETED");
    return { messageToSpeak: aiMessage, state: nextState, done: true };
  }
  return { messageToSpeak: aiMessage, state: nextState, done: false };
}

/**
 * LAYER 5/6: finalize a call exactly once — persist the contact, then notify.
 * Idempotent via claimFinalization(); safe under the call-end race.
 */
export async function finalizeCall(callSid: string, finalState: "COMPLETED" | "FAILED"): Promise<void> {
  const claimed = await claimFinalization(callSid, finalState);
  if (!claimed) {
    logger.info(`Call ${callSid} already finalized; skipping.`);
    return;
  }

  const session = await getCallSession(callSid);
  if (!session) return;
  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) return;

  const extracted = session.extracted as unknown as Extracted;
  const transcript = session.transcript as unknown as TranscriptTurn[];
  const phone = phoneFromExtracted(extracted, session.fromNumber || `unknown:${callSid}`);

  // Visibility into exactly what we captured, on BOTH paths, so a missing
  // "reason" on the Calls page can be traced to extraction vs persistence.
  logger.info(
    `Call ${callSid} finalizing — extracted: name=${extracted.name ?? "-"} ` +
      `intent=${extracted.intent ?? "-"} phone=${extracted.phone ?? "-"} email=${extracted.email ?? "-"} ` +
      `appt=${extracted.appointment_datetime ?? "-"} service=${extracted.service ?? "-"}`,
  );

  // Persist the contact (no duplicate per tenant+phone).
  let contactId: string | null = null;
  try {
    const contact = await createOrUpdateContact({
      tenantId: tenant.id,
      phone,
      name: extracted.name ?? null,
      email: extracted.email ?? null,
      intent: extracted.intent ?? null,
      // The contact's IDENTITY is the spoken/entered phone (above). The verified
      // inbound caller ID is preserved separately so the two can differ (e.g.
      // someone booking from another person's phone) without colliding identities.
      callerId: session.fromNumber ?? null,
      source: "phone",
    });
    contactId = contact.id;
    await linkContact(callSid, contact.id);
  } catch (err) {
    // Call row is already persisted + finalized; continue to notification.
    logger.error(`Contact upsert failed for ${callSid}: ${(err as Error).message}`);
  }

  // Create a Booking ONLY when a concrete date+time was captured (capture-only).
  // Best-effort and fully guarded: a vague/no-time call makes no booking, and any
  // failure here can never break finalization or the summary email. No calendar
  // and no availability logic — just records what the caller asked for.
  if (contactId) {
    try {
      await createBookingFromCall({
        tenantId: tenant.id,
        contactId,
        appointmentDatetime: extracted.appointment_datetime ?? null,
        service: extracted.service ?? null,
        resource: extracted.resource ?? null,
        intent: extracted.intent ?? null,
        callSid,
      });
    } catch (err) {
      logger.error(`Booking capture failed for ${callSid}: ${(err as Error).message}`);
    }
  }

  // Notify exactly once (emailSentAt guards against duplicates).
  if (!session.emailSentAt) {
    try {
      await sendCallSummaryEmail({
        to: tenant.notifyEmail,
        businessName: tenant.name,
        extracted,
        fromNumber: session.fromNumber,
        transcript,
        startedAt: session.createdAt,
        completed: finalState === "COMPLETED",
      });
      await markEmailSent(callSid);
    } catch (err) {
      logger.error(`Email send failed for ${callSid}: ${(err as Error).message}`);
    }
  }

  logger.info(`Call ${callSid} finalized (${finalState}).`);
}

/** Abnormal terminal Twilio statuses (busy/failed/no-answer/canceled). */
export async function failCall(callSid: string, reason: string): Promise<void> {
  logger.warn(`Call ${callSid} ended abnormally: ${reason}`);
  await finalizeCall(callSid, "FAILED");
}

/** Merge newly extracted fields over prior ones; backfill phone from caller ID. */
function mergeExtracted(prev: Extracted, next: Extracted, fallbackPhone: string): Extracted {
  const pick = (a?: string | null, b?: string | null): string | null => {
    const bn = (b ?? "").trim();
    if (bn.length > 0) return bn;
    const an = (a ?? "").trim();
    return an.length > 0 ? an : null;
  };
  const phone = pick(prev.phone, next.phone);
  const usableFallback = fallbackPhone && fallbackPhone !== "unknown" ? fallbackPhone : null;
  return {
    name: pick(prev.name, next.name),
    intent: pick(prev.intent, next.intent),
    phone: phone ?? usableFallback,
    email: pick(prev.email, next.email),
    // Carry the booking fields forward too. The model is told to send the
    // confirmed time only once; merging keeps it if a later turn omits it.
    appointment_datetime: pick(prev.appointment_datetime, next.appointment_datetime),
    service: pick(prev.service, next.service),
  };
}

// How long a call may sit "in progress" with no activity before the safety-net
// sweep finalizes it. Configurable via env; defaults to 2 minutes.
const STALE_CALL_MINUTES = Number(process.env.STALE_CALL_MINUTES) || 2;

/**
 * SAFETY-NET FINALIZER. Any call still in progress (finalizedAt = null) with no
 * activity for STALE_CALL_MINUTES is finalized as COMPLETED. This guarantees a
 * call reliably reaches a terminal DB state even when the normal triggers are
 * missed — notably a WALKIE caller who hangs up mid-conversation, whose only
 * hangup signal is the Twilio status callback (which can be delayed or absent).
 *
 * Idempotent and shared: it calls the SAME finalizeCall as every other path, so
 * claimFinalization makes it a no-op for any call that already finalized (no
 * double email, no duplicate contact).
 */
export async function sweepStaleCalls(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CALL_MINUTES * 60_000);
  let stale: Array<{ callSid: string }> = [];
  try {
    stale = (await prisma.callSession.findMany({
      where: { finalizedAt: null, updatedAt: { lt: cutoff } },
      select: { callSid: true },
      take: 50,
    })) as Array<{ callSid: string }>;
  } catch (err) {
    logger.error(`[sweep] query failed: ${(err as Error).message}`);
    return 0;
  }
  let finalized = 0;
  for (const s of stale) {
    try {
      await finalizeCall(s.callSid, "COMPLETED");
      finalized += 1;
    } catch (err) {
      logger.error(`[sweep] finalize failed for ${s.callSid}: ${(err as Error).message}`);
    }
  }
  if (finalized > 0) {
    logger.info(`[sweep] finalized ${finalized} stale in-progress call(s) (no activity > ${STALE_CALL_MINUTES}m)`);
  }
  return finalized;
}
