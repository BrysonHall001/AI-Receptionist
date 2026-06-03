import { env } from "../config/env";
import { logger } from "../utils/logger";
import { prisma } from "../db/client";
import { runAITurn, AIEngineError } from "../ai/engine";
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

export interface TurnResult {
  messageToSpeak: string;
  state: CallState;
  done: boolean;
}

/** Resolve the tenant for a called number, falling back to the first tenant. */
async function resolveTenantId(toNumber?: string | null): Promise<string | null> {
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
export async function handleTurn(params: { callSid: string; speech: string }): Promise<TurnResult> {
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
    const ai = await runAITurn({
      context: {
        businessName: tenant.name,
        businessType: tenant.businessType,
        currentState: state,
        alreadyExtracted: extracted,
        callerPhone: session.fromNumber,
      },
      history: toOpenAIMessages(transcript),
      latestCallerUtterance: speech,
    });
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

  // Persist the contact (no duplicate per tenant+phone).
  try {
    const contact = await createOrUpdateContact({
      tenantId: tenant.id,
      phone,
      name: extracted.name ?? null,
      email: extracted.email ?? null,
      intent: extracted.intent ?? null,
    });
    await linkContact(callSid, contact.id);
  } catch (err) {
    // Call row is already persisted + finalized; continue to notification.
    logger.error(`Contact upsert failed for ${callSid}: ${(err as Error).message}`);
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
  };
}
