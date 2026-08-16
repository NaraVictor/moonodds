import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Server-side client bound to the request's cookies. Runs as the signed-in
 * user, so RLS still applies, this is the default for anything rendered on
 * the server.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for route handlers doing work no user is authorised to do: writing
 * predictions from the pipeline, activating a pass after Paystack confirms,
 * draining the jobs outbox. Never import this into a component, the key must
 * not reach the browser.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set, server-side jobs cannot run.",
    );
  }

  // Deliberately the plain supabase-js client, NOT createServerClient. The SSR
  // client layers cookie-based auth over the key, which downgrades the request
  // to the anon role, RLS then applies and every pipeline read comes back
  // empty with no error to explain it.
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
