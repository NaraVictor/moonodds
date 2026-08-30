import { SiteHeader } from "@/components/layout/site-header";
import { createClient } from "@/lib/supabase/server";
import { CheckoutClient } from "../checkout-client";

export const metadata = { title: "Extra picks" };

export default async function ExtraPicksCheckout() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <CheckoutClient kind="extra-picks" />
    </>
  );
}
