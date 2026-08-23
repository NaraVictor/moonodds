import { createBrowserClient } from "@supabase/ssr";
import { supabaseCredentials } from "./credentials";

/**
 * Browser-side Supabase client.
 *
 * Only ever carries the publishable (anon) key. Every read it can make is
 * constrained by RLS, and `predictions` is granted to nobody, picks arrive
 * exclusively through the gated RPCs.
 */
export function createClient() {
  // Non-null assertions used to hide a missing or mismatched key until
  // Supabase rejected the request, by which point the only evidence was the
  // words "Invalid API key" under a sign-in field.
  const { url, key } = supabaseCredentials();
  return createBrowserClient(url, key);
}
