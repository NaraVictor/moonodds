import { NextResponse } from "next/server";
import { assertCronRequest } from "@/lib/api-auth";
import { runReconcilePayments } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Finish payments that were started and never confirmed.
 *
 * The third and last chance for a customer who paid: the browser PATCH, then
 * the webhook, then this. Anything it recovers is logged loudly, because a
 * recovery here means the two faster paths both failed and somebody was
 * without access they had already paid for.
 */
export async function POST(request: Request) {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    const result = await runReconcilePayments();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/reconcile-payments]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
