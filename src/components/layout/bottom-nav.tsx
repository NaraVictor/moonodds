"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Receipt, User, BarChart3 } from "@/components/ui/icons";

/**
 * Mobile bottom navigation.
 *
 * The primary use case is someone checking predictions on a phone, so the
 * destinations that matter sit under the thumb. Desktop keeps the horizontal
 * nav in the header, this is hidden from `sm` up.
 *
 * Deliberately shallow: Kicka is about finding and judging predictions, so
 * there is nothing else competing for space down here.
 *
 * /office is deliberately absent. It's an internal tool, not a destination,
 * operators reach it by URL, and the route's own server-side super-admin guard
 * is what actually protects it. A nav link would only advertise it.
 */

const items = [
  { href: "/", label: "Predictions", Icon: Home },
  { href: "/history", label: "History", Icon: BarChart3 },
  { href: "/slips", label: "Slips", Icon: Receipt },
  { href: "/profile", label: "Account", Icon: User },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <>
      {/*
        Reserved space, so the last card is not sitting under the bar.
        
        The nav is `fixed`, which takes it out of flow entirely — the page ends
        where its content ends and the final row of anything is covered by 4rem
        of frosted glass. Every page had to remember its own bottom padding, and
        none of them did.
        
        The spacer lives HERE rather than on <body> for two reasons: the nav is
        mounted per page, so body padding would leave a gap on the pages without
        it; and a spacer beside the thing it compensates for cannot drift out of
        step with it. h-16 is the nav's own link height, and the safe-area inset
        matches what the nav adds for the home indicator.
      */}
      <div
        aria-hidden
        className="h-16 md:hidden"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      />
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/90 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch">
        {items.map(({ href, label, Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="press flex h-16 flex-col items-center justify-center gap-1"
                style={{ color: active ? "var(--accent)" : "var(--muted)" }}
              >
                <span className="relative flex h-6 w-6 items-center justify-center">
                  <Icon
                    className="h-[1.15rem] w-[1.15rem]"
                    strokeWidth={active ? 2.5 : 2}
                  />
                  {active && (
                    <span
                      className="absolute -bottom-1.5 h-1 w-1 rounded-full"
                      style={{ background: "var(--accent)" }}
                    />
                  )}
                </span>
                <span className="text-[10px] font-semibold">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
    </>
  );
}
