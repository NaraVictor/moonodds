import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import { assertCronRequest } from "@/lib/api-auth";
import { runDailyPicks } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The second reach, half an hour after the board.
 *
 * Same engine, same prompt, SAME floor — the lower floor this used to run
 * under is gone, because it made the paid tier the calls the board would not
 * carry. What it does now is reach the fixtures the 05:00 session cap could
 * not: on a card small enough for one session it finds nothing, which is the
 * correct outcome.
 *
 * Its picks are written as extras and then re-ranked against the whole day, so
 * one strong enough can take a place on the free board. It announces nothing
 * itself — the board was already announced at 05:00.
 */
export async function POST(request: Request) {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    const result = await runDailyPicks({ tier: "extra" });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, { scope: "cron/extra-picks" });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
