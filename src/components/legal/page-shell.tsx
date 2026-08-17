import type { ReactNode } from "react";

/**
 * Shell for the standing content pages.
 *
 * One measure, one rhythm, one place to change them. Text is capped near 68
 * characters, these are pages to be read rather than scanned, and the board's
 * full-bleed width would make them unreadable.
 */
export function PageShell({
  eyebrow,
  title,
  intro,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  /** ISO date of the last substantive edit. */
  updated?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[46rem] px-5 py-12 sm:px-8">
      <header className="mb-8">
        <span className="label">{eyebrow}</span>
        <h1 className="display mt-2 text-[2.25rem] leading-tight sm:text-[2.75rem]">
          {title}
        </h1>
        {intro && (
          <p className="mt-4 text-[15px] leading-relaxed text-muted">{intro}</p>
        )}
        {updated && (
          <p className="mt-4 text-[12px] text-muted">Last updated {updated}</p>
        )}
      </header>

      <div className="space-y-8">{children}</div>
    </main>
  );
}

/** A titled block of prose. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-muted">
        {children}
      </div>
    </section>
  );
}
