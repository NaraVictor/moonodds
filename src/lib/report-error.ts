/**
 * One place errors are reported from.
 *
 * There was no monitoring at all: a failed cron run, a payment verification
 * error and an engine exception all landed in a server log nobody watches.
 * Combined with the zero-pick alert, that meant a broken day was invisible from
 * both directions, no alert on the symptom and none on the cause.
 *
 * Deliberately not a Sentry dependency. This is the seam: it always logs with
 * enough structure to be searchable, and forwards to Sentry only if a DSN is
 * configured, so the app carries no vendor coupling and works identically
 * without one. Swap the forwarder when you pick a provider.
 */

export type ErrorContext = {
  /** Where it happened, e.g. "cron/daily-picks". */
  scope: string;
  /** Anything that helps reproduce it. Never secrets, never card data. */
  detail?: Record<string, unknown>;
  /** Bump to "fatal" for something that needs waking someone up. */
  level?: "warning" | "error" | "fatal";
};

const REDACT = /(key|secret|token|password|authorization|cookie)/i;

/** Strips anything that looks like a credential before it reaches a log sink. */
function safeDetail(detail: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    out[k] = REDACT.test(k) ? "[redacted]" : v;
  }
  return out;
}

export function reportError(err: unknown, ctx: ErrorContext): void {
  const level = ctx.level ?? "error";
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Structured on one line so a log search can filter by scope and level
  // without a parser, which is what you actually do at 2am.
  const line = JSON.stringify({
    at: new Date().toISOString(),
    level,
    scope: ctx.scope,
    message,
    ...safeDetail(ctx.detail),
  });

  if (level === "warning") console.warn(`[kicka] ${line}`);
  else console.error(`[kicka] ${line}`, stack ?? "");

  forward(err, ctx, level);
}

/**
 * Hand off to a provider, if one is configured.
 *
 * Uses Sentry's HTTP API directly rather than the SDK: the SDK is a large
 * dependency and a lot of instrumentation for what is one POST, and taking it
 * on would couple every route to a vendor we have not chosen yet.
 *
 * It posts to the **envelope** endpoint. The comment here used to say envelope
 * while the code posted to `/store/`, which is the legacy endpoint Sentry has
 * been retiring: it still answers 200 today and both were verified against the
 * live DSN. That is exactly why it was worth changing. Everything below is
 * fire-and-forget with its failures swallowed, so the day Sentry turns `/store/`
 * off, error reporting stops and nothing anywhere says so. A silent monitoring
 * outage is the one failure this module exists to prevent.
 *
 * Fire and forget. A monitoring outage must never become an application
 * outage, which is the classic way error reporting makes an incident worse.
 */
function forward(err: unknown, ctx: ErrorContext, level: string): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    const parsed = new URL(dsn);
    const projectId = parsed.pathname.replace("/", "");
    const endpoint = `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/`;
    const eventId = crypto.randomUUID().replace(/-/g, "");

    // An envelope is newline-delimited JSON: headers, then one item header per
    // payload, then the payload. Not pretty-printed, and no trailing newline
    // beyond the separators, because the framing is positional.
    const body = [
      JSON.stringify({ event_id: eventId, dsn }),
      JSON.stringify({ type: "event" }),
      JSON.stringify({
        event_id: eventId,
        level,
        platform: "node",
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
        logger: ctx.scope,
        message: err instanceof Error ? err.message : String(err),
        extra: safeDetail(ctx.detail),
        exception: err instanceof Error
          ? { values: [{ type: err.name, value: err.message, stacktrace: undefined }] }
          : undefined,
      }),
    ].join("\n");

    void fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.username}`,
      },
      body,
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      // Swallowed on purpose. See above.
    });
  } catch {
    // A malformed DSN should not take down the thing it was meant to observe.
  }
}
