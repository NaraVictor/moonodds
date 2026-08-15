import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { OfficeClient } from "./office-client";
import { devBypassEnabled } from "@/lib/dev-bypass";
import { RoleSwitcher } from "@/components/dev/role-switcher";

export const metadata = { title: "Office" };

/**
 * The Office is guarded on the server, before any admin UI is sent to the
 * browser. The client-side check in the header is cosmetic — this is the one
 * that matters, and it reads the flag from profiles rather than a JWT claim.
 */
export default async function OfficePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const bypass = devBypassEnabled();

  if (!user && !bypass) redirect("/auth/sign-in");

  if (bypass && !user) {
    return (
      <>
        <SiteHeader signedIn={false} />
        <OfficeClient adminName="bypass (not signed in)" anonymousBypass />
        <RoleSwitcher />
      </>
    );
  }

  const admin = createServiceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_super_admin, display_name")
    .eq("id", user!.id)
    .maybeSingle();

  if (!profile?.is_super_admin && !bypass) {
    return (
      <>
        <SiteHeader signedIn />
        <main className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-5 py-24 text-center">
          <h1 className="display text-2xl">Not your floor</h1>
          <p className="text-sm text-muted">
            The Office is restricted to super-admins. If you think you should
            have access, ask whoever runs the platform.
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader signedIn />
      <OfficeClient adminName={profile?.display_name ?? user!.email ?? "admin"} />
      <BottomNav />
      {process.env.NODE_ENV !== "production" && <RoleSwitcher />}
    </>
  );
}
