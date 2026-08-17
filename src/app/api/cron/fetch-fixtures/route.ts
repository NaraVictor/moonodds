import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import { assertCronRequest } from "@/lib/api-auth";
import { runFetchFixtures } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    const date = new URL(request.url).searchParams.get("date")
      ?? new Date().toISOString().slice(0, 10);
    const result = await runFetchFixtures(date);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, { scope: "cron/fetch-fixtures" });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
