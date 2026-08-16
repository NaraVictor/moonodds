import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://moonodds.app";

/**
 * Crawl rules.
 *
 * Everything public is open, because the whole argument for the product is a
 * track record anyone can check, and a record search engines cannot reach
 * persuades nobody.
 *
 * The disallowed paths are not secrets, they are already guarded server-side.
 * They are excluded because they are worthless in an index: /office is an
 * internal tool, /api returns JSON, /auth and /checkout are transactional
 * screens that would only ever rank for the wrong query.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/office", "/api/", "/auth/", "/checkout/", "/profile", "/slips"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
