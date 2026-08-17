"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "./supabase/server";
import { normaliseSiteUrl } from "./site-url";
import { rateLimit } from "./rate-limit";

/**
 * Server actions do not receive a Request, so the caller's address comes from
 * the incoming headers. Same limiter as the route handlers, same caveat: it is
 * per-instance until the counter moves to shared storage.
 */
async function actionKey(scope: string): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

export type AuthResult = { error: string } | undefined;

export async function signIn(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  // Credential stuffing is the obvious attack on a form like this, and there
  // was nothing in front of it. Ten tries per address per fifteen minutes is
  // generous for a person and useless for a list.
  const verdict = rateLimit(await actionKey(`sign-in:${email.toLowerCase()}`), 10, 15 * 60);
  if (!verdict.ok) {
    return {
      error: `Too many attempts. Try again in ${Math.ceil(verdict.retryAfterSeconds / 60)} minutes.`,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Don't leak whether the address exists.
    return { error: "That email and password don't match an account." };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signUp(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const dob = String(formData.get("dateOfBirth") ?? "").trim();

  // 10, not 8. Paired with the rate limit on this route, length is the only
  // lever here that meaningfully raises the cost of an online guess.
  if (password.length < 10) {
    return { error: "Use at least 10 characters for your password." };
  }

  // Age verification. The Terms assert 18+, so the product has to hold
  // something that makes the claim true. Self-declared, which is proportionate
  // for an information product and is not identity verification: it is checked,
  // stored, and auditable, which the localStorage boolean was none of.
  const age = ageOn(dob);
  if (age === null) {
    return { error: "Enter your date of birth." };
  }
  if (age < 18) {
    return {
      error: "You must be 18 or over to use MoonOdds.",
    };
  }
  if (age > 120) {
    return { error: "Check that date of birth." };
  }

  const supabase = await createClient();
  const site = normaliseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100");

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Where Supabase sends them after they click the confirmation link.
      emailRedirectTo: `${site}/auth/confirmed`,
      data: {
        display_name: displayName || email.split("@")[0],
        date_of_birth: dob,
      },
    },
  });

  if (error) return { error: error.message };

  // The on_auth_user_created trigger has already created the profile and
  // notification defaults, no client-side bootstrap call needed.
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Development only: sign in as one of the seeded demo accounts so every access
 * tier is reachable without buying anything. Refuses to run outside dev.
 */
export async function signInAsDemo(email: string): Promise<AuthResult> {
  if (process.env.NODE_ENV === "production") {
    return { error: "Demo sign-in is disabled in production." };
  }
  if (!email.endsWith("@moonodds.test")) {
    return { error: "Not a demo account." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: "moonodds",
  });

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return undefined;
}

/**
 * Send a password reset link.
 *
 * Always reports success, whatever happened. Saying "no account with that
 * address" turns this form into an oracle for which emails are registered,
 * which is worth more to someone enumerating accounts than the reset is worth
 * to the person who forgot their password.
 */
export async function requestPasswordReset(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) return { error: "Enter your email address." };

  // Throttled on the address so this cannot be used to mail-bomb someone, and
  // the limit is applied before the send rather than after.
  const verdict = rateLimit(await actionKey(`reset:${email.toLowerCase()}`), 3, 15 * 60);
  if (!verdict.ok) return undefined;

  const supabase = await createClient();
  const site = normaliseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100");

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${site}/auth/reset`,
  });

  if (error) {
    // Logged, never surfaced: a mail-provider failure is ours, not the
    // visitor's, and the response must not vary with whether the address
    // exists.
    console.error("[auth] password reset request:", error.message);
  }

  return undefined;
}

/**
 * Set a new password.
 *
 * Runs against the recovery session Supabase establishes when the emailed link
 * is followed, so there is no token to handle here: if there is no session, the
 * link was never followed or has expired.
 */
export async function updatePassword(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 10) {
    return { error: "Use at least 10 characters." };
  }
  if (password !== confirm) {
    return { error: "Those two passwords don't match." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "That reset link has expired. Request a new one and try again.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/");
}


/** Whole years old on today's date, or null when the input is not a date. */
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
