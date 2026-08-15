import { createClient } from "@/lib/supabase/server";
import { Landing } from "@/components/home/landing";
import { PicksHome } from "@/components/home/picks-home";
import { SiteHeader } from "@/components/layout/site-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { BetSlipFab, BetSlipSheet } from "@/components/slip/bet-slip";
import { RoleSwitcher } from "@/components/dev/role-switcher";

/**
 * One route, two experiences — the marketing page for signed-out visitors and
 * the product for everyone else. Rendered on the server so the landing page is
 * crawlable, which the client-rendered Vite version never was.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader signedIn={!!user} />
      {user ? <PicksHome /> : <Landing />}
      <BetSlipFab />
      <BetSlipSheet />
      <BottomNav />
      {process.env.NODE_ENV !== "production" && <RoleSwitcher />}
    </>
  );
}
