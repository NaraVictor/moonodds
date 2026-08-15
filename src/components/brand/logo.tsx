export function Logo({
  className = "",
  showWord = true,
}: {
  className?: string;
  showWord?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {/* A crescent cut from a disc — a moon that is also a ball. */}
      <svg
        viewBox="0 0 32 32"
        className="h-7 w-7 flex-none"
        role="img"
        aria-label="MoonOdds"
      >
        <defs>
          <linearGradient id="moonodds-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand-from)" />
            <stop offset="100%" stopColor="var(--brand-to)" />
          </linearGradient>
          <mask id="moonodds-crescent">
            <rect width="32" height="32" fill="black" />
            <circle cx="16" cy="16" r="13" fill="white" />
            <circle cx="23" cy="12" r="11" fill="black" />
          </mask>
        </defs>
        <circle
          cx="16"
          cy="16"
          r="13"
          fill="url(#moonodds-mark)"
          mask="url(#moonodds-crescent)"
        />
        <circle
          cx="16"
          cy="16"
          r="13"
          fill="none"
          stroke="url(#moonodds-mark)"
          strokeWidth="1.25"
          opacity="0.35"
        />
      </svg>

      {showWord && (
        <span className="display text-[1.35rem] leading-none tracking-tight">
          Moon<span className="text-accent">Odds</span>
        </span>
      )}
    </span>
  );
}
