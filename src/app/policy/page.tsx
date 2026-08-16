import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { PageShell, Section } from "@/components/legal/page-shell";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What MoonOdds collects, why, and what you can ask us to do with it.",
};

/**
 * Privacy policy.
 *
 * Describes what the application actually stores, profiles, passes, payment
 * references, notification preferences, saved slips, rather than the generic
 * superset a template would list. A policy claiming to collect things we don't,
 * or omitting things we do, is worse than none.
 */
export default async function PolicyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <PageShell
        eyebrow="Legal"
        title="Privacy policy"
        intro="We collect what the product needs to work, and nothing we'd struggle to justify."
        updated="15 August 2026"
        needsReview
      >
        <Section title="What we collect">
          <p>
            <strong className="text-foreground">If you browse without an account:</strong>{" "}
            nothing that identifies you. Your 18+ confirmation and your card or
            table preference are stored in your own browser, not on our servers.
          </p>
          <p>
            <strong className="text-foreground">If you create an account:</strong> your
            email address, a display name if you set one, and a phone number if
            you choose to add one for SMS alerts.
          </p>
          <p>
            <strong className="text-foreground">If you buy a pass:</strong> a record that
            the pass exists, the day it covers, and a reference to the
            transaction with our payment processor. We never see or store your
            card details.
          </p>
          <p>
            <strong className="text-foreground">As you use the product:</strong> the slips
            you save and your notification preferences.
          </p>
        </Section>

        <Section title="What we use it for">
          <p>
            To give you access to what you paid for, to send the alerts you asked
            for, to show you your own saved slips, and to answer you when you get
            in touch. That is the whole list.
          </p>
          <p>
            We do not sell personal data. We do not share it with advertisers. We
            do not build advertising profiles.
          </p>
        </Section>

        <Section title="Who else is involved">
          <p>
            Our database and authentication run on Supabase. Payments are
            processed by Paystack. Fixture data comes from API-Football, which
            receives no information about you, we ask it about matches, not
            about people. Email and SMS alerts are delivered by a messaging
            provider that receives only the address needed to deliver them.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Account data stays until you ask us to delete it. Pass and payment
            records are kept for as long as accounting and tax obligations
            require, which is typically several years and is not something we can
            waive on request.
          </p>
        </Section>

        <Section title="Your choices">
          <p>
            You can edit your profile and turn any alert off from your account
            page at any time. Two things you no longer need to ask us for:{" "}
            <strong>Download my data</strong> gives you everything we hold about
            you as a file, and <strong>Delete my account</strong> removes it.
            Both are on your profile page and neither needs our involvement.
          </p>
          <p>
            Deleting removes your profile, slips, preferences and play limits
            immediately. Payment records are kept but unlinked from you: they
            are financial records we are required to retain, and they no longer
            identify you once the account is gone.
          </p>
          <p>
            Clearing your browser storage removes the 18+ confirmation and view
            preference held on your device.
          </p>
        </Section>

        <Section title="Your rights over this data">
          <p>
            Where data-protection law applies to you, and it does under Ghana&rsquo;s
            Data Protection Act and under the UK and EU GDPR, you have the right
            to be told what we hold, to get a copy of it, to have it corrected,
            to have it erased, to restrict or object to how we use it, and to
            take it elsewhere in a portable form.
          </p>
          <p>
            The copy and the erasure are both self-service on your profile page,
            so exercising those two takes a click rather than a request. For
            anything else, write to hello@moonodds.app and we will answer within
            30 days, which is the outside limit the law allows rather than how
            long we intend to take.
          </p>
          <p>
            We rely on two lawful bases. Running your account and taking payment
            for a pass is <em>performance of a contract</em>, you asked us for
            the service and we cannot provide it otherwise. Keeping the service
            secure and working is our <em>legitimate interest</em>. Where we ask
            for consent, for SMS alerts, you can withdraw it from your profile
            and it takes effect immediately.
          </p>
          <p>
            If you think we have handled your data badly, tell us first so we
            can put it right. You are also entitled to complain to the Data
            Protection Commission in Ghana, or to the supervisory authority
            where you live.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Access to your data is enforced in the database itself through
            row-level security, not only in application code, so a bug in the
            interface cannot expose another user&rsquo;s slips, passes or
            payments. If you believe you have found a way around that, please
            write to security@moonodds.app before telling anyone else.
          </p>
        </Section>

        <Section title="Children">
          <p>
            MoonOdds is for adults aged 18 and over. We do not knowingly collect
            data from children. If you believe a child has created an account,
            tell us and we will remove it.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p>
            If this policy changes materially we will say so in the product
            before the change takes effect. Questions go to hello@moonodds.app.
          </p>
        </Section>
      </PageShell>
      <SiteFooter />
      <BottomNav />
    </>
  );
}
