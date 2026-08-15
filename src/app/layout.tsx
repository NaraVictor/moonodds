import type { Metadata, Viewport } from "next";
import { Sora, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "./providers";
import { BypassBanner } from "@/components/dev/bypass-banner";
import { AgeGate } from "@/components/legal/age-gate";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { BetSlipFab, BetSlipSheet } from "@/components/slip/bet-slip";
import "./globals.css";

/**
 * Sora carries headlines and every figure — geometric, confident, with
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

export const metadata: Metadata = {
  title: {
    default: "MoonOdds — AI football predictions",
    template: "%s · MoonOdds",
  },
  description:
    "AI-powered football predictions with confidence scores and the reasoning behind every call. Smarter decisions, backed by the data.",
  openGraph: {
    title: "MoonOdds — AI football predictions",
    description:
      "AI-ranked football predictions with confidence scores and a verifiable track record.",
    type: "website",
  },
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
        <BypassBanner />
        <AgeGate />
        {/* Slip lives at the root so it survives navigation — it has to follow
            you from the board to a detail page and back. */}
        <Providers>
          {children}
          <BetSlipFab />
          <BetSlipSheet />
        </Providers>
      </body>
    </html>
  );
}
