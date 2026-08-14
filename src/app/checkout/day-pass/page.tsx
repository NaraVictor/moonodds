import { SiteHeader } from "@/components/layout/site-header";
import { createClient } from "@/lib/supabase/server";
import { CheckoutClient } from "../checkout-client";

export const metadata = { title: "Day pass" };

export default async function DayPassCheckout() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <CheckoutClient kind="day-pass" />
    </>
  );
}
