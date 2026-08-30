import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getProviders } from "@/lib/providers";
import {
  EXTRA_PICK_GAMES_PER_LEAGUE,
  extraPicksPriceUsd,
  usdToPesewas,
} from "@/lib/pricing";
import { getUsdToGhsRateForServer } from "@/lib/pricing-server";
import { settlePayment } from "@/lib/payments";
import { requireVerifiedContact } from "@/lib/require-verified";
import { SITE_URL } from "@/lib/site-url";

/**
 * Extra league picks, a pass-holder perk.
 *
 * Price scales with the number of games actually available, not the number of
 * leagues asked for, so a league with one fixture left doesn't get billed as
 * three. The fixtures are resolved server-side and stored on the order, which
 * is what get_my_extra_picks() later reads.
 */

/**
 * `leagueIds` is deduplicated, and that is a billing control.
 *
 * Nothing enforced uniqueness, and selectFixtures resolves fixtures per ARRAY
 * ENTRY rather than per distinct league. Six copies of one league id therefore
 * resolved the same three fixtures six times, and the price is a function of
 * how many fixtures came back — so the same three games were billed at six
 * times the price, and the order was written with eighteen fixture ids and a
 * num_games of eighteen to match.
 *
 * The UI does not send duplicates today, which is exactly why this went
 * unnoticed: it takes a double-submit or one bad render to overcharge somebody,
 * and nothing downstream would have flagged it, because every figure on the
 * payment row agrees with every other one.
 */
const Init = z.object({
  leagueIds: z
    .array(z.uuid())
    .min(1)
    .max(6)
    .transform((ids) => [...new Set(ids)]),
});

async function selectFixtures(
  db: ReturnType<typeof createServiceClient>,
  leagueIds: string[],
) {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

  // A Set, not an array. The caller is deduplicated above, but this function
  // is what the price is computed from, so it does not rely on that: two
  // different leagues cannot share a fixture today, and if that ever changes
  // the charge must not double.
  const chosen = new Set<string>();
  for (const leagueId of leagueIds) {
    /*
     * Only fixtures that HAVE a prediction.
     *
     * This selected from `fixtures`, but what the customer is handed is
     * get_my_extra_picks — which returns PREDICTIONS for these fixture ids. The
     * engine publishes a fraction of the board, so the two are routinely
     * different: on a live board today, 3 of 14 upcoming fixtures had a
     * prediction, and five of the eight leagues on offer had none at all.
     *
     * Selling those charged $2 and delivered an empty list. The inner join is
     * what makes the count sold and the count delivered the same number.
     */
    const { data } = await db
      .from("fixtures")
      .select("id, predictions!inner(id)")
      .eq("league_id", leagueId)
      .eq("status", "scheduled")
      .gte("fixture_date", now.toISOString())
      .lt("fixture_date", end.toISOString())
      .order("fixture_date")
      .limit(EXTRA_PICK_GAMES_PER_LEAGUE);

    for (const f of data ?? []) chosen.add(f.id as string);
  }
  return [...chosen];
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, {
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

  // Nothing is charged to an address nobody has proven they control.
  const verified = await requireVerifiedContact();
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: verified.status });
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
      { error: "No predicted games left in those leagues today." },
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

  const rate = await getUsdToGhsRateForServer();
  const amountMinor = usdToPesewas(priceUsd, rate);
  const today = new Date().toISOString().slice(0, 10);

  /*
   * A stable name for exactly this selection.
   *
   * Sorted, so the same games chosen in a different order are the same order.
   * It is what the partial unique index keys on, which is why it identifies the
   * SELECTION rather than the day: two pending day passes are always a mistake,
   * but a second extra-picks checkout for different leagues is a legitimate
   * second purchase and must not be blocked.
   */
  const fixtureKey = [...fresh].sort().join(",");

  const pendingSame = () =>
    db
      .from("payments")
      .select("reference, amount_minor")
      .eq("user_id", user.id)
      .eq("purpose", "extra_picks")
      .eq("status", "pending")
      .eq("metadata->>fixtureKey", fixtureKey)
      .maybeSingle();

  const { data: inFlight } = await pendingSame();

  let reference =
    inFlight?.reference ??
    `extra-${today}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  // Settlement compares the settled amount against the stored one, so a reused
  // reference must be charged what its row says, not a freshly quoted rate.
  let chargeMinor = inFlight?.amount_minor ?? amountMinor;

  if (!inFlight) {
    const { error: payErr } = await db.from("payments").insert({
      user_id: user.id,
      reference,
      purpose: "extra_picks",
      amount_minor: amountMinor,
      currency: "GHS",
      amount_usd: priceUsd,
      status: "pending",
      metadata: {
        rate,
        dateKey: today,
        leagueIds: parsed.data.leagueIds,
        fixtureIds: fresh,
        fixtureKey,
      },
    });

    if (payErr) {
      if (payErr.code !== "23505") {
        console.error("[checkout/extra-picks]", payErr);
        return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });
      }
      const { data: winner } = await pendingSame();
      if (!winner?.reference) {
        return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });
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
    callbackUrl: `${SITE_URL}/checkout/extra-picks`,
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
