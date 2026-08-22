/**
 * Where analytics is switched on, and where its one public id lives.
 *
 * A GA4 measurement ID is not a secret: it ships to every browser that loads
 * the page. It is an environment variable so that the environment, rather than
 * the code, decides where measurements land, or whether they land at all.
 */
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";

/**
 * True only where the traffic is real.
 *
 * Development and preview deployments are not visitors. Counting them does not
 * add noise that can be subtracted later, it shifts every rate the product is
 * judged on, and nothing in the dashboard records that it happened.
 *
 * Two gates, because neither is sufficient alone:
 *
 *  - NODE_ENV keeps `next dev` out. A preview deployment is a production
 *    build, so this does not distinguish preview from production.
 *  - NEXT_PUBLIC_VERCEL_ENV does distinguish them, but only when "Enable
 *    access to System Environment Variables" is on in project settings. It is
 *    a checkbox, so it can be off, and then this is simply undefined.
 *
 * Which is why the real control is neither: scope NEXT_PUBLIC_GA_MEASUREMENT_ID
 * to the Production environment in Vercel and a preview build has no ID to
 * report against, whatever the checkbox says. The checks below are the belt to
 * that braces. See docs/DEPLOY.md.
 */
export function analyticsEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return false;

  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") return false;

  return true;
}
