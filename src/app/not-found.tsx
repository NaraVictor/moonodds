import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found" };

/**
 * 404.
 *
 * Deliberately routes onward rather than apologising. Almost everything that
 * 404s here is a stale prediction link, a fixture from a previous day, or an
 * id that no longer resolves, so the useful response is a door back to today's
 * board, not a dead end with a sad face.
 *
 * No header or footer: those pull the session and the board query, which is a
 * lot of machinery for a page whose entire job is one link.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-24 text-center">
      <p className="numeral text-[4rem] leading-none" style={{ color: "var(--accent)" }}>
        404
      </p>
      <h1 className="display mt-4 text-2xl">This one got away.</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        The page you were after doesn&rsquo;t exist. If you followed a link to a
        prediction, it may have been for a fixture that has since rolled off the
        board, today&rsquo;s calls are always on the front page.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Link
          href="/"
          className="press flex h-11 items-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-foreground"
        >
          Today&rsquo;s predictions
        </Link>
        <Link
          href="/help"
          className="press flex h-11 items-center rounded-full border border-border px-6 text-sm font-semibold"
        >
          Help centre
        </Link>
      </div>
    </main>
  );
}
