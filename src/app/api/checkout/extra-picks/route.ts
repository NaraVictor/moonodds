import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getProviders } from "@/lib/providers";
import {
  EXTRA_PICK_GAMES_PER_LEAGUE,
  extraPicksPriceUsd,
  getUsdToGhsRate,
  usdToPesewas,
} from "@/lib/pricing";
import { settlePayment } from "@/lib/payments";

/**
 * Extra league picks, a pass-holder perk.
 *
 * Price scales with the number of games actually available, not the number of
 * leagues asked for, so a league with one fixture left doesn't get billed as
 * three. The fixtures are resolved server-side and stored on the order, which
 * is what get_my_extra_picks() later reads.
 */

const Init = z.object({ leagueIds: z.array(z.uuid()).min(1).max(6) });

async function selectFixtures(
  db: ReturnType<typeof createServiceClient>,
  leagueIds: string[],
) {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

  const chosen: string[] = [];
  for (const leagueId of leagueIds) {
    const { data } = await db
      .from("fixtures")
      .select("id")
      .eq("league_id", leagueId)
      .eq("status", "scheduled")
      .gte("fixture_date", now.toISOString())
      .lt("fixture_date", end.toISOString())
      .order("fixture_date")
      .limit(EXTRA_PICK_GAMES_PER_LEAGUE);

    chosen.push(...(data ?? []).map((f) => f.id));
  }
  return chosen;
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "checkout-extra",
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

  const parsed = Init.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick at least one league." }, { status: 400 });
  }

  const db = createServiceClient();

  // Perk gate: this is for pass holders. Ask the database, not the client.
  const { data: access } = await supabase.rpc("get_access_state");
  if (!(access as { hasFullAccess?: boolean })?.hasFullAccess) {
    return NextResponse.json(
      { error: "Extra picks are for day-pass holders." },
      { status: 403 },
    );
  }

  const fixtureIds = await selectFixtures(db, parsed.data.leagueIds);
  if (!fixtureIds.length) {
    return NextResponse.json(
      { error: "No upcoming games left in those leagues today." },
      { status: 400 },
    );
  }

  // Don't sell the same fixtures twice. The day pass has always had this check
  // and this route did not, so a double-tap on a slow connection charged twice
  // and unlocked nothing the second time.
  const { data: owned } = await db
    .from("extra_pick_orders")
    .select("fixture_ids")
    .eq("user_id", user.id)
    .eq("date_key", new Date().toISOString().slice(0, 10))
    .eq("status", "active");

  const alreadyOwned = new Set(
    (owned ?? []).flatMap((o) => (o.fixture_ids ?? []) as string[]),
  );
  const fresh = fixtureIds.filter((id) => !alreadyOwned.has(id));

  if (!fresh.length) {
    return NextResponse.json(
      {
        alreadyActive: true,
        message: "You've already unlocked every game in those leagues today.",
      },
      { status: 200 },
    );
  }

  const priceUsd = extraPicksPriceUsd(fresh.length);
  const { data: gate } = await supabase.rpc("can_purchase", {
    p_amount_usd: priceUsd,
  });
  if (!(gate as { allowed?: boolean })?.allowed) {
    return NextResponse.json(
      { error: (gate as { reason?: string })?.reason ?? "This purchase isn't available." },
      { status: 403 },
    );
  }

  const rate = await getUsdToGhsRate();
  const amountMinor = usdToPesewas(priceUsd, rate);
  const today = new Date().toISOString().slice(0, 10);
  const reference = `extra-${today}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const { error: payErr } = await db.from("payments").insert({
    user_id: user.id,
    reference,
    purpose: "extra_picks",
    amount_minor: amountMinor,
    currency: "GHS",
    amount_usd: priceUsd,
    status: "pending",
    metadata: { rate, leagueIds: parsed.data.leagueIds, fixtureIds: fresh },
  });

  if (payErr) {
    console.error("[checkout/extra-picks]", payErr);
    return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });
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
    callbackUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/checkout/extra-picks`,
    metadata: { purpose: "extra_picks", dateKey: today, priceUsd },
  });

  return NextResponse.json({ ...init, numGames: fresh.length, priceUsd });
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
