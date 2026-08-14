import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/brand/logo";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/");

  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center px-5 py-12">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-96 w-[40rem] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: "var(--brand-gradient)" }}
      />

      <div className="relative w-full max-w-sm space-y-8">
        <Link href="/" className="flex justify-center">
          <Logo />
        </Link>

        <div className="space-y-1.5 text-center">
          <h1 className="display text-2xl">Welcome back</h1>
          <p className="text-sm text-muted">
            Sign in to see today&rsquo;s picks.
          </p>
        </div>

        <SignInForm />

        <p className="text-center text-sm text-muted">
          New here?{" "}
          <Link href="/auth/sign-up" className="text-link underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
