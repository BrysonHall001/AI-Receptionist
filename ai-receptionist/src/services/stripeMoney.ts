// Single source of truth for converting between our decimal amounts and Stripe's minor units.
// Used on BOTH sides of the wire so they can never diverge:
//   - outbound (invoice creation): toMinorUnits(amount, currency)
//   - inbound  (webhook amounts):  fromMinorUnits(minor, currency)
// Zero-decimal currencies (JPY, KRW, …) have NO fractional unit, so Stripe expects/returns the
// whole value directly (no ×100 / ÷100).

export const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL.has((currency || "usd").toLowerCase());
}

/** Decimal amount (e.g. 12.34 USD or 5000 JPY) -> Stripe minor units (1234 or 5000). */
export function toMinorUnits(amount: number, currency: string): number {
  const a = Number(amount) || 0;
  return isZeroDecimal(currency) ? Math.round(a) : Math.round(a * 100);
}

/** Stripe minor units -> decimal amount. */
export function fromMinorUnits(amount: number, currency: string): number {
  const a = Number(amount) || 0;
  return isZeroDecimal(currency) ? Math.round(a) : Math.round(a) / 100;
}
