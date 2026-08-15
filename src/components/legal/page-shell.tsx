import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";

/**
 * Shell for the standing content pages.
 *
 * One measure, one rhythm, one place to change them. Text is capped near 68
 * characters — these are pages to be read rather than scanned, and the board's
 * full-bleed width would make them unreadable.
 */
export function PageShell({
  eyebrow,
  title,
  intro,
  updated,
  needsReview = false,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  /** ISO date of the last substantive edit. */
  updated?: string;
  /**
   * Marks a document that has not been through legal review. Shown rather than
   * hidden: a policy page that looks finished but isn't is worse than one that
   * says so.
   */
  needsReview?: boolean;
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

      {needsReview && (
        <Alert status="warning" title="Draft — not yet reviewed by a lawyer" className="mb-8">
          This document was written to describe how MoonOdds actually works and
          is accurate to the product, but it has not been reviewed by a
          qualified lawyer and should not be relied on as it stands. It needs
          professional review against the law of each market we operate in
          before launch.
        </Alert>
      )}

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
