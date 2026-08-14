import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getProviders } from "@/lib/providers";
import {
  EXTRA_PICK_GAMES_PER_LEAGUE,
  extraPicksPriceUsd,
  getUsdToGhsRate,
  usdToPesewas,
} from "@/lib/pricing";

/**
 * Extra league picks — a pass-holder perk.
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

  const priceUsd = extraPicksPriceUsd(fixtureIds.length);
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
    metadata: { rate, leagueIds: parsed.data.leagueIds, fixtureIds },
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
    metadata: { purpose: "extra_picks", dateKey: today, priceUsd },
  });

  return NextResponse.json({ ...init, numGames: fixtureIds.length, priceUsd });
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

  // The reference must be one we issued to THIS user.
  const { data: payment } = await db
    .from("payments")
    .select("*")
    .eq("reference", parsed.data.reference)
    .eq("user_id", user.id)
    .eq("purpose", "extra_picks")
    .maybeSingle();

  if (!payment) {
    return NextResponse.json(
      { error: "That payment reference isn't yours." },
      { status: 403 },
    );
  }

  const { payments } = getProviders();
  const result = await payments.verify(parsed.data.reference);

  if (result.status !== "success") {
    return NextResponse.json({ error: "That payment hasn't completed." }, { status: 402 });
  }

  const meta = payment.metadata as { leagueIds: string[]; fixtureIds: string[] };
  const { data: orderId, error } = await db.rpc("activate_extra_picks", {
    p_user_id: user.id,
    p_reference: parsed.data.reference,
    p_league_ids: meta.leagueIds,
    p_fixture_ids: meta.fixtureIds,
  });

  if (error) {
    console.error("[checkout/extra-picks] activate:", error);
    return NextResponse.json(
      { error: "Payment went through but the picks didn't unlock. Contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json({ activated: true, orderId });
}
