import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { RoleSwitcher } from "@/components/dev/role-switcher";
import { devBypassEnabled } from "@/lib/dev-bypass";
import { SlipsClient } from "./slips-client";

export const metadata = { title: "My slips" };

export default async function SlipsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !devBypassEnabled()) redirect("/auth/sign-in");

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <SlipsClient />
      <BottomNav />
      {process.env.NODE_ENV !== "production" && <RoleSwitcher />}
    </>
  );
}
