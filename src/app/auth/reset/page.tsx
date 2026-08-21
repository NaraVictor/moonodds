import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ResetForm } from "./reset-form";

export const metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

/**
 * Landing page for the emailed reset link.
 *
 * Supabase turns the link's fragment into a recovery session client-side, so
 * this page deliberately does not check for a user server-side: at first paint
 * the session does not exist yet, and redirecting would bounce every legitimate
 * visitor straight back out. The action behind the form is what rejects an
 * expired link.
 */
export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <Link href="/" className="mx-auto mb-8" aria-label="Kicka home">
        <Logo />
      </Link>

      <h1 className="display text-center text-[1.75rem]">Choose a new password</h1>
      <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-relaxed text-muted">
        Ten characters or more. You&rsquo;ll be signed in once it&rsquo;s saved.
      </p>

      <div className="mt-8">
        <ResetForm />
      </div>
    </main>
  );
}
