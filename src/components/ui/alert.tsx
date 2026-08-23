"use client";

import {
  AlertRoot,
  AlertIndicator,
  AlertContent,
  AlertTitle,
  AlertDescription,
} from "@heroui/react";
import type { ReactNode } from "react";

/**
 * Alerts, on HeroUI.
 *
 * These used to be hand-rolled divs, a lost-wash background, a lost-edge
 * border, an icon and two paragraphs, repeated in ten places with small
 * inconsistencies in each. Moving to the design system's own component means
 * the status colours, icon, spacing and ARIA role come from one definition, and
 * a change to alert styling happens once.
 *
 * `status` maps to HeroUI's scale: danger for failures, warning for conditions
 * the operator should notice, accent for gated or promotional states, success
 * for confirmations.
 *
 * THE INDICATOR IS ALWAYS RENDERED, and that is not decoration. HeroUI's
 * `.alert--danger` rule colours exactly two things, the indicator and the
 * title, and nothing else. An alert built from a description alone therefore
 * inherited the plain `--surface` background and grey text no matter what
 * status it was given: a failure and a confirmation rendered identically, as a
 * white box. `status` looked applied, in the markup and in the class list, and
 * was doing nothing a person could see.
 *
 * Passing no children to AlertIndicator makes HeroUI supply the icon for the
 * status, which is what carries the colour.
 */
export function Alert({
  status = "danger",
  title,
  icon,
  children,
  className,
}: {
  status?: "default" | "accent" | "danger" | "success" | "warning";
  title?: ReactNode;
  /** Overrides HeroUI's status icon when a more specific one reads better. */
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <AlertRoot status={status} className={className} role="alert">
      <AlertIndicator>{icon}</AlertIndicator>
      <AlertContent>
        {title && <AlertTitle>{title}</AlertTitle>}
        {children && <AlertDescription>{children}</AlertDescription>}
      </AlertContent>
    </AlertRoot>
  );
}
