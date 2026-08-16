import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getProviders } from "@/lib/providers";

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

export async function POST(request: Request) {
  // Minting is cheap for us and noisy for the admin whose inbox it fills.
  const limited = enforceRateLimit(request, {
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
  const code = String(Math.floor(100000 + Math.random() * 900000));
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
    code,
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
    subject: "MoonOdds, confirm the system prompt change",
    html: `<p>Your confirmation code is <strong style="font-size:24px;letter-spacing:4px">${code}</strong></p>
           <p>It expires in ${TTL_MINUTES} minutes. If you didn't request this, ignore this email, nothing has changed.</p>`,
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
  code: z.string().length(6),
  configId: z.uuid(),
  systemPrompt: z.string().min(20).max(100_000),
});

export async function PATCH(request: Request) {
  // Six digits is a million combinations, which an unthrottled loop exhausts in
  // minutes. This is the control that makes the code worth having.
  const limited = enforceRateLimit(request, {
    scope: "otp-redeem",
    limit: 5,
    windowSeconds: 15 * 60,
    message: "Too many attempts. Wait 15 minutes and request a fresh code.",
  });
  if (limited) return limited;

  const guard = await requireSuperAdmin();
  if ("error" in guard) return guard.error;

  const parsed = Apply.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  const email = guard.user.email;
  const db = createServiceClient();

  const { data: token } = await db
    .from("otp_tokens")
    .select("*")
    .eq("email", email!)
    .eq("purpose", PURPOSE)
    .eq("code", parsed.data.code)
    .eq("used", false)
    .maybeSingle();

  if (!token || new Date(token.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "That code is wrong or has expired. Request a new one." },
      { status: 403 },
    );
  }

  // Burn the code before doing the work, so it can't be replayed.
  await db.from("otp_tokens").update({ used: true }).eq("id", token.id);

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
