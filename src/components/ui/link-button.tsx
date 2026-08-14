import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * HeroUI v3's Button is a real <button> and takes no href — navigation is a
 * different element with different semantics, and the library is right about
 * that. This renders a Next <Link> that looks like a button, so client-side
 * routing and keyboard/screen-reader semantics both stay correct.
 */

const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const SIZES = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
} as const;

const VARIANTS = {
  gradient: "bg-brand-gradient text-white hover:opacity-90",
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  secondary:
    "border border-border bg-surface-secondary text-foreground hover:bg-surface-tertiary",
  ghost: "text-muted hover:bg-surface-secondary hover:text-foreground",
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
