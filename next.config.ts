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
 *
 * ANALYTICS. Both analytics integrations are dead without their entries here,
 * and they fail in the quietest way this app has: the browser refuses the
 * script, the page renders perfectly, and the dashboard simply stays at zero,
 * which is indistinguishable from having no visitors. There is no server-side
 * error and nothing in the product looks wrong.
 *
 * Vercel Web Analytics serves its script and posts its beacon from the site's
 * own origin once deployed (/_vercel/insights/*), so 'self' covers production.
 * va.vercel-scripts.com is listed because the package falls back to it when it
 * cannot find those routes, which is every environment that is not a Vercel
 * deployment.
 *
 * Google Analytics needs three separate directives and it is the connect-src
 * one that gets forgotten: the tag loads from googletagmanager.com but sends
 * its measurements to google-analytics.com, so allowing only the script host
 * produces a tag that initialises cleanly and never reports anything.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://js.paystack.co https://www.googletagmanager.com https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  // GA still falls back to a tracking pixel where fetch is unavailable.
  "img-src 'self' data: blob: https://media.api-sports.io https://www.google-analytics.com https://www.googletagmanager.com",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE_URL} https://api.paystack.co wss://*.supabase.co https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://va.vercel-scripts.com`.trim(),
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
