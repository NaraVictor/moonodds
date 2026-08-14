import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getProviders } from "@/lib/providers";
import {
  MIN_USD_TO_GHS,
  PASS_PRICE_USD,
  getUsdToGhsRate,
  usdToPesewas,
} from "@/lib/pricing";

/**
 * Day pass checkout.
 *
 * POST  — initialise a payment and RECORD IT AGAINST THE BUYER.
 * PATCH — verify with the provider and activate the pass.
 *
 * The payments row written in POST is the fix for the vulnerability in the
 * Convex original: verifyPass there checked the reference was valid, paid, in
 * the right currency and above a floor — but never that it belonged to the
 * person calling. Anyone holding a known-good reference could activate a pass
 * on their own account.
 */

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
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

  const rate = await getUsdToGhsRate();
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

  const db = createServiceClient();

  // Ownership check #1: the reference must be one we issued to THIS user.
  const { data: payment } = await db
    .from("payments")
    .select("*")
    .eq("reference", parsed.data.reference)
    .eq("user_id", user.id)
    .eq("purpose", "daily_pass")
    .maybeSingle();

  if (!payment) {
    return NextResponse.json(
      { error: "That payment reference isn't yours." },
      { status: 403 },
    );
  }

  const { payments, mocked } = getProviders();
  const result = await payments.verify(parsed.data.reference);

  if (result.status !== "success") {
    await db
      .from("payments")
      .update({ status: result.status === "failed" ? "failed" : "pending" })
      .eq("id", payment.id);
    return NextResponse.json(
      { error: "That payment hasn't completed." },
      { status: 402 },
    );
  }

  // Ownership check #2: the amount must match what we asked for. Skipped when
  // mocked, because the mock provider has no real amount to report.
  if (!mocked) {
    const floor = Math.round(payment.amount_usd * MIN_USD_TO_GHS * 100);
    if (result.currency !== payment.currency || result.amountMinor < floor) {
      return NextResponse.json(
        { error: "The amount paid didn't match the pass price." },
        { status: 402 },
      );
    }
  }

  const { data: passId, error } = await db.rpc("activate_daily_pass", {
    p_user_id: user.id,
    p_reference: parsed.data.reference,
  });

  if (error) {
    console.error("[checkout/day-pass] activate:", error);
    return NextResponse.json(
      { error: "Payment went through but the pass didn't activate. Contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json({ activated: true, passId });
}
