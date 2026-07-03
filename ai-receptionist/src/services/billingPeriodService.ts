// Billing period math. Given a BillingConfig-like object + a reference instant, return the
// [periodStart, periodEnd] window that `now` falls in, for monthly / annual / custom terms.
// All boundaries are UTC. periodEnd is the last instant of the period (…:59.999).

export interface PeriodConfigLike {
  billingPeriod: string;            // "monthly" | "annual" | "custom"
  customPeriodDays?: number | null;
  contractStart?: Date | string | null;
}

export interface Period { periodStart: Date; periodEnd: Date; }

const DAY = 86400000;
const CUSTOM_EPOCH = Date.UTC(2000, 0, 1); // stable anchor when no contractStart is set

function endOfDayBefore(ms: number): Date { return new Date(ms - 1); } // last instant before ms

export function currentPeriod(cfg: PeriodConfigLike, now: Date = new Date()): Period {
  const n = now.getTime();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  if (cfg.billingPeriod === "monthly") {
    const start = Date.UTC(y, m, 1);
    const nextStart = Date.UTC(y, m + 1, 1);
    return { periodStart: new Date(start), periodEnd: endOfDayBefore(nextStart) };
  }

  if (cfg.billingPeriod === "annual") {
    const cs = cfg.contractStart ? new Date(cfg.contractStart) : null;
    if (cs) {
      const am = cs.getUTCMonth(), ad = cs.getUTCDate();
      const anniv = Date.UTC(y, am, ad);
      if (n >= anniv) return { periodStart: new Date(anniv), periodEnd: endOfDayBefore(Date.UTC(y + 1, am, ad)) };
      return { periodStart: new Date(Date.UTC(y - 1, am, ad)), periodEnd: endOfDayBefore(anniv) };
    }
    // No contract anchor -> calendar year.
    return { periodStart: new Date(Date.UTC(y, 0, 1)), periodEnd: endOfDayBefore(Date.UTC(y + 1, 0, 1)) };
  }

  // custom: fixed-length windows of customPeriodDays, anchored on contractStart (or a stable
  // epoch). Falls back to monthly if the day count is missing/invalid.
  const days = Math.trunc(Number(cfg.customPeriodDays) || 0);
  if (!days || days <= 0) {
    const start = Date.UTC(y, m, 1);
    return { periodStart: new Date(start), periodEnd: endOfDayBefore(Date.UTC(y, m + 1, 1)) };
  }
  const anchor = cfg.contractStart ? new Date(cfg.contractStart).getTime() : CUSTOM_EPOCH;
  const span = days * DAY;
  const k = Math.floor((n - anchor) / span);
  const start = anchor + k * span;
  return { periodStart: new Date(start), periodEnd: endOfDayBefore(start + span) };
}

// Is `now` inside the tenant's contract window? Missing bounds mean "no bound on that side".
export function withinContract(cfg: { contractStart?: Date | string | null; contractEnd?: Date | string | null }, now: Date = new Date()): boolean {
  const n = now.getTime();
  if (cfg.contractStart && n < new Date(cfg.contractStart).getTime()) return false;
  if (cfg.contractEnd && n > new Date(cfg.contractEnd).getTime()) return false;
  return true;
}
