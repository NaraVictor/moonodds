import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import { settlePayment } from "@/lib/payments";
import { captureServerEvent } from "@/lib/posthog-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Paystack webhook.
 *
 * The authoritative path for granting access. The browser's PATCH is now the
 * fast path and this is the reliable one: it arrives whether or not the
 * customer's device came back from the payment page, which is the failure that
 * previously took someone's money and gave them nothing.
 *
 * Paystack signs the raw body with HMAC SHA-512 keyed on the secret key. The
 * body must be read as text and hashed byte for byte, because re-serialising
 * parsed JSON changes whitespace and key order and the signature stops
 * matching for reasons that look like an attack.
 */
export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    console.error("[webhook/paystack] PAYSTACK_SECRET_KEY is not set.");
    // 500, not 200: without the key we cannot authenticate this, and telling
    // Paystack we handled it would drop a real payment on the floor.
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }

  const raw = await request.text();
  const signature = request.headers.get("x-paystack-signature") ?? "";

  const expected = createHmac("sha512", secret).update(raw).digest("hex");
  if (!safeEqual(signature, expected)) {
    console.warn("[webhook/paystack] rejected a request with a bad signature");
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const reference = event.data?.reference;

  // Everything else Paystack sends (transfers, refunds, subscriptions) is
  // acknowledged and ignored. A non-200 makes Paystack retry an event we are
  // never going to act on.
  if (event.event !== "charge.success" || !reference) {
    return NextResponse.json({ ok: true, ignored: event.event ?? "unknown" });
  }

  try {
    const result = await settlePayment(reference);

    if (!result.ok) {
      console.error(`[webhook/paystack] ${reference}: ${result.reason}`);
      // A 5xx tells Paystack to retry, which is what we want for a transient
      // failure. A payment we cannot match is not transient, so acknowledge it
      // and leave it for the sweep and a human.
      const retryable = result.status >= 500;
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: retryable ? 500 : 200 },
      );
    }

    /*
     * A server-side record of each confirmed payment, so the count does not
     * depend on the browser surviving the payment redirect.
     *
     * distinctId is the BUYER, not the literal string "webhook". Sending every
     * customer's purchase under one id would build a single fabricated person
     * holding every payment the product has ever taken, and leave every real
     * person's profile showing no purchases at all — which is the opposite of
     * what this event exists to answer.
     *
     * Swallowed on failure: this sits inside the handler's try block, and a
     * throw here would return 500 and make Paystack retry a payment that has
     * already settled.
     */
    await captureServerEvent({
      distinctId: result.userId ?? reference,
      event: "day_pass_purchased",
      properties: {
        purpose: result.purpose,
        already_active: result.alreadyActive,
        reference,
      },
    });

    return NextResponse.json({
      ok: true,
      purpose: result.purpose,
      alreadyActive: result.alreadyActive,
    });
  } catch (err) {
    reportError(err, { scope: "webhook/paystack" });
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }
}

/** Constant-time compare that tolerates a length mismatch without throwing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
