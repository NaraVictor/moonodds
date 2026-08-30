import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import { assertCronRequest } from "@/lib/api-auth";
import { runDailyPicks } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The paid pass, half an hour after the board.
 *
 * Same engine, same prompt, lower floor, and only over fixtures the 05:00 run
 * left without a pick. It publishes nothing publicly and announces nothing —
 * these are bought, not broadcast.
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
