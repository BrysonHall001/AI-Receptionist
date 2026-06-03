export type CallState = "INIT" | "GREETING" | "COLLECTING_INFO" | "COMPLETED" | "FAILED";

/** Permitted forward transitions. Backward moves are never allowed. */
const ALLOWED: Record<CallState, CallState[]> = {
  INIT: ["GREETING"],
  GREETING: ["GREETING", "COLLECTING_INFO", "COMPLETED"],
  COLLECTING_INFO: ["COLLECTING_INFO", "COMPLETED"],
  COMPLETED: ["COMPLETED"],
  FAILED: ["FAILED"],
};

export function isTerminal(state: CallState): boolean {
  return state === "COMPLETED" || state === "FAILED";
}

/**
 * Deterministically resolve the next state. An AI-requested transition is
 * honored only if permitted from the current state; otherwise the call stays in
 * a safe state (never moves backward, never leaves a terminal state).
 */
export function resolveNextState(current: CallState, requested: CallState): CallState {
  if (isTerminal(current)) return current;
  if (ALLOWED[current].includes(requested)) return requested;
  return current === "INIT" ? "GREETING" : current;
}
