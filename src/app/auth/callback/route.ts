import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site-url";
import { reportError } from "@/lib/report-error";

/**
 * Where Google comes back to. Only Google.
 *
 * Email sign-in never reaches here: it sends a six-digit code that is typed
 * back into the page, precisely so it does not depend on which browser a mail
 * client decides to open. Supabase's PKCE flow stores a verifier when the
 * hand-off starts and reads it back here, and a link followed from an inbox
 * arrives without it — which is the "PKCE code verifier not found in storage"
 * failure this product no longer has a path to.
 *
 * Straight to the board afterwards. Google has already told us the address is
 * real and supplied a name, so there is nothing left to ask and no code to
 * send: a second factor after Google has verified them is friction that buys
 * nothing.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${SITE_URL}/auth/sign-in?error=${encodeURIComponent(error)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${SITE_URL}/auth/sign-in`);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    /*
     * Supabase's own message here is written for whoever built the app, not
     * for whoever is trying to sign in: it names PKCE, storage and SSR
     * frameworks, and recommends a package. Shown on a sign-in page it tells a
     * customer nothing they can act on, so it goes to the error tracker and
     * they get a sentence with a next step in it.
     */
    reportError(exchangeError, {
      scope: "auth/callback",
      detail: { stage: "exchangeCodeForSession" },
    });
    return NextResponse.redirect(
      `${SITE_URL}/auth/sign-in?error=${encodeURIComponent("google-failed")}`,
    );
  }

  // Absolute, from the normalised site URL rather than from the request host:
  // the request may arrive on a preview or proxy hostname, and sending someone
  // back to whatever Host header they turned up with is an open-redirect shape.
  return NextResponse.redirect(`${SITE_URL}/`);
}
