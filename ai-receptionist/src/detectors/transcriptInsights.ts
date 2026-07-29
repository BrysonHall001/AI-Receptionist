// TRANSCRIPT INSIGHTS — three detectors over what CALLERS said.
//
// These are the batch-31 detector shape exactly (id, label, description,
// lookbackDays, floor, run), registered into the same nightly sweep, producing
// Suggestion rows through the same service and rendered by the same cards.
// Nothing here is a new pipeline.
//
// NO MODEL IS CALLED. Every number below comes from SQL and string counting
// over transcripts already stored. Token cost is zero.
//
// WHAT IS STORED: a capped phrase and counts. Never a transcript body, never a
// turn, never anything that survived transcriptPhrases' privacy gate.
import { prisma } from "../db/client";
import { tallyPhrases, PHRASE_LIMITS } from "../services/transcriptPhrases";
import type { DetectorDef, Finding } from "./index";

const db = prisma as any;
const DAY = 86400000;

/** Shared floors, stated once so the preferences copy and the code agree. */
export const TOPIC_FLOOR = { distinctCalls: 6, distinctDays: 3, lookbackDays: 30 };
export const RISING_FLOOR = { current: 8, ratio: 2.5, lookbackDays: 30 };
export const OUTCOME_FLOOR = { calls: 12, share: 0.4, lookbackDays: 30 };

/** Title-case for display only; the stored phrase stays lowercase. */
const pretty = (phrase: string) => phrase.replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------- detector 5
// FREQUENT CALL TOPIC — something callers keep raising.
//
// Counted by DISTINCT CALL across DISTINCT DAYS, so neither one long call nor
// one busy afternoon can invent a topic.
const frequentCallTopic: DetectorDef = {
  id: "frequent_call_topic",
  label: "Frequent call topic",
  description: "Something callers keep bringing up on the phone that your receptionist may not be briefed on.",
  lookbackDays: TOPIC_FLOOR.lookbackDays,
  floor: `at least ${TOPIC_FLOOR.distinctCalls} different calls across ${TOPIC_FLOOR.distinctDays} different days in ${TOPIC_FLOOR.lookbackDays} days`,
  run: async (tenantId: string): Promise<Finding[]> => {
    const { tally } = await tallyPhrases(tenantId, TOPIC_FLOOR.lookbackDays);
    const qualifying = Array.from(tally.values())
      .filter((p) => p.distinctCalls >= TOPIC_FLOOR.distinctCalls && p.distinctDays >= TOPIC_FLOOR.distinctDays)
      // Longer phrases first: "payment plan option" says more than "payment plan".
      .sort((a, b) => b.distinctCalls - a.distinctCalls || b.phrase.length - a.phrase.length);
    if (!qualifying.length) return [];
    // ONE observation per sweep, like the batch-31 phrase detector: five cards
    // about five overlapping n-grams of the same topic is noise, not insight.
    const top = qualifying[0];
    return [{
      dedupeKey: `calltopic:${top.phrase}`,
      type: "frequent_call_topic",
      title: `Callers keep asking about “${top.phrase}” — brief your receptionist on it?`,
      transparency: `Heard in ${top.distinctCalls} different calls across ${top.distinctDays} days in the last ${TOPIC_FLOOR.lookbackDays} days`,
      finding: {
        phrase: top.phrase.slice(0, PHRASE_LIMITS.MAX_PHRASE_CHARS),
        distinct_calls: top.distinctCalls,
        distinct_days: top.distinctDays,
        window_days: TOPIC_FLOOR.lookbackDays,
      },
      proposedAction: { type: "open_ai_instructions", params: { phrase: top.phrase.slice(0, PHRASE_LIMITS.MAX_PHRASE_CHARS) } },
    }];
  },
};

// ---------------------------------------------------------------- detector 6
// RISING CALL TOPIC — something callers have started raising.
//
// The floor exists to stop small numbers looking like trends: 2 -> 4 doubles
// but means nothing, so the CURRENT window must also clear an absolute count.
const risingCallTopic: DetectorDef = {
  id: "rising_call_topic",
  label: "Rising call topic",
  description: "Something callers have started mentioning far more than they used to.",
  lookbackDays: RISING_FLOOR.lookbackDays,
  floor: `at least ${RISING_FLOOR.current} calls in the last ${RISING_FLOOR.lookbackDays} days AND ${RISING_FLOOR.ratio}\u00d7 the ${RISING_FLOOR.lookbackDays} days before`,
  run: async (tenantId: string, now: Date): Promise<Finding[]> => {
    const end = now || new Date();
    const priorEnd = new Date(end.getTime() - RISING_FLOOR.lookbackDays * DAY);
    const [current, prior] = await Promise.all([
      tallyPhrases(tenantId, RISING_FLOOR.lookbackDays, end),
      tallyPhrases(tenantId, RISING_FLOOR.lookbackDays, priorEnd),
    ]);
    const risers = Array.from(current.tally.values())
      .filter((p) => p.distinctCalls >= RISING_FLOOR.current)
      .map((p) => {
        const before = prior.tally.get(p.phrase);
        const wasCount = before ? before.distinctCalls : 0;
        // A phrase absent before is treated as rising from 1, so a brand-new
        // topic is judged on its own volume rather than dividing by zero.
        const ratio = p.distinctCalls / Math.max(1, wasCount);
        return { p, wasCount, ratio };
      })
      .filter((x) => x.ratio >= RISING_FLOOR.ratio)
      .sort((a, b) => b.ratio - a.ratio || b.p.distinctCalls - a.p.distinctCalls);
    if (!risers.length) return [];
    const top = risers[0];
    return [{
      dedupeKey: `callrising:${top.p.phrase}`,
      type: "rising_call_topic",
      title: `Callers mention “${top.p.phrase}” far more than they used to`,
      transparency: `${top.p.distinctCalls} calls in the last ${RISING_FLOOR.lookbackDays} days, against ${top.wasCount} in the ${RISING_FLOOR.lookbackDays} days before`,
      finding: {
        phrase: top.p.phrase.slice(0, PHRASE_LIMITS.MAX_PHRASE_CHARS),
        distinct_calls: top.p.distinctCalls,
        previous_calls: top.wasCount,
        window_days: RISING_FLOOR.lookbackDays,
      },
      proposedAction: { type: "none_calls", params: {} },
    }];
  },
};

// ---------------------------------------------------------------- detector 7
// CALLS THAT LED NOWHERE.
//
// A call counts as having an OUTCOME when any of the three real links exist:
// a committed booking, a captured contact, or a scheduled appointment the
// finalize path recorded (callOrchestrator's finalize targets). A call with
// none of them ended without producing anything the portal can act on.
//
// This is deliberately coarse and the card says so — it is a prompt to listen
// to a few calls, not a verdict about wasted time.
const callsWithoutOutcome: DetectorDef = {
  id: "calls_without_outcome",
  label: "Calls that led nowhere",
  description: "A meaningful share of calls ended without a booking, a contact, or a request being captured.",
  lookbackDays: OUTCOME_FLOOR.lookbackDays,
  floor: `at least ${OUTCOME_FLOOR.calls} calls in ${OUTCOME_FLOOR.lookbackDays} days, with ${Math.round(OUTCOME_FLOOR.share * 100)}% or more producing nothing`,
  run: async (tenantId: string, now: Date): Promise<Finding[]> => {
    const end = now || new Date();
    const start = new Date(end.getTime() - OUTCOME_FLOOR.lookbackDays * DAY);
    const calls = await db.callSession.findMany({
      where: { tenantId, createdAt: { gte: start, lt: end } },
      select: { id: true, contactId: true, committedAppointmentAt: true, extracted: true },
      take: PHRASE_LIMITS.MAX_CALLS,
    });
    if (calls.length < OUTCOME_FLOOR.calls) return [];
    const withoutOutcome = calls.filter((c: any) => {
      if (c.contactId) return false;                       // a caller was captured
      if (c.committedAppointmentAt) return false;          // a booking was committed
      const ex = c.extracted && typeof c.extracted === "object" ? c.extracted : {};
      if (ex.appointment_datetime) return false;           // finalize recorded a time
      if (ex.request_title || ex.request_details) return false;  // a request was captured
      return true;
    });
    const share = withoutOutcome.length / calls.length;
    if (share < OUTCOME_FLOOR.share) return [];
    const pct = Math.round(share * 100);
    return [{
      // One per window, not one per call: the dedupe key carries the window so
      // a later month can raise it again without re-nagging about this one.
      dedupeKey: `callsnowhere:${OUTCOME_FLOOR.lookbackDays}`,
      type: "calls_without_outcome",
      title: `${pct}% of calls in the last ${OUTCOME_FLOOR.lookbackDays} days ended without a booking or a captured caller`,
      transparency: `${withoutOutcome.length} of ${calls.length} calls in the last ${OUTCOME_FLOOR.lookbackDays} days recorded no booking, no contact and no request`,
      finding: {
        calls_without_outcome: withoutOutcome.length,
        calls_total: calls.length,
        share_percent: pct,
        window_days: OUTCOME_FLOOR.lookbackDays,
      },
      proposedAction: { type: "none_calls", params: {} },
    }];
  },
};

export const TRANSCRIPT_DETECTORS: DetectorDef[] = [frequentCallTopic, risingCallTopic, callsWithoutOutcome];
