import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LinkButton } from "@/components/ui/link-button";
import { Check } from "@/components/ui/icons";

export const metadata = {
  title: "Email confirmed",
  robots: { index: false, follow: false },
};

export default function ConfirmedPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12 text-center">
      <Link href="/" className="mx-auto mb-8" aria-label="MoonOdds home">
        <Logo />
      </Link>

      <span
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--won-wash)" }}
      >
        <Check className="h-6 w-6" strokeWidth={2.5} style={{ color: "var(--won-ink)" }} />
      </span>

      <h1 className="display mt-5 text-[1.75rem]">Email confirmed</h1>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
        That&rsquo;s everything. Your account is active and results will reach
        you at this address.
      </p>

      <LinkButton href="/" variant="primary" size="lg" className="mt-6">
        See today&rsquo;s board
      </LinkButton>
    </main>
  );
}
