import { createServiceClient } from "./supabase/server";
import { PASS_PLANS, isPassPlan } from "./pricing";
import { reportError } from "./report-error";
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
  // userId travels with the result so callers that have no session of their
  // own — the webhook — can attribute what happened to the person it happened
  // to, rather than to the channel it arrived on.
  | { ok: true; alreadyActive: boolean; purpose: string; userId: string | null }
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
    return { ok: true, alreadyActive: true, purpose: payment.purpose, userId: payment.user_id };
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
    // The plan was recorded on the payment at checkout, so the length of the
    // pass is decided by what was PAID for rather than by anything the client
    // says at settlement time.
    const meta = (payment.metadata ?? {}) as { plan?: string };
    const plan = isPassPlan(meta.plan) ? meta.plan : "day";

    const { error } = await db.rpc("activate_daily_pass", {
      p_user_id: payment.user_id,
      p_reference: reference,
      p_days: PASS_PLANS[plan].days,
    });
    if (error) {
      console.error("[payments] activate_daily_pass:", error);
      return { ok: false, reason: "Could not activate the pass.", status: 500 };
    }
    await queueReceipt(db, payment);
    return { ok: true, alreadyActive: false, purpose: payment.purpose, userId: payment.user_id };
  }

  if (payment.purpose === "extra_picks") {
    // The games were drawn at checkout and written onto the payment before
    // Paystack was called. This hands that list over unchanged — activation
    // never re-draws, so what settles is what was quoted.
    const meta = (payment.metadata ?? {}) as { fixtureIds?: string[] };
    const { error } = await db.rpc("activate_extra_picks", {
      p_user_id: payment.user_id,
      p_reference: reference,
      p_fixture_ids: meta.fixtureIds ?? [],
    });
    if (error) {
      console.error("[payments] activate_extra_picks:", error);
      return { ok: false, reason: "Could not unlock the picks.", status: 500 };
    }
    await queueReceipt(db, payment);
    return { ok: true, alreadyActive: false, purpose: payment.purpose, userId: payment.user_id };
  }

  return { ok: false, reason: `Unknown purpose: ${payment.purpose}`, status: 500 };
}

/**
 * Queue a receipt.
 *
 * Through the outbox, not sent inline: the pass is already active by this point
 * and a slow mail provider must not turn a successful purchase into a failed
 * request. Customers had no proof of purchase to quote in a dispute, which is
 * a poor position to put someone in when the Terms promise refunds.
 */
async function queueReceipt(
  db: ReturnType<typeof createServiceClient>,
  payment: {
    user_id: string;
    reference: string;
    purpose: string;
    amount_minor: number;
    currency: string;
    amount_usd: number;
  },
) {
  const { error } = await db.from("jobs").insert({
    kind: "payment_receipt",
    payload: {
      userId: payment.user_id,
      reference: payment.reference,
      purpose: payment.purpose,
      amountMinor: payment.amount_minor,
      currency: payment.currency,
      amountUsd: payment.amount_usd,
    },
  });

  // 23505 is the partial unique index on (payload->>'reference') for receipts,
  // and it means another settlement channel got here first. That is the
  // expected outcome of a race the three channels are designed to have, not a
  // failure: the receipt exists, which is the whole objective.
  if (error && error.code !== "23505") {
    console.error(`[payments] could not queue receipt for ${payment.reference}:`, error);
  }
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


/**
 * Refund a payment, and take back what it bought.
 *
 * The Terms promise a refund when a pass is charged in error or when we fail to
 * publish on a day someone paid for. There was no code path for either, so every
 * refund was a manual Paystack operation with nothing linking it back to the
 * payments row, and the app's revenue figures drifted the moment one happened.
 *
 * Access is revoked in the same call. A refunded pass that still unlocks the
 * board is worse than no refund at all: the customer has their money and the
 * product too, and the reporting says neither.
 */
export async function refundPayment(
  reference: string,
  opts: { reason?: string; actor?: string } = {},
): Promise<SettleResult> {
  const db = createServiceClient();

  const { data: payment } = await db
    .from("payments")
    .select("*")
    .eq("reference", reference)
    .maybeSingle();

  if (!payment) {
    return { ok: false, reason: "No payment matches that reference.", status: 404 };
  }
  if (payment.status === "refunded") {
    return { ok: true, alreadyActive: true, purpose: payment.purpose, userId: payment.user_id };
  }
  if (payment.status !== "succeeded") {
    return {
      ok: false,
      reason: `That payment is ${payment.status}, so there is nothing to refund.`,
      status: 409,
    };
  }

  /*
   * Claim it before the provider is called.
   *
   * The read above is advisory: two admins pressing refund together both saw
   * 'succeeded' and both called Paystack. This is the conditional write that
   * only one can win, and it is deliberately NOT the status — the status must
   * not say refunded until the money is actually back, which is a different
   * moment and was already reasoned about correctly.
   */
  const { data: claimed, error: claimErr } = await db.rpc("claim_payment_refund", {
    p_reference: reference,
  });
  if (claimErr) {
    reportError(claimErr, { scope: "payments/claim-refund", detail: { reference } });
    return { ok: false, reason: "Could not start the refund.", status: 500 };
  }
  if (!claimed?.id) {
    return {
      ok: false,
      reason: "That payment is already being refunded. Check again in a moment.",
      status: 409,
    };
  }

  const { payments } = getProviders();

  let providerRef: string | null = null;
  try {
    const result = await payments.refund({
      reference,
      amountMinor: payment.amount_minor,
      reason: opts.reason,
    });
    if (!result.refunded) {
      await db.rpc("release_payment_refund", { p_reference: reference });
      return { ok: false, reason: "The provider declined the refund.", status: 502 };
    }
    providerRef = result.providerRef;
  } catch (err) {
    // Released so a transient failure can be retried rather than parking the
    // payment behind a claim nobody will ever finish.
    await db.rpc("release_payment_refund", { p_reference: reference });
    console.error(`[payments] refund failed for ${reference}:`, err);
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not refund that payment.",
      status: 502,
    };
  }

  /*
   * The money is gone. From here a failure is the worst state this system can
   * be in — refunded at the provider, 'succeeded' in our records, access still
   * live — and it used to be UNREACHABLE INFORMATION: three updates in a row
   * whose errors were never destructured, then `return { ok: true }`.
   *
   * One call now, which marks the payment and revokes what it bought together,
   * and its failure is reported and returned rather than swallowed.
   */
  const { data: finished, error: finishErr } = await db.rpc("finish_payment_refund", {
    p_reference: reference,
    p_reason: opts.reason ?? null,
    p_actor: opts.actor ?? null,
    p_provider_ref: providerRef,
  });

  if (finishErr || finished !== true) {
    reportError(finishErr ?? new Error("finish_payment_refund did not apply"), {
      scope: "payments/finish-refund",
      level: "fatal",
      detail: { reference, providerRef },
    });
    console.error(
      `[payments] REFUNDED AT PROVIDER BUT NOT RECORDED: ${reference} (provider ref ${providerRef}). ` +
        `The customer has their money and may still have access. Fix by hand.`,
    );
    return {
      ok: false,
      reason:
        "The money was refunded but our records could not be updated. This has been logged; do not retry, and check the payment by hand.",
      status: 500,
    };
  }

  return { ok: true, alreadyActive: false, purpose: payment.purpose, userId: payment.user_id };
}
