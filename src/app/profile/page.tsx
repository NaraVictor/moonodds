import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { BetSlipFab, BetSlipSheet } from "@/components/slip/bet-slip";
import { RoleSwitcher } from "@/components/dev/role-switcher";
import { devBypassEnabled } from "@/lib/dev-bypass";
import { ProfileClient } from "./profile-client";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !devBypassEnabled()) redirect("/auth/sign-in");

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <ProfileClient />
      <BetSlipFab />
      <BetSlipSheet />
      <BottomNav />
      {process.env.NODE_ENV !== "production" && <RoleSwitcher />}
    </>
  );
}
