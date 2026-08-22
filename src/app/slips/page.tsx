import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SlipsClient } from "./slips-client";

export const metadata = {
  title: "My slips",
  // Personal and behind a sign-in. robots.txt already excludes it; this is the
  // half that travels with the page if the link is shared.
  robots: { index: false, follow: false },
};

export default async function SlipsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <SlipsClient />
      <BottomNav />
    </>
  );
}
