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
 *
 * AND THE INDICATOR WAS STILL CARRYING IT ALONE.
 *
 * HeroUI colours the icon and the title. An alert with a description and no
 * title — which is most of them here — therefore rendered as a white box with
 * one small coloured tick, so "your payment failed" and "you already have
 * access" were the same object at a glance. The status was in the markup and
 * almost invisible on screen.
 *
 * The surface is painted here instead, from the app's own wash/edge/ink
 * triples rather than HeroUI's scale, so an alert matches the result badges
 * and the paywall panels it sits among. Set on the root as inline custom
 * properties, which beats the library's own rules without a specificity war
 * and without a global override that would surprise the next person.
 */

const TONES: Record<string, { bg: string; edge: string; ink: string }> = {
  success: { bg: "var(--won-wash)", edge: "var(--won-edge)", ink: "var(--won-ink)" },
  danger: { bg: "var(--lost-wash)", edge: "var(--lost-edge)", ink: "var(--lost-ink)" },
  warning: { bg: "var(--warn-wash)", edge: "var(--warn-edge)", ink: "var(--warn-ink)" },
  accent: { bg: "var(--accent-wash)", edge: "var(--accent-edge)", ink: "var(--accent)" },
  default: {
    bg: "var(--surface-secondary)",
    edge: "var(--border)",
    ink: "var(--foreground)",
  },
};
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
  const tone = TONES[status] ?? TONES.default;

  return (
    <AlertRoot
      status={status}
      className={className}
      role="alert"
      style={{
        background: tone.bg,
        borderColor: tone.edge,
        // The description inherits, so the whole block reads as one tone
        // rather than a coloured icon beside grey text.
        color: tone.ink,
      }}
    >
      <AlertIndicator>{icon}</AlertIndicator>
      <AlertContent>
        {title && <AlertTitle>{title}</AlertTitle>}
        {children && <AlertDescription>{children}</AlertDescription>}
      </AlertContent>
    </AlertRoot>
  );
}
