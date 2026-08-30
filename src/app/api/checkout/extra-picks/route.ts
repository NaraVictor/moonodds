import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getProviders } from "@/lib/providers";
import { extraPicksPriceUsd, usdToPesewas } from "@/lib/pricing";
import { getUsdToGhsRateForServer } from "@/lib/pricing-server";
import { resolveEngineVariables } from "@/lib/engine/variables";
import { settlePayment } from "@/lib/payments";
import { requireVerifiedContact } from "@/lib/require-verified";
import { SITE_URL } from "@/lib/site-url";

/**
 * The extras add-on.
 *
 * One flat price deals a fixed number of games from today's extras basket —
 * the picks that cleared the publish floor but placed outside the free board.
 *
 * THE BUYER DOES NOT CHOOSE, AND DOES NOT NAME
 *
 * This route used to accept `leagueIds` and resolve fixtures from them. That
 * made the size of the purchase a function of the day's card: the same two
 * leagues delivered five games on a Saturday and one on a Tuesday, for the
 * same $2. Now the count is the product — "10 more of today's calls" — and it
 * is the same sentence every day.
 *
 * The draw happens here, server-side, and is written onto the payment row
 * before Paystack is called. So the set is settled before money moves, and
 * nothing the browser sends can widen it afterwards. There is no request body
 * to tamper with any more, which is the strongest version of that guarantee.
 */

/*
 * Deal `count` fixtures from today's basket.
 *
 * Random rather than strongest-first, deliberately. Handing every buyer the
 * same top ten would mean the basket's best calls are the only ones that ever
 * sell, and two people who both bought would hold identical slips. The buyer
 * still SEES theirs strongest-first — get_my_extra_picks orders by confidence
 * — so the draw is invisible where it would look arbitrary and useful where it
 * would not.
 *
 * Excludes what the caller already owns today, so a second purchase deals from
 * what is left rather than selling the same game twice.
 */
async function drawFixtures(
  db: ReturnType<typeof createServiceClient>,
  alreadyOwned: ReadonlySet<string>,
  count: number,
) {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

  /*
   * Only fixtures carrying a PENDING EXTRA pick.
   *
   * What the customer is handed is get_my_extra_picks, which returns
   * predictions for these fixture ids — so selling a fixture without one
   * charges $2 and delivers an empty list. `tier` keeps the board's own picks
   * out: a day-pass holder can already see those, and charging again would be
   * selling something the buyer has.
   */
  const { data } = await db
    .from("fixtures")
    .select("id, predictions!inner(id, tier, status)")
    .eq("predictions.tier", "extra")
    .eq("predictions.status", "pending")
    .eq("status", "scheduled")
    .gte("fixture_date", now.toISOString())
    .lt("fixture_date", end.toISOString());

  const pool = (data ?? [])
    .map((f) => f.id as string)
    .filter((id) => !alreadyOwned.has(id));

  // Fisher-Yates over the whole pool, then take the head. Sorting by
  // Math.random() - 0.5 is the usual shortcut and it is biased: it leaves the
  // early entries near the front, which here would mean the same fixtures
  // being dealt disproportionately often.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, count);
}

/** How many games one unlock deals. Admin-set, with the shipped default. */
async function unlockSize(db: ReturnType<typeof createServiceClient>) {
  const { data: config } = await db
    .from("ai_engine_config")
    .select("*")
    .eq("status", "active")
    .maybeSingle();

  const raw = Number(
    resolveEngineVariables(config ?? {}).values.extraPicksPerUnlock,
  );
  return Number.isFinite(raw) && raw >= 1 ? Math.trunc(raw) : 10;
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

  const db = createServiceClient();

  // Perk gate: this is for pass holders. Ask the database, not the client.
  const { data: access } = await supabase.rpc("get_access_state");
  if (!(access as { hasFullAccess?: boolean })?.hasFullAccess) {
    return NextResponse.json(
      { error: "Extra picks are for day-pass holders." },
      { status: 403 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  // Don't sell the same fixtures twice. The day pass has always had this check
  // and this route did not, so a double-tap on a slow connection charged twice
  // and unlocked nothing the second time.
  const { data: owned } = await db
    .from("extra_pick_orders")
    .select("fixture_ids")
    .eq("user_id", user.id)
    .eq("date_key", today)
    .eq("status", "active");

  const alreadyOwned = new Set(
    (owned ?? []).flatMap((o) => (o.fixture_ids ?? []) as string[]),
  );

  /*
   * One pending extras checkout per person per day.
   *
   * This used to key on the SELECTION — the sorted fixture ids — because the
   * buyer chose their own leagues and two different choices were two genuine
   * purchases. A random draw destroys that: every tap draws a different ten,
   * so every tap produced a different key, no in-flight row ever matched, and
   * the unique index that exists to stop a double-tap charging twice could
   * never fire. Keyed on the day it fires exactly when it should.
   *
   * A settled purchase does not hold the slot — the index is partial on
   * `pending` — so someone who buys ten and comes back for ten more still can.
   */
  const checkoutKey = today;

  const pendingSame = () =>
    db
      .from("payments")
      .select("reference, amount_minor, metadata")
      .eq("user_id", user.id)
      .eq("purpose", "extra_picks")
      .eq("status", "pending")
      .eq("metadata->>checkoutKey", checkoutKey)
      .maybeSingle();

  const { data: inFlight } = await pendingSame();

  /*
   * A resumed checkout keeps the games the FIRST attempt drew, and is looked
   * up BEFORE the draw.
   *
   * Order matters here. With the draw first, someone who abandoned a payment
   * and came back after their ten had kicked off — or been re-ranked onto the
   * free board — drew nothing, and was told there were no extra games today
   * while holding a live quote for ten of them. Their own pending row is the
   * answer to that question, so it is asked first.
   */
  const held = (inFlight?.metadata as { fixtureIds?: string[] } | null)?.fixtureIds;

  const fresh = held?.length
    ? held
    : await drawFixtures(db, alreadyOwned, await unlockSize(db));

  /*
   * An empty draw is not an error the customer caused.
   *
   * Two ways to get here: the engine put every qualifying pick on the board
   * today, so there is no basket; or this buyer has already bought all of it.
   * Neither is a failed request, and neither should read like one — so both
   * come back 200 with something true to say, and the page stops offering the
   * unlock rather than letting a second tap charge for nothing.
   */
  if (!fresh.length) {
    return NextResponse.json(
      {
        alreadyActive: alreadyOwned.size > 0,
        message: alreadyOwned.size
          ? "You've already unlocked every extra game available today."
          : "There are no extra games today — everything the engine published is on the board.",
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
        fixtureIds: fresh,
        checkoutKey,
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
