"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "./supabase/server";
import { normaliseSiteUrl } from "./site-url";
import { sharedRateLimit } from "./rate-limit";

/**
 * Passwordless authentication.
 *
 * Passwords are gone from the product: no sign-in field, no sign-up field, no
 * reset flow, no "forgot it?" link. What replaced them is a one-time code sent
 * to an email address, and Google.
 *
 * SMS is implemented end to end and switched off in the UI for now. The
 * provider hook, the phone normaliser and the verify path all stay, because
 * the cost of keeping them is a few unused functions and the cost of deleting
 * them is writing them again.
 *
 * Why it is an improvement rather than a fashion: the three worst incidents a
 * product this size actually suffers are credential stuffing against reused
 * passwords, a password-reset flow used as an account-takeover primitive, and
 * a leaked password database. Storing no passwords removes all three. What it
 * costs is a dependency on email and SMS delivery actually working, which is
 * why both are checked by /api/health.
 *
 * No account here ever has a password. The security suite used to depend on
 * signInWithPassword to reach its fixture accounts; it now mints sessions
 * through the admin API, so nothing in the product or its tests needs the
 * grant and every fixture account has had its password stripped.
 */

/**
 * Server actions do not receive a Request, so the caller's address comes from
 * the incoming headers. The counter itself is the shared Postgres one, the
 * same as the route handlers use: these actions ARE the sign-in now, so a
 * per-instance bound on them was the weakest limit in the product guarding the
 * most valuable thing. Supabase applies its own limits on top.
 */
async function actionKey(scope: string): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

export type AuthResult = { error: string } | { sent: true; channel: "email" | "sms" } | undefined;

function siteUrl(): string {
  return normaliseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100");
}

/* ------------------------------------------------------------------ *
 * Step one: ask for a code
 * ------------------------------------------------------------------ */

/**
 * Send a one-time code to an email address or a phone number.
 *
 * `shouldCreateUser` is true, so this is both sign-in and sign-up. That is the
 * point of a passwordless flow: there is no meaningful difference between the
 * two, and asking someone to remember which one they are is a step that exists
 * only because passwords used to.
 *
 * Nothing else is asked. A display name is generated if none is given and can
 * be changed on the profile page, which is the only place it matters.
 */
export async function requestCode(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  // Email only for now. The parameter stays because verifyCode and the SMS
  // hook still speak it, and a form that cannot select "sms" is a smaller
  // change to undo than a code path that no longer exists.
  const channel = String(formData.get("channel") ?? "email") === "sms" ? "sms" : "email";
  const identifier = String(formData.get("identifier") ?? "").trim();

  if (!identifier) {
    return { error: channel === "email" ? "Enter your email address." : "Enter your phone number." };
  }

  // Three sends per ten minutes. Deliberately tight: every one of these costs
  // money to deliver and lands in somebody's inbox or on their phone, so the
  // abuse case is not just load, it is using us to harass a stranger.
  const verdict = await sharedRateLimit(await actionKey(`otp-send:${channel}`), 3, 10 * 60);
  if (!verdict.ok) {
    return {
      error: `Too many codes requested. Try again in ${Math.ceil(verdict.retryAfterSeconds / 60)} minutes.`,
    };
  }

  const supabase = await createClient();

  if (channel === "email") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identifier)) {
      return { error: "That doesn't look like an email address." };
    }

    /*
     * NO emailRedirectTo, deliberately.
     *
     * Supplying one tells Supabase to build a magic link, and a link is the
     * one thing this flow must not send: following it opens Supabase's verify
     * endpoint in whatever browser the mail client chooses, which is not the
     * browser holding the PKCE verifier cookie, and the exchange fails with
     * "PKCE code verifier not found in storage". A numeric code typed back
     * into the page works from any device because it carries no browser state.
     *
     * The email template must render {{ .Token }} for this to be useful. That
     * is set in config.toml for local and in the dashboard for the deployed
     * project — the default template is a link.
     */
    const { error } = await supabase.auth.signInWithOtp({
      email: identifier,
      // First time through, this creates the account. There is no separate
      // sign-up and no confirmation step: receiving the code IS the proof the
      // address is real, so asking for a second confirmation would be asking
      // someone to prove the same thing twice.
      options: { shouldCreateUser: true },
    });
    if (error) return { error: error.message };
    return { sent: true, channel: "email" };
  }

  const phone = normalisePhone(identifier);
  if (!phone) {
    return { error: "Enter the number in full, including the country code." };
  }

  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: true },
  });
  if (error) return { error: error.message };
  return { sent: true, channel: "sms" };
}

/* ------------------------------------------------------------------ *
 * Step two: prove you received it
 * ------------------------------------------------------------------ */

/**
 * Verify a code and open the session. Shared by both entry points.
 *
 * Split out because the two callers differ in exactly one thing: where the
 * person goes next. The sign-in page sends them to the board; the payment page
 * must not go anywhere at all, because leaving it is the problem being solved.
 *
 * `redirect()` throws to unwind the request, so a caller that wants to stay put
 * cannot simply ignore its return value — the navigation has to be absent
 * rather than discarded, which is why this returns and the wrappers decide.
 */
async function verifyCodeCore(formData: FormData): Promise<AuthResult | { ok: true }> {
  const channel = String(formData.get("channel") ?? "email") === "sms" ? "sms" : "email";
  const identifier = String(formData.get("identifier") ?? "").trim();
  // Digits only, and whatever length the project issues.
  //
  // This required exactly six, because config.toml sets otp_length = 6. That
  // setting governs LOCAL Supabase only: the deployed project was issuing
  // EIGHT, so a real code pasted into a six-character field was truncated by
  // the input and then refused by this check, with "Enter the 6-digit code"
  // telling someone holding a correct code that it was the wrong shape.
  //
  // Supabase permits 6 to 10, so the range is accepted rather than a number
  // pinned here to match a setting that lives somewhere else.
  const token = String(formData.get("code") ?? "").replace(/\D/g, "");

  if (!/^\d{6,10}$/.test(token)) return { error: "Enter the code we sent you." };

  // Ten verifications per fifteen minutes. Six digits is a million
  // possibilities, so the limit is what makes guessing it impractical rather
  // than merely slow; Supabase expires the code as well.
  const verdict = await sharedRateLimit(await actionKey("otp-verify"), 10, 15 * 60);
  if (!verdict.ok) {
    return { error: "Too many attempts. Request a fresh code." };
  }

  const supabase = await createClient();

  const { error } =
    channel === "email"
      ? await supabase.auth.verifyOtp({ email: identifier, token, type: "email" })
      : await supabase.auth.verifyOtp({
          phone: normalisePhone(identifier) ?? identifier,
          token,
          type: "sms",
        });

  if (error) return { error: "That code is wrong or has expired." };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Sign-in page: verify, then straight to the board.
 *
 * There is no details step. A code proved the address and everything else about
 * the account is optional, so there is nothing left to ask before someone can
 * use what they came for.
 */
export async function verifyCode(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const result = await verifyCodeCore(formData);
  if (result && "error" in result) return result;
  redirect("/");
}

/**
 * Payment page: verify and stay exactly where you are.
 *
 * The session cookie is set on this response either way; only the navigation
 * differs. The caller opens Paystack the moment this resolves, which is the
 * whole point — the code and the card are one motion rather than two, with a
 * sign-in page and a journey back in between.
 */
export async function verifyCodeInline(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult | { ok: true }> {
  return verifyCodeCore(formData);
}

/* ------------------------------------------------------------------ *
 * Google
 * ------------------------------------------------------------------ */

/**
 * Hand off to Google.
 *
 * Returns a URL rather than redirecting here, because Supabase needs the
 * browser to make the trip: the PKCE verifier is set as a cookie on this
 * response and read back at /auth/callback.
 */
export async function signInWithGoogle(): Promise<void> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${siteUrl()}/auth/callback`,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });

  // Returning an error object is not available here: this is used as a bare
  // form action, which must resolve to void. A provider that is not configured
  // sends the visitor back to the sign-in page with a reason in the query
  // string, where the page renders it, rather than failing silently.
  if (error || !data?.url) {
    redirect(`/auth/sign-in?error=${encodeURIComponent(error?.message ?? "google-unavailable")}`);
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * E.164, or nothing.
 *
 * Supabase requires the country code and rejects anything else, so a Ghanaian
 * number typed the way people actually write it (024...) is converted rather
 * than refused. Guessing +233 for a leading 0 is a deliberate local default:
 * this product settles in GHS and its SMS provider is Ghanaian.
 *
 * Unused by the form while SMS is off, and kept because the verify path and
 * the provider hook still speak it.
 */

function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return /^\+\d{8,15}$/.test(digits) ? digits : null;
  }
  if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

