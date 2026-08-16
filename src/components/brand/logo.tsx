/**
 * Wordmark.
 *
 * Text only. The crescent mark that used to sit beside it is gone, so the
 * accent on "Odds" is now the whole of the brand's visual identity in the
 * header, which is why it stays rather than flattening to a single colour.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`display inline-flex items-center text-[1.35rem] leading-none tracking-tight ${className}`}
    >
      Moon<span className="text-accent">Odds</span>
    </span>
  );
}
