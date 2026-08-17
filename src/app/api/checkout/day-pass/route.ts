import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getProviders } from "@/lib/providers";
import { PASS_PRICE_USD, usdToPesewas } from "@/lib/pricing";
import { getUsdToGhsRateForServer } from "@/lib/pricing-server";
import { settlePayment } from "@/lib/payments";
import { requireVerifiedEmail } from "@/lib/require-verified";
import { SITE_URL } from "@/lib/site-url";

/**
 * Day pass checkout.
 *
 * POST: initialise a payment and RECORD IT AGAINST THE BUYER.
 * PATCH: verify with the provider and activate the pass. The Paystack webhook
 * and the reconciliation sweep call the same settlePayment, so whichever of the
 * three arrives first grants access and the rest become no-ops.
 *
 * The payments row written in POST is the fix for the vulnerability in the
 * Convex original: verifyPass there checked the reference was valid, paid, in
 * the right currency and above a floor, but never that it belonged to the
 * person calling. Anyone holding a known-good reference could activate a pass
 * on their own account.
 */

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "checkout-pass",
    limit: 10,
    windowSeconds: 10 * 60,
    message: "Too many checkout attempts. Wait a few minutes and try again.",
  });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // Nothing is charged to an address nobody has proven they control.
  const verified = await requireVerifiedEmail();
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: verified.status });
  }

  const db = createServiceClient();

  // Already covered for today? Don't take money twice.
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await db
    .from("daily_passes")
    .select("id")
    .eq("user_id", user.id)
    .eq("date_key", today)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { alreadyActive: true, message: "You already have today's pass." },
      { status: 200 },
    );
  }

  // Player protection is checked before any money moves. A self-exclusion or a
  // monthly cap the customer set for themselves outranks their wish to buy.
  const { data: gate } = await supabase.rpc("can_purchase", {
    p_amount_usd: PASS_PRICE_USD,
  });
  if (!(gate as { allowed?: boolean })?.allowed) {
    return NextResponse.json(
      { error: (gate as { reason?: string })?.reason ?? "This purchase isn't available." },
      { status: 403 },
    );
  }

  const rate = await getUsdToGhsRateForServer();
  const amountMinor = usdToPesewas(PASS_PRICE_USD, rate);
  const reference = `pass-${today}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // Bind reference -> buyer BEFORE the provider ever sees it.
  const { error: payErr } = await db.from("payments").insert({
    user_id: user.id,
    reference,
    purpose: "daily_pass",
    amount_minor: amountMinor,
    currency: "GHS",
    amount_usd: PASS_PRICE_USD,
    status: "pending",
    metadata: { rate, dateKey: today },
  });

  if (payErr) {
    console.error("[checkout/day-pass] payment row:", payErr);
    return NextResponse.json(
      { error: "Could not start checkout." },
      { status: 500 },
    );
  }

  const { payments } = getProviders();
  const init = await payments.initialize({
    email: user.email ?? `customer-${user.id}@moonodds.app`,
    amountMinor,
    currency: "GHS",
    reference,
    // Where Paystack returns someone who completed on the hosted page instead
    // of in the popup. Without it they stop on Paystack's confirmation screen
    // and never reach the verify call.
    callbackUrl: `${SITE_URL}/checkout/day-pass`,
    metadata: { purpose: "daily_pass", dateKey: today, priceUsd: PASS_PRICE_USD },
  });

  return NextResponse.json(init);
}

const Verify = z.object({ reference: z.string().min(8) });

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const parsed = Verify.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing reference." }, { status: 400 });
  }

  const result = await settlePayment(parsed.data.reference, user.id);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  return NextResponse.json({
    activated: true,
    alreadyActive: result.alreadyActive,
  });
}
