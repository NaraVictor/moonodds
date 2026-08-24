import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import { assertCronRequest } from "@/lib/api-auth";
import { runLiveResults } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * Every minute, so short.
 *
 * The other cron routes allow the platform's full 300 seconds because they do
 * genuinely long work. This one runs sixty times more often and does at most
 * one upstream call, so a long ceiling here would only let a wedged run stay
 * wedged while fifty-nine more pile up behind it. Sixty seconds means a run
 * that has not finished before the next one is due dies instead.
 */
export const maxDuration = 60;

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
