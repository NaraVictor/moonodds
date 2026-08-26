import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import { assertCronRequest } from "@/lib/api-auth";
import { runFetchLineups } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * One call per fixture, up to twenty fixtures, so a minute is not enough and
 * five would let two runs overlap on the same schedule. 120s sits between.
 */
export const maxDuration = 120;

export async function POST(request: Request) {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    const result = await runFetchLineups();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, { scope: "cron/fetch-lineups" });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
