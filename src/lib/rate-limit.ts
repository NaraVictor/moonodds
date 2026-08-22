import { NextResponse } from "next/server";
import { createServiceClient } from "./supabase/server";

/**
 * Rate limiting.
 *
 * Nothing throttled sign-in, checkout, the Office OTP or slip creation, which
 * left credential stuffing, unbounded payment-row creation and a brute-forcible
 * six-digit code that gates the engine's own system prompt.
 *
 * SHARED, via Postgres. This used to be an in-process Map, which on a
 * serverless deployment meant every instance carried its own counters: the
 * effective limit was the configured limit times however many instances were
 * warm, weakest under exactly the load that spins up more of them.
 *
 * Postgres rather than Redis because the database is already a hard dependency
 * on every path that calls this, so it adds no new service and no new failure
 * mode. `hit_rate_limit` increments atomically inside one statement, so two
 * instances racing on the same key cannot both read the same count.
 *
 * The in-process map survives as a FALLBACK, not as the mechanism. If the
 * database call fails, blocking every checkout because a counter could not be
 * written is a worse outcome than falling back to a per-instance bound, so it
 * degrades to what it used to be and says so in the log.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Keeps the map from growing without bound on a long-lived instance. */
function sweep(now: number) {
  if (buckets.size < 5_000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitVerdict = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitVerdict {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count++;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds,
  };
}

/**
 * Best-effort client identity.
 *
 * Vercel sets x-forwarded-for and strips anything the client sent, so on the
 * target platform this is trustworthy. Anywhere behind a proxy that does not,
 * it is spoofable, which is why limits that protect something valuable are also
 * keyed on the authenticated user where one exists.
 */
export function clientKey(request: Request, scope: string): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

/** The 429, with the header a well-behaved client will actually honour. */
export function tooManyRequests(verdict: RateLimitVerdict, message: string) {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        "Retry-After": String(verdict.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * Guard a route in one line.
 *
 * Returns a response to send, or null to continue.
 */
export async function enforceRateLimit(
  request: Request,
  opts: { scope: string; limit: number; windowSeconds: number; message: string; extraKey?: string },
): Promise<NextResponse | null> {
  const key = opts.extraKey
    ? `${clientKey(request, opts.scope)}:${opts.extraKey}`
    : clientKey(request, opts.scope);

  const verdict = await sharedRateLimit(key, opts.limit, opts.windowSeconds);
  return verdict.ok ? null : tooManyRequests(verdict, opts.message);
}

/**
 * The shared counter, with the local one behind it.
 *
 * Deliberately not exported: every caller should go through enforceRateLimit
 * so the fallback behaviour is identical everywhere.
 */
async function sharedRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict> {
  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc("hit_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed: boolean; remaining: number; retry_after_seconds: number }
      | undefined;

    if (!row) throw new Error("hit_rate_limit returned no row");

    return {
      ok: row.allowed,
      remaining: row.remaining,
      retryAfterSeconds: row.retry_after_seconds,
    };
  } catch (err) {
    // Degrade to per-instance rather than locking everyone out of checkout
    // because a counter could not be written.
    console.warn(
      `[rate-limit] shared counter unavailable, falling back to in-process:`,
      err instanceof Error ? err.message : err,
    );
    return rateLimit(key, limit, windowSeconds);
  }
}
