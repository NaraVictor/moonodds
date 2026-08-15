import { createClient } from "@/lib/supabase/server";
import { PicksHome } from "@/components/home/picks-home";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { RoleSwitcher } from "@/components/dev/role-switcher";

/**
 * The board, for everyone.
 *
 * There is no marketing page any more. A visitor lands on the actual market —
 * the Polymarket and Kalshi pattern — and sees every fixture we cover, with the
 * AI call locked until they have access. Selling the product by showing it beats
 * describing it, and it means the page a stranger arrives on is the same page a
 * subscriber uses.
 *
 * Rendered on the server so the board is crawlable, which matters a great deal
 * more now that it is the front door.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <PicksHome />
      <SiteFooter />
      <BottomNav />
      {process.env.NODE_ENV !== "production" && <RoleSwitcher />}
    </>
  );
}
