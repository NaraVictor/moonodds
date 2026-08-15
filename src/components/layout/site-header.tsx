"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@heroui/react/button";
import { LinkButton } from "@/components/ui/link-button";
import { Chip } from "@heroui/react/chip";
import { LogOut } from "@/components/ui/icons";
import { Logo } from "@/components/brand/logo";
import { useAccessState } from "@/lib/queries";
import { signOut } from "@/lib/auth-actions";

const NAV = [
  { href: "/", label: "Picks" },
  { href: "/slips", label: "My slips" },
  { href: "/profile", label: "Profile" },
];

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const { data: access } = useAccessState();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-5 py-3">
        <Link href="/" className="flex-none py-1.5" aria-label="MoonOdds home">
          <Logo />
        </Link>

        {signedIn && (
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-surface-secondary text-foreground"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2.5">
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
    </header>
  );
}
