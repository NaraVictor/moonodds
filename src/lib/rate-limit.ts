import { NextResponse } from "next/server";

/**
 * Rate limiting.
 *
 * Nothing throttled sign-in, checkout, the Office OTP or slip creation, which
 * left credential stuffing, unbounded payment-row creation and a brute-forcible
 * six-digit code that gates the engine's own system prompt.
 *
 * IN-PROCESS AND DELIBERATELY SO, FOR NOW. A serverless deployment runs many
 * instances, so this bounds abuse per instance rather than globally: a
 * determined attacker spread across instances gets a multiple of these limits.
 * That is a large improvement over no limit at all and is honest about what it
 * is. Moving the counter to Postgres or Upstash makes it global; the call sites
 * do not change when that happens, which is why the limiter is behind this
 * interface rather than inline.
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
export function enforceRateLimit(
  request: Request,
  opts: { scope: string; limit: number; windowSeconds: number; message: string; extraKey?: string },
): NextResponse | null {
  const key = opts.extraKey
    ? `${clientKey(request, opts.scope)}:${opts.extraKey}`
    : clientKey(request, opts.scope);

  const verdict = rateLimit(key, opts.limit, opts.windowSeconds);
  return verdict.ok ? null : tooManyRequests(verdict, opts.message);
}
