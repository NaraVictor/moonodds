import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PicksHome } from "@/components/home/picks-home";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { BottomNav } from "@/components/layout/bottom-nav";

/**
 * The board carries the brand query, so it gets metadata written for it rather
 * than the layout defaults it used to inherit. The canonical matters more here
 * than anywhere: this page is reachable with filter and view parameters on the
 * URL, and without one each of those is a separate page competing with the
 * real one.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  // Names the inputs rather than the technique. "AI" is a claim anyone can
  // make; "form, head-to-head and season numbers" is one a reader can check
  // against the page they land on, which is the whole argument of the product.
  description:
    "Today's football predictions, scored on form, head-to-head and season numbers rather than guesswork. Two free picks every day, and free to sign up.",
};


/**
 * The board, for everyone.
 *
 * There is no marketing page any more. A visitor lands on the actual market,
 * the Polymarket and Kalshi pattern, and sees every fixture we cover, with the
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
    </>
  );
}
