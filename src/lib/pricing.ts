/**
 * Pricing.
 *
 * The pass is priced in USD but charged in GHS, because the Paystack account
 * settles in cedis. Conversion happens at payment time against a live rate,
 * with a conservative fallback so we never under-charge.
 */

export const PASS_PRICE_USD = 3;

/** Used when the FX lookup fails. Kept slightly high on purpose. */
export const FALLBACK_USD_TO_GHS = 15;

/** Floor rate used to sanity-check a paid amount at verify time. */
export const MIN_USD_TO_GHS = 10;

export const EXTRA_PICK_GAMES_PER_LEAGUE = 3;
export const EXTRA_PICK_GAMES_PER_GROUP = 3;
export const EXTRA_PICK_PRICE_PER_GROUP_USD = 2;

export function usdToPesewas(usd: number, rate: number): number {
  return Math.round(usd * rate * 100);
}

/** $2 per group of up to 3 games. */
export function extraPicksPriceUsd(numGames: number): number {
  if (numGames <= 0) return 0;
  return (
    Math.ceil(numGames / EXTRA_PICK_GAMES_PER_GROUP) *
    EXTRA_PICK_PRICE_PER_GROUP_USD
  );
}

export async function getUsdToGhsRate(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return FALLBACK_USD_TO_GHS;
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.GHS;
    return typeof rate === "number" && rate > 0 ? rate : FALLBACK_USD_TO_GHS;
  } catch {
    return FALLBACK_USD_TO_GHS;
  }
}

/** UTC day key — every access rule is keyed to the UTC day. */
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
