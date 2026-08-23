"use client";

import { Button } from "@heroui/react/button";
import { Spinner } from "@heroui/react/spinner";
import type { ReactNode } from "react";

/**
 * A submit button that shows it is working.
 *
 * HeroUI v3's Button has no `isPending` or `isLoading` prop — its props are
 * variant, size, fullWidth, isIconOnly and isDisabled, and anything else is
 * accepted and ignored. Several forms in this codebase passed `isPending`
 * expecting a spinner and got a button that looked idle while a request was in
 * flight, which is the exact moment a person taps it a second time.
 *
 * So the state is built rather than assumed: disabled while pending, a spinner
 * in place of nothing, and the label swapped for something that says what is
 * happening. Disabling is the part that matters — a second submit while the
 * first is unresolved is a second one-time code sent to somebody's inbox.
 *
 * `aria-live` on the label means a screen reader hears the change rather than
 * only sighted users seeing it.
 */
export function PendingButton({
  isPending,
  children,
  pendingLabel,
  className,
  variant,
  ...rest
}: {
  isPending: boolean;
  children: ReactNode;
  /** What the button says while it works. Defaults to the idle label. */
  pendingLabel?: ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "tertiary" | "outline" | "ghost" | "danger";
} & Omit<React.ComponentProps<typeof Button>, "children" | "variant" | "className">) {
  return (
    <Button
      type="submit"
      variant={variant}
      className={className}
      isDisabled={isPending}
      aria-busy={isPending}
      {...rest}
    >
      {isPending && <Spinner size="sm" color="current" />}
      <span aria-live="polite">{isPending ? (pendingLabel ?? children) : children}</span>
    </Button>
  );
}
