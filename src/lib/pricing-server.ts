import { createServiceClient } from "./supabase/server";
import { getUsdToGhsRate, resolveFallbackRate } from "./pricing";
import { reportError } from "./report-error";

/**
 * Server-side pricing.
 *
 * Split from `pricing.ts` because that module is imported by the checkout
 * *client* component. Importing the service-role Supabase client there would
 * put a server credential in the browser bundle, so the database read lives
 * here and the pure arithmetic stays where both sides can use it.
 */

/** Short cache. The override changes by hand, and never mid-checkout. */
let cached: { rate: number | null; at: number } | null = null;
const TTL_MS = 60_000;

/** Test seam, and used by the Office after a write so the next read is fresh. */
export function clearFxFallbackCache() {
  cached = null;
}

/**
 * The Office override, or null when none is set.
 *
 * A failure here is not fatal: `resolveFallbackRate` still has the environment
 * variable and the compiled-in constant beneath it. But it is reported, because
 * silently ignoring an operator's deliberate price setting is exactly the class
 * of failure the rest of this path was just hardened against.
 */
export async function officeFxFallback(): Promise<number | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rate;

  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc("get_fx_fallback");
    if (error) throw new Error(error.message);

    const rate = typeof data === "number" && Number.isFinite(data) ? data : null;
    cached = { rate, at: Date.now() };
    return rate;
  } catch (err) {
    reportError(err, { scope: "pricing/office-fallback" });
    return null;
  }
}

/** `getUsdToGhsRate`, with the Office override wired in. Use this in routes. */
export async function getUsdToGhsRateForServer(): Promise<number> {
  return getUsdToGhsRate(await officeFxFallback());
}

/** What the Office shows: the rate in force and which layer supplied it. */
export async function currentFallback(): Promise<{
  rate: number;
  source: "office" | "env" | "constant";
  officeValue: number | null;
}> {
  const officeValue = await officeFxFallback();
  return { ...resolveFallbackRate(officeValue), officeValue };
}
