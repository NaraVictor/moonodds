import { createServiceClient } from "./supabase/server";
import { getProviders } from "./providers";
import { paymentAmountMatches } from "./pricing";

/**
 * Payment settlement, in one place.
 *
 * Activation used to live only in the checkout routes' PATCH handler, which
 * meant it ran only if the customer's browser came back from Paystack. Close
 * the tab, lose signal, fail the redirect, and the money was taken and nothing
 * was granted, with no path to recovery.
 *
 * Three callers now share this function: the PATCH the browser sends when it
 * does come back, the Paystack webhook, and the reconciliation sweep. Whichever
 * arrives first wins and the others become no-ops, so the customer gets their
 * pass exactly once from whichever channel survived.
 */

export type SettleResult =
  | { ok: true; alreadyActive: boolean; purpose: string }
  | { ok: false; reason: string; status: number };

/**
 * Verify a reference with the provider and grant what it paid for.
 *
 * `expectedUserId` is supplied by the browser-initiated path, where the caller
 * has a session and the reference must belong to them. The webhook and the
 * sweep pass nothing: they are trusted server-side callers acting on a payment
 * row that already records its own owner.
 */
export async function settlePayment(
  reference: string,
  expectedUserId?: string,
): Promise<SettleResult> {
  const db = createServiceClient();

  const query = db
    .from("payments")
    .select("*")
    .eq("reference", reference);

  if (expectedUserId) query.eq("user_id", expectedUserId);

  const { data: payment } = await query.maybeSingle();

  if (!payment) {
    return {
      ok: false,
      reason: expectedUserId
        ? "That payment reference isn't yours."
        : "No payment matches that reference.",
      status: expectedUserId ? 403 : 404,
    };
  }

  // Already granted. Say so rather than granting twice: Paystack retries a
  // webhook it did not get a 200 for, and the sweep runs on a schedule, so a
  // second arrival for the same reference is expected traffic, not an error.
  if (payment.status === "succeeded") {
    return { ok: true, alreadyActive: true, purpose: payment.purpose };
  }

  const { payments, mocked } = getProviders();
  const result = await payments.verify(reference);

  if (result.status !== "success") {
    await db
      .from("payments")
      .update({ status: result.status === "failed" ? "failed" : "pending" })
      .eq("id", payment.id);
    return { ok: false, reason: "That payment hasn't completed.", status: 402 };
  }

  if (
    !mocked &&
    !paymentAmountMatches(
      { amountMinor: payment.amount_minor, currency: payment.currency },
      result,
    )
  ) {
    console.error(
      `[payments] amount mismatch on ${reference}: charged ${payment.amount_minor} ${payment.currency}, settled ${result.amountMinor} ${result.currency}`,
    );
    return {
      ok: false,
      reason: "The amount paid didn't match the price quoted.",
      status: 402,
    };
  }

  if (payment.purpose === "daily_pass") {
    const { error } = await db.rpc("activate_daily_pass", {
      p_user_id: payment.user_id,
      p_reference: reference,
    });
    if (error) {
      console.error("[payments] activate_daily_pass:", error);
      return { ok: false, reason: "Could not activate the pass.", status: 500 };
    }
    return { ok: true, alreadyActive: false, purpose: payment.purpose };
  }

  if (payment.purpose === "extra_picks") {
    const meta = (payment.metadata ?? {}) as {
      leagueIds?: string[];
      fixtureIds?: string[];
    };
    const { error } = await db.rpc("activate_extra_picks", {
      p_user_id: payment.user_id,
      p_reference: reference,
      p_league_ids: meta.leagueIds ?? [],
      p_fixture_ids: meta.fixtureIds ?? [],
    });
    if (error) {
      console.error("[payments] activate_extra_picks:", error);
      return { ok: false, reason: "Could not unlock the picks.", status: 500 };
    }
    return { ok: true, alreadyActive: false, purpose: payment.purpose };
  }

  return { ok: false, reason: `Unknown purpose: ${payment.purpose}`, status: 500 };
}

/**
 * Sweep payments that were started and never confirmed.
 *
 * The safety net under the webhook. A webhook that never arrives, or arrives
 * while the app is down, leaves a customer who has paid with nothing; this
 * finds them on a schedule and finishes the job.
 *
 * `minAgeMinutes` keeps the sweep away from checkouts still in progress, where
 * a "pending" row is simply someone still typing their card details.
 */
export async function runReconcilePayments(minAgeMinutes = 10) {
  const db = createServiceClient();
  const cutoff = new Date(Date.now() - minAgeMinutes * 60_000).toISOString();

  const { data: stranded } = await db
    .from("payments")
    .select("reference")
    .eq("status", "pending")
    .lt("created_at", cutoff)
    // Old enough to be abandoned rather than in flight, recent enough that
    // Paystack still holds the transaction.
    .gt("created_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
    .limit(100);

  if (!stranded?.length) return { checked: 0, recovered: 0, failed: 0 };

  let recovered = 0;
  let failed = 0;

  for (const p of stranded) {
    try {
      const out = await settlePayment(p.reference);
      if (out.ok && !out.alreadyActive) {
        recovered++;
        console.warn(
          `[payments] recovered stranded payment ${p.reference} — the customer paid and never got their access until now`,
        );
      } else if (!out.ok) {
        failed++;
      }
    } catch (err) {
      failed++;
      console.error(`[payments] sweep failed on ${p.reference}:`, err);
    }
  }

  return { checked: stranded.length, recovered, failed };
}
