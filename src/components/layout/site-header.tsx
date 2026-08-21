"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@heroui/react/button";
import { LinkButton } from "@/components/ui/link-button";
import { Chip } from "@heroui/react/chip";
import { LogOut } from "@/components/ui/icons";
import { Logo } from "@/components/brand/logo";
import { SiteSearch } from "./site-search";
import { useAccessState } from "@/lib/queries";
import { signOut } from "@/lib/auth-actions";

/**
 * Public destinations, shown to everyone.
 *
 * History is here rather than behind the sign-in check because it is entirely
 * settled results: public data, no pass required, and the single best reason a
 * visitor has to believe the product before paying for it. Hiding the track
 * record from the people who have not bought yet gets the incentive backwards.
 */
const PUBLIC_NAV = [
  { href: "/", label: "Picks" },
  { href: "/history", label: "History" },
];

/** Destinations that need an account to mean anything. */
const PRIVATE_NAV = [
  { href: "/slips", label: "My slips" },
  { href: "/profile", label: "Profile" },
];

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const { data: access } = useAccessState();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      {/* Matches the board's own width and gutters so the logo sits directly
          above the first card rather than floating in a narrower column. */}
      <div className="mx-auto flex w-full max-w-[110rem] items-center gap-8 px-5 py-4 sm:px-8 sm:py-5">
        <Link href="/" className="flex-none" aria-label="Kicka home">
          <Logo />
        </Link>

        {/* The whole nav renders for guests now, not just for signed-in users.
            It used to be inside a signedIn check, which took the track record
            away from exactly the people still deciding whether to trust it. */}
        <nav className="hidden flex-none items-center gap-7 lg:flex">
          {[...PUBLIC_NAV, ...(signedIn ? PRIVATE_NAV : [])].map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`text-[13px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                  active ? "text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Search takes the middle and the slack, the way it does on every
            marketplace. It is the primary way of getting somewhere specific. */}
        <div className="hidden flex-1 justify-center md:flex">
          <SiteSearch />
        </div>

        <div className="ml-auto flex flex-none items-center gap-3">
          {access?.hasFullAccess && (
            <Chip size="sm" color="success" variant="soft">
              Full access
            </Chip>
          )}
          {access?.isSuspended && (
            <Chip size="sm" color="danger" variant="soft">
              Suspended
            </Chip>
          )}

          {signedIn ? (
            <form action={signOut}>
              <Button type="submit" size="md" variant="ghost">
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </form>
          ) : (
            <LinkButton size="md" href="/auth/sign-in" variant="primary">
              Get started
            </LinkButton>
          )}
        </div>
      </div>

      {/* On a phone the header bar has no room for search beside the logo and
          the sign-in button, so it gets its own full-width row rather than
          being hidden, search is how you reach a specific fixture, and a
          marketplace that only offers it on desktop has hidden its index from
          the majority of its traffic. */}
      <div className="border-t border-separator px-5 py-3 sm:px-8 md:hidden">
        <SiteSearch />
      </div>
    </header>
  );
}
