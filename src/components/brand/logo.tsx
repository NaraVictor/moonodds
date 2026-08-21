/**
 * Wordmark.
 *
 * Text only. The crescent mark that used to sit beside it is gone, so the
 * accent is the whole of the brand's visual identity in the header, which is
 * why it stays rather than flattening to a single colour.
 *
 * It reads "Kicka" as base plus accented tail, the same shape the MoonOdds
 * wordmark had. Note that the two halves are separate elements and always were:
 * the old mark rendered "Moon" and "Odds" as distinct strings, so a search for
 * the brand name as one word never matched the most visible instance of it in
 * the product. The same is true here, which is what this note is for.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`display inline-flex items-center text-[1.35rem] leading-none tracking-tight ${className}`}
    >
      Kick<span className="text-accent">a</span>
    </span>
  );
}
