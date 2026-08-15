import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { runAutoGrade, runDailyPicks, runFetchFixtures, runFetchStats, gradePrediction } from "@/lib/pipeline";
import type { Market } from "@/lib/types";
import { runClvCheck, runRecalibration } from "@/lib/tuning";

/**
 * Office actions.
 *
 * One route with a discriminated action rather than a dozen endpoints — every
 * one of these needs the identical super-admin guard, and putting that in one
 * place means it cannot be forgotten on a new action.
 */

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fetchFixtures"), date: z.string().optional() }),
  z.object({ action: z.literal("fetchStats") }),
  z.object({ action: z.literal("generatePicks") }),
  z.object({ action: z.literal("gradeResults") }),
  z.object({ action: z.literal("clvCheck") }),
  z.object({ action: z.literal("recalibrate") }),
  z.object({ action: z.literal("approveReport"), reportId: z.uuid() }),
  z.object({
    action: z.literal("rejectReport"),
    reportId: z.uuid(),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("setUserFlags"),
    userId: z.uuid(),
    isSuspended: z.boolean().optional(),
    isSuperAdmin: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("setFixtureResult"),
    fixtureId: z.uuid(),
    homeGoals: z.number().int().min(0).max(30),
    awayGoals: z.number().int().min(0).max(30),
    htHomeGoals: z.number().int().min(0).max(30).nullable().optional(),
    htAwayGoals: z.number().int().min(0).max(30).nullable().optional(),
  }),
  z.object({
    action: z.literal("overridePrediction"),
    predictionId: z.uuid(),
    status: z.enum(["won", "lost", "void", "review_needed", "pending"]),
    reason: z.string().min(3).max(500),
  }),
  z.object({
    action: z.literal("updateWeights"),
    configId: z.uuid(),
    rankingWeights: z.record(z.string(), z.number()),
    confidenceThresholds: z.record(z.string(), z.number()).optional(),
  }),
]);

export const maxDuration = 300;

export async function POST(request: Request) {
  const guard = await requireSuperAdmin();
  if ("error" in guard) return guard.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Unrecognised action.", detail: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const db = createServiceClient();
  const actor = guard.user.email ?? guard.user.id;

  try {
    switch (body.action) {
      case "fetchFixtures":
        return NextResponse.json(
          await runFetchFixtures(body.date ?? new Date().toISOString().slice(0, 10)),
        );

      case "fetchStats":
        return NextResponse.json(await runFetchStats());

      case "generatePicks":
        return NextResponse.json(await runDailyPicks());

      case "gradeResults":
        return NextResponse.json(await runAutoGrade());

      case "clvCheck":
        return NextResponse.json(await runClvCheck());

      case "recalibrate":
        return NextResponse.json(await runRecalibration());

      case "approveReport": {
        // Proposals are read off the stored report, so the client can't slip in
        // changes that were never reviewed.
        const { error } = await db.rpc("apply_tuning_report", {
          p_report_id: body.reportId,
          p_approver: actor,
        });
        if (error) throw new Error(error.message);
        return NextResponse.json({ approved: true });
      }

      case "rejectReport": {
        const { error } = await db
          .from("tuning_reports")
          .update({
            status: "rejected",
            approved_by: actor,
            approved_at: new Date().toISOString(),
            rejection_reason: body.reason ?? null,
          })
          .eq("id", body.reportId)
          .eq("status", "pending");
        if (error) throw new Error(error.message);
        return NextResponse.json({ rejected: true });
      }

      case "setUserFlags": {
        // An admin must not be able to strip their own admin flag and lock
        // everyone out of the Office.
        if (body.userId === guard.user.id && body.isSuperAdmin === false) {
          return NextResponse.json(
            { error: "You can't remove your own admin access." },
            { status: 400 },
          );
        }

        const patch: Record<string, boolean> = {};
        if (body.isSuspended !== undefined) patch.is_suspended = body.isSuspended;
        if (body.isSuperAdmin !== undefined) patch.is_super_admin = body.isSuperAdmin;

        const { error } = await db.from("profiles").update(patch).eq("id", body.userId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ updated: true });
      }

      case "setFixtureResult": {
        // Entering a score settles the fixture AND re-grades every pending
        // prediction on it, using the same grader the cron uses — so a manual
        // correction can't diverge from automatic grading.
        const { error: fErr } = await db
          .from("fixtures")
          .update({
            status: "finished",
            home_goals: body.homeGoals,
            away_goals: body.awayGoals,
            ht_home_goals: body.htHomeGoals ?? null,
            ht_away_goals: body.htAwayGoals ?? null,
            ended_at: new Date().toISOString(),
          })
          .eq("id", body.fixtureId);
        if (fErr) throw new Error(fErr.message);

        const { data: preds } = await db
          .from("predictions")
          .select("id, prediction_type, predicted_value")
          .eq("fixture_id", body.fixtureId)
          .in("status", ["pending", "review_needed"]);

        let graded = 0;
        for (const p of preds ?? []) {
          const outcome = gradePrediction(
            p.prediction_type as Market,
            p.predicted_value,
            body.homeGoals,
            body.awayGoals,
            body.htHomeGoals ?? null,
            body.htAwayGoals ?? null,
          );
          await db
            .from("predictions")
            .update({
              status: outcome,
              settled_at: new Date().toISOString(),
              actual_result: {
                homeGoals: body.homeGoals,
                awayGoals: body.awayGoals,
                htHomeGoals: body.htHomeGoals ?? null,
                htAwayGoals: body.htAwayGoals ?? null,
              },
              manual_override: true,
              override_reason: `Result entered manually by ${actor}`,
            })
            .eq("id", p.id);
          graded++;
        }

        return NextResponse.json({ settled: true, graded });
      }

      case "overridePrediction": {
        // Records WHO and WHY — an override with no audit trail is worse than
        // no override, because nobody can tell later whether it was justified.
        const { error } = await db
          .from("predictions")
          .update({
            status: body.status,
            manual_override: true,
            override_reason: `${body.reason} — ${actor}`,
            settled_at:
              body.status === "pending" ? null : new Date().toISOString(),
            void_reason: body.status === "void" ? body.reason : null,
          })
          .eq("id", body.predictionId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ overridden: true });
      }

      case "updateWeights": {
        const sum = Object.values(body.rankingWeights).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 1) > 0.001) {
          return NextResponse.json(
            { error: `Weights must sum to 1.0 — yours sum to ${sum.toFixed(3)}.` },
            { status: 400 },
          );
        }

        const patch: Record<string, unknown> = {
          ranking_weights: body.rankingWeights,
          last_updated_at: new Date().toISOString(),
          approved_by: actor,
        };
        if (body.confidenceThresholds) {
          patch.confidence_thresholds = body.confidenceThresholds;
        }

        const { error } = await db
          .from("ai_engine_config")
          .update(patch)
          .eq("id", body.configId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ updated: true });
      }
    }
  } catch (err) {
    console.error("[office]", body.action, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed." },
      { status: 500 },
    );
  }
}
