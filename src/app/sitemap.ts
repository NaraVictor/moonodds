import type { MetadataRoute } from "next";
import { createServiceClient } from "@/lib/supabase/server";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://moonodds.app";

/**
 * Sitemap.
 *
 * The static pages plus every settled prediction, because those detail pages
 * are the long tail: each one is a real fixture with real teams, and they are
 * the pages someone searching "Arsenal v Chelsea prediction" could plausibly
 * land on. Pending picks are deliberately excluded, since the part a crawler
 * would index is exactly the part behind the pass.
 *
 * Capped at 5,000 rows. Google's limit is 50,000 per file, but a sitemap that
 * takes seconds to generate becomes a slow route nobody notices is slow, and
 * paginating this is a problem worth having later.
 */
export const revalidate = 3600;

const STATIC: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, freq: "hourly" },
  { path: "/history", priority: 0.9, freq: "daily" },
  { path: "/about", priority: 0.5, freq: "monthly" },
  { path: "/help", priority: 0.5, freq: "monthly" },
  { path: "/contact", priority: 0.3, freq: "yearly" },
  { path: "/terms", priority: 0.2, freq: "yearly" },
  { path: "/policy", priority: 0.2, freq: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const base: MetadataRoute.Sitemap = STATIC.map((s) => ({
    url: `${SITE_URL}${s.path}`,
    lastModified: now,
    changeFrequency: s.freq,
    priority: s.priority,
  }));

  try {
    const db = createServiceClient();
    const { data } = await db
      .from("predictions")
      .select("id, settled_at")
      .in("status", ["won", "lost", "void"])
      .order("settled_at", { ascending: false })
      .limit(5000);

    for (const p of data ?? []) {
      base.push({
        url: `${SITE_URL}/predictions/${p.id}`,
        lastModified: p.settled_at ? new Date(p.settled_at) : now,
        changeFrequency: "yearly",
        priority: 0.6,
      });
    }
  } catch (err) {
    // A sitemap missing its long tail still beats a 500 that costs the static
    // pages their listing too.
    console.error("[sitemap] could not load settled predictions:", err);
  }

  return base;
}
