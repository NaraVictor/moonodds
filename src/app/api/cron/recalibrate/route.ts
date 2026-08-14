import { NextResponse } from "next/server";
import { assertCronRequest } from "@/lib/api-auth";
import { runRecalibration } from "@/lib/tuning";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    const result = await runRecalibration();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/recalibrate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
