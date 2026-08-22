"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary.
 *
 * There was none, so an unhandled render error showed Next's bare
 * "Application error: a client-side exception has occurred" — no branding, no
 * way back, and no report. That last part was the real problem: server errors
 * go through reportError to Sentry, while the one class of failure a user
 * actually sees had no path to it at all.
 *
 * Reporting happens through /api/client-error rather than by importing
 * reportError directly. That module reads SENTRY_DSN, a server-only variable,
 * and pulling it into a client bundle would either send nothing or, worse,
 * require publishing the DSN to do it.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        // Next replaces the message with a digest in production builds; it is
        // the only handle that ties this back to the server-side log.
        digest: error.digest ?? null,
        stack: error.stack?.slice(0, 4000) ?? null,
        path: typeof window === "undefined" ? null : window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => {
      // Reporting must never be the reason an error page fails to render.
    });
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-24 text-center">
      <p className="numeral text-[4rem] leading-none" style={{ color: "var(--lost-ink)" }}>
        !
      </p>
      <h1 className="display mt-4 text-2xl">That didn&rsquo;t load.</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        Something broke on our side while rendering this page. It has been
        reported. Trying again often works, because most of these are a request
        that failed once.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="press flex h-11 items-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-foreground"
        >
          Try again
        </button>
        <Link
          href="/"
          className="press flex h-11 items-center rounded-full border border-border px-6 text-sm font-semibold"
        >
          Today&rsquo;s predictions
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 text-[12px] text-muted">
          Reference <code className="font-mono">{error.digest}</code>
        </p>
      )}
    </main>
  );
}
