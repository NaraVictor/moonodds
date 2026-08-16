import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * The file was the untouched scaffold, so the app shipped with no CSP, no
 * frame protection and no HSTS. Everything here is a header rather than
 * application code because a header applies to every response including the
 * ones no route handler wrote.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/**
 * Content-Security-Policy.
 *
 * 'unsafe-inline' on script-src is not optional here: the theme script that
 * runs before first paint is inline by design, because moving it to a file
 * reintroduces the white flash it exists to prevent. A nonce would be the
 * stronger answer and needs the middleware to generate one per request, which
 * is worth doing but is a larger change than this.
 *
 * img-src carries the API-Football CDN, which is where every crest and league
 * badge in the product comes from.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://js.paystack.co",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://media.api-sports.io",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE_URL} https://api.paystack.co wss://*.supabase.co`.trim(),
  // Paystack's checkout renders in an iframe it injects.
  "frame-src https://checkout.paystack.com https://js.paystack.co",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Belt and braces with frame-ancestors, for anything that predates it.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(self)",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // Nothing under /api should ever be cached by a shared proxy: these
        // responses are per-user and several of them are gated on a pass.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
