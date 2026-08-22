import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getProviders } from "@/lib/providers";
import { reportError } from "@/lib/report-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Supabase's Send SMS hook.
 *
 * SMS sign-in needs Supabase to deliver a code, and Supabase only speaks to
 * Twilio, MessageBird, Vonage and Textlocal natively. This product's SMS
 * provider is mNotify, which is on none of those lists, so the hook is the
 * supported way to keep the provider we actually pay for: Supabase generates
 * and verifies the code, and calls this to deliver it.
 *
 * That division matters. We never see or store the code, never validate it,
 * and cannot leak it: the only thing crossing this boundary is a message to
 * send and a number to send it to.
 *
 * Signed with the Standard Webhooks scheme, which is HMAC-SHA256 over
 * `id.timestamp.body`, base64, keyed on the hook secret with its `v1,whsec_`
 * prefix stripped and the remainder base64-decoded. Getting that decode wrong
 * produces a signature that never matches and looks exactly like an attack.
 */
export async function POST(request: Request) {
  const secret = process.env.SUPABASE_SMS_HOOK_SECRET;
  if (!secret) {
    console.error("[auth/sms-hook] SUPABASE_SMS_HOOK_SECRET is not set.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }

  const raw = await request.text();
  const id = request.headers.get("webhook-id") ?? "";
  const timestamp = request.headers.get("webhook-timestamp") ?? "";
  const signatureHeader = request.headers.get("webhook-signature") ?? "";

  if (!id || !timestamp || !signatureHeader) {
    return NextResponse.json({ error: "Unsigned request." }, { status: 401 });
  }

  // Replay window. Supabase signs the timestamp, so an old capture cannot be
  // resent later to make us text someone repeatedly.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    return NextResponse.json({ error: "Stale timestamp." }, { status: 401 });
  }

  const key = Buffer.from(secret.replace(/^v1,whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");

  // The header carries one or more space-separated `v1,<sig>` pairs, so that a
  // secret can be rotated without a window where neither value works.
  const provided = signatureHeader
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .filter(Boolean);

  if (!provided.some((sig) => safeEqual(sig, expected))) {
    console.warn("[auth/sms-hook] rejected a request with a bad signature");
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let payload: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;

  if (!phone || !otp) {
    return NextResponse.json({ error: "Nothing to send." }, { status: 400 });
  }

  try {
    const { messaging } = getProviders();
    await messaging.sendSms({
      to: phone.startsWith("+") ? phone : `+${phone}`,
      message: `${otp} is your Kicka code. It expires shortly. We will never ask you for it.`,
    });
  } catch (err) {
    reportError(err, { scope: "auth/sms-hook", detail: { hasPhone: true } });
    // 500 so Supabase surfaces a delivery failure to the person waiting for a
    // code, rather than telling them it was sent and leaving them to wait.
    return NextResponse.json({ error: "Could not deliver the code." }, { status: 500 });
  }

  return NextResponse.json({});
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
