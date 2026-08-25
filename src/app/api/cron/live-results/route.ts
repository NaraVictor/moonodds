import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import { assertCronRequest } from "@/lib/api-auth";
import { runLiveResults } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * Every fifteen seconds, so very short.
 *
 * The other cron routes allow the platform's full 300 seconds because they do
 * genuinely long work. This one runs 240 times more often and does at most one
 * upstream call, which is itself capped at 15s by API_FOOTBALL_TIMEOUT_MS. A
 * long ceiling here would only let a wedged run stay wedged while hundreds
 * queued behind it.
 *
 * 30 gives the upstream its full 15 seconds plus the database round trips
 * either side, and still dies inside two ticks. Overlap is harmless anyway —
 * every write is an idempotent update keyed on a fixture id — so this bounds
 * pile-up rather than preventing a race.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    const result = await runLiveResults();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, { scope: "cron/live-results" });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
