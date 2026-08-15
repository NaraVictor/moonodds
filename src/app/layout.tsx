import type { Metadata, Viewport } from "next";
import { Sora, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "./providers";
import { BypassBanner } from "@/components/dev/bypass-banner";
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
  themeColor: "#f6f7f9",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${display.variable} ${body.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <BypassBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
