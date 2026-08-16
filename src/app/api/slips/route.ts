import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const Body = z.object({
  slipType: z.enum(["single", "accumulator"]),
  legs: z
    .array(z.object({ predictionId: z.uuid(), odds: z.number().positive() }))
    .min(1)
    .max(12),
});

/**
 * Persist a bet slip.
 *
 * Convex ran this as one ACID mutation. Here the slip and its legs are two
 * writes, so both go through a single RPC, otherwise a failure between them
 * leaves an orphaned slip with no legs and a wrong combined odds figure.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "slip-create",
    limit: 30,
    windowSeconds: 60,
    message: "You're saving slips very quickly. Give it a moment.",
  });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in to save your slip." },
      { status: 401 },
    );
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "That slip doesn't look right. Try rebuilding it." },
      { status: 400 },
    );
  }

  const { slipType, legs } = parsed.data;
  const db = createServiceClient();

  // Every leg must still be pending, you can't back a result that's already in.
  const { data: preds } = await db
    .from("predictions")
    .select("id, status")
    .in(
      "id",
      legs.map((l) => l.predictionId),
    );

  if (!preds || preds.length !== legs.length) {
    return NextResponse.json(
      { error: "One or more picks no longer exist." },
      { status: 404 },
    );
  }

  const settled = preds.find((p) => p.status !== "pending");
  if (settled) {
    return NextResponse.json(
      { error: `A pick on this slip is already ${settled.status}.` },
      { status: 409 },
    );
  }

  const combinedOdds = legs.reduce((acc, l) => acc * l.odds, 1);

  const { data, error } = await db.rpc("create_slip", {
    p_user_id: user.id,
    p_slip_type: slipType,
    p_combined_odds: Number(combinedOdds.toFixed(3)),
    p_legs: legs.map((l) => ({
      prediction_id: l.predictionId,
      odds: l.odds,
    })),
  });

  if (error) {
    console.error("[slips]", error);
    return NextResponse.json(
      { error: "Could not save your slip. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ slipId: data, combinedOdds });
}
