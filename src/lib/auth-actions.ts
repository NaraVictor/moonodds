"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "./supabase/server";
import { normaliseSiteUrl } from "./site-url";
import { rateLimit } from "./rate-limit";

/**
 * Passwordless authentication.
 *
 * Passwords are gone from the product: no sign-in field, no sign-up field, no
 * reset flow, no "forgot it?" link. What replaced them is a one-time code sent
 * to an email address or a phone number, and Google.
 *
 * Why it is an improvement rather than a fashion: the three worst incidents a
 * product this size actually suffers are credential stuffing against reused
 * passwords, a password-reset flow used as an account-takeover primitive, and
 * a leaked password database. Storing no passwords removes all three. What it
 * costs is a dependency on email and SMS delivery actually working, which is
 * why both are checked by /api/health.
 *
 * ONE HONEST CAVEAT. Removing the UI does not disable the password grant at
 * the provider. Supabase still accepts signInWithPassword for any account that
 * has a password set, and the security suite depends on exactly that to sign
 * in as its five fixture accounts. Real accounts created through this file
 * never set a password, so they have none to guess; the fixture accounts do,
 * and they only exist on a local database. Turning the grant off entirely is a
 * dashboard setting and is recorded as a follow-up.
 */

/**
 * Server actions do not receive a Request, so the caller's address comes from
 * the incoming headers. The shared limiter needs a Request; these use the
 * in-process one directly, which is a per-instance bound. Supabase applies its
 * own server-side rate limits to OTP sends on top of this.
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
 * Age is collected on first sign-in instead, at /auth/details, because we
 * cannot ask for it before we know whether this is a new account.
 */
export async function requestCode(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const channel = String(formData.get("channel") ?? "email") === "sms" ? "sms" : "email";
  const identifier = String(formData.get("identifier") ?? "").trim();

  if (!identifier) {
    return { error: channel === "email" ? "Enter your email address." : "Enter your phone number." };
  }

  // Three sends per ten minutes. Deliberately tight: every one of these costs
  // money to deliver and lands in somebody's inbox or on their phone, so the
  // abuse case is not just load, it is using us to harass a stranger.
  const verdict = rateLimit(await actionKey(`otp-send:${channel}`), 3, 10 * 60);
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

    const { error } = await supabase.auth.signInWithOtp({
      email: identifier,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${siteUrl()}/auth/callback`,
      },
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

export async function verifyCode(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const channel = String(formData.get("channel") ?? "email") === "sms" ? "sms" : "email";
  const identifier = String(formData.get("identifier") ?? "").trim();
  const token = String(formData.get("code") ?? "").replace(/\s/g, "");

  if (!/^\d{6}$/.test(token)) return { error: "Enter the 6-digit code." };

  // Ten verifications per fifteen minutes. A six-digit code is a million
  // possibilities, so the limit is what makes guessing it impractical rather
  // than merely slow; Supabase expires the code as well.
  const verdict = rateLimit(await actionKey("otp-verify"), 10, 15 * 60);
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
  // Everyone lands here; the page sends on anyone who already has a date of
  // birth on file, so a returning user sees it only as a redirect.
  redirect("/auth/details");
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

/* ------------------------------------------------------------------ *
 * Age, collected once
 * ------------------------------------------------------------------ */

/**
 * Record a date of birth on first sign-in.
 *
 * The Terms assert 18+, so the product has to hold something that makes the
 * claim true. Self-declared, which is proportionate for an information product
 * and is not identity verification: it is checked, stored and auditable, which
 * a localStorage boolean was none of.
 *
 * It moved here from sign-up because a passwordless flow has no sign-up step
 * to put it in. The gate is the same; only its position changed.
 */
export async function submitDetails(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const dob = String(formData.get("dateOfBirth") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();

  const age = ageOn(dob);
  if (age === null) return { error: "Enter your date of birth." };
  if (age < 18) return { error: "You must be 18 or over to use Kicka." };
  if (age > 120) return { error: "Check that date of birth." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const { error } = await supabase
    .from("profiles")
    .update({
      date_of_birth: dob,
      display_name: displayName || user.email?.split("@")[0] || "Member",
    })
    .eq("id", user.id);

  if (error) return { error: "Could not save that. Try again." };

  revalidatePath("/", "layout");
  redirect("/");
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
 * number typed the way people actually write it (024…) is converted rather
 * than refused. Guessing +233 for a leading 0 is a deliberate local default:
 * this product settles in GHS and its SMS provider is Ghanaian.
 */
export async function normalisePhoneForDisplay(input: string): Promise<string | null> {
  return normalisePhone(input);
}

function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return /^\+\d{8,15}$/.test(digits) ? digits : null;
  }
  if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

function ageOn(dob: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const born = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;

  const now = new Date();
  let years = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) years--;
  return years;
}
