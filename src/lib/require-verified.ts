import { createClient } from "./supabase/server";

/**
 * Is this caller's email address confirmed?
 *
 * Accounts were usable the moment they were created, on any address at all,
 * which mattered more once the notification channel started carrying slip
 * results and daily picks: we were mailing outcomes to addresses nobody had
 * proven they control.
 *
 * Applied at the points where it changes something real, taking money and
 * granting access, rather than as a blanket wall. Someone who has signed up and
 * not yet clicked the link can still read the public board, which is the part
 * that might persuade them to finish.
 *
 * Supabase can also enforce confirmation at the auth layer. This is the
 * application-side half, so the rule holds whichever way that project setting
 * is configured.
 */
export async function requireVerifiedEmail(): Promise<
  { ok: true; userId: string; email: string } | { ok: false; reason: string; status: number }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, reason: "Sign in first.", status: 401 };

  if (!user.email_confirmed_at) {
    return {
      ok: false,
      reason:
        "Confirm your email address first. We sent you a link when you signed up, and we can send another from your profile.",
      status: 403,
    };
  }

  return { ok: true, userId: user.id, email: user.email ?? "" };
}
