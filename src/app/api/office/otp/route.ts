import { createHmac, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getProviders } from "@/lib/providers";
import { esc, note, p, renderEmail } from "@/lib/email-layout";

/**
 * Confirmation code for system-prompt changes.
 *
 * The prompt IS the product, a bad edit silently degrades every pick the
 * engine makes, and unlike a weight change there's no numeric bound to catch
 * it. So changing it takes a second factor, as it did in the original app.
 *
 * POST: mint a 6-digit code and email it to the admin.
 * PATCH: redeem the code and apply the prompt in one step.
 */

const PURPOSE = "update_system_prompt";
const TTL_MINUTES = 10;

/**
 * The digest that goes in the database, so the six digits never do.
 *
 * otp_tokens.code held the code as typed. RLS keeps every client out of that
 * table, so reading it takes a database compromise — a backup, a replica, a
 * support query, an accidental grant. But this is the SECOND factor on
 * system-prompt changes, and a second factor whose value is sitting next to
 * the thing it protects is not one.
 *
 * Keyed, not merely hashed. Six digits is a million possibilities: a plain
 * digest, salted or not, is reversed by anyone holding the row in the time it
 * takes to loop to a million. What makes this worth doing is that the key is
 * not in the database.
 *
 * The key is DERIVED from the service-role secret rather than being a new
 * environment variable, so there is nothing to configure and no deployment
 * where the Office stops issuing codes because a value was missed. Deriving it
 * through HMAC with a fixed label keeps it a separate key: this digest cannot
 * be replayed anywhere else the service-role secret is used, and the secret
 * cannot be recovered from it.
 */
function digestOtp(code: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    // Fail closed. Issuing a code we cannot verify later, or verifying against
    // a key that changed, both end with an admin locked out of their own
    // Office — better to say so at the point the secret is missing.
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set, cannot key the OTP digest.");
  }
  const key = createHmac("sha256", secret).update("kicka-otp-pepper-v1").digest();
  return createHmac("sha256", key).update(code).digest("hex");
}

/**
 * The confirmation code, through the same shell as everything else.
 *
 * Exported so it can be rendered without sending one — an email you can only
 * see by triggering it is an email nobody reviews.
 */
export function promptCodeEmail(code: string): string {
  return renderEmail({
    preheader: `Your confirmation code expires in ${TTL_MINUTES} minutes.`,
    body:
      p("Someone asked to change the engine's system prompt. Here is the code to confirm it:") +
      `<p style="margin:0 0 16px;font-size:32px;font-weight:800;letter-spacing:8px;color:#111827;">${esc(code)}</p>` +
      note(
        `It expires in ${TTL_MINUTES} minutes and works once. If this was not you, ignore this email — nothing has changed, and nobody can apply the change without this code.`,
      ),
    // No call to action. The code is used in the Office, and a button in a
    // security email trains people to click buttons in security emails.
    signOff: false,
  });
}

export async function POST(request: Request) {
  // Minting is cheap for us and noisy for the admin whose inbox it fills.
  const limited = await enforceRateLimit(request, {
    scope: "otp-mint",
    limit: 5,
    windowSeconds: 10 * 60,
    message: "Too many codes requested. Try again in a few minutes.",
  });
  if (limited) return limited;

  const guard = await requireSuperAdmin();
  if ("error" in guard) return guard.error;

  const email = guard.user.email;
  if (!email) {
    return NextResponse.json(
      { error: "Your account has no email address to send a code to." },
      { status: 400 },
    );
  }

  const db = createServiceClient();

  /*
   * crypto.randomInt, not Math.random.
   *
   * Math.random is xorshift128+ in V8: seeded per realm, and its future output
   * is derivable from enough observed output. This code is the SECOND FACTOR on
   * the system prompt — the thing the file header calls the product — so its
   * whole value is that holding a super-admin session is not enough without the
   * admin's inbox. A predictable code gives that back.
   *
   * randomInt draws from the CSPRNG and takes the range directly, so it also
   * avoids the modulo bias the arithmetic above would have had.
   */
  const code = String(randomInt(100_000, 1_000_000));
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  // Retire any outstanding codes so only the newest one works.
  await db
    .from("otp_tokens")
    .update({ used: true })
    .eq("email", email)
    .eq("purpose", PURPOSE)
    .eq("used", false);

  const { error } = await db.from("otp_tokens").insert({
    email,
    code_hash: digestOtp(code),
    purpose: PURPOSE,
    expires_at: expiresAt,
    used: false,
  });

  if (error) {
    return NextResponse.json({ error: "Could not issue a code." }, { status: 500 });
  }

  const { messaging, mocked } = getProviders();
  await messaging.sendEmail({
    to: email,
    subject: "Kicka, confirm the system prompt change",
    // Through the shell like everything else. This was the last message still
    // shipping two bare <p> tags — no wordmark, no footer, no way back to the
    // site — which on a security email is the wrong impression to give: an
    // unbranded code in a plain message is exactly what a phishing attempt
    // looks like.
    html: promptCodeEmail(code),
  });

  const masked = email.replace(/^(.{2}).*(@.*)$/, "$1***$2");

  // In mock mode the email only reaches the server log, so the code comes back
  // here, otherwise the flow is untestable. Never returned when live.
  return NextResponse.json({
    sent: true,
    maskedEmail: masked,
    ...(mocked ? { devCode: code } : {}),
  });
}

const Apply = z.object({
  // Digits only. `length(6)` accepted any six characters, which is not an
  // attack so much as a wrong error message: a pasted "12 34 5" failed the
  // lookup and reported the code as expired.
  code: z.string().regex(/^\d{6}$/),
  configId: z.uuid(),
  systemPrompt: z.string().min(20).max(100_000),
});

export async function PATCH(request: Request) {
  // Six digits is a million combinations, which an unthrottled loop exhausts in
  // minutes. This is the control that makes the code worth having.
  //
  // Two limits, because one of them was the wrong shape. The IP limit runs
  // first and cheaply, and is what stops an unauthenticated flood. But keyed on
  // IP ALONE it bounds an address rather than an account, and an attacker with
  // a session and a pool of addresses is not slowed by it at all — which is
  // precisely the attacker this code exists to stop. rate-limit.ts already says
  // limits protecting something valuable should also be keyed on the
  // authenticated user; this one was not.
  const limitedByIp = await enforceRateLimit(request, {
    scope: "otp-redeem",
    limit: 10,
    windowSeconds: 15 * 60,
    message: "Too many attempts. Wait 15 minutes and request a fresh code.",
  });
  if (limitedByIp) return limitedByIp;

  const guard = await requireSuperAdmin();
  if ("error" in guard) return guard.error;

  // Per admin, after the identity is known, so it cannot be sidestepped by
  // moving address. Five is the real budget; the IP limit above is only the
  // outer wall.
  const limitedByAccount = await enforceRateLimit(request, {
    scope: "otp-redeem-user",
    limit: 5,
    windowSeconds: 15 * 60,
    message: "Too many attempts. Wait 15 minutes and request a fresh code.",
    extraKey: guard.user.id,
  });
  if (limitedByAccount) return limitedByAccount;

  const parsed = Apply.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  const email = guard.user.email;
  const db = createServiceClient();

  /*
   * Burn the code by CLAIMING it, not by reading it and then writing.
   *
   * The read-then-update version admitted two simultaneous requests: both
   * selected the same unused row, both passed the check, and both went on to
   * apply a different prompt. One code, two prompt changes, and only the second
   * survives — with the audit log showing both as legitimate.
   *
   * `update ... where used = false ... returning` is a single statement, so
   * exactly one caller can win the row. Losing looks identical to a wrong code,
   * which is the correct thing to tell a caller either way.
   *
   * Expiry is part of the same predicate rather than a check afterwards: a
   * separate check leaves a window where an expired code is still marked used,
   * which is harmless but makes the log read as though it worked.
   */
  const { data: claimed } = await db
    .from("otp_tokens")
    .update({ used: true })
    .eq("email", email!)
    .eq("purpose", PURPOSE)
    .eq("code_hash", digestOtp(parsed.data.code))
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (!claimed) {
    return NextResponse.json(
      { error: "That code is wrong or has expired. Request a new one." },
      { status: 403 },
    );
  }

  const { error } = await db
    .from("ai_engine_config")
    .update({
      system_prompt: parsed.data.systemPrompt,
      last_updated_at: new Date().toISOString(),
      approved_by: email,
    })
    .eq("id", parsed.data.configId);

  if (error) {
    return NextResponse.json({ error: "Could not save the prompt." }, { status: 500 });
  }

  return NextResponse.json({ updated: true });
}
