/**
 * The site's own absolute base URL.
 *
 * `NEXT_PUBLIC_SITE_URL` is typed into a Vercel dashboard by hand, and the
 * natural thing to type is the bare host: `kicka.vercel.com`. That is not a
 * URL. `new URL("kicka.vercel.com")` throws ERR_INVALID_URL, and because
 * `metadataBase` is evaluated while Next collects page data, the whole
 * production build fails on a page nobody edited, with a stack that points at
 * /_not-found rather than at the setting.
 *
 * So this normalises rather than trusts:
 *   - a missing scheme becomes https (http only for localhost, which has none)
 *   - a trailing slash is dropped, so `${SITE_URL}/path` never doubles it
 *   - anything still unparseable falls back to the canonical host
 *
 * Falling back rather than throwing is deliberate. A wrong-but-valid base URL
 * produces share cards pointing at the wrong host, which is a bad afternoon; a
 * throw here takes the entire deploy down, which is a bad day.
 */

const DEFAULT_SITE_URL = "https://kicka.app";

export function normaliseSiteUrl(raw: string | undefined | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_SITE_URL;

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${/^localhost([:/]|$)/i.test(trimmed) ? "http" : "https"}://${trimmed}`;

  try {
    const url = new URL(withScheme);
    // Host-only base. A path here would be silently prepended to every
    // canonical, sitemap entry and payment callback.
    return `${url.protocol}//${url.host}`;
  } catch {
    console.error(
      `[site-url] NEXT_PUBLIC_SITE_URL="${raw}" is not a usable URL. Falling back to ${DEFAULT_SITE_URL}.`,
    );
    return DEFAULT_SITE_URL;
  }
}

/** The resolved base URL, no trailing slash. */
export const SITE_URL = normaliseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
