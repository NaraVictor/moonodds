import type { Metadata, Viewport } from "next";
import { Archivo, Manrope, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

/**
 * adipredictstreet pairs a wide display face with a neutral text face and a
 * mono for figures. Archivo carries the same technical width; Manrope reads
 * cleanly at small sizes in dense pick lists; JetBrains Mono keeps odds,
 * confidence and dates aligned.
 */
const display = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-figures",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MoonOdds — AI football predictions",
    template: "%s · MoonOdds",
  },
  description:
    "AI-ranked football predictions with confidence scores, plain-English reasoning and a verifiable track record. One day pass, no subscription.",
  openGraph: {
    title: "MoonOdds — AI football predictions",
    description:
      "AI-ranked football predictions with confidence scores and a verifiable track record.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#010820",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
