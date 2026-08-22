import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site-url";

/**
 * Where Google and the email magic link come back to.
 *
 * Supabase's PKCE flow sets a verifier cookie when the hand-off starts and
 * reads it back here, which is why this must be a route on our own origin and
 * not a client-side exchange.
 *
 * Everyone lands on /auth/details afterwards. That page forwards anyone who
 * already has a date of birth on file, so a returning visitor experiences it
 * as a redirect and a first-time one is asked the 18+ question exactly once.
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
    return NextResponse.redirect(
      `${SITE_URL}/auth/sign-in?error=${encodeURIComponent(exchangeError.message)}`,
    );
  }

  // Absolute, from the normalised site URL rather than from the request host:
  // the request may arrive on a preview or proxy hostname, and sending someone
  // back to whatever Host header they turned up with is an open-redirect shape.
  return NextResponse.redirect(`${SITE_URL}/auth/details`);
}
