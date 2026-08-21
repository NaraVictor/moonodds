import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { PageShell, Section } from "@/components/legal/page-shell";
import { Mail, MessageSquare, ShieldAlert } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach Kicka about billing, a disputed result, or anything else.",
};

/**
 * Contact.
 *
 * Routed addresses rather than a form. A form promises a queue behind it; until
 * that queue exists, an address someone actually reads is more honest and gets
 * the sender a faster answer.
 */
const ROUTES = [
  {
    Icon: Mail,
    title: "General and billing",
    address: "hello@kicka.app",
    detail:
      "Passes, refunds, receipts, or anything about your account. Include the email you signed up with and we can find the payment.",
  },
  {
    Icon: MessageSquare,
    title: "A result looks wrong",
    address: "results@kicka.app",
    detail:
      "Send the fixture and what you believe the correct outcome was. Graded results are corrected by hand where the feed got it wrong, and the correction is recorded.",
  },
  {
    Icon: ShieldAlert,
    title: "Security",
    address: "security@kicka.app",
    detail:
      "If you have found a vulnerability, please tell us before telling anyone else. We will confirm receipt and keep you updated until it is closed.",
  },
];

export default async function ContactPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader signedIn={!!user} />
      <PageShell
        eyebrow="Contact"
        title="Talk to a person."
        intro="Small team, real inboxes. Pick the one that fits and you'll get a reply, usually within a working day."
      >
        <div className="space-y-3">
          {ROUTES.map(({ Icon, title, address, detail }) => (
            <div
              key={address}
              className="rounded-[1.25rem] border border-border bg-surface p-5"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
                  style={{ background: "var(--accent-wash)", color: "var(--accent)" }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <h2 className="text-[15px] font-semibold">{title}</h2>
              </div>
              <a
                href={`mailto:${address}`}
                className="mt-3 block text-[14px] font-semibold underline underline-offset-2"
                style={{ color: "var(--link)" }}
              >
                {address}
              </a>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{detail}</p>
            </div>
          ))}
        </div>

        <Section title="Before you write in about a prediction">
          <p>
            Every call has a detail page showing the reasoning, the factors
            considered, and the form and head-to-head it was built on. If a pick
            surprised you, that page will usually explain it faster than we can.
          </p>
          <p>
            We can&rsquo;t advise on whether to back a selection, and we
            can&rsquo;t give personalised betting or financial advice. What we
            can do is explain how a call was reached and correct it if the
            grading was wrong.
          </p>
        </Section>

        <Section title="Getting help with gambling">
          <p>
            If gambling has stopped being fun, stop and talk to someone
            independent of us.{" "}
            <a
              href="https://www.begambleaware.org"
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
              style={{ color: "var(--link)" }}
            >
              BeGambleAware
            </a>{" "}
            offers free, confidential support. We would rather lose a customer
            than keep one who needs to stop.
          </p>
        </Section>
      </PageShell>
      <SiteFooter />
      <BottomNav />
    </>
  );
}
