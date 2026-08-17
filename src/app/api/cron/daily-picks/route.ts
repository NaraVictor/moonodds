import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import { assertCronRequest } from "@/lib/api-auth";
import { runDailyPicks } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    const result = await runDailyPicks();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, { scope: "cron/daily-picks" });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
