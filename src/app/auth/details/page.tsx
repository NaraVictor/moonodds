import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/brand/logo";
import { DetailsForm } from "./details-form";

export const metadata: Metadata = {
  title: "One more thing",
  robots: { index: false, follow: false },
};

/**
 * The 18+ question, asked once.
 *
 * It used to live on the sign-up form. A passwordless flow has no sign-up
 * step, so it moved here: everyone arrives after proving they control an
 * address, and anyone who has already answered is sent straight on.
 */
export default async function DetailsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("date_of_birth, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.date_of_birth) redirect("/");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-16">
      <Link href="/" className="mx-auto mb-8" aria-label="Kicka home">
        <Logo />
      </Link>
      <h1 className="display mb-1 text-2xl">One more thing</h1>
      <p className="mb-6 text-[14px] text-muted">
        Kicka is for adults. We ask once and keep it on your account.
      </p>
      <DetailsForm
        defaultName={profile?.display_name ?? user.email?.split("@")[0] ?? ""}
      />
    </main>
  );
}
