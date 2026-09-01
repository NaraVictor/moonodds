import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getProviders } from "@/lib/providers";
import { PASS_PLANS, isPassPlan, usdToPesewas } from "@/lib/pricing";
import { getUsdToGhsRateForServer } from "@/lib/pricing-server";
import { settlePayment } from "@/lib/payments";
import { requireVerifiedContact } from "@/lib/require-verified";
import { SITE_URL } from "@/lib/site-url";
import { captureServerEvent } from "@/lib/posthog-server";

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
  const limited = await enforceRateLimit(request, {
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
  const verified = await requireVerifiedContact();
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: verified.status });
  }

  // Which plan. Unrecognised falls back to the day pass rather than failing:
  // the client is not the authority on price, and the amount is read from
  // PASS_PLANS below either way.
  const body = (await request.json().catch(() => null)) as { plan?: unknown } | null;
  const plan = isPassPlan(body?.plan) ? body.plan : "day";
  const price = PASS_PLANS[plan].usd;

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

  // Only the day plan is blocked by holding today. A week or a month bought on
  // top of a day you own extends past it — activate_daily_pass skips days
  // already held — so refusing that sale would be refusing money for no reason.
  if (existing && plan === "day") {
    return NextResponse.json(
      { alreadyActive: true, message: "You already have today's pass." },
      { status: 200 },
    );
  }

  // Player protection is checked before any money moves. A self-exclusion or a
  // monthly cap the customer set for themselves outranks their wish to buy.
  const { data: gate } = await supabase.rpc("can_purchase", {
    p_amount_usd: price,
  });
  if (!(gate as { allowed?: boolean })?.allowed) {
    return NextResponse.json(
      { error: (gate as { reason?: string })?.reason ?? "This purchase isn't available." },
      { status: 403 },
    );
  }

  const rate = await getUsdToGhsRateForServer();
  const amountMinor = usdToPesewas(price, rate);

  /*
   * Whether this pass will actually be for tomorrow, said before they pay.
   *
   * activate_daily_pass rolls a pass forward when no board pick is left to
   * kick off — a pass bought at 23:50 is otherwise ten minutes long. The roll
   * is the right outcome, but discovering it after paying is not: someone who
   * meant to buy tonight's football should be told they are buying tomorrow's
   * while they can still change their mind.
   *
   * Advisory only. The database decides at activation, from the state at that
   * moment, and this is a read of the same condition a few seconds earlier.
   */
  const now = new Date();
  const dayEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const { count: stillToPlay } = await db
    .from("predictions")
    .select("id, fixtures!inner(fixture_date, status)", { count: "exact", head: true })
    .eq("tier", "primary")
    .eq("status", "pending")
    .eq("fixtures.status", "scheduled")
    .gt("fixtures.fixture_date", now.toISOString())
    .lt("fixtures.fixture_date", dayEnd.toISOString());

  const forTomorrow = (stillToPlay ?? 0) === 0;

  /*
   * Reuse a checkout already in flight rather than opening a second one.
   *
   * The active-pass check above only sees a pass that has SETTLED. Two requests
   * arriving together both passed it, both wrote a payment row, and both opened
   * a Paystack transaction — so a customer who completed both was charged twice
   * for a day the unique index on daily_passes gave them exactly once.
   *
   * Paystack keys a transaction on its reference, so handing back the pending
   * one turns a double-tap into a single charge. The partial unique index added
   * in 20260825020000 is the backstop for the narrower race where both requests
   * read before either wrote; this is what stops that race being reached at all.
   */
  /*
   * Keyed on the PLAN as well as the day.
   *
   * Reuse exists to turn a double-tap into one charge, and it did that by
   * matching any pending day-pass for today. With more than one plan on sale
   * that becomes a pricing bug: somebody who opened the day pass, went back
   * and chose the month would be handed the day pass's reference and its
   * amount — settlement compares against the stored amount, so they would be
   * charged $3 and, once the plan on that row said "day", receive one day.
   *
   * Matching the plan too means a double-tap still reuses and a change of mind
   * opens its own checkout.
   */
  const pendingToday = () =>
    db
      .from("payments")
      .select("reference, amount_minor")
      .eq("user_id", user.id)
      .eq("purpose", "daily_pass")
      .eq("status", "pending")
      .eq("metadata->>dateKey", today)
      .eq("metadata->>plan", plan)
      .maybeSingle();

  const { data: inFlight } = await pendingToday();

  let reference =
    inFlight?.reference ??
    `pass-${today}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  // The stored amount wins for a reused reference: settlement compares what
  // Paystack reports against payments.amount_minor, so re-quoting a fresh FX
  // rate onto an existing row would fail that check and strand the payment.
  let chargeMinor = inFlight?.amount_minor ?? amountMinor;

  if (!inFlight) {
    // Bind reference -> buyer BEFORE the provider ever sees it.
    const { error: payErr } = await db.from("payments").insert({
      user_id: user.id,
      reference,
      purpose: "daily_pass",
      amount_minor: amountMinor,
      currency: "GHS",
      amount_usd: price,
      status: "pending",
      // `plan` decides how many days settlement grants, so it lives on the
      // PAYMENT rather than only on the Paystack metadata. Without it here,
      // activate_daily_pass reads no plan, defaults to one day, and a $10
      // week pass buys a single morning.
      metadata: { rate, dateKey: today, plan },
    });

    if (payErr) {
      // 23505 is the partial unique index doing its job: a concurrent request
      // wrote first. Its reference is as good as ours, so fall in behind it.
      //
      // The index keys on the plan as well as the day (20260901100000), so the
      // row that won is for the SAME plan and its amount is the right one to
      // inherit. Before that it could have been a different plan's row, and
      // falling in behind it would have charged a week's price for a day.
      if (payErr.code !== "23505") {
        console.error("[checkout/day-pass] payment row:", payErr);
        return NextResponse.json(
          { error: "Could not start checkout." },
          { status: 500 },
        );
      }

      const { data: winner } = await pendingToday();
      if (!winner?.reference) {
        return NextResponse.json(
          { error: "Could not start checkout." },
          { status: 500 },
        );
      }
      reference = winner.reference;
      chargeMinor = winner.amount_minor;
    }
  }

  const { payments } = getProviders();
  const init = await payments.initialize({
    email: user.email ?? `customer-${user.id}@kicka.app`,
    amountMinor: chargeMinor,
    currency: "GHS",
    reference,
    // Where Paystack returns someone who completed on the hosted page instead
    // of in the popup. Without it they stop on Paystack's confirmation screen
    // and never reach the verify call.
    callbackUrl: `${SITE_URL}/checkout/day-pass`,
    metadata: { purpose: "daily_pass", dateKey: today, priceUsd: price, plan },
  });

  // Server-side checkout-initiated event. The browser also captures
  // checkout_started, but this gives us a server-authoritative count that
  // isn't affected by ad blockers.
  // Swallowed on failure. By this point a payment row exists and Paystack has
  // been initialised, so a throw would 500 a checkout that has already taken
  // the two steps that matter and strand the reference behind it.
  await captureServerEvent({
    distinctId: user.id,
    event: "checkout_initiated",
    properties: {
      kind: "day-pass",
      price_usd: price,
      is_reused_reference: !!inFlight,
    },
  });

  return NextResponse.json({ ...init, forTomorrow });
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
