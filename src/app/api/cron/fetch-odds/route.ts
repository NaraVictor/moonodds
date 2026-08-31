import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import { assertCronRequest } from "@/lib/api-auth";
import { runFetchOdds } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Bookmaker prices for today's board.
 *
 * Runs after the picks exist and before kickoff, because odds only mean
 * something while the market is still open — and because a price taken hours
 * before a match is the price a customer could actually have had, which is the
 * whole point of recording it rather than deriving one.
 *
 * Safe to run repeatedly: it skips picks that already carry a price, so a
 * second run in the same window costs nothing against the API budget.
 */
export async function POST(request: Request) {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    return NextResponse.json({ ok: true, ...(await runFetchOdds()) });
  } catch (err) {
    reportError(err, { scope: "cron/fetch-odds" });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
