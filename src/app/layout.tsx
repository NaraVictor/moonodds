import type { Metadata, Viewport } from "next";
import { Sora, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "./providers";
import { AgeGate } from "@/components/legal/age-gate";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { SITE_URL } from "@/lib/site-url";
import { BetSlipFab, BetSlipSheet } from "@/components/slip/bet-slip";
import { Analytics } from "@vercel/analytics/next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { GA_MEASUREMENT_ID, analyticsEnabled } from "@/lib/analytics";
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

const DESCRIPTION =
  "AI sports predictions with confidence scores and the reasoning behind every call. Every settled prediction stays public, wins and misses alike.";

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
        {/* Slip lives at the root so it survives navigation, it has to follow
            you from the board to a detail page and back. */}
        <Providers>
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
            stays at zero and reads like nobody visited. */}
        {analyticsEnabled() && (
          <>
            <Analytics />
            {GA_MEASUREMENT_ID && <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />}
          </>
        )}
      </body>
    </html>
  );
}
