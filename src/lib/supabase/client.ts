import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 *
 * Only ever carries the publishable (anon) key. Every read it can make is
 * constrained by RLS, and `predictions` is granted to nobody — picks arrive
 * exclusively through the gated RPCs.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
