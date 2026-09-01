import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { WhatsAppFab } from "@/components/layout/whatsapp-help";
import { PageShell } from "@/components/legal/page-shell";

export const metadata: Metadata = {
  title: "Help centre",
  description:
    "How passes, free picks, confidence scores, slips and grading work.",
  alternates: { canonical: "/help" },
};

/**
 * Help centre.
 *
 * Native <details> rather than a JS accordion: it's keyboard accessible and
 * findable with in-page search for free, and this content has to work on a
 * phone with a weak connection before it has to animate.
 */
/**
 * `plain` exists for the FAQPage structured data below.
 *
 * Schema.org wants text and these answers are JSX, so rather than stringifying
 * React at runtime, each one carries a plain-text twin. The duplication is
 * deliberate and the shorter form is the point: the rich result shows two
 * lines, so an answer written for the page reads as truncated in search.
 *
 * Keep them saying the same thing. A FAQ answer that contradicts the page it
 * is drawn from is the kind of mismatch that costs the rich result entirely.
 */
const FAQS: { q: string; a: React.ReactNode; plain: string }[] = [
  {
    q: "What do I get for free?",
    a: (
      <>
        Two predictions a day, in full: the call, the confidence score and the
        reasoning, without an account. They&rsquo;re drawn from the day&rsquo;s
        three highest-confidence picks, so they&rsquo;re genuinely the ones
        we&rsquo;d lead with. Every settled prediction is also free to everyone,
        permanently.
      </>
    ),
    plain:
      "Two predictions a day in full, including the call, the confidence score and the reasoning, without an account. They are drawn from the day's three highest-confidence picks. Every settled prediction is free to everyone, permanently.",
  },
  {
    q: "What does a pass include?",
    a: (
      <>
        Every prediction published on the days it covers, with full reasoning. A
        day pass covers one publishing day; a week pass covers seven, and works
        out cheaper per day. There is no subscription, no minimum term and
        nothing to cancel — a pass runs out on its own.
      </>
    ),
    plain:
      "Every prediction published that day, with full reasoning, for one day. There is no subscription, no minimum term and nothing to cancel.",
  },
  {
    q: "What does the confidence score mean?",
    a: (
      <>
        How strongly the model rates its own call, from 0 to 100. It is not a
        probability that the outcome occurs and it is not a guarantee. A 90 means
        the model found unusually clear support in the data, it does not mean
        nine times in ten.
      </>
    ),
    plain:
      "How strongly the model rates its own call on a 0 to 10 scale, after every filter and penalty has been applied. It is a measure of the model's conviction, not a probability of winning.",
  },
  {
    q: "Why is a match on the board with the prediction hidden?",
    a: (
      <>
        Because you have used your free picks for the day. The fixture, teams,
        kickoff, venue, form and head-to-head stay public, those are football
        facts and not ours to hide. What&rsquo;s behind the pass is the call
        itself, its confidence and its reasoning.
      </>
    ),
    plain:
      "The fixture, the teams and the kickoff are public for everyone. The call, the market and the reasoning are what a day pass unlocks, because the market alone gives away where we think the mispricing is.",
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
    plain:
      "Automatically from the final score, using the same grading code for manual corrections. Markets we cannot settle are flagged for review rather than recorded as losses, and draw-no-bet draws and handicap pushes void.",
  },
  {
    q: "What is a slip?",
    a: (
      <>
        A way to record which predictions you followed, so you can track how they
        did as a group. Kicka does not take bets and holds no money, saving a
        slip places nothing anywhere. It is a notebook, not a bet.
      </>
    ),
    plain:
      "A saved set of predictions you are following together, with combined odds and a running record. Legs carry a real price from the odds snapshot, not one derived from confidence.",
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
        predictions lost, that is the nature of the thing being sold, and any
        service promising otherwise is not being straight with you.
      </>
    ),
    plain:
      "Yes, if a pass was charged in error or if we fail to publish predictions on a day you paid for. Refunds revoke the access they bought.",
  },
  {
    q: "Which leagues do you cover?",
    a: (
      <>
        The major European competitions by default, with more added over time.
        The league filter on the board always shows exactly what is live today.
      </>
    ),
    plain:
      "The major European competitions by default, with more added over time. The league filter on the board shows exactly what is live on any given day.",
  },
];

export default async function HelpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
   * FAQPage structured data.
   *
   * These eight questions are the ones people actually arrive searching for,
   * so they are the page's best claim on a rich result. Built from the same
   * array the page renders, which is what stops the markup and the visible
   * answers drifting apart — a mismatch Google treats as a reason to drop the
   * result rather than a detail to overlook.
   */
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.plain },
    })),
  };

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <PageShell
        eyebrow="Help centre"
        title="How Kicka works."
        intro="The questions we get asked most. If yours isn't here, write to us, the address is on the contact page."
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
      <WhatsAppFab />
      <BottomNav />
    </>
  );
}
