import type { Metadata, Viewport } from "next";
import { Sora, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "./providers";
import { AgeGate } from "@/components/legal/age-gate";
import { ConsentBar } from "@/components/legal/consent-bar";
import { AnalyticsGate } from "@/components/legal/analytics-gate";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { CONSENT_INIT_SCRIPT } from "@/lib/consent";
import { SITE_URL } from "@/lib/site-url";
import { BetSlipFab, BetSlipSheet } from "@/components/slip/bet-slip";
import { Analytics } from "@vercel/analytics/next";
import { GA_MEASUREMENT_ID, analyticsEnabled } from "@/lib/analytics";
import { PostHogIdentifier } from "@/components/analytics/posthog-identifier";
import "./globals.css";

/**
 * Sora carries headlines and every figure, geometric, confident, with
 * numerals that hold their shape at the sizes scorelines demand. Plus Jakarta
 * Sans handles UI text: highly legible small, with a warmth that keeps the
 * product from reading as an enterprise dashboard.
 */
const display = Sora({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const body = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

/**
 * Site metadata.
 *
 * metadataBase is the load-bearing part: without it Next cannot turn a relative
 * OG image path into the absolute URL that Facebook, X, WhatsApp and Slack all
 * require, so every share card falls back to no image at all. It reads from
 * NEXT_PUBLIC_SITE_URL so previews and production resolve to themselves rather
 * than to a hardcoded host, normalised through `SITE_URL` because a bare host
 * typed into the Vercel dashboard would otherwise fail the build here.
 *
 * The title template appends the brand to every child page, so a page only ever
 * declares its own subject and still arrives as "Subject · Kicka".
 */

/**
 * The tagline.
 *
 * "AI-powered football prediction market" was too long to survive a search
 * result or a tab, and "prediction market" also described the wrong product:
 * a prediction market is a venue where people trade on outcomes, which is
 * precisely what Terms section 1 says Kicka is not.
 */
const TAGLINE = "AI Sports Predictions";

/**
 * The search result, and the first thing most people read about the product.
 *
 * Google was ignoring the previous one and pulling the FOOTER instead —
 * "provides analysis, not guarantees, and does not take bets or hold funds" —
 * which is a legal disclaimer doing a shop window's job. It is accurate and it
 * is the worst possible pitch: three sentences about what Kicka is not.
 *
 * Search substitutes its own text when the description does not obviously
 * answer what the searcher asked, so this one answers it in order: what it is,
 * why it beats a hunch, and what it costs to try. The free picks come last
 * because they are the call to action, and first in the reader's mind because
 * they are the only part that asks nothing of them.
 *
 * Every claim is checkable, which matters more than usual for a product whose
 * argument is that it publishes its misses. "Two free picks daily" is
 * app.access_state()'s free_pick_limit, granted alike to signed-out visitors
 * and to account holders without a pass — so signing up genuinely costs
 * nothing and genuinely loses nothing.
 *
 * Under 160 characters, which is roughly where search truncates. A call to
 * action cut off mid-sentence is not a call to action.
 */
const DESCRIPTION =
  "Football predictions from a model that reads the numbers, not a hunch. Every call carries a confidence score and its reasoning. Two free picks daily.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `Kicka: ${TAGLINE}`,
    template: "%s · Kicka",
  },
  description: DESCRIPTION,
  applicationName: "Kicka",
  keywords: [
    "football predictions",
    "AI football predictions",
    "AI sports predictions",
    "football betting tips",
    "match predictions",
    "football analytics",
    "Premier League predictions",
    "confidence scores",
  ],
  authors: [{ name: "Kicka" }],
  creator: "Kicka",
  publisher: "Kicka",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Kicka",
    url: "/",
    title: `Kicka: ${TAGLINE}`,
    description: DESCRIPTION,
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: `Kicka: ${TAGLINE}`,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: "#f8faf8",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /* No data-theme here: the inline script below sets it from the stored
       preference before first paint, and leaves it off entirely for "system"
       so prefers-color-scheme decides. Hard-coding light was what made the
       dark palette unreachable. */
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Consent Mode defaults, before anything Google loads further down.
            Order is the whole mechanism: set these after gtag.js initialises
            and it has already written its cookie, at which point asking is
            theatre. */}
        <script dangerouslySetInnerHTML={{ __html: CONSENT_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* Site-level structured data. The SearchAction is what lets a result
            carry its own search box, and the Organization block is what ties
            every page back to one named publisher rather than to a bare host. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": `${SITE_URL}/#organization`,
                  name: "Kicka",
                  url: SITE_URL,
                  description: DESCRIPTION,
                },
                {
                  "@type": "WebSite",
                  "@id": `${SITE_URL}/#website`,
                  url: SITE_URL,
                  name: "Kicka",
                  description: DESCRIPTION,
                  publisher: { "@id": `${SITE_URL}/#organization` },
                  inLanguage: "en-GB",
                },
              ],
            }),
          }}
        />
        <AgeGate />
        <ConsentBar />
        {/* Slip lives at the root so it survives navigation, it has to follow
            you from the board to a detail page and back. */}
        <Providers>
          {/* Identifies the authenticated user in PostHog and resets on sign-out. */}
          <PostHogIdentifier />
          {children}
          <BetSlipFab />
          <BetSlipSheet />
        </Providers>

        {/* Analytics last, after the content it measures.

            Both are gated on analyticsEnabled() rather than rendered
            unconditionally, because a development session and a preview
            deployment are not traffic: counting them makes the numbers wrong
            in a way that is invisible once they are mixed in. Vercel's own
            component no-ops off Vercel, Google's does not.

            Neither of these works without the Content-Security-Policy entries
            in next.config.ts. A blocked analytics script fails exactly as
            silently as a missing one: no error, no data, just a dashboard that
            stays at zero and reads like nobody visited.

            Google additionally waits for consent: AnalyticsGate renders
            nothing until someone allows it, so the tag is never requested
            rather than merely being denied cookies. Vercel's is cookieless
            and runs regardless. */}
        {analyticsEnabled() && (
          <>
            <Analytics />
            <AnalyticsGate gaId={GA_MEASUREMENT_ID} />
          </>
        )}
      </body>
    </html>
  );
}
