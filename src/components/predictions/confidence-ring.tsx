"use client";

/**
 * AI confidence, as a ring that draws itself on mount.
 *
 * Prominent but deliberately smaller than the prediction itself — confidence
 * qualifies the call, it isn't the call. The label says "AI confidence" rather
 * than anything resembling a guarantee.
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
  const stroke = size < 48 ? 4 : 5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct / 100);

  const color =
    tone === "won"
      ? "var(--won-ink)"
      : tone === "lost"
        ? "var(--lost-ink)"
        : tone === "feature"
          ? "#fff"
          : "var(--accent)";

  const track =
    tone === "feature"
      ? "rgba(255,255,255,0.16)"
      : "color-mix(in oklab, currentColor 12%, transparent)";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={`AI confidence ${pct} percent`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={track}
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            className="sweep"
            style={
              {
                "--sweep-from": `${circumference}`,
                "--sweep-to": `${offset}`,
                strokeDashoffset: offset,
              } as React.CSSProperties
            }
          />
        </svg>

        <span
          className="numeral absolute inset-0 flex items-center justify-center"
          style={{
            fontSize: size < 48 ? "0.8rem" : "0.95rem",
            color: tone === "feature" ? "#fff" : "var(--foreground)",
          }}
        >
          {pct}
        </span>
      </div>

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
