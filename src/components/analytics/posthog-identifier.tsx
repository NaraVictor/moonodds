"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Identifies the authenticated user in PostHog and resets on sign-out.
 *
 * Mounted once at the root layout. It subscribes to Supabase auth-state
 * changes so identification fires both on the initial page load (returning
 * visitor) and immediately after a sign-in event, without a full-page reload.
 *
 * The distinct ID is the Supabase user UUID — a stable, opaque identifier that
 * carries no PII itself. PII (email, name) belongs on the person profile via
 * identify(), not in event properties.
 */
export function PostHogIdentifier() {
  useEffect(() => {
    const supabase = createClient();

    // Fire for the current session immediately, then for every change.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        posthog.identify(session.user.id);
      } else {
        // User signed out — discard the identified session so the next
        // anonymous visitor is not associated with the previous account.
        posthog.reset();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
