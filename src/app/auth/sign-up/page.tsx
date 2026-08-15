import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/brand/logo";
import { SignUpForm } from "./sign-up-form";

export const metadata = { title: "Create your account" };

export default async function SignUpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/");

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm space-y-8">
        <Link href="/" className="flex justify-center">
          <Logo />
        </Link>

        <div className="space-y-1.5 text-center">
          <h1 className="display text-2xl">Start free</h1>
          <p className="text-sm text-muted">
            Two picks on your first day. No card needed.
          </p>
        </div>

        <SignUpForm />

        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="text-link underline">
            Sign in
          </Link>
        </p>

        <p className="text-center text-xs text-muted">
          18+ only. Predictions are analysis, not guarantees.
        </p>
      </div>
    </main>
  );
}
