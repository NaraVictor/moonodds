import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { WhatsAppFab } from "@/components/layout/whatsapp-help";
import { HistoryClient } from "./history-client";

const DESCRIPTION =
  "Every settled Kicka football prediction and how it finished, with the win rate, return and per-market breakdown behind them. Wins and misses, all of it public.";

export const metadata: Metadata = {
  title: "Prediction history",
  description: DESCRIPTION,
  alternates: { canonical: "/history" },
  openGraph: {
    type: "website",
    url: "/history",
    title: "Prediction history · Kicka",
    description: DESCRIPTION,
    siteName: "Kicka",
  },
  twitter: {
    card: "summary_large_image",
    title: "Prediction history · Kicka",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

/**
 * Public by design.
 *
 * The board sells today's picks; this page is the evidence behind them, and
 * evidence behind a sign-in wall persuades nobody. Every row here is already
 * public on its own prediction page, so grouping them costs no privacy and is
 * the difference between claiming a track record and showing one.
 */
export default async function HistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <HistoryClient />
      <WhatsAppFab />
      <BottomNav />
    </>
  );
}
