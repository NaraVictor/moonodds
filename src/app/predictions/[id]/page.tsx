import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { WhatsAppFab } from "@/components/layout/whatsapp-help";
import { PredictionDetail } from "@/components/predictions/prediction-detail";
import { fetchPredictionMeta, fixtureHeadline } from "./meta";

/**
 * One prediction, in full.
 *
 * The public half of the product. Everything a visitor needs to judge the match
 * for themselves, form, head to head, season splits, the factors we weighed,
 * is here regardless of access; what stays behind the pass is our call on it.
 */

/**
 * Share and search metadata for a single fixture.
 *
 * Deliberately says nothing about which market we called or how confident we
 * are. Both are what the pass buys, and metadata is the one part of a page that
 * is readable without loading it: putting the call in a meta tag would hand it
 * to anyone viewing source, and to every crawler, for free.
 *
 * What it does carry is the match, which is the part that makes the link worth
 * clicking and the part someone might actually search for.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const meta = await fetchPredictionMeta(id);

  if (!meta) {
    return {
      title: "Prediction not found",
      robots: { index: false, follow: true },
    };
  }

  const headline = fixtureHeadline(meta);
  const settled = meta.status === "won" || meta.status === "lost";

  const description = settled
    ? `${headline} finished ${meta.homeGoals}-${meta.awayGoals}. See the Kicka call, the reasoning behind it, and how it settled.`
    : `${headline} in the ${meta.leagueName}. Form, head to head and season numbers, with the Kicka prediction and the reasoning behind it.`;

  return {
    // The root template appends "· Kicka", so the brand lands at the end of
    // every one of these without being repeated here.
    title: headline,
    description,
    alternates: { canonical: `/predictions/${id}` },
    openGraph: {
      type: "article",
      url: `/predictions/${id}`,
      title: `${headline} · Kicka`,
      description,
      siteName: "Kicka",
    },
    twitter: {
      card: "summary_large_image",
      title: `${headline} · Kicka`,
      description,
    },
    // A pending fixture's page is thin until it settles, and its useful content
    // is the part behind the pass. Let crawlers follow it, index it once it has
    // a result to show.
    robots: settled
      ? { index: true, follow: true }
      : { index: false, follow: true },
  };
}

export default async function PredictionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const meta = await fetchPredictionMeta(id);

  /**
   * SportsEvent structured data.
   *
   * Lets a search engine understand this as a specific fixture between two
   * named teams at a time and place, rather than as one more page with two
   * proper nouns on it. Built only from the public fields, same as the meta
   * tags: no market, no selection, no confidence.
   */
  const jsonLd = meta && {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${meta.homeName} v ${meta.awayName}`,
    startDate: meta.kickoff,
    // Schema.org's EventStatusType has no "finished" member: the vocabulary
    // covers scheduled, postponed, cancelled, rescheduled and moved online. A
    // match that kicked off as planned stays EventScheduled once it ends.
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Football",
    ...(meta.venue && {
      location: { "@type": "Place", name: meta.venue },
    }),
    homeTeam: {
      "@type": "SportsTeam",
      name: meta.homeName,
      ...(meta.homeLogo && { logo: meta.homeLogo }),
    },
    awayTeam: {
      "@type": "SportsTeam",
      name: meta.awayName,
      ...(meta.awayLogo && { logo: meta.awayLogo }),
    },
    ...(meta.leagueName && {
      superEvent: { "@type": "SportsEvent", name: meta.leagueName },
    }),
    organizer: { "@type": "Organization", name: "Kicka" },
  };

  /**
   * BreadcrumbList.
   *
   * These pages are the long tail — one per real fixture — and they are
   * reached from search rather than from the board, so the result is the first
   * time anyone sees where the page sits. The trail is what turns a bare URL in
   * the result into Kicka › Prediction history › this fixture.
   *
   * Every fixture page really is reachable by that path, which is the
   * condition for using this at all: a breadcrumb describing navigation that
   * does not exist is markup Google is entitled to distrust.
   */
  const breadcrumbLd = meta && {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Kicka", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Prediction history",
        item: `${SITE_URL}/history`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `${meta.homeName} v ${meta.awayName}`,
        item: `${SITE_URL}/predictions/${id}`,
      },
    ],
  };

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          // Serialised through JSON.stringify, so the only thing that reaches
          // the page is data we selected by name from our own database.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {breadcrumbLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
        />
      )}
      <SiteHeader signedIn={!!user} />
      <PredictionDetail id={id} />
      <SiteFooter />
      <WhatsAppFab />
      <BottomNav />
    </>
  );
}
