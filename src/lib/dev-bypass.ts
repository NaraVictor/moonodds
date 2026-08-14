/**
 * Development-only auth bypass.
 *
 * Set DEV_BYPASS_AUTH=true in .env.local to walk the whole flow without being
 * stopped by sign-in redirects, the super-admin gate, or the cron bearer
 * secret. To re-enable every guard, set it to false (or delete the line) and
 * restart — nothing else changes.
 *
 * Three things make this safe to have in the tree:
 *
 *   1. It is hard-wired off when NODE_ENV === "production". Even with the flag
 *      set, a production build ignores it. This is not configurable.
 *   2. It never touches the database. RLS, the gated picks RPC, and the
 *      SECURITY DEFINER functions all still apply — a bypassed session is still
 *      subject to whatever the database says that user may read. What it skips
 *      is the *routing* layer: redirects and 401/403 short-circuits.
 *   3. While it is on, every page shows a persistent banner, so it cannot be
 *      left on by accident without somebody noticing.
 *
 * Because of (2), the paywall is still enforced for a bypassed anonymous
 * visitor — you'll reach /office, but the data behind it comes back empty
 * unless you're signed in as an admin. Sign in as a demo account to see real
 * data; the bypass is about reaching the routes, not faking an identity.
 */
export function devBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.DEV_BYPASS_AUTH === "true";
}

/** Same check, exposed to client components via a public env var. */
export function devBypassEnabledClient(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true";
}
