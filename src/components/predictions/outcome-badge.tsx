import { Check, Clock, X } from "@/components/ui/icons";
import type { Pick } from "@/lib/types";

/**
 * How a settled pick finished.
 *
 * Shared, because it existed twice: /history had this, and the board's table
 * view printed the bare word "won" in the same small grey text as every other
 * cell — the one thing it should not have looked like, since it is the only
 * cell on the row carrying an outcome rather than a fact about the fixture.
 * Two copies of a result badge is two chances to end up with two visual
 * languages for the same fact.
 *
 * The wash carries the colour and the mark is the darker ink over it, so a
 * column of results reads as soft green and red rather than a stack of
 * saturated dots fighting the confidence figures beside them.
 *
 * Colour is not doing this alone. A check and a cross differ in SHAPE, which
 * is what keeps the column readable to someone who cannot separate the two
 * hues, and the word is there for everyone else.
 */
export function OutcomeBadge({ status }: { status: Pick["status"] }) {
  const shell =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]";

  if (status === "won") {
    return (
      <span
        className={shell}
        style={{ background: "var(--won-wash)", color: "var(--won-ink)" }}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={4} />
        Won
      </span>
    );
  }

  if (status === "lost") {
    return (
      <span
        className={shell}
        style={{ background: "var(--lost-wash)", color: "var(--lost-ink)" }}
      >
        <X className="h-2.5 w-2.5" strokeWidth={4} />
        Lost
      </span>
    );
  }

  return (
    <span
      className={shell}
      style={{ background: "var(--surface-secondary)", color: "var(--muted)" }}
    >
      <Clock className="h-2.5 w-2.5" strokeWidth={3} />
      Void
    </span>
  );
}
