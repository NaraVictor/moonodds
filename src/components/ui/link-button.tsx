import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * HeroUI v3's Button is a real <button> and takes no href — navigation is a
 * different element with different semantics, and the library is right about
 * that. This renders a Next <Link> that looks like a button, so client-side
 * routing and keyboard/screen-reader semantics both stay correct.
 */

const BASE =
  "press inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Touch targets stay at or above 44px from md up. */
const SIZES = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-11 px-5 text-sm",
  lg: "h-[3.25rem] px-7 text-[15px]",
} as const;

const VARIANTS = {
  primary: "bg-accent text-accent-foreground hover:brightness-110",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-secondary",
  ghost: "text-muted hover:bg-surface-secondary hover:text-foreground",
  dark: "bg-feature text-feature-foreground hover:brightness-125",
} as const;

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  children,
  ...rest
}: {
  href: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  fullWidth?: boolean;
} & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link
      href={href}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {children}
    </Link>
  );
}
