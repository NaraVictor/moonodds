import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { RoleSwitcher } from "@/components/dev/role-switcher";
import { HistoryClient } from "./history-client";

export const metadata = {
  title: "Prediction history",
  description:
    "Every settled MoonOdds call and how it finished, with the win rate and return behind them.",
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
      <BottomNav />
      {process.env.NODE_ENV !== "production" && <RoleSwitcher />}
    </>
  );
}
