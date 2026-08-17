/**
 * Pricing.
 *
 * The pass is priced in USD but charged in GHS, because the Paystack account
 * settles in cedis. Conversion happens at payment time against a live rate,
 * with a conservative fallback so we never under-charge.
 *
 * Every amount that reaches Paystack is an integer number of pesewas. Paystack
 * rejects a non-integer amount, and a fractional value that survives to the
 * request body fails the charge rather than rounding, so the conversion is the
 * one place this has to be right.
 */

import { reportError } from "./report-error";

export const PASS_PRICE_USD = 3;

/** Used when the FX lookup fails or returns something implausible. */
export const FALLBACK_USD_TO_GHS = 15;

/**
 * Plausible band for USD to GHS.
 *
 * A rate outside this is treated as a bad reading, not as news. The upstream
 * feed is free and unauthenticated: if it ever returns 0, 1, or a rate quoted
 * the other way round, converting against it would charge a customer pesewas
 * instead of cedis, or several hundred times the intended price. Falling back
 * to a known-sane figure is the safe direction to fail in.
 */
export const MIN_USD_TO_GHS = 8;
export const MAX_USD_TO_GHS = 60;

/** Paystack rejects anything under GHS 1 on a cedi transaction. */
export const PAYSTACK_MIN_PESEWAS = 100;

export const EXTRA_PICK_GAMES_PER_LEAGUE = 3;
export const EXTRA_PICK_GAMES_PER_GROUP = 3;
export const EXTRA_PICK_PRICE_PER_GROUP_USD = 2;

/**
 * Convert a USD price to whole pesewas.
 *
 * Rounds UP, not to nearest. Rounding to nearest gives away up to half a pesewa
 * on every transaction and, more importantly, can settle below the price we
 * advertised: $4 at 11.1111 is 4444.44 pesewas, which Math.round bills as 4444.
 * Rounding up can only ever favour us, and only by a fraction of a pesewa.
 *
 * The 1e-6 normalisation before the ceiling handles binary floating point.
 * 3 * 15.31 * 100 evaluates to 4592.999999999999, and a bare Math.ceil would
 * turn that into a pesewa of pure arithmetic artifact. Clean products stay
 * clean; genuine fractions still round up.
 */
export function usdToPesewas(usd: number, rate: number): number {
  if (!Number.isFinite(usd) || !Number.isFinite(rate) || usd <= 0 || rate <= 0) {
    throw new Error(`Cannot price ${usd} USD at rate ${rate}.`);
  }

  const exact = usd * rate * 100;
  const normalised = Math.round(exact * 1e6) / 1e6;
  const pesewas = Math.ceil(normalised);

  // Paystack would reject this after we had already written a payments row, so
  // catch it while the failure is still ours to explain.
  if (pesewas < PAYSTACK_MIN_PESEWAS) {
    throw new Error(
      `${usd} USD converts to ${pesewas} pesewas, below the Paystack minimum of ${PAYSTACK_MIN_PESEWAS}.`,
    );
  }

  return pesewas;
}

/** $2 per group of up to 3 games. 1 to 3 games is $2, 4 to 6 is $4. */
export function extraPicksPriceUsd(numGames: number): number {
  if (!Number.isFinite(numGames) || numGames <= 0) return 0;
  return (
    Math.ceil(numGames / EXTRA_PICK_GAMES_PER_GROUP) *
    EXTRA_PICK_PRICE_PER_GROUP_USD
  );
}

/**
 * Does a settled payment match what we asked for?
 *
 * Compares against the amount recorded on the payments row, which is the exact
 * integer handed to Paystack at initialise time. The previous check recomputed
 * a floor from a minimum exchange rate, so a payment of GHS 30 satisfied a
 * charge of GHS 48: a different, much looser number than the one we billed.
 * There is no reason to re-derive a figure we already stored.
 *
 * Overpayment passes. Paystack will not produce one, but refusing money that
 * has already settled helps nobody.
 */
export function paymentAmountMatches(
  expected: { amountMinor: number; currency: string },
  settled: { amountMinor: number; currency: string },
): boolean {
  return (
    settled.currency === expected.currency &&
    Number.isFinite(settled.amountMinor) &&
    settled.amountMinor >= expected.amountMinor
  );
}

/**
 * Cached rate.
 *
 * The lookup used to run on every checkout, putting a free unauthenticated
 * third party in the critical path of taking money. An hour is short enough
 * that a real move is picked up the same session and long enough that a slow
 * upstream stops being felt by every customer at once.
 */
let cached: { rate: number; at: number } | null = null;
const RATE_TTL_MS = 60 * 60 * 1000;

/** Test seam. Exported so a suite can force a cold lookup. */
export function clearRateCache() {
  cached = null;
}

export async function getUsdToGhsRate(): Promise<number> {
  if (cached && Date.now() - cached.at < RATE_TTL_MS) return cached.rate;

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return fallbackRate(`rate provider returned HTTP ${res.status}`);

    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.GHS;

    if (typeof rate !== "number" || !Number.isFinite(rate)) {
      return fallbackRate("rate provider returned no usable GHS rate");
    }
    if (rate < MIN_USD_TO_GHS || rate > MAX_USD_TO_GHS) {
      // Not cached: a bad reading should not be held for an hour.
      return fallbackRate(
        `USD/GHS came back as ${rate}, outside ${MIN_USD_TO_GHS} to ${MAX_USD_TO_GHS}`,
      );
    }

    cached = { rate, at: Date.now() };
    return rate;
  } catch (err) {
    return fallbackRate(
      err instanceof Error ? `rate lookup failed: ${err.message}` : "rate lookup failed",
    );
  }
}

/**
 * Fall back to the hardcoded rate, loudly.
 *
 * This is a pricing path. Every second it runs, customers are charged at a
 * constant that was correct on the day it was written and drifts from then on,
 * and the previous version reached it silently on a timeout or a bad payload:
 * the FX provider could be down for a week and nothing would say so. The
 * fallback is still the right behaviour, refusing the sale over a rate lookup
 * would be worse, but it is an incident, not a default.
 */
function fallbackRate(reason: string): number {
  reportError(new Error(`[pricing] ${reason}. Charging at the ${FALLBACK_USD_TO_GHS} fallback.`), {
    scope: "pricing/usd-ghs",
  });
  return FALLBACK_USD_TO_GHS;
}

/** UTC day key. Every access rule is keyed to the UTC day. */
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
