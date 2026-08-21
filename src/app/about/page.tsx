import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { PageShell, Section } from "@/components/legal/page-shell";

export const metadata: Metadata = {
  title: "About",
  description:
    "Kicka reads the numbers behind every fixture and tells you what it thinks, and exactly why. Analysis, not tips.",
};

export default async function AboutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <PageShell
        eyebrow="About"
        title="We show our working."
        intro="Kicka reads the numbers behind every fixture, form, expected goals, head-to-head, rest and travel, and tells you what it thinks and exactly why. You stay in charge of the call."
      >
        <Section title="What this is">
          <p>
            Kicka is an analysis product. Each morning a model works through
            the day&rsquo;s fixtures across the leagues we cover, and publishes
            the calls where it believes the market has mispriced something. Every
            prediction arrives with its reasoning, the factors that were weighed,
            and a confidence score.
          </p>
          <p>
            We are not a bookmaker. We take no bets, hold no funds, and settle
            nothing. Where you see a price it is an indicative market price shown
            so you can judge whether a call has any edge in it, not an offer.
          </p>
        </Section>

        <Section title="Why the reasoning matters">
          <p>
            Plenty of services will sell you a list of selections. A list is
            impossible to argue with, which sounds like a strength and is
            actually the problem: if you cannot see why a call was made, you
            cannot tell a good process having a bad week from a bad process.
          </p>
          <p>
            So the reasoning is the product. Every pick states its case, and the
            full record of what landed and what didn&rsquo;t stays public
            permanently, including the losses. Our settled calls are visible to
            everyone, signed in or not.
          </p>
        </Section>

        <Section title="Built for this market">
          <p>
            African football fans follow the European leagues closely and are
            badly served by products priced and designed for Europe and North
            America. Kicka is built the other way round: a day pass rather
            than a subscription, priced so a single day costs less than a coffee,
            with mobile as the primary surface rather than an afterthought.
          </p>
          <p>
            There is no recurring charge, no minimum term, and nothing to cancel.
            You buy the days you want.
          </p>
        </Section>

        <Section title="How the engine is kept honest">
          <p>
            Results are graded automatically against the final score, using the
            same grader whether a match settles on its own or an operator enters
            a correction by hand. Every manual override records who made it and
            why.
          </p>
          <p>
            The model&rsquo;s ranking weights are reviewed against settled
            results on a schedule, and any proposed change is held for human
            approval rather than applied silently. Nothing about the record is
            retouched after the fact.
          </p>
        </Section>

        <Section title="Play it sensibly">
          <p>
            A confidence score is a model&rsquo;s opinion about an uncertain
            event, not a promise. Football is not a solved game and no honest
            analysis will ever say otherwise. Never stake money you cannot
            comfortably lose, and if it stops being enjoyable, stop.
          </p>
        </Section>
      </PageShell>
      <SiteFooter />
      <BottomNav />
    </>
  );
}
