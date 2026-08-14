import { NextResponse } from "next/server";
import { assertCronRequest } from "@/lib/api-auth";
import { runAutoGrade } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    const result = await runAutoGrade();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/auto-grade]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
