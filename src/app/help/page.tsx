import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { PageShell } from "@/components/legal/page-shell";

export const metadata: Metadata = {
  title: "Help centre",
  description:
    "How the day pass, free picks, confidence scores, slips and grading work.",
};

/**
 * Help centre.
 *
 * Native <details> rather than a JS accordion: it's keyboard accessible and
 * findable with in-page search for free, and this content has to work on a
 * phone with a weak connection before it has to animate.
 */
const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "What do I get for free?",
    a: (
      <>
        Two predictions a day, in full — the call, the confidence score and the
        reasoning — without an account. They&rsquo;re drawn from the day&rsquo;s
        three highest-confidence picks, so they&rsquo;re genuinely the ones
        we&rsquo;d lead with. Every settled prediction is also free to everyone,
        permanently.
      </>
    ),
  },
  {
    q: "What does the day pass include?",
    a: (
      <>
        Every prediction published that day, with full reasoning, for one day.
        There is no subscription, no minimum term and nothing to cancel — a pass
        covers a single day and then expires on its own.
      </>
    ),
  },
  {
    q: "What does the confidence score mean?",
    a: (
      <>
        How strongly the model rates its own call, from 0 to 100. It is not a
        probability that the outcome occurs and it is not a guarantee. A 90 means
        the model found unusually clear support in the data — it does not mean
        nine times in ten.
      </>
    ),
  },
  {
    q: "Why is a match on the board with the prediction hidden?",
    a: (
      <>
        Because you have used your free picks for the day. The fixture, teams,
        kickoff, venue, form and head-to-head stay public — those are football
        facts and not ours to hide. What&rsquo;s behind the pass is the call
        itself, its confidence and its reasoning.
      </>
    ),
  },
  {
    q: "How are results graded?",
    a: (
      <>
        Automatically from the final score, a couple of hours after kickoff.
        Half-time markets settle on the half-time score; draw-no-bet and handicap
        pushes void rather than lose. Where a feed is wrong an operator can enter
        the result by hand, and it re-grades through the same logic so a manual
        fix can never diverge from an automatic one.
      </>
    ),
  },
  {
    q: "What is a slip?",
    a: (
      <>
        A way to record which predictions you followed, so you can track how they
        did as a group. MoonOdds does not take bets and holds no money — saving a
        slip places nothing anywhere. It is a notebook, not a bet.
      </>
    ),
  },
  {
    q: "Can I get a refund?",
    a: (
      <>
        If a pass was charged in error, or the board failed to publish on a day
        you paid for, write to{" "}
        <Link href="/contact" className="underline underline-offset-2" style={{ color: "var(--link)" }}>
          billing
        </Link>{" "}
        and we&rsquo;ll put it right. We can&rsquo;t refund a pass because the
        predictions lost — that is the nature of the thing being sold, and any
        service promising otherwise is not being straight with you.
      </>
    ),
  },
  {
    q: "Which leagues do you cover?",
    a: (
      <>
        The major European competitions by default, with more added over time.
        The league filter on the board always shows exactly what is live today.
      </>
    ),
  },
];

export default async function HelpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <PageShell
        eyebrow="Help centre"
        title="How MoonOdds works."
        intro="The questions we get asked most. If yours isn't here, write to us — the address is on the contact page."
      >
        <div className="divide-y divide-separator overflow-hidden rounded-[1.25rem] border border-border bg-surface">
          {FAQS.map(({ q, a }) => (
            <details key={q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[14px] font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  aria-hidden
                  className="flex-none text-[18px] leading-none text-muted transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="px-5 pb-5 text-[13px] leading-relaxed text-muted">
                {a}
              </div>
            </details>
          ))}
        </div>
      </PageShell>
      <SiteFooter />
      <BottomNav />
    </>
  );
}
