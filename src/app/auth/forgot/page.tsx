import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ForgotForm } from "./forgot-form";

export const metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <Link href="/" className="mx-auto mb-8" aria-label="MoonOdds home">
        <Logo />
      </Link>

      <h1 className="display text-center text-[1.75rem]">Reset your password</h1>
      <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-relaxed text-muted">
        Enter the address you signed up with and we&rsquo;ll send you a link to
        set a new password.
      </p>

      <div className="mt-8">
        <ForgotForm />
      </div>

      <p className="mt-6 text-center text-[13px] text-muted">
        Remembered it?{" "}
        <Link
          href="/auth/sign-in"
          className="font-semibold underline underline-offset-2"
          style={{ color: "var(--link)" }}
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
