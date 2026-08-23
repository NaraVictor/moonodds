import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/brand/logo";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  // Sign-in has nothing for a search result to rank and every reason not to
  // compete with the board for the brand query.
  robots: { index: false, follow: true },
};

/**
 * One door.
 *
 * There is no separate "create an account" page any more. A one-time code
 * proves control of an address; whether a row already existed behind it is our
 * bookkeeping, not a question to put to somebody before they can start.
 *
 * The heading says what the page gives you rather than which of two things you
 * are doing, because the distinction it used to offer is one the product no
 * longer makes.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/");

  const { error } = await searchParams;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm space-y-8">
        <Link href="/" className="flex justify-center">
          <Logo />
        </Link>

        <div className="space-y-1.5 text-center">
          <h1 className="display text-2xl">Access your account</h1>
          <p className="text-sm text-muted">
            New or returning, it&rsquo;s the same door. We&rsquo;ll send you a
            code.
          </p>
        </div>

        {error && (
          <Alert status="danger">
            {error === "google-unavailable"
              ? "Google sign-in isn't available right now. Use a code instead."
              : error === "google-failed"
                ? "That Google sign-in didn't complete. Try again, or use a code instead."
                : error}
          </Alert>
        )}

        <SignInForm />

        <p className="text-center text-[12px] text-muted">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-2">terms</Link>{" "}
          and{" "}
          <Link href="/policy" className="underline underline-offset-2">privacy policy</Link>.
        </p>
      </div>
    </main>
  );
}
