import { createClient } from "./supabase/server";

/**
 * Has this caller proved they control the address they signed in with?
 *
 * Accounts were once usable the moment they were created, on any address at
 * all, which mattered more once notifications started carrying slip results
 * and daily picks: we were mailing outcomes to addresses nobody had proven
 * they control.
 *
 * EITHER channel counts now, and that is not a loosening. Under passwordless
 * sign-in, receiving the one-time code IS the proof: a confirmed phone is
 * exactly as strong as a confirmed email, and stronger than a confirmed email
 * under the old flow, where the password was the credential and the click was
 * an afterthought.
 *
 * Checking only the email would have quietly locked every SMS-only account out
 * of checkout forever, with a message telling them to click a link that was
 * never sent to an address they never gave us.
 *
 * Applied where it changes something real, taking money and granting access,
 * rather than as a blanket wall. Someone mid-signup can still read the public
 * board, which is the part that might persuade them to finish.
 */
export async function requireVerifiedContact(): Promise<
  | { ok: true; userId: string; email: string | null; phone: string | null }
  | { ok: false; reason: string; status: number }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, reason: "Sign in first.", status: 401 };

  const emailOk = Boolean(user.email_confirmed_at);
  const phoneOk = Boolean(user.phone_confirmed_at);

  if (!emailOk && !phoneOk) {
    return {
      ok: false,
      reason: "Confirm your email address or phone number first.",
      status: 403,
    };
  }

  return {
    ok: true,
    userId: user.id,
    email: emailOk ? (user.email ?? null) : null,
    phone: phoneOk ? (user.phone ?? null) : null,
  };
}
