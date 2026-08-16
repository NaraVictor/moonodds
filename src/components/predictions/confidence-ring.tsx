"use client";

import {
  ProgressCircleRoot,
  ProgressCircleTrack,
  ProgressCircleTrackCircle,
  ProgressCircleFillCircle,
} from "@heroui/react";

/**
 * AI confidence, as a ring.
 *
 * Built on HeroUI's ProgressCircle rather than the hand-rolled SVG this
 * replaces. The arithmetic was the same either way, circumference, dash
 * offset, a rotation to start at twelve o'clock, but the component version
 * carries the ARIA progressbar semantics and value announcements for free,
 * which the bare `role="img"` did not.
 *
 * Prominent but deliberately smaller than the prediction itself: confidence
 * qualifies the call, it isn't the call. The label reads "AI conf." rather than
 * anything resembling a guarantee.
 *
 * The `feature` tone is ours, not HeroUI's, a white ring for the dark hero
 * card, which no semantic colour in the system covers.
 */
export function ConfidenceRing({
  value,
  size = 56,
  tone = "accent",
  showLabel = true,
}: {
  /** 0–10, the engine's native scale. */
  value: number;
  size?: number;
  tone?: "accent" | "won" | "lost" | "feature";
  showLabel?: boolean;
}) {
  const pct = Math.round(value * 10);

  const color =
    tone === "won"
      ? "var(--won-ink)"
      : tone === "lost"
        ? "var(--lost-ink)"
        : tone === "feature"
          ? "#fff"
          : "var(--accent)";

  return (
    <div className="flex flex-none flex-col items-center gap-1">
      <ProgressCircleRoot
        value={pct}
        minValue={0}
        maxValue={100}
        aria-label={`AI confidence ${pct} percent`}
        className="relative"
        style={{ width: size, height: size, color }}
      >
        <ProgressCircleTrack className="h-full w-full">
          <ProgressCircleTrackCircle
            style={{
              stroke:
                tone === "feature"
                  ? "rgba(255,255,255,0.16)"
                  : "color-mix(in oklab, currentColor 14%, transparent)",
            }}
          />
          <ProgressCircleFillCircle style={{ stroke: color }} />
        </ProgressCircleTrack>

        <span
          className="numeral absolute inset-0 flex items-center justify-center"
          style={{
            fontSize: size < 48 ? "0.8rem" : "0.95rem",
            color: tone === "feature" ? "#fff" : "var(--foreground)",
          }}
        >
          {pct}
        </span>
      </ProgressCircleRoot>

      {showLabel && (
        <span
          className="text-[9px] font-semibold uppercase tracking-[0.12em]"
          style={{
            color: tone === "feature" ? "var(--feature-muted)" : "var(--muted)",
          }}
        >
          AI conf.
        </span>
      )}
    </div>
  );
}
