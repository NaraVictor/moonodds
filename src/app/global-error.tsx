"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary, for an error thrown by the root layout itself.
 *
 * This one replaces the whole document, so it must render its own <html> and
 * <body>: at this point the layout that normally provides them is the thing
 * that failed. That also means no fonts, no theme script and no design tokens,
 * which is why the styling here is inline and self-contained rather than
 * reaching for classes that will not exist.
 */
export default function GlobalError({
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
        digest: error.digest ?? null,
        stack: error.stack?.slice(0, 4000) ?? null,
        path: typeof window === "undefined" ? null : window.location.pathname,
        fatal: true,
      }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8faf8",
          color: "#111a2e",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.75rem", letterSpacing: "-0.02em" }}>
            Kicka is having a moment.
          </h1>
          <p style={{ margin: "0 0 1.5rem", fontSize: "0.9rem", lineHeight: 1.6, color: "#4a5468" }}>
            The page failed to load at all. It has been reported. Reloading
            usually clears it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: "2.75rem",
              padding: "0 1.5rem",
              borderRadius: "999px",
              border: 0,
              background: "#1f8a5b",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#6b7688" }}>
              Reference <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
